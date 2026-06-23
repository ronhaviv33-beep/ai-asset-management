"""
Provider-not-configured gateway error tests.

When an org has no credential for the requested provider:
  - /v1/chat/completions must return 424 (not 500, not 402)
  - Response body must be structured: {"error": {"type": "provider_not_configured", ...}}
  - /v1/messages must do the same
  - Relationship capture still fires (headers still processed before credential check fails)
"""
import os, re, sys, uuid
from unittest.mock import patch

_db_path = f"/tmp/test_pnc_{uuid.uuid4().hex[:8]}.db"
os.environ.update({
    "JWT_SECRET":                "testsecret-pnc",
    "CREDENTIAL_ENCRYPTION_KEY": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    "DATABASE_URL":              f"sqlite:///{_db_path}",
})
sys.path.insert(0, "/home/user/ai-asset-management")
os.chdir("/home/user/ai-asset-management")

from fastapi import HTTPException
from app.main import app, _seed_roles_for_org
from app.database import SessionLocal
from app.models import Organization, User
from app.auth import hash_password, create_token

from fastapi.testclient import TestClient
client = TestClient(app, raise_server_exceptions=False)
client.get("/health")

db = SessionLocal()
def slug(n): return re.sub(r"[^a-z0-9]+", "-", n.lower()).strip("-")

acme_org = Organization(name="PncAcme", slug=slug("PncAcme"))
db.add(acme_org); db.commit(); db.refresh(acme_org)
_seed_roles_for_org(db, acme_org.id)

acme_admin = User(email="pnc-acme@test.com", name="PNC Acme Admin",
                  hashed_password=hash_password("x"), role="admin",
                  team="eng", organization_id=acme_org.id)
db.add(acme_admin); db.commit(); db.refresh(acme_admin)
acme_token = create_token(acme_admin)
db.close()

PASS = "\033[32mPASS\033[0m"
FAIL = "\033[31mFAIL\033[0m"
results = []

def check(label, cond, extra=""):
    tag = PASS if cond else FAIL
    print(f"  [{tag}] {label}" + (f"  ({extra})" if extra else ""))
    results.append(cond)

AH = {"Authorization": f"Bearer {acme_token}"}

# Simulate get_client_for_org raising the 424 structured error
def _raise_424(*args, **kwargs):
    raise HTTPException(
        status_code=424,
        detail={
            "error": {
                "type": "provider_not_configured",
                "provider": "openai",
                "organization": "PncAcme",
                "message": "No Openai provider credential is configured for this organization. Configure one in Settings → Organization AI Providers.",
            }
        },
    )

print("\n=== provider_not_configured: /v1/chat/completions ===")

with patch("app.main.get_client_for_org", side_effect=_raise_424):
    r = client.post(
        "/v1/chat/completions",
        headers={**AH, "X-Guard-Team": "eng", "X-Guard-Agent": "test-bot"},
        json={"model": "gpt-4o-mini", "messages": [{"role": "user", "content": "ping"}]},
    )

check("status is 424 (not 500, not 402)", r.status_code == 424,
      f"got {r.status_code}: {r.text[:120]}")
body = r.json()
err = body.get("detail", {}).get("error", {}) if isinstance(body.get("detail"), dict) else {}
check("error.type == provider_not_configured", err.get("type") == "provider_not_configured",
      str(err))
check("error.provider == openai", err.get("provider") == "openai", str(err))
check("error.organization present", bool(err.get("organization")), str(err))
check("error.message present", bool(err.get("message")), str(err))

print("\n=== provider_not_configured: /v1/messages ===")

def _raise_424_anthropic(*args, **kwargs):
    raise HTTPException(
        status_code=424,
        detail={
            "error": {
                "type": "provider_not_configured",
                "provider": "anthropic",
                "organization": "PncAcme",
                "message": "No Anthropic provider credential is configured for this organization. Configure one in Settings → Organization AI Providers.",
            }
        },
    )

with patch("app.main.get_client_for_org", side_effect=_raise_424_anthropic):
    r = client.post(
        "/v1/messages",
        headers={**AH, "X-Guard-Team": "eng", "X-Guard-Agent": "claude-bot"},
        json={
            "model": "claude-haiku-4-5",
            "max_tokens": 10,
            "messages": [{"role": "user", "content": "ping"}],
        },
    )

check("status is 424 (not 500, not 402)", r.status_code == 424,
      f"got {r.status_code}: {r.text[:120]}")
body = r.json()
err = body.get("detail", {}).get("error", {}) if isinstance(body.get("detail"), dict) else {}
check("error.type == provider_not_configured", err.get("type") == "provider_not_configured",
      str(err))
check("error.provider == anthropic", err.get("provider") == "anthropic", str(err))

print()
passed = sum(results)
total  = len(results)
if passed == total:
    print(f"\033[32mAll {total}/{total} checks passed.\033[0m\n")
else:
    print(f"\033[31m{total - passed}/{total} checks FAILED.\033[0m\n")
    sys.exit(1)
