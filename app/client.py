import os
import json
import time
import ipaddress
import socket
from urllib.parse import urlparse
from dataclasses import dataclass
from typing import AsyncIterator
from dotenv import load_dotenv
from openai import AsyncOpenAI

load_dotenv()

# ─── Per-org client cache ─────────────────────────────────────────────────────
# Keyed by (organization_id, provider) so each org's clients are independent.
_org_clients: dict[tuple[int, str], AsyncOpenAI] = {}


# ─── SSRF guard for self-hosted model URL ─────────────────────────────────────

def _validate_local_url(url: str) -> str:
    """
    Reject LOCAL_LLM_URL values that resolve to cloud metadata or internal
    infrastructure, unless explicitly allowed via LOCAL_LLM_ALLOW_PRIVATE=true
    (intended for on-box Ollama where localhost is the whole point).
    """
    allow_private = os.getenv("LOCAL_LLM_ALLOW_PRIVATE", "true").lower() == "true"
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise RuntimeError(f"LOCAL_LLM_URL must be http(s), got: {parsed.scheme}")
    host = parsed.hostname or ""
    # Always block the cloud metadata endpoint outright
    BLOCKED = {"169.254.169.254", "metadata.google.internal", "100.100.100.200"}
    if host in BLOCKED:
        raise RuntimeError("LOCAL_LLM_URL points at a cloud metadata endpoint — blocked")
    if not allow_private:
        try:
            ip = ipaddress.ip_address(socket.gethostbyname(host))
            if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:
                raise RuntimeError(f"LOCAL_LLM_URL resolves to a private/internal address ({ip})")
        except socket.gaierror:
            raise RuntimeError(f"LOCAL_LLM_URL host cannot be resolved: {host}")
    return url


# ─── Provider routing ─────────────────────────────────────────────────────────

_clients: dict[str, AsyncOpenAI] = {}


def _provider_for(model: str) -> str:
    if model.startswith("claude"):
        return "anthropic"
    if model.startswith("gemini"):
        return "google"
    if model.startswith("llama") or model.endswith("-local"):
        return "local"
    return "openai"


def _get_client(model: str) -> AsyncOpenAI:
    provider = _provider_for(model)

    # Caps a hung upstream provider so the gateway never blocks a caller forever.
    timeout = float(os.getenv("GATEWAY_LLM_TIMEOUT_SECS", "30"))

    if provider not in _clients:
        if provider == "openai":
            key = os.getenv("OPENAI_API_KEY", "")
            if not key or key == "your-openai-api-key-here":
                raise RuntimeError("OPENAI_API_KEY is not set in .env")
            _clients["openai"] = AsyncOpenAI(api_key=key, timeout=timeout)

        elif provider == "anthropic":
            key = os.getenv("ANTHROPIC_API_KEY", "")
            if not key:
                raise RuntimeError("ANTHROPIC_API_KEY is not set in .env")
            _clients["anthropic"] = AsyncOpenAI(
                api_key=key,
                base_url="https://api.anthropic.com/v1",
                timeout=timeout,
            )

        elif provider == "google":
            key = os.getenv("GOOGLE_API_KEY", "")
            if not key:
                raise RuntimeError("GOOGLE_API_KEY is not set in .env")
            _clients["google"] = AsyncOpenAI(
                api_key=key,
                base_url="https://generativelanguage.googleapis.com/v1beta/openai",
                timeout=timeout,
            )

        elif provider == "local":
            base_url = _validate_local_url(os.getenv("LOCAL_LLM_URL", "http://localhost:11434/v1"))
            _clients["local"] = AsyncOpenAI(
                api_key="local",
                base_url=base_url,
                timeout=timeout,
            )

    return _clients[provider]


def get_client_for_org(organization_id: int, model: str, db) -> AsyncOpenAI:
    """
    Resolve the provider client for a specific organization.

    Looks up the org's encrypted credential in provider_credentials, decrypts
    it, and returns an AsyncOpenAI client keyed to that org+provider pair.

    Raises HTTPException 402 (with a clear message) if the org has no credential
    for this provider — never falls back to the platform env-var keys.

    The only org that reaches env-var keys is the platform (internal) org,
    and only via the standard _get_client() path, not through this function.
    """
    from fastapi import HTTPException
    from app.models import ProviderCredential, Organization, decrypt_credential

    provider = _provider_for(model)
    cache_key = (organization_id, provider)

    if cache_key in _org_clients:
        return _org_clients[cache_key]

    timeout = float(os.getenv("GATEWAY_LLM_TIMEOUT_SECS", "30"))

    cred = db.query(ProviderCredential).filter(
        ProviderCredential.organization_id == organization_id,
        ProviderCredential.provider == provider,
        ProviderCredential.is_active == True,  # noqa: E712
    ).first()

    if cred is None:
        org = db.query(Organization).filter(Organization.id == organization_id).first()
        org_name = org.name if org else f"org:{organization_id}"
        raise HTTPException(
            status_code=402,
            detail=(
                f"No {provider} credential configured for organization '{org_name}'. "
                f"An admin must add the {provider.upper()}_API_KEY in Settings → Provider Keys."
            ),
        )

    try:
        api_key = decrypt_credential(cred.encrypted_key)
    except Exception:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to decrypt {provider} credential. Contact your administrator.",
        )

    if provider == "openai":
        client = AsyncOpenAI(api_key=api_key, timeout=timeout)
    elif provider == "anthropic":
        client = AsyncOpenAI(
            api_key=api_key,
            base_url="https://api.anthropic.com/v1",
            timeout=timeout,
        )
    elif provider == "google":
        client = AsyncOpenAI(
            api_key=api_key,
            base_url="https://generativelanguage.googleapis.com/v1beta/openai",
            timeout=timeout,
        )
    elif provider == "local":
        base_url = cred.base_url or os.getenv("LOCAL_LLM_URL", "http://localhost:11434/v1")
        base_url = _validate_local_url(base_url)
        client = AsyncOpenAI(api_key="local", base_url=base_url, timeout=timeout)
    else:
        raise HTTPException(status_code=400, detail=f"Unknown provider: {provider}")

    _org_clients[cache_key] = client
    return client


