import os
import json
import asyncio
import time
from collections import OrderedDict
from typing import List

from fastapi import FastAPI, Depends, HTTPException, Query, Body, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

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
)
from app import telemetry as tel
from app import budget as bud
from app import policy as pol
from app import sessions as sess
from app.scanner import scan
from app.client import complete, chat_complete
from app.auth import hash_password, verify_password, create_token, get_current_user, require_admin, require_page_access, get_proxy_caller, generate_api_key, resolve_team_scope, is_deny_sentinel
from app.client import proxy_chat_complete, proxy_chat_stream, get_client_for_org, invalidate_org_client
from app.models import calculate_cost, Organization, ProviderCredential, encrypt_credential, decrypt_credential, Role as RoleModel, Team as TeamModel

Base.metadata.create_all(bind=engine)

# Run org migration on startup (idempotent — safe to call every boot)
from app.migrate_orgs import run as _run_org_migration
try:
    _run_org_migration()
except Exception as _e:
    import logging as _logging
    _logging.getLogger("aifinops").warning("Org migration warning (non-fatal): %s", _e)

# ── Seed built-in roles (idempotent — INSERT OR IGNORE pattern) ────────────────
_SEED_ROLES = [
    {
        "name": "admin",
        "label": "Admin",
        "color": "#FF5C7A",
        "pages": json.dumps(["home","chat","overview","cost","agents","models","workflows","alerts","budgets","security","users","apikeys","settings","integrations","onboarding"]),
        "can":   json.dumps(["view_all_sessions"]),
        "team_scoped": False,   # org-wide: admin sees all teams
    },
    {
        "name": "analyst",
        "label": "Analyst",
        "color": "#FFB547",
        "pages": json.dumps(["home","chat","overview","cost","agents","models","workflows","alerts","security","integrations","onboarding"]),
        "can":   json.dumps([]),
        "team_scoped": True,    # team-scoped: analyst sees only own team's data
    },
    {
        "name": "viewer",
        "label": "Viewer",
        "color": "#6FA8FF",
        "pages": json.dumps(["home","overview","cost","agents","models","workflows","alerts","security"]),
        "can":   json.dumps([]),
        "team_scoped": True,    # team-scoped: viewer sees only own team's data
    },
]

def _seed_roles_for_org(db, org_id: int) -> None:
    """Seed/migrate the 3 default roles for a single org. Insert-only for new rows;
    backfills team_scoped and pages on existing rows when those fields are stale."""
    for r in _SEED_ROLES:
        existing = db.query(RoleModel).filter(
            RoleModel.organization_id == org_id, RoleModel.name == r["name"]
        ).first()
        if not existing:
            db.add(RoleModel(organization_id=org_id, **r))
        else:
            # Migrate pages to match seed (adds new page IDs, fixes nulls/empties)
            try:
                raw = existing.pages
                pages = json.loads(raw) if isinstance(raw, str) else (raw or [])
            except Exception:
                pages = []
            seed_pages = json.loads(r["pages"])
            if set(seed_pages) != set(pages):
                existing.pages = r["pages"]
            # Backfill team_scoped if the column was just added (value will be None/False default).
            # We only force the seed value when the column is None (never set) — we do NOT
            # overwrite a value the admin has explicitly changed.
            if existing.team_scoped is None:
                existing.team_scoped = r["team_scoped"]
    db.commit()


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
    _logging.getLogger("aifinops").warning("Role seed warning (non-fatal): %s", _e)

_START_TIME = time.time()


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
_VALID_MODES = {"observe", "alert", "enforce"}

def _platform_default_mode() -> str:
    raw = os.getenv("GUARD_MODE", "").lower().strip()
    if raw in _VALID_MODES:
        return raw
    legacy = os.getenv("GATEWAY_FAIL_MODE", "closed").lower().strip()
    return "observe" if legacy == "open" else "enforce"

_PLATFORM_MODE = _platform_default_mode()


# ─── Tenancy gate ────────────────────────────────────────────────────────────
def require_tenancy_hardened():
    """Dependency: blocks dashboard read paths with 503 until the DB schema is
    hardened (organization_id NOT NULL on telemetry). Prevents cross-org leaks
    on un-migrated deployments."""
    if not _TENANCY_HARDENED:
        raise HTTPException(
            status_code=503,
            detail="Tenancy isolation not verified — run migrate_orgs.py before reading telemetry.",
        )


# ─── Caller identity helpers ──────────────────────────────────────────────────
# get_proxy_caller returns either a User object (JWT) or a dict (gk- API key).
# These pull team/name from whichever shape, so telemetry can fall back to the
# API key's own team/name when the X-Guard-* headers aren't sent.
def _caller_org_id(caller) -> int | None:
    if caller is None:
        return None
    return caller.get("organization_id") if isinstance(caller, dict) else getattr(caller, "organization_id", None)

def _caller_team(caller) -> str | None:
    if caller is None:
        return None
    return caller.get("team") if isinstance(caller, dict) else getattr(caller, "team", None)


def _register_team(db: Session, organization_id: int, team: str) -> None:
    """Idempotent insert of (organization_id, team) into the teams table.
    Skips blank/unknown teams — they don't represent real attribution entities.
    Called on every write path that accepts a team string."""
    if not team or team == "unknown":
        return
    if not db.query(TeamModel).filter(
        TeamModel.organization_id == organization_id,
        TeamModel.name == team,
    ).first():
        db.add(TeamModel(organization_id=organization_id, name=team))
        db.commit()


def _caller_name(caller) -> str | None:
    if caller is None:
        return None
    return caller.get("name") if isinstance(caller, dict) else getattr(caller, "name", None)


# ─── Circuit breaker (protects callers during enforcement outages) ────────────
_LLM_TIMEOUT      = float(os.getenv("GATEWAY_LLM_TIMEOUT_SECS", "30"))
_ENFORCE_TIMEOUT  = float(os.getenv("GATEWAY_ENFORCE_TIMEOUT_SECS", "5"))
_CB_THRESHOLD     = 5     # consecutive failures
_CB_WINDOW        = 60    # seconds
_circuit = {"failures": 0, "tripped_at": None, "first_failure_at": None}

def _circuit_state() -> str:
    if _circuit["tripped_at"] is None:
        return "closed"
    if time.time() - _circuit["tripped_at"] > _CB_WINDOW:
        _circuit["tripped_at"] = None
        _circuit["failures"] = 0
        _circuit["first_failure_at"] = None
        return "closed"
    return "open"

def _circuit_record_failure():
    now = time.time()
    if _circuit["first_failure_at"] is None or now - _circuit["first_failure_at"] > _CB_WINDOW:
        _circuit["first_failure_at"] = now
        _circuit["failures"] = 0
    _circuit["failures"] += 1
    if _circuit["failures"] >= _CB_THRESHOLD:
        _circuit["tripped_at"] = now

def _circuit_record_success():
    if _circuit["tripped_at"] is None:
        _circuit["failures"] = 0
        _circuit["first_failure_at"] = None


# ─── Login rate limiter (bounded LRU, per IP) ─────────────────────────────────
# Allows 5 attempts per 60 seconds per IP. Capped at 10 000 entries to prevent
# unbounded memory growth under distributed brute-force / port-scan conditions.
_RATE_LIMIT_MAX    = 5
_RATE_LIMIT_WINDOW = 60   # seconds
_RATE_LIMIT_CACHE_SIZE = 10_000
_login_attempts: OrderedDict = OrderedDict()

def _check_login_rate_limit(ip: str):
    now = time.time()
    window_start = now - _RATE_LIMIT_WINDOW
    attempts = [t for t in _login_attempts.get(ip, []) if t > window_start]
    if len(attempts) >= _RATE_LIMIT_MAX:
        retry_after = int(_RATE_LIMIT_WINDOW - (now - attempts[0]))
        raise HTTPException(
            status_code=429,
            detail=f"Too many login attempts. Try again in {retry_after} seconds.",
            headers={"Retry-After": str(retry_after)},
        )
    attempts.append(now)
    _login_attempts[ip] = attempts
    _login_attempts.move_to_end(ip)
    while len(_login_attempts) > _RATE_LIMIT_CACHE_SIZE:
        _login_attempts.popitem(last=False)


# ─── Startup seed ─────────────────────────────────────────────────────────────

def _seed_admin():
    from app.models import User
    db = next(get_db())
    try:
        if not db.query(User).filter(User.email == "admin@aifinops.local").first():
            seed_pw = os.getenv("ADMIN_SEED_PASSWORD", "Ch@ngeMe!FinOps2026#")
            db.add(User(
                email="admin@aifinops.local",
                name="Admin",
                hashed_password=hash_password(seed_pw),
                role="admin",
                team="Platform",
            ))
            db.commit()
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
    title="AIFinOps Guard",
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

