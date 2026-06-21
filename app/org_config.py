"""Per-org key-value config store, shared between main.py and route modules."""
import json
from datetime import datetime, timezone
from sqlalchemy.orm import Session

DEFAULTS: dict = {
    "environments": ["production", "staging", "development"],
    "demo_mode": True,
    # "full" (default): store complete prompt + response text in telemetry.
    # "findings_only": for PII-flagged records, replace prompt + response with a
    # redaction notice and keep only the findings metadata. Reduces PII at-rest exposure.
    "pii_redaction_mode": "full",
}


def get_org_config(db: Session, org_id: int, key: str):
    from app.models import OrgConfig
    row = db.query(OrgConfig).filter(
        OrgConfig.organization_id == org_id,
        OrgConfig.key == key,
    ).first()
    if row is None:
        return DEFAULTS.get(key)
    try:
        return json.loads(row.value)
    except Exception:
        return row.value


def set_org_config(db: Session, org_id: int, key: str, value) -> None:
    from app.models import OrgConfig
    row = db.query(OrgConfig).filter(
        OrgConfig.organization_id == org_id,
        OrgConfig.key == key,
    ).first()
    encoded = json.dumps(value)
    if row:
        row.value = encoded
        row.updated_at = datetime.now(timezone.utc)
    else:
        db.add(OrgConfig(organization_id=org_id, key=key, value=encoded))
    db.commit()
