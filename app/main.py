import os
import json
import base64
import asyncio
import hashlib
import time
from collections import OrderedDict
from typing import List

from dotenv import load_dotenv
load_dotenv()  # reads .env from project root before any os.getenv() calls

from fastapi import FastAPI, Depends, HTTPException, Query, Body, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.database import engine, get_db
from app.models import Base
from app.schemas import (
    AskRequest, AskResponse,
    ChatRequest, ChatResponse,
    TelemetryRecord, TelemetrySummary,
    BudgetRuleCreate, BudgetRuleOut, BudgetStatusItem,
    PolicyRuleCreate, PolicyRuleOut,
    ScanRequest, ScanResponse, ScanFinding,
    SessionCreate, SessionOut, SessionMessageOut, SessionChatRequest,
    UserCreate, UserUpdate, UserOut, LoginRequest, TokenResponse,
    ApiKeyCreate, ApiKeyOut, ApiKeyCreated,
    GuardModeOut, GuardModeUpdate, HealthResponse,
    RoleCreate, RoleUpdate, RoleOut,
    TeamOut,
    OrgCreate, OrgCreated,
)
from app import telemetry as tel
from app import budget as bud
from app import policy as pol
from app import sessions as sess
from app.scanner import scan
from app.client import complete, chat_complete
from app.auth import hash_password, verify_password, create_token, get_current_user, require_admin, require_platform_admin, require_page_access, get_proxy_caller, generate_api_key, resolve_team_scope, is_deny_sentinel
from app.client import proxy_chat_complete, proxy_chat_stream, get_client_for_org, invalidate_org_client
from app.models import calculate_cost, PRICING_LAST_UPDATED, Organization, ProviderCredential, encrypt_credential, decrypt_credential, Role as RoleModel, Team as TeamModel
from app.org_config import get_org_config as _get_org_config, set_org_config as _set_org_config

Base.metadata.create_all(bind=engine)


def _run_alembic_migrations() -> None:
    """Run any pending Alembic migrations on startup."""
    from alembic.config import Config as AlembicConfig
    from alembic import command as alembic_command
    import pathlib
    cfg = AlembicConfig(str(pathlib.Path(__file__).parent.parent / "alembic.ini"))
    cfg.set_main_option("sqlalchemy.url", os.getenv("DATABASE_URL", "sqlite:////data/ai_asset_mgmt.db"))
    cfg.set_main_option("script_location", str(pathlib.Path(__file__).parent.parent / "alembic"))
    # On a fresh DB (no alembic_version table, or empty alembic_version table),
    # stamp head so Alembic doesn't re-run the initial migration on a schema
    # that create_all() already built.
    from sqlalchemy import inspect as _sqlainspect, text as _sqlatext
    with engine.connect() as _conn:
        _tables = _sqlainspect(_conn).get_table_names()
        _needs_stamp = "alembic_version" not in _tables or not _conn.execute(
            _sqlatext("SELECT version_num FROM alembic_version")
        ).fetchall()
    if _needs_stamp:
        alembic_command.stamp(cfg, "head")
    alembic_command.upgrade(cfg, "head")


try:
    _run_alembic_migrations()
except Exception as _e:
    import logging as _logging
    _logging.getLogger("ai_asset_mgmt").warning("Alembic migration warning (non-fatal): %s", _e)


# Run org migration on startup (idempotent — safe to call every boot)
from app.migrate_orgs import run as _run_org_migration
from app.roles import SEED_ROLES as _SEED_ROLES, seed_roles_for_org as _seed_roles_for_org
try:
    _run_org_migration()
except Exception as _e:
    import logging as _logging
    _logging.getLogger("ai_asset_mgmt").warning("Org migration warning (non-fatal): %s", _e)

def _seed_roles() -> None:
    """Seed default roles for every existing org. Idempotent — safe to re-run."""
    from app.database import SessionLocal
    from app.models import Organization
    db = SessionLocal()
    try:
        for org in db.query(Organization).all():
            _seed_roles_for_org(db, org.id)
    finally:
        db.close()

try:
    _seed_roles()
except Exception as _e:
    import logging as _logging
    _logging.getLogger("ai_asset_mgmt").warning("Role seed warning (non-fatal): %s", _e)




