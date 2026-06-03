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

async def proxy_chat_complete(body: dict) -> dict:
    """
    Forward an entire OpenAI-shaped request body to the upstream provider.
    Returns the raw model_dump() of the response, preserving tool_calls and
    all fields the caller sent (temperature, seed, response_format, etc.).
    """
    model  = body.get("model", "gpt-4o-mini")
    client = _get_client(model)

    t0   = time.perf_counter()
    resp = await client.chat.completions.create(**body)
    resp_dict = resp.model_dump()
    resp_dict["_latency_ms"] = round((time.perf_counter() - t0) * 1000, 2)
    return resp_dict


async def proxy_chat_stream(
    body: dict,
    request=None,
) -> AsyncIterator[str]:
    """
    Stream an OpenAI-shaped request to the upstream provider and relay SSE
    chunks as they arrive.  Persists telemetry via the usage chunk at the end.

    Yields raw SSE lines ("data: {...}\\n\\n" and "data: [DONE]\\n\\n").
    Yields a special sentinel dict at the end for the caller to use for telemetry:
      {"_guard_usage": {"prompt_tokens": ..., "completion_tokens": ..., "total_tokens": ..., "model": ...}}
    """
    model  = body.get("model", "gpt-4o-mini")
    client = _get_client(model)

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
