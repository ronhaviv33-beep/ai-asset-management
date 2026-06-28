"""
Multi-tenant isolation tests for the synthetic enterprise environment.

Verifies that data from one organization is NEVER visible to another:
  • Telemetry is scoped by organization_id
  • Asset registry is scoped by organization_id
  • Budget rules are scoped by organization_id
  • Guard modes are scoped by organization_id
  • Policy rules are scoped by organization_id
  • Users are scoped by organization_id
  • API keys are scoped by organization_id
  • Team-scoped roles see only their team's telemetry
  • Org admins see all org data (never cross-org data)

ENV vars are set before any app import — do not reorder the top block.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import sys
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path

# ── Env setup BEFORE any app import ───────────────────────────────────────────
_db_path = f"/tmp/test_multitenant_{uuid.uuid4().hex[:8]}.db"
os.environ["DATABASE_URL"] = f"sqlite:///{_db_path}"
os.environ.setdefault("JWT_SECRET", "testsecret-multitenant-isolation")
os.environ.setdefault("CREDENTIAL_ENCRYPTION_KEY", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=")

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.chdir(str(Path(__file__).resolve().parent.parent))

import pytest
from fastapi.testclient import TestClient
from app.main import app, _seed_roles_for_org
from app.database import SessionLocal
from app.models import (
    Organization, User, ApiKey, Telemetry, AssetRegistry,
    BudgetRule, PolicyRule, GuardMode,
)
from app.auth import hash_password, generate_api_key, create_token
from app.org_config import set_org_config

# ── Shared test client + startup ──────────────────────────────────────────────
_client = TestClient(app, raise_server_exceptions=True)
_client.get("/health")   # trigger startup migrations

_db = SessionLocal()


def _slug(n: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", n.lower()).strip("-")


def _asset_key(org_id: int, agent: str) -> str:
    return hashlib.sha256(f"{org_id}:{agent}".encode()).hexdigest()


# ─── Create three isolated orgs ───────────────────────────────────────────────

_acme_org = Organization(name="Acme-Isolation-Test", slug="acme-iso-test")
_beta_org = Organization(name="Beta-Isolation-Test", slug="beta-iso-test")
_gamma_org = Organization(name="Gamma-Isolation-Test", slug="gamma-iso-test")
_db.add_all([_acme_org, _beta_org, _gamma_org])
_db.commit()
_db.refresh(_acme_org)
_db.refresh(_beta_org)
_db.refresh(_gamma_org)

for _o in [_acme_org, _beta_org, _gamma_org]:
    _seed_roles_for_org(_db, _o.id)

ACME_ID  = _acme_org.id
BETA_ID  = _beta_org.id
GAMMA_ID = _gamma_org.id

# Disable demo_mode so real (is_demo=False) telemetry rows are returned by the API
for _oid in [ACME_ID, BETA_ID, GAMMA_ID]:
    set_org_config(_db, _oid, "demo_mode", False)

# ── Admins ────────────────────────────────────────────────────────────────────

_acme_admin = User(email="acme-iso-admin@test.local",  name="Acme Admin",
                   hashed_password=hash_password("x"), role="admin",
                   team="", organization_id=ACME_ID)
_beta_admin = User(email="beta-iso-admin@test.local",  name="Beta Admin",
                   hashed_password=hash_password("x"), role="admin",
                   team="", organization_id=BETA_ID)
_gamma_admin = User(email="gamma-iso-admin@test.local", name="Gamma Admin",
                    hashed_password=hash_password("x"), role="admin",
                    team="", organization_id=GAMMA_ID)

# ── Team-scoped analysts (analyst = team_scoped: True) ────────────────────────
_acme_analyst_eng = User(email="acme-analyst-eng@test.local", name="Acme Analyst Eng",
                         hashed_password=hash_password("x"), role="analyst",
                         team="engineering", organization_id=ACME_ID)
_acme_analyst_sec = User(email="acme-analyst-sec@test.local", name="Acme Analyst Security",
                         hashed_password=hash_password("x"), role="analyst",
                         team="security", organization_id=ACME_ID)

_db.add_all([_acme_admin, _beta_admin, _gamma_admin,
             _acme_analyst_eng, _acme_analyst_sec])
_db.commit()
for u in [_acme_admin, _beta_admin, _gamma_admin,
          _acme_analyst_eng, _acme_analyst_sec]:
    _db.refresh(u)

# ── API keys ──────────────────────────────────────────────────────────────────
_acme_raw, _acme_pfx, _acme_hash = generate_api_key()
_beta_raw, _beta_pfx, _beta_hash = generate_api_key()

_acme_api_key = ApiKey(name="acme-iso-key", key_prefix=_acme_pfx,
                       key_hash=_acme_hash, team="engineering",
                       organization_id=ACME_ID, created_by_id=_acme_admin.id)
_beta_api_key = ApiKey(name="beta-iso-key", key_prefix=_beta_pfx,
                       key_hash=_beta_hash, team="security",
                       organization_id=BETA_ID, created_by_id=_beta_admin.id)
_db.add_all([_acme_api_key, _beta_api_key])
_db.commit()
_db.refresh(_acme_api_key)
_db.refresh(_beta_api_key)

# ── Guard modes ───────────────────────────────────────────────────────────────
_acme_gm = GuardMode(organization_id=ACME_ID, team="engineering", mode="enforce")
_beta_gm  = GuardMode(organization_id=BETA_ID,  team="engineering", mode="observe")
_db.add_all([_acme_gm, _beta_gm])
_db.commit()
_db.refresh(_acme_gm)
_db.refresh(_beta_gm)

# ── Budget rules ──────────────────────────────────────────────────────────────
_acme_budget = BudgetRule(organization_id=ACME_ID, team="engineering",
                          limit_usd=100.0, period="monthly", action="alert")
_beta_budget = BudgetRule(organization_id=BETA_ID, team="engineering",
                          limit_usd=50.0, period="monthly", action="block")
_db.add_all([_acme_budget, _beta_budget])
_db.commit()
_db.refresh(_acme_budget)
_db.refresh(_beta_budget)

# ── Policy rules ──────────────────────────────────────────────────────────────
_acme_policy = PolicyRule(organization_id=ACME_ID, team="*",
                           rule_type="block_model", value="gpt-4-turbo")
_beta_policy  = PolicyRule(organization_id=BETA_ID,  team="*",
                           rule_type="block_model", value="claude-opus-4-5")
_db.add_all([_acme_policy, _beta_policy])
_db.commit()
_db.refresh(_acme_policy)
_db.refresh(_beta_policy)

# ── Telemetry rows (one per org, same agent name to test isolation) ────────────
_now = datetime.now(timezone.utc)
SHARED_AGENT = "shared-agent-name"  # same agent name in both orgs

def _tel(org_id: int, agent: str, team: str) -> Telemetry:
    key = _asset_key(org_id, agent)
    return Telemetry(
        organization_id=org_id,
        team=team, agent=agent, model="gpt-4o",
        prompt=f"[iso-test] prompt for org {org_id}",
        response=f"[iso-test] response for org {org_id}",
        prompt_tokens=100, completion_tokens=50, total_tokens=150,
        latency_ms=200.0, cost_usd=0.00035, pricing_estimated=False,
        sensitive=False, blocked=False, timestamp=_now - timedelta(minutes=5),
        asset_key=key, agent_id_raw=agent, team_raw=team,
    )

_tel_acme   = _tel(ACME_ID,  SHARED_AGENT, "engineering")
_tel_beta   = _tel(BETA_ID,  SHARED_AGENT, "engineering")
_tel_gamma  = _tel(GAMMA_ID, SHARED_AGENT, "engineering")
# Additional telemetry in Acme for team-scope tests
_tel_acme_sec = _tel(ACME_ID, "security-agent", "security")
_db.add_all([_tel_acme, _tel_beta, _tel_gamma, _tel_acme_sec])
_db.commit()

# ── Asset registry rows ───────────────────────────────────────────────────────
_db.add_all([
    AssetRegistry(organization_id=ACME_ID,  asset_key=_asset_key(ACME_ID,  SHARED_AGENT),
                  agent_id_raw=SHARED_AGENT, agent_name=SHARED_AGENT, status="unassigned"),
    AssetRegistry(organization_id=BETA_ID,  asset_key=_asset_key(BETA_ID,  SHARED_AGENT),
                  agent_id_raw=SHARED_AGENT, agent_name=SHARED_AGENT, status="unassigned"),
    AssetRegistry(organization_id=GAMMA_ID, asset_key=_asset_key(GAMMA_ID, SHARED_AGENT),
                  agent_id_raw=SHARED_AGENT, agent_name=SHARED_AGENT, status="unassigned"),
])
_db.commit()

# ── Refresh all objects so attributes survive session close ───────────────────
for _u in [_acme_admin, _beta_admin, _gamma_admin, _acme_analyst_eng, _acme_analyst_sec]:
    _db.refresh(_u)
for _obj in [_acme_api_key, _beta_api_key, _acme_budget, _beta_budget]:
    _db.refresh(_obj)

# ── Auth headers (must be created while session is open) ──────────────────────
AH   = {"Authorization": f"Bearer {create_token(_acme_admin)}"}
BH   = {"Authorization": f"Bearer {create_token(_beta_admin)}"}
GH   = {"Authorization": f"Bearer {create_token(_gamma_admin)}"}
ANA_ENG = {"Authorization": f"Bearer {create_token(_acme_analyst_eng)}"}
ANA_SEC = {"Authorization": f"Bearer {create_token(_acme_analyst_sec)}"}
ACME_KEY_H = {"Authorization": f"Bearer {_acme_raw}"}
BETA_KEY_H = {"Authorization": f"Bearer {_beta_raw}"}

_db.close()


# ═══════════════════════════════════════════════════════════════════════════════
# Tests
# ═══════════════════════════════════════════════════════════════════════════════

class TestTelemetryIsolation:
    """Telemetry endpoint returns only the calling org's data."""

    def test_acme_telemetry_excludes_beta_data(self):
        r = _client.get("/telemetry", headers=AH)
        assert r.status_code == 200
        prompts = [row["prompt"] for row in r.json()]
        for p in prompts:
            assert f"org {BETA_ID}" not in p, "Acme must not see Beta telemetry rows"
            assert f"org {GAMMA_ID}" not in p, "Acme must not see Gamma telemetry rows"

    def test_beta_telemetry_excludes_acme_data(self):
        r = _client.get("/telemetry", headers=BH)
        assert r.status_code == 200
        prompts = [row["prompt"] for row in r.json()]
        for p in prompts:
            assert f"org {ACME_ID}" not in p, "Beta must not see Acme telemetry rows"

    def test_api_key_cannot_access_management_routes(self):
        """Raw API keys (gk-...) are proxy-only — they must be rejected on management routes."""
        r = _client.get("/telemetry", headers=ACME_KEY_H)
        assert r.status_code == 401, (
            f"Raw API key must not access /telemetry (management route), got {r.status_code}"
        )

    def test_three_orgs_same_agent_name_no_bleed(self):
        """Three orgs have the same agent name — each must see only their own rows."""
        r = _client.get("/telemetry", headers=AH)
        items = r.json()
        acme_rows = [i for i in items if i.get("agent") == SHARED_AGENT]
        for row in acme_rows:
            assert f"org {BETA_ID}" not in row["prompt"]
            assert f"org {GAMMA_ID}" not in row["prompt"]


