"""
Tests for pricing_estimated feature (Steps 1–5).

Unit tests run with no DB. Integration tests use an isolated SQLite DB.
ENV must be set before any app imports — do not reorder the top block.
"""
import logging
import os, re, sys, uuid

# ── Env setup BEFORE any app import ───────────────────────────────────────────
_db_path = f"/tmp/test_pricing_est_{uuid.uuid4().hex[:8]}.db"
os.environ["JWT_SECRET"]                = "testsecret-pricing"
os.environ["CREDENTIAL_ENCRYPTION_KEY"] = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
os.environ["DATABASE_URL"]              = f"sqlite:///{_db_path}"
sys.path.insert(0, "/home/user/aifinops-guard")
os.chdir("/home/user/aifinops-guard")

import pytest
from unittest.mock import patch, AsyncMock, MagicMock

from app.models import (
    calculate_cost, COST_PER_1M, _DEFAULT_PRICING,
    _normalize_model, PRICING_LAST_UPDATED,
)

# ── Unit tests (no DB) ─────────────────────────────────────────────────────────

def test_known_model_exact():
    cost, estimated = calculate_cost("gpt-4o-mini", 1_000_000, 1_000_000)
    assert not estimated, "gpt-4o-mini is a known model — must not be flagged estimated"
    expected = COST_PER_1M["gpt-4o-mini"]["prompt"] + COST_PER_1M["gpt-4o-mini"]["completion"]
    assert cost == round(expected, 8)


def test_unknown_model_conservative(caplog):
    """Unknown model must use conservative fallback, not floor pricing."""
    floor_prompt = 0.15  # old unsafe default (gpt-4o-mini)
    conservative_prompt = _DEFAULT_PRICING["prompt"]
    assert conservative_prompt > floor_prompt, (
        f"Conservative fallback ({conservative_prompt}) must be > floor ({floor_prompt})"
    )
    with caplog.at_level(logging.WARNING, logger="aifinops.pricing"):
        cost, estimated = calculate_cost("gpt-99-ultra", 1_000_000, 0)
    assert estimated, "Unknown model must be flagged as estimated"
    assert cost == round(_DEFAULT_PRICING["prompt"], 8)
    assert any("gpt-99-ultra" in r.message for r in caplog.records), \
        "Unknown model must be logged as warning"


def test_dated_openai_model():
    cost, estimated = calculate_cost("gpt-4o-mini-2024-07-18", 500_000, 200_000)
    assert not estimated, "Dated model string should normalize and hit exact pricing"
    exact_cost, _ = calculate_cost("gpt-4o-mini", 500_000, 200_000)
    assert cost == exact_cost


def test_dated_anthropic_model():
    cost, estimated = calculate_cost("claude-haiku-4-5-20251001", 1_000_000, 1_000_000)
    assert not estimated
    exact_cost, _ = calculate_cost("claude-haiku-4-5", 1_000_000, 1_000_000)
    assert cost == exact_cost


def test_normalize_strips_date():
    assert _normalize_model("gpt-4o-mini-2024-07-18") == "gpt-4o-mini"
    assert _normalize_model("claude-haiku-4-5-20251001") == "claude-haiku-4-5"
    assert _normalize_model("gpt-4o") == "gpt-4o"
    assert _normalize_model("o3-2025-04-16") == "o3"


def test_pricing_last_updated_is_set():
    assert PRICING_LAST_UPDATED, "PRICING_LAST_UPDATED must be set"
    parts = PRICING_LAST_UPDATED.split("-")
    assert len(parts) == 3 and len(parts[0]) == 4, \
        f"PRICING_LAST_UPDATED must be YYYY-MM-DD, got {PRICING_LAST_UPDATED!r}"


# ── Integration tests ──────────────────────────────────────────────────────────

from app.main import app, _seed_roles_for_org
from app.database import SessionLocal
from app.models import Organization, User, ApiKey
from app.auth import hash_password, create_token, generate_api_key, hash_api_key
from fastapi.testclient import TestClient

_client = TestClient(app, raise_server_exceptions=True)
_client.get("/health")  # trigger startup migrations

_db = SessionLocal()
def _slug(n): return re.sub(r"[^a-z0-9]+", "-", n.lower()).strip("-")

