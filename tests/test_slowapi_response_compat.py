"""
SlowAPI response-compatibility regression tests.

SlowAPI's _inject_headers requires the route to return a
starlette.responses.Response instance.  Returning a plain dict causes:

    Exception: parameter 'response' must be an instance of starlette.responses.Response

Tests:
  1. POST /v1/chat/completions returns a Response, not a dict
  2. POST /v1/messages returns a Response, not a dict
  3. SlowAPI rate-limit headers (X-RateLimit-*) are present on both endpoints
  4. No injection exception raised during a mocked call
"""
import os, re, sys, uuid
from unittest.mock import patch, AsyncMock, MagicMock

_db_path = f"/tmp/test_slowapi_{uuid.uuid4().hex[:8]}.db"
os.environ.update({
    "JWT_SECRET":                "testsecret-slowapi",
    "CREDENTIAL_ENCRYPTION_KEY": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    "DATABASE_URL":              f"sqlite:///{_db_path}",
})
sys.path.insert(0, "/home/user/ai-asset-management")
os.chdir("/home/user/ai-asset-management")

from app.main import app, _seed_roles_for_org
from app.database import SessionLocal
from app.models import Organization, User
from app.auth import hash_password, create_token
from fastapi.testclient import TestClient
from fastapi.responses import JSONResponse
from starlette.responses import Response as StarletteResponse

PASS = "\033[32mPASS\033[0m"
FAIL = "\033[31mFAIL\033[0m"
results = []

def check(label, cond, extra=""):
    tag = PASS if cond else FAIL
    print(f"  [{tag}] {label}" + (f"  ({extra})" if extra else ""))
    results.append(cond)


client = TestClient(app, raise_server_exceptions=False)
client.get("/health")

# ── Org + user setup ──────────────────────────────────────────────────────────
db = SessionLocal()

def _slug(n):
    return re.sub(r"[^a-z0-9]+", "-", n.lower()).strip("-")

org = Organization(name="SlowApiTestOrg", slug=_slug("SlowApiTestOrg"))
db.add(org); db.commit(); db.refresh(org)
_seed_roles_for_org(db, org.id)

admin = User(
    email="slowapi-admin@test.com", name="SlowAPI Admin",
    hashed_password=hash_password("password123"), role="admin",
    organization_id=org.id, team="Engineering", is_active=True,
)
db.add(admin); db.commit(); db.refresh(admin)
token = create_token(admin)
headers = {"Authorization": f"Bearer {token}"}
_org_id = org.id
_admin_id = admin.id
db.close()

# ── Fake upstream response ─────────────────────────────────────────────────────
_FAKE_OAI_RESP = {
    "id": "chatcmpl-fake",
    "object": "chat.completion",
    "model": "gpt-4o-mini",
    "choices": [{"index": 0, "message": {"role": "assistant", "content": "Hello!"}, "finish_reason": "stop"}],
    "usage": {"prompt_tokens": 5, "completion_tokens": 3, "total_tokens": 8},
    "_latency_ms": 50.0,
}
_FAKE_ANTH_RESP = {
    "id": "chatcmpl-fake-anth",
    "object": "chat.completion",
    "model": "claude-haiku-4-5",
    "choices": [{"index": 0, "message": {"role": "assistant", "content": "Hi!"}, "finish_reason": "stop"}],
    "usage": {"prompt_tokens": 4, "completion_tokens": 2, "total_tokens": 6},
    "_latency_ms": 40.0,
}

# Telemetry mock: avoids DB schema issues in isolated test DBs
_tel_mock = MagicMock(return_value=MagicMock(id=1, cost_usd=0.0001))


print("\n=== Unit: impl functions return JSONResponse (not dict) ===")

from app.routes.proxy import _openai_compat_chat_impl, _anthropic_compat_messages_impl

# Verify _openai_compat_chat_impl returns JSONResponse for non-streaming
import asyncio

async def _check_oai_impl():
    from app.models import calculate_cost
    mock_request = MagicMock()
    mock_request.json = AsyncMock(return_value={
        "model": "gpt-4o-mini",
        "messages": [{"role": "user", "content": "hi"}],
    })
    mock_request.headers = {"x-guard-team": "Eng", "x-guard-agent": "Bot",
                            "user-agent": "test", "host": "localhost",
                            "authorization": f"Bearer {token}"}
    mock_request.client = MagicMock(host="127.0.0.1")
    mock_db = MagicMock()
    mock_user = MagicMock()
    mock_user.organization_id = _org_id
    mock_user.email = "test@test.com"
    mock_user.id = _admin_id
    mock_user.team = "Engineering"
    mock_user.name = "Test"

    with patch("app.routes.proxy.get_client_for_org", return_value=MagicMock()), \
         patch("app.routes.proxy.proxy_chat_complete", new_callable=AsyncMock, return_value=dict(_FAKE_OAI_RESP)), \
         patch("app.routes.proxy._run_enforcement_pipeline", new_callable=AsyncMock,
               return_value=("hi", MagicMock(is_sensitive=False), [], None,
                             {"warnings": [], "allowed": True, "blocked_by": None}, False)), \
         patch("app.routes.proxy._discover_asset"), \
         patch("app.routes.proxy.resolve_relationship", return_value=None), \
         patch("app.routes.proxy.tel.save", _tel_mock), \
         patch("app.routes.proxy._get_org_config", return_value=None), \
         patch("app.routes.auth.register_team", MagicMock()):
        result = await _openai_compat_chat_impl(mock_request, mock_db, mock_user)
    return result

