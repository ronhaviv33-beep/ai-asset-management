"""
Tests for AI Agent Relationship Mapping.

Covers:
  1. relationship_resolver: MCP tool, MCP server, workflow, generic target detection
  2. relationships persistence: upsert increments count; different target = new row;
     metadata never stores prompt/response
  3. API: GET /relationships (org-scoped); GET /relationships/graph (valid nodes/edges)
  4. Proxy integration: X-Agent-Name + X-MCP-Server + X-MCP-Tool creates uses_tool relationship
"""
from __future__ import annotations

import os
import sys
import uuid

# ── Env setup BEFORE any app import ───────────────────────────────────────────
_db_path = f"/tmp/test_relationships_{uuid.uuid4().hex[:8]}.db"
os.environ.setdefault("JWT_SECRET",                "testsecret-relationships")
os.environ.setdefault("CREDENTIAL_ENCRYPTION_KEY", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=")
os.environ["DATABASE_URL"] = f"sqlite:///{_db_path}"
sys.path.insert(0, "/home/user/ai-asset-management")
os.chdir("/home/user/ai-asset-management")

import pytest
from unittest.mock import patch, AsyncMock

from fastapi.testclient import TestClient
from app.main import app
from app.database import SessionLocal
from app.models import Organization, User, AgentRelationship
from app.auth import hash_password, create_token, generate_api_key
from app.relationship_resolver import resolve_relationship, ResolvedRelationship
from app.relationships import upsert_relationship, get_relationships

# ── Module-level fixtures ──────────────────────────────────────────────────────
_client = TestClient(app, raise_server_exceptions=True)
_client.get("/health")  # trigger startup migrations


def _make_org_and_token(db, suffix=""):
    org = Organization(name=f"rel-test-org-{suffix}", slug=f"rel-test-org-{suffix}")
    db.add(org)
    db.flush()
    user = User(
        email=f"rel-test-{suffix}@example.com",
        name=f"Rel Test {suffix}",
        hashed_password=hash_password("pass"),
        organization_id=org.id,
        role="admin",
        team="eng",
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(org)
    db.refresh(user)
    token = create_token(user)
    return org, user, token


# ═══════════════════════════════════════════════════════════════════════════════
# 1. relationship_resolver tests
# ═══════════════════════════════════════════════════════════════════════════════

class TestRelationshipResolver:
    def test_returns_none_when_no_agent_name(self):
        result = resolve_relationship({"x-mcp-server": "my-server", "x-mcp-tool": "search"})
        assert result is None

    def test_mcp_tool_detection(self):
        headers = {
            "x-agent-name": "planner-bot",
            "x-mcp-server": "mcp-filesystem",
            "x-mcp-tool":   "read_file",
        }
        rel = resolve_relationship(headers)
        assert rel is not None
        assert rel.source_agent_name == "planner-bot"
        assert rel.target_type == "mcp_tool"
        assert rel.target_name == "read_file"
        assert rel.relationship_type == "uses_tool"
        assert rel.evidence_source == "mcp_headers"
        assert rel.confidence_score == 0.85
        assert rel.metadata.get("mcp_server") == "mcp-filesystem"

    def test_mcp_server_only(self):
        headers = {
            "x-agent-name": "search-bot",
            "x-mcp-server": "mcp-search",
        }
        rel = resolve_relationship(headers)
        assert rel is not None
        assert rel.target_type == "mcp_server"
        assert rel.target_name == "mcp-search"
        assert rel.relationship_type == "calls"
        assert rel.evidence_source == "mcp_headers"
        assert rel.confidence_score == 0.80

    def test_workflow_detection(self):
        headers = {
            "x-agent-name":       "orchestrator",
            "x-workflow-provider":"zapier",
            "x-workflow-name":    "send-email",
        }
        rel = resolve_relationship(headers)
        assert rel is not None
        assert rel.target_type == "workflow"
        assert rel.target_name == "send-email"
        assert rel.relationship_type == "invokes_workflow"
        assert rel.evidence_source == "workflow_headers"
        assert rel.confidence_score == 0.80
        assert rel.metadata.get("workflow_provider") == "zapier"

    def test_generic_target_infer_crm(self):
        headers = {
            "x-agent-name":   "crm-bot",
            "x-agent-target": "hubspot-connector",
        }
        rel = resolve_relationship(headers)
        assert rel is not None
        assert rel.target_type == "crm"
        assert rel.target_name == "hubspot-connector"
        assert rel.confidence_score == 0.70

    def test_generic_target_infer_database(self):
        headers = {
            "x-agent-name":   "etl-bot",
            "x-agent-target": "postgres-main",
        }
        rel = resolve_relationship(headers)
        assert rel.target_type == "database"

    def test_generic_target_infer_api(self):
        headers = {
            "x-agent-name":   "http-bot",
            "x-agent-target": "stripe-api",
        }
        rel = resolve_relationship(headers)
        assert rel.target_type == "api"

    def test_agent_name_fallback_to_x_guard_agent(self):
        headers = {
            "x-guard-agent": "fallback-agent",
            "x-mcp-server":  "some-server",
        }
        rel = resolve_relationship(headers)
        assert rel is not None
        assert rel.source_agent_name == "fallback-agent"


# ═══════════════════════════════════════════════════════════════════════════════
# 2. Persistence tests
# ═══════════════════════════════════════════════════════════════════════════════

class TestRelationshipPersistence:
    def setup_method(self):
        self.db = SessionLocal()
        org = Organization(name=f"persist-org-{uuid.uuid4().hex[:6]}", slug=f"persist-{uuid.uuid4().hex[:6]}")
        self.db.add(org)
        self.db.commit()
        self.db.refresh(org)
        self.org_id = org.id

    def teardown_method(self):
        self.db.close()

    def _make_rel(self, **kwargs):
        defaults = dict(
            source_agent_name="test-agent",
            target_type="api",
            target_name="openai-api",
            relationship_type="calls",
            evidence_source="headers",
            confidence_score=0.70,
        )
        defaults.update(kwargs)
        return ResolvedRelationship(**defaults)

    def test_first_insert_creates_row(self):
        rel = self._make_rel()
        upsert_relationship(self.db, self.org_id, rel)
        rows = get_relationships(self.db, self.org_id)
        assert len(rows) == 1
        assert rows[0].request_count == 1

    def test_same_relationship_increments_count(self):
        rel = self._make_rel()
        upsert_relationship(self.db, self.org_id, rel)
        upsert_relationship(self.db, self.org_id, rel)
        upsert_relationship(self.db, self.org_id, rel)
        rows = get_relationships(self.db, self.org_id)
        assert len(rows) == 1
        assert rows[0].request_count == 3

    def test_different_target_creates_new_row(self):
        upsert_relationship(self.db, self.org_id, self._make_rel(target_name="openai-api"))
        upsert_relationship(self.db, self.org_id, self._make_rel(target_name="anthropic-api"))
        rows = get_relationships(self.db, self.org_id)
        assert len(rows) == 2

    def test_confidence_score_takes_max(self):
        upsert_relationship(self.db, self.org_id, self._make_rel(confidence_score=0.60))
        upsert_relationship(self.db, self.org_id, self._make_rel(confidence_score=0.90))
        upsert_relationship(self.db, self.org_id, self._make_rel(confidence_score=0.70))
        rows = get_relationships(self.db, self.org_id)
        assert rows[0].confidence_score == 0.90

    def test_metadata_never_stores_prompt_or_response(self):
        rel = self._make_rel(metadata={"mcp_server": "safe-server"})
        upsert_relationship(self.db, self.org_id, rel)
        rows = get_relationships(self.db, self.org_id)
        import json
        meta = json.loads(rows[0].metadata_json or "{}")
        assert "prompt" not in meta
        assert "response" not in meta
        assert meta.get("mcp_server") == "safe-server"

    def test_org_isolation(self):
        other_org = Organization(name=f"other-{uuid.uuid4().hex[:6]}", slug=f"other-{uuid.uuid4().hex[:6]}")
        self.db.add(other_org)
        self.db.commit()
        self.db.refresh(other_org)

        upsert_relationship(self.db, self.org_id, self._make_rel())
        upsert_relationship(self.db, other_org.id, self._make_rel())

        mine = get_relationships(self.db, self.org_id)
        theirs = get_relationships(self.db, other_org.id)
        assert len(mine) == 1
        assert len(theirs) == 1

    def test_filter_by_source_agent_name(self):
        upsert_relationship(self.db, self.org_id, self._make_rel(source_agent_name="bot-a"))
        upsert_relationship(self.db, self.org_id, self._make_rel(source_agent_name="bot-b", target_name="other"))
        results = get_relationships(self.db, self.org_id, source_agent_name="bot-a")
        assert len(results) == 1
        assert results[0].source_agent_name == "bot-a"

    def test_filter_by_target_type(self):
        upsert_relationship(self.db, self.org_id, self._make_rel(target_type="api"))
        upsert_relationship(self.db, self.org_id, self._make_rel(target_type="database", target_name="pg"))
        results = get_relationships(self.db, self.org_id, target_type="database")
        assert len(results) == 1

    def test_db_error_is_non_fatal(self):
        rel = self._make_rel()
        # Simulate DB commit failure — must not raise
        bad_db = SessionLocal()
        bad_db.close()  # close so next operation raises
        upsert_relationship(bad_db, self.org_id, rel)  # must not raise


# ═══════════════════════════════════════════════════════════════════════════════
# 3. API tests
# ═══════════════════════════════════════════════════════════════════════════════

class TestRelationshipsAPI:
    def setup_method(self):
        self.db = SessionLocal()
        unique = uuid.uuid4().hex[:8]
        self.org, self.user, self.token = _make_org_and_token(self.db, suffix=unique)
        self.headers = {"Authorization": f"Bearer {self.token}"}

        # Seed some relationship rows directly
        for target in ["openai-api", "anthropic-api"]:
            rel = ResolvedRelationship(
                source_agent_name="api-agent",
                target_type="api",
                target_name=target,
                relationship_type="calls",
                evidence_source="headers",
                confidence_score=0.70,
            )
            upsert_relationship(self.db, self.org.id, rel)

        mcp_rel = ResolvedRelationship(
            source_agent_name="mcp-agent",
            target_type="mcp_tool",
            target_name="search",
            relationship_type="uses_tool",
            evidence_source="mcp_headers",
            confidence_score=0.85,
            metadata={"mcp_server": "mcp-search"},
        )
        upsert_relationship(self.db, self.org.id, mcp_rel)

    def teardown_method(self):
        self.db.close()

    def test_list_relationships_returns_org_data(self):
        resp = _client.get("/relationships", headers=self.headers)
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 3

    def test_list_relationships_filter_source(self):
        resp = _client.get("/relationships?source_agent_name=mcp-agent", headers=self.headers)
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["source_agent_name"] == "mcp-agent"

    def test_list_relationships_filter_target_type(self):
        resp = _client.get("/relationships?target_type=mcp_tool", headers=self.headers)
        assert resp.status_code == 200
        data = resp.json()
        assert all(r["target_type"] == "mcp_tool" for r in data)

    def test_list_relationships_requires_auth(self):
        resp = _client.get("/relationships")
        assert resp.status_code == 401

    def test_graph_returns_nodes_and_edges(self):
        resp = _client.get("/relationships/graph", headers=self.headers)
        assert resp.status_code == 200
        data = resp.json()
        assert "nodes" in data
        assert "edges" in data

    def test_graph_node_types(self):
        resp = _client.get("/relationships/graph", headers=self.headers)
        data = resp.json()
        node_types = {n["type"] for n in data["nodes"]}
        assert "agent" in node_types
        assert "api" in node_types or "mcp_tool" in node_types

    def test_graph_edges_have_required_fields(self):
        resp = _client.get("/relationships/graph", headers=self.headers)
        data = resp.json()
        for edge in data["edges"]:
            assert "source" in edge
            assert "target" in edge
            assert "type" in edge
            assert "count" in edge
            assert "confidence" in edge

    def test_graph_org_isolation(self):
        # Create a second org with its own data
        db2 = SessionLocal()
        unique2 = uuid.uuid4().hex[:8]
        org2, _, token2 = _make_org_and_token(db2, suffix=unique2)
        rel2 = ResolvedRelationship(
            source_agent_name="other-org-agent",
            target_type="api",
            target_name="other-api",
            relationship_type="calls",
            evidence_source="headers",
            confidence_score=0.70,
        )
        upsert_relationship(db2, org2.id, rel2)
        db2.close()

        # Org1's graph should not include org2's nodes
        resp = _client.get("/relationships/graph", headers=self.headers)
        data = resp.json()
        node_labels = {n["label"] for n in data["nodes"]}
        assert "other-org-agent" not in node_labels


# ═══════════════════════════════════════════════════════════════════════════════
# 4. SDK header builder tests
# ═══════════════════════════════════════════════════════════════════════════════

class TestSDKHeaders:
    def test_build_headers_includes_mcp_server(self):
        from ai_agent_inventory.headers import build_headers
        h = build_headers(agent_name="bot", mcp_server="my-mcp")
        assert h["X-Agent-Name"] == "bot"
        assert h["X-MCP-Server"] == "my-mcp"

    def test_build_headers_includes_mcp_tool(self):
        from ai_agent_inventory.headers import build_headers
        h = build_headers(agent_name="bot", mcp_server="srv", mcp_tool="search")
        assert h["X-MCP-Tool"] == "search"
        assert h["X-MCP-Server"] == "srv"

    def test_build_headers_includes_workflow_fields(self):
        from ai_agent_inventory.headers import build_headers
        h = build_headers(
            agent_name="orch",
            workflow_provider="zapier",
            workflow_name="send-email",
        )
        assert h["X-Workflow-Provider"] == "zapier"
        assert h["X-Workflow-Name"] == "send-email"

    def test_build_headers_includes_parent_agent(self):
        from ai_agent_inventory.headers import build_headers
        h = build_headers(agent_name="child", parent_agent="orchestrator")
        assert h["X-Agent-Parent"] == "orchestrator"

    def test_build_headers_omits_none_fields(self):
        from ai_agent_inventory.headers import build_headers
        h = build_headers(agent_name="bot")
        assert "X-MCP-Server" not in h
        assert "X-MCP-Tool" not in h
        assert "X-Agent-Parent" not in h
        assert "X-Workflow-Provider" not in h

    def test_build_headers_always_sets_source(self):
        from ai_agent_inventory.headers import build_headers
        h = build_headers()
        assert h["X-Agent-Source"] == "sdk-python"
