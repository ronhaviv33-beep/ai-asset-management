import os
import json
import asyncio
from typing import List, AsyncIterator

from fastapi import FastAPI, Depends, HTTPException, Query, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

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
)
from app import telemetry as tel
from app import budget as bud
from app import policy as pol
from app import sessions as sess
from app.scanner import scan
from app.client import complete, chat_complete
from app.auth import hash_password, verify_password, create_token, get_current_user, require_admin

Base.metadata.create_all(bind=engine)


# ─── Startup seed ─────────────────────────────────────────────────────────────

def _seed_admin():
    from app.models import User
    db = next(get_db())
    try:
        if not db.query(User).filter(User.email == "admin@aifinops.local").first():
            db.add(User(
                email="admin@aifinops.local",
                name="Admin",
                hashed_password=hash_password("Admin123!"),
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

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── Health ───────────────────────────────────────────────────────────────────

@app.get("/", tags=["GET — Read / Monitor"])
def root():
    return {"status": "AIFinOps Gateway Running", "version": "0.5.0"}


# ─── Auth ─────────────────────────────────────────────────────────────────────

@app.post("/auth/login", response_model=TokenResponse, tags=["Auth — Users"])
def login(req: LoginRequest, db: Session = Depends(get_db)):
    from app.models import User
    user = db.query(User).filter(User.email == req.email, User.is_active == True).first()  # noqa: E712
    if not user or not verify_password(req.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    return TokenResponse(access_token=create_token(user), user=UserOut.model_validate(user))


@app.get("/auth/me", response_model=UserOut, tags=["Auth — Users"])
async def me(current_user=Depends(get_current_user)):
    return current_user


@app.get("/auth/users", response_model=list[UserOut], tags=["Auth — Users"])
async def list_users(db: Session = Depends(get_db), _=Depends(require_admin)):
    from app.models import User
    return db.query(User).order_by(User.created_at).all()


@app.post("/auth/users", response_model=UserOut, status_code=201, tags=["Auth — Users"])
async def create_user(req: UserCreate, db: Session = Depends(get_db), _=Depends(require_admin)):
    from app.models import User
    if db.query(User).filter(User.email == req.email).first():
        raise HTTPException(status_code=409, detail="Email already registered")
    user = User(
        email=req.email,
        name=req.name,
        hashed_password=hash_password(req.password),
        role=req.role,
        team=req.team,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@app.patch("/auth/users/{user_id}", response_model=UserOut, tags=["Auth — Users"])
async def update_user(user_id: int, req: UserUpdate, db: Session = Depends(get_db), _=Depends(require_admin)):
    from app.models import User
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    for field, value in req.model_dump(exclude_none=True).items():
        setattr(user, field, value)
    db.commit()
    db.refresh(user)
    return user


@app.delete("/auth/users/{user_id}", status_code=204, tags=["Auth — Users"])
async def delete_user(user_id: int, db: Session = Depends(get_db), current_user=Depends(require_admin)):
    from app.models import User
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    db.delete(user)
    db.commit()


# ─── AI Gateway ───────────────────────────────────────────────────────────────

@app.post("/ask", response_model=AskResponse, tags=["POST — Ask / Create"])
async def ask(req: AskRequest, db: Session = Depends(get_db), _=Depends(get_current_user)):

    # 1. PII / sensitive data scan
    scan_result = scan(req.prompt)
    findings_list = scan_result.to_dict()

    # 2. Policy enforcement — model allowlist / blocklist
    policy_check = pol.check_model(db, team=req.team, model=req.model)
    if not policy_check["allowed"]:
        tel.save_blocked(
            db, team=req.team, agent=req.agent, model=req.model,
            prompt=req.prompt, reason=policy_check["reason"],
            sensitive=scan_result.is_sensitive, sensitive_findings=findings_list,
        )
        raise HTTPException(status_code=403, detail=policy_check["reason"])

    # 3. Budget enforcement
    budget_check = bud.check(db, team=req.team, agent=req.agent)
    if not budget_check["allowed"]:
        blk = budget_check["blocked_by"]
        reason = (
            f"Budget limit exceeded for team '{blk['team']}'"
            + (f", agent '{blk['agent']}'" if blk["agent"] else "")
            + f": ${blk['spend']:.4f} spent of ${blk['limit']:.2f} {blk['period']} limit."
        )
        tel.save_blocked(
            db, team=req.team, agent=req.agent, model=req.model,
            prompt=req.prompt, reason=reason,
            sensitive=scan_result.is_sensitive, sensitive_findings=findings_list,
        )
        raise HTTPException(status_code=429, detail=reason)

    # 4. Call LLM
    try:
        result = await complete(
            prompt=req.prompt,
            model=req.model,
            system_prompt=req.system_prompt,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"LLM error: {exc}")

    # 5. Persist telemetry
    record = tel.save(
        db=db, team=req.team, agent=req.agent, prompt=req.prompt, result=result,
        sensitive=scan_result.is_sensitive, sensitive_findings=findings_list,
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
async def chat(req: ChatRequest, db: Session = Depends(get_db), _=Depends(get_current_user)):

    # Scan the latest user message only
    last_user = next((m.content for m in reversed(req.messages) if m.role == "user"), "")
    scan_result  = scan(last_user)
    findings_list = scan_result.to_dict()

    # Policy check
    policy_check = pol.check_model(db, team=req.team, model=req.model)
    if not policy_check["allowed"]:
        tel.save_blocked(db, team=req.team, agent=req.agent, model=req.model,
                         prompt=last_user, reason=policy_check["reason"],
                         sensitive=scan_result.is_sensitive, sensitive_findings=findings_list)
        raise HTTPException(status_code=403, detail=policy_check["reason"])

    # Budget check
    budget_check = bud.check(db, team=req.team, agent=req.agent)
    if not budget_check["allowed"]:
        blk = budget_check["blocked_by"]
        reason = (f"Budget limit exceeded for team '{blk['team']}': "
                  f"${blk['spend']:.4f} of ${blk['limit']:.2f} {blk['period']} limit.")
        tel.save_blocked(db, team=req.team, agent=req.agent, model=req.model,
                         prompt=last_user, reason=reason,
                         sensitive=scan_result.is_sensitive, sensitive_findings=findings_list)
        raise HTTPException(status_code=429, detail=reason)

    # Build messages list — prepend system prompt if given
    messages = []
    if req.system_prompt:
        messages.append({"role": "system", "content": req.system_prompt})
    messages += [{"role": m.role, "content": m.content} for m in req.messages]

    try:
        result = await chat_complete(messages=messages, model=req.model)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"LLM error: {exc}")

    record = tel.save(db=db, team=req.team, agent=req.agent, prompt=last_user,
                      result=result, sensitive=scan_result.is_sensitive,
                      sensitive_findings=findings_list)

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

@app.get("/telemetry", response_model=list[TelemetryRecord], tags=["GET — Read / Monitor"])
def get_telemetry(
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=1000),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    return tel.get_all(db, skip=skip, limit=limit)


@app.get("/telemetry/summary", response_model=TelemetrySummary, tags=["GET — Read / Monitor"])
def get_summary(db: Session = Depends(get_db), _=Depends(get_current_user)):
    return tel.get_summary(db)


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
    _=Depends(get_current_user),
):
    return tel.get_audit(db, team=team, agent=agent,
                         sensitive_only=sensitive_only, blocked_only=blocked_only,
                         skip=skip, limit=limit)


# ─── Security ─────────────────────────────────────────────────────────────────

@app.post("/security/scan", response_model=ScanResponse, tags=["POST — Ask / Create"])
def security_scan(req: ScanRequest):
    result = scan(req.text)
    return ScanResponse(
        is_sensitive=result.is_sensitive,
        findings=[ScanFinding(type=f.type, severity=f.severity, sample=f.sample)
                  for f in result.findings],
    )


@app.get("/security/alerts", tags=["GET — Read / Monitor"])
def security_alerts(db: Session = Depends(get_db), _=Depends(get_current_user)):
    return tel.get_security_alerts(db)


# ─── Budgets ──────────────────────────────────────────────────────────────────

@app.post("/budgets", response_model=BudgetRuleOut, status_code=201, tags=["POST — Ask / Create"])
def create_budget(rule: BudgetRuleCreate, db: Session = Depends(get_db), _=Depends(require_admin)):
    return bud.create_rule(db, team=rule.team, agent=rule.agent,
                           limit_usd=rule.limit_usd, period=rule.period, action=rule.action)


@app.get("/budgets", response_model=list[BudgetRuleOut], tags=["GET — Read / Monitor"])
def list_budgets(db: Session = Depends(get_db), _=Depends(get_current_user)):
    return bud.get_rules(db)


@app.delete("/budgets/{rule_id}", status_code=204, tags=["DELETE — Remove"])
def delete_budget(rule_id: int, db: Session = Depends(get_db), _=Depends(require_admin)):
    if not bud.delete_rule(db, rule_id):
        raise HTTPException(status_code=404, detail="Budget rule not found")


@app.get("/budgets/status", response_model=list[BudgetStatusItem], tags=["GET — Read / Monitor"])
def budget_status(db: Session = Depends(get_db), _=Depends(get_current_user)):
    return bud.get_status(db)


# ─── Chat Sessions ────────────────────────────────────────────────────────────

@app.post("/sessions", response_model=SessionOut, status_code=201, tags=["POST — Ask / Create"])
def create_session(req: SessionCreate, db: Session = Depends(get_db), _=Depends(get_current_user)):
    sess.expire_inactive(db)
    return sess.create_session(
        db, user_name=req.user_name, user_role=req.user_role,
        team=req.team, agent=req.agent, model=req.model,
    )


@app.get("/sessions", response_model=list[SessionOut], tags=["GET — Read / Monitor"])
def list_sessions(active_only: bool = Query(default=True), db: Session = Depends(get_db), _=Depends(get_current_user)):
    sess.expire_inactive(db)
    return sess.list_sessions(db, active_only=active_only)


@app.get("/sessions/{session_uuid}", response_model=SessionOut, tags=["GET — Read / Monitor"])
def get_session_by_uuid(session_uuid: str, db: Session = Depends(get_db), _=Depends(get_current_user)):
    s = sess.get_session(db, session_uuid)
    if not s:
        raise HTTPException(status_code=404, detail="Session not found")
    return s


@app.delete("/sessions/{session_uuid}", status_code=204, tags=["DELETE — Remove"])
def close_session(session_uuid: str, db: Session = Depends(get_db), _=Depends(get_current_user)):
    if not sess.close_session(db, session_uuid):
        raise HTTPException(status_code=404, detail="Session not found")


@app.get("/sessions/{session_uuid}/messages", response_model=list[SessionMessageOut], tags=["GET — Read / Monitor"])
def get_session_messages(session_uuid: str, db: Session = Depends(get_db), _=Depends(get_current_user)):
    s = sess.get_session(db, session_uuid)
    if not s:
        raise HTTPException(status_code=404, detail="Session not found")
    return sess.get_messages(db, session_uuid)


@app.post("/sessions/{session_uuid}/chat", response_model=ChatResponse, tags=["POST — Ask / Create"])
async def session_chat(session_uuid: str, req: SessionChatRequest, db: Session = Depends(get_db), _=Depends(get_current_user)):
    # Verify session exists and is active
    s = sess.get_session(db, session_uuid)
    if not s:
        raise HTTPException(status_code=404, detail="Session not found")
    if not s.is_active:
        raise HTTPException(status_code=410, detail="Session has been closed or timed out")

    # Scan last user message
    last_user = next((m.content for m in reversed(req.messages) if m.role == "user"), "")
    scan_result = scan(last_user)
    findings_list = scan_result.to_dict()

    # Policy check
    policy_check = pol.check_model(db, team=req.team, model=req.model)
    if not policy_check["allowed"]:
        tel.save_blocked(db, team=req.team, agent=req.agent, model=req.model,
                         prompt=last_user, reason=policy_check["reason"],
                         sensitive=scan_result.is_sensitive, sensitive_findings=findings_list)
        raise HTTPException(status_code=403, detail=policy_check["reason"])

    # Budget check
    budget_check = bud.check(db, team=req.team, agent=req.agent)
    if not budget_check["allowed"]:
        blk = budget_check["blocked_by"]
        reason = (f"Budget limit exceeded for team '{blk['team']}': "
                  f"${blk['spend']:.4f} of ${blk['limit']:.2f} {blk['period']} limit.")
        tel.save_blocked(db, team=req.team, agent=req.agent, model=req.model,
                         prompt=last_user, reason=reason,
                         sensitive=scan_result.is_sensitive, sensitive_findings=findings_list)
        raise HTTPException(status_code=429, detail=reason)

    # Build messages list
    messages = []
    if req.system_prompt:
        messages.append({"role": "system", "content": req.system_prompt})
    messages += [{"role": m.role, "content": m.content} for m in req.messages]

    try:
        result = await chat_complete(messages=messages, model=req.model)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"LLM error: {exc}")

    record = tel.save(db=db, team=req.team, agent=req.agent, prompt=last_user,
                      result=result, sensitive=scan_result.is_sensitive,
                      sensitive_findings=findings_list)

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
def create_policy(rule: PolicyRuleCreate, db: Session = Depends(get_db), _=Depends(require_admin)):
    return pol.create_rule(db, team=rule.team, rule_type=rule.rule_type, value=rule.value)


@app.get("/policies", response_model=list[PolicyRuleOut], tags=["GET — Read / Monitor"])
def list_policies(db: Session = Depends(get_db), _=Depends(get_current_user)):
    return pol.get_rules(db)


@app.delete("/policies/{rule_id}", status_code=204, tags=["DELETE — Remove"])
def delete_policy(rule_id: int, db: Session = Depends(get_db), _=Depends(require_admin)):
    if not pol.delete_rule(db, rule_id):
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
def get_key_statuses(_=Depends(require_admin)):
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
def update_key(req: KeyUpdateRequest, _=Depends(require_admin)):
    """Write or update a provider API key in the .env file (admin only). The value is stored in the project root .env."""
    from dotenv import set_key, find_dotenv

    valid_keys = {d["key"] for d in _KEY_DEFINITIONS}
    if req.key not in valid_keys:
        raise HTTPException(status_code=400, detail=f"Unknown key '{req.key}'. Valid keys: {sorted(valid_keys)}")

    env_path = _ENV_FILE
    # Create .env if it doesn't exist
    if not os.path.exists(env_path):
        open(env_path, "a").close()

    set_key(env_path, req.key, req.value)
    # Also update the current process environment so subsequent calls reflect the new value
    os.environ[req.key] = req.value

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

_FAIL_MODE = os.getenv("GATEWAY_FAIL_MODE", "closed").lower()  # "open" | "closed"


async def _run_enforcement_pipeline(
    db: Session, team: str, agent: str, model: str, messages: list
):
    """
    Runs PII scan → policy → budget.
    Returns (scan_result, findings_list, policy_check, budget_check).
    Raises HTTPException on block (in closed mode, caller handles open mode).
    """
    last_user = next((m["content"] for m in reversed(messages) if m.get("role") == "user"), "")

    scan_result   = scan(last_user)
    findings_list = scan_result.to_dict()

    policy_check = pol.check_model(db, team=team, model=model)
    if not policy_check["allowed"]:
        tel.save_blocked(db, team=team, agent=agent, model=model,
                         prompt=last_user, reason=policy_check["reason"],
                         sensitive=scan_result.is_sensitive, sensitive_findings=findings_list)
        raise HTTPException(status_code=403, detail=policy_check["reason"])

    budget_check = bud.check(db, team=team, agent=agent)
    if not budget_check["allowed"]:
        blk = budget_check["blocked_by"]
        reason = (
            f"Budget limit exceeded for team '{blk['team']}': "
            f"${blk['spend']:.4f} of ${blk['limit']:.2f} {blk['period']} limit."
        )
        tel.save_blocked(db, team=team, agent=agent, model=model,
                         prompt=last_user, reason=reason,
                         sensitive=scan_result.is_sensitive, sensitive_findings=findings_list)
        raise HTTPException(status_code=429, detail=reason)

    return last_user, scan_result, findings_list, policy_check, budget_check


async def _stream_openai_response(
    result_content: str,
    model: str,
    completion_id: str,
    created: int,
) -> AsyncIterator[str]:
    """Simulate SSE streaming by splitting completed content into chunks."""
    words = result_content.split(" ")
    for i, word in enumerate(words):
        chunk_text = word + (" " if i < len(words) - 1 else "")
        chunk = {
            "id": completion_id,
            "object": "chat.completion.chunk",
            "created": created,
            "model": model,
            "choices": [{"index": 0, "delta": {"content": chunk_text}, "finish_reason": None}],
        }
        yield f"data: {json.dumps(chunk)}\n\n"
        await asyncio.sleep(0)  # yield control so FastAPI can flush

    # Final chunk — empty delta + finish_reason
    final = {
        "id": completion_id,
        "object": "chat.completion.chunk",
        "created": created,
        "model": model,
        "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
    }
    yield f"data: {json.dumps(final)}\n\n"
    yield "data: [DONE]\n\n"


@app.post("/v1/chat/completions", tags=["POST — Ask / Create"])
async def openai_compat_chat(
    request: FastAPIRequest,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    OpenAI-compatible chat completions endpoint — supports both streaming and non-streaming.

    Point any OpenAI SDK here by setting `base_url`:
    ```python
    client = openai.OpenAI(base_url="http://your-server/v1", api_key="<jwt>")
    ```

    Full enforcement pipeline: PII scan → policy → budget → LLM → telemetry.

    Headers:
    - `X-Guard-Team`:  team name for cost attribution and policy lookup
    - `X-Guard-Agent`: agent name for telemetry

    Fail mode (`GATEWAY_FAIL_MODE` env var):
    - `closed` (default) — enforcement errors block the request
    - `open` — enforcement errors are logged but the request passes through
    """
    body = await request.json()

    model    = body.get("model", "gpt-4o-mini")
    messages = body.get("messages", [])
    stream   = body.get("stream", False)

    team  = request.headers.get("X-Guard-Team",  "unknown")
    agent = request.headers.get("X-Guard-Agent", "unknown")

    # Run enforcement pipeline; respect fail mode on unexpected errors
    last_user = ""
    findings_list = []
    budget_warnings = []
    try:
        last_user, scan_result, findings_list, _, budget_check = \
            await _run_enforcement_pipeline(db, team, agent, model, messages)
        budget_warnings = budget_check["warnings"]
    except HTTPException:
        raise  # policy/budget blocks always propagate regardless of fail mode
    except Exception as exc:
        if _FAIL_MODE == "open":
            pass  # log and continue
        else:
            raise HTTPException(status_code=503, detail=f"Gateway enforcement error: {exc}")

    # Call LLM
    try:
        result = await chat_complete(messages=messages, model=model)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"LLM error: {exc}")

    # Persist telemetry
    tel.save(db=db, team=team, agent=agent, prompt=last_user, result=result,
             sensitive=(scan_result.is_sensitive if last_user else False),
             sensitive_findings=findings_list)

    completion_id = f"chatcmpl-guard-{_uuid_mod.uuid4().hex[:12]}"
    created       = int(_time_mod.time())

    if stream:
        return StreamingResponse(
            _stream_openai_response(result.content, result.model, completion_id, created),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    return {
        "id": completion_id,
        "object": "chat.completion",
        "created": created,
        "model": result.model,
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": result.content},
                "finish_reason": "stop",
            }
        ],
        "usage": {
            "prompt_tokens":     result.prompt_tokens,
            "completion_tokens": result.completion_tokens,
            "total_tokens":      result.total_tokens,
        },
        "x_guard": {
            "team":              team,
            "agent":             agent,
            "cost_usd":          round(result.prompt_tokens / 1_000_000 * 0.15 + result.completion_tokens / 1_000_000 * 0.60, 8),
            "latency_ms":        result.latency_ms,
            "policy_warnings":   budget_warnings,
            "security_findings": findings_list,
        },
    }


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
    current_user=Depends(get_current_user),
):
    """
    Anthropic-compatible Messages API endpoint.

    Teams using the Anthropic SDK point here by setting `base_url`:
    ```python
    import anthropic
    client = anthropic.Anthropic(base_url="http://your-server", api_key="<jwt>")
    ```

    Accepts the standard Anthropic request shape (`model`, `messages`, `max_tokens`, `system`).
    Returns the standard Anthropic response shape.

    Full enforcement pipeline: PII scan → policy → budget → LLM → telemetry.

    Headers:
    - `X-Guard-Team`:  team name for cost attribution
    - `X-Guard-Agent`: agent name for telemetry
    """
    body = await request.json()

    model      = body.get("model", "claude-haiku-4-5")
    max_tokens = body.get("max_tokens", 1024)
    system     = body.get("system", None)
    stream     = body.get("stream", False)

    # Convert Anthropic message format → OpenAI format
    raw_messages = body.get("messages", [])
    messages: list[dict] = []
    if system:
        messages.append({"role": "system", "content": system})
    for m in raw_messages:
        content = m.get("content", "")
        # Anthropic content can be a list of blocks or a plain string
        if isinstance(content, list):
            text_parts = [b.get("text", "") for b in content if b.get("type") == "text"]
            content = " ".join(text_parts)
        messages.append({"role": m["role"], "content": content})

    team  = request.headers.get("X-Guard-Team",  "unknown")
    agent = request.headers.get("X-Guard-Agent", "unknown")

    # Run enforcement pipeline
    last_user = ""
    findings_list = []
    budget_warnings = []
    try:
        last_user, scan_result, findings_list, _, budget_check = \
            await _run_enforcement_pipeline(db, team, agent, model, messages)
        budget_warnings = budget_check["warnings"]
    except HTTPException:
        raise
    except Exception as exc:
        if _FAIL_MODE == "open":
            pass
        else:
            raise HTTPException(status_code=503, detail=f"Gateway enforcement error: {exc}")

    # Call LLM
    try:
        result = await chat_complete(messages=messages, model=model)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"LLM error: {exc}")

    # Persist telemetry
    tel.save(db=db, team=team, agent=agent, prompt=last_user, result=result,
             sensitive=(scan_result.is_sensitive if last_user else False),
             sensitive_findings=findings_list)

    msg_id  = f"msg_guard_{_uuid_mod.uuid4().hex[:12]}"
    created = int(_time_mod.time())

    if stream:
        async def _anthropic_stream() -> AsyncIterator[str]:
            # message_start
            yield f"event: message_start\ndata: {json.dumps({'type':'message_start','message':{'id':msg_id,'type':'message','role':'assistant','content':[],'model':result.model,'stop_reason':None,'stop_sequence':None,'usage':{'input_tokens':result.prompt_tokens,'output_tokens':0}}})}\n\n"
            # content_block_start
            yield f"event: content_block_start\ndata: {json.dumps({'type':'content_block_start','index':0,'content_block':{'type':'text','text':''}})}\n\n"
            # stream words as deltas
            words = result.content.split(" ")
            for i, word in enumerate(words):
                chunk_text = word + (" " if i < len(words) - 1 else "")
                yield f"event: content_block_delta\ndata: {json.dumps({'type':'content_block_delta','index':0,'delta':{'type':'text_delta','text':chunk_text}})}\n\n"
                await asyncio.sleep(0)
            # content_block_stop
            yield f"event: content_block_stop\ndata: {json.dumps({'type':'content_block_stop','index':0})}\n\n"
            # message_delta
            yield f"event: message_delta\ndata: {json.dumps({'type':'message_delta','delta':{'stop_reason':'end_turn','stop_sequence':None},'usage':{'output_tokens':result.completion_tokens}})}\n\n"
            # message_stop
            yield f"event: message_stop\ndata: {json.dumps({'type':'message_stop'})}\n\n"

        return StreamingResponse(
            _anthropic_stream(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    # Standard Anthropic response shape
    return {
        "id":           msg_id,
        "type":         "message",
        "role":         "assistant",
        "content":      [{"type": "text", "text": result.content}],
        "model":        result.model,
        "stop_reason":  "end_turn",
        "stop_sequence": None,
        "usage": {
            "input_tokens":  result.prompt_tokens,
            "output_tokens": result.completion_tokens,
        },
        "x_guard": {
            "team":              team,
            "agent":             agent,
            "cost_usd":          round(result.prompt_tokens / 1_000_000 * 0.15 + result.completion_tokens / 1_000_000 * 0.60, 8),
            "latency_ms":        result.latency_ms,
            "policy_warnings":   budget_warnings,
            "security_findings": findings_list,
        },
    }
