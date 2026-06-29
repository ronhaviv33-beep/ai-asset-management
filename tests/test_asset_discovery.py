"""
Tests for app/asset_discovery.py — asset taxonomy and discovery helpers.

_known_assets is module-level mutable state; each test clears it via
_clear_cache() so cases are independent regardless of execution order.
"""
import json
import os
import sys
import uuid
from pathlib import Path

# Must be set before any app import
_db_path = f"/tmp/test_asset_disc_{uuid.uuid4().hex[:8]}.db"
os.environ["DATABASE_URL"] = f"sqlite:///{_db_path}"
os.environ.setdefault("JWT_SECRET", "testsecret-asset-disc")

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.chdir(str(Path(__file__).resolve().parent.parent))

from app.database import engine, SessionLocal
from app.models import Base, Organization, AssetRegistry
import app.asset_discovery as _ad

Base.metadata.create_all(bind=engine)


def _fresh_db():
    return SessionLocal()


def _clear_cache():
    _ad._known_assets.clear()


def _make_org(suffix: str = "") -> int:
    db = _fresh_db()
    try:
        org = Organization(name=f"AdDiscOrg-{suffix or uuid.uuid4().hex[:6]}",
                           slug=f"ad-disc-{suffix or uuid.uuid4().hex[:6]}")
        db.add(org)
        db.commit()
        db.refresh(org)
        return org.id
    finally:
        db.close()


# ── _infer_asset_type ─────────────────────────────────────────────────────────

def test_infer_asset_type_workflow_via_ua():
    assert _ad._infer_asset_type("my-agent", "n8n/1.0") == "workflow"


def test_infer_asset_type_workflow_via_name():
    assert _ad._infer_asset_type("data-pipeline", "") == "workflow"


def test_infer_asset_type_workflow_orchestrator_name():
    assert _ad._infer_asset_type("ai-orchestrat-v2", "") == "workflow"


def test_infer_asset_type_copilot_via_ua():
    assert _ad._infer_asset_type("some-agent", "github-copilot/1.0") == "copilot"


def test_infer_asset_type_copilot_via_name():
    assert _ad._infer_asset_type("sales-copilot", "") == "copilot"


def test_infer_asset_type_service_suffix():
    assert _ad._infer_asset_type("translation-service", "") == "service"


def test_infer_asset_type_api_suffix():
    assert _ad._infer_asset_type("billing-api", "") == "service"


def test_infer_asset_type_application_chatbot():
    assert _ad._infer_asset_type("customer-chatbot", "") == "application"


def test_infer_asset_type_application_assistant():
    assert _ad._infer_asset_type("support-assistant", "") == "application"


def test_infer_asset_type_default():
    assert _ad._infer_asset_type("my-llm-runner", "python-requests/2.31") == "agent"


def test_infer_asset_type_empty_strings():
    assert _ad._infer_asset_type("", "") == "agent"


# ── _infer_capabilities ───────────────────────────────────────────────────────

def test_infer_capabilities_base():
    result = json.loads(_ad._infer_capabilities({}))
    assert result == ["inference"]


def test_infer_capabilities_mcp_tool():
    result = json.loads(_ad._infer_capabilities({"x-mcp-tool": "search"}))
    assert "tool_execution" in result
    assert "external_api" in result
    assert "inference" in result


def test_infer_capabilities_mcp_server():
    result = json.loads(_ad._infer_capabilities({"x-mcp-server": "github"}))
    assert "tool_execution" in result
    assert "external_api" in result


def test_infer_capabilities_workflow_header():
    result = json.loads(_ad._infer_capabilities({"x-agent-workflow": "true"}))
    assert "tool_execution" in result
    assert "inference" in result


def test_infer_capabilities_retrieval():
    result = json.loads(_ad._infer_capabilities({"x-search-backend": "vector"}))
    assert "retrieval" in result


def test_infer_capabilities_returns_sorted():
    # Output must be a sorted JSON array for deterministic storage
    result = json.loads(_ad._infer_capabilities({"x-mcp-tool": "call", "x-search-backend": "rag"}))
    assert result == sorted(result)


def test_infer_capabilities_case_insensitive_headers():
    # Headers are lowercased internally
    result = json.loads(_ad._infer_capabilities({"X-MCP-Tool": "call"}))
    assert "tool_execution" in result


# ── _discover_asset ───────────────────────────────────────────────────────────

