import logging
import os
import re
import uuid as _uuid
from datetime import datetime, timezone
from cryptography.fernet import Fernet
from sqlalchemy import Integer, String, Float, Text, DateTime, Boolean, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base

_pricing_log = logging.getLogger("ai_asset_mgmt.pricing")

# When this table was last audited against provider pricing pages.
# Update this constant whenever you update COST_PER_1M.
PRICING_LAST_UPDATED = "2026-06-07"

# Cost per 1M tokens (USD) — update as pricing changes
COST_PER_1M = {
    # Anthropic — claude.ai/pricing
    "claude-opus-4-8":        {"prompt": 15.00,  "completion": 75.00},
    "claude-opus-4-5":        {"prompt": 15.00,  "completion": 75.00},
    "claude-sonnet-4-6":      {"prompt": 3.00,   "completion": 15.00},
    "claude-sonnet-4-5":      {"prompt": 3.00,   "completion": 15.00},
    "claude-haiku-4-5":       {"prompt": 0.80,   "completion": 4.00},
    # OpenAI — openai.com/pricing
    "gpt-4.1":                {"prompt": 2.00,   "completion": 8.00},
    "gpt-4.1-mini":           {"prompt": 0.40,   "completion": 1.60},
    "gpt-4.1-nano":           {"prompt": 0.10,   "completion": 0.40},
    "gpt-4o":                 {"prompt": 2.50,   "completion": 10.00},
    "gpt-4o-mini":            {"prompt": 0.15,   "completion": 0.60},
    "gpt-4-turbo":            {"prompt": 10.00,  "completion": 30.00},
    "gpt-3.5-turbo":          {"prompt": 0.50,   "completion": 1.50},
    "o1":                     {"prompt": 15.00,  "completion": 60.00},
    "o1-mini":                {"prompt": 1.10,   "completion": 4.40},
    "o3":                     {"prompt": 10.00,  "completion": 40.00},
    "o3-mini":                {"prompt": 1.10,   "completion": 4.40},
    "o4-mini":                {"prompt": 1.10,   "completion": 4.40},
    # Google — ai.google.dev/pricing
    "gemini-2.5-pro":         {"prompt": 1.25,   "completion": 10.00},
    "gemini-2.5-flash":       {"prompt": 0.075,  "completion": 0.30},
    "gemini-2.0-flash":       {"prompt": 0.075,  "completion": 0.30},
    "gemini-1.5-pro":         {"prompt": 1.25,   "completion": 5.00},
    "gemini-1.5-flash":       {"prompt": 0.075,  "completion": 0.30},
    # Local / open-source (negligible marginal cost)
    "llama-3.1-70b-local":    {"prompt": 0.20,   "completion": 0.20},
    "llama-3.1-8b-local":     {"prompt": 0.05,   "completion": 0.05},
}

# Fallback for unknown models: gpt-4o rates ($2.50/$10.00 per 1M).
# This overestimates most models (gpt-4o-mini, open-source proxies) and
# underestimates frontier models (o3 is $10/$40, Claude Opus is $15/$75).
# The pricing_estimated flag is always set True when this fires, so the
# customer knows it's an estimate. Add new models to COST_PER_1M promptly
# to avoid sustained underestimates on frontier unknowns.
_DEFAULT_PRICING = {"prompt": 2.50, "completion": 10.00}

# Providers often return dated model strings (gpt-4o-mini-2024-07-18,
# claude-haiku-4-5-20251001). Normalize to the undated base name so the
# COST_PER_1M lookup hits instead of silently falling back.
_DATE_SUFFIX = re.compile(r"-\d{4}-?\d{2}-?\d{2}$")

def _normalize_model(model: str) -> str:
    return _DATE_SUFFIX.sub("", model)


def calculate_cost(model: str, prompt_tokens: int, completion_tokens: int) -> tuple[float, bool]:
    """Return (cost_usd, pricing_estimated).

    pricing_estimated=True means the model was not found in COST_PER_1M
    (even after date-suffix normalization) and the conservative fallback
    was used. Callers must persist this flag so the dashboard can surface
    estimated costs distinctly from exact ones.
    """
    normalized = _normalize_model(model)
    pricing = COST_PER_1M.get(model) or COST_PER_1M.get(normalized)
    estimated = pricing is None
    if estimated:
        pricing = _DEFAULT_PRICING
        _pricing_log.warning(
            "Unknown model %r (normalized: %r) — using conservative fallback pricing "
            "$%.2f/$%.2f per 1M tokens. Add this model to COST_PER_1M.",
            model, normalized, pricing["prompt"], pricing["completion"],
        )
    prompt_cost = (prompt_tokens / 1_000_000) * pricing["prompt"]
    completion_cost = (completion_tokens / 1_000_000) * pricing["completion"]
    return round(prompt_cost + completion_cost, 8), estimated