def _backfill_asset_keys() -> None:
    """
    For existing telemetry rows that predate Phase 2, generate a stable asset_key
    from sha256(org_id + ':' + agent_name) and insert the corresponding
    asset_registry row as 'discovered' if it doesn't already exist.
    """
    import hashlib as _hashlib
    from app.database import SessionLocal
    from app.models import Telemetry as _Telemetry, AssetRegistry as _AssetRegistry

    db = SessionLocal()
    try:
        combos = (
            db.query(_Telemetry.organization_id, _Telemetry.agent)
            .filter(
                _Telemetry.asset_key.is_(None),
                _Telemetry.organization_id.isnot(None),
            )
            .distinct()
            .all()
        )
        if not combos:
            return

        for org_id, agent_name in combos:
            if not agent_name or not org_id:
                continue
            asset_key = _hashlib.sha256(f"{org_id}:{agent_name}".encode()).hexdigest()

            db.query(_Telemetry).filter(
                _Telemetry.organization_id == org_id,
                _Telemetry.agent == agent_name,
                _Telemetry.asset_key.is_(None),
            ).update(
                {"asset_key": asset_key, "agent_id_raw": agent_name},
                synchronize_session=False,
            )

            if not db.query(_AssetRegistry).filter(
                _AssetRegistry.organization_id == org_id,
                _AssetRegistry.asset_key == asset_key,
            ).first():
                db.add(_AssetRegistry(
                    organization_id=org_id,
                    asset_key=asset_key,
                    agent_id_raw=agent_name,
                    agent_name=agent_name,
                    status="unassigned",
                    source="discovered",
                ))

        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


try:
    _backfill_asset_keys()
except Exception as _e:
    import logging as _logging
    _logging.getLogger("ai_asset_mgmt").warning("asset key backfill warning (non-fatal): %s", _e)


def _backfill_discovery_source() -> None:
    """
    Data backfill: correct discovery_source for agents that were seen before SDK headers
    were attached.  Runs at every startup — idempotent, touches only rows that need it.
      source='sdk_runtime'     → discovery_source='sdk_runtime'
      source in (explicit_header, api_key_scope) with gateway_runtime → gateway_telemetry
    """
    from sqlalchemy import text as _text
    with engine.connect() as conn:
        try:
            conn.execute(_text(
                "UPDATE asset_registry SET discovery_source='sdk_runtime' "
                "WHERE source='sdk_runtime' AND discovery_source!='sdk_runtime'"
            ))
            conn.execute(_text(
                "UPDATE asset_registry SET discovery_source='gateway_telemetry' "
                "WHERE source IN ('explicit_header','api_key_scope') AND discovery_source='gateway_runtime'"
            ))
            conn.commit()
        except Exception:
            pass  # table may not exist yet on first boot — create_all handles it


try:
    _backfill_discovery_source()
except Exception as _e:
    import logging as _logging
    _logging.getLogger("ai_asset_mgmt").warning("discovery_source backfill non-fatal: %s", _e)


# ── Pricing Registry: seed + start background sync ────────────────────────────

def _seed_pricing_registry() -> None:
    """Seed ModelPricing table from built-in COST_PER_1M on first boot. Idempotent."""
    from app.database import SessionLocal
    from app import pricing_registry as _pr
    db = SessionLocal()
    try:
        created = _pr.seed_defaults(db)
        if created:
            import logging as _l
            _l.getLogger("ai_asset_mgmt").info("Pricing registry: %d models seeded", created)
    except Exception as exc:
        import logging as _l
        _l.getLogger("ai_asset_mgmt").warning("Pricing registry seed warning (non-fatal): %s", exc)
    finally:
        db.close()


try:
    _seed_pricing_registry()
except Exception as _e:
    import logging as _logging
    _logging.getLogger("ai_asset_mgmt").warning("Pricing seed non-fatal: %s", _e)

try:
    from app import pricing_registry as _pr_mod
    _pr_mod.start_background_sync()
except Exception as _e:
    import logging as _logging
    _logging.getLogger("ai_asset_mgmt").warning("Pricing sync thread non-fatal: %s", _e)


_START_TIME = time.time()


