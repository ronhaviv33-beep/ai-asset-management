"""
Unit tests for the pure discovery-status derivation layer (app/discovery_status.py).

No DB, no app import — fast and isolated. Verifies:
  - all 7 stages derive correctly
  - precedence (managed-but-stale stays MANAGED)
  - the deriver is total (never raises on missing keys)
  - identity-evidence masking never leaks secrets, but surfaces safe labels
  - suggestions derive from existing hints
"""
from __future__ import annotations

import json
from datetime import datetime, timezone, timedelta

from app.discovery_status import (
    derive_discovery_status,
    build_identity_evidence,
    derive_suggestions,
)

_OLD = (datetime.now(timezone.utc) - timedelta(days=120)).isoformat()
_RECENT = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()


class TestStageDerivation:
    def test_archived_from_retired(self):
        stage, _, _ = derive_discovery_status({"lifecycle_status": "retired"})
        assert stage == "ARCHIVED"

    def test_managed_requires_owner_and_config(self):
        stage, _, _ = derive_discovery_status(
            {"lifecycle_status": "managed", "owner": "a@b.com", "environment": "production"}
        )
        assert stage == "MANAGED"

    def test_claimed_when_managed_without_full_config(self):
        stage, _, _ = derive_discovery_status({"lifecycle_status": "managed"})
        assert stage == "CLAIMED"

    def test_claimed_from_claimed_by(self):
        stage, _, _ = derive_discovery_status(
            {"lifecycle_status": "unassigned", "claimed_by": "a@b.com"}
        )
        assert stage == "CLAIMED"

    def test_needs_review_from_potential(self):
        stage, _, _ = derive_discovery_status(
            {"lifecycle_status": "needs_validation", "discovery_status": "potential"}
        )
        assert stage == "NEEDS_REVIEW"

    def test_needs_review_from_admin_review_flag(self):
        stage, _, _ = derive_discovery_status(
            {"lifecycle_status": "unassigned",
             "evidence": json.dumps({"needs_admin_review": True})}
        )
        assert stage == "NEEDS_REVIEW"

    def test_stale_from_old_last_seen(self):
        stage, _, _ = derive_discovery_status(
            {"lifecycle_status": "unassigned", "last_seen": _OLD}
        )
        assert stage == "STALE"

    def test_attributed_from_high_confidence(self):
        stage, _, _ = derive_discovery_status(
            {"lifecycle_status": "unassigned", "confidence_score": 90, "last_seen": _RECENT}
        )
        assert stage == "ATTRIBUTED"

    def test_attributed_from_team_hint(self):
        stage, _, _ = derive_discovery_status(
            {"lifecycle_status": "unassigned", "team": "Platform", "confidence_score": 10,
             "last_seen": _RECENT}
        )
        assert stage == "ATTRIBUTED"

    def test_discovered_default_weak(self):
        stage, _, _ = derive_discovery_status(
            {"lifecycle_status": "unassigned", "confidence_score": 10, "last_seen": _RECENT}
        )
        assert stage == "DISCOVERED"


class TestPrecedence:
    def test_managed_but_stale_stays_managed(self):
        """A quiet managed agent must NOT drop to STALE."""
        stage, _, _ = derive_discovery_status(
            {"lifecycle_status": "managed", "owner": "a@b.com",
             "environment": "production", "last_seen": _OLD}
        )
        assert stage == "MANAGED"

    def test_retired_beats_everything(self):
        stage, _, _ = derive_discovery_status(
            {"lifecycle_status": "retired", "owner": "a@b.com",
             "environment": "production", "claimed_by": "a@b.com"}
        )
        assert stage == "ARCHIVED"

    def test_ignored_event_suppresses_needs_review(self):
        evidence = json.dumps({
            "needs_admin_review": True,
            "validation_events": [{"action": "ignored", "by": "u@x.com", "at": _RECENT}],
        })
        stage, _, _ = derive_discovery_status(
            {"lifecycle_status": "unassigned", "evidence": evidence,
             "confidence_score": 10, "last_seen": _RECENT}
        )
        assert stage != "NEEDS_REVIEW"