_ALLOWED_ORIGINS = (
    [_FRONTEND_ORIGIN] if _FRONTEND_ORIGIN
    else ["http://localhost:5173", "http://127.0.0.1:5173"]
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Guard-Team", "X-Guard-Agent"],
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

@app.get("/", tags=["GET — Read / Monitor"])
def root():
    return {"status": "AIFinOps Gateway Running", "version": "0.5.0"}


# ─── Auth ─────────────────────────────────────────────────────────────────────

@app.post("/auth/login", response_model=TokenResponse, tags=["Auth — Users"])
def login(req: LoginRequest, request: Request, db: Session = Depends(get_db)):
    ip = request.client.host if request.client else "unknown"
    _check_login_rate_limit(ip)
    from app.models import User
    user = db.query(User).filter(User.email == req.email, User.is_active == True).first()  # noqa: E712
    if not user or not verify_password(req.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    return TokenResponse(access_token=create_token(user), user=UserOut.model_validate(user))


@app.get("/auth/me", response_model=UserOut, tags=["Auth — Users"])
async def me(current_user=Depends(get_current_user)):
    return current_user


@app.get("/auth/users", response_model=list[UserOut], tags=["Auth — Users"])
async def list_users(db: Session = Depends(get_db), actor=Depends(require_page_access("users"))):
    from app.models import User
    return db.query(User).filter(User.organization_id == actor.organization_id).order_by(User.created_at).all()


@app.post("/auth/users", response_model=UserOut, status_code=201, tags=["Auth — Users"])
async def create_user(req: UserCreate, db: Session = Depends(get_db), actor=Depends(require_page_access("users"))):
    from app.models import User
    if db.query(User).filter(User.email == req.email).first():
        raise HTTPException(status_code=409, detail="Email already registered")
    if not db.query(RoleModel).filter(RoleModel.organization_id == actor.organization_id, RoleModel.name == req.role).first():
        raise HTTPException(status_code=422, detail=f"Role '{req.role}' does not exist. Create it in Settings → Roles first.")
    user = User(
        email=req.email,
        name=req.name,
        hashed_password=hash_password(req.password),
        role=req.role,
        team=req.team,
        organization_id=actor.organization_id,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    _register_team(db, actor.organization_id, req.team)
    return user


@app.patch("/auth/users/{user_id}", response_model=UserOut, tags=["Auth — Users"])
async def update_user(user_id: int, req: UserUpdate, db: Session = Depends(get_db), actor=Depends(require_page_access("users"))):
    from app.models import User
    user = db.query(User).filter(User.id == user_id, User.organization_id == actor.organization_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    updates = req.model_dump(exclude_none=True)
    if "password" in updates:
        current_pw = updates.pop("current_password", None)
        if not current_pw or not verify_password(current_pw, user.hashed_password):
            raise HTTPException(status_code=400, detail="Current password is incorrect")
        updates["hashed_password"] = hash_password(updates.pop("password"))
    else:
        updates.pop("current_password", None)
    # Validate new role exists in DB before applying
    if "role" in updates and not db.query(RoleModel).filter(RoleModel.organization_id == actor.organization_id, RoleModel.name == updates["role"]).first():
        raise HTTPException(status_code=422, detail=f"Role '{updates['role']}' does not exist.")
    # Audit privilege changes as a security event (H-1)
    if "role" in updates and updates["role"] != user.role:
        import logging
        logging.getLogger("aifinops.security").warning(
            "ROLE CHANGE: actor=%s(id=%s) changed user=%s(id=%s) role %s -> %s",
            actor.email, actor.id, user.email, user.id, user.role, updates["role"],
        )
    for field, value in updates.items():
        setattr(user, field, value)
    db.commit()
    db.refresh(user)
    return user


@app.delete("/auth/users/{user_id}", status_code=204, tags=["Auth — Users"])
async def delete_user(user_id: int, db: Session = Depends(get_db), current_user=Depends(require_page_access("users"))):
    from app.models import User
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")
    user = db.query(User).filter(User.id == user_id, User.organization_id == current_user.organization_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    db.delete(user)
    db.commit()


# ─── Role management ─────────────────────────────────────────────────────────

@app.get("/roles", response_model=list[RoleOut], tags=["Roles"])
async def list_roles(db: Session = Depends(get_db), actor=Depends(get_current_user)):
    """Return roles for the caller's org. Any authenticated user can read this (needed for dropdowns)."""
    roles = db.query(RoleModel).filter(
        RoleModel.organization_id == actor.organization_id
    ).order_by(RoleModel.name).all()
    return [
        RoleOut(
            name=r.name,
            label=r.label,
            color=r.color,
            pages=json.loads(r.pages or "[]"),
            can=json.loads(r.can or "[]"),
            team_scoped=bool(r.team_scoped),
        )
        for r in roles
    ]


@app.get("/teams", response_model=list[TeamOut], tags=["Teams"])
async def list_teams(db: Session = Depends(get_db), actor=Depends(get_current_user)):
    """Return teams registered in the caller's org."""
    teams = db.query(TeamModel).filter(
        TeamModel.organization_id == actor.organization_id
    ).order_by(TeamModel.name).all()
    return teams


@app.post("/roles", response_model=RoleOut, status_code=201, tags=["Roles"])
async def create_role(req: RoleCreate, db: Session = Depends(get_db), actor=Depends(require_admin)):
    if db.query(RoleModel).filter(
        RoleModel.organization_id == actor.organization_id, RoleModel.name == req.name
    ).first():
        raise HTTPException(status_code=409, detail=f"Role '{req.name}' already exists")
    role = RoleModel(
        organization_id=actor.organization_id,
        name=req.name,
        label=req.label,
        color=req.color,
        pages=json.dumps(req.pages),
        can=json.dumps(req.can),
        team_scoped=req.team_scoped,
    )
    db.add(role)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail=f"Role '{req.name}' already exists (DB constraint: {exc.orig})")
    db.refresh(role)
    return RoleOut(name=role.name, label=role.label, color=role.color,
                   pages=json.loads(role.pages or "[]"), can=json.loads(role.can or "[]"),
                   team_scoped=bool(role.team_scoped))


_ADMIN_REQUIRED_PAGES = frozenset({"settings", "users"})  # admin must always keep these

@app.patch("/roles/{role_name}", response_model=RoleOut, tags=["Roles"])
async def update_role(role_name: str, req: RoleUpdate, db: Session = Depends(get_db), actor=Depends(require_admin)):
    role = db.query(RoleModel).filter(
        RoleModel.organization_id == actor.organization_id, RoleModel.name == role_name
    ).first()
    if not role:
        raise HTTPException(status_code=404, detail=f"Role '{role_name}' not found")
    if req.label is not None:
        role.label = req.label
    if req.color is not None:
        role.color = req.color
    if req.pages is not None:
        if role_name == "admin":
            missing = _ADMIN_REQUIRED_PAGES - set(req.pages)
            if missing:
                raise HTTPException(
                    status_code=400,
                    detail=f"Cannot remove required pages from admin role: {sorted(missing)}. "
                           "Removing these would lock all admins out of role/user management.",
                )
        role.pages = json.dumps(req.pages)
    if req.can is not None:
        role.can = json.dumps(req.can)
    if req.team_scoped is not None:
        role.team_scoped = req.team_scoped
    db.commit()
    db.refresh(role)
    return RoleOut(name=role.name, label=role.label, color=role.color,
                   pages=json.loads(role.pages or "[]"), can=json.loads(role.can or "[]"),
                   team_scoped=bool(role.team_scoped))


@app.delete("/roles/{role_name}", status_code=204, tags=["Roles"])
async def delete_role(role_name: str, db: Session = Depends(get_db), actor=Depends(require_admin)):
    if role_name == "admin":
        raise HTTPException(status_code=400, detail="Cannot delete the admin role")
    role = db.query(RoleModel).filter(
        RoleModel.organization_id == actor.organization_id, RoleModel.name == role_name
    ).first()
    if not role:
        raise HTTPException(status_code=404, detail=f"Role '{role_name}' not found")
    from app.models import User
    if db.query(User).filter(
        User.organization_id == actor.organization_id, User.role == role_name
    ).first():
        raise HTTPException(status_code=409, detail=f"Cannot delete role '{role_name}' — users are assigned to it")
    db.delete(role)
    db.commit()


# ─── API Key management ───────────────────────────────────────────────────────

@app.post("/api-keys", response_model=ApiKeyCreated, status_code=201, tags=["Auth — Users"])
async def create_api_key(req: ApiKeyCreate, db: Session = Depends(get_db), actor=Depends(require_page_access("apikeys"))):
    from app.models import ApiKey
    # organization_id comes from the creating admin's org — never from the request body.
    # A null org here would produce a key that hard-401s on first use, which is the
    # exact null-org state the migration exists to prevent.
    if actor.organization_id is None:
        raise HTTPException(status_code=500, detail="Admin account has no organization assigned. Contact your administrator.")
    full_key, key_prefix, key_hash = generate_api_key()
    record = ApiKey(
        name=req.name,
        key_prefix=key_prefix,
        key_hash=key_hash,
        team=req.team,
        organization_id=actor.organization_id,
        created_by_id=actor.id,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    _register_team(db, actor.organization_id, req.team)
    import logging
    logging.getLogger("aifinops.security").info(
        "API key created: id=%s name=%s team=%s org=%s by=%s",
        record.id, record.name, record.team, record.organization_id, actor.email,
    )
    # Return full key — shown exactly once, never retrievable again
    return ApiKeyCreated(
        id=record.id, name=record.name, key_prefix=record.key_prefix,
        team=record.team, created_by_id=record.created_by_id,
        created_at=record.created_at, last_used_at=record.last_used_at,
        is_active=record.is_active, key=full_key,
    )


@app.get("/api-keys", response_model=list[ApiKeyOut], tags=["Auth — Users"])
async def list_api_keys(db: Session = Depends(get_db), actor=Depends(require_page_access("apikeys"))):
    from app.models import ApiKey
    return db.query(ApiKey).filter(ApiKey.organization_id == actor.organization_id).order_by(ApiKey.created_at.desc()).all()


@app.patch("/api-keys/{key_id}", response_model=ApiKeyOut, tags=["Auth — Users"])
async def update_api_key(
    key_id: int,
    is_active: bool = Body(..., embed=True),
    db: Session = Depends(get_db),
    actor=Depends(require_page_access("apikeys")),
):
    from app.models import ApiKey
    key = db.query(ApiKey).filter(ApiKey.id == key_id, ApiKey.organization_id == actor.organization_id).first()
    if not key:
        raise HTTPException(status_code=404, detail="API key not found")
    key.is_active = is_active
    db.commit()
    db.refresh(key)
    import logging
    action = "enabled" if is_active else "revoked"
    logging.getLogger("aifinops.security").info(
        "API key %s: id=%s name=%s by=%s", action, key.id, key.name, actor.email
    )
    return key


@app.delete("/api-keys/{key_id}", status_code=204, tags=["Auth — Users"])
async def delete_api_key(key_id: int, db: Session = Depends(get_db), actor=Depends(require_page_access("apikeys"))):
    from app.models import ApiKey
    key = db.query(ApiKey).filter(ApiKey.id == key_id, ApiKey.organization_id == actor.organization_id).first()
    if not key:
        raise HTTPException(status_code=404, detail="API key not found")
    import logging
    logging.getLogger("aifinops.security").info(
        "API key deleted: id=%s name=%s by=%s", key.id, key.name, actor.email
    )
    db.delete(key)
    db.commit()


# ─── Provider credentials (BYOK — per-org encrypted keys) ────────────────────

@app.get("/provider-credentials", tags=["Auth — Users"])
def list_provider_credentials(
    db: Session = Depends(get_db),
    actor=Depends(require_page_access("settings")),
):
    """List provider credentials for the caller's org. Returns last4 only — never the key."""
    creds = db.query(ProviderCredential).filter(
        ProviderCredential.organization_id == actor.organization_id
    ).all()
    return [
        {
            "id":       c.id,
            "provider": c.provider,
            "last4":    c.last4,
            "base_url": c.base_url,
            "is_active": c.is_active,
            "updated_at": c.updated_at.isoformat(),
        }
        for c in creds
    ]


@app.post("/provider-credentials", status_code=201, tags=["Auth — Users"])
def upsert_provider_credential(
    body: dict = Body(...),
    db: Session = Depends(get_db),
    actor=Depends(require_page_access("settings")),
):
    """
    Add or update a provider API key for the caller's org.
    The plaintext key is encrypted immediately and never stored.
    Validates the key with a cheap test call before saving.
    """
    provider = body.get("provider", "").lower()
    raw_key  = body.get("key", "").strip()
    base_url = body.get("base_url")

    if provider not in ("openai", "anthropic", "google", "local"):
        raise HTTPException(status_code=400, detail="provider must be openai|anthropic|google|local")
    if not raw_key:
        raise HTTPException(status_code=400, detail="key is required")

    # Validate the key with a minimal test call before storing
    import asyncio as _asyncio
    from app.client import _provider_for, _validate_local_url
    from openai import AsyncOpenAI as _AsyncOpenAI

    async def _validate():
        timeout = 10.0
        if provider == "openai":
            c = _AsyncOpenAI(api_key=raw_key, timeout=timeout)
        elif provider == "anthropic":
            c = _AsyncOpenAI(api_key=raw_key, base_url="https://api.anthropic.com/v1", timeout=timeout)
        elif provider == "google":
            c = _AsyncOpenAI(api_key=raw_key, base_url="https://generativelanguage.googleapis.com/v1beta/openai", timeout=timeout)
        else:  # local
            burl = _validate_local_url(base_url or "http://localhost:11434/v1")
            c = _AsyncOpenAI(api_key="local", base_url=burl, timeout=timeout)
        test_model = {"openai": "gpt-4o-mini", "anthropic": "claude-haiku-4-5", "google": "gemini-2.0-flash", "local": "llama-3.1-8b-local"}[provider]
        await c.chat.completions.create(
            model=test_model,
            messages=[{"role": "user", "content": "hi"}],
            max_tokens=1,
        )

    try:
        _asyncio.run(_validate())
    except Exception as exc:
        # Scrub the raw upstream error — it can contain rate-limit details,
        # org identifiers, or other provider internals the caller shouldn't see.
        msg = str(exc).lower()
        if "incorrect api key" in msg or "invalid api key" in msg or "unauthorized" in msg or "401" in msg:
            reason = "key was rejected as invalid or inactive"
        elif "rate limit" in msg or "429" in msg:
            reason = "rate limit hit during validation — wait a moment and try again"
        elif "quota" in msg or "402" in msg or "insufficient" in msg:
            reason = "account quota exceeded or billing issue on this key"
        elif "timeout" in msg or "connect" in msg:
            reason = "could not reach the provider — check network or base_url"
        else:
            reason = "provider returned an error — check the key is correct and active"
        raise HTTPException(status_code=422, detail=f"Key validation failed: {reason}")

    enc   = encrypt_credential(raw_key)
    last4 = raw_key[-4:] if len(raw_key) >= 4 else raw_key

    existing = db.query(ProviderCredential).filter(
        ProviderCredential.organization_id == actor.organization_id,
        ProviderCredential.provider == provider,
    ).first()

    if existing:
        existing.encrypted_key = enc
        existing.last4         = last4
        existing.base_url      = base_url
        existing.is_active     = True
        invalidate_org_client(actor.organization_id, provider)
        import logging; logging.getLogger("aifinops").info(
            "Provider credential updated: org=%s provider=%s by=%s", actor.organization_id, provider, actor.email
        )
    else:
        db.add(ProviderCredential(
            organization_id=actor.organization_id,
            provider=provider,
            encrypted_key=enc,
            last4=last4,
            base_url=base_url,
        ))
        import logging; logging.getLogger("aifinops").info(
            "Provider credential created: org=%s provider=%s by=%s", actor.organization_id, provider, actor.email
        )

    db.commit()
    return {"provider": provider, "last4": last4, "status": "saved"}


@app.delete("/provider-credentials/{provider}", status_code=204, tags=["Auth — Users"])
def delete_provider_credential(
    provider: str,
    db: Session = Depends(get_db),
    actor=Depends(require_page_access("settings")),
):
    cred = db.query(ProviderCredential).filter(
        ProviderCredential.organization_id == actor.organization_id,
        ProviderCredential.provider == provider,
    ).first()
    if not cred:
        raise HTTPException(status_code=404, detail="No credential found for this provider")
    db.delete(cred)
    db.commit()
    invalidate_org_client(actor.organization_id, provider)


# ─── Guard modes (per-team governance) ────────────────────────────────────────

@app.get("/guard-modes", response_model=list[GuardModeOut], tags=["GET — Read / Monitor"])
def list_guard_modes(db: Session = Depends(get_db), actor=Depends(require_page_access("settings"))):
    """
    One row per team that appears in this org's telemetry, showing its effective mode,
    whether it's an explicit override, and how many requests would have been
    blocked in the last 30 days (shadow-block preview).
    """
    from app.models import GuardMode, Telemetry, Team as TeamModel, ApiKey as ApiKeyModel
    from sqlalchemy import text as _sqla_text
    # Fetch guard-mode overrides — fall back to unfiltered if organization_id column is missing
    try:
        overrides = {g.team: g for g in db.query(GuardMode).filter(
            GuardMode.organization_id == actor.organization_id
        ).all()}
    except Exception:
        try:
            overrides = {g.team: g for g in db.query(GuardMode).all()}
        except Exception:
            overrides = {}
    shadow = tel.would_block_counts(db, days=30, organization_id=actor.organization_id)
    # Union of: telemetry teams + override teams + registered teams + api_key teams
    teams = set(shadow.keys()) | set(overrides.keys())
    try:
        teams |= {r[0] for r in db.query(Telemetry.team).filter(
            Telemetry.organization_id == actor.organization_id
        ).distinct().all()}
    except Exception:
        pass
    try:
        teams |= {r[0] for r in db.query(TeamModel.name).filter(
            TeamModel.organization_id == actor.organization_id
        ).all()}
    except Exception:
        pass  # teams table may be missing organization_id in old DBs — fall through
    # Always include teams from api_keys directly (covers pre-migration DBs)
    try:
        teams |= {r[0] for r in db.query(ApiKeyModel.team).filter(
            ApiKeyModel.organization_id == actor.organization_id,
            ApiKeyModel.team.isnot(None), ApiKeyModel.team != "", ApiKeyModel.team != "unknown",
            ApiKeyModel.is_active == True,  # noqa: E712
        ).distinct().all()}
    except Exception:
        # Fall back to unfiltered api_key query if organization_id column missing
        try:
            teams |= {r[0] for r in db.query(ApiKeyModel.team).filter(
                ApiKeyModel.team.isnot(None), ApiKeyModel.team != "", ApiKeyModel.team != "unknown",
                ApiKeyModel.is_active == True,  # noqa: E712
            ).distinct().all()}
        except Exception:
            pass
    out = []
    for team in sorted(t for t in teams if t):
        ov = overrides.get(team)
        out.append(GuardModeOut(
            team=team,
            mode=ov.mode if ov else _PLATFORM_MODE,
            is_override=ov is not None,
            would_block_30d=shadow.get(team, 0),
            updated_at=ov.updated_at if ov else None,
        ))
    return out


@app.put("/guard-modes/{team}", response_model=GuardModeOut, tags=["POST — Ask / Create"])
def set_guard_mode(team: str, req: GuardModeUpdate, db: Session = Depends(get_db), actor=Depends(require_page_access("settings"))):
    """
    Set a team's guard mode. mode="default" removes the override so the team
    falls back to the platform default. Every change is written to the audit log.
    """
    from app.models import GuardMode
    org_id = actor.organization_id
    old = db.query(GuardMode).filter(
        GuardMode.organization_id == org_id, GuardMode.team == team
    ).first()
    old_mode = old.mode if old else f"default({_PLATFORM_MODE})"

    if req.mode == "default":
        if old:
            db.delete(old)
            db.commit()
        new_mode = f"default({_PLATFORM_MODE})"
        effective = _PLATFORM_MODE
        is_override = False
        updated_at = None
    else:
        if old:
            old.mode = req.mode
            old.updated_by_id = actor.id
        else:
            db.add(GuardMode(organization_id=org_id, team=team,
                             mode=req.mode, updated_by_id=actor.id))
        db.commit()
        row = db.query(GuardMode).filter(
            GuardMode.organization_id == org_id, GuardMode.team == team
        ).first()
        new_mode = req.mode
        effective = req.mode
        is_override = True
        updated_at = row.updated_at

    # Audit: server log + dashboard-visible governance row
    import logging
    logging.getLogger("aifinops.security").warning(
        "GUARD MODE: team=%s %s -> %s by=%s", team, old_mode, new_mode, actor.email
    )
    tel.save_blocked(
        db, team=team, agent="guard-mode", model="-",
        prompt=f"Guard mode change by {actor.email}",
        reason=f"GUARD_MODE: team '{team}' {old_mode} → {new_mode} by {actor.email}",
        organization_id=org_id,
    )

    shadow = tel.would_block_counts(db, days=30, organization_id=org_id)
    return GuardModeOut(team=team, mode=effective, is_override=is_override,
                        would_block_30d=shadow.get(team, 0), updated_at=updated_at)


# ─── Health ───────────────────────────────────────────────────────────────────

@app.get("/health", response_model=HealthResponse, tags=["GET — Read / Monitor"])
def health(db: Session = Depends(get_db)):
    """Liveness + readiness. Public — customers use this for their own fallback logic."""
    db_ok = True
    try:
        from sqlalchemy import text
        db.execute(text("SELECT 1"))
    except Exception:
        db_ok = False
    return HealthResponse(
        status="ok" if db_ok else "degraded",
        db=db_ok,
        uptime_seconds=int(time.time() - _START_TIME),
        platform_mode=_PLATFORM_MODE,
        circuit_breaker={
            "state": _circuit_state(),
            "consecutive_failures": _circuit["failures"],
            "tripped_at": _circuit["tripped_at"],
        },
        tenancy_hardened=_TENANCY_HARDENED,
    )


# ─── AI Gateway ───────────────────────────────────────────────────────────────

@app.post("/ask", response_model=AskResponse, tags=["POST — Ask / Create"])
async def ask(req: AskRequest, db: Session = Depends(get_db), current_user=Depends(get_current_user)):

    # 1. PII / sensitive data scan
    scan_result = scan(req.prompt)
    findings_list = scan_result.to_dict()
    if len(req.prompt) > 40_000:
        findings_list.append({"type": "large_prompt", "severity": "warning",
                               "sample": f"{len(req.prompt):,} chars"})

    # 2. Policy enforcement — model allowlist / blocklist
    policy_check = pol.check_model(db, organization_id=organization_id, team=req.team, model=req.model)
    if not policy_check["allowed"]:
        _shadow_or_block_inline(db, team=req.team, agent=req.agent, model=req.model,
                                prompt=req.prompt, reason=policy_check["reason"], status=403,
                                scan_result=scan_result, findings_list=findings_list,
                                organization_id=current_user.organization_id)

    # 3. Budget enforcement
    budget_check = bud.check(db, organization_id=current_user.organization_id, team=req.team, agent=req.agent)
    if not budget_check["allowed"]:
        blk = budget_check["blocked_by"]
        reason = (
            f"Budget limit exceeded for team '{blk['team']}'"
            + (f", agent '{blk['agent']}'" if blk["agent"] else "")
            + f": ${blk['spend']:.4f} spent of ${blk['limit']:.2f} {blk['period']} limit."
        )
        _shadow_or_block_inline(db, team=req.team, agent=req.agent, model=req.model,
                                prompt=req.prompt, reason=reason, status=429,
                                scan_result=scan_result, findings_list=findings_list,
                                organization_id=current_user.organization_id)

    # 4. Call LLM
    try:
        result = await complete(
            prompt=req.prompt,
            model=req.model,
            system_prompt=req.system_prompt,
        )
    except RuntimeError as exc:
        import logging; logging.getLogger("aifinops").error("Service error", exc_info=True); raise HTTPException(status_code=503, detail="Service temporarily unavailable. Please try again.")
    except Exception as exc:
        import logging; logging.getLogger("aifinops").error("LLM error", exc_info=True); raise HTTPException(status_code=502, detail="Upstream LLM error. Please try again.")

    # 5. Persist telemetry
    record = tel.save(
        db=db, team=req.team, agent=req.agent, prompt=req.prompt, result=result,
        sensitive=scan_result.is_sensitive, sensitive_findings=findings_list,
        organization_id=current_user.organization_id,
    )

    # 6. Attach to existing session or auto-create one
    target_uuid = req.session_uuid
    if target_uuid:
        s = sess.get_session(db, target_uuid)
        if not (s and s.is_active):
            target_uuid = None  # session gone — fall through to auto-create

    if not target_uuid:
        new_session = sess.create_session(
            db, user_name=req.agent, user_role="analyst",
            team=req.team, agent=req.agent, model=req.model,
        )
        target_uuid = new_session.session_uuid

    sess.add_message(db, session_uuid=target_uuid,
                     role="user", content=req.prompt)
    sess.add_message(db, session_uuid=target_uuid,
                     role="assistant", content=result.content,
                     prompt_tokens=result.prompt_tokens,
                     completion_tokens=result.completion_tokens,
                     cost_usd=record.cost_usd, latency_ms=result.latency_ms,
                     security_findings=findings_list,
                     budget_warnings=budget_check["warnings"])

    return AskResponse(
        response=result.content,
        model=result.model,
        prompt_tokens=result.prompt_tokens,
        completion_tokens=result.completion_tokens,
        total_tokens=result.total_tokens,
        latency_ms=result.latency_ms,
        cost_usd=record.cost_usd,
        telemetry_id=record.id,
        session_uuid=target_uuid,
        budget_warnings=budget_check["warnings"],
        security_findings=findings_list,
    )


# ─── Multi-turn Chat ─────────────────────────────────────────────────────────

@app.post("/chat", response_model=ChatResponse, tags=["POST — Ask / Create"])
async def chat(req: ChatRequest, db: Session = Depends(get_db), current_user=Depends(get_current_user)):

    # Scan the latest user message only
    last_user = next((m.content for m in reversed(req.messages) if m.role == "user"), "")
    scan_result  = scan(last_user)
    findings_list = scan_result.to_dict()
    total_chars = sum(len(m.content or "") for m in req.messages)
    if total_chars > 40_000:
        findings_list.append({"type": "large_prompt", "severity": "warning",
                               "sample": f"{total_chars:,} chars across {len(req.messages)} messages"})

    # Policy check
    policy_check = pol.check_model(db, organization_id=current_user.organization_id, team=req.team, model=req.model)
    if not policy_check["allowed"]:
        _shadow_or_block_inline(db, team=req.team, agent=req.agent, model=req.model,
                                prompt=last_user, reason=policy_check["reason"], status=403,
                                scan_result=scan_result, findings_list=findings_list)

    # Budget check
    budget_check = bud.check(db, organization_id=current_user.organization_id, team=req.team, agent=req.agent)
    if not budget_check["allowed"]:
        blk = budget_check["blocked_by"]
        reason = (f"Budget limit exceeded for team '{blk['team']}': "
                  f"${blk['spend']:.4f} of ${blk['limit']:.2f} {blk['period']} limit.")
        _shadow_or_block_inline(db, team=req.team, agent=req.agent, model=req.model,
                                prompt=last_user, reason=reason, status=429,
                                scan_result=scan_result, findings_list=findings_list,
                                organization_id=current_user.organization_id)

    # Build messages list — prepend system prompt if given
    messages = []
    if req.system_prompt:
        messages.append({"role": "system", "content": req.system_prompt})
    messages += [{"role": m.role, "content": m.content} for m in req.messages]

    try:
        result = await chat_complete(messages=messages, model=req.model)
    except RuntimeError as exc:
        import logging; logging.getLogger("aifinops").error("Service error", exc_info=True); raise HTTPException(status_code=503, detail="Service temporarily unavailable. Please try again.")
    except Exception as exc:
        import logging; logging.getLogger("aifinops").error("LLM error", exc_info=True); raise HTTPException(status_code=502, detail="Upstream LLM error. Please try again.")

    record = tel.save(db=db, team=req.team, agent=req.agent, prompt=last_user,
                      result=result, sensitive=scan_result.is_sensitive,
                      sensitive_findings=findings_list,
                      organization_id=current_user.organization_id)

    return ChatResponse(
        reply=result.content,
        model=result.model,
        prompt_tokens=result.prompt_tokens,
        completion_tokens=result.completion_tokens,
        total_tokens=result.total_tokens,
        latency_ms=result.latency_ms,
        cost_usd=record.cost_usd,
        telemetry_id=record.id,
        security_findings=findings_list,
        budget_warnings=budget_check["warnings"],
    )


# ─── Telemetry ────────────────────────────────────────────────────────────────

def _redact_sensitive_records(records, user):
    """
    For non-admin users, blank out the prompt/response text of any record
    flagged sensitive. Admins see everything; analysts/viewers see metadata
    only for records that contain PII or secrets.
    """
    if getattr(user, "role", None) == "admin":
        return records
    from types import SimpleNamespace
    out = []
    for r in records:
        if getattr(r, "sensitive", False):
            data = {c.name: getattr(r, c.name) for c in r.__table__.columns}
            data["prompt"] = "[redacted — sensitive, admin only]"
            data["response"] = "[redacted — sensitive, admin only]"
            out.append(SimpleNamespace(**data))
        else:
            out.append(r)
    return out


@app.get("/telemetry", response_model=list[TelemetryRecord], tags=["GET — Read / Monitor"])
def get_telemetry(
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=1000),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
    _: None = Depends(require_tenancy_hardened),
):
    ts = resolve_team_scope(current_user, db)
    if is_deny_sentinel(ts):
        return []
    return _redact_sensitive_records(
        tel.get_all(db, organization_id=current_user.organization_id, skip=skip, limit=limit, team_scope=ts),
        current_user,
    )


@app.get("/telemetry/summary", response_model=TelemetrySummary, tags=["GET — Read / Monitor"])
def get_summary(db: Session = Depends(get_db), current_user=Depends(get_current_user), _: None = Depends(require_tenancy_hardened)):
    ts = resolve_team_scope(current_user, db)
    if is_deny_sentinel(ts):
        from app.schemas import TelemetrySummary as _TS
        return _TS(total_requests=0, total_tokens=0, total_cost_usd=0.0,
                   avg_latency_ms=0.0, models_used=[], teams=[])
    return tel.get_summary(db, organization_id=current_user.organization_id, team_scope=ts)


# ─── Audit log ────────────────────────────────────────────────────────────────

@app.get("/audit", response_model=list[TelemetryRecord], tags=["GET — Read / Monitor"])
def get_audit(
    team: str | None = Query(default=None),
    agent: str | None = Query(default=None),
    sensitive_only: bool = Query(default=False),
    blocked_only: bool = Query(default=False),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=1000),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
    _: None = Depends(require_tenancy_hardened),
):
    ts = resolve_team_scope(current_user, db)
    if is_deny_sentinel(ts):
        return []
    records = tel.get_audit(
        db, organization_id=current_user.organization_id,
        team=team, agent=agent,
        sensitive_only=sensitive_only, blocked_only=blocked_only,
        skip=skip, limit=limit, team_scope=ts,
    )
    return _redact_sensitive_records(records, current_user)


# ─── Security ─────────────────────────────────────────────────────────────────

@app.post("/security/scan", response_model=ScanResponse, tags=["POST — Ask / Create"])
def security_scan(req: ScanRequest, _=Depends(get_current_user)):
    result = scan(req.text)
    return ScanResponse(
        is_sensitive=result.is_sensitive,
        findings=[ScanFinding(type=f.type, severity=f.severity, sample=f.sample)
                  for f in result.findings],
    )


@app.get("/security/alerts", tags=["GET — Read / Monitor"])
def security_alerts(db: Session = Depends(get_db), current_user=Depends(get_current_user), _: None = Depends(require_tenancy_hardened)):
    ts = resolve_team_scope(current_user, db)
    if is_deny_sentinel(ts):
        return []
    return tel.get_security_alerts(db, organization_id=current_user.organization_id, team_scope=ts)


# ─── Budgets ──────────────────────────────────────────────────────────────────

@app.post("/budgets", response_model=BudgetRuleOut, status_code=201, tags=["POST — Ask / Create"])
def create_budget(rule: BudgetRuleCreate, db: Session = Depends(get_db), actor=Depends(require_page_access("budgets"))):
    ts = resolve_team_scope(actor, db)
    if is_deny_sentinel(ts):
        raise HTTPException(status_code=403, detail="No team assigned — cannot create budget rules")
    # Team-scoped users can only create rules for their own team
    effective_team = ts if ts is not None else rule.team
    if ts is not None and rule.team != ts:
        raise HTTPException(status_code=403, detail=f"Team-scoped role may only create rules for team '{ts}'")
    return bud.create_rule(db, organization_id=actor.organization_id, team=effective_team,
                           agent=rule.agent, limit_usd=rule.limit_usd, period=rule.period, action=rule.action)


@app.get("/budgets", response_model=list[BudgetRuleOut], tags=["GET — Read / Monitor"])
def list_budgets(db: Session = Depends(get_db), actor=Depends(get_current_user)):
    ts = resolve_team_scope(actor, db)
    if is_deny_sentinel(ts):
        return []
    return bud.get_rules(db, organization_id=actor.organization_id, team_scope=ts)


@app.delete("/budgets/{rule_id}", status_code=204, tags=["DELETE — Remove"])
def delete_budget(rule_id: int, db: Session = Depends(get_db), actor=Depends(require_page_access("budgets"))):
    ts = resolve_team_scope(actor, db)
    if is_deny_sentinel(ts):
        raise HTTPException(status_code=404, detail="Budget rule not found")
    if not bud.delete_rule(db, rule_id, organization_id=actor.organization_id, team_scope=ts):
        raise HTTPException(status_code=404, detail="Budget rule not found")


@app.get("/budgets/status", response_model=list[BudgetStatusItem], tags=["GET — Read / Monitor"])
def budget_status(db: Session = Depends(get_db), actor=Depends(get_current_user)):
    ts = resolve_team_scope(actor, db)
    if is_deny_sentinel(ts):
        return []
    return bud.get_status(db, organization_id=actor.organization_id, team_scope=ts)


# ─── Chat Sessions ────────────────────────────────────────────────────────────

def _assert_session_owner(s, current_user):
    """Non-admin users can only access their own sessions."""
    if current_user.role != "admin" and s.user_name != current_user.name:
        raise HTTPException(status_code=403, detail="Access denied")


@app.post("/sessions", response_model=SessionOut, status_code=201, tags=["POST — Ask / Create"])
def create_session(req: SessionCreate, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    sess.expire_inactive(db)
    return sess.create_session(
        db, user_name=current_user.name, user_role=current_user.role,
        team=req.team, agent=req.agent, model=req.model,
    )


@app.get("/sessions", response_model=list[SessionOut], tags=["GET — Read / Monitor"])
def list_sessions(active_only: bool = Query(default=True), db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    sess.expire_inactive(db)
    return sess.list_sessions(db, active_only=active_only)


@app.get("/sessions/{session_uuid}", response_model=SessionOut, tags=["GET — Read / Monitor"])
def get_session_by_uuid(session_uuid: str, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    s = sess.get_session(db, session_uuid)
    if not s:
        raise HTTPException(status_code=404, detail="Session not found")
    _assert_session_owner(s, current_user)
    return s


@app.delete("/sessions/{session_uuid}", status_code=204, tags=["DELETE — Remove"])
def close_session(session_uuid: str, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    s = sess.get_session(db, session_uuid)
    if not s:
        raise HTTPException(status_code=404, detail="Session not found")
    _assert_session_owner(s, current_user)
    sess.close_session(db, session_uuid)


@app.get("/sessions/{session_uuid}/messages", response_model=list[SessionMessageOut], tags=["GET — Read / Monitor"])
def get_session_messages(session_uuid: str, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    s = sess.get_session(db, session_uuid)
    if not s:
        raise HTTPException(status_code=404, detail="Session not found")
    _assert_session_owner(s, current_user)
    return sess.get_messages(db, session_uuid)


@app.post("/sessions/{session_uuid}/chat", response_model=ChatResponse, tags=["POST — Ask / Create"])
async def session_chat(session_uuid: str, req: SessionChatRequest, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    # Verify session exists, is active, and belongs to the requesting user
    s = sess.get_session(db, session_uuid)
    if not s:
        raise HTTPException(status_code=404, detail="Session not found")
    _assert_session_owner(s, current_user)
    if not s.is_active:
        raise HTTPException(status_code=410, detail="Session has been closed or timed out")
    # Only admins may supply a custom system prompt
    if req.system_prompt and current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Only admins may set a system prompt")

    # Scan last user message
    last_user = next((m.content for m in reversed(req.messages) if m.role == "user"), "")
    scan_result = scan(last_user)
    findings_list = scan_result.to_dict()
    total_chars = sum(len(m.content or "") for m in req.messages)
    if total_chars > 40_000:
        findings_list.append({"type": "large_prompt", "severity": "warning",
                               "sample": f"{total_chars:,} chars across {len(req.messages)} messages"})

    # Policy check
    policy_check = pol.check_model(db, organization_id=current_user.organization_id, team=req.team, model=req.model)
    if not policy_check["allowed"]:
        _shadow_or_block_inline(db, team=req.team, agent=req.agent, model=req.model,
                                prompt=last_user, reason=policy_check["reason"], status=403,
                                scan_result=scan_result, findings_list=findings_list)

    # Budget check
    budget_check = bud.check(db, organization_id=current_user.organization_id, team=req.team, agent=req.agent)
    if not budget_check["allowed"]:
        blk = budget_check["blocked_by"]
        reason = (f"Budget limit exceeded for team '{blk['team']}': "
                  f"${blk['spend']:.4f} of ${blk['limit']:.2f} {blk['period']} limit.")
        _shadow_or_block_inline(db, team=req.team, agent=req.agent, model=req.model,
                                prompt=last_user, reason=reason, status=429,
                                scan_result=scan_result, findings_list=findings_list,
                                organization_id=current_user.organization_id)

    # Build messages list
    messages = []
    if req.system_prompt:
        messages.append({"role": "system", "content": req.system_prompt})
    messages += [{"role": m.role, "content": m.content} for m in req.messages]

    try:
        result = await chat_complete(messages=messages, model=req.model)
    except RuntimeError as exc:
        import logging; logging.getLogger("aifinops").error("Service error", exc_info=True); raise HTTPException(status_code=503, detail="Service temporarily unavailable. Please try again.")
    except Exception as exc:
        import logging; logging.getLogger("aifinops").error("LLM error", exc_info=True); raise HTTPException(status_code=502, detail="Upstream LLM error. Please try again.")

    record = tel.save(db=db, team=req.team, agent=req.agent, prompt=last_user,
                      result=result, sensitive=scan_result.is_sensitive,
                      sensitive_findings=findings_list,
                      organization_id=current_user.organization_id)

    # Persist user message + assistant reply in session
    sess.add_message(db, session_uuid=session_uuid, role="user", content=last_user)
    sess.add_message(
        db, session_uuid=session_uuid, role="assistant", content=result.content,
        prompt_tokens=result.prompt_tokens, completion_tokens=result.completion_tokens,
        cost_usd=record.cost_usd, latency_ms=result.latency_ms,
        security_findings=findings_list, budget_warnings=budget_check["warnings"],
    )

    return ChatResponse(
        reply=result.content,
        model=result.model,
        prompt_tokens=result.prompt_tokens,
        completion_tokens=result.completion_tokens,
        total_tokens=result.total_tokens,
        latency_ms=result.latency_ms,
        cost_usd=record.cost_usd,
        telemetry_id=record.id,
        security_findings=findings_list,
        budget_warnings=budget_check["warnings"],
    )


# ─── Policies ─────────────────────────────────────────────────────────────────

@app.post("/policies", response_model=PolicyRuleOut, status_code=201, tags=["POST — Ask / Create"])
def create_policy(rule: PolicyRuleCreate, db: Session = Depends(get_db), actor=Depends(require_page_access("settings"))):
    ts = resolve_team_scope(actor, db)
    if is_deny_sentinel(ts):
        raise HTTPException(status_code=403, detail="No team assigned — cannot create policy rules")
    if ts is not None and rule.team != ts:
        raise HTTPException(status_code=403, detail=f"Team-scoped role may only create rules for team '{ts}'")
    return pol.create_rule(db, organization_id=actor.organization_id, team=rule.team, rule_type=rule.rule_type, value=rule.value)


@app.get("/policies", response_model=list[PolicyRuleOut], tags=["GET — Read / Monitor"])
def list_policies(db: Session = Depends(get_db), actor=Depends(get_current_user)):
    ts = resolve_team_scope(actor, db)
    if is_deny_sentinel(ts):
        return []
    return pol.get_rules(db, organization_id=actor.organization_id, team_scope=ts)


@app.delete("/policies/{rule_id}", status_code=204, tags=["DELETE — Remove"])
def delete_policy(rule_id: int, db: Session = Depends(get_db), actor=Depends(require_page_access("settings"))):
    ts = resolve_team_scope(actor, db)
    if is_deny_sentinel(ts):
        raise HTTPException(status_code=404, detail="Policy rule not found")
    if not pol.delete_rule(db, rule_id, organization_id=actor.organization_id, team_scope=ts):
        raise HTTPException(status_code=404, detail="Policy rule not found")


# ─── Settings / API Keys ──────────────────────────────────────────────────────

_ENV_FILE = os.path.join(os.path.dirname(os.path.dirname(__file__)), ".env")

_KEY_DEFINITIONS = [
    {
        "key": "OPENAI_API_KEY",
        "provider": "OpenAI",
        "placeholder": "your-openai-api-key-here",
    },
    {
        "key": "ANTHROPIC_API_KEY",
        "provider": "Anthropic",
        "placeholder": "your-anthropic-api-key-here",
    },
    {
        "key": "GOOGLE_API_KEY",
        "provider": "Google",
        "placeholder": "your-google-api-key-here",
    },
    {
        "key": "LOCAL_LLM_URL",
        "provider": "Local LLM",
        "placeholder": "http://localhost:11434/v1",
    },
    {
        "key": "JWT_SECRET",
        "provider": "Auth",
        "placeholder": "change-me-in-production-use-a-long-random-string-32chars",
    },
]


class KeyStatus(BaseModel):
    key: str
    provider: str
    configured: bool
    placeholder: bool


class KeyUpdateRequest(BaseModel):
    key: str
    value: str


@app.get("/settings/keys", response_model=List[KeyStatus], tags=["Auth — Users"])
def get_key_statuses(_=Depends(require_page_access("settings"))):
    """Return the configuration status of each provider API key (admin only). Never exposes actual values."""
    result = []
    for defn in _KEY_DEFINITIONS:
        env_val = os.environ.get(defn["key"], "")
        configured = bool(env_val)
        is_placeholder = env_val == defn["placeholder"]
        result.append(KeyStatus(
            key=defn["key"],
            provider=defn["provider"],
            configured=configured,
            placeholder=is_placeholder,
        ))
    return result


@app.patch("/settings/keys", tags=["Auth — Users"])
def update_key(req: KeyUpdateRequest, _=Depends(require_page_access("settings"))):
    """Write or update a provider API key in the .env file (admin only). The value is stored in the project root .env."""
    from dotenv import set_key, find_dotenv

    _PROTECTED_KEYS = {"JWT_SECRET"}
    valid_keys = {d["key"] for d in _KEY_DEFINITIONS} - _PROTECTED_KEYS
    if req.key not in valid_keys:
        raise HTTPException(status_code=400, detail=f"Unknown or protected key '{req.key}'. Valid keys: {sorted(valid_keys)}")

    env_path = _ENV_FILE
    # Create .env if it doesn't exist
    if not os.path.exists(env_path):
        open(env_path, "a").close()

    set_key(env_path, req.key, req.value)
    os.environ[req.key] = req.value
    # Invalidate the cached LLM clients so they pick up the new key on next call
    from app.client import _clients
    _clients.clear()

    return {"key": req.key, "updated": True}


# ─── OpenAI-Compatible Proxy (/v1/chat/completions) ──────────────────────────
#
# Agents point their openai SDK at this server:
#   client = openai.OpenAI(base_url="http://your-server/v1", api_key="<jwt>")
#
# Team and agent attribution via headers:
#   X-Guard-Team:  <team name>   (defaults to "unknown")
#   X-Guard-Agent: <agent name>  (defaults to "unknown")
#
# Fail mode (set GATEWAY_FAIL_MODE=open in .env to pass requests through on error):
#   closed (default) — any gateway error blocks the request
#   open             — enforcement errors are logged but the request passes through

from fastapi import Request as FastAPIRequest
import uuid as _uuid_mod
import time as _time_mod

def _resolve_guard_mode(db: Session, team: str, organization_id: int | None = None) -> str:
    """Effective mode for a team within an org: explicit override if present, else platform default."""
    from app.models import GuardMode
    try:
        q = db.query(GuardMode).filter(GuardMode.team == team)
        if organization_id is not None:
            q = q.filter(GuardMode.organization_id == organization_id)
        row = q.first()
        if row and row.mode in _VALID_MODES:
            return row.mode
    except Exception:
        pass
    return _PLATFORM_MODE


def _shadow_or_block_inline(db, *, team, agent, model, prompt, reason, status,
                            scan_result, findings_list, organization_id=None):
    """
    Mode-aware block used by /ask and /chat inline enforcement.
    enforce → save_blocked + raise; observe/alert → append would_block finding.
    """
    mode = _resolve_guard_mode(db, team, organization_id=organization_id)
    if mode == "enforce":
        tel.save_blocked(db, team=team, agent=agent, model=model, prompt=prompt,
                         reason=reason, sensitive=scan_result.is_sensitive,
                         sensitive_findings=findings_list, organization_id=organization_id)
        raise HTTPException(status_code=status, detail=reason)
    findings_list.append({"type": "would_block", "severity": "warning",
                          "sample": f"WOULD BLOCK in enforce mode ({status}): {reason}"})


async def _run_enforcement_pipeline(
    db: Session, team: str, agent: str, model: str, messages: list, organization_id: int | None = None
):
    """
    Mode-aware enforcement. ALWAYS evaluates PII scan → policy → budget so the
    dashboard can show shadow blocks ("would block in enforce mode"). Only the
    `enforce` mode actually blocks; observe/alert record a would_block finding
    and let the request proceed.

    Returns (last_user, scan_result, findings_list, policy_check, budget_check, large_prompt).
    Raises HTTPException only in enforce mode.
    """
    mode = _resolve_guard_mode(db, team)
    last_user = next((m["content"] for m in reversed(messages) if m.get("role") == "user"), "")
    total_chars = sum(len(m.get("content", "") or "") for m in messages)

    scan_result   = scan(last_user)
    findings_list = scan_result.to_dict()

    # Large prompts: warn only — budget handles the cost
    LARGE_PROMPT_CHARS = 40_000  # ~10k tokens
    large_prompt = total_chars > LARGE_PROMPT_CHARS
    if large_prompt:
        findings_list.append({
            "type": "large_prompt", "severity": "warning",
            "sample": f"{total_chars:,} chars across {len(messages)} messages",
        })

    def _shadow_or_block(reason: str, status: int):
        """In enforce mode: save_blocked + raise. Otherwise: record would_block finding."""
        if mode == "enforce":
            tel.save_blocked(db, team=team, agent=agent, model=model,
                             prompt=last_user, reason=reason,
                             sensitive=scan_result.is_sensitive, sensitive_findings=findings_list,
                             organization_id=organization_id)
            raise HTTPException(status_code=status, detail=reason)
        findings_list.append({
            "type": "would_block", "severity": "warning",
            "sample": f"WOULD BLOCK in enforce mode ({status}): {reason}",
        })

    policy_check = pol.check_model(db, organization_id=organization_id, team=team, model=model)
    if not policy_check["allowed"]:
        _shadow_or_block(policy_check["reason"], 403)

    budget_check = bud.check(db, organization_id=organization_id, team=team, agent=agent)
    if not budget_check["allowed"]:
        blk = budget_check["blocked_by"]
        reason = (
            f"Budget limit exceeded for team '{blk['team']}': "
            f"${blk['spend']:.4f} of ${blk['limit']:.2f} {blk['period']} limit."
        )
        _shadow_or_block(reason, 429)

    return last_user, scan_result, findings_list, policy_check, budget_check, large_prompt


def _handle_enforcement_error(db: Session, team: str, findings_list: list,
                              organization_id: int | None = None):
    """
    Called when the enforcement pipeline itself throws (DB down, scanner crash).
    Records a circuit-breaker failure. If the breaker is open, OR the team's mode
    is not enforce, the request is allowed through (fail-open) with a logged
    critical bypass finding. In enforce mode with the breaker closed, raises 503.
    """
    import logging
    _circuit_record_failure()
    breaker_open = _circuit_state() == "open"
    mode = _resolve_guard_mode(db, team, organization_id=organization_id)
    if mode == "enforce" and not breaker_open:
        logging.getLogger("aifinops").error("Enforcement error (enforce mode)", exc_info=True)
        raise HTTPException(status_code=503, detail="Gateway enforcement error. Please try again.")
    # Fail-open path — never silent
    why = "circuit breaker OPEN" if breaker_open else f"{mode} mode"
    logging.getLogger("aifinops").error("FAIL-OPEN BYPASS (%s): enforcement error swallowed", why, exc_info=True)
    findings_list.append({"type": "enforcement_bypass", "severity": "critical",
                          "sample": f"fail-open ({why}) swallowed an enforcement error"})



@app.post("/v1/chat/completions", tags=["POST — Ask / Create"])
async def openai_compat_chat(
    request: FastAPIRequest,
    db: Session = Depends(get_db),
    current_user=Depends(get_proxy_caller),
):
    """
    OpenAI-compatible chat completions endpoint.

    Accepts any Bearer token — either a dashboard JWT or an opaque gateway key.
    Forwards the **entire request body** to the upstream provider so tool_calls,
    temperature, response_format, seed, etc. all pass through unchanged.

    Full enforcement pipeline: PII scan → policy → budget → LLM → telemetry.

    Headers:
    - `X-Guard-Team`:  team name for cost attribution and policy lookup
    - `X-Guard-Agent`: agent name for telemetry

    Fail mode (`GATEWAY_FAIL_MODE` env var):
    - `closed` (default) — enforcement errors block the request
    - `open` — enforcement errors are logged but the request passes through
    """
    body  = await request.json()
    model    = body.get("model", "gpt-4o-mini")
    messages = body.get("messages", [])
    stream   = body.pop("stream", False)  # pop so body can be forwarded cleanly

    team  = request.headers.get("X-Guard-Team")  or _caller_team(current_user) or "unknown"
    agent = request.headers.get("X-Guard-Agent") or _caller_name(current_user) or "unknown"

    # Resolve the org's provider client. Hard 401 if org_id is missing (should
    # have been caught by get_proxy_caller, but never trust that implicitly).
    # Hard 402 if the org has no credential for this provider.
    org_id = _caller_org_id(current_user)
    if org_id is None:
        raise HTTPException(status_code=401, detail="No organization resolved for this credential")
    org_client = get_client_for_org(org_id, model, db)
    _register_team(db, org_id, team)

    # Enforcement pipeline
    last_user = ""
    findings_list = []
    budget_warnings = []
    scan_result = None
    try:
        last_user, scan_result, findings_list, _, budget_check, _ = \
            await _run_enforcement_pipeline(db, team, agent, model, messages, organization_id=org_id)
        budget_warnings = budget_check["warnings"]
        _circuit_record_success()
    except HTTPException:
        raise
    except Exception:
        _handle_enforcement_error(db, team, findings_list, organization_id=org_id)

    # ── Streaming ──────────────────────────────────────────────────────────────
    if stream:
        async def relay():
            usage_data = None
            t0 = _time_mod.perf_counter()
            async for item in proxy_chat_stream(body, request=request, org_client=org_client):
                if isinstance(item, dict) and "_guard_usage" in item:
                    usage_data = item["_guard_usage"]
                    usage_data["latency_ms"] = round((_time_mod.perf_counter() - t0) * 1000, 2)
                else:
                    yield item

            # Persist telemetry once stream completes
            if usage_data:
                from app.client import CompletionResult as CR
                tel.save(
                    db=db, team=team, agent=agent, prompt=last_user,
                    result=CR(
                        content="",
                        model=usage_data.get("model", model),
                        prompt_tokens=usage_data["prompt_tokens"],
                        completion_tokens=usage_data["completion_tokens"],
                        total_tokens=usage_data["total_tokens"],
                        latency_ms=usage_data["latency_ms"],
                    ),
                    sensitive=(scan_result.is_sensitive if scan_result else False),
                    sensitive_findings=findings_list,
                    organization_id=org_id,
                )

        return StreamingResponse(
            relay(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    # ── Non-streaming — forward entire body ───────────────────────────────────
    try:
        resp_dict = await proxy_chat_complete(body, org_client=org_client)
    except RuntimeError as exc:
        import logging; logging.getLogger("aifinops").error("Service error", exc_info=True); raise HTTPException(status_code=503, detail="Service temporarily unavailable. Please try again.")
    except Exception as exc:
        import logging; logging.getLogger("aifinops").error("LLM error", exc_info=True); raise HTTPException(status_code=502, detail="Upstream LLM error. Please try again.")

    latency_ms = resp_dict.pop("_latency_ms", 0.0)
    usage      = resp_dict.get("usage", {})
    pt = usage.get("prompt_tokens", 0)
    ct = usage.get("completion_tokens", 0)
    resp_model = resp_dict.get("model", model)

    # Persist telemetry
    from app.client import CompletionResult as CR
    content = ""
    choices = resp_dict.get("choices", [])
    if choices:
        content = (choices[0].get("message") or {}).get("content") or ""
    tel.save(
        db=db, team=team, agent=agent, prompt=last_user,
        result=CR(content=content, model=resp_model,
                  prompt_tokens=pt, completion_tokens=ct, total_tokens=pt + ct,
                  latency_ms=latency_ms),
        sensitive=(scan_result.is_sensitive if scan_result else False),
        sensitive_findings=findings_list,
        organization_id=org_id,
    )

    resp_dict["x_guard"] = {
        "team":              team,
        "agent":             agent,
        "cost_usd":          calculate_cost(resp_model, pt, ct),
        "latency_ms":        latency_ms,
        "policy_warnings":   budget_warnings,
        "security_findings": findings_list,
    }
    return resp_dict


# ─── Anthropic-Compatible Proxy (/v1/messages) ───────────────────────────────
#
# Teams using the Anthropic SDK directly point here:
#   import anthropic
#   client = anthropic.Anthropic(base_url="http://your-server", api_key="<jwt>")
#
# The endpoint accepts the standard Anthropic Messages API shape and returns
# the standard Anthropic response shape, so existing code needs no changes.

@app.post("/v1/messages", tags=["POST — Ask / Create"])
async def anthropic_compat_messages(
    request: FastAPIRequest,
    db: Session = Depends(get_db),
    current_user=Depends(get_proxy_caller),
):
    """
    Anthropic-compatible Messages API endpoint.

    Teams using the Anthropic SDK point here:
    ```python
    import anthropic
    client = anthropic.Anthropic(base_url="http://your-server", api_key="<token>")
    ```

    Accepts the standard Anthropic request shape and returns the standard
    Anthropic response shape, including SSE streaming.

    Note: only text-mode content blocks are supported; image/tool_use blocks
    are passed through but not scanned for PII.

    Full enforcement pipeline: PII scan → policy → budget → LLM → telemetry.

    Headers:
    - `X-Guard-Team`:  team name for cost attribution
    - `X-Guard-Agent`: agent name for telemetry
    """
    body  = await request.json()
    model    = body.get("model", "claude-haiku-4-5")
    system   = body.get("system", None)
    stream   = body.get("stream", False)

    # Transcode Anthropic messages → OpenAI format for enforcement scanning only
    # (the actual LLM call uses proxy_chat_complete which forwards the body as-is
    #  via OpenAI's Anthropic-compat endpoint, so structure is preserved)
    raw_messages = body.get("messages", [])
    oai_messages: list[dict] = []
    if system:
        oai_messages.append({"role": "system", "content": system if isinstance(system, str) else str(system)})
    for m in raw_messages:
        content = m.get("content", "")
        if isinstance(content, list):
            text_parts = [b.get("text", "") for b in content if isinstance(b, dict) and b.get("type") == "text"]
            content = " ".join(text_parts)
        oai_messages.append({"role": m["role"], "content": content})

    team  = request.headers.get("X-Guard-Team")  or _caller_team(current_user) or "unknown"
    agent = request.headers.get("X-Guard-Agent") or _caller_name(current_user) or "unknown"

    org_id = _caller_org_id(current_user)
    if org_id is None:
        raise HTTPException(status_code=401, detail="No organization resolved for this credential")
    org_client = get_client_for_org(org_id, model, db)
    _register_team(db, org_id, team)

    # Enforcement
    last_user = ""
    findings_list = []
    budget_warnings = []
    scan_result = None
    try:
        last_user, scan_result, findings_list, _, budget_check, _ = \
            await _run_enforcement_pipeline(db, team, agent, model, oai_messages, organization_id=org_id)
        budget_warnings = budget_check["warnings"]
        _circuit_record_success()
    except HTTPException:
        raise
    except Exception:
        _handle_enforcement_error(db, team, findings_list, organization_id=org_id)

    msg_id  = f"msg_guard_{_uuid_mod.uuid4().hex[:12]}"
    created = int(_time_mod.time())

    # Build the OpenAI-compat body to forward (Anthropic provider via OpenAI client)
    oai_body = {
        "model":    model,
        "messages": oai_messages,
        "max_tokens": body.get("max_tokens", 1024),
    }
    if body.get("temperature") is not None:
        oai_body["temperature"] = body["temperature"]
    if body.get("stop_sequences"):
        oai_body["stop"] = body["stop_sequences"]

    # ── Streaming ──────────────────────────────────────────────────────────────
    if stream:
        async def anthropic_relay():
            # Send message_start before first content
            yield f"event: message_start\ndata: {json.dumps({'type':'message_start','message':{'id':msg_id,'type':'message','role':'assistant','content':[],'model':model,'stop_reason':None,'stop_sequence':None,'usage':{'input_tokens':0,'output_tokens':0}}})}\n\n"
            yield f"event: content_block_start\ndata: {json.dumps({'type':'content_block_start','index':0,'content_block':{'type':'text','text':''}})}\n\n"

            usage_data = None
            t0 = _time_mod.perf_counter()
            async for item in proxy_chat_stream(oai_body, request=request, org_client=org_client):
                if isinstance(item, dict) and "_guard_usage" in item:
                    usage_data = item["_guard_usage"]
                    usage_data["latency_ms"] = round((_time_mod.perf_counter() - t0) * 1000, 2)
                    continue
                # item is an SSE string like "data: {...}\n\n" — extract the content delta
                if item.startswith("data: ") and item.strip() != "data: [DONE]":
                    try:
                        chunk = json.loads(item[6:])
                        delta_content = ""
                        for ch in chunk.get("choices", []):
                            delta_content += (ch.get("delta") or {}).get("content") or ""
                        if delta_content:
                            yield f"event: content_block_delta\ndata: {json.dumps({'type':'content_block_delta','index':0,'delta':{'type':'text_delta','text':delta_content}})}\n\n"
                    except Exception:
                        pass

            yield f"event: content_block_stop\ndata: {json.dumps({'type':'content_block_stop','index':0})}\n\n"
            out_tokens = (usage_data or {}).get("completion_tokens", 0)
            in_tokens  = (usage_data or {}).get("prompt_tokens", 0)
            yield f"event: message_delta\ndata: {json.dumps({'type':'message_delta','delta':{'stop_reason':'end_turn','stop_sequence':None},'usage':{'output_tokens':out_tokens}})}\n\n"
            yield f"event: message_stop\ndata: {json.dumps({'type':'message_stop'})}\n\n"

            if usage_data:
                from app.client import CompletionResult as CR
                tel.save(
                    db=db, team=team, agent=agent, prompt=last_user,
                    result=CR(content="", model=usage_data.get("model", model),
                               prompt_tokens=in_tokens, completion_tokens=out_tokens,
                               total_tokens=in_tokens + out_tokens,
                               latency_ms=usage_data["latency_ms"]),
                    sensitive=(scan_result.is_sensitive if scan_result else False),
                    sensitive_findings=findings_list,
                    organization_id=org_id,
                )

        return StreamingResponse(
            anthropic_relay(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    # ── Non-streaming ─────────────────────────────────────────────────────────
    try:
        resp_dict = await proxy_chat_complete(oai_body, org_client=org_client)
    except RuntimeError as exc:
        import logging; logging.getLogger("aifinops").error("Service error", exc_info=True); raise HTTPException(status_code=503, detail="Service temporarily unavailable. Please try again.")
    except Exception as exc:
        import logging; logging.getLogger("aifinops").error("LLM error", exc_info=True); raise HTTPException(status_code=502, detail="Upstream LLM error. Please try again.")

    latency_ms = resp_dict.pop("_latency_ms", 0.0)
    usage      = resp_dict.get("usage", {})
    pt = usage.get("prompt_tokens", 0)
    ct = usage.get("completion_tokens", 0)
    resp_model = resp_dict.get("model", model)
    content    = ""
    choices    = resp_dict.get("choices", [])
    if choices:
        content = (choices[0].get("message") or {}).get("content") or ""

    from app.client import CompletionResult as CR
    tel.save(
        db=db, team=team, agent=agent, prompt=last_user,
        result=CR(content=content, model=resp_model,
                  prompt_tokens=pt, completion_tokens=ct, total_tokens=pt + ct,
                  latency_ms=latency_ms),
        sensitive=(scan_result.is_sensitive if scan_result else False),
        sensitive_findings=findings_list,
        organization_id=org_id,
    )

    return {
        "id":            msg_id,
        "type":          "message",
        "role":          "assistant",
        "content":       [{"type": "text", "text": content}],
        "model":         resp_model,
        "stop_reason":   "end_turn",
        "stop_sequence": None,
        "usage": {
            "input_tokens":  pt,
            "output_tokens": ct,
        },
        "x_guard": {
            "team":              team,
            "agent":             agent,
            "cost_usd":          calculate_cost(resp_model, pt, ct),
            "latency_ms":        latency_ms,
            "policy_warnings":   budget_warnings,
            "security_findings": findings_list,
        },
    }
