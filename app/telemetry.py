from sqlalchemy.orm import Session
from sqlalchemy import func
from app.models import Telemetry, calculate_cost
from app.openai_client import CompletionResult
from app.schemas import TelemetrySummary


def save(
    db: Session,
    team: str,
    agent: str,
    prompt: str,
    result: CompletionResult,
) -> Telemetry:
    record = Telemetry(
        team=team,
        agent=agent,
        model=result.model,
        prompt=prompt,
        response=result.content,
        prompt_tokens=result.prompt_tokens,
        completion_tokens=result.completion_tokens,
        total_tokens=result.total_tokens,
        latency_ms=result.latency_ms,
        cost_usd=calculate_cost(result.model, result.prompt_tokens, result.completion_tokens),
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


def get_all(db: Session, skip: int = 0, limit: int = 100) -> list[Telemetry]:
    return db.query(Telemetry).order_by(Telemetry.timestamp.desc()).offset(skip).limit(limit).all()


def get_summary(db: Session) -> TelemetrySummary:
    rows = db.query(Telemetry).all()
    if not rows:
        return TelemetrySummary(
            total_requests=0,
            total_tokens=0,
            total_cost_usd=0.0,
            avg_latency_ms=0.0,
            models_used=[],
            teams=[],
        )
    return TelemetrySummary(
        total_requests=len(rows),
        total_tokens=sum(r.total_tokens for r in rows),
        total_cost_usd=round(sum(r.cost_usd for r in rows), 8),
        avg_latency_ms=round(sum(r.latency_ms for r in rows) / len(rows), 2),
        models_used=sorted({r.model for r in rows}),
        teams=sorted({r.team for r in rows}),
    )
