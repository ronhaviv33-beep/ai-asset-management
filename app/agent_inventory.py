"""
Agent Inventory — CMDB-framing layer for AI agent discovery.

Two-tier discovery model:
  verified  — high-confidence, from runtime gateway telemetry (confidence 95)
  potential — lower-confidence, from platform scans: GitHub, Jira, Slack, etc.

Verified agents have telemetry-derived runtime metrics (cost, tokens, risk).
Potential agents are registry-only records awaiting human validation.
"""
from __future__ import annotations

import json
from collections import Counter
from typing import Optional

from sqlalchemy.orm import Session

from app import assets as _assets
from app.models import AssetRegistry


# ── Record builders ───────────────────────────────────────────────────────────

def _parse_evidence(raw) -> dict:
    if not raw:
        return {}
    if isinstance(raw, dict):
        return raw
    try:
        return json.loads(raw)
    except Exception:
        return {}


def _to_inventory_record(asset: dict) -> dict:
    """Transform a verified agent (from telemetry+registry merge) into an inventory record."""
    return {
        "id":               asset.get("asset_key") or asset["agent_name"],
        "name":             asset["agent_name"],
        "team":             asset.get("team") or "Unknown",
        "owner":            asset.get("owner") or "Unassigned",
        "environment":      asset.get("environment") or "Unknown",
        "status":           asset["status"],
        "risk":             asset["risk"],
        "lifecycle_status": asset.get("lifecycle_status", "unassigned"),
        "discovery_status": asset.get("discovery_status", "verified"),
        "discovery_source": asset.get("discovery_source", "gateway_telemetry"),
        "discovery_reason": asset.get("discovery_reason"),
        "evidence":         _parse_evidence(asset.get("evidence")),
        "confidence_score": asset.get("confidence_score") or 95.0,
        "criticality":      asset.get("criticality"),
        "business_purpose": asset.get("business_purpose"),
        "monthly_cost_usd": asset["monthly_cost_usd"],
        "total_cost_usd":   asset["total_cost_usd"],
        "total_calls":      asset["total_calls"],
        "total_tokens":     asset["total_tokens"],
        "models_used":      asset.get("models_used", []),
        "last_seen":        asset["last_seen"],
        "first_seen":       asset.get("first_seen"),
        "signals":          asset.get("signals", {}),
        "asset_key":        asset.get("asset_key"),
        "claimed_by":       asset.get("claimed_by"),
        "claimed_at":       asset.get("claimed_at"),
    }


def _registry_to_potential_record(reg: AssetRegistry) -> dict:
    """Build an inventory record for a potential agent (no telemetry — registry only)."""
    return {
        "id":               reg.asset_key,
        "name":             reg.agent_name or reg.agent_id_raw,
        "team":             reg.team or "Unknown",
        "owner":            reg.owner or "Unassigned",
        "environment":      reg.environment or "Unknown",
        "status":           None,   # no runtime telemetry
        "risk":             None,
        "lifecycle_status": reg.status or "needs_validation",
        "discovery_status": "potential",
        "discovery_source": getattr(reg, "discovery_source", None) or "unknown",
        "discovery_reason": getattr(reg, "discovery_reason", None),
        "evidence":         _parse_evidence(getattr(reg, "evidence", None)),
        "confidence_score": getattr(reg, "confidence_score", None) or 50.0,
        "criticality":      reg.criticality,
        "business_purpose": reg.business_purpose,
        "monthly_cost_usd": 0.0,
        "total_cost_usd":   0.0,
        "total_calls":      0,
        "total_tokens":     0,
        "models_used":      [],
        "last_seen":        None,
        "first_seen":       reg.first_seen_at.isoformat() if reg.first_seen_at else None,
        "signals":          {},
        "asset_key":        reg.asset_key,
        "claimed_by":       reg.claimed_by,
        "claimed_at":       reg.claimed_at.isoformat() if reg.claimed_at else None,
    }


# ── Public API ────────────────────────────────────────────────────────────────

def get_inventory(
    db: Session,
    organization_id: int,
    days_lookback: int = 90,
    team_scope: Optional[str] = None,
    include_retired: bool = False,
    discovery_status: Optional[str] = None,
) -> list[dict]:
    """
    Return all agent inventory records.

    Verified agents are derived from telemetry + registry (has runtime metrics).
    Potential agents come from registry only (no telemetry — awaiting validation).
    """
    result: list[dict] = []

    # Verified agents — runtime telemetry + registry merge
    if discovery_status in (None, "verified"):
        assets = _assets.get_all_assets_derived(
            db, organization_id,
            days_lookback=days_lookback,
            team_scope=team_scope,
            include_retired=include_retired,
        )
        result.extend(_to_inventory_record(a) for a in assets)

    # Potential agents — registry only, no telemetry rows
    if discovery_status in (None, "potential"):
        try:
            q = db.query(AssetRegistry).filter(
                AssetRegistry.organization_id == organization_id,
                AssetRegistry.discovery_status == "potential",
            )
            if not include_retired:
                q = q.filter(AssetRegistry.status != "retired")
            if team_scope:
                q = q.filter(AssetRegistry.team == team_scope)
            result.extend(_registry_to_potential_record(r) for r in q.all())
        except Exception:
            pass  # discovery_status column may not exist on very old deployments

    return result


