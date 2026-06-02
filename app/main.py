from fastapi import FastAPI, Depends, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
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
from app.openai_client import complete, chat_complete
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
        "Endpoints are grouped by operation type:\n"
        "- **POST** — send prompts or create resources\n"
        "- **GET** — read telemetry, sessions, budgets, policies\n"
        "- **DELETE** — remove sessions, budgets, policies"
    ),
    version="0.5.0",
    openapi_tags=tags_metadata,
)

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
