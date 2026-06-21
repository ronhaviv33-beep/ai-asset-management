"""
Identity Resolver — derives stable agent identity from runtime request context.

The gateway never requires customers to register agents manually.
This module tries each signal source in confidence order and returns the
best available identity, along with a confidence score and explanation.

Priority order (highest → lowest):
  1. Explicit X-Agent-* or X-Guard-* headers (customer-provided override)
  2. Meaningful API key scope  (caller_name set on the key itself)
  3. Known AI framework fingerprint in User-Agent
  4. Meaningful request-origin hostname / service label
  5. Non-generic User-Agent library name
  6. Stable fallback hash (triggers admin-review flag)

The resolver never raises — any failure falls through to the next source.
"""
from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field


# ---------------------------------------------------------------------------
# Result type
# ---------------------------------------------------------------------------

@dataclass
class ResolvedIdentity:
    agent_name:        str
    agent_key:         str            # SHA-256(org_id:agent_name) — dedup key
    team:              str | None = None
    owner:             str | None = None
    environment:       str | None = None
    source:            str = "gateway_runtime"
    confidence_score:  float = 0.15
    resolution_method: str = "fallback_hash"
    needs_admin_review: bool = True
    evidence:          list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Framework fingerprints (User-Agent / body metadata)
# ---------------------------------------------------------------------------

_FRAMEWORK_PATTERNS: list[tuple[str, str]] = [
    (r"langchain",         "langchain-agent"),
    (r"langgraph",         "langgraph-agent"),
    (r"crewai",            "crewai-agent"),
    (r"autogen",           "autogen-agent"),
    (r"openai-agents",     "openai-agents-sdk"),
    (r"n8n",               "n8n-workflow"),
    (r"zapier",            "zapier-automation"),
    (r"copilot.studio",    "copilot-studio-bot"),
    (r"semantic.kernel",   "semantic-kernel-agent"),
    (r"llamaindex",        "llamaindex-agent"),
    (r"haystack",          "haystack-pipeline"),
]

_GENERIC_UA = re.compile(
    r"^(python-requests|node-fetch|axios|curl|openai-python|openai|anthropic|"
    r"anthropic-python|httpx|aiohttp|got|undici|fetch)(/[\d.]+)?$",
    re.I,
)


def _detect_framework(ua: str) -> str | None:
    if not ua:
        return None
    ua_lower = ua.lower()
    for pattern, label in _FRAMEWORK_PATTERNS:
        if re.search(pattern, ua_lower):
            return label
    return None


def _is_generic_client(ua: str) -> bool:
    return bool(_GENERIC_UA.match(ua.strip())) if ua else True


# ---------------------------------------------------------------------------
# Normalisation helpers
# ---------------------------------------------------------------------------

def _normalize(name: str) -> str:
    """Lowercase, collapse whitespace/underscores to hyphens, strip specials."""
    name = name.lower().strip()
    name = re.sub(r"[\s_]+", "-", name)
    name = re.sub(r"[^a-z0-9\-.]", "", name)
    name = re.sub(r"-{2,}", "-", name).strip("-")
    return name or "unknown-agent"


def _stable_key(org_id: int, agent_name: str) -> str:
    return hashlib.sha256(f"{org_id}:{agent_name}".encode()).hexdigest()


def _fallback_name(
    org_id: int,
    api_key_id: str | None,
    ua: str,
    source_ip: str,
) -> str:
    """
    Produce a stable, reproducible name for a request with no usable signals.
    The hash is based on org + key + ua + ip so repeated calls from the same
    unknown source converge to the same agent record.
    """
    parts = [str(org_id)]
    if api_key_id:
        parts.append(api_key_id[-8:])
    if ua and not _is_generic_client(ua):
        parts.append(_normalize(ua.split("/")[0])[:20])
    if source_ip:
        parts.append(source_ip.replace(".", "-").replace(":", "-")[:15])
    digest = hashlib.sha256(":".join(parts).encode()).hexdigest()[:8]
    return f"unknown-agent-{digest}"


# ---------------------------------------------------------------------------
# Main resolver
# ---------------------------------------------------------------------------