_org = Organization(name="PricingTestOrg", slug=_slug("PricingTestOrg"))
_db.add(_org); _db.commit(); _db.refresh(_org)
_seed_roles_for_org(_db, _org.id)

_admin = User(email="pricing-admin@test.com", name="Pricing Admin",
              hashed_password=hash_password("x"), role="admin",
              team="eng", organization_id=_org.id)
_db.add(_admin); _db.commit(); _db.refresh(_admin)
_admin_hdrs = {"Authorization": f"Bearer {create_token(_admin)}"}

_raw_key, _key_prefix, _hashed = generate_api_key()
_api_key_row = ApiKey(name="pricing-test-key", key_hash=_hashed,
                      key_prefix=_key_prefix, team="eng",
                      organization_id=_org.id, created_by_id=_admin.id)
_db.add(_api_key_row); _db.commit()
_proxy_hdrs = {
    "Authorization": f"Bearer {_raw_key}",
    "X-Guard-Team": "eng", "X-Guard-Agent": "bot",
}


def _fake_resp(model: str):
    return {
        "id": "chatcmpl-fake", "object": "chat.completion", "model": model,
        "choices": [{"index": 0, "message": {"role": "assistant", "content": "ok"}, "finish_reason": "stop"}],
        "usage": {"prompt_tokens": 100, "completion_tokens": 50, "total_tokens": 150},
    }


def test_known_model_telemetry_not_estimated():
    with patch("app.main.get_client_for_org", return_value=MagicMock()), \
         patch("app.main.proxy_chat_complete", new_callable=AsyncMock,
               return_value=_fake_resp("gpt-4o-mini")):
        r = _client.post("/v1/chat/completions",
                         json={"model": "gpt-4o-mini", "messages": [{"role": "user", "content": "hi"}]},
                         headers=_proxy_hdrs)
    assert r.status_code == 200, r.text

    tel = _client.get("/telemetry", headers=_admin_hdrs)
    assert tel.status_code == 200
    rows = [row for row in tel.json() if row["model"] == "gpt-4o-mini"]
    assert rows, "Expected telemetry row for gpt-4o-mini"
    row = rows[0]
    assert "pricing_estimated" in row, "TelemetryRecord must expose pricing_estimated"
    assert row["pricing_estimated"] is False, \
        f"Known model must not be flagged estimated, got: {row['pricing_estimated']}"


def test_unknown_model_telemetry_estimated():
    with patch("app.main.get_client_for_org", return_value=MagicMock()), \
         patch("app.main.proxy_chat_complete", new_callable=AsyncMock,
               return_value=_fake_resp("gpt-99-ultra")):
        r = _client.post("/v1/chat/completions",
                         json={"model": "gpt-99-ultra", "messages": [{"role": "user", "content": "hi"}]},
                         headers=_proxy_hdrs)
    assert r.status_code == 200, r.text

    tel = _client.get("/telemetry", headers=_admin_hdrs)
    unknown_rows = [row for row in tel.json() if row["model"] == "gpt-99-ultra"]
    assert unknown_rows, "Expected telemetry row for unknown model"
    row = unknown_rows[0]
    assert row["pricing_estimated"] is True, \
        f"Unknown model must be flagged estimated, got: {row['pricing_estimated']}"

    floor_cost = round((100 / 1_000_000) * 0.15 + (50 / 1_000_000) * 0.60, 8)
    assert row["cost_usd"] != floor_cost, \
        f"Unknown model must NOT use floor (gpt-4o-mini) pricing. Got cost={row['cost_usd']}"
    conservative_cost = round((100 / 1_000_000) * _DEFAULT_PRICING["prompt"]
                              + (50 / 1_000_000) * _DEFAULT_PRICING["completion"], 8)
    assert row["cost_usd"] == conservative_cost, \
        f"Expected conservative cost={conservative_cost}, got {row['cost_usd']}"


def test_health_exposes_pricing_last_updated():
    r = _client.get("/health")
    assert r.status_code == 200
    data = r.json()
    assert "pricing_last_updated" in data, "/health must expose pricing_last_updated"
    assert data["pricing_last_updated"] == PRICING_LAST_UPDATED


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
