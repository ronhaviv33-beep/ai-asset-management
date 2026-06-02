import json
from datetime import datetime
from sqlalchemy.orm import Session
from app.models import ChatSession, ChatSessionMessage

SESSION_TIMEOUT_MINUTES = 30


def create_session(db: Session, *, user_name: str, user_role: str,
                   team: str, agent: str, model: str) -> ChatSession:
    s = ChatSession(
        user_name=user_name, user_role=user_role,
        team=team, agent=agent, model=model,
    )
    db.add(s)
    db.commit()
    db.refresh(s)
    return s


def get_session(db: Session, session_uuid: str) -> ChatSession | None:
    return db.query(ChatSession).filter(ChatSession.session_uuid == session_uuid).first()


def list_sessions(db: Session, *, active_only: bool = True) -> list[ChatSession]:
    q = db.query(ChatSession)
    if active_only:
        q = q.filter(ChatSession.is_active == True)  # noqa: E712
    return q.order_by(ChatSession.last_activity_at.desc()).all()


def close_session(db: Session, session_uuid: str) -> bool:
    s = get_session(db, session_uuid)
    if not s:
        return False
    s.is_active = False
    s.closed_at = datetime.utcnow()
    db.commit()
    return True


def expire_inactive(db: Session) -> int:
    """Mark sessions inactive if idle > SESSION_TIMEOUT_MINUTES. Returns count expired."""
    from datetime import timedelta
    # Use utcnow() (timezone-naive) because SQLite strips timezone info on read,
    # making timezone-aware comparisons silently fail.
    cutoff = datetime.utcnow() - timedelta(minutes=SESSION_TIMEOUT_MINUTES)
    rows = (
        db.query(ChatSession)
        .filter(ChatSession.is_active == True, ChatSession.last_activity_at < cutoff)  # noqa: E712
        .all()
    )
    now = datetime.utcnow()
    for s in rows:
        s.is_active = False
        s.closed_at = now
    db.commit()
    return len(rows)


def add_message(db: Session, *, session_uuid: str, role: str, content: str,
                prompt_tokens: int = 0, completion_tokens: int = 0,
                cost_usd: float = 0.0, latency_ms: float = 0.0,
                security_findings: list | None = None,
                budget_warnings: list | None = None) -> ChatSessionMessage:
    msg = ChatSessionMessage(
        session_uuid=session_uuid,
        role=role,
        content=content,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        cost_usd=cost_usd,
        latency_ms=latency_ms,
        security_findings=json.dumps(security_findings or []),
        budget_warnings=json.dumps(budget_warnings or []),
    )
    db.add(msg)

    s = get_session(db, session_uuid)
    if s:
        s.last_activity_at = datetime.utcnow()
        s.message_count += 1
        s.total_cost_usd += cost_usd
        s.total_tokens += prompt_tokens + completion_tokens

    db.commit()
    db.refresh(msg)
    return msg


def get_messages(db: Session, session_uuid: str) -> list[ChatSessionMessage]:
    return (
        db.query(ChatSessionMessage)
        .filter(ChatSessionMessage.session_uuid == session_uuid)
        .order_by(ChatSessionMessage.id)
        .all()
    )
