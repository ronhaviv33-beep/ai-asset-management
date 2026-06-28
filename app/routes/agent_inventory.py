"""Agent Inventory REST endpoints — two-tier discovery model (verified + potential)."""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.auth import get_current_user, resolve_team_scope, is_deny_sentinel, require_admin
from app import agent_inventory as inv
from app.models import AssetRegistry
from app.org_config import get_org_config

router = APIRouter(tags=["agent_inventory"])

_EMPTY_SUMMARY = {
    "verified_agents":  {"total": 0, "unassigned": 0, "managed": 0, "high_risk": 0, "monthly_cost_usd": 0.0},
    "likely_agents":    {"total": 0},
    "historical_agents": {"total": 0},
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


def _append_evidence_event(reg: AssetRegistry, action: str, user, **extra) -> None:
    """Append an event to the registry's evidence trail (same pattern as validate/reject)."""
    evidence = {}
    try:
        evidence = json.loads(reg.evidence or "{}")
    except Exception:
        pass
    events = evidence.get("validation_events", [])
    events.append({
        "action": action,
        "by": _caller_email(user),
        "at": datetime.now(timezone.utc).isoformat(),
        **extra,
    })
    evidence["validation_events"] = events
    reg.evidence = json.dumps(evidence)


def _apply_claim(reg: AssetRegistry, body: dict, user) -> None:
    """Shared claim mutation — used by /claim and /approve-suggestions so both
    behave identically. Preserves existing values when a field is not provided."""
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


# ── List & Summary ────────────────────────────────────────────────────────────

@router.get("/agents")
async def list_agents(
    discovery_status: Optional[str] = Query(None, pattern="^(verified|likely|potential|historical)$"),
    lifecycle_status: Optional[str] = Query(None, pattern="^(unassigned|needs_validation|managed|retired)$"),
    team:             Optional[str] = Query(None),
    status:           Optional[str] = Query(None, pattern="^(active|dormant|inactive)$"),
    risk:             Optional[str] = Query(None, pattern="^(critical|high|medium|low)$"),
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

    demo_mode = bool(get_org_config(db, org_id, "demo_mode"))
    agents = inv.get_inventory(
        db, org_id, days_lookback=days, team_scope=team_scope,
        include_retired=include_retired, discovery_status=discovery_status, demo_mode=demo_mode,
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
    demo_mode = bool(get_org_config(db, org_id, "demo_mode"))
    return inv.get_inventory_summary(db, org_id, days_lookback=days, team_scope=team_scope, demo_mode=demo_mode)


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

    demo_mode = bool(get_org_config(db, org_id, "demo_mode"))
    agent = inv.get_agent_by_id(db, org_id, agent_id, days_lookback=days, demo_mode=demo_mode)
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

    if reg and getattr(reg, "discovery_status", "verified") == "potential":
        raise HTTPException(
            status_code=400,
            detail="This is a potential agent. Use POST /agents/{id}/validate to confirm and claim it.",
        )

    # Auto-create a registry row if one doesn't exist yet.
    # Agents appear in inventory from telemetry alone; the registry row is created on first claim.
    if not reg:
        asset_key = agent_id if len(agent_id) == 64 else hashlib.sha256(f"{org_id}:{agent_id}".encode()).hexdigest()
        reg = AssetRegistry(
            organization_id  = org_id,
            asset_key        = asset_key,
            agent_id_raw     = agent_id,
            agent_name       = agent_id,
            discovery_status = "verified",
            discovery_source = "gateway_telemetry",
            confidence_score = 95.0,
            first_seen_at    = datetime.now(timezone.utc),
        )
        db.add(reg)
        db.flush()

    _apply_claim(reg, body, user)

    db.commit()
    return inv.get_agent_by_id(db, org_id, reg.asset_key) or {
        "status": "managed", "asset_key": reg.asset_key, "lifecycle_status": "managed",
    }


@router.post("/agents/{agent_id}/approve-suggestions")
async def approve_suggestions(
    agent_id: str,
    body: dict | None = None,
    user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Approve the system's suggested owner/team/environment for a discovered agent
    and mark it managed — the one-click alternative to filling in the claim form.
    Any field present in the request body overrides the corresponding suggestion.
    Reuses the same mutation as /claim, so the resulting record is identical.
    """
    org_id, team_scope = _org_and_scope(user, db)
    if is_deny_sentinel(team_scope):
        raise HTTPException(status_code=403, detail="Access denied")

    body = body or {}
    reg = _lookup_registry(db, org_id, agent_id)

    if reg and getattr(reg, "discovery_status", "verified") == "potential":
        raise HTTPException(
            status_code=400,
            detail="This is a potential agent. Use POST /agents/{id}/validate to confirm and claim it.",
        )

    # Server-derived suggestions come from the inventory record (read-time only).
    agent = inv.get_agent_by_id(db, org_id, agent_id) or {}
    merged = {
        "owner":            body.get("owner")            or agent.get("suggested_owner"),
        "team":             body.get("team")             or agent.get("suggested_team"),
        "environment":      body.get("environment")      or agent.get("suggested_environment"),
        "criticality":      body.get("criticality"),
        "business_purpose": body.get("business_purpose"),
        "agent_name":       body.get("agent_name"),
    }

    # Auto-create the registry row on first approval (mirrors /claim).
    if not reg:
        asset_key = agent_id if len(agent_id) == 64 else hashlib.sha256(f"{org_id}:{agent_id}".encode()).hexdigest()
        reg = AssetRegistry(
            organization_id  = org_id,
            asset_key        = asset_key,
            agent_id_raw     = agent_id,
            agent_name       = agent_id,
            discovery_status = "verified",
            discovery_source = "gateway_telemetry",
            confidence_score = 95.0,
            first_seen_at    = datetime.now(timezone.utc),
        )
        db.add(reg)
        db.flush()

    _apply_claim(reg, merged, user)
    _append_evidence_event(reg, "approved_suggestions", user)

    db.commit()
    return inv.get_agent_by_id(db, org_id, reg.asset_key) or {
        "status": "managed", "asset_key": reg.asset_key, "lifecycle_status": "managed",
    }


@router.post("/agents/{agent_id}/ignore")
async def ignore_agent(
    agent_id: str,
    body: dict | None = None,
    user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Dismiss a discovered agent from the urgent review queue WITHOUT retiring or
    deleting it. Records an 'ignored' event in the evidence trail; the agent
    stays discovered and continues accumulating telemetry. Reversible by claiming.
    """
    org_id, team_scope = _org_and_scope(user, db)
    if is_deny_sentinel(team_scope):
        raise HTTPException(status_code=403, detail="Access denied")

    body = body or {}
    reg = _lookup_registry(db, org_id, agent_id)

    # Auto-create a minimal registry row so the dismissal persists for telemetry-only agents.
    if not reg:
        asset_key = agent_id if len(agent_id) == 64 else hashlib.sha256(f"{org_id}:{agent_id}".encode()).hexdigest()
        reg = AssetRegistry(
            organization_id  = org_id,
            asset_key        = asset_key,
            agent_id_raw     = agent_id,
            agent_name       = agent_id,
            discovery_status = "verified",
            discovery_source = "gateway_telemetry",
            confidence_score = 95.0,
            first_seen_at    = datetime.now(timezone.utc),
        )
        db.add(reg)
        db.flush()

    _append_evidence_event(reg, "ignored", user, reason=body.get("reason", ""))

    db.commit()
    return {
        "asset_key":        reg.asset_key,
        "lifecycle_status": reg.status or "unassigned",
        "ignored_by":       _caller_email(user),
        "ignored_at":       datetime.now(timezone.utc).isoformat(),
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


# ── Admin: Edit Agent ─────────────────────────────────────────────────────────

_EDITABLE_FIELDS = ("agent_name", "owner", "team", "environment", "criticality", "business_purpose")
_VALID_LIFECYCLE  = {"unassigned", "managed", "retired"}


@router.patch("/agents/{agent_id}")
async def update_agent(
    agent_id: str,
    body: dict,
    user=Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Admin-only: update registry metadata for any agent."""
    org_id, _ = _org_and_scope(user, db)

    reg = _lookup_registry(db, org_id, agent_id)
    if not reg:
        raise HTTPException(status_code=404, detail=f"Agent '{agent_id}' not found")

    for field in _EDITABLE_FIELDS:
        if field in body and body[field] is not None:
            setattr(reg, field, body[field])

    if "lifecycle_status" in body and body["lifecycle_status"] in _VALID_LIFECYCLE:
        reg.status = body["lifecycle_status"]

    db.commit()
    result = inv.get_agent_by_id(db, org_id, reg.asset_key)
    return result or {"asset_key": reg.asset_key, "updated": True}
