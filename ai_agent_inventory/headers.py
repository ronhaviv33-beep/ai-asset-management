"""
Build X-Agent-* headers from collected context.
The SDK always sets X-Agent-Source: sdk-python so the gateway can
assign confidence 0.85 and discovery_source=sdk_runtime.
"""
from __future__ import annotations

from ai_agent_inventory.context import collect_context

SDK_SOURCE = "sdk-python"


def build_headers(
    *,
    agent_name: str | None = None,
    team: str | None = None,
    owner: str | None = None,
    environment: str | None = None,
    version: str | None = None,
) -> dict[str, str]:
    """
    Return a dict of X-Agent-* headers ready to pass to any HTTP client.
    Only non-None/non-empty values are included (except X-Agent-Source,
    which is always set so the gateway recognises SDK runtime discovery).
    """
    ctx = collect_context(
        agent_name=agent_name,
        team=team,
        owner=owner,
        environment=environment,
        version=version,
    )

    headers: dict[str, str] = {
        "X-Agent-Source": SDK_SOURCE,
    }

    if ctx["agent_name"]:
        headers["X-Agent-Name"] = ctx["agent_name"]
    if ctx["team"]:
        headers["X-Agent-Team"] = ctx["team"]
    if ctx["owner"]:
        headers["X-Agent-Owner"] = ctx["owner"]
    if ctx["environment"]:
        headers["X-Agent-Environment"] = ctx["environment"]
    if ctx["version"]:
        headers["X-Agent-Version"] = ctx["version"]

    return headers


def debug_print(headers: dict[str, str]) -> None:
    print("[ai-agent-inventory-sdk] attaching headers:")
    for k, v in sorted(headers.items()):
        print(f"  {k}={v}")
