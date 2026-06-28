"""
Asset derivation layer — reads from telemetry and asset_registry tables.
Telemetry drives runtime signals; asset_registry provides governance metadata.
"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone, timedelta
from collections import defaultdict
from typing import Optional

from sqlalchemy.orm import Session

from app.models import Telemetry, AssetRegistry
from app.discovery_status import (
    derive_discovery_status,
    build_identity_evidence,
    derive_suggestions,
)


def _apply_discovery_fields(asset: dict) -> None:
    """Attach derived customer-facing discovery fields additively (never raises)."""
    try:
        stage, label, reason = derive_discovery_status(asset)
        asset["discovery_stage"] = stage
        asset["stage_label"] = label
        asset["stage_reason"] = reason
        asset["identity_evidence"] = build_identity_evidence(asset)
        asset.update(derive_suggestions(asset))
    except Exception:
        pass  # derivation is best-effort; never break inventory assembly


# Status thresholds (days since last call)
ACTIVE_DAYS    = 7
DORMANT_DAYS   = 30


def _status_from_last_seen(last_seen: datetime) -> str:
    now = datetime.now(timezone.utc)
    # Ensure last_seen is timezone-aware
    if last_seen.tzinfo is None:
        last_seen = last_seen.replace(tzinfo=timezone.utc)
    days_ago = (now - last_seen).days
    if days_ago <= ACTIVE_DAYS:
        return "active"
    if days_ago <= DORMANT_DAYS:
        return "dormant"
    return "inactive"


def _detect_loop_pattern(calls: list[Telemetry]) -> tuple[bool, int]:
    """Return (has_loop, max_calls_in_window).
    Buckets calls into 5-minute windows; flags if any window has 5+ calls."""
    if not calls:
        return False, 0
    buckets: dict[int, int] = defaultdict(int)
    for c in calls:
        ts = c.timestamp
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        bucket = int(ts.timestamp()) // 300  # 5-min bucket
        buckets[bucket] += 1
    max_calls = max(buckets.values(), default=0)
    return max_calls >= 5, max_calls


def _count_after_hours(calls: list[Telemetry]) -> int:
    """Count calls outside 7am–8pm UTC."""
    count = 0
    for c in calls:
        hour = c.timestamp.hour
        if hour < 7 or hour >= 20:
            count += 1
    return count


def _compute_risk(signals: dict, capabilities: list | None = None, pii_enabled: bool = False) -> str:
    """Derive critical/high/medium/low risk from capability profile and operational signals.

    Primary drivers (always active):
      - capabilities: tool_execution, cloud_operations, security_operations, etc.
      - operational signals: has_blocked, has_loop, after_hours_calls, blocked_count

    Secondary optional signal (only when pii_enabled=True):
      - has_pii: contributes to risk only when org has pii_detection_enabled
    """
    caps = set(capabilities or [])
    has_tool       = "tool_execution" in caps
    has_write_cap  = bool(caps & {"cloud_operations", "security_operations", "database_access", "code_execution"})
    has_ops_signal = signals.get("has_blocked") or signals.get("has_loop")
    # PII only contributes when explicitly enabled per-org
    has_pii_signal = pii_enabled and signals.get("has_pii")

    # Critical: tool execution + high-blast-radius capability
    if has_tool and bool(caps & {"cloud_operations", "security_operations"}):
        return "critical"
    # Critical: tool execution + write capability + active operational signal
    if has_tool and has_write_cap and has_ops_signal:
        return "critical"
    # High: operational signals (blocked / looping calls)
    if has_ops_signal or has_pii_signal:
        return "high"
    # High: tool execution alone — agent can take external actions
    if has_tool:
        return "high"
    # Medium: retrieval / external integrations / after-hours / blocked history
    if (signals.get("after_hours_calls", 0) > 5 or signals.get("blocked_count", 0) > 0
            or bool(caps & {"retrieval", "external_api", "file_access", "database_access"})):
        return "medium"
    return "low"


def _asset_key(organization_id: int, agent_id_raw: str) -> str:
    return hashlib.sha256(f"{organization_id}:{agent_id_raw}".encode()).hexdigest()


def _derive_asset(agent_name: str, team: str, calls: list[Telemetry], now: datetime) -> dict:
    """Build a single asset dict from all telemetry calls for one agent."""
    if not calls:
        return {}

    calls_sorted = sorted(calls, key=lambda c: c.timestamp, reverse=True)
    last_call    = calls_sorted[0]
    first_call   = calls_sorted[-1]

    last_seen_ts = last_call.timestamp
    if last_seen_ts.tzinfo is None:
        last_seen_ts = last_seen_ts.replace(tzinfo=timezone.utc)
    first_seen_ts = first_call.timestamp
    if first_seen_ts.tzinfo is None:
        first_seen_ts = first_seen_ts.replace(tzinfo=timezone.utc)

    total_cost     = sum(c.cost_usd or 0.0 for c in calls)
    total_tokens   = sum(c.total_tokens or 0 for c in calls)
    total_calls    = len(calls)
    blocked_calls  = [c for c in calls if c.blocked]
    sensitive_calls = [c for c in calls if c.sensitive]

    # Monthly cost (30-day window)
    cutoff_30d = now - timedelta(days=30)
    calls_30d  = [c for c in calls if c.timestamp.replace(tzinfo=timezone.utc if c.timestamp.tzinfo is None else c.timestamp.tzinfo) >= cutoff_30d]
    monthly_cost = sum(c.cost_usd or 0.0 for c in calls_30d)

    # Models used
    models_used = sorted({c.model for c in calls if c.model})

    # Loop detection (over all calls)
    has_loop, loop_max = _detect_loop_pattern(calls)

    # After-hours
    after_hours = _count_after_hours(calls)

    signals = {
        "has_pii":          len(sensitive_calls) > 0,
        "pii_count":        len(sensitive_calls),
        "has_blocked":      len(blocked_calls) > 0,
        "blocked_count":    len(blocked_calls),
        "has_loop":         has_loop,
        "loop_max_window":  loop_max,
        "after_hours_calls": after_hours,
        "estimated_pricing": any(getattr(c, "pricing_estimated", False) for c in calls),
    }

    risk   = _compute_risk(signals, capabilities=[])
    status = _status_from_last_seen(last_seen_ts)

    return {
        "agent_name":    agent_name,
        "team":          team,
        "status":        status,
        "risk":          risk,
        "total_calls":   total_calls,
        "total_cost_usd": round(total_cost, 6),
        "monthly_cost_usd": round(monthly_cost, 6),
        "total_tokens":  total_tokens,
        "models_used":   models_used,
        "last_seen":     last_seen_ts.isoformat(),
        "first_seen":    first_seen_ts.isoformat(),
        "signals":       signals,
        # Governance fields — populated from asset_registry by get_all_assets_derived()
        "asset_key":         None,
        "lifecycle_status":  "unassigned",  # unassigned | managed | retired
        "owner":             None,
        "environment":       None,
        "criticality":       None,
        "business_purpose":  None,
        "claimed_by":        None,
        "claimed_at":        None,
        "registry_source":   None,
    }


def _merge_registry(asset: dict, reg: AssetRegistry) -> None:
    """
    Overwrite governance fields in an asset dict with canonical values from asset_registry.
    Telemetry-derived team/environment are runtime hints; the registry holds truth.
    When the registry field is None (not yet set), the telemetry hint is preserved as
    a fallback so the UI always has something to display.
    """
    asset["lifecycle_status"] = reg.status or "unassigned"
    asset["owner"]            = reg.owner
    asset["criticality"]      = reg.criticality
    asset["business_purpose"] = reg.business_purpose
    asset["claimed_by"]       = reg.claimed_by
    asset["claimed_at"]       = reg.claimed_at.isoformat() if reg.claimed_at else None
    asset["registry_source"]  = reg.source
    # Discovery classification fields (Phase 1 — use getattr for graceful fallback before migration)
    asset["discovery_status"] = getattr(reg, "discovery_status", None) or "verified"
    asset["discovery_source"] = getattr(reg, "discovery_source", None) or "gateway_telemetry"
    asset["discovery_reason"] = getattr(reg, "discovery_reason", None)
    asset["evidence"]         = getattr(reg, "evidence", None)
    asset["confidence_score"] = getattr(reg, "confidence_score", None) or 95.0
    # Canonical team and environment from registry — fall back to telemetry hint only
    # when the registry field has not been set yet (asset not fully claimed).
    if reg.team:
        asset["team"] = reg.team
    if reg.environment:
        asset["environment"] = reg.environment


def get_all_assets_derived(
    db: Session,
    organization_id: int,
    days_lookback: int = 90,
    team_scope: Optional[str] = None,
    include_retired: bool = False,
    demo_mode: bool = False,
) -> list[dict]:
    """
    Main function: read telemetry, group by agent, derive asset inventory.
    Merges governance metadata from asset_registry where available.

    By default retired assets (lifecycle_status='retired') are excluded — they
    remain queryable for audit via include_retired=True.

    Returns a list of asset dicts sorted by monthly_cost_usd desc.
    """
    since = datetime.now(timezone.utc) - timedelta(days=days_lookback)
    q = (
        db.query(Telemetry)
        .filter(
            Telemetry.organization_id == organization_id,
            Telemetry.timestamp >= since,
            Telemetry.is_demo == demo_mode,
        )
    )
    if team_scope:
        q = q.filter(Telemetry.team == team_scope)
    rows = q.all()

    by_agent: dict[str, dict] = {}  # agent_name → {team, calls}
    for row in rows:
        key = row.agent or "unknown"
        if key not in by_agent:
            by_agent[key] = {"team": row.team or "", "calls": []}
        by_agent[key]["calls"].append(row)

    now = datetime.now(timezone.utc)
    assets = []
    for agent_name, data in by_agent.items():
        asset = _derive_asset(agent_name, data["team"], data["calls"], now)
        if asset:
            assets.append(asset)

    # Merge governance metadata from asset_registry (canonical source for all governance fields)
    try:
        registry_rows = (
            db.query(AssetRegistry)
            .filter(
                AssetRegistry.organization_id == organization_id,
                AssetRegistry.is_demo == demo_mode,
            )
            .all()
        )
        registry_by_key: dict[str, AssetRegistry] = {r.asset_key: r for r in registry_rows}
        for asset in assets:
            key = _asset_key(organization_id, asset["agent_name"])
            asset["asset_key"] = key
            reg = registry_by_key.get(key)
            if reg:
                _merge_registry(asset, reg)
    except Exception:
        pass  # registry table may be missing in very old deployments — degrade gracefully

    # Attach derived customer-facing discovery status / evidence / suggestions.
    # Done before the retired filter so STALE/ARCHIVED are derivable.
    for asset in assets:
        _apply_discovery_fields(asset)

    # Exclude retired assets from active inventory by default (rule 9).
    # Retired telemetry rows are preserved and remain queryable via include_retired=True.
    if not include_retired:
        assets = [a for a in assets if a.get("lifecycle_status") != "retired"]

    # Sort by monthly cost descending, then name
    assets.sort(key=lambda a: (-a["monthly_cost_usd"], a["agent_name"]))
    return assets


def get_asset_by_name(
    db: Session,
    organization_id: int,
    agent_name: str,
    days_lookback: int = 90,
    demo_mode: bool = False,
) -> Optional[dict]:
    """
    Get a single agent asset by name, with governance metadata merged from asset_registry.
    agent_name is the agent_id_raw value (X-Guard-Agent header), used as the stable identity.
    """
    since = datetime.now(timezone.utc) - timedelta(days=days_lookback)
    rows = (
        db.query(Telemetry)
        .filter(
            Telemetry.organization_id == organization_id,
            Telemetry.agent == agent_name,
            Telemetry.timestamp >= since,
            Telemetry.is_demo == demo_mode,
        )
        .all()
    )
    if not rows:
        return None
    team = rows[0].team or ""
    now  = datetime.now(timezone.utc)
    asset = _derive_asset(agent_name, team, rows, now)

    # Merge canonical governance metadata from asset_registry
    key = _asset_key(organization_id, agent_name)
    asset["asset_key"] = key
    try:
        reg = db.query(AssetRegistry).filter(
            AssetRegistry.organization_id == organization_id,
            AssetRegistry.asset_key == key,
            AssetRegistry.is_demo == demo_mode,
        ).first()
        if reg:
            _merge_registry(asset, reg)
    except Exception:
        pass

    _apply_discovery_fields(asset)
    return asset


def get_asset_summary(
    db: Session,
    organization_id: int,
    days_lookback: int = 90,
    team_scope: Optional[str] = None,
    demo_mode: bool = False,
) -> dict:
    """KPI metrics for the dashboard summary cards."""
    assets = get_all_assets_derived(db, organization_id, days_lookback, team_scope, demo_mode=demo_mode)
    if not assets:
        return {
            "total_agents":    0,
            "active_agents":   0,
            "dormant_agents":  0,
            "inactive_agents": 0,
            "critical_risk_agents": 0,
            "high_risk_agents":   0,
            "medium_risk_agents": 0,
            "low_risk_agents":    0,
            "total_cost_usd":    0.0,
            "monthly_cost_usd":  0.0,
            "agents_with_pii":   0,
            "agents_with_blocks": 0,
        }
    return {
        "total_agents":    len(assets),
        "active_agents":   sum(1 for a in assets if a["status"] == "active"),
        "dormant_agents":  sum(1 for a in assets if a["status"] == "dormant"),
        "inactive_agents": sum(1 for a in assets if a["status"] == "inactive"),
        "critical_risk_agents": sum(1 for a in assets if a["risk"] == "critical"),
        "high_risk_agents":    sum(1 for a in assets if a["risk"] == "high"),
        "medium_risk_agents":  sum(1 for a in assets if a["risk"] == "medium"),
        "low_risk_agents":     sum(1 for a in assets if a["risk"] == "low"),
        "total_cost_usd":     round(sum(a["total_cost_usd"] for a in assets), 6),
        "monthly_cost_usd":   round(sum(a["monthly_cost_usd"] for a in assets), 6),
        "agents_with_pii":    sum(1 for a in assets if a["signals"]["has_pii"]),
        "agents_with_blocks": sum(1 for a in assets if a["signals"]["has_blocked"]),
    }


def filter_assets(assets: list[dict], filters: dict) -> list[dict]:
    """
    Apply optional filters.
    'team' matches the canonical registry team (falling back to telemetry hint when unset).
    'lifecycle_status' matches the registry lifecycle state (unassigned/managed/retired).
    """
    result = assets
    if filters.get("team"):
        result = [a for a in result if a.get("team") == filters["team"]]
    if filters.get("status"):
        result = [a for a in result if a["status"] == filters["status"]]
    if filters.get("lifecycle_status"):
        result = [a for a in result if a.get("lifecycle_status") == filters["lifecycle_status"]]
    if filters.get("risk"):
        result = [a for a in result if a["risk"] == filters["risk"]]
    if filters.get("owner"):
        result = [a for a in result if a.get("owner") == filters["owner"]]
    if filters.get("search"):
        q = filters["search"].lower()
        result = [a for a in result if q in a["agent_name"].lower() or q in (a.get("team") or "").lower()]
    return result


def sort_assets(
    assets: list[dict],
    sort_by: str = "monthly_cost_usd",
    order: str = "desc",
) -> list[dict]:
    """Sort assets by a field. Valid fields: agent_name, monthly_cost_usd, total_cost_usd,
    risk, status, last_seen, total_calls."""
    valid = {"agent_name", "monthly_cost_usd", "total_cost_usd", "risk", "status", "last_seen", "total_calls"}
    if sort_by not in valid:
        sort_by = "monthly_cost_usd"

    risk_order = {"critical": 0, "high": 1, "medium": 2, "low": 3}
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
    # For string fields, asc is alphabetical; for numeric/enum, desc is default
    if sort_by == "agent_name":
        reverse = order.lower() == "desc"

    return sorted(assets, key=key, reverse=reverse)