def test_discover_asset_creates_row():
    _clear_cache()
    org_id = _make_org()
    key = f"key-{uuid.uuid4().hex[:8]}"
    db = _fresh_db()
    try:
        _ad._discover_asset(db, org_id, key, "test-agent")
        row = db.query(AssetRegistry).filter(
            AssetRegistry.organization_id == org_id,
            AssetRegistry.asset_key == key,
        ).first()
        assert row is not None
        assert row.status == "unassigned"
        assert row.agent_name == "test-agent"
        assert row.discovery_status == "verified"
    finally:
        db.close()


def test_discover_asset_idempotent():
    """Calling twice with the same key creates exactly one AssetRegistry row."""
    _clear_cache()
    org_id = _make_org()
    key = f"key-{uuid.uuid4().hex[:8]}"
    db = _fresh_db()
    try:
        _ad._discover_asset(db, org_id, key, "idempotent-agent")
        _ad._discover_asset(db, org_id, key, "idempotent-agent")
        count = db.query(AssetRegistry).filter(
            AssetRegistry.organization_id == org_id,
            AssetRegistry.asset_key == key,
        ).count()
        assert count == 1
    finally:
        db.close()


def test_discover_asset_cache_short_circuits():
    """Second call with cached (org_id, key) returns early without hitting the DB."""
    _clear_cache()
    org_id = _make_org()
    key = f"key-{uuid.uuid4().hex[:8]}"
    db = _fresh_db()
    try:
        _ad._discover_asset(db, org_id, key, "cache-agent")
        assert (org_id, key) in _ad._known_assets
        _ad._discover_asset(db, org_id, key, "cache-agent")  # must not raise
    finally:
        db.close()


def test_discover_asset_upgrades_gateway_to_sdk():
    """An asset first seen as gateway_runtime upgrades when sdk_runtime is detected later."""
    _clear_cache()
    org_id = _make_org()
    key = f"key-{uuid.uuid4().hex[:8]}"
    db = _fresh_db()
    try:
        # First call: no source_hint → gateway_runtime
        _ad._discover_asset(db, org_id, key, "sdk-agent", source_hint=None)
        row = db.query(AssetRegistry).filter(AssetRegistry.asset_key == key).first()
        assert row.discovery_source == "gateway_runtime"

        # Remove from cache so second call doesn't short-circuit
        _ad._known_assets.discard((org_id, key))

        # Second call: sdk_runtime → should upgrade discovery_source
        _ad._discover_asset(db, org_id, key, "sdk-agent", source_hint="sdk_runtime")
        db.refresh(row)
        assert row.discovery_source == "sdk_runtime"
        assert row.source == "sdk_runtime"
    finally:
        db.close()


def test_discover_asset_explicit_header_maps_to_gateway_telemetry():
    _clear_cache()
    org_id = _make_org()
    key = f"key-{uuid.uuid4().hex[:8]}"
    db = _fresh_db()
    try:
        _ad._discover_asset(db, org_id, key, "header-agent", source_hint="explicit_header")
        row = db.query(AssetRegistry).filter(AssetRegistry.asset_key == key).first()
        assert row.discovery_source == "gateway_telemetry"
    finally:
        db.close()


def test_discover_asset_sdk_runtime_source():
    _clear_cache()
    org_id = _make_org()
    key = f"key-{uuid.uuid4().hex[:8]}"
    db = _fresh_db()
    try:
        _ad._discover_asset(db, org_id, key, "sdk-agent", source_hint="sdk_runtime")
        row = db.query(AssetRegistry).filter(AssetRegistry.asset_key == key).first()
        assert row.discovery_source == "sdk_runtime"
        assert row.source == "sdk_runtime"
    finally:
        db.close()


def test_discover_asset_sets_asset_type_from_name():
    """Asset type is inferred from agent name and stored on the registry row."""
    _clear_cache()
    org_id = _make_org()
    key = f"key-{uuid.uuid4().hex[:8]}"
    db = _fresh_db()
    try:
        _ad._discover_asset(db, org_id, key, "billing-api")
        row = db.query(AssetRegistry).filter(AssetRegistry.asset_key == key).first()
        assert row.asset_type == "service"
    finally:
        db.close()


def test_discover_asset_sets_capabilities_from_headers():
    """MCP headers result in tool_execution capability stored on the row."""
    _clear_cache()
    org_id = _make_org()
    key = f"key-{uuid.uuid4().hex[:8]}"
    db = _fresh_db()
    try:
        _ad._discover_asset(db, org_id, key, "mcp-agent",
                            request_headers={"x-mcp-tool": "file_read"})
        row = db.query(AssetRegistry).filter(AssetRegistry.asset_key == key).first()
        caps = json.loads(row.capabilities)
        assert "tool_execution" in caps
    finally:
        db.close()