oai_result = asyncio.run(_check_oai_impl())
check("_openai_compat_chat_impl returns a Response instance",
      isinstance(oai_result, StarletteResponse), str(type(oai_result)))
check("_openai_compat_chat_impl returns JSONResponse specifically",
      isinstance(oai_result, JSONResponse), str(type(oai_result)))


async def _check_anth_impl():
    mock_request = MagicMock()
    mock_request.json = AsyncMock(return_value={
        "model": "claude-haiku-4-5",
        "messages": [{"role": "user", "content": "hi"}],
        "max_tokens": 64,
    })
    mock_request.headers = {"x-guard-team": "Eng", "x-guard-agent": "Bot",
                            "user-agent": "test", "host": "localhost",
                            "authorization": f"Bearer {token}"}
    mock_request.client = MagicMock(host="127.0.0.1")
    mock_db = MagicMock()
    mock_user = MagicMock()
    mock_user.organization_id = _org_id
    mock_user.email = "test@test.com"
    mock_user.id = _admin_id
    mock_user.team = "Engineering"
    mock_user.name = "Test"

    with patch("app.routes.proxy.get_client_for_org", return_value=MagicMock()), \
         patch("app.routes.proxy.proxy_chat_complete", new_callable=AsyncMock, return_value=dict(_FAKE_ANTH_RESP)), \
         patch("app.routes.proxy._run_enforcement_pipeline", new_callable=AsyncMock,
               return_value=("hi", MagicMock(is_sensitive=False), [], None,
                             {"warnings": [], "allowed": True, "blocked_by": None}, False)), \
         patch("app.routes.proxy._discover_asset"), \
         patch("app.routes.proxy.resolve_relationship", return_value=None), \
         patch("app.routes.proxy.tel.save", _tel_mock), \
         patch("app.routes.proxy._get_org_config", return_value=None), \
         patch("app.routes.auth.register_team", MagicMock()):
        result = await _anthropic_compat_messages_impl(mock_request, mock_db, mock_user)
    return result

anth_result = asyncio.run(_check_anth_impl())
check("_anthropic_compat_messages_impl returns a Response instance",
      isinstance(anth_result, StarletteResponse), str(type(anth_result)))
check("_anthropic_compat_messages_impl returns JSONResponse specifically",
      isinstance(anth_result, JSONResponse), str(type(anth_result)))


print("\n=== HTTP: SlowAPI rate-limit headers injected (requires Response, not dict) ===")

# Mock everything to avoid real DB + LLM calls
with patch("app.routes.proxy.get_client_for_org", return_value=MagicMock()), \
     patch("app.routes.proxy.proxy_chat_complete", new_callable=AsyncMock, return_value=dict(_FAKE_OAI_RESP)), \
     patch("app.routes.proxy._run_enforcement_pipeline", new_callable=AsyncMock,
           return_value=("hi", MagicMock(is_sensitive=False), [], None,
                         {"warnings": [], "allowed": True, "blocked_by": None}, False)), \
     patch("app.routes.proxy._discover_asset"), \
     patch("app.routes.proxy.resolve_relationship", return_value=None), \
     patch("app.routes.proxy.tel.save", _tel_mock), \
     patch("app.routes.proxy._get_org_config", return_value=None), \
     patch("app.routes.auth.register_team", MagicMock()):
    r = client.post(
        "/v1/chat/completions",
        headers={**headers, "X-Guard-Team": "Engineering", "X-Guard-Agent": "TestBot"},
        json={"model": "gpt-4o-mini", "messages": [{"role": "user", "content": "hi"}]},
    )

print(f"  /v1/chat/completions status: {r.status_code}")
check("returns 200", r.status_code == 200, f"got {r.status_code}: {r.text[:300]}")
rl = {k: v for k, v in r.headers.items() if "ratelimit" in k.lower()}
check("SlowAPI rate-limit headers present (no injection error)", len(rl) >= 1, str(rl))


with patch("app.routes.proxy.get_client_for_org", return_value=MagicMock()), \
     patch("app.routes.proxy.proxy_chat_complete", new_callable=AsyncMock, return_value=dict(_FAKE_ANTH_RESP)), \
     patch("app.routes.proxy._run_enforcement_pipeline", new_callable=AsyncMock,
           return_value=("hi", MagicMock(is_sensitive=False), [], None,
                         {"warnings": [], "allowed": True, "blocked_by": None}, False)), \
     patch("app.routes.proxy._discover_asset"), \
     patch("app.routes.proxy.resolve_relationship", return_value=None), \
     patch("app.routes.proxy.tel.save", _tel_mock), \
     patch("app.routes.proxy._get_org_config", return_value=None), \
     patch("app.routes.auth.register_team", MagicMock()):
    r2 = client.post(
        "/v1/messages",
        headers={**headers, "X-Guard-Team": "Engineering", "X-Guard-Agent": "TestBot"},
        json={"model": "claude-haiku-4-5", "messages": [{"role": "user", "content": "hi"}], "max_tokens": 64},
    )

print(f"  /v1/messages status: {r2.status_code}")
check("returns 200", r2.status_code == 200, f"got {r2.status_code}: {r2.text[:300]}")
rl2 = {k: v for k, v in r2.headers.items() if "ratelimit" in k.lower()}
check("SlowAPI rate-limit headers present (no injection error)", len(rl2) >= 1, str(rl2))


print()
passed = sum(results)
total  = len(results)
if passed == total:
    print(f"\033[32mAll {total}/{total} checks passed.\033[0m\n")
else:
    print(f"\033[31m{total - passed}/{total} checks FAILED.\033[0m\n")
    sys.exit(1)
