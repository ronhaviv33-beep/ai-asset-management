"""
OpenAI-compatible wrapper that routes requests through the AI Agent Inventory
gateway and attaches X-Agent-* identity headers automatically.

Usage (explicit params):
    from ai_agent_inventory import OpenAI

    client = OpenAI(
        api_key="org_gateway_key",
        gateway_url="https://your-gateway/v1",
        agent_name="soc-investigation-agent",
        team="Security",
        environment="prod",
    )

Usage (env-var driven):
    # Set SERVICE_NAME=soc-investigation-agent TEAM=Security ENVIRONMENT=prod
    client = OpenAI(api_key="org_gateway_key", gateway_url="https://your-gateway/v1")

Per-request override — explicit X-Agent-Name wins over SDK default:
    client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[...],
        extra_headers={"X-Agent-Name": "phishing-agent"},
    )
"""
from __future__ import annotations

import openai as _openai

from ai_agent_inventory.headers import build_headers, debug_print


class OpenAI(_openai.OpenAI):
    """
    Drop-in replacement for openai.OpenAI that routes through the gateway
    and attaches X-Agent-* headers on every request.

    All normal openai.OpenAI parameters are accepted as-is.
    Extra keyword arguments: gateway_url, agent_name, team, owner,
    environment, version, debug.
    """

    def __init__(
        self,
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
    ) -> None:
        headers = build_headers(
            agent_name=agent_name,
            team=team,
            owner=owner,
            environment=environment,
            version=version,
        )

        if debug:
            debug_print(headers)

        # Merge with any caller-supplied default_headers
        existing = kwargs.pop("default_headers", {}) or {}
        merged = {**headers, **existing}  # caller-supplied wins if duplicated

        super().__init__(
            api_key=api_key,
            base_url=gateway_url,
            default_headers=merged,
            **kwargs,
        )
