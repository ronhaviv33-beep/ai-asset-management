"""
Read-time synthetic provider/model/gateway relationships (Pass 1 refinement).

Verifies the dependency map is never empty after the first request: telemetry
produces agent→provider, agent→model, agent→gateway edges WITHOUT persistence,
scoped per organization.

ENV vars set before any app import — do not reorder the top block.
"""
from __future__ import annotations

import hashlib
import os
import sys
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path

_db_path = f"/tmp/test_synth_rel_{uuid.uuid4().hex[:8]}.db"
os.environ["DATABASE_URL"] = f"sqlite:///{_db_path}"
os.environ.setdefault("JWT_SECRET", "testsecret-synth-rel")
os.environ.setdefault("CREDENTIAL_ENCRYPTION_KEY", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=")

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.chdir(str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient
from app.main import app, _seed_roles_for_org
from app.database import SessionLocal
from app.models import Organization, User, Telemetry, AgentRelationship
from app.auth import hash_password, create_token
from app.org_config import set_org_config
from app.relationships import get_relationships

_client = TestClient(app, raise_server_exceptions=True)
_client.get("/health")

_db = SessionLocal()


def _akey(org_id, agent):
    return hashlib.sha256(f"{org_id}:{agent}".encode()).hexdigest()


_org = Organization(name="SynthRelOrg", slug="synth-rel-org")
_other = Organization(name="SynthRelOther", slug="synth-rel-other")
_db.add_all([_org, _other])
_db.commit()
_db.refresh(_org)
_db.refresh(_other)
for o in (_org, _other):
    _seed_roles_for_org(_db, o.id)
    set_org_config(_db, o.id, "demo_mode", False)
ORG_ID, OTHER_ID = _org.id, _other.id

_admin = User(email="admin@synthrel.test", name="Admin", hashed_password=hash_password("x"),
              role="admin", team="", organization_id=ORG_ID)
_db.add(_admin)
_db.commit()
_db.refresh(_admin)
AH = {"Authorization": f"Bearer {create_token(_admin)}"}

_AGENT = "customer-support-prod"
_now = datetime.now(timezone.utc)
_db.add(Telemetry(
    organization_id=ORG_ID, team="customer-success", agent=_AGENT, model="gpt-4o-mini",
    prompt="p", response="r", prompt_tokens=10, completion_tokens=5, total_tokens=15,
    latency_ms=50.0, cost_usd=0.00012, pricing_estimated=False, sensitive=False, blocked=False,
    timestamp=_now - timedelta(minutes=1), asset_key=_akey(ORG_ID, _AGENT),
    agent_id_raw=_AGENT, is_demo=False,
))
_db.commit()
_db.close()


class TestSyntheticEdges:
    def test_provider_model_gateway_edges_present(self):
        db = SessionLocal()
        try:
            rels = get_relationships(db, organization_id=ORG_ID)
        finally:
            db.close()
        kinds = {(r.relationship_type, r.target_type) for r in rels if r.source_agent_name == _AGENT}
        assert ("uses_model", "model") in kinds
        assert ("uses_provider", "provider") in kinds
        assert ("routes_via", "gateway") in kinds

    def test_synthetic_edges_not_persisted(self):
        """No AgentRelationship rows were written — derivation is read-time only."""
        db = SessionLocal()
        try:
            persisted = db.query(AgentRelationship).filter(
                AgentRelationship.organization_id == ORG_ID,
            ).count()
        finally:
            db.close()
        assert persisted == 0

    def test_marked_telemetry_derived(self):
        db = SessionLocal()
        try:
            rels = get_relationships(db, organization_id=ORG_ID)
        finally:
            db.close()
        synth = [r for r in rels if r.target_type in ("provider", "model", "gateway")]
        assert synth
        assert all(r.evidence_source == "telemetry_derived" and r.id is None for r in synth)

    def test_org_scoped(self):
        db = SessionLocal()
        try:
            other = get_relationships(db, organization_id=OTHER_ID)
        finally:
            db.close()
        assert other == []

    def test_filter_by_target_type(self):
        db = SessionLocal()
        try:
            only_models = get_relationships(db, organization_id=ORG_ID, target_type="model")
        finally:
            db.close()
        assert only_models
        assert all(r.target_type == "model" for r in only_models)

    def test_api_serializes_synthetic_edges(self):
        r = _client.get("/relationships", headers=AH)
        assert r.status_code == 200, r.text
        types = {row["target_type"] for row in r.json()}
        assert {"provider", "model", "gateway"} <= types

    def test_graph_includes_synthetic_nodes(self):
        r = _client.get("/relationships/graph", headers=AH)
        assert r.status_code == 200, r.text
        node_types = {n["type"] for n in r.json()["nodes"]}
        assert "provider" in node_types and "model" in node_types and "gateway" in node_types
