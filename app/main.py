from fastapi import FastAPI, Depends, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from app.database import engine, get_db
from app.models import Base
from app.schemas import AskRequest, AskResponse, TelemetryRecord, TelemetrySummary
from app import telemetry as tel
from app.openai_client import complete

Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="AIFinOps Guard",
    description="AI Runtime Intelligence Platform — telemetry, cost, and governance gateway",
    version="0.2.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def root():
    return {"status": "AIFinOps Gateway Running", "version": "0.2.0"}


@app.post("/ask", response_model=AskResponse)
async def ask(req: AskRequest, db: Session = Depends(get_db)):
    try:
        result = await complete(
            prompt=req.prompt,
            model=req.model,
            system_prompt=req.system_prompt,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"OpenAI error: {exc}")

    record = tel.save(db=db, team=req.team, agent=req.agent, prompt=req.prompt, result=result)

    return AskResponse(
        response=result.content,
        model=result.model,
        prompt_tokens=result.prompt_tokens,
        completion_tokens=result.completion_tokens,
        total_tokens=result.total_tokens,
        latency_ms=result.latency_ms,
        cost_usd=record.cost_usd,
        telemetry_id=record.id,
    )


@app.get("/telemetry", response_model=list[TelemetryRecord])
def get_telemetry(
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=1000),
    db: Session = Depends(get_db),
):
    return tel.get_all(db, skip=skip, limit=limit)


@app.get("/telemetry/summary", response_model=TelemetrySummary)
def get_summary(db: Session = Depends(get_db)):
    return tel.get_summary(db)
