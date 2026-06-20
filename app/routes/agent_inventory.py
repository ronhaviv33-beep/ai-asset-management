"""Agent Inventory REST endpoints — two-tier discovery model (verified + potential)."""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.auth import get_current_user, resolve_team_scope, is_deny_sentinel
from app import agent_inventory as inv
from app.models import AssetRegistry

router = APIRouter(tags=["agent_inventory"])

_EMPTY_SUMMARY = {
    "verified_agents":  {"total": 0, "unassigned": 0, "managed": 0, "high_risk": 0, "monthly_cost_usd": 0.0},
    "potential_agents": {"total": 0, "needs_validation": 0},
    "managed_agents": 0, "retired_agents": 0,
    "discovery_coverage": {},
}


def _org_and_scope(user, db):
    org_id = user.organization_id if hasattr(user, "organization_id") else user.get("organization_id")
    return org_id, resolve_team_scope(user, db)


def _lookup_registry(db: Session, org_id: int, agent_id: str) -> AssetRegistry | None:
    """Look up registry row by asset_key, falling back to sha256(org_id:agent_id)."""
    reg = db.query(AssetRegistry).filter(
        AssetRegistry.organization_id == org_id,
        AssetRegistry.asset_key == agent_id,
    ).first()
    if reg:
        return reg
    # Caller may pass agent_name instead of asset_key
    alt_key = hashlib.sha256(f"{org_id}:{agent_id}".encode()).hexdigest()
    return db.query(AssetRegistry).filter(
        AssetRegistry.organization_id == org_id,
        AssetRegistry.asset_key == alt_key,
    ).first()


def _caller_email(user) -> str | None:
    return user.get("email") if isinstance(user, dict) else getattr(user, "email", None)


# ── List & Summary ────────────────────────────────────────────────────────────