class TestAssetRegistryIsolation:
    """Asset registry endpoints return only the calling org's agents."""

    def test_acme_assets_excludes_beta_agent(self):
        r = _client.get("/assets", headers=AH)
        assert r.status_code == 200
        names = [a.get("agent_name") or a.get("agent_id_raw") for a in r.json()]
        # All assets must belong to Acme — we can't directly see org_id in the response
        # so we verify the beta-only agent_id (via its unique org context) is absent.
        # Since both orgs have SHARED_AGENT, we check that only 1 entry exists here
        # (not duplicated from other orgs).
        shared_count = sum(1 for n in names if n == SHARED_AGENT)
        assert shared_count <= 1, (
            "Acme must not see Beta's shared agent — would show as duplicate"
        )

    def test_asset_claim_is_org_scoped(self):
        """Claiming an asset in Acme must not affect Beta's asset with the same name."""
        r = _client.post(
            f"/assets/{SHARED_AGENT}/claim",
            json={"owner": "acme-owner@test.local", "team": "engineering"},
            headers=AH,
        )
        assert r.status_code == 200
        assert r.json()["owner"] == "acme-owner@test.local"

        # Beta's asset with the same name must remain unassigned
        db = SessionLocal()
        try:
            beta_reg = db.query(AssetRegistry).filter(
                AssetRegistry.organization_id == BETA_ID,
                AssetRegistry.agent_id_raw == SHARED_AGENT,
            ).first()
            assert beta_reg is not None
            assert beta_reg.status == "unassigned", (
                "Beta's shared agent must remain unassigned after Acme claimed theirs"
            )
            assert beta_reg.owner is None
        finally:
            db.close()


