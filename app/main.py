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
)
from app import telemetry as tel
from app import budget as bud
from app import policy as pol
from app.scanner import scan
from app.openai_client import complete, chat_complete

Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="AIFinOps Guard",
    description="AI Runtime Intelligence Platform — telemetry, cost, and governance gateway",
    version="0.4.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── Health ───────────────────────────────────────────────────────────────────

@app.get("/")
def root():
    return {"status": "AIFinOps Gateway Running", "version": "0.4.0"}


# ─── AI Gateway ───────────────────────────────────────────────────────────────

@app.post("/ask", response_model=AskResponse)
async def ask(req: AskRequest, db: Session = Depends(get_db)):

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

    return AskResponse(
        response=result.content,
        model=result.model,
        prompt_tokens=result.prompt_tokens,
        completion_tokens=result.completion_tokens,
        total_tokens=result.total_tokens,
        latency_ms=result.latency_ms,
        cost_usd=record.cost_usd,
        telemetry_id=record.id,
        budget_warnings=budget_check["warnings"],
        security_findings=findings_list,
    )


# ─── Multi-turn Chat ─────────────────────────────────────────────────────────

@app.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest, db: Session = Depends(get_db)):

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

@app.get("/telemetry", response_model=list[TelemetryRecord])
def get_telemetry(
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=1000),
    db: Session = Depends(get_db),
):
    return tel.get_all(db, skip=skip, limit=limit)


@app.get("/telemetry/summary", response_model=TelemetrySummary)
def get_summary(db: Session = Depends(get_db)):
    return tel.get_summary(db)


# ─── Audit log ────────────────────────────────────────────────────────────────

@app.get("/audit", response_model=list[TelemetryRecord])
def get_audit(
    team: str | None = Query(default=None),
    agent: str | None = Query(default=None),
    sensitive_only: bool = Query(default=False),
    blocked_only: bool = Query(default=False),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=1000),
    db: Session = Depends(get_db),
):
    return tel.get_audit(db, team=team, agent=agent,
                         sensitive_only=sensitive_only, blocked_only=blocked_only,
                         skip=skip, limit=limit)


# ─── Security ─────────────────────────────────────────────────────────────────

@app.post("/security/scan", response_model=ScanResponse)
def security_scan(req: ScanRequest):
    result = scan(req.text)
    return ScanResponse(
        is_sensitive=result.is_sensitive,
        findings=[ScanFinding(type=f.type, severity=f.severity, sample=f.sample)
                  for f in result.findings],
    )


@app.get("/security/alerts")
def security_alerts(db: Session = Depends(get_db)):
    return tel.get_security_alerts(db)


# ─── Budgets ──────────────────────────────────────────────────────────────────

@app.post("/budgets", response_model=BudgetRuleOut, status_code=201)
def create_budget(rule: BudgetRuleCreate, db: Session = Depends(get_db)):
    return bud.create_rule(db, team=rule.team, agent=rule.agent,
                           limit_usd=rule.limit_usd, period=rule.period, action=rule.action)


@app.get("/budgets", response_model=list[BudgetRuleOut])
def list_budgets(db: Session = Depends(get_db)):
    return bud.get_rules(db)


@app.delete("/budgets/{rule_id}", status_code=204)
def delete_budget(rule_id: int, db: Session = Depends(get_db)):
    if not bud.delete_rule(db, rule_id):
        raise HTTPException(status_code=404, detail="Budget rule not found")


@app.get("/budgets/status", response_model=list[BudgetStatusItem])
def budget_status(db: Session = Depends(get_db)):
    return bud.get_status(db)


# ─── Policies ─────────────────────────────────────────────────────────────────

@app.post("/policies", response_model=PolicyRuleOut, status_code=201)
def create_policy(rule: PolicyRuleCreate, db: Session = Depends(get_db)):
    return pol.create_rule(db, team=rule.team, rule_type=rule.rule_type, value=rule.value)


@app.get("/policies", response_model=list[PolicyRuleOut])
def list_policies(db: Session = Depends(get_db)):
    return pol.get_rules(db)


@app.delete("/policies/{rule_id}", status_code=204)
def delete_policy(rule_id: int, db: Session = Depends(get_db)):
    if not pol.delete_rule(db, rule_id):
        raise HTTPException(status_code=404, detail="Policy rule not found")
