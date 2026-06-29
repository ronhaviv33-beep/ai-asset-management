"""
Tests for app/startup.py — startup lifecycle functions.

Each function is idempotent and safe to call on every boot. Tests verify:
  - check_secrets: correct warning/no-warning for each key state
  - backfill_asset_keys: populates asset_key on telemetry rows; idempotent
  - backfill_discovery_source: corrects discovery_source mismatches; idempotent
  - seed_roles: seeds roles per org without duplicating on repeat calls
"""
import hashlib
import os
import sys
import uuid
from pathlib import Path

# Env vars must be set before any app import
_db_path = f"/tmp/test_startup_fn_{uuid.uuid4().hex[:8]}.db"
os.environ["DATABASE_URL"] = f"sqlite:///{_db_path}"
os.environ.setdefault("JWT_SECRET", "testsecret-startup-fn")
os.environ.pop("FAIL_FAST_ON_MISSING_SECRETS", None)   # prevent sys.exit in check_secrets
_orig_cek = os.environ.pop("CREDENTIAL_ENCRYPTION_KEY", None)  # start clean

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.chdir(str(Path(__file__).resolve().parent.parent))

from cryptography.fernet import Fernet
from app.database import engine, SessionLocal
from app.models import Base, Organization, Telemetry, AssetRegistry, Role as RoleModel
import app.startup as _startup

Base.metadata.create_all(bind=engine)


# ── helpers ───────────────────────────────────────────────────────────────────

def _make_org(suffix: str = "") -> int:
    db = SessionLocal()
    try:
        slug = f"startup-{suffix or uuid.uuid4().hex[:8]}"
        org = Organization(name=f"StartupOrg-{slug}", slug=slug)
        db.add(org)
        db.commit()
        db.refresh(org)
        return org.id
    finally:
        db.close()


def _fresh():
    return SessionLocal()


# ── check_secrets ─────────────────────────────────────────────────────────────

def test_check_secrets_missing_key_warns():
    os.environ.pop("CREDENTIAL_ENCRYPTION_KEY", None)
    warnings = _startup.check_secrets()
    assert len(warnings) >= 1
    assert any("CREDENTIAL_ENCRYPTION_KEY" in w for w in warnings)
    assert any("Organization AI Providers" in w for w in warnings)


def test_check_secrets_invalid_key_warns():
    os.environ["CREDENTIAL_ENCRYPTION_KEY"] = "not-a-valid-fernet-key"
    try:
        warnings = _startup.check_secrets()
        assert len(warnings) >= 1
        combined = " ".join(warnings).lower()
        assert "not a valid fernet key" in combined or "invalid" in combined
    finally:
        os.environ.pop("CREDENTIAL_ENCRYPTION_KEY", None)


def test_check_secrets_valid_key_no_warnings():
    os.environ["CREDENTIAL_ENCRYPTION_KEY"] = Fernet.generate_key().decode()
    try:
        warnings = _startup.check_secrets()
        assert warnings == []
    finally:
        os.environ.pop("CREDENTIAL_ENCRYPTION_KEY", None)


# ── backfill_asset_keys ───────────────────────────────────────────────────────

def test_backfill_asset_keys_populates_telemetry_rows():
    org_id = _make_org()
    agent = f"backfill-agent-{uuid.uuid4().hex[:6]}"
    expected_key = hashlib.sha256(f"{org_id}:{agent}".encode()).hexdigest()

    db = _fresh()
    try:
        db.add(Telemetry(
            organization_id=org_id, team="eng", agent=agent,
            model="gpt-4o", prompt="hello", response="hi",
        ))
        db.commit()
    finally:
        db.close()

    _startup.backfill_asset_keys()

    db = _fresh()
    try:
        row = db.query(Telemetry).filter(
            Telemetry.organization_id == org_id,
            Telemetry.agent == agent,
        ).first()
        assert row.asset_key == expected_key
        assert row.agent_id_raw == agent

        reg = db.query(AssetRegistry).filter(
            AssetRegistry.organization_id == org_id,
            AssetRegistry.asset_key == expected_key,
        ).first()
        assert reg is not None
        assert reg.status == "unassigned"
        assert reg.source == "discovered"
    finally:
        db.close()