class TestDiscoveryStatusIsolation:
    """Derived discovery-status fields are present and org-scoped (Pass 1)."""

    def test_agents_carry_derived_fields(self):
        r = _client.get("/agents", headers=AH)
        assert r.status_code == 200
        for rec in r.json():
            assert "discovery_stage" in rec
            assert "stage_label" in rec
            assert "identity_evidence" in rec
            # internal confidence_score must remain available (not removed)
            assert "confidence_score" in rec

    def test_identity_evidence_never_leaks_secrets(self):
        """No agent's evidence may contain raw key/token material."""
        import json as _json
        r = _client.get("/agents", headers=AH)
        assert r.status_code == 200
        for rec in r.json():
            blob = _json.dumps(rec.get("identity_evidence", {}))
            assert "Bearer " not in blob
            assert "gk-" not in blob
            assert "sk-ant-" not in blob

    def test_approve_suggestions_is_org_scoped(self):
        """Approving in Acme must not affect Beta's same-named asset."""
        r = _client.post(f"/agents/{SHARED_AGENT}/approve-suggestions", json={}, headers=AH)
        assert r.status_code == 200, r.text

        db = SessionLocal()
        try:
            beta_reg = db.query(AssetRegistry).filter(
                AssetRegistry.organization_id == BETA_ID,
                AssetRegistry.agent_id_raw == SHARED_AGENT,
            ).first()
            assert beta_reg is not None
            assert beta_reg.status == "unassigned", (
                "Beta's shared agent must remain unassigned after Acme approved theirs"
            )
        finally:
            db.close()

    def test_ignore_does_not_retire_or_cross_orgs(self):
        r = _client.post(f"/agents/{SHARED_AGENT}/ignore", json={}, headers=BH)
        assert r.status_code == 200, r.text
        assert r.json()["lifecycle_status"] != "retired"


