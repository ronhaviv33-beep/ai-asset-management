from datetime import datetime
from pydantic import BaseModel, Field


class AskRequest(BaseModel):
    team: str = Field(..., examples=["SOC"])
    agent: str = Field(..., examples=["IR-Agent"])
    prompt: str = Field(..., examples=["Analyze this phishing email"])
    model: str = Field(default="gpt-4o-mini", examples=["gpt-4o-mini"])
    system_prompt: str | None = Field(default=None)


class AskResponse(BaseModel):
    response: str
    model: str
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    latency_ms: float
    cost_usd: float
    telemetry_id: int


class TelemetryRecord(BaseModel):
    id: int
    team: str
    agent: str
    model: str
    prompt: str
    response: str
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    latency_ms: float
    cost_usd: float
    timestamp: datetime

    model_config = {"from_attributes": True}


class TelemetrySummary(BaseModel):
    total_requests: int
    total_tokens: int
    total_cost_usd: float
    avg_latency_ms: float
    models_used: list[str]
    teams: list[str]