def test_backfill_asset_keys_idempotent():
    """Calling twice with the same unbackfilled rows creates exactly one AssetRegistry row."""
    org_id = _make_org()
    agent = f"idem-agent-{uuid.uuid4().hex[:6]}"
    expected_key = hashlib.sha256(f"{org_id}:{agent}".encode()).hexdigest()

    db = _fresh()
    try:
        db.add(Telemetry(
            organization_id=org_id, team="eng", agent=agent,
            model="gpt-4o", prompt="hello", response="hi",
        ))
        db.commit()
    finally:
        db.close()

    _startup.backfill_asset_keys()
    _startup.backfill_asset_keys()  # second call — telemetry rows now have asset_key set → no-op

    db = _fresh()
    try:
        count = db.query(AssetRegistry).filter(
            AssetRegistry.organization_id == org_id,
            AssetRegistry.asset_key == expected_key,
        ).count()
        assert count == 1
    finally:
        db.close()


# ── backfill_discovery_source ─────────────────────────────────────────────────

def test_backfill_discovery_source_corrects_sdk_runtime():
    """source='sdk_runtime' + discovery_source='gateway_runtime' → corrected to 'sdk_runtime'."""
    org_id = _make_org()
    key = f"sdk-key-{uuid.uuid4().hex[:8]}"

    db = _fresh()
    try:
        db.add(AssetRegistry(
            organization_id=org_id, asset_key=key,
            agent_id_raw="sdk-agent", agent_name="sdk-agent",
            source="sdk_runtime", discovery_source="gateway_runtime",
        ))
        db.commit()
    finally:
        db.close()

    _startup.backfill_discovery_source()

    db = _fresh()
    try:
        row = db.query(AssetRegistry).filter(AssetRegistry.asset_key == key).first()
        assert row.discovery_source == "sdk_runtime"
    finally:
        db.close()


def test_backfill_discovery_source_corrects_gateway_telemetry():
    """source='explicit_header' + discovery_source='gateway_runtime' → 'gateway_telemetry'."""
    org_id = _make_org()
    key = f"hdr-key-{uuid.uuid4().hex[:8]}"

    db = _fresh()
    try:
        db.add(AssetRegistry(
            organization_id=org_id, asset_key=key,
            agent_id_raw="header-agent", agent_name="header-agent",
            source="explicit_header", discovery_source="gateway_runtime",
        ))
        db.commit()
    finally:
        db.close()

    _startup.backfill_discovery_source()

    db = _fresh()
    try:
        row = db.query(AssetRegistry).filter(AssetRegistry.asset_key == key).first()
        assert row.discovery_source == "gateway_telemetry"
    finally:
        db.close()


def test_backfill_discovery_source_idempotent():
    """Rows already correctly classified are not changed on second call."""
    org_id = _make_org()
    key = f"idem-ds-{uuid.uuid4().hex[:8]}"

    db = _fresh()
    try:
        db.add(AssetRegistry(
            organization_id=org_id, asset_key=key,
            agent_id_raw="sdk-agent2", agent_name="sdk-agent2",
            source="sdk_runtime", discovery_source="gateway_runtime",
        ))
        db.commit()
    finally:
        db.close()

    _startup.backfill_discovery_source()
    _startup.backfill_discovery_source()  # no-op: row already has discovery_source='sdk_runtime'

    db = _fresh()
    try:
        row = db.query(AssetRegistry).filter(AssetRegistry.asset_key == key).first()
        assert row.discovery_source == "sdk_runtime"
    finally:
        db.close()


# ── seed_roles ────────────────────────────────────────────────────────────────

def test_seed_roles_creates_roles_for_org():
    org_id = _make_org()

    _startup.seed_roles()

    db = _fresh()
    try:
        count = db.query(RoleModel).filter(RoleModel.organization_id == org_id).count()
        assert count > 0
    finally:
        db.close()


def test_seed_roles_idempotent():
    """Calling seed_roles twice must not duplicate role rows for any org."""
    org_id = _make_org()

    _startup.seed_roles()
    db = _fresh()
    try:
        count_first = db.query(RoleModel).filter(RoleModel.organization_id == org_id).count()
    finally:
        db.close()

    _startup.seed_roles()
    db = _fresh()
    try:
        count_second = db.query(RoleModel).filter(RoleModel.organization_id == org_id).count()
    finally:
        db.close()

    assert count_first == count_second
    assert count_first > 0