# ─── Envelope encryption for provider credentials ────────────────────────────
# CREDENTIAL_ENCRYPTION_KEY must be a 32-byte url-safe base64 Fernet key.
# Generate with: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
# Set in .env / Render dashboard (sync:false). Never commit.

def _fernet() -> Fernet:
    raw = os.getenv("CREDENTIAL_ENCRYPTION_KEY", "")
    if not raw:
        raise RuntimeError(
            "CREDENTIAL_ENCRYPTION_KEY is not set. "
            "Generate one with: python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\""
        )
    return Fernet(raw.encode())

def encrypt_credential(plaintext: str) -> str:
    return _fernet().encrypt(plaintext.encode()).decode()

def decrypt_credential(ciphertext: str) -> str:
    return _fernet().decrypt(ciphertext.encode()).decode()


class Organization(Base):
    __tablename__ = "organizations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(256), unique=True, index=True)
    slug: Mapped[str] = mapped_column(String(128), unique=True, index=True)  # url-safe handle
    is_internal: Mapped[bool] = mapped_column(Boolean, default=False)        # True = platform org
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class ProviderCredential(Base):
    """
    Per-org provider API keys, encrypted at rest with Fernet envelope encryption.
    The plaintext key is NEVER stored — only the Fernet ciphertext.
    last4 is stored separately for display (e.g. "sk-...4f2a").
    """
    __tablename__ = "provider_credentials"
    __table_args__ = (
        UniqueConstraint("organization_id", "provider", name="uq_org_provider"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    organization_id: Mapped[int] = mapped_column(Integer, ForeignKey("organizations.id"), index=True)
    provider: Mapped[str] = mapped_column(String(32))    # "openai" | "anthropic" | "google" | "local"
    encrypted_key: Mapped[str] = mapped_column(Text)     # Fernet ciphertext
    last4: Mapped[str] = mapped_column(String(8))        # display only e.g. "4f2a"
    base_url: Mapped[str | None] = mapped_column(String(512), nullable=True)  # local LLM only
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class Role(Base):
    """
    DB-managed role definitions, scoped per organization.
    Each org gets its own copy of admin/analyst/viewer seeded on org creation.
    Admins may create additional roles for their own org only.
    """
    __tablename__ = "roles"
    __table_args__ = (
        UniqueConstraint("organization_id", "name", name="uq_org_role_name"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    organization_id: Mapped[int] = mapped_column(Integer, ForeignKey("organizations.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(64), index=True)
    label: Mapped[str] = mapped_column(String(64))
    color: Mapped[str] = mapped_column(String(32))           # hex color for UI
    pages: Mapped[str] = mapped_column(Text, default="[]")   # JSON list of page ids
    can: Mapped[str] = mapped_column(Text, default="[]")     # JSON list of capabilities
    team_scoped: Mapped[bool] = mapped_column(Boolean, default=False)  # True → role sees only own team's data
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class PolicyRule(Base):
    __tablename__ = "policy_rules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    organization_id: Mapped[int] = mapped_column(Integer, ForeignKey("organizations.id"), nullable=False, index=True)
    team: Mapped[str] = mapped_column(String(128))          # team name or "*" for org-global
    rule_type: Mapped[str] = mapped_column(String(32))      # "allow_model" | "block_model"
    value: Mapped[str] = mapped_column(String(128))         # model name or "*"
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class BudgetRule(Base):
    __tablename__ = "budget_rules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    organization_id: Mapped[int] = mapped_column(Integer, ForeignKey("organizations.id"), nullable=False, index=True)
    team: Mapped[str] = mapped_column(String(128))           # team name or "*" for org-global
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
    # organization_id: nullable only during the boot migration that backfills pre-BYOK rows.
    # migrate_orgs.py hardens this to NOT NULL after confirming zero nulls remain.
    # All dashboard queries filter by this — a null row would be invisible to every org.
    organization_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("organizations.id"), nullable=True, index=True
    )
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
    pricing_estimated: Mapped[bool] = mapped_column(Boolean, default=False)
    sensitive: Mapped[bool] = mapped_column(Boolean, default=False)
    sensitive_findings: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON list
    blocked: Mapped[bool] = mapped_column(Boolean, default=False)
    block_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    # Phase 2 — asset identity fields (nullable; backfilled by migration for old rows)
    asset_key: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    agent_id_raw: Mapped[str | None] = mapped_column(String(256), nullable=True)
    agent_version: Mapped[str | None] = mapped_column(String(128), nullable=True)
    team_raw: Mapped[str | None] = mapped_column(String(128), nullable=True)
    environment_raw: Mapped[str | None] = mapped_column(String(64), nullable=True)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    email: Mapped[str] = mapped_column(String(256), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(128))
    hashed_password: Mapped[str] = mapped_column(String(256))
    role: Mapped[str] = mapped_column(String(32), default="analyst")   # admin|analyst|viewer
    team: Mapped[str] = mapped_column(String(128), default="")         # sub-label within org
    # organization_id: nullable during backfill migration; enforced non-null after.
    # Auth dependency treats null as a hard 401 — no fallback to any default org.
    organization_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("organizations.id"), nullable=True, index=True
    )
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
    team: Mapped[str] = mapped_column(String(128), default="unknown")     # sub-label within org
    # organization_id: nullable during backfill migration; enforced non-null after.
    # get_proxy_caller treats null as a hard 401 — no fallback to any default org.
    organization_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("organizations.id"), nullable=True, index=True
    )
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class Team(Base):
    """
    Soft (auto-registering) team registry, scoped per org.
    Never an FK — team remains a free string everywhere it's used.
    This table is the source of truth for "what teams exist in this org."
    Written idempotently on every path that accepts a team string.
    """
    __tablename__ = "teams"
    __table_args__ = (
        UniqueConstraint("organization_id", "name", name="uq_org_team_name"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    organization_id: Mapped[int] = mapped_column(Integer, ForeignKey("organizations.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(128), index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class GuardMode(Base):
    __tablename__ = "guard_modes"
    __table_args__ = (
        UniqueConstraint("organization_id", "team", name="uq_org_team_guard_mode"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    organization_id: Mapped[int] = mapped_column(Integer, ForeignKey("organizations.id"), nullable=False, index=True)
    team: Mapped[str] = mapped_column(String(128), index=True)
    mode: Mapped[str] = mapped_column(String(16))   # observe | alert | enforce
    updated_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )


class AssetRegistry(Base):
    """
    Governance source of truth for AI agent assets.
    Discovered automatically from proxy traffic; claimed by humans via UI.
    Telemetry is the immutable runtime record; this table is the mutable governance layer.
    """
    __tablename__ = "asset_registry"
    __table_args__ = (
        UniqueConstraint("organization_id", "asset_key", name="uq_org_asset_key"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    organization_id: Mapped[int] = mapped_column(Integer, ForeignKey("organizations.id"), nullable=False, index=True)
    asset_key: Mapped[str] = mapped_column(String(64), index=True)       # sha256(org_id + ":" + agent_id_raw)
    agent_id_raw: Mapped[str] = mapped_column(String(256))               # X-Guard-Agent header value
    agent_name: Mapped[str | None] = mapped_column(String(256), nullable=True)  # human-readable alias
    owner: Mapped[str | None] = mapped_column(String(256), nullable=True)
    team: Mapped[str | None] = mapped_column(String(128), nullable=True)         # canonical team
    environment: Mapped[str | None] = mapped_column(String(64), nullable=True)   # prod | staging | dev
    criticality: Mapped[str | None] = mapped_column(String(32), nullable=True)   # critical | high | medium | low
    business_purpose: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="unassigned")        # unassigned | needs_validation | managed | retired
    source: Mapped[str] = mapped_column(String(32), default="discovered")        # discovered | claimed | ci_pipeline | api
    # Discovery classification (Phase 1)
    discovery_status: Mapped[str] = mapped_column(String(32), default="verified")         # verified | potential
    discovery_source: Mapped[str] = mapped_column(String(64), default="gateway_telemetry") # gateway_telemetry | github | jira | servicenow | slack | mcp | cloud_functions
    discovery_reason: Mapped[str | None] = mapped_column(Text, nullable=True)             # human-readable explanation
    evidence: Mapped[str | None] = mapped_column(Text, nullable=True)                     # JSON — discovery signals
    confidence_score: Mapped[float] = mapped_column(Float, default=95.0)                  # 0–100
    claimed_by: Mapped[str | None] = mapped_column(String(256), nullable=True)   # email of claimer
    claimed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    first_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
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
