"""
ai-agent-inventory-sdk — lightweight Python SDK for AI Agent Inventory.

Automatically attaches X-Agent-* identity headers to every AI provider
request so the gateway can discover and track agents without manual
per-request configuration.

Install:
    pip install ai-agent-inventory-sdk

Quick start:
    from ai_agent_inventory import OpenAI

    client = OpenAI(
        api_key="org_gateway_key",
        gateway_url="https://your-gateway/v1",
        agent_name="soc-investigation-agent",    # or set SERVICE_NAME env var
        team="Security",
        environment="prod",
    )

    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": "Hello"}],
    )

See also:
    ai_agent_inventory.Anthropic         — Anthropic SDK wrapper
    ai_agent_inventory.wrap_httpx_client — httpx wrapper for LangChain / CrewAI / etc.
"""
from ai_agent_inventory.openai_client import OpenAI
from ai_agent_inventory.anthropic_client import Anthropic
from ai_agent_inventory.httpx_wrapper import wrap_httpx_client

__version__ = "0.1.0"
__all__ = ["OpenAI", "Anthropic", "wrap_httpx_client"]
