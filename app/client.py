import os
import time
from dataclasses import dataclass
from dotenv import load_dotenv
from openai import AsyncOpenAI

load_dotenv()


# ─── Provider routing ─────────────────────────────────────────────────────────
# Each provider gets its own lazy singleton client.
# Add a new block here when you onboard a new provider.

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

    if provider not in _clients:
        if provider == "openai":
            key = os.getenv("OPENAI_API_KEY", "")
            if not key or key == "your-openai-api-key-here":
                raise RuntimeError("OPENAI_API_KEY is not set in .env")
            _clients["openai"] = AsyncOpenAI(api_key=key)

        elif provider == "anthropic":
            key = os.getenv("ANTHROPIC_API_KEY", "")
            if not key:
                raise RuntimeError("ANTHROPIC_API_KEY is not set in .env")
            # Anthropic exposes an OpenAI-compatible endpoint
            _clients["anthropic"] = AsyncOpenAI(
                api_key=key,
                base_url="https://api.anthropic.com/v1",
            )

        elif provider == "google":
            key = os.getenv("GOOGLE_API_KEY", "")
            if not key:
                raise RuntimeError("GOOGLE_API_KEY is not set in .env")
            # Google AI Studio exposes an OpenAI-compatible endpoint
            _clients["google"] = AsyncOpenAI(
                api_key=key,
                base_url="https://generativelanguage.googleapis.com/v1beta/openai",
            )

        elif provider == "local":
            # Ollama / vLLM / LM Studio — no auth needed
            base_url = os.getenv("LOCAL_LLM_URL", "http://localhost:11434/v1")
            _clients["local"] = AsyncOpenAI(
                api_key="local",
                base_url=base_url,
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
    messages: list[dict],  # full history: [{"role": "user"|"assistant"|"system", "content": "..."}]
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
