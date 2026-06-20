"""Agent Inventory REST endpoints — CMDB view of AI agents."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.auth import get_current_user, resolve_team_scope, is_deny_sentinel
from app import agent_inventory as inv

router = APIRouter(tags=["agent_inventory"])


def _org_and_scope(user, db):
    org_id = user.organization_id if hasattr(user, "organization_id") else user.get("organization_id")
    team_scope = resolve_team_scope(user, db)
    return org_id, team_scope


@router.get("/agents")
async def list_agents(
    team:             Optional[str] = Query(None),
    status:           Optional[str] = Query(None, pattern="^(active|dormant|inactive)$"),
    risk:             Optional[str] = Query(None, pattern="^(high|medium|low)$"),
    owner:            Optional[str] = Query(None),
    environment:      Optional[str] = Query(None),
    lifecycle_status: Optional[str] = Query(None, pattern="^(unassigned|managed|retired)$"),
    search:           Optional[str] = Query(None),
    sort_by:          str = Query("monthly_cost_usd"),
    order:            str = Query("desc", pattern="^(asc|desc)$"),
    days:             int = Query(90, ge=1, le=365),
    include_retired:  bool = Query(False),
    user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    org_id, team_scope = _org_and_scope(user, db)
    if is_deny_sentinel(team_scope):
        return []

    agents = inv.get_inventory(
        db, org_id, days_lookback=days, team_scope=team_scope,
        include_retired=include_retired,
    )

    filters = {k: v for k, v in {
        "team": team, "status": status, "risk": risk, "owner": owner,
        "environment": environment, "lifecycle_status": lifecycle_status,
        "search": search,
    }.items() if v is not None}
    if filters:
        agents = inv.filter_inventory(agents, filters)

    return inv.sort_inventory(agents, sort_by=sort_by, order=order)


# summary MUST be registered before /{agent_id} to avoid FastAPI routing it to the path param handler
@router.get("/agents/summary")
async def agents_summary(
    days: int = Query(90, ge=1, le=365),
    user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    org_id, team_scope = _org_and_scope(user, db)
    if is_deny_sentinel(team_scope):
        return {
            "total_agents": 0, "active_agents": 0, "dormant_agents": 0, "inactive_agents": 0,
            "high_risk_agents": 0, "medium_risk_agents": 0, "low_risk_agents": 0,
            "unassigned_agents": 0, "managed_agents": 0, "retired_agents": 0,
            "total_cost_usd": 0.0, "monthly_cost_usd": 0.0,
        }
    return inv.get_inventory_summary(db, org_id, days_lookback=days, team_scope=team_scope)


@router.get("/agents/{agent_id}")
async def get_agent(
    agent_id: str,
    days: int = Query(90, ge=1, le=365),
    user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    org_id, team_scope = _org_and_scope(user, db)
    if is_deny_sentinel(team_scope):
        raise HTTPException(status_code=404, detail="Agent not found")

    agent = inv.get_agent_by_id(db, org_id, agent_id, days_lookback=days)
    if not agent:
        raise HTTPException(status_code=404, detail=f"Agent '{agent_id}' not found in telemetry")

    # Team-scoped RBAC: deny cross-team access, but allow "Unknown" through
    # since it means governance metadata hasn't been set yet.
    if team_scope and agent["team"] != "Unknown" and agent["team"] != team_scope:
        raise HTTPException(status_code=403, detail="Access denied: agent belongs to a different team")

    return agent
