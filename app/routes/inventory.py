from types import SimpleNamespace

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas import (
    TelemetryRecord, TelemetrySummary,
    SessionCreate, SessionOut, SessionMessageOut,
)
from app.auth import (
    get_current_user,
    resolve_team_scope, is_deny_sentinel, require_tenancy_hardened,
)
from app import telemetry as tel
from app import sessions as sess
from app.org_config import get_org_config as _get_org_config

router = APIRouter()


def _redact_sensitive_records(records, user):
    """
    For non-admin users, blank out the prompt/response text of any record
    flagged sensitive. Admins see everything; analysts/viewers see metadata
    only for records that contain PII or secrets.
    """
    if getattr(user, "role", None) == "admin":
        return records
    out = []
    for r in records:
        if getattr(r, "sensitive", False):
            data = {c.name: getattr(r, c.name) for c in r.__table__.columns}
            data["prompt"] = "[redacted — sensitive, admin only]"
            data["response"] = "[redacted — sensitive, admin only]"
            out.append(SimpleNamespace(**data))
        else:
            out.append(r)
    return out


def _assert_session_owner(s, current_user) -> None:
    """Intra-org ownership check. Non-admins can only access their own sessions."""
    is_admin = current_user.role == "admin" or getattr(current_user, "is_platform_admin", False)
    if is_admin:
        return
    owned_by_id   = s.user_id is not None and s.user_id == current_user.id
    owned_by_name = s.user_id is None and s.user_name == current_user.name
    if not (owned_by_id or owned_by_name):
        raise HTTPException(status_code=403, detail="Access denied")


# ── Telemetry ─────────────────────────────────────────────────────────────────

@router.get("/telemetry", response_model=list[TelemetryRecord], tags=["GET — Read / Monitor"])
def get_telemetry(
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=1000),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
    _: None = Depends(require_tenancy_hardened),
):
    ts = resolve_team_scope(current_user, db)
    if is_deny_sentinel(ts):
        return []
    _dm = bool(_get_org_config(db, current_user.organization_id, "demo_mode"))
    return _redact_sensitive_records(
        tel.get_all(db, organization_id=current_user.organization_id, skip=skip, limit=limit, team_scope=ts, demo_mode=_dm),
        current_user,
    )


@router.get("/telemetry/summary", response_model=TelemetrySummary, tags=["GET — Read / Monitor"])
def get_summary(db: Session = Depends(get_db), current_user=Depends(get_current_user), _: None = Depends(require_tenancy_hardened)):
    from app.schemas import TelemetrySummary as _TS
    ts = resolve_team_scope(current_user, db)
    if is_deny_sentinel(ts):
        return _TS(total_requests=0, total_tokens=0, total_cost_usd=0.0,
                   avg_latency_ms=0.0, models_used=[], teams=[])
    _dm = bool(_get_org_config(db, current_user.organization_id, "demo_mode"))
    return tel.get_summary(db, organization_id=current_user.organization_id, team_scope=ts, demo_mode=_dm)


# ── Audit log ─────────────────────────────────────────────────────────────────

@router.get("/audit", response_model=list[TelemetryRecord], tags=["GET — Read / Monitor"])
def get_audit(
    team: str | None = Query(default=None),
    agent: str | None = Query(default=None),
    sensitive_only: bool = Query(default=False),
    blocked_only: bool = Query(default=False),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=1000),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
    _: None = Depends(require_tenancy_hardened),
):
    ts = resolve_team_scope(current_user, db)
    if is_deny_sentinel(ts):
        return []
    _dm = bool(_get_org_config(db, current_user.organization_id, "demo_mode"))
    records = tel.get_audit(
        db, organization_id=current_user.organization_id,
        team=team, agent=agent,
        sensitive_only=sensitive_only, blocked_only=blocked_only,
        skip=skip, limit=limit, team_scope=ts, demo_mode=_dm,
    )
    return _redact_sensitive_records(records, current_user)


# ── Chat Sessions (CRUD) ──────────────────────────────────────────────────────

@router.post("/sessions", response_model=SessionOut, status_code=201, tags=["POST — Ask / Create"])
def create_session(req: SessionCreate, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    sess.expire_inactive(db)
    return sess.create_session(
        db,
        user_name=current_user.name,
        user_role=current_user.role,
        team=req.team,
        agent=req.agent,
        model=req.model,
        organization_id=current_user.organization_id,
        user_id=current_user.id,
    )


@router.get("/sessions", response_model=list[SessionOut], tags=["GET — Read / Monitor"])
def list_sessions(active_only: bool = Query(default=True), db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    sess.expire_inactive(db)
    return sess.list_sessions(db, active_only=active_only, organization_id=current_user.organization_id)


@router.get("/sessions/{session_uuid}", response_model=SessionOut, tags=["GET — Read / Monitor"])
def get_session_by_uuid(session_uuid: str, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    s = sess.get_session(db, session_uuid, organization_id=current_user.organization_id)
    if not s:
        raise HTTPException(status_code=404, detail="Session not found")
    _assert_session_owner(s, current_user)
    return s


@router.delete("/sessions/{session_uuid}", status_code=204, tags=["DELETE — Remove"])
def close_session(session_uuid: str, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    s = sess.get_session(db, session_uuid, organization_id=current_user.organization_id)
    if not s:
        raise HTTPException(status_code=404, detail="Session not found")
    _assert_session_owner(s, current_user)
    sess.close_session(db, session_uuid, organization_id=current_user.organization_id)


@router.get("/sessions/{session_uuid}/messages", response_model=list[SessionMessageOut], tags=["GET — Read / Monitor"])
def get_session_messages(session_uuid: str, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    s = sess.get_session(db, session_uuid, organization_id=current_user.organization_id)
    if not s:
        raise HTTPException(status_code=404, detail="Session not found")
    _assert_session_owner(s, current_user)
    return sess.get_messages(db, session_uuid)