def resolve_identity(
    org_id: int,
    *,
    headers: dict[str, str],          # caller must lowercase all keys
    caller_name: str | None = None,
    caller_team: str | None = None,
    caller_env:  str | None = None,
    api_key_id:  str | None = None,
    user_agent:  str = "",
    source_ip:   str = "",
    host:        str = "",
) -> ResolvedIdentity:
    """
    Derive agent identity from available runtime context.
    Never raises — any error falls through to the fallback.

    Callers should pass headers with all keys lower-cased.
    """
    evidence: list[str] = []

    # ── 1a. SDK-populated headers (X-Agent-Source starts with "sdk-") ────────
    #        Confidence 0.85 — identity auto-derived from runtime env vars.
    #        Any sdk- prefix is recognised (sdk-python, sdk-typescript, …).
    agent_source = headers.get("x-agent-source", "")
    explicit_name = (
        headers.get("x-agent-name")
        or headers.get("x-guard-agent")
    )
    if explicit_name and explicit_name.strip() and agent_source.lower().startswith("sdk-"):
        name        = _normalize(explicit_name)
        team        = (headers.get("x-agent-team")
                       or headers.get("x-guard-team")
                       or caller_team)
        owner       = headers.get("x-agent-owner")
        environment = (headers.get("x-agent-environment")
                       or headers.get("x-guard-environment")
                       or caller_env)
        evidence.append(f"SDK header: X-Agent-Name={explicit_name!r} (source={agent_source!r})")
        return ResolvedIdentity(
            agent_name=name,
            agent_key=_stable_key(org_id, name),
            team=team,
            owner=owner,
            environment=environment,
            source="sdk_runtime",
            confidence_score=0.85,
            resolution_method="sdk_runtime",
            needs_admin_review=False,
            evidence=evidence,
        )

    # ── 1b. Explicit headers — customer-written override, highest confidence ──
    if explicit_name and explicit_name.strip():
        name        = _normalize(explicit_name)
        team        = (headers.get("x-agent-team")
                       or headers.get("x-guard-team")
                       or caller_team)
        owner       = headers.get("x-agent-owner")
        environment = (headers.get("x-agent-environment")
                       or headers.get("x-guard-environment")
                       or caller_env)
        source      = agent_source or "explicit_header"
        evidence.append(f"Explicit header: X-Agent-Name={explicit_name!r}")
        return ResolvedIdentity(
            agent_name=name,
            agent_key=_stable_key(org_id, name),
            team=team,
            owner=owner,
            environment=environment,
            source=source,
            confidence_score=0.95,
            resolution_method="explicit_headers",
            needs_admin_review=False,
            evidence=evidence,
        )

    # ── 2. API key scope — key's own service/app name ───────────────────────
    if caller_name and caller_name.strip() and caller_name not in ("unknown", "api-key", ""):
        name = _normalize(caller_name)
        evidence.append(f"API key scope: caller_name={caller_name!r}")
        return ResolvedIdentity(
            agent_name=name,
            agent_key=_stable_key(org_id, name),
            team=caller_team,
            environment=caller_env,
            source="api_key_scope",
            confidence_score=0.75,
            resolution_method="api_key_scope",
            needs_admin_review=False,
            evidence=evidence,
        )

    # ── 3. Framework detection from User-Agent ───────────────────────────────
    ua = user_agent or headers.get("user-agent", "")
    framework = _detect_framework(ua)
    if framework:
        name = framework
        evidence.append(f"AI framework detected in User-Agent: {framework!r}")
        evidence.append(f"User-Agent: {ua!r}")
        return ResolvedIdentity(
            agent_name=name,
            agent_key=_stable_key(org_id, name),
            team=caller_team,
            environment=caller_env,
            source="framework_metadata",
            confidence_score=0.65,
            resolution_method="framework_metadata",
            needs_admin_review=True,
            evidence=evidence,
        )

    # ── 4. Request origin — meaningful hostname / service label ──────────────
    candidate_host = host or headers.get("host", "")
    clean_host = re.sub(r":\d+$", "", candidate_host)
    is_ip = bool(re.match(r"^\d{1,3}(\.\d{1,3}){3}$", clean_host))
    is_local = clean_host in ("localhost", "127.0.0.1", "::1", "")
    if clean_host and not is_ip and not is_local:
        labels = clean_host.split(".")
        candidate_name = _normalize(labels[0])
        if len(candidate_name) >= 4:
            evidence.append(f"Request host: {candidate_host!r}")
            return ResolvedIdentity(
                agent_name=candidate_name,
                agent_key=_stable_key(org_id, candidate_name),
                team=caller_team,
                environment=caller_env,
                source="request_origin",
                confidence_score=0.45,
                resolution_method="request_origin",
                needs_admin_review=True,
                evidence=evidence,
            )

    # ── 5. Non-generic User-Agent library name ───────────────────────────────
    if ua and not _is_generic_client(ua):
        name = _normalize(ua.split("/")[0])[:40]
        if name and len(name) >= 3 and name != "unknown-agent":
            evidence.append(f"Non-generic User-Agent: {ua!r}")
            return ResolvedIdentity(
                agent_name=name,
                agent_key=_stable_key(org_id, name),
                team=caller_team,
                environment=caller_env,
                source="user_agent",
                confidence_score=0.30,
                resolution_method="user_agent",
                needs_admin_review=True,
                evidence=evidence,
            )

    # ── 6. Fallback hash — stable, requires admin review ─────────────────────
    name = _fallback_name(org_id, api_key_id, ua, source_ip)
    evidence.append("No reliable identity signal — generated stable fallback hash")
    if ua:
        evidence.append(f"User-Agent: {ua!r}")
    if source_ip:
        evidence.append(f"Source IP: {source_ip}")
    return ResolvedIdentity(
        agent_name=name,
        agent_key=_stable_key(org_id, name),
        team=caller_team,
        environment=caller_env,
        source="fallback_hash",
        confidence_score=0.15,
        resolution_method="fallback_hash",
        needs_admin_review=True,
        evidence=evidence,
    )
