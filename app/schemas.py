from datetime import datetime
from pydantic import BaseModel, Field


class AskRequest(BaseModel):
    team: str = Field(..., examples=["SOC"], max_length=128)
    agent: str = Field(..., examples=["IR-Agent"], max_length=128)
    prompt: str = Field(..., examples=["Analyze this phishing email"], max_length=32_000)
    model: str = Field(default="gpt-4o-mini", examples=["gpt-4o-mini"], max_length=64)
    system_prompt: str | None = Field(default=None, max_length=8_000)
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
    organization_id: int | None
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
    role: str = Field(..., pattern="^(user|assistant)$")
    content: str = Field(..., max_length=32_000)


class ChatRequest(BaseModel):
    team: str = Field(..., examples=["SOC"], max_length=128)
    agent: str = Field(..., examples=["IR-Agent"], max_length=128)
    model: str = Field(default="gpt-4o-mini", examples=["gpt-4o-mini"], max_length=64)
    messages: list[ChatMessage] = Field(..., max_length=200)
    system_prompt: str | None = Field(default=None, max_length=8_000)


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

# ── Roles ─────────────────────────────────────────────────────────────────────

class RoleOut(BaseModel):
    name: str
    label: str
    color: str
    pages: list[str]
    can: list[str]
    model_config = {"from_attributes": True}


class RoleCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=64, pattern=r"^[a-z0-9_-]+$")
    label: str = Field(..., min_length=1, max_length=64)
    color: str = Field(default="#7A8499", pattern=r"^#[0-9a-fA-F]{6}$")
    pages: list[str] = Field(default_factory=list)
    can: list[str] = Field(default_factory=list)


class RoleUpdate(BaseModel):
    label: str | None = Field(default=None, min_length=1, max_length=64)
    color: str | None = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")
    pages: list[str] | None = None
    can: list[str] | None = None


# ── Auth / Users ─────────────────────────────────────────────────────────────

class UserCreate(BaseModel):
    email: str = Field(..., examples=["ron@company.com"])
    name: str = Field(..., examples=["Ron Haviv"])
    password: str = Field(..., min_length=8)
    # Role validated against DB roles table in the route handler (not a hardcoded regex)
    role: str = Field(default="analyst", min_length=1, max_length=64)
    team: str = Field(default="")


class UserUpdate(BaseModel):
    name: str | None = None
    # Role validated against DB roles table in the route handler when present
    role: str | None = Field(default=None, min_length=1, max_length=64)
    team: str | None = None
    is_active: bool | None = None
    password: str | None = Field(default=None, min_length=8)
    current_password: str | None = None


class UserOut(BaseModel):
    id: int
    email: str
    name: str
    role: str
    team: str
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class ApiKeyCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=128)
    team: str = Field(default="unknown", max_length=128)


class ApiKeyOut(BaseModel):
    id: int
    name: str
    key_prefix: str
    team: str
    created_by_id: int | None
    created_at: datetime
    last_used_at: datetime | None
    is_active: bool

    model_config = {"from_attributes": True}


class ApiKeyCreated(ApiKeyOut):
    """Returned only at creation — includes the full key (shown once)."""
    key: str


class GuardModeOut(BaseModel):
    team: str
    mode: str               # observe | alert | enforce
    is_override: bool       # True if set explicitly, False if inheriting platform default
    would_block_30d: int = 0
    updated_at: datetime | None = None


class GuardModeUpdate(BaseModel):
    mode: str = Field(..., pattern="^(observe|alert|enforce|default)$")


class HealthResponse(BaseModel):
    status: str
    db: bool
    uptime_seconds: int
    platform_mode: str
    circuit_breaker: dict
    tenancy_hardened: bool


class LoginRequest(BaseModel):
    email: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


# ── Sessions ─────────────────────────────────────────────────────────────────

class SessionCreate(BaseModel):
    team: str = Field(..., examples=["SOC"], max_length=128)
    agent: str = Field(..., examples=["IR-Agent"], max_length=128)
    model: str = Field(default="gpt-4o-mini", max_length=64)


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
    team: str = Field(..., max_length=128)
    agent: str = Field(..., max_length=128)
    model: str = Field(default="gpt-4o-mini", max_length=64)
    messages: list[ChatMessage] = Field(..., max_length=200)
    system_prompt: str | None = Field(default=None, max_length=8_000)


# ── Security scan ─────────────────────────────────────────────────────────────

class ScanRequest(BaseModel):
    text: str = Field(..., max_length=32_000)


class ScanFinding(BaseModel):
    type: str
    severity: str
    sample: str


class ScanResponse(BaseModel):
    is_sensitive: bool
    findings: list[ScanFinding]
