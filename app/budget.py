from datetime import datetime, timezone, timedelta
from sqlalchemy.orm import Session
from sqlalchemy import func
from app.models import BudgetRule, Telemetry


# ─── CRUD ─────────────────────────────────────────────────────────────────────

def create_rule(db: Session, organization_id: int, team: str, agent: str | None,
                limit_usd: float, period: str, action: str) -> BudgetRule:
    rule = BudgetRule(organization_id=organization_id, team=team, agent=agent,
                      limit_usd=limit_usd, period=period, action=action)
    db.add(rule)
    db.commit()
    db.refresh(rule)
    return rule


def get_rules(db: Session, organization_id: int,
              team_scope: str | None = None) -> list[BudgetRule]:
    try:
        q = (db.query(BudgetRule)
               .filter(BudgetRule.organization_id == organization_id))
        if team_scope is not None:
            q = q.filter(BudgetRule.team == team_scope)
        return q.order_by(BudgetRule.created_at.desc()).all()
    except Exception:
        # budget_rules may be missing organization_id in pre-migration DBs
        try:
            return db.query(BudgetRule).order_by(BudgetRule.created_at.desc()).all()
        except Exception:
            return []


def delete_rule(db: Session, rule_id: int, organization_id: int,
                team_scope: str | None = None) -> bool:
    q = db.query(BudgetRule).filter(
        BudgetRule.id == rule_id,
        BudgetRule.organization_id == organization_id,
    )
    if team_scope is not None:
        q = q.filter(BudgetRule.team == team_scope)
    rule = q.first()
    if not rule:
        return False
    db.delete(rule)
    db.commit()
    return True


# ─── Spend calculation ────────────────────────────────────────────────────────

def _period_start(period: str) -> datetime:
    now = datetime.now(timezone.utc)
    if period == "daily":
        return now.replace(hour=0, minute=0, second=0, microsecond=0)
    # monthly
    return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def get_spend(db: Session, organization_id: int, team: str, agent: str | None,
              period: str) -> float:
    since = _period_start(period)
    q = db.query(func.sum(Telemetry.cost_usd)).filter(
        Telemetry.organization_id == organization_id,
        Telemetry.team == team,
        Telemetry.timestamp >= since,
    )
    if agent:
        q = q.filter(Telemetry.agent == agent)
    result = q.scalar()
    return float(result or 0.0)


# ─── Enforcement ──────────────────────────────────────────────────────────────

WARN_THRESHOLD = 0.80  # fire warning at 80% of limit


def check(db: Session, organization_id: int, team: str, agent: str) -> dict:
    """
    Returns {"allowed": bool, "blocked_by": rule | None, "warnings": [rule, ...]}
    Called before every /ask request.
    """
    rules = db.query(BudgetRule).filter(
        BudgetRule.organization_id == organization_id,
        BudgetRule.team.in_([team, "*"]),
    ).all()

    blocked_by = None
    warnings = []

    for rule in rules:
        if rule.agent and rule.agent != agent:
            continue

        spend = get_spend(db, organization_id=organization_id,
                          team=rule.team if rule.team != "*" else team,
                          agent=rule.agent, period=rule.period)
        pct = spend / rule.limit_usd if rule.limit_usd > 0 else 0

        if pct >= 1.0 and rule.action == "block":
            blocked_by = {"rule_id": rule.id, "team": rule.team, "agent": rule.agent,
                          "spend": round(spend, 6), "limit": rule.limit_usd,
                          "period": rule.period}
        elif pct >= WARN_THRESHOLD:
            warnings.append({"rule_id": rule.id, "team": rule.team, "agent": rule.agent,
                              "spend": round(spend, 6), "limit": rule.limit_usd,
                              "period": rule.period, "pct": round(pct * 100, 1)})

    return {"allowed": blocked_by is None, "blocked_by": blocked_by, "warnings": warnings}


# ─── Status (for dashboard) ───────────────────────────────────────────────────

def get_status(db: Session, organization_id: int, team_scope: str | None = None) -> list[dict]:
    rules = get_rules(db, organization_id, team_scope=team_scope)
    result = []
    for rule in rules:
        team_for_spend = rule.team if rule.team != "*" else None
        if team_for_spend is None:
            since = _period_start(rule.period)
            spend = float(db.query(func.sum(Telemetry.cost_usd))
                          .filter(
                              Telemetry.organization_id == organization_id,
                              Telemetry.timestamp >= since,
                          ).scalar() or 0)
        else:
            spend = get_spend(db, organization_id=organization_id,
                              team=rule.team, agent=rule.agent, period=rule.period)

        pct = min(spend / rule.limit_usd * 100, 100) if rule.limit_usd > 0 else 0
        result.append({
            "id":        rule.id,
            "team":      rule.team,
            "agent":     rule.agent,
            "limit_usd": rule.limit_usd,
            "spend_usd": round(spend, 6),
            "pct":       round(pct, 1),
            "period":    rule.period,
            "action":    rule.action,
            "status":    "blocked" if pct >= 100 and rule.action == "block"
                         else "warning" if pct >= 80
                         else "ok",
        })
    return result
