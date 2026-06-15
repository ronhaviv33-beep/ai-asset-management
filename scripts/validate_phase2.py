#!/usr/bin/env python3
"""
Phase 2 end-to-end validation script.

Exercises every step of the lifecycle in order:
  1. Start with clean DB
  2. Send proxy request with all 4 identity headers
  3. Asset appears in unassigned queue
  4. Telemetry row has asset_key, agent_id_raw, agent_version, team_raw, environment_raw
  5. Claim the asset
  6. Inventory shows canonical values from asset_registry
  7. Runtime hints present only in detail view, not inventory table
  8. Retire the asset → disappears from active inventory
  9. include_retired=true → reappears
 10. Historical telemetry rows unchanged after claim + retire
"""
import hashlib
import os
import re
import sys
import uuid
from datetime import datetime, timezone

# ── env must be set before app imports ────────────────────────────────────────
_DB = f"/tmp/e2e_phase2_{uuid.uuid4().hex[:8]}.db"
os.environ["DATABASE_URL"]              = f"sqlite:///{_DB}"
os.environ.setdefault("JWT_SECRET",                "e2e-test-secret-phase2")
os.environ.setdefault("CREDENTIAL_ENCRYPTION_KEY", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from unittest.mock import patch, AsyncMock, MagicMock
from fastapi.testclient import TestClient

from app.main import app, _seed_roles_for_org
from app.database import SessionLocal
from app.models import Organization, User, ApiKey, Telemetry, AssetRegistry
from app.auth import hash_password, create_token, generate_api_key
from app.assets import _asset_key as compute_asset_key

# ── ANSI colours ──────────────────────────────────────────────────────────────
GREEN = "\033[32m"; RED = "\033[31m"; YELLOW = "\033[33m"
CYAN  = "\033[36m"; BOLD = "\033[1m"; RESET = "\033[0m"

passed = []; failed = []

def check(label: str, condition: bool, detail: str = ""):
    if condition:
        passed.append(label)
        print(f"  {GREEN}✓{RESET} {label}")
    else:
        failed.append(label)
        msg = f"  {RED}✗ FAIL{RESET} {label}"
        if detail:
            msg += f"\n    {RED}→ {detail}{RESET}"
        print(msg)
    return condition


# ── Seed a fresh org + admin + API key ────────────────────────────────────────
print(f"\n{BOLD}{CYAN}Phase 2 End-to-End Validation{RESET}")
print(f"DB: {_DB}\n")

client = TestClient(app, raise_server_exceptions=True)
client.get("/health")   # trigger startup migrations + seed

db = SessionLocal()

def _slug(n): return re.sub(r"[^a-z0-9]+", "-", n.lower()).strip("-")

org = Organization(name="E2ETestOrg", slug=_slug("E2ETestOrg"))
db.add(org); db.commit(); db.refresh(org)
_seed_roles_for_org(db, org.id)
ORG_ID = org.id

admin = User(
    email="e2e-admin@test.local", name="E2E Admin",
    hashed_password=hash_password("x"), role="admin",
    team="platform", organization_id=ORG_ID,
)
db.add(admin); db.commit(); db.refresh(admin)
admin_hdrs = {"Authorization": f"Bearer {create_token(admin)}"}

raw_key, key_prefix, hashed = generate_api_key()
db.add(ApiKey(
    name="e2e-key", key_hash=hashed, key_prefix=key_prefix,
    team="platform", organization_id=ORG_ID, created_by_id=admin.id,
))
db.commit()

# ── Test subject ──────────────────────────────────────────────────────────────
AGENT      = f"fraud-detector-v2"
AGENT_VER  = "2.1.4"
TEAM_HINT  = "data-science"          # runtime hint (what telemetry records)
ENV_HINT   = "staging"               # runtime hint
CANON_TEAM = "risk-ops"              # what we set when claiming (canonical)
CANON_ENV  = "prod"                  # what we set when claiming (canonical)

proxy_hdrs = {
    "Authorization":          f"Bearer {raw_key}",
    "X-Guard-Agent":          AGENT,
    "X-Guard-Agent-Version":  AGENT_VER,
    "X-Guard-Team":           TEAM_HINT,
    "X-Guard-Environment":    ENV_HINT,
}

def fake_resp(model="gpt-4o-mini"):
    return {
        "id": "chatcmpl-e2e", "object": "chat.completion", "model": model,
        "choices": [{"index": 0, "message": {"role": "assistant", "content": "ok"}, "finish_reason": "stop"}],
        "usage": {"prompt_tokens": 100, "completion_tokens": 50, "total_tokens": 150},
    }

# ══════════════════════════════════════════════════════════════════════════════
print(f"{BOLD}Step 2 — Send proxy request with all 4 identity headers{RESET}")
# ══════════════════════════════════════════════════════════════════════════════

with patch("app.main.get_client_for_org", return_value=MagicMock()), \
     patch("app.main.proxy_chat_complete", new_callable=AsyncMock,
           return_value=fake_resp()):
    resp = client.post(
        "/v1/chat/completions",
        json={"model": "gpt-4o-mini", "messages": [{"role": "user", "content": "classify risk"}]},
        headers=proxy_hdrs,
    )

check("Proxy request returns 200", resp.status_code == 200,
      f"status={resp.status_code} body={resp.text[:200]}")

# ══════════════════════════════════════════════════════════════════════════════
print(f"\n{BOLD}Step 3 — Asset appears in Unassigned queue{RESET}")
# ══════════════════════════════════════════════════════════════════════════════

r = client.get("/assets/registry/unassigned", headers=admin_hdrs)
check("GET /assets/registry/unassigned returns 200", r.status_code == 200, r.text)

queue = r.json() if r.status_code == 200 else []
unassigned_row = next((q for q in queue if q["agent_id_raw"] == AGENT), None)
check(f"Agent '{AGENT}' appears in unassigned queue", unassigned_row is not None,
      f"queue agent_ids={[q['agent_id_raw'] for q in queue]}")
if unassigned_row:
    check("Queue row has status='unassigned'",
          unassigned_row["status"] == "unassigned",
          f"got {unassigned_row['status']!r}")
    check("Queue row has correct source='discovered'",
          unassigned_row["source"] == "discovered",
          f"got {unassigned_row['source']!r}")

# ══════════════════════════════════════════════════════════════════════════════
print(f"\n{BOLD}Step 4 — Telemetry row has all 5 identity fields{RESET}")
# ══════════════════════════════════════════════════════════════════════════════

db.expire_all()
tel_rows = db.query(Telemetry).filter(
    Telemetry.organization_id == ORG_ID,
    Telemetry.agent == AGENT,
).all()
check("At least one telemetry row exists for the agent", len(tel_rows) >= 1,
      f"found {len(tel_rows)} rows")

if tel_rows:
    t = tel_rows[0]
    expected_key = hashlib.sha256(f"{ORG_ID}:{AGENT}".encode()).hexdigest()

    check("telemetry.asset_key is set", t.asset_key is not None,
          "asset_key is None")
    check("telemetry.asset_key = sha256(org_id:agent_id_raw)",
          t.asset_key == expected_key,
          f"got {t.asset_key!r}, expected {expected_key!r}")
    check("telemetry.agent_id_raw = X-Guard-Agent header",
          t.agent_id_raw == AGENT,
          f"got {t.agent_id_raw!r}")
    check("telemetry.agent_version = X-Guard-Agent-Version header",
          t.agent_version == AGENT_VER,
          f"got {t.agent_version!r}")
    check("telemetry.team_raw = X-Guard-Team header (runtime hint)",
          t.team_raw == TEAM_HINT,
          f"got {t.team_raw!r}")
    check("telemetry.environment_raw = X-Guard-Environment header (runtime hint)",
          t.environment_raw == ENV_HINT,
          f"got {t.environment_raw!r}")
    check("telemetry.team column still set (attribution)",
          t.team is not None and len(t.team) > 0,
          f"got {t.team!r}")

    # Snapshot telemetry for later comparison
    tel_snapshot = {c.name: getattr(t, c.name) for c in t.__table__.columns}

# ══════════════════════════════════════════════════════════════════════════════
print(f"\n{BOLD}Step 5 — Claim the asset{RESET}")
# ══════════════════════════════════════════════════════════════════════════════

claim_resp = client.post(
    f"/assets/{AGENT}/claim",
    json={
        "owner":            "alice@risk-ops.com",
        "team":             CANON_TEAM,
        "environment":      CANON_ENV,
        "criticality":      "high",
        "business_purpose": "Real-time transaction fraud classification",
        "agent_name":       "Fraud Detector v2",
    },
    headers=admin_hdrs,
)
check("POST /assets/{agent}/claim returns 200", claim_resp.status_code == 200,
      claim_resp.text[:200])

if claim_resp.status_code == 200:
    cb = claim_resp.json()
    check("claimed_by is the admin email", cb.get("claimed_by") == "e2e-admin@test.local",
          f"got {cb.get('claimed_by')!r}")
    check("status = managed after claim", cb.get("status") == "managed",
          f"got {cb.get('status')!r}")
    check("claimed_at is set", cb.get("claimed_at") is not None,
          "claimed_at is None")

# ══════════════════════════════════════════════════════════════════════════════
print(f"\n{BOLD}Step 6 — Inventory shows canonical values from asset_registry{RESET}")
# ══════════════════════════════════════════════════════════════════════════════

inv_resp = client.get("/assets", headers=admin_hdrs)
check("GET /assets returns 200", inv_resp.status_code == 200, inv_resp.text[:200])

inv = inv_resp.json() if inv_resp.status_code == 200 else []
asset = next((a for a in inv if a["agent_name"] == AGENT), None)
check(f"Agent '{AGENT}' appears in inventory", asset is not None,
      f"agent_names in inventory={[a['agent_name'] for a in inv[:5]]}")

if asset:
    check("inventory.owner = canonical (from registry, not telemetry)",
          asset.get("owner") == "alice@risk-ops.com",
          f"got {asset.get('owner')!r}")
    check(f"inventory.team = '{CANON_TEAM}' (canonical, overrides hint '{TEAM_HINT}')",
          asset.get("team") == CANON_TEAM,
          f"got {asset.get('team')!r}")
    check(f"inventory.environment = '{CANON_ENV}' (canonical, overrides hint '{ENV_HINT}')",
          asset.get("environment") == CANON_ENV,
          f"got {asset.get('environment')!r}")
    check("inventory.criticality = 'high'",
          asset.get("criticality") == "high",
          f"got {asset.get('criticality')!r}")
    check("inventory.lifecycle_status = 'managed'",
          asset.get("lifecycle_status") == "managed",
          f"got {asset.get('lifecycle_status')!r}")

# Single-asset detail endpoint
detail_resp = client.get(f"/assets/{AGENT}", headers=admin_hdrs)
check("GET /assets/{agent} returns 200", detail_resp.status_code == 200,
      detail_resp.text[:200])

if detail_resp.status_code == 200:
    d = detail_resp.json()
    check("detail.asset_key matches expected sha256",
          d.get("asset_key") == hashlib.sha256(f"{ORG_ID}:{AGENT}".encode()).hexdigest(),
          f"got {d.get('asset_key')!r}")
    check("detail.business_purpose from registry",
          d.get("business_purpose") == "Real-time transaction fraud classification",
          f"got {d.get('business_purpose')!r}")

# ══════════════════════════════════════════════════════════════════════════════
print(f"\n{BOLD}Step 7 — Runtime hints not in inventory table-level fields{RESET}")
# ══════════════════════════════════════════════════════════════════════════════

if asset:
    # team_raw and environment_raw must NOT appear as top-level inventory fields
    # that override canonical values. If they were used instead of registry values,
    # team would still be TEAM_HINT ("data-science") not CANON_TEAM ("risk-ops").
    check("inventory.team is NOT the runtime hint (team_raw)",
          asset.get("team") != TEAM_HINT,
          f"team={asset.get('team')!r} should not equal hint={TEAM_HINT!r}")
    check("inventory.environment is NOT the runtime hint (environment_raw)",
          asset.get("environment") != ENV_HINT,
          f"environment={asset.get('environment')!r} should not equal hint={ENV_HINT!r}")
    check("team_raw / environment_raw not promoted to top-level inventory fields",
          "team_raw" not in asset and "environment_raw" not in asset,
          f"Unexpected keys: {[k for k in ('team_raw','environment_raw') if k in asset]}")

if detail_resp.status_code == 200:
    d = detail_resp.json()
    # asset_key is in the detail view — confirms it's surfaced for the expanded row
    check("detail view includes asset_key (for expanded row runtime hints)",
          d.get("asset_key") is not None,
          "asset_key missing from detail response")

# ══════════════════════════════════════════════════════════════════════════════
print(f"\n{BOLD}Step 8 — Retire the asset; disappears from active inventory{RESET}")
# ══════════════════════════════════════════════════════════════════════════════

retire_resp = client.patch(
    f"/assets/{AGENT}/registry",
    json={"status": "retired"},
    headers=admin_hdrs,
)
check("PATCH /assets/{agent}/registry returns 200", retire_resp.status_code == 200,
      retire_resp.text[:200])

active_inv = client.get("/assets", headers=admin_hdrs).json()
names_active = [a["agent_name"] for a in active_inv]
check("Retired asset is absent from default inventory",
      AGENT not in names_active,
      f"Agent still present in: {names_active[:5]}")

# ══════════════════════════════════════════════════════════════════════════════
print(f"\n{BOLD}Step 9 — include_retired=true restores the asset{RESET}")
# ══════════════════════════════════════════════════════════════════════════════

incl_resp = client.get("/assets?include_retired=true", headers=admin_hdrs)
check("GET /assets?include_retired=true returns 200", incl_resp.status_code == 200,
      incl_resp.text[:200])

incl_inv = incl_resp.json() if incl_resp.status_code == 200 else []
retired_asset = next((a for a in incl_inv if a["agent_name"] == AGENT), None)
check("Retired asset reappears with include_retired=true",
      retired_asset is not None,
      f"names={[a['agent_name'] for a in incl_inv[:5]]}")
if retired_asset:
    check("Retired asset has lifecycle_status='retired'",
          retired_asset.get("lifecycle_status") == "retired",
          f"got {retired_asset.get('lifecycle_status')!r}")

# ══════════════════════════════════════════════════════════════════════════════
print(f"\n{BOLD}Step 10 — Historical telemetry rows unchanged after claim + retire{RESET}")
# ══════════════════════════════════════════════════════════════════════════════

db.expire_all()
final_rows = db.query(Telemetry).filter(
    Telemetry.organization_id == ORG_ID,
    Telemetry.agent == AGENT,
).all()

check("Same number of telemetry rows before and after operations",
      len(final_rows) == len(tel_rows),
      f"before={len(tel_rows)}, after={len(final_rows)}")

if final_rows and tel_snapshot:
    final = final_rows[0]
    mutation_found = False
    for col, before_val in tel_snapshot.items():
        after_val = getattr(final, col)
        if before_val != after_val:
            mutation_found = True
            print(f"    {RED}→ column '{col}' mutated: {before_val!r} → {after_val!r}{RESET}")
    check("No telemetry column was mutated by claim or retire", not mutation_found,
          "See column diffs above")

check("telemetry.team_raw still holds original runtime hint after claim + retire",
      len(final_rows) > 0 and final_rows[0].team_raw == TEAM_HINT,
      f"got {final_rows[0].team_raw if final_rows else 'N/A'!r}")
check("telemetry.environment_raw still holds original runtime hint after claim + retire",
      len(final_rows) > 0 and final_rows[0].environment_raw == ENV_HINT,
      f"got {final_rows[0].environment_raw if final_rows else 'N/A'!r}")

# ══════════════════════════════════════════════════════════════════════════════
print(f"\n{BOLD}{'═'*55}{RESET}")
total = len(passed) + len(failed)
if failed:
    print(f"\n{BOLD}{RED}FAILED — {len(failed)}/{total} checks did not pass:{RESET}")
    for f in failed:
        print(f"  {RED}✗ {f}{RESET}")
    print()
    sys.exit(1)
else:
    print(f"\n{BOLD}{GREEN}ALL {total} CHECKS PASSED — Phase 2 validated ✓{RESET}\n")
    sys.exit(0)
