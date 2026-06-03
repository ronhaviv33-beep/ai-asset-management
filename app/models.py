import uuid as _uuid
from datetime import datetime, timezone
from sqlalchemy import Integer, String, Float, Text, DateTime, Boolean, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base

# Cost per 1M tokens (USD) — update as pricing changes
COST_PER_1M = {
    # Anthropic
    "claude-opus-4-5":        {"prompt": 15.00,  "completion": 75.00},
    "claude-sonnet-4-5":      {"prompt": 3.00,   "completion": 15.00},
    "claude-haiku-4-5":       {"prompt": 0.80,   "completion": 4.00},
    # OpenAI
    "gpt-4.1":                {"prompt": 2.00,   "completion": 8.00},
    "gpt-4.1-mini":           {"prompt": 0.40,   "completion": 1.60},
    "gpt-4o":                 {"prompt": 2.50,   "completion": 10.00},
    "gpt-4o-mini":            {"prompt": 0.15,   "completion": 0.60},
    "gpt-4-turbo":            {"prompt": 10.00,  "completion": 30.00},
    "gpt-3.5-turbo":          {"prompt": 0.50,   "completion": 1.50},
    "o3":                     {"prompt": 10.00,  "completion": 40.00},
    "o4-mini":                {"prompt": 1.10,   "completion": 4.40},
    # Google
    "gemini-2.5-pro":         {"prompt": 1.25,   "completion": 10.00},
    "gemini-2.0-flash":       {"prompt": 0.075,  "completion": 0.30},
    "gemini-1.5-pro":         {"prompt": 1.25,   "completion": 5.00},
    # Local / open-source (negligible marginal cost)
    "llama-3.1-70b-local":    {"prompt": 0.20,   "completion": 0.20},
    "llama-3.1-8b-local":     {"prompt": 0.05,   "completion": 0.05},
}

_DEFAULT_PRICING = {"prompt": 0.15, "completion": 0.60}  # gpt-4o-mini as safe default


def calculate_cost(model: str, prompt_tokens: int, completion_tokens: int) -> float:
    pricing = COST_PER_1M.get(model, _DEFAULT_PRICING)
    prompt_cost = (prompt_tokens / 1_000_000) * pricing["prompt"]
    completion_cost = (completion_tokens / 1_000_000) * pricing["completion"]
    return round(prompt_cost + completion_cost, 8)


class PolicyRule(Base):
    __tablename__ = "policy_rules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    team: Mapped[str] = mapped_column(String(128))          # team name or "*" for global
    rule_type: Mapped[str] = mapped_column(String(32))      # "allow_model" | "block_model"
    value: Mapped[str] = mapped_column(String(128))         # model name or "*"
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class BudgetRule(Base):
    __tablename__ = "budget_rules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    team: Mapped[str] = mapped_column(String(128))           # team name or "*" for global
    agent: Mapped[str | None] = mapped_column(String(128), nullable=True)  # None = team-wide
    limit_usd: Mapped[float] = mapped_column(Float)
    period: Mapped[str] = mapped_column(String(16))          # "daily" | "monthly"
    action: Mapped[str] = mapped_column(String(16))          # "alert" | "block"
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class Telemetry(Base):
    __tablename__ = "telemetry"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    team: Mapped[str] = mapped_column(String(128))
    agent: Mapped[str] = mapped_column(String(128))
    model: Mapped[str] = mapped_column(String(64))
    prompt: Mapped[str] = mapped_column(Text)
    response: Mapped[str] = mapped_column(Text)
    prompt_tokens: Mapped[int] = mapped_column(Integer, default=0)
    completion_tokens: Mapped[int] = mapped_column(Integer, default=0)
    total_tokens: Mapped[int] = mapped_column(Integer, default=0)
    latency_ms: Mapped[float] = mapped_column(Float, default=0.0)
    cost_usd: Mapped[float] = mapped_column(Float, default=0.0)
    sensitive: Mapped[bool] = mapped_column(Boolean, default=False)
    sensitive_findings: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON list
    blocked: Mapped[bool] = mapped_column(Boolean, default=False)
    block_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    email: Mapped[str] = mapped_column(String(256), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(128))
    hashed_password: Mapped[str] = mapped_column(String(256))
    role: Mapped[str] = mapped_column(String(32), default="analyst")   # admin|analyst|viewer
    team: Mapped[str] = mapped_column(String(128), default="")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class ApiKey(Base):
    __tablename__ = "api_keys"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(128))                        # human label
    key_prefix: Mapped[str] = mapped_column(String(16))                   # first 12 chars — display only
    key_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)  # SHA-256
    team: Mapped[str] = mapped_column(String(128), default="unknown")
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class GuardMode(Base):
    __tablename__ = "guard_modes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    team: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    mode: Mapped[str] = mapped_column(String(16))   # observe | alert | enforce
    updated_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )


class ChatSession(Base):
    __tablename__ = "chat_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    session_uuid: Mapped[str] = mapped_column(String(36), unique=True, index=True,
                                               default=lambda: str(_uuid.uuid4()))
    user_name: Mapped[str] = mapped_column(String(128))
    user_role: Mapped[str] = mapped_column(String(32))   # admin | analyst | viewer
    team: Mapped[str] = mapped_column(String(128))
    agent: Mapped[str] = mapped_column(String(128))
    model: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    last_activity_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    message_count: Mapped[int] = mapped_column(Integer, default=0)
    total_cost_usd: Mapped[float] = mapped_column(Float, default=0.0)
    total_tokens: Mapped[int] = mapped_column(Integer, default=0)


class ChatSessionMessage(Base):
    __tablename__ = "chat_session_messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    session_uuid: Mapped[str] = mapped_column(String(36), index=True)
    role: Mapped[str] = mapped_column(String(16))        # user | assistant
    content: Mapped[str] = mapped_column(Text)
    prompt_tokens: Mapped[int] = mapped_column(Integer, default=0)
    completion_tokens: Mapped[int] = mapped_column(Integer, default=0)
    cost_usd: Mapped[float] = mapped_column(Float, default=0.0)
    latency_ms: Mapped[float] = mapped_column(Float, default=0.0)
    security_findings: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON
    budget_warnings: Mapped[str | None] = mapped_column(Text, nullable=True)    # JSON
    timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
