"""
Persistence service for AgentRelationship records.

upsert_relationship() is non-fatal — any DB error is logged as a warning
so relationship mapping never breaks customer proxy traffic.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.relationship_resolver import ResolvedRelationship

_log = logging.getLogger("ai_asset_mgmt.relationships")


def upsert_relationship(
    db: Session,
    organization_id: int,
    rel: ResolvedRelationship,
    source_agent_id: str | None = None,
) -> None:
    """
    Insert or update an AgentRelationship row.

    Upsert key: (organization_id, source_agent_name, target_type, target_name, relationship_type)
    On conflict:
      - last_seen_at → now
      - request_count += 1
      - confidence_score = max(existing, new)
      - metadata_json merged (new keys win, no prompt/response stored)
    """
    try:
        from app.models import AgentRelationship
        now = datetime.now(timezone.utc)

        existing = db.query(AgentRelationship).filter(
            AgentRelationship.organization_id   == organization_id,
            AgentRelationship.source_agent_name == rel.source_agent_name,
            AgentRelationship.target_type       == rel.target_type,
            AgentRelationship.target_name       == rel.target_name,
            AgentRelationship.relationship_type == rel.relationship_type,
        ).first()

        if existing:
            existing.last_seen_at    = now
            existing.request_count   += 1
            existing.confidence_score = max(existing.confidence_score, rel.confidence_score)
            if rel.metadata:
                try:
                    current_meta = json.loads(existing.metadata_json or "{}")
                except Exception:
                    current_meta = {}
                current_meta.update(rel.metadata)
                existing.metadata_json = json.dumps(current_meta)
        else:
            meta_str = json.dumps(rel.metadata) if rel.metadata else None
            db.add(AgentRelationship(
                organization_id   = organization_id,
                source_agent_id   = source_agent_id,
                source_agent_name = rel.source_agent_name,
                target_type       = rel.target_type,
                target_name       = rel.target_name,
                relationship_type = rel.relationship_type,
                evidence_source   = rel.evidence_source,
                confidence_score  = rel.confidence_score,
                first_seen_at     = now,
                last_seen_at      = now,
                request_count     = 1,
                metadata_json     = meta_str,
            ))

        db.commit()
    except Exception:
        db.rollback()
        _log.warning("Failed to upsert relationship for %s → %s",
                     rel.source_agent_name, rel.target_name, exc_info=True)


def get_relationships(
    db: Session,
    organization_id: int,
    source_agent_name: str | None = None,
    target_type: str | None = None,
    relationship_type: str | None = None,
) -> list:
    from app.models import AgentRelationship
    q = db.query(AgentRelationship).filter(
        AgentRelationship.organization_id == organization_id
    )
    if source_agent_name:
        q = q.filter(AgentRelationship.source_agent_name == source_agent_name)
    if target_type:
        q = q.filter(AgentRelationship.target_type == target_type)
    if relationship_type:
        q = q.filter(AgentRelationship.relationship_type == relationship_type)
    rows = q.order_by(AgentRelationship.last_seen_at.desc()).all()

    # Append read-time synthetic provider/model/gateway edges so the dependency
    # map is never empty after the first request. These are NOT persisted.
    synthetic = _synthetic_relationships(
        db, organization_id,
        rows=rows,
        source_agent_name=source_agent_name,
        target_type=target_type,
        relationship_type=relationship_type,
    )
    return list(rows) + synthetic


# Synthetic (non-persisted) relationship target/relationship types.
_SYNTH_REL_TYPES = ("uses_provider", "uses_model", "routes_via")


class _SyntheticRelationship:
    """Lightweight, non-persisted relationship that quacks like AgentRelationship
    for the serializer and graph builder in app/routes/relationships.py."""
    __slots__ = (
        "id", "source_agent_name", "source_agent_id", "target_type", "target_name",
        "target_identifier", "relationship_type", "evidence_source", "confidence_score",
        "request_count", "first_seen_at", "last_seen_at", "metadata_json",
    )

    def __init__(self, *, source_agent_name, target_type, target_name, relationship_type,
                 request_count, first_seen_at, last_seen_at):
        self.id = None
        self.source_agent_name = source_agent_name
        self.source_agent_id = None
        self.target_type = target_type
        self.target_name = target_name
        self.target_identifier = None
        self.relationship_type = relationship_type
        self.evidence_source = "telemetry_derived"
        self.confidence_score = 0.95
        self.request_count = request_count
        self.first_seen_at = first_seen_at
        self.last_seen_at = last_seen_at
        self.metadata_json = None


def _parse_dt(value):
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except Exception:
        return datetime.now(timezone.utc)


def _synthetic_relationships(db, organization_id, *, rows, source_agent_name,
                             target_type, relationship_type) -> list:
    """Derive agent→provider, agent→model, agent→gateway edges from telemetry.

    Read-time only; never persisted. Respects the same filters as the query and
    dedups against any real edges so persisted MCP/tool relationships win.
    """
    # If the caller filtered to a target/relationship type we don't synthesize, skip.
    if target_type and target_type not in ("provider", "model", "gateway"):
        return []
    if relationship_type and relationship_type not in _SYNTH_REL_TYPES:
        return []

    try:
        from app.assets import get_all_assets_derived
        from app.pricing import registry
        from app.org_config import get_org_config
    except Exception:
        return []

    try:
        demo_mode = bool(get_org_config(db, organization_id, "demo_mode"))
        assets = get_all_assets_derived(
            db, organization_id, days_lookback=90, demo_mode=demo_mode,
        )
    except Exception:
        return []

    existing = {
        (r.source_agent_name, r.target_type, r.target_name, r.relationship_type)
        for r in rows
    }
    out: list = []
    seen: set = set()

    def _add(agent, ttype, tname, rtype, count, first, last):
        if source_agent_name and agent != source_agent_name:
            return
        if target_type and ttype != target_type:
            return
        if relationship_type and rtype != relationship_type:
            return
        key = (agent, ttype, tname, rtype)
        if key in existing or key in seen or not tname:
            return
        seen.add(key)
        out.append(_SyntheticRelationship(
            source_agent_name=agent, target_type=ttype, target_name=tname,
            relationship_type=rtype, request_count=count,
            first_seen_at=_parse_dt(first), last_seen_at=_parse_dt(last),
        ))

    for asset in assets:
        agent = asset.get("agent_name")
        if not agent:
            continue
        count = asset.get("total_calls") or 1
        first = asset.get("first_seen")
        last = asset.get("last_seen")
        # agent → gateway (always, one per agent)
        _add(agent, "gateway", "Gateway", "routes_via", count, first, last)
        providers = set()
        for model in (asset.get("models_used") or []):
            _add(agent, "model", model, "uses_model", count, first, last)
            providers.add(registry.get_provider(model))
        for provider in providers:
            label = provider.capitalize() if provider and provider != "unknown" else "Unknown"
            _add(agent, "provider", label, "uses_provider", count, first, last)

    return out
