"""
Test: upstream errors are saved to telemetry as blocked rows.

Verifies that when /v1/chat/completions or /v1/messages receives a 502/503
from the upstream LLM, the gateway:
  1. Returns the error to the caller (502/503)
  2. Writes a blocked=True telemetry row BEFORE raising
  3. Sets block_reason starting with "upstream_error:"
  4. Records the correct model string (so unknown-model calls are visible)
  5. Row is visible in /audit with blocked=True and the reason in block_reason

ENV must be set before any app imports.
"""
import os, sys, uuid, re

_db = f"/tmp/test_upstream_err_{uuid.uuid4().hex[:8]}.db"
os.environ["JWT_SECRET"]                = "testsecret-upstream"
os.environ["CREDENTIAL_ENCRYPTION_KEY"] = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
os.environ["DATABASE_URL"]              = f"sqlite:///{_db}"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest
from unittest.mock import patch, MagicMock, AsyncMock

from app.main import app, _seed_roles_for_org
from app.database import SessionLocal
from app.models import Organization, User, ApiKey
from app.auth import hash_password, create_token, generate_api_key, hash_api_key
from fastapi.testclient import TestClient

# ── Test DB setup ──────────────────────────────────────────────────────────────
_client = TestClient(app, raise_server_exceptions=False)  # don't re-raise 5xx
_client.get("/health")  # trigger startup + migrations

_db_sess = SessionLocal()
def _slug(n): return re.sub(r"[^a-z0-9]+", "-", n.lower()).strip("-")

_org = Organization(name="UpstreamErrOrg", slug=_slug("UpstreamErrOrg"))
_db_sess.add(_org); _db_sess.commit(); _db_sess.refresh(_org)
_seed_roles_for_org(_db_sess, _org.id)

_admin = User(email="uperr-admin@test.com", name="UpErr Admin",
              hashed_password=hash_password("x"), role="admin",
              team="eng", organization_id=_org.id)
_db_sess.add(_admin); _db_sess.commit(); _db_sess.refresh(_admin)
_admin_hdrs = {"Authorization": f"Bearer {create_token(_admin)}"}

_raw_key, _key_prefix, _hashed = generate_api_key()
_api_key_row = ApiKey(name="uperr-key", key_hash=_hashed,
                      key_prefix=_key_prefix, team="eng",
                      organization_id=_org.id, created_by_id=_admin.id)
_db_sess.add(_api_key_row); _db_sess.commit()
_proxy_hdrs = {
    "Authorization": f"Bearer {_raw_key}",
    "X-Guard-Team":  "eng",
    "X-Guard-Agent": "unknown-model-agent",
}

UNKNOWN_MODEL = "gpt-99-ultra-unknown"

# ── Helper ─────────────────────────────────────────────────────────────────────
def _audit_rows():
    r = _client.get("/audit?sensitive_only=false&blocked_only=false&limit=100",
                    headers=_admin_hdrs)
    assert r.status_code == 200, f"/audit failed: {r.text}"
    return r.json()


# ── Tests ──────────────────────────────────────────────────────────────────────

def test_upstream_502_returns_error_to_caller():
    """Gateway must forward 502 to the caller when the upstream fails."""
    with patch("app.main.get_client_for_org", return_value=MagicMock()), \
         patch("app.main.proxy_chat_complete",
               new_callable=AsyncMock,
               side_effect=Exception("model_not_found: The model `gpt-99-ultra-unknown` does not exist")):
        r = _client.post("/v1/chat/completions",
                         json={"model": UNKNOWN_MODEL,
                               "messages": [{"role": "user", "content": "hello"}]},
                         headers=_proxy_hdrs)
    assert r.status_code == 502, \
        f"Expected 502 from upstream error, got {r.status_code}: {r.text}"


def test_upstream_error_row_saved_to_telemetry():
    """After a 502, a blocked row must exist in telemetry for the unknown model."""
    # Make one bad call
    with patch("app.main.get_client_for_org", return_value=MagicMock()), \
         patch("app.main.proxy_chat_complete",
               new_callable=AsyncMock,
               side_effect=Exception("model_not_found: unknown model")):
        _client.post("/v1/chat/completions",
                     json={"model": UNKNOWN_MODEL,
                           "messages": [{"role": "user", "content": "test upstream save"}]},
                     headers=_proxy_hdrs)

    rows = _audit_rows()
    blocked = [r for r in rows if r["blocked"] and r["model"] == UNKNOWN_MODEL]
    assert blocked, (
        f"Expected a blocked telemetry row for model={UNKNOWN_MODEL!r}. "
        f"Blocked rows found: {[r['model'] for r in rows if r['blocked']]}"
    )