def get_inventory_summary(
    db: Session,
    organization_id: int,
    days_lookback: int = 90,
    team_scope: Optional[str] = None,
) -> dict:
    """Structured KPI summary for the Agent Inventory dashboard."""
    all_agents = get_inventory(
        db, organization_id, days_lookback=days_lookback,
        team_scope=team_scope, include_retired=True,
    )

    verified  = [a for a in all_agents if a["discovery_status"] == "verified"]
    potential = [a for a in all_agents if a["discovery_status"] == "potential"]

    # Exclude retired from active/cost counts — retired are kept for audit only
    verified_active = [a for a in verified if a["lifecycle_status"] != "retired"]

    source_counts = dict(Counter(a["discovery_source"] for a in all_agents))

    return {
        "verified_agents": {
            "total":            len(verified_active),
            "unassigned":       sum(1 for a in verified_active if a["lifecycle_status"] == "unassigned"),
            "managed":          sum(1 for a in verified_active if a["lifecycle_status"] == "managed"),
            "high_risk":        sum(1 for a in verified_active if a["risk"] == "high"),
            "monthly_cost_usd": round(sum(a["monthly_cost_usd"] for a in verified_active), 6),
        },
        "potential_agents": {
            "total":            len(potential),
            "needs_validation": sum(1 for a in potential if a["lifecycle_status"] == "needs_validation"),
        },
        "managed_agents":  sum(1 for a in all_agents if a["lifecycle_status"] == "managed"),
        "retired_agents":  sum(1 for a in all_agents if a["lifecycle_status"] == "retired"),
        "discovery_coverage": source_counts,
    }


def get_agent_by_id(
    db: Session,
    organization_id: int,
    agent_id: str,
    days_lookback: int = 90,
) -> Optional[dict]:
    """
    Get a single inventory record by agent_id.
    Tries agent_name lookup first (verified path), then asset_key lookup (potential path).
    """
    # Verified: agent_id is agent_name / agent_id_raw
    asset = _assets.get_asset_by_name(db, organization_id, agent_id, days_lookback=days_lookback)
    if asset:
        return _to_inventory_record(asset)

    # Potential (or verified lookup by asset_key): agent_id is the sha256 asset_key
    try:
        reg = db.query(AssetRegistry).filter(
            AssetRegistry.organization_id == organization_id,
            AssetRegistry.asset_key == agent_id,
        ).first()
        if reg:
            ds = getattr(reg, "discovery_status", "verified") or "verified"
            if ds == "potential":
                return _registry_to_potential_record(reg)
            # Verified agent found by asset_key but not found via telemetry — rare edge case;
            # return a minimal registry-only record so the caller can still operate on it.
            return _registry_to_potential_record(reg)
    except Exception:
        pass

    return None


def filter_inventory(agents: list[dict], filters: dict) -> list[dict]:
    result = agents
    if filters.get("discovery_status"):
        result = [a for a in result if a["discovery_status"] == filters["discovery_status"]]
    if filters.get("lifecycle_status"):
        result = [a for a in result if a["lifecycle_status"] == filters["lifecycle_status"]]
    if filters.get("team"):
        result = [a for a in result if a["team"] == filters["team"]]
    if filters.get("status"):
        result = [a for a in result if a["status"] == filters["status"]]
    if filters.get("risk"):
        result = [a for a in result if a["risk"] == filters["risk"]]
    if filters.get("owner"):
        if filters["owner"].lower() == "unassigned":
            result = [a for a in result if a["owner"] == "Unassigned"]
        else:
            result = [a for a in result if a["owner"] == filters["owner"]]
    if filters.get("environment"):
        result = [a for a in result if a["environment"] == filters["environment"]]
    if filters.get("search"):
        q = filters["search"].lower()
        result = [
            a for a in result
            if q in a["name"].lower() or q in (a["team"] or "").lower()
        ]
    return result


def sort_inventory(
    agents: list[dict],
    sort_by: str = "monthly_cost_usd",
    order: str = "desc",
) -> list[dict]:
    valid = {"name", "team", "monthly_cost_usd", "total_cost_usd", "risk",
             "status", "last_seen", "total_calls", "confidence_score"}
    if sort_by not in valid:
        sort_by = "monthly_cost_usd"

    risk_order   = {"high": 0, "medium": 1, "low": 2}
    status_order = {"active": 0, "dormant": 1, "inactive": 2}

    def key(a):
        v = a.get(sort_by)
        if sort_by == "risk":
            return risk_order.get(v, 99)
        if sort_by == "status":
            return status_order.get(v, 99)
        return v if v is not None else ""

    reverse = order.lower() != "asc"
    if sort_by == "name":
        reverse = order.lower() == "desc"

    return sorted(agents, key=key, reverse=reverse)
