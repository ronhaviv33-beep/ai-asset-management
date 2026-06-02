from datetime import datetime
from pydantic import BaseModel, Field


class AskRequest(BaseModel):
    team: str = Field(..., examples=["SOC"])
    agent: str = Field(..., examples=["IR-Agent"])
    prompt: str = Field(..., examples=["Analyze this phishing email"])
    model: str = Field(default="gpt-4o-mini", examples=["gpt-4o-mini"])
    system_prompt: str | None = Field(default=None)
    session_uuid: str | None = Field(default=None, description="Attach this call to an existing chat session")


class AskResponse(BaseModel):
    response: str
    model: str
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    latency_ms: float
    cost_usd: float
    telemetry_id: int
    session_uuid: str | None = None
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

# ── Auth / Users ─────────────────────────────────────────────────────────────

class UserCreate(BaseModel):
    email: str = Field(..., examples=["ron@company.com"])
    name: str = Field(..., examples=["Ron Haviv"])
    password: str = Field(..., min_length=8)
    role: str = Field(default="analyst", pattern="^(admin|analyst|viewer)$")
    team: str = Field(default="")


class UserUpdate(BaseModel):
    name: str | None = None
    role: str | None = Field(default=None, pattern="^(admin|analyst|viewer)$")
    team: str | None = None
    is_active: bool | None = None


class UserOut(BaseModel):
    id: int
    email: str
    name: str
    role: str
    team: str
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class LoginRequest(BaseModel):
    email: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


# ── Sessions ─────────────────────────────────────────────────────────────────

class SessionCreate(BaseModel):
    user_name: str = Field(..., examples=["Ron"])
    user_role: str = Field(..., pattern="^(admin|analyst|viewer)$")
    team: str = Field(..., examples=["SOC"])
    agent: str = Field(..., examples=["IR-Agent"])
    model: str = Field(default="gpt-4o-mini")


class SessionOut(BaseModel):
    session_uuid: str
    user_name: str
    user_role: str
    team: str
    agent: str
    model: str
    created_at: datetime
    last_activity_at: datetime
    is_active: bool
    message_count: int
    total_cost_usd: float
    total_tokens: int

    model_config = {"from_attributes": True}


class SessionMessageOut(BaseModel):
    id: int
    role: str
    content: str
    prompt_tokens: int
    completion_tokens: int
    cost_usd: float
    latency_ms: float
    security_findings: str | None
    budget_warnings: str | None
    timestamp: datetime

    model_config = {"from_attributes": True}


class SessionChatRequest(BaseModel):
    session_uuid: str
    user_name: str
    user_role: str = Field(..., pattern="^(admin|analyst|viewer)$")
    team: str
    agent: str
    model: str = Field(default="gpt-4o-mini")
    messages: list[ChatMessage]
    system_prompt: str | None = Field(default=None)


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
