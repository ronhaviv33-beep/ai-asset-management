"""
HTTPX wrapper for framework users (LangChain, LangGraph, CrewAI, AutoGen,
custom clients) who cannot swap their client class.

Usage:
    import httpx
    from ai_agent_inventory import wrap_httpx_client

    base_client = httpx.Client(base_url="https://your-gateway/v1")
    client = wrap_httpx_client(
        base_client,
        agent_name="langchain-rag-agent",
        team="DataEngineering",
        environment="prod",
    )

    # Or pass to LangChain:
    from langchain_openai import ChatOpenAI
    llm = ChatOpenAI(
        openai_api_base="https://your-gateway/v1",
        openai_api_key="org_gateway_key",
        http_client=wrap_httpx_client(
            httpx.Client(),
            agent_name="langchain-rag-agent",
        ),
    )

Per-request headers in the wrapped client still take precedence over the
defaults injected here (httpx merges headers with request-level headers
overriding client-level defaults).
"""
from __future__ import annotations

import httpx

from ai_agent_inventory.headers import build_headers, debug_print


def wrap_httpx_client(
    client: httpx.Client | httpx.AsyncClient,
    *,
    agent_name: str | None = None,
    team: str | None = None,
    owner: str | None = None,
    environment: str | None = None,
    version: str | None = None,
    debug: bool = False,
) -> httpx.Client | httpx.AsyncClient:
    """
    Return a new httpx client of the same type with X-Agent-* headers
    merged into its default headers.  The original client is not mutated.

    Per-request headers passed to client.get/post/request still override
    these defaults via httpx's own merge logic.
    """
    headers = build_headers(
        agent_name=agent_name,
        team=team,
        owner=owner,
        environment=environment,
        version=version,
    )

    if debug:
        debug_print(headers)

    # Build merged headers: SDK defaults first, then existing client headers
    # (so existing client headers win over SDK defaults, not the other way)
    merged = httpx.Headers({**headers, **dict(client.headers)})

    if isinstance(client, httpx.AsyncClient):
        return httpx.AsyncClient(
            base_url=client.base_url,
            headers=merged,
            auth=client.auth,
            timeout=client.timeout,
            follow_redirects=client.follow_redirects,
        )

    return httpx.Client(
        base_url=client.base_url,
        headers=merged,
        auth=client.auth,
        timeout=client.timeout,
        follow_redirects=client.follow_redirects,
    )
