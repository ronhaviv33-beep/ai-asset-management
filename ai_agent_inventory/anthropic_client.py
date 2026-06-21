"""
Anthropic-compatible wrapper that routes requests through the AI Agent Inventory
gateway and attaches X-Agent-* identity headers automatically.

Usage (explicit params):
    from ai_agent_inventory import Anthropic

    client = Anthropic(
        api_key="org_gateway_key",
        gateway_url="https://your-gateway",   # no /v1 — Anthropic SDK adds it
        agent_name="document-summariser",
        team="Legal",
        environment="prod",
    )

Usage (env-var driven):
    # Set SERVICE_NAME=document-summariser TEAM=Legal ENVIRONMENT=prod
    client = Anthropic(api_key="org_gateway_key", gateway_url="https://your-gateway")

Per-request override:
    client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=1024,
        messages=[...],
        extra_headers={"X-Agent-Name": "other-agent"},
    )

Note: requires the ``anthropic`` package (pip install ai-agent-inventory-sdk anthropic).
"""
from __future__ import annotations

from ai_agent_inventory.headers import build_headers, debug_print


def Anthropic(
    *,
    api_key: str,
    gateway_url: str,
    agent_name: str | None = None,
    team: str | None = None,
    owner: str | None = None,
    environment: str | None = None,
    version: str | None = None,
    debug: bool = False,
    **kwargs,
):
    """
    Return an anthropic.Anthropic client routed through the gateway with
    X-Agent-* headers pre-attached.  Implemented as a factory so the import
    of the ``anthropic`` package is deferred (avoids hard dependency).
    """
    try:
        import anthropic as _anthropic
    except ImportError as exc:
        raise ImportError(
            "The 'anthropic' package is required. Install it with: pip install anthropic"
        ) from exc

    headers = build_headers(
        agent_name=agent_name,
        team=team,
        owner=owner,
        environment=environment,
        version=version,
    )

    if debug:
        debug_print(headers)

    existing = kwargs.pop("default_headers", {}) or {}
    merged = {**headers, **existing}

    return _anthropic.Anthropic(
        api_key=api_key,
        base_url=gateway_url,
        default_headers=merged,
        **kwargs,
    )
