"""CMDB-framing layer over assets.py — inventory records with governance-friendly defaults."""
from __future__ import annotations

from typing import Optional

from sqlalchemy.orm import Session

from app import assets as _assets


def _to_inventory_record(asset: dict) -> dict:
    return {
        "id":               asset["agent_name"],
        "name":             asset["agent_name"],
        "team":             asset.get("team") or "Unknown",
        "owner":            asset.get("owner") or "Unassigned",
        "environment":      asset.get("environment") or "Unknown",
        "status":           asset["status"],
        "risk":             asset["risk"],
        "lifecycle_status": asset.get("lifecycle_status", "unassigned"),
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


def get_inventory(
    db: Session,
    organization_id: int,
    days_lookback: int = 90,
    team_scope: Optional[str] = None,
    include_retired: bool = False,
) -> list[dict]:
    assets = _assets.get_all_assets_derived(
        db, organization_id,
        days_lookback=days_lookback,
        team_scope=team_scope,
        include_retired=include_retired,
    )
    return [_to_inventory_record(a) for a in assets]


def get_inventory_summary(
    db: Session,
    organization_id: int,
    days_lookback: int = 90,
    team_scope: Optional[str] = None,
) -> dict:
    # include_retired=True so retired_agents count is accurate
    agents = get_inventory(db, organization_id, days_lookback=days_lookback,
                           team_scope=team_scope, include_retired=True)
    if not agents:
        return {
            "total_agents":    0,
            "active_agents":   0,
            "dormant_agents":  0,
            "inactive_agents": 0,
            "high_risk_agents":   0,
            "medium_risk_agents": 0,
            "low_risk_agents":    0,
            "unassigned_agents":  0,
            "managed_agents":     0,
            "retired_agents":     0,
            "total_cost_usd":    0.0,
            "monthly_cost_usd":  0.0,
        }
    # Exclude retired from active inventory counts (mirrors assets.py default behaviour)
    active_inventory = [a for a in agents if a["lifecycle_status"] != "retired"]
    return {
        "total_agents":    len(active_inventory),
        "active_agents":   sum(1 for a in active_inventory if a["status"] == "active"),
        "dormant_agents":  sum(1 for a in active_inventory if a["status"] == "dormant"),
        "inactive_agents": sum(1 for a in active_inventory if a["status"] == "inactive"),
        "high_risk_agents":    sum(1 for a in active_inventory if a["risk"] == "high"),
        "medium_risk_agents":  sum(1 for a in active_inventory if a["risk"] == "medium"),
        "low_risk_agents":     sum(1 for a in active_inventory if a["risk"] == "low"),
        "unassigned_agents":   sum(1 for a in agents if a["lifecycle_status"] == "unassigned"),
        "managed_agents":      sum(1 for a in agents if a["lifecycle_status"] == "managed"),
        "retired_agents":      sum(1 for a in agents if a["lifecycle_status"] == "retired"),
        "total_cost_usd":     round(sum(a["total_cost_usd"] for a in active_inventory), 6),
        "monthly_cost_usd":   round(sum(a["monthly_cost_usd"] for a in active_inventory), 6),
    }


def get_agent_by_id(
    db: Session,
    organization_id: int,
    agent_id: str,
    days_lookback: int = 90,
) -> Optional[dict]:
    asset = _assets.get_asset_by_name(db, organization_id, agent_id, days_lookback=days_lookback)
    if asset is None:
        return None
    return _to_inventory_record(asset)


def filter_inventory(agents: list[dict], filters: dict) -> list[dict]:
    result = agents
    if filters.get("team"):
        result = [a for a in result if a["team"] == filters["team"]]
    if filters.get("status"):
        result = [a for a in result if a["status"] == filters["status"]]
    if filters.get("risk"):
        result = [a for a in result if a["risk"] == filters["risk"]]
    if filters.get("owner"):
        # Special sentinel: "unassigned" matches the default placeholder, not a literal name
        if filters["owner"].lower() == "unassigned":
            result = [a for a in result if a["owner"] == "Unassigned"]
        else:
            result = [a for a in result if a["owner"] == filters["owner"]]
    if filters.get("environment"):
        result = [a for a in result if a["environment"] == filters["environment"]]
    if filters.get("lifecycle_status"):
        result = [a for a in result if a["lifecycle_status"] == filters["lifecycle_status"]]
    if filters.get("search"):
        q = filters["search"].lower()
        result = [
            a for a in result
            if q in a["name"].lower() or q in a["team"].lower() or q in a["owner"].lower()
        ]
    return result


def sort_inventory(
    agents: list[dict],
    sort_by: str = "monthly_cost_usd",
    order: str = "desc",
) -> list[dict]:
    valid = {"name", "team", "monthly_cost_usd", "total_cost_usd", "risk", "status", "last_seen", "total_calls"}
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
        if v is None:
            return ""
        return v

    reverse = order.lower() != "asc"
    if sort_by == "name":
        reverse = order.lower() == "desc"

    return sorted(agents, key=key, reverse=reverse)
