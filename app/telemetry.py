import json
from datetime import datetime, timezone, timedelta
from sqlalchemy.orm import Session
from sqlalchemy import func
from app.models import Telemetry, calculate_cost
from app.client import CompletionResult
from app.schemas import TelemetrySummary


def save(
    db: Session,
    team: str,
    agent: str,
    prompt: str,
    result: CompletionResult,
    sensitive: bool = False,
    sensitive_findings: list[dict] | None = None,
    organization_id: int | None = None,
) -> Telemetry:
    cost_usd, pricing_estimated = calculate_cost(result.model, result.prompt_tokens, result.completion_tokens)
    record = Telemetry(
        organization_id=organization_id,
        team=team,
        agent=agent,
        model=result.model,
        prompt=prompt,
        response=result.content,
        prompt_tokens=result.prompt_tokens,
        completion_tokens=result.completion_tokens,
        total_tokens=result.total_tokens,
        latency_ms=result.latency_ms,
        cost_usd=cost_usd,
        pricing_estimated=pricing_estimated,
        sensitive=sensitive,
        sensitive_findings=json.dumps(sensitive_findings) if sensitive_findings else None,
        blocked=False,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


def save_blocked(
    db: Session,
    team: str,
    agent: str,
    model: str,
    prompt: str,
    reason: str,
    sensitive: bool = False,
    sensitive_findings: list[dict] | None = None,
    organization_id: int | None = None,
) -> Telemetry:
    """Record a request that was blocked before reaching the LLM."""
    record = Telemetry(
        organization_id=organization_id,
        team=team, agent=agent, model=model, prompt=prompt, response="",
        prompt_tokens=0, completion_tokens=0, total_tokens=0,
        latency_ms=0.0, cost_usd=0.0,
        sensitive=sensitive,
        sensitive_findings=json.dumps(sensitive_findings) if sensitive_findings else None,
        blocked=True,
        block_reason=reason,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


def get_all(db: Session, organization_id: int | None, skip: int = 0, limit: int = 100,
            team_scope: str | None = None) -> list[Telemetry]:
    q = db.query(Telemetry).order_by(Telemetry.timestamp.desc())
    q = q.filter(Telemetry.organization_id == organization_id)
    if team_scope is not None:
        q = q.filter(Telemetry.team == team_scope)
    return q.offset(skip).limit(limit).all()


def get_summary(db: Session, organization_id: int | None,
                team_scope: str | None = None) -> TelemetrySummary:
    q = db.query(Telemetry).filter(
        Telemetry.blocked == False,
        Telemetry.organization_id == organization_id,
    )
    if team_scope is not None:
        q = q.filter(Telemetry.team == team_scope)
    rows = q.all()
    if not rows:
        return TelemetrySummary(
            total_requests=0, total_tokens=0, total_cost_usd=0.0,
            avg_latency_ms=0.0, models_used=[], teams=[],
        )
    return TelemetrySummary(
        total_requests=len(rows),
        total_tokens=sum(r.total_tokens for r in rows),
        total_cost_usd=round(sum(r.cost_usd for r in rows), 8),
        avg_latency_ms=round(sum(r.latency_ms for r in rows) / len(rows), 2),
        models_used=sorted({r.model for r in rows}),
        teams=sorted({r.team for r in rows}),
    )


def get_audit(
    db: Session,
    organization_id: int | None,
    team: str | None = None,
    agent: str | None = None,
    sensitive_only: bool = False,
    blocked_only: bool = False,
    skip: int = 0,
    limit: int = 100,
    team_scope: str | None = None,
) -> list[Telemetry]:
    q = db.query(Telemetry).order_by(Telemetry.timestamp.desc())
    q = q.filter(Telemetry.organization_id == organization_id)
    # team_scope (role-based) and team (query param) are independent — both apply
    if team_scope is not None:
        q = q.filter(Telemetry.team == team_scope)
    if team:
        q = q.filter(Telemetry.team == team)
    if agent:
        q = q.filter(Telemetry.agent == agent)
    if sensitive_only:
        q = q.filter(Telemetry.sensitive == True)
    if blocked_only:
        q = q.filter(Telemetry.blocked == True)
    return q.offset(skip).limit(limit).all()


def would_block_counts(db: Session, days: int = 30,
                       organization_id: int | None = None) -> dict[str, int]:
    """Count shadow-block ('would_block') findings per team over the last N days."""
    from datetime import datetime, timezone, timedelta
    since = datetime.now(timezone.utc) - timedelta(days=days)
    q = db.query(Telemetry).filter(
        Telemetry.timestamp >= since,
        Telemetry.sensitive_findings.like('%would_block%'),
    )
    if organization_id is not None:
        q = q.filter(Telemetry.organization_id == organization_id)
    rows = q.all()
    counts: dict[str, int] = {}
    for r in rows:
        counts[r.team] = counts.get(r.team, 0) + 1
    return counts


def get_security_alerts(db: Session, organization_id: int | None,
                        team_scope: str | None = None) -> list[dict]:
    """Run detection rules against real telemetry and return live alerts."""
    from datetime import datetime, timezone, timedelta
    alerts = []
    now = datetime.now(timezone.utc)
    day_ago = now - timedelta(days=1)
    week_ago = now - timedelta(days=7)

    def _q():
        q = db.query(Telemetry).filter(Telemetry.organization_id == organization_id)
        if team_scope is not None:
            q = q.filter(Telemetry.team == team_scope)
        return q

    # Sensitive data exposure
    sensitive = _q().filter(Telemetry.sensitive == True).all()
    if sensitive:
        alerts.append({
            "type": "sensitive_data_exposure", "sev": "critical",
            "entity": sensitive[0].agent,
            "msg": f"{len(sensitive)} requests flagged with sensitive data (PII / credentials)",
            "action": "Enable PII redaction policy on this workflow",
            "ts": sensitive[0].timestamp.isoformat(),
        })

    # Blocked requests spike
    blocked = _q().filter(
        Telemetry.blocked == True, Telemetry.timestamp >= day_ago
    ).all()
    if len(blocked) > 5:
        alerts.append({
            "type": "policy_block_spike", "sev": "warning",
            "entity": blocked[0].team,
            "msg": f"{len(blocked)} requests blocked by policy in last 24h",
            "action": "Review team's model usage and budget rules",
            "ts": now.isoformat(),
        })

    # High token requests
    big = _q().filter(Telemetry.total_tokens > 30000).order_by(Telemetry.total_tokens.desc()).limit(5).all()
    for r in big:
        alerts.append({
            "type": "high_token_prompt", "sev": "warning",
            "entity": r.agent,
            "msg": f"{r.total_tokens:,} tokens in single request ({r.model})",
            "action": "Add context compaction or retrieval truncation",
            "ts": r.timestamp.isoformat(),
        })

    # After-hours activity (last 7 days)
    all_week = _q().filter(Telemetry.timestamp >= week_ago).all()
    after_hours_counts: dict[str, int] = {}
    for r in all_week:
        hour = r.timestamp.hour
        if hour < 7 or hour > 20:
            after_hours_counts[r.agent] = after_hours_counts.get(r.agent, 0) + 1
    for agent, count in after_hours_counts.items():
        if count > 10:
            alerts.append({
                "type": "unusual_after_hours_usage", "sev": "info",
                "entity": agent,
                "msg": f"{count} calls outside 07:00–20:00 in last 7d",
                "action": "Confirm batch job is intentional; otherwise rotate keys",
                "ts": now.isoformat(),
            })

    return sorted(alerts, key=lambda a: {"critical": 0, "warning": 1, "info": 2}[a["sev"]])