def test_upstream_error_block_reason_starts_with_upstream_error():
    """block_reason must start with 'upstream_error:' so the audit log is clear."""
    with patch("app.main.get_client_for_org", return_value=MagicMock()), \
         patch("app.main.proxy_chat_complete",
               new_callable=AsyncMock,
               side_effect=Exception("model_not_found: no such model")):
        _client.post("/v1/chat/completions",
                     json={"model": UNKNOWN_MODEL,
                           "messages": [{"role": "user", "content": "block reason check"}]},
                     headers=_proxy_hdrs)

    rows = _audit_rows()
    blocked = [r for r in rows if r["blocked"] and r["model"] == UNKNOWN_MODEL]
    assert blocked, "No blocked row found"
    reason = blocked[0].get("block_reason") or ""
    assert reason.startswith("upstream_error:"), \
        f"block_reason must start with 'upstream_error:', got: {reason!r}"


def test_upstream_error_row_has_correct_model_and_agent():
    """The blocked row must record the model and agent that made the call."""
    agent = "model-check-agent"
    model = "o3-pro-unknown"
    hdrs = {**_proxy_hdrs, "X-Guard-Agent": agent}

    with patch("app.main.get_client_for_org", return_value=MagicMock()), \
         patch("app.main.proxy_chat_complete",
               new_callable=AsyncMock,
               side_effect=Exception("upstream rejected model")):
        _client.post("/v1/chat/completions",
                     json={"model": model,
                           "messages": [{"role": "user", "content": "agent model check"}]},
                     headers=hdrs)

    rows = _audit_rows()
    match = [r for r in rows if r["blocked"] and r["model"] == model and r["agent"] == agent]
    assert match, (
        f"Expected blocked row with model={model!r} agent={agent!r}. "
        f"Got: {[(r['model'], r['agent']) for r in rows if r['blocked']]}"
    )


def test_upstream_error_row_has_zero_tokens_and_zero_cost():
    """Blocked upstream-error rows have no tokens or cost — nothing was consumed."""
    model = "claude-opus-5-fake"
    with patch("app.main.get_client_for_org", return_value=MagicMock()), \
         patch("app.main.proxy_chat_complete",
               new_callable=AsyncMock,
               side_effect=Exception("upstream error")):
        _client.post("/v1/chat/completions",
                     json={"model": model,
                           "messages": [{"role": "user", "content": "token check"}]},
                     headers=_proxy_hdrs)

    rows = _audit_rows()
    match = [r for r in rows if r["blocked"] and r["model"] == model]
    assert match, f"No blocked row found for model={model!r}"
    row = match[0]
    assert row["total_tokens"] == 0, f"Expected 0 tokens, got {row['total_tokens']}"
    assert row["cost_usd"] == 0.0,   f"Expected $0.00 cost, got {row['cost_usd']}"


def test_successful_call_after_upstream_error_is_not_blocked():
    """A successful call after an error must NOT be marked blocked."""
    good_resp = {
        "id": "chatcmpl-ok", "object": "chat.completion", "model": "gpt-4o-mini",
        "choices": [{"index": 0, "message": {"role": "assistant", "content": "ok"}, "finish_reason": "stop"}],
        "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
    }
    with patch("app.main.get_client_for_org", return_value=MagicMock()), \
         patch("app.main.proxy_chat_complete", new_callable=AsyncMock, return_value=good_resp):
        r = _client.post("/v1/chat/completions",
                         json={"model": "gpt-4o-mini",
                               "messages": [{"role": "user", "content": "success check"}]},
                         headers=_proxy_hdrs)
    assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"

    rows = _audit_rows()
    ok_rows = [r for r in rows if not r["blocked"] and r["model"] == "gpt-4o-mini"]
    assert ok_rows, "Expected at least one non-blocked row for gpt-4o-mini"


def test_multiple_different_unknown_models_all_saved():
    """Each distinct unknown model gets its own blocked row."""
    unknown_models = ["gpt-5-preview-fake", "gemini-ultra-3-fake", "claude-opus-6-fake"]
    for model in unknown_models:
        with patch("app.main.get_client_for_org", return_value=MagicMock()), \
             patch("app.main.proxy_chat_complete",
                   new_callable=AsyncMock,
                   side_effect=Exception(f"model {model} not found")):
            _client.post("/v1/chat/completions",
                         json={"model": model,
                               "messages": [{"role": "user", "content": "multi model test"}]},
                         headers=_proxy_hdrs)

    rows = _audit_rows()
    blocked_models = {r["model"] for r in rows if r["blocked"]}
    for model in unknown_models:
        assert model in blocked_models, \
            f"Model {model!r} not found in blocked telemetry rows. Got: {blocked_models}"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