def _check_secrets() -> list[str]:
    """
    Validate required secrets at startup. Returns a list of warning strings
    for any that are missing or invalid. Exposed in /health so monitoring can
    catch misconfigured deployments before users hit cryptic errors.
    """
    import logging as _logging
    _log = _logging.getLogger("ai_asset_mgmt")
    warnings: list[str] = []

    raw = os.getenv("CREDENTIAL_ENCRYPTION_KEY", "")
    if not raw:
        msg = (
            "CREDENTIAL_ENCRYPTION_KEY is not set. "
            "Organization AI Providers (BYOK credential storage) will not work. "
            "Generate a key with: python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\""
        )
        _log.error("STARTUP SECRET MISSING: %s", msg)
        warnings.append(msg)
    else:
        try:
            from cryptography.fernet import Fernet as _Fernet
            _Fernet(raw.encode())
        except Exception as exc:
            msg = (
                f"CREDENTIAL_ENCRYPTION_KEY is set but is not a valid Fernet key: {exc}. "
                "Organization AI Providers will not work. "
                "Regenerate with: python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\""
            )
            _log.error("STARTUP SECRET INVALID: %s", msg)
            warnings.append(msg)

    if warnings and os.getenv("FAIL_FAST_ON_MISSING_SECRETS", "").lower() == "true":
        _log.critical(
            "FAIL_FAST_ON_MISSING_SECRETS=true — aborting startup due to missing secrets."
        )
        import sys as _sys
        _sys.exit(1)

    return warnings


_SECRET_WARNINGS: list[str] = _check_secrets()


def _check_tenancy_hardened() -> bool:
    """
    Return True if telemetry.organization_id is NOT NULL (tenancy fully enforced).
    Checked once at startup and exposed in /health so the state is queryable and
    monitorable rather than buried in boot logs.

    When False, the four dashboard read paths return 503 via require_tenancy_hardened().
"""
    try:
        from sqlalchemy import inspect as _inspect
        inspector = _inspect(engine)
        cols = {c["name"]: c for c in inspector.get_columns("telemetry")}
        return not cols.get("organization_id", {}).get("nullable", True)
    except Exception:
        return False  # fail-safe: unknown = report not hardened

_TENANCY_HARDENED = _check_tenancy_hardened()


# ─── Guard mode (Visibility First → Governance Later) ─────────────────────────
# Platform default comes from GUARD_MODE; per-team overrides live in the
# guard_modes table. Effective mode = team override (if any) else platform default.
#
#   observe — evaluate + log + shadow-block, never block, no alerts
#   alert   — evaluate + log + shadow-block + fire alerts, never block
#   enforce — evaluate + act: PII/policy/budget blocks return 4xx
#
# Backward compat: legacy GATEWAY_FAIL_MODE maps closed→enforce, open→observe.
from app.org_config import PLATFORM_MODE as _PLATFORM_MODE  # noqa: E402


# ─── Startup seed ─────────────────────────────────────────────────────────────

def _seed_admin():
    import secrets as _secrets
    from app.models import User
    db = next(get_db())
    try:
        existing = db.query(User).filter(User.email == "admin@ai-asset-mgmt.local").first()
        if not existing:
            # If ADMIN_SEED_PASSWORD is set use it; otherwise generate a random one and
            # print it once so the operator can capture it from the boot logs.
            seed_pw = os.getenv("ADMIN_SEED_PASSWORD") or _secrets.token_urlsafe(20)
            db.add(User(
                email="admin@ai-asset-mgmt.local",
                name="Admin",
                hashed_password=hash_password(seed_pw),
                role="admin",
                team="Platform",
                is_platform_admin=True,
            ))
            db.commit()
            if not os.getenv("ADMIN_SEED_PASSWORD"):
                print(
                    "\n"
                    "╔══════════════════════════════════════════════════════════════╗\n"
                    "║           PLATFORM ADMIN — FIRST-BOOT CREDENTIALS           ║\n"
                    "║                                                              ║\n"
                    f"║  email   : admin@ai-asset-mgmt.local                        ║\n"
                    f"║  password: {seed_pw:<50} ║\n"
                    "║                                                              ║\n"
                    "║  Change this password immediately after first login.         ║\n"
                    "║  Set ADMIN_SEED_PASSWORD env var to control the initial pw.  ║\n"
                    "╚══════════════════════════════════════════════════════════════╝\n",
                    flush=True,
                )
        elif not existing.is_platform_admin:
            # Upgrade path: existing admin missing the platform flag (e.g. created before
            # the column was added or seeded without it).
            existing.is_platform_admin = True
            db.commit()
            print("INFO: platform admin flag was missing — corrected on startup.", flush=True)
    finally:
        db.close()

