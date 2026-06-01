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
    budget_warnings: list[dict] = []
    security_findings: list[dict] = []


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
    sensitive: bool = False
    sensitive_findings: str | None = None
    blocked: bool = False
    block_reason: str | None = None
    timestamp: datetime

    model_config = {"from_attributes": True}


class TelemetrySummary(BaseModel):
    total_requests: int
    total_tokens: int
    total_cost_usd: float
    avg_latency_ms: float
    models_used: list[str]
    teams: list[str]


# ── Budget ────────────────────────────────────────────────────────────────────

class BudgetRuleCreate(BaseModel):
    team: str = Field(..., examples=["SOC"])
    agent: str | None = Field(default=None, examples=["IR-Agent"])
    limit_usd: float = Field(..., gt=0, examples=[10.0])
    period: str = Field(default="monthly", pattern="^(daily|monthly)$")
    action: str = Field(default="alert", pattern="^(alert|block)$")


class BudgetRuleOut(BaseModel):
    id: int
    team: str
    agent: str | None
    limit_usd: float
    period: str
    action: str
    created_at: datetime

    model_config = {"from_attributes": True}


class BudgetStatusItem(BaseModel):
    id: int
    team: str
    agent: str | None
    limit_usd: float
    spend_usd: float
    pct: float
    period: str
    action: str
    status: str  # "ok" | "warning" | "blocked"


# ── Policy ────────────────────────────────────────────────────────────────────

class PolicyRuleCreate(BaseModel):
    team: str = Field(..., examples=["SOC"])
    rule_type: str = Field(..., pattern="^(allow_model|block_model)$", examples=["allow_model"])
    value: str = Field(..., examples=["gpt-4o-mini"])


class PolicyRuleOut(BaseModel):
    id: int
    team: str
    rule_type: str
    value: str
    created_at: datetime

    model_config = {"from_attributes": True}


# ── Security ──────────────────────────────────────────────────────────────────

# ── Chat ──────────────────────────────────────────────────────────────────────

class ChatMessage(BaseModel):
    role: str   # "user" | "assistant" | "system"
    content: str


class ChatRequest(BaseModel):
    team: str = Field(..., examples=["SOC"])
    agent: str = Field(..., examples=["IR-Agent"])
    model: str = Field(default="gpt-4o-mini", examples=["gpt-4o-mini"])
    messages: list[ChatMessage]          # full conversation history
    system_prompt: str | None = Field(default=None)


class ChatResponse(BaseModel):
    reply: str
    model: str
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    latency_ms: float
    cost_usd: float
    telemetry_id: int
    security_findings: list[dict] = []
    budget_warnings: list[dict] = []


# ── Security scan ─────────────────────────────────────────────────────────────

class ScanRequest(BaseModel):
    text: str


class ScanFinding(BaseModel):
    type: str
    severity: str
    sample: str


class ScanResponse(BaseModel):
    is_sensitive: bool
    findings: list[ScanFinding]