class TestBudgetIsolation:
    """Budget rules and spend are scoped per org."""

    def test_acme_budget_list_excludes_beta_rules(self):
        r = _client.get("/budgets", headers=AH)
        assert r.status_code == 200
        rules = r.json()
        # Acme has only its own budget rule; Beta's rule ($50 block) must not appear
        limits = [b["limit_usd"] for b in rules]
        assert 50.0 not in limits, "Acme must not see Beta's $50 budget rule"

    def test_beta_cannot_delete_acme_budget(self):
        r = _client.delete(f"/budgets/{_acme_budget.id}", headers=BH)
        assert r.status_code == 404, (
            f"Beta deleting Acme budget must return 404, got {r.status_code}"
        )

    def test_beta_budget_survives_acme_delete_attempt(self):
        _client.delete(f"/budgets/{_beta_budget.id}", headers=AH)
        r = _client.get("/budgets", headers=BH)
        assert r.status_code == 200
        ids = [b["id"] for b in r.json()]
        assert _beta_budget.id in ids, "Beta budget must survive Acme's delete attempt"


class TestGuardModeIsolation:
    """Guard mode overrides are scoped per org."""

    def test_acme_guard_modes_exclude_beta_overrides(self):
        r = _client.get("/guard-modes", headers=AH)
        assert r.status_code == 200
        modes = r.json()
        for m in modes:
            if m.get("is_override") and m["team"] == "engineering":
                assert m["mode"] == "enforce", (
                    "Acme's engineering guard mode must be 'enforce', not Beta's 'observe'"
                )

    def test_acme_write_does_not_affect_beta(self):
        _client.put("/guard-modes/engineering", headers=AH, json={"mode": "alert"})
        r = _client.get("/guard-modes", headers=BH)
        assert r.status_code == 200
        modes = r.json()
        eng = next((m for m in modes if m["team"] == "engineering" and m.get("is_override")), None)
        if eng:
            assert eng["mode"] == "observe", (
                "Beta's engineering mode must remain 'observe' after Acme set 'alert'"
            )


class TestPolicyIsolation:
    """Policy rules are scoped per org."""

    def test_acme_policies_exclude_beta_rules(self):
        r = _client.get("/policies", headers=AH)
        assert r.status_code == 200
        rules = r.json()
        blocked_values = [p["value"] for p in rules]
        assert "claude-opus-4-5" not in blocked_values, (
            "Acme must not see Beta's policy blocking claude-opus-4-5"
        )

    def test_beta_policies_exclude_acme_rules(self):
        r = _client.get("/policies", headers=BH)
        assert r.status_code == 200
        rules = r.json()
        blocked_values = [p["value"] for p in rules]
        assert "gpt-4-turbo" not in blocked_values, (
            "Beta must not see Acme's policy blocking gpt-4-turbo"
        )


