"""
Startup secret validation tests.

- CREDENTIAL_ENCRYPTION_KEY missing  → _SECRET_WARNINGS has an entry, /health returns secret_warnings
- CREDENTIAL_ENCRYPTION_KEY malformed → same
- CREDENTIAL_ENCRYPTION_KEY valid    → no warnings
- FAIL_FAST_ON_MISSING_SECRETS=true  → sys.exit called when key is missing
"""
import os, sys

PASS = "\033[32mPASS\033[0m"
FAIL = "\033[31mFAIL\033[0m"
results = []

def check(label, cond, extra=""):
    tag = PASS if cond else FAIL
    print(f"  [{tag}] {label}" + (f"  ({extra})" if extra else ""))
    results.append(cond)


# ── _check_secrets() logic (tested in isolation, no app import needed) ─────────
print("\n=== _check_secrets: missing key ===")

def _run_check_secrets(key_val, fail_fast=False):
    """Import and call _check_secrets with a specific env state."""
    import importlib
    saved_key = os.environ.pop("CREDENTIAL_ENCRYPTION_KEY", None)
    saved_ff  = os.environ.pop("FAIL_FAST_ON_MISSING_SECRETS", None)
    if key_val is not None:
        os.environ["CREDENTIAL_ENCRYPTION_KEY"] = key_val
    if fail_fast:
        os.environ["FAIL_FAST_ON_MISSING_SECRETS"] = "true"
    try:
        # Import fresh each time
        import app.main as m
        importlib.reload(m)
        return list(m._SECRET_WARNINGS)
    finally:
        os.environ.pop("CREDENTIAL_ENCRYPTION_KEY", None)
        os.environ.pop("FAIL_FAST_ON_MISSING_SECRETS", None)
        if saved_key is not None:
            os.environ["CREDENTIAL_ENCRYPTION_KEY"] = saved_key
        if saved_ff is not None:
            os.environ["FAIL_FAST_ON_MISSING_SECRETS"] = saved_ff


# ── Test _check_secrets directly (no full app reload) ─────────────────────────
# Import the function after setting up env, then test each case independently.

print("\n=== _check_secrets direct function tests ===")

# Temporarily point to isolated DB to avoid conflicts
import uuid, re
_db_path = f"/tmp/test_secret_{uuid.uuid4().hex[:8]}.db"
os.environ.update({
    "JWT_SECRET":    "testsecret-sc",
    "DATABASE_URL":  f"sqlite:///{_db_path}",
})
sys.path.insert(0, "/home/user/ai-asset-management")
os.chdir("/home/user/ai-asset-management")

# Stash and clear key to test "missing"
_orig = os.environ.pop("CREDENTIAL_ENCRYPTION_KEY", None)

# Test missing key
from app.main import _check_secrets as _cs
warnings_missing = _cs()
check("missing key produces at least 1 warning", len(warnings_missing) >= 1, str(warnings_missing))
check("warning mentions CREDENTIAL_ENCRYPTION_KEY",
      any("CREDENTIAL_ENCRYPTION_KEY" in w for w in warnings_missing), str(warnings_missing))
check("warning mentions 'Organization AI Providers'",
      any("Organization AI Providers" in w for w in warnings_missing), str(warnings_missing))

# Test malformed key
os.environ["CREDENTIAL_ENCRYPTION_KEY"] = "not-a-valid-fernet-key"
warnings_bad = _cs()
check("malformed key produces at least 1 warning", len(warnings_bad) >= 1, str(warnings_bad))
check("malformed key warning mentions invalid key",
      any("not a valid fernet key" in w.lower() or "invalid" in w.lower() for w in warnings_bad),
      str(warnings_bad))

# Test valid key
from cryptography.fernet import Fernet
os.environ["CREDENTIAL_ENCRYPTION_KEY"] = Fernet.generate_key().decode()
warnings_ok = _cs()
check("valid key produces no warnings", warnings_ok == [], str(warnings_ok))

# Restore
os.environ.pop("CREDENTIAL_ENCRYPTION_KEY", None)
if _orig is not None:
    os.environ["CREDENTIAL_ENCRYPTION_KEY"] = _orig

print("\n=== /health exposes secret_warnings ===")

# Use a valid key so the health check is clean, then manually inject a warning
os.environ["CREDENTIAL_ENCRYPTION_KEY"] = Fernet.generate_key().decode()

from app.main import app, _seed_roles_for_org
from app.database import SessionLocal
from app.models import Organization, User
from app.auth import hash_password, create_token
from fastapi.testclient import TestClient

tc = TestClient(app, raise_server_exceptions=True)
tc.get("/health")

# Inject a synthetic warning for the health field test
import app.main as app_main
_orig_warnings = list(app_main._SECRET_WARNINGS)
app_main._SECRET_WARNINGS = ["TEST: synthetic missing secret warning"]

r = tc.get("/health")
check("/health returns 200", r.status_code == 200, f"got {r.status_code}")
body = r.json()
check("secret_warnings field present", "secret_warnings" in body, str(list(body.keys())))
check("secret_warnings contains synthetic warning",
      any("synthetic" in w for w in body.get("secret_warnings", [])),
      str(body.get("secret_warnings")))
check("status is 'degraded' when warnings present", body.get("status") == "degraded", body.get("status"))

# Clean state: force no warnings → status ok
app_main._SECRET_WARNINGS = []
r2 = tc.get("/health")
body2 = r2.json()
check("status is 'ok' when no warnings", body2.get("status") == "ok", body2.get("status"))
check("secret_warnings is empty list when clean", body2.get("secret_warnings") == [], str(body2.get("secret_warnings")))
app_main._SECRET_WARNINGS = _orig_warnings  # restore

print("\n=== FAIL_FAST_ON_MISSING_SECRETS ===")

import unittest.mock as _mock
os.environ.pop("CREDENTIAL_ENCRYPTION_KEY", None)
os.environ["FAIL_FAST_ON_MISSING_SECRETS"] = "true"
exited = False
exit_code = None
with _mock.patch("sys.exit") as mock_exit:
    _cs()  # call with key missing + fail_fast=true
    if mock_exit.called:
        exited = True
        exit_code = mock_exit.call_args[0][0] if mock_exit.call_args[0] else None

check("sys.exit called when FAIL_FAST=true and key missing", exited, "sys.exit not called")
check("sys.exit called with code 1", exit_code == 1, f"exit_code={exit_code}")

os.environ.pop("FAIL_FAST_ON_MISSING_SECRETS", None)
if _orig is not None:
    os.environ["CREDENTIAL_ENCRYPTION_KEY"] = _orig

print()
passed = sum(results)
total  = len(results)
if passed == total:
    print(f"\033[32mAll {total}/{total} checks passed.\033[0m\n")
else:
    print(f"\033[31m{total - passed}/{total} checks FAILED.\033[0m\n")
    sys.exit(1)
