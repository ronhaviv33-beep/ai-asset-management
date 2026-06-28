"""
Discovery Status — customer-facing lifecycle derivation (Pass 1).

Pure, read-time derivation layer. No DB access, no route imports, no schema
changes. Maps the existing registry/telemetry fields onto an explainable
7-state model so the UI can stop showing raw confidence percentages.

The underlying ``confidence_score`` (0-100) stays on the records for internal
use and sorting; this module never exposes it as a customer-facing percentage.

All functions are TOTAL — they tolerate missing keys and never raise — because
they run inside record builders whose callers swallow exceptions (a raise here
would silently drop agents from inventory).
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone

# Customer-facing lifecycle stages, in precedence order (most-terminal first).
STAGES = ("ARCHIVED", "MANAGED", "CLAIMED", "NEEDS_REVIEW", "STALE", "ATTRIBUTED", "DISCOVERED")

# Default staleness threshold (days since last gateway activity). Aligns with
# the existing DORMANT_DAYS window in app/assets.py.
DEFAULT_STALE_DAYS = 30

_STAGE_LABELS = {
    "DISCOVERED":   "Discovered",
    "ATTRIBUTED":   "Attributed",
    "CLAIMED":      "Claimed",
    "MANAGED":      "Managed",
    "NEEDS_REVIEW": "Needs review",
    "STALE":        "Stale",
    "ARCHIVED":     "Archived",
}


# ── Internal helpers ────────────────────────────────────────────────────────

def _parse_evidence(raw) -> dict:
    """Evidence may arrive as a raw JSON string (assets layer) or dict (inventory)."""
    if not raw:
        return {}
    if isinstance(raw, dict):
        return raw
    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        return {}


def _parse_dt(value):
    if not value:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def _last_event_action(evidence: dict) -> str | None:
    events = evidence.get("validation_events")
    if isinstance(events, list) and events:
        last = events[-1]
        if isinstance(last, dict):
            return last.get("action")
    return None


# Defensive secret-masking. Applied as a DENYLIST GATE to every string value
# copied into identity_evidence, so a future raw-token field can't leak.
_SECRET_PATTERNS = (
    re.compile(r"\bsk-[A-Za-z0-9_\-]{6,}"),
    re.compile(r"\bgk-[A-Za-z0-9_\-]{6,}"),
    re.compile(r"\bsk-ant-[A-Za-z0-9_\-]{6,}"),
    re.compile(r"\bAIza[A-Za-z0-9_\-]{10,}"),
    re.compile(r"\bBearer\s+\S+", re.IGNORECASE),
    re.compile(r"\beyJ[A-Za-z0-9_\-]{10,}\."),     # JWT
    re.compile(r"gAAAAA[A-Za-z0-9_\-]{10,}"),       # Fernet token
)
# Substrings in a value that mark it as something we must never surface verbatim.
_FORBIDDEN_SUBSTR = ("authorization:", "authorization=", "x-api-key")


def _mask_secret(value: str, keep: int = 4) -> str:
    tail = value[-keep:] if len(value) > keep else ""
    return "••••" + tail


def _safe_value(value):
    """Return a customer-safe version of a value; mask anything secret-looking."""
    if not isinstance(value, str):
        return value
    low = value.lower()
    if any(sub in low for sub in _FORBIDDEN_SUBSTR):
        return "[redacted]"
    masked = value
    for pat in _SECRET_PATTERNS:
        masked = pat.sub(lambda m: _mask_secret(m.group(0)), masked)
    return masked


def _provider_from_model(model: str) -> str | None:
    if not model:
        return None
    m = model.lower()
    if m.startswith("claude"):
        return "Anthropic"
    if m.startswith("gpt") or m.startswith("o3") or m.startswith("o4"):
        return "OpenAI"
    if m.startswith("gemini"):
        return "Google"
    if "llama" in m or "local" in m:
        return "Local"
    return None


def _has_governance_config(asset: dict) -> bool:
    return bool(asset.get("environment") or asset.get("criticality") or asset.get("business_purpose"))


def _has_attribution(asset: dict, evidence: dict) -> bool:
    if asset.get("owner") and asset.get("owner") != "Unassigned":
        return True
    if asset.get("team") and asset.get("team") != "Unknown":
        return True
    try:
        if float(asset.get("confidence_score") or 0) >= 75:
            return True
    except (TypeError, ValueError):
        pass
    # An API-key label or explicit-header signal in the evidence trail counts.
    for line in evidence.get("evidence", []) or []:
        if isinstance(line, str) and ("caller_name=" in line or "X-Agent-Name" in line):
            return True
    return False


# ── Public API ──────────────────────────────────────────────────────────────

def derive_discovery_status(asset: dict, *, stale_days: int = DEFAULT_STALE_DAYS, now=None) -> tuple[str, str, str]:
    """Return ``(stage, label, reason)`` for one asset/agent record.

    Reads only keys already present on the record; never raises.
    Precedence: ARCHIVED > MANAGED > CLAIMED > NEEDS_REVIEW > STALE > ATTRIBUTED > DISCOVERED.
    STALE is deliberately below CLAIMED/MANAGED so a quiet managed agent stays MANAGED.
    """
    now = now or datetime.now(timezone.utc)
    lifecycle = (asset.get("lifecycle_status") or asset.get("status_lifecycle") or "unassigned")
    evidence = _parse_evidence(asset.get("evidence"))
    claimed_by = asset.get("claimed_by")
    last_event = _last_event_action(evidence)

    # ARCHIVED — explicitly retired.
    if lifecycle == "retired":
        return "ARCHIVED", _STAGE_LABELS["ARCHIVED"], "Archived — removed from active inventory."

    # MANAGED — claimed/managed with an owner and at least one governance attribute.
    owner = asset.get("owner")
    has_owner = bool(owner and owner != "Unassigned")
    if lifecycle == "managed" and has_owner and _has_governance_config(asset):
        return "MANAGED", _STAGE_LABELS["MANAGED"], "Owned and configured (owner + environment/policy)."

    # CLAIMED — a human approved ownership.
    if claimed_by or lifecycle == "managed":
        return "CLAIMED", _STAGE_LABELS["CLAIMED"], "Ownership approved by a user."

    # NEEDS_REVIEW — partial/conflicting identity, unless a reviewer dismissed it.
    dismissed = last_event == "ignored"
    needs_review = (asset.get("discovery_status") == "potential") or bool(evidence.get("needs_admin_review"))
    if needs_review and not dismissed:
        reason = ("Discovered via platform scan — confirm this is a real agent."
                  if asset.get("discovery_status") == "potential"
                  else "Partial or conflicting identity evidence.")
        return "NEEDS_REVIEW", _STAGE_LABELS["NEEDS_REVIEW"], reason

    # STALE — observed before but quiet for a while.
    last_seen = _parse_dt(asset.get("last_seen") or asset.get("last_seen_at"))
    if last_seen is not None and (now - last_seen).days > stale_days:
        return "STALE", _STAGE_LABELS["STALE"], f"No activity seen in over {stale_days} days."

    # ATTRIBUTED — strong identity evidence but not yet claimed.
    if _has_attribution(asset, evidence):
        return "ATTRIBUTED", _STAGE_LABELS["ATTRIBUTED"], "Associated with a team, owner, or key from traffic."

    # DISCOVERED — observed via the gateway, not yet attributed.
    return "DISCOVERED", _STAGE_LABELS["DISCOVERED"], "Observed through gateway traffic."


def build_identity_evidence(asset: dict, identity_hints: dict | None = None) -> dict:
    """Build a customer-safe identity-evidence object.

    Surfaces *why* an agent was identified, never raw secrets. Every string
    value passes through a masking denylist gate before it is returned.
    """
    evidence = _parse_evidence(asset.get("evidence"))
    models = asset.get("models_used") or []
    provider = _provider_from_model(models[0]) if models else None

    signals = [s for s in (evidence.get("evidence") or []) if isinstance(s, str)]

    out = {
        "source": asset.get("discovery_source") or "gateway",
        "resolution_method": evidence.get("resolution_method"),
        "signals": [_safe_value(s) for s in signals],
        "provider": provider,
        "models": list(models),
        "first_seen_at": asset.get("first_seen") or asset.get("first_seen_at"),
        "last_seen_at": asset.get("last_seen") or asset.get("last_seen_at"),
        "request_count": asset.get("total_calls"),
    }
    if evidence.get("agent_version"):
        out["agent_version"] = evidence.get("agent_version")
    if identity_hints:
        for k, v in identity_hints.items():
            out.setdefault(k, v)

    # Final safety pass: mask any secret-looking string value (defense in depth).
    return {k: (_safe_value(v) if isinstance(v, str) else
                [_safe_value(i) for i in v] if isinstance(v, list) else v)
            for k, v in out.items()}


def derive_suggestions(asset: dict, identity_hints: dict | None = None) -> dict:
    """Derive suggested owner/team/environment/tags from existing signals.

    Read-time only — nothing is persisted. Returns empty strings/lists when no
    signal is available so the UI can hide empty suggestions.
    """
    evidence = _parse_evidence(asset.get("evidence"))

    owner = asset.get("owner")
    suggested_owner = owner if (owner and owner != "Unassigned") else (asset.get("claimed_by") or "")

    team = asset.get("team")
    suggested_team = team if (team and team != "Unknown") else ""

    env = asset.get("environment")
    suggested_environment = env if (env and env != "Unknown") else ""

    tags: list[str] = []
    for cap in (asset.get("capabilities") or []):
        if isinstance(cap, str):
            tags.append(cap)
    if suggested_environment:
        tags.append(suggested_environment)

    reasons = []
    if suggested_owner:
        reasons.append("owner from gateway key / prior ownership")
    if suggested_team:
        reasons.append("team from traffic attribution")
    if suggested_environment:
        reasons.append("environment inferred from runtime metadata")
    if evidence.get("resolution_method"):
        reasons.append(f"identity via {evidence['resolution_method']}")

    return {
        "suggested_owner": suggested_owner,
        "suggested_team": suggested_team,
        "suggested_environment": suggested_environment,
        "suggested_tags": sorted(set(tags)),
        "suggestion_reason": "; ".join(reasons),
    }