_seed_admin()

tags_metadata = [
    {
        "name": "POST — Ask / Create",
        "description": (
            "**Send prompts and create resources.**  \n"
            "All LLM calls run through the full enforcement pipeline: "
            "PII scan → model policy check → budget check → LLM → telemetry.  \n"
            "Includes single-shot `/ask`, multi-turn `/chat`, session-aware chat, "
            "and creation of sessions, budgets, and policies."
        ),
    },
    {
        "name": "GET — Read / Monitor",
        "description": (
            "**Read data and monitor the system.**  \n"
            "Query telemetry records, cost summaries, audit logs, security alerts, "
            "active sessions, budget status, and policy rules.  \n"
            "All read endpoints are non-destructive and safe to call repeatedly."
        ),
    },
    {
        "name": "Auth — Users",
        "description": (
            "**Authentication and user management.**  \n"
            "Login, logout, current-user info, and admin-only user CRUD.  \n"
            "All other endpoints require a valid Bearer token from `/auth/login`."
        ),
    },
    {
        "name": "DELETE — Remove",
        "description": (
            "**Remove resources.**  \n"
            "Close active chat sessions, delete budget rules, and remove policy rules.  \n"
            "Deletions are immediate and cannot be undone."
        ),
    },
]

_DEBUG = os.getenv("DEBUG", "false").lower() == "true"
_FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "")

app = FastAPI(
    title="AI Asset Management",
    description=(
        "## AI Runtime Intelligence Platform\n\n"
        "Every LLM call in your organisation routes through this gateway. "
        "It enforces **budget limits**, **model policies**, and **PII scanning** "
        "on every request, then stores full telemetry for cost and audit reporting.\n\n"
        "**Authentication:** click **Authorize** (🔒) above, enter `Bearer <token>`. "
        "Get a token from `POST /auth/login`.\n\n"
        "Endpoints are grouped by operation type:\n"
        "- **POST** — send prompts or create resources\n"
        "- **GET** — read telemetry, sessions, budgets, policies\n"
        "- **DELETE** — remove sessions, budgets, policies"
    ),
    version="0.5.0",
    openapi_tags=tags_metadata,
    # Disable interactive docs in production to avoid exposing API surface
    docs_url="/docs" if _DEBUG else None,
    redoc_url="/redoc" if _DEBUG else None,
)

# Rate limiting exception handler — limiter registered after proxy router import below
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


@app.exception_handler(Exception)
async def _unhandled_exception_handler(request: Request, exc: Exception):
    """
    Catch-all for exceptions that escape the route layer (e.g. from FastAPI
    dependencies like get_db).  Without this, Starlette's ServerErrorMiddleware
    returns plain-text "Internal Server Error", which the frontend cannot parse
    as JSON and falls back to the generic "check server logs" message.
    """
    import uuid as _uuid_mod
    import logging as _logging
    trace_id = _uuid_mod.uuid4().hex[:12]
    _logging.getLogger("ai_asset_mgmt").exception(
        "unhandled_exception trace_id=%s path=%s method=%s exc=%s",
        trace_id, request.url.path, request.method, type(exc).__name__,
    )
    return JSONResponse(
        status_code=500,
        content={"detail": {"error": {
            "type": "internal_gateway_error",
            "message": "Unexpected gateway error. Check server logs for trace_id.",
            "trace_id": trace_id,
        }}},
    )

# Add Bearer token support to Swagger UI
from fastapi.openapi.utils import get_openapi

def custom_openapi():
    if app.openapi_schema:
        return app.openapi_schema
    schema = get_openapi(
        title=app.title,
        version=app.version,
        description=app.description,
        routes=app.routes,
        tags=tags_metadata,
    )
    schema.setdefault("components", {})
    schema["components"]["securitySchemes"] = {
        "BearerAuth": {"type": "http", "scheme": "bearer", "bearerFormat": "JWT"}
    }
    schema["security"] = [{"BearerAuth": []}]
    app.openapi_schema = schema
    return schema

app.openapi = custom_openapi

# ── Asset Management routes ───────────────────────────────────────────────────
from app.routes import assets as assets_routes  # noqa: E402
app.include_router(assets_routes.router)

from app.routes import agent_inventory as agent_inventory_routes  # noqa: E402
app.include_router(agent_inventory_routes.router)

