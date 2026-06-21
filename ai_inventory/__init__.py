"""
ai_inventory — lightweight Python SDK for AI Agent Inventory gateway.

Automatically attaches X-Agent-* identity headers to every AI provider
request so the gateway can discover and track agents without manual
per-request configuration.

Quick start:
    from ai_inventory.openai_client import OpenAI

    client = OpenAI(
        api_key="gk-...",                        # org-level gateway key
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
    ai_inventory.anthropic_client  — Anthropic SDK wrapper
    ai_inventory.httpx_wrapper     — httpx wrapper for LangChain / CrewAI / etc.
    ai_inventory.context           — raw context collection
    ai_inventory.headers           — raw header generation
"""
__version__ = "0.1.0"