@router.get("/agents")
async def list_agents(
    discovery_status: Optional[str] = Query(None, pattern="^(verified|potential)$"),
    lifecycle_status: Optional[str] = Query(None, pattern="^(unassigned|needs_validation|managed|retired)$"),
    team:             Optional[str] = Query(None),
    status:           Optional[str] = Query(None, pattern="^(active|dormant|inactive)$"),
    risk:             Optional[str] = Query(None, pattern="^(high|medium|low)$"),
    owner:            Optional[str] = Query(None),
    environment:      Optional[str] = Query(None),
    search:           Optional[str] = Query(None),
    sort_by:          str  = Query("monthly_cost_usd"),
    order:            str  = Query("desc", pattern="^(asc|desc)$"),
    days:             int  = Query(90, ge=1, le=365),
    include_retired:  bool = Query(False),
    user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    org_id, team_scope = _org_and_scope(user, db)
    if is_deny_sentinel(team_scope):
        return []

    agents = inv.get_inventory(
        db, org_id, days_lookback=days, team_scope=team_scope,
        include_retired=include_retired, discovery_status=discovery_status,
    )

    filters = {k: v for k, v in {
        "discovery_status": discovery_status, "lifecycle_status": lifecycle_status,
        "team": team, "status": status, "risk": risk, "owner": owner,
        "environment": environment, "search": search,
    }.items() if v is not None}
    if filters:
        agents = inv.filter_inventory(agents, filters)

    return inv.sort_inventory(agents, sort_by=sort_by, order=order)


# summary MUST be registered before /{agent_id} so FastAPI doesn't route it as a path param
@router.get("/agents/summary")
async def agents_summary(
    days: int = Query(90, ge=1, le=365),
    user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    org_id, team_scope = _org_and_scope(user, db)
    if is_deny_sentinel(team_scope):
        return _EMPTY_SUMMARY
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
        raise HTTPException(status_code=404, detail=f"Agent '{agent_id}' not found")

    if team_scope and agent["team"] not in ("Unknown", team_scope):
        raise HTTPException(status_code=403, detail="Access denied: agent belongs to a different team")

    return agent


# ── Actions ───────────────────────────────────────────────────────────────────

@router.post("/agents/{agent_id}/claim")
async def claim_agent(
    agent_id: str,
    body: dict,
    user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Claim a verified unassigned agent — sets lifecycle_status to 'managed'
    and records ownership metadata. Only works on verified agents.
    Use /validate for potential agents.
    """
    org_id, team_scope = _org_and_scope(user, db)
    if is_deny_sentinel(team_scope):
        raise HTTPException(status_code=403, detail="Access denied")

    reg = _lookup_registry(db, org_id, agent_id)
    if not reg:
        raise HTTPException(status_code=404, detail=f"Agent '{agent_id}' not found in registry")

    if getattr(reg, "discovery_status", "verified") == "potential":
        raise HTTPException(
            status_code=400,
            detail="This is a potential agent. Use POST /agents/{id}/validate to confirm and claim it.",
        )

    reg.owner            = body.get("owner") or reg.owner
    reg.team             = body.get("team") or reg.team
    reg.environment      = body.get("environment") or reg.environment
    reg.criticality      = body.get("criticality") or reg.criticality
    reg.business_purpose = body.get("business_purpose") or reg.business_purpose
    reg.agent_name       = body.get("agent_name") or reg.agent_name
    reg.status           = "managed"
    reg.source           = "claimed"
    reg.claimed_by       = _caller_email(user)
    reg.claimed_at       = datetime.now(timezone.utc)

    db.commit()
    return inv.get_agent_by_id(db, org_id, reg.asset_key) or {
        "status": "managed", "asset_key": reg.asset_key, "lifecycle_status": "managed",
    }


@router.post("/agents/{agent_id}/validate")
async def validate_agent(
    agent_id: str,
    body: dict,
    user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Validate a potential agent — promotes it to verified + managed.
    Records the validation event in the evidence trail.
    """
    org_id, team_scope = _org_and_scope(user, db)
    if is_deny_sentinel(team_scope):
        raise HTTPException(status_code=403, detail="Access denied")

    reg = _lookup_registry(db, org_id, agent_id)
    if not reg:
        raise HTTPException(status_code=404, detail=f"Agent '{agent_id}' not found in registry")

    if getattr(reg, "discovery_status", "verified") != "potential":
        raise HTTPException(
            status_code=400,
            detail="Only potential agents can be validated. Use POST /agents/{id}/claim for verified agents.",
        )

    # Append validation event to evidence trail
    evidence = {}
    try:
        evidence = json.loads(reg.evidence or "{}")
    except Exception:
        pass
    now = datetime.now(timezone.utc)
    events = evidence.get("validation_events", [])
    events.append({"action": "validated", "by": _caller_email(user), "at": now.isoformat()})
    evidence["validation_events"] = events

    reg.discovery_status = "verified"
    reg.confidence_score = 100.0
    reg.status           = "managed"
    reg.source           = "claimed"
    reg.agent_name       = body.get("confirmed_agent_name") or reg.agent_name
    reg.owner            = body.get("owner") or reg.owner
    reg.team             = body.get("team") or reg.team
    reg.environment      = body.get("environment") or reg.environment
    reg.criticality      = body.get("criticality") or reg.criticality
    reg.business_purpose = body.get("business_purpose") or reg.business_purpose
    reg.claimed_by       = _caller_email(user)
    reg.claimed_at       = now
    reg.evidence         = json.dumps(evidence)

    db.commit()
    return {
        "asset_key":        reg.asset_key,
        "agent_name":       reg.agent_name,
        "discovery_status": "verified",
        "lifecycle_status": "managed",
        "claimed_by":       reg.claimed_by,
        "claimed_at":       now.isoformat(),
    }


@router.post("/agents/{agent_id}/reject")
async def reject_agent(
    agent_id: str,
    body: dict,
    user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Reject a potential agent — marks it retired so it no longer appears in
    active inventory. The registry row is preserved for audit history.
    """
    org_id, team_scope = _org_and_scope(user, db)
    if is_deny_sentinel(team_scope):
        raise HTTPException(status_code=403, detail="Access denied")

    reg = _lookup_registry(db, org_id, agent_id)
    if not reg:
        raise HTTPException(status_code=404, detail=f"Agent '{agent_id}' not found in registry")

    evidence = {}
    try:
        evidence = json.loads(reg.evidence or "{}")
    except Exception:
        pass
    now = datetime.now(timezone.utc)
    events = evidence.get("validation_events", [])
    events.append({
        "action": "rejected",
        "by":     _caller_email(user),
        "at":     now.isoformat(),
        "reason": body.get("rejection_reason", ""),
    })
    evidence["validation_events"] = events

    reg.status   = "retired"
    reg.evidence = json.dumps(evidence)

    db.commit()
    return {
        "asset_key":        reg.asset_key,
        "lifecycle_status": "retired",
        "rejected_by":      _caller_email(user),
        "rejected_at":      now.isoformat(),
        "rejection_reason": body.get("rejection_reason", ""),
    }