from app.routes import cost_intelligence as cost_intelligence_routes  # noqa: E402
app.include_router(cost_intelligence_routes.router)

from app.routes import pricing_registry as pricing_registry_routes  # noqa: E402
app.include_router(pricing_registry_routes.router)

from app.routes import admin as admin_routes  # noqa: E402
app.include_router(admin_routes.router)

from app.routes import auth as auth_routes  # noqa: E402
app.include_router(auth_routes.router)

from app.routes import settings as settings_routes  # noqa: E402
app.include_router(settings_routes.router)

from app.routes import governance as governance_routes  # noqa: E402
app.include_router(governance_routes.router)

from app.routes import inventory as inventory_routes  # noqa: E402
app.include_router(inventory_routes.router)

from app.routes import proxy as proxy_routes  # noqa: E402
from app.routes.proxy import _proxy_limiter, _circuit_state, _circuit  # noqa: E402
app.state.limiter = _proxy_limiter
app.include_router(proxy_routes.router)

from app.routes import relationships as relationships_routes  # noqa: E402
app.include_router(relationships_routes.router)

# Always allow the canonical ObserveAgents public origins, the Render fallback,
# and local dev — plus any explicit FRONTEND_ORIGIN entries. Deduped, order-stable.
from app.config import PUBLIC_ORIGINS as _PUBLIC_ORIGINS, LOCAL_ORIGINS as _LOCAL_ORIGINS  # noqa: E402

_EXPLICIT_ORIGINS = [o.strip() for o in _FRONTEND_ORIGIN.split(",") if o.strip()]
_ALLOWED_ORIGINS = list(dict.fromkeys(_EXPLICIT_ORIGINS + _PUBLIC_ORIGINS + _LOCAL_ORIGINS))
# Always permit any *.onrender.com origin so the Render fallback URL keeps
# working regardless of whether FRONTEND_ORIGIN is set.
_CORS_ORIGIN_REGEX = r"https://[a-z0-9-]+\.onrender\.com"

app.add_middleware(
    CORSMiddleware,
    allow_origins=_ALLOWED_ORIGINS,
    allow_origin_regex=_CORS_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=[
        "Authorization", "Content-Type",
        # Platform admin org switching
        "X-View-Org",
        # New canonical agent-identity headers
        "X-Agent-Name", "X-Agent-Team", "X-Agent-Owner",
        "X-Agent-Environment", "X-Agent-Version", "X-Agent-Source",
        # Legacy X-Guard-* headers (still accepted for backward compatibility)
        "X-Guard-Team", "X-Guard-Agent", "X-Guard-Agent-Version", "X-Guard-Environment",
    ],
)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains; preload"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
    return response


# ─── Health ───────────────────────────────────────────────────────────────────

@app.get("/health", response_model=HealthResponse, tags=["GET — Read / Monitor"])
@app.get("/api/health", response_model=HealthResponse, tags=["GET — Read / Monitor"])
def health(db: Session = Depends(get_db)):
    """Liveness + readiness. Public — customers use this for their own fallback logic."""
    db_ok = True
    try:
        from sqlalchemy import text
        db.execute(text("SELECT 1"))
    except Exception:
        db_ok = False
    has_warnings = bool(_SECRET_WARNINGS)
    return HealthResponse(
        status="degraded" if (not db_ok or has_warnings) else "ok",
        db=db_ok,
        uptime_seconds=int(time.time() - _START_TIME),
        platform_mode=_PLATFORM_MODE,
        circuit_breaker={
            "state": _circuit_state(),
            "consecutive_failures": _circuit["failures"],
            "tripped_at": _circuit["tripped_at"],
        },
        tenancy_hardened=_TENANCY_HARDENED,
        pricing_last_updated=PRICING_LAST_UPDATED,
        secret_warnings=_SECRET_WARNINGS,
    )

# ── Serve React frontend (production combined-server mode) ─────────────────
# In production the Render build step runs `npm run build` first, so
# dashboard/dist exists.  In dev it won't exist and this block is skipped,
# leaving Vite's dev server to proxy /api/* to this backend instead.
_DIST = os.path.normpath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "dashboard", "dist")
)
if os.path.isdir(_DIST):
    from fastapi.staticfiles import StaticFiles
    app.mount("/", StaticFiles(directory=_DIST, html=True), name="frontend")
