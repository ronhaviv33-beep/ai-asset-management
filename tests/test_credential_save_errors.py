"""
Provider credential save error surfacing tests.

Verifies that POST /provider-credentials returns actionable error messages:
  - 422 with human-readable detail when the key is rejected by the provider
  - 503 with a clear message when CREDENTIAL_ENCRYPTION_KEY is missing
  - 201 on success

The frontend api.js surfaces these via err.detail (string) — tested at the
api layer here; UI rendering is covered by the existing settings page.
"""
import os, re, sys, uuid
from unittest.mock import patch, AsyncMock, MagicMock

_db_path = f"/tmp/test_cred_err_{uuid.uuid4().hex[:8]}.db"
os.environ.update({
    "JWT_SECRET":                "testsecret-cred",
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
client = TestClient(app, raise_server_exceptions=True)
client.get("/health")

db = SessionLocal()
def slug(n): return re.sub(r"[^a-z0-9]+", "-", n.lower()).strip("-")

org = Organization(name="CredErrOrg", slug=slug("CredErrOrg"))
db.add(org); db.commit(); db.refresh(org)
_seed_roles_for_org(db, org.id)

admin = User(email="crederradmin@test.com", name="Cred Err Admin",
             hashed_password=hash_password("x"), role="admin",
             team="eng", organization_id=org.id)
db.add(admin); db.commit(); db.refresh(admin)
token = create_token(admin)
db.close()

PASS = "\033[32mPASS\033[0m"
FAIL = "\033[31mFAIL\033[0m"
results = []

def check(label, cond, extra=""):
    tag = PASS if cond else FAIL
    print(f"  [{tag}] {label}" + (f"  ({extra})" if extra else ""))
    results.append(cond)

AH = {"Authorization": f"Bearer {token}"}

# ── Invalid key → 422 with actionable detail ──────────────────────────────────
print("\n=== invalid key → 422 with actionable detail ===")

def _auth_error(*args, **kwargs):
    from openai import AuthenticationError
    mock_resp = MagicMock()
    mock_resp.status_code = 401
    mock_resp.json.return_value = {"error": {"message": "Incorrect API key provided"}}
    mock_resp.headers = {}
    raise AuthenticationError("Incorrect API key provided", response=mock_resp, body={"error": {"message": "Incorrect API key provided"}})

with patch("openai.AsyncOpenAI") as MockOAI:
    instance = MagicMock()
    instance.chat = MagicMock()
    instance.chat.completions = MagicMock()
    instance.chat.completions.create = AsyncMock(side_effect=_auth_error)
    MockOAI.return_value = instance

    r = client.post(
        "/provider-credentials",
        headers=AH,
        json={"provider": "openai", "key": "sk-badkey1234567890"},
    )

check("status is 422 (not 500)", r.status_code == 422,
      f"got {r.status_code}: {r.text[:120]}")
body = r.json()
err = body.get("detail", {}).get("error", {}) if isinstance(body.get("detail"), dict) else {}
check("error.type == invalid_provider_key", err.get("type") == "invalid_provider_key", str(err))
check("error.provider == openai", err.get("provider") == "openai", str(err))
check("error.message contains actionable text",
      "invalid" in (err.get("message") or "").lower() or "rejected" in (err.get("message") or "").lower(),
      str(err))

# ── Missing encryption key → 503 with clear message ───────────────────────────
print("\n=== missing CREDENTIAL_ENCRYPTION_KEY → 503 ===")

def _succeed_validate(*args, **kwargs):
    pass  # validation passes

with patch("openai.AsyncOpenAI") as MockOAI2:
    instance2 = MagicMock()
    instance2.chat = MagicMock()
    instance2.chat.completions = MagicMock()
    instance2.chat.completions.create = AsyncMock(return_value=MagicMock())
    MockOAI2.return_value = instance2

    with patch("app.routes.settings.encrypt_credential",
               side_effect=RuntimeError("CREDENTIAL_ENCRYPTION_KEY is not set.")):
        r = client.post(
            "/provider-credentials",
            headers=AH,
            json={"provider": "openai", "key": "sk-anykey1234567890"},
        )

check("status is 503 (not 500)", r.status_code == 503,
      f"got {r.status_code}: {r.text[:120]}")
body = r.json()
err = body.get("detail", {}).get("error", {}) if isinstance(body.get("detail"), dict) else {}
check("error.type is encryption_key_missing or encryption_failed",
      err.get("type") in ("encryption_key_missing", "encryption_failed"), str(err))
check("error.message contains CREDENTIAL_ENCRYPTION_KEY hint",
      "CREDENTIAL_ENCRYPTION_KEY" in (err.get("message") or ""), str(err))

# ── Successful save ────────────────────────────────────────────────────────────
print("\n=== successful save → 201 ===")

with patch("openai.AsyncOpenAI") as MockOAI3:
    instance3 = MagicMock()
    instance3.chat = MagicMock()
    instance3.chat.completions = MagicMock()
    instance3.chat.completions.create = AsyncMock(return_value=MagicMock())
    MockOAI3.return_value = instance3

    r = client.post(
        "/provider-credentials",
        headers=AH,
        json={"provider": "openai", "key": "sk-validkey1234567"},
    )

check("status is 201", r.status_code == 201,
      f"got {r.status_code}: {r.text[:120]}")
body = r.json()
check("response contains provider", body.get("provider") == "openai", str(body))
check("response contains last4", "last4" in body, str(body))
check("response status is 'saved'", body.get("status") == "saved", str(body))

print()
passed = sum(results)
total  = len(results)
if passed == total:
    print(f"\033[32mAll {total}/{total} checks passed.\033[0m\n")
else:
    print(f"\033[31m{total - passed}/{total} checks FAILED.\033[0m\n")
    sys.exit(1)