class TestUserIsolation:
    """User management is scoped per org."""

    def test_acme_user_list_excludes_beta_users(self):
        r = _client.get("/auth/users", headers=AH)
        assert r.status_code == 200
        emails = [u["email"] for u in r.json()]
        assert "beta-iso-admin@test.local" not in emails
        assert "gamma-iso-admin@test.local" not in emails
        assert "acme-iso-admin@test.local" in emails

    def test_beta_user_list_excludes_acme_users(self):
        r = _client.get("/auth/users", headers=BH)
        assert r.status_code == 200
        emails = [u["email"] for u in r.json()]
        assert "acme-iso-admin@test.local" not in emails
        assert "beta-iso-admin@test.local" in emails

    def test_acme_cannot_modify_beta_user(self):
        r = _client.patch(f"/auth/users/{_beta_admin.id}", headers=AH, json={"name": "Hacked"})
        assert r.status_code == 404, (
            f"Acme patching Beta user must return 404, got {r.status_code}"
        )

    def test_gamma_admin_exists_only_in_gamma(self):
        r = _client.get("/auth/users", headers=GH)
        assert r.status_code == 200
        emails = [u["email"] for u in r.json()]
        assert "gamma-iso-admin@test.local" in emails
        assert "acme-iso-admin@test.local" not in emails
        assert "beta-iso-admin@test.local" not in emails


class TestApiKeyIsolation:
    """API keys are scoped per org."""

    def test_acme_key_list_excludes_beta_keys(self):
        r = _client.get("/api-keys", headers=AH)
        assert r.status_code == 200
        names = [k["name"] for k in r.json()]
        assert "beta-iso-key" not in names
        assert "acme-iso-key" in names

    def test_beta_key_list_excludes_acme_keys(self):
        r = _client.get("/api-keys", headers=BH)
        assert r.status_code == 200
        names = [k["name"] for k in r.json()]
        assert "acme-iso-key" not in names
        assert "beta-iso-key" in names

    def test_acme_cannot_revoke_beta_key(self):
        r = _client.delete(f"/api-keys/{_beta_api_key.id}", headers=AH)
        assert r.status_code == 404


class TestTeamScopeIsolation:
    """Team-scoped analyst roles see only their team's telemetry."""

    def test_analyst_sees_own_team_telemetry(self):
        """Engineering analyst sees engineering team telemetry."""
        r = _client.get("/telemetry", headers=ANA_ENG)
        assert r.status_code == 200
        for row in r.json():
            assert row["team"] == "engineering", (
                f"Engineering analyst must only see 'engineering' telemetry, got '{row['team']}'"
            )

    def test_analyst_cannot_see_other_team_telemetry(self):
        """Security analyst must not see engineering team telemetry."""
        r = _client.get("/telemetry", headers=ANA_SEC)
        assert r.status_code == 200
        for row in r.json():
            assert row["team"] == "security", (
                f"Security analyst must only see 'security' telemetry, got '{row['team']}'"
            )

    def test_admin_sees_all_teams_in_own_org(self):
        """Org admin sees telemetry from all teams in their org."""
        r = _client.get("/telemetry", headers=AH)
        assert r.status_code == 200
        teams_seen = {row["team"] for row in r.json()}
        assert len(teams_seen) >= 2, (
            f"Admin must see multiple teams; only saw: {teams_seen}"
        )


class TestCrossOrgApiKeyAccess:
    """Raw API keys (gk-...) are restricted to proxy routes only, never management routes."""

    def test_acme_api_key_rejected_on_management_route(self):
        """Acme API key must not be accepted on /telemetry (JWT-only route)."""
        r = _client.get("/telemetry", headers=ACME_KEY_H)
        assert r.status_code == 401, (
            f"Acme raw API key must be rejected on /telemetry, got {r.status_code}"
        )

    def test_beta_api_key_rejected_on_management_route(self):
        """Beta API key must not be accepted on /telemetry (JWT-only route)."""
        r = _client.get("/telemetry", headers=BETA_KEY_H)
        assert r.status_code == 401, (
            f"Beta raw API key must be rejected on /telemetry, got {r.status_code}"
        )


class TestRoleIsolation:
    """Roles are scoped per org — orgs cannot see or modify each other's roles."""

    def test_each_org_has_exactly_3_seed_roles(self):
        for headers, org_name in [(AH, "Acme"), (BH, "Beta"), (GH, "Gamma")]:
            r = _client.get("/roles", headers=headers)
            assert r.status_code == 200
            names = {role["name"] for role in r.json()}
            assert {"admin", "analyst", "viewer"} == names, (
                f"{org_name} must have exactly admin/analyst/viewer seeded, got {names}"
            )

    def test_acme_custom_role_not_visible_to_beta(self):
        r = _client.post("/roles", headers=AH,
                         json={"name": "iso-ops", "label": "Ops",
                               "color": "#aabbcc", "pages": ["home"], "can": []})
        assert r.status_code == 201

        r_beta = _client.get("/roles", headers=BH)
        assert r_beta.status_code == 200
        beta_names = [x["name"] for x in r_beta.json()]
        assert "iso-ops" not in beta_names


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
