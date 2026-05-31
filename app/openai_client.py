import os
import time
from dataclasses import dataclass
from dotenv import load_dotenv
from openai import AsyncOpenAI

load_dotenv()

_client: AsyncOpenAI | None = None


def get_client() -> AsyncOpenAI:
    global _client
    if _client is None:
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key or api_key == "your-openai-api-key-here":
            raise RuntimeError("OPENAI_API_KEY is not configured in .env")
        _client = AsyncOpenAI(api_key=api_key)
    return _client


@dataclass
class CompletionResult:
    content: str
    model: str
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    latency_ms: float


async def complete(
    prompt: str,
    model: str = "gpt-4o-mini",
    system_prompt: str | None = None,
) -> CompletionResult:
    messages = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    messages.append({"role": "user", "content": prompt})

    client = get_client()
    t0 = time.perf_counter()
    resp = await client.chat.completions.create(model=model, messages=messages)
    latency_ms = (time.perf_counter() - t0) * 1000

    choice = resp.choices[0].message.content or ""
    usage = resp.usage

    return CompletionResult(
        content=choice,
        model=resp.model,
        prompt_tokens=usage.prompt_tokens,
        completion_tokens=usage.completion_tokens,
        total_tokens=usage.total_tokens,
        latency_ms=round(latency_ms, 2),
    )
