"""
Tests for the Approve-Suggestions / Ignore flow (Pass 1) plus regression
coverage that the existing claim flows still work unchanged.

ENV vars are set before any app import — do not reorder the top block.
"""
from __future__ import annotations

import hashlib
import json
import os
import sys
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path

_db_path = f"/tmp/test_approve_{uuid.uuid4().hex[:8]}.db"
os.environ["DATABASE_URL"] = f"sqlite:///{_db_path}"
os.environ.setdefault("JWT_SECRET", "testsecret-approve-suggestions")
os.environ.setdefault("CREDENTIAL_ENCRYPTION_KEY", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=")

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.chdir(str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient
from app.main import app, _seed_roles_for_org
from app.database import SessionLocal
from app.models import Organization, User, Telemetry, AssetRegistry
from app.auth import hash_password, create_token
from app.org_config import set_org_config

_client = TestClient(app, raise_server_exceptions=True)
_client.get("/health")

_db = SessionLocal()


def _asset_key(org_id: int, agent: str) -> str:
    return hashlib.sha256(f"{org_id}:{agent}".encode()).hexdigest()


_org = Organization(name="ApproveTestOrg", slug="approve-test-org")
_db.add(_org)
_db.commit()
_db.refresh(_org)
_seed_roles_for_org(_db, _org.id)
ORG_ID = _org.id
set_org_config(_db, ORG_ID, "demo_mode", False)

_admin = User(email="admin@approve.test", name="Approve Admin",
              hashed_password=hash_password("x"), role="admin",
              team="", organization_id=ORG_ID)
_db.add(_admin)
_db.commit()
_db.refresh(_admin)

AH = {"Authorization": f"Bearer {create_token(_admin)}"}

_now = datetime.now(timezone.utc)


def _seed_agent(agent: str, team: str = "engineering") -> None:
    """Insert telemetry so the agent shows up as a verified (telemetry-derived) agent."""
    db = SessionLocal()
    try:
        db.add(Telemetry(
            organization_id=ORG_ID, team=team, agent=agent, model="gpt-4o",
            prompt="p", response="r", prompt_tokens=10, completion_tokens=5, total_tokens=15,
            latency_ms=100.0, cost_usd=0.001, pricing_estimated=False, sensitive=False,
            blocked=False, timestamp=_now - timedelta(minutes=2),
            asset_key=_asset_key(ORG_ID, agent), agent_id_raw=agent, team_raw=team, is_demo=False,
        ))
        db.commit()
    finally:
        db.close()


def _reg(agent: str) -> AssetRegistry | None:
    db = SessionLocal()
    try:
        row = db.query(AssetRegistry).filter(
            AssetRegistry.organization_id == ORG_ID,
            AssetRegistry.asset_key == _asset_key(ORG_ID, agent),
        ).first()
        if row:
            db.expunge(row)
        return row
    finally:
        db.close()


_db.close()


# ═══════════════════════════════════════════════════════════════════════════════
# Approve suggestions
# ═══════════════════════════════════════════════════════════════════════════════

class TestApproveSuggestions:
    def test_approve_marks_managed_and_claimed(self):
        agent = f"approve-{uuid.uuid4().hex[:6]}"
        _seed_agent(agent, team="engineering")

        r = _client.post(f"/agents/{agent}/approve-suggestions", json={}, headers=AH)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("lifecycle_status") == "managed"

        reg = _reg(agent)
        assert reg is not None
        assert reg.status == "managed"
        assert reg.claimed_by == "admin@approve.test"
        # team suggestion derived from telemetry should be applied
        assert reg.team == "engineering"

    def test_approve_records_evidence_event(self):
        agent = f"approve-ev-{uuid.uuid4().hex[:6]}"
        _seed_agent(agent)
        r = _client.post(f"/agents/{agent}/approve-suggestions", json={}, headers=AH)
        assert r.status_code == 200, r.text
        reg = _reg(agent)
        events = json.loads(reg.evidence or "{}").get("validation_events", [])
        assert any(e.get("action") == "approved_suggestions" for e in events)

    def test_approve_respects_explicit_override(self):
        agent = f"approve-ovr-{uuid.uuid4().hex[:6]}"
        _seed_agent(agent, team="engineering")
        r = _client.post(f"/agents/{agent}/approve-suggestions",
                         json={"owner": "explicit@x.com", "environment": "staging"}, headers=AH)
        assert r.status_code == 200, r.text
        reg = _reg(agent)
        assert reg.owner == "explicit@x.com"
        assert reg.environment == "staging"


# ═══════════════════════════════════════════════════════════════════════════════
# Ignore (evidence-trail only, never retire)
# ═══════════════════════════════════════════════════════════════════════════════

class TestIgnore:
    def test_ignore_records_event_without_retiring(self):
        agent = f"ignore-{uuid.uuid4().hex[:6]}"
        _seed_agent(agent)
        r = _client.post(f"/agents/{agent}/ignore", json={"reason": "not an agent"}, headers=AH)
        assert r.status_code == 200, r.text

        reg = _reg(agent)
        assert reg is not None
        assert reg.status != "retired", "Ignore must NOT retire the agent"
        events = json.loads(reg.evidence or "{}").get("validation_events", [])
        assert any(e.get("action") == "ignored" for e in events)

    def test_ignored_agent_still_discoverable(self):
        """Ignore is reversible: the agent still has a registry row and telemetry."""
        agent = f"ignore-keep-{uuid.uuid4().hex[:6]}"
        _seed_agent(agent)
        _client.post(f"/agents/{agent}/ignore", json={}, headers=AH)
        r = _client.get(f"/agents/{agent}", headers=AH)
        assert r.status_code == 200, r.text


# ═══════════════════════════════════════════════════════════════════════════════
# Regression — existing claim flows must keep working with the same shape
# ═══════════════════════════════════════════════════════════════════════════════

class TestClaimRegression:
    def test_agents_claim_still_works(self):
        agent = f"claim-{uuid.uuid4().hex[:6]}"
        _seed_agent(agent)
        r = _client.post(f"/agents/{agent}/claim",
                         json={"owner": "owner@x.com", "team": "engineering",
                               "environment": "production"}, headers=AH)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("lifecycle_status") == "managed"
        assert body.get("asset_key")
        reg = _reg(agent)
        assert reg.status == "managed"
        assert reg.owner == "owner@x.com"
        assert reg.claimed_by == "admin@approve.test"

    def test_assets_claim_still_works(self):
        agent = f"assetclaim-{uuid.uuid4().hex[:6]}"
        _seed_agent(agent)
        # /assets/{name}/claim operates on an already-discovered registry row
        # (the proxy creates it on first traffic). Seed one to mirror that.
        db = SessionLocal()
        try:
            db.add(AssetRegistry(
                organization_id=ORG_ID, asset_key=_asset_key(ORG_ID, agent),
                agent_id_raw=agent, agent_name=agent, status="unassigned",
                source="discovered", first_seen_at=_now, is_demo=False,
            ))
            db.commit()
        finally:
            db.close()
        r = _client.post(f"/assets/{agent}/claim",
                         json={"owner": "o2@x.com", "team": "engineering",
                               "environment": "production"}, headers=AH)
        assert r.status_code == 200, r.text
        body = r.json()
        # Shape preserved: governance fields present
        for field in ("asset_key", "owner", "team", "status", "claimed_by", "claimed_at"):
            assert field in body, f"missing {field} in /assets claim response"
        assert body["status"] == "managed"

    def test_new_derived_fields_present_in_inventory(self):
        agent = f"derived-{uuid.uuid4().hex[:6]}"
        _seed_agent(agent)
        r = _client.get("/agents", headers=AH)
        assert r.status_code == 200, r.text
        rec = next((a for a in r.json() if a.get("agent_name") == agent), None)
        assert rec is not None
        # Additive customer-facing fields ride alongside the internal confidence_score
        assert "discovery_stage" in rec
        assert "stage_label" in rec
        assert "identity_evidence" in rec
        assert "confidence_score" in rec  # internal field preserved


# ═══════════════════════════════════════════════════════════════════════════════
# Partial / missing suggestions must not crash the approve/ignore flow
# ═══════════════════════════════════════════════════════════════════════════════

class TestPartialSuggestions:
    def test_approve_team_only_when_owner_missing(self):
        """Owner missing but team present → managed with team-only ownership."""
        agent = f"teamonly-{uuid.uuid4().hex[:6]}"
        _seed_agent(agent, team="trading-research")
        r = _client.post(f"/agents/{agent}/approve-suggestions", json={}, headers=AH)
        assert r.status_code == 200, r.text
        reg = _reg(agent)
        assert reg.status == "managed"
        assert reg.team == "trading-research"
        assert reg.claimed_by == "admin@approve.test"
        assert not reg.owner  # no owner suggested → team-only ownership, not a crash

    def test_approve_with_no_suggestions_does_not_crash(self):
        """No team and no owner → still succeeds (managed), no error."""
        agent = f"nosug-{uuid.uuid4().hex[:6]}"
        _seed_agent(agent, team="")
        r = _client.post(f"/agents/{agent}/approve-suggestions", json={}, headers=AH)
        assert r.status_code == 200, r.text
        reg = _reg(agent)
        assert reg.status == "managed"

    def test_ignore_with_empty_body(self):
        agent = f"ign-empty-{uuid.uuid4().hex[:6]}"
        _seed_agent(agent)
        r = _client.post(f"/agents/{agent}/ignore", headers=AH)   # no json body at all
        assert r.status_code == 200, r.text
        assert r.json().get("lifecycle_status") != "retired"

    def test_non_dict_evidence_does_not_crash(self):
        """A registry row whose evidence is a non-dict JSON must not 500 approve/ignore."""
        agent = f"badev-{uuid.uuid4().hex[:6]}"
        _seed_agent(agent)
        db = SessionLocal()
        try:
            db.add(AssetRegistry(
                organization_id=ORG_ID, asset_key=_asset_key(ORG_ID, agent),
                agent_id_raw=agent, agent_name=agent, status="unassigned",
                source="discovered", first_seen_at=_now, is_demo=False,
                evidence="[]",   # legacy/demo non-dict evidence
            ))
            db.commit()
        finally:
            db.close()
        r1 = _client.post(f"/agents/{agent}/ignore", json={}, headers=AH)
        assert r1.status_code == 200, r1.text
        r2 = _client.post(f"/agents/{agent}/approve-suggestions", json={}, headers=AH)
        assert r2.status_code == 200, r2.text
        reg = _reg(agent)
        events = json.loads(reg.evidence or "{}").get("validation_events", [])
        assert any(e.get("action") == "approved_suggestions" for e in events)