class TestTotality:
    def test_empty_dict_does_not_raise(self):
        stage, label, reason = derive_discovery_status({})
        assert stage in {"DISCOVERED", "NEEDS_REVIEW", "ATTRIBUTED"}
        assert label and reason

    def test_potential_record_missing_runtime_fields(self):
        """Mirrors the registry-only potential path (no last_seen/signals)."""
        rec = {"lifecycle_status": "needs_validation", "discovery_status": "potential",
               "last_seen": None, "signals": {}}
        stage, _, _ = derive_discovery_status(rec)
        assert stage == "NEEDS_REVIEW"

    def test_garbage_evidence_does_not_raise(self):
        stage, _, _ = derive_discovery_status(
            {"lifecycle_status": "unassigned", "evidence": "{not valid json"}
        )
        assert stage in dict.fromkeys(
            ["DISCOVERED", "ATTRIBUTED", "STALE", "NEEDS_REVIEW", "CLAIMED", "MANAGED", "ARCHIVED"]
        )


class TestEvidenceMasking:
    def _evidence_with(self, *lines):
        return json.dumps({"evidence": list(lines), "resolution_method": "api_key_scope"})

    def test_never_leaks_bearer_token(self):
        ev = build_identity_evidence(
            {"evidence": self._evidence_with("Authorization: Bearer gk-supersecret1234567890")}
        )
        blob = json.dumps(ev)
        assert "gk-supersecret" not in blob
        assert "Bearer gk-" not in blob

    def test_never_leaks_openai_key(self):
        ev = build_identity_evidence(
            {"evidence": self._evidence_with("key=sk-proj-abcdef1234567890abcdef")}
        )
        assert "sk-proj-abcdef1234567890" not in json.dumps(ev)

    def test_never_leaks_anthropic_or_fernet(self):
        ev = build_identity_evidence(
            {"evidence": self._evidence_with(
                "sk-ant-api03-longsecretvalue12345",
                "gAAAAABmFernetTokenLooksLikeThis123456",
            )}
        )
        blob = json.dumps(ev)
        assert "sk-ant-api03-longsecretvalue" not in blob
        assert "gAAAAABmFernetTokenLooksLikeThis" not in blob

    def test_surfaces_safe_labels(self):
        ev = build_identity_evidence(
            {"evidence": self._evidence_with(
                "API key scope: caller_name='prod-support-key'",
                "User-Agent: 'langchain'",
            ),
             "models_used": ["gpt-4o"], "total_calls": 84392,
             "discovery_source": "gateway_telemetry"},
        )
        blob = json.dumps(ev)
        assert "prod-support-key" in blob
        assert "langchain" in blob
        assert ev["provider"] == "OpenAI"
        assert ev["request_count"] == 84392
        assert ev["source"] == "gateway_telemetry"


class TestSuggestions:
    def test_derives_from_hints(self):
        s = derive_suggestions(
            {"owner": "platform@x.com", "team": "Platform", "environment": "production",
             "capabilities": ["inference", "tool_execution"]}
        )
        assert s["suggested_owner"] == "platform@x.com"
        assert s["suggested_team"] == "Platform"
        assert s["suggested_environment"] == "production"
        assert "tool_execution" in s["suggested_tags"]
        assert s["suggestion_reason"]

    def test_empty_when_no_signal(self):
        s = derive_suggestions({"owner": "Unassigned", "team": "Unknown", "environment": "Unknown"})
        assert s["suggested_owner"] == ""
        assert s["suggested_team"] == ""
        assert s["suggested_environment"] == ""

    def test_falls_back_to_claimed_by(self):
        s = derive_suggestions({"owner": "Unassigned", "claimed_by": "person@x.com"})
        assert s["suggested_owner"] == "person@x.com"