def invalidate_org_client(organization_id: int, provider: str) -> None:
    """Call this after a credential is updated or revoked."""
    _org_clients.pop((organization_id, provider), None)


# ─── Result dataclass ─────────────────────────────────────────────────────────

@dataclass
class CompletionResult:
    content: str
    model: str
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    latency_ms: float


# ─── Unified completion call ──────────────────────────────────────────────────

async def complete(
    prompt: str,
    model: str = "gpt-4o-mini",
    system_prompt: str | None = None,
) -> CompletionResult:
    messages = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    messages.append({"role": "user", "content": prompt})

    client = _get_client(model)

    t0 = time.perf_counter()
    resp = await client.chat.completions.create(model=model, messages=messages)
    latency_ms = (time.perf_counter() - t0) * 1000

    choice = resp.choices[0].message.content or ""
    usage  = resp.usage

    return CompletionResult(
        content=choice,
        model=model,
        prompt_tokens=usage.prompt_tokens,
        completion_tokens=usage.completion_tokens,
        total_tokens=usage.total_tokens,
        latency_ms=round(latency_ms, 2),
    )


# ─── Multi-turn chat call ─────────────────────────────────────────────────────

async def chat_complete(
    messages: list[dict],
    model: str = "gpt-4o-mini",
) -> CompletionResult:
    client = _get_client(model)

    t0 = time.perf_counter()
    resp = await client.chat.completions.create(model=model, messages=messages)
    latency_ms = (time.perf_counter() - t0) * 1000

    choice = resp.choices[0].message.content or ""
    usage  = resp.usage

    return CompletionResult(
        content=choice,
        model=model,
        prompt_tokens=usage.prompt_tokens,
        completion_tokens=usage.completion_tokens,
        total_tokens=usage.total_tokens,
        latency_ms=round(latency_ms, 2),
    )


# ─── Proxy passthrough — forwards the entire request body as-is ───────────────
# Used by /v1/chat/completions and /v1/messages so tool_calls, temperature,
# response_format, seed, etc. all reach the upstream provider unchanged.

async def proxy_chat_complete(body: dict, org_client: AsyncOpenAI) -> dict:
    """
    Forward an entire OpenAI-shaped request body to the upstream provider.
    org_client must be the org-resolved client from get_client_for_org().
    There is no env-var fallback — callers must resolve the client before calling this.
    """
    model  = body.get("model", "gpt-4o-mini")
    client = org_client

    t0   = time.perf_counter()
    resp = await client.chat.completions.create(**body)
    resp_dict = resp.model_dump()
    resp_dict["_latency_ms"] = round((time.perf_counter() - t0) * 1000, 2)
    return resp_dict


async def proxy_chat_stream(
    body: dict,
    request=None,
    org_client: AsyncOpenAI = None,
) -> AsyncIterator[str]:
    """
    Stream an OpenAI-shaped request to the upstream provider and relay SSE chunks.
    org_client must be the org-resolved client from get_client_for_org().
    There is no env-var fallback — callers must resolve the client before calling this.
    """
    if org_client is None:
        raise RuntimeError("proxy_chat_stream called with no org_client — org resolution is required")
    model  = body.get("model", "gpt-4o-mini")
    client = org_client

    stream_body = {**body, "stream": True, "stream_options": {"include_usage": True}}

    stream = await client.chat.completions.create(**stream_body)
    try:
        async for chunk in stream:
            # Check for client disconnect before sending each chunk
            if request is not None and await request.is_disconnected():
                await stream.response.aclose()
                return

            chunk_dict = chunk.model_dump()

            # The final chunk carries usage when stream_options.include_usage=True
            if chunk_dict.get("usage"):
                u = chunk_dict["usage"]
                yield {"_guard_usage": {
                    "prompt_tokens":     u.get("prompt_tokens", 0),
                    "completion_tokens": u.get("completion_tokens", 0),
                    "total_tokens":      u.get("total_tokens", 0),
                    "model":             chunk_dict.get("model", model),
                }}

            yield f"data: {json.dumps(chunk_dict, default=str)}\n\n"

        yield "data: [DONE]\n\n"
    except Exception:
        try:
            await stream.response.aclose()
        except Exception:
            pass
        raise
