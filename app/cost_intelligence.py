"""
Cost Intelligence — three-layer financial analysis for AI operations.

Layer 1: Runtime cost   — estimated from telemetry (token × price)
Layer 2: Provider billed — actual from invoices (ProviderBilling table)
Layer 3: Reconciliation — variance analysis between estimates and invoices
"""
from __future__ import annotations

import json
from collections import defaultdict
from datetime import datetime, timezone, timedelta
from typing import Optional

from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.models import Telemetry, ProviderBilling, CostReconciliation
from app.pricing import registry as pricing_registry

HEALTHY_THRESHOLD = 2.0   # < 2% variance → healthy
WARNING_THRESHOLD = 5.0   # 2–5% → warning; > 5% → investigate


# ── Helpers ───────────────────────────────────────────────────────────────────

def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def _parse_period(
    period_start: Optional[str],
    period_end: Optional[str],
    default_days: int = 30,
) -> tuple[datetime, datetime]:
    now = _now()
    end   = _aware(datetime.fromisoformat(period_end))   if period_end   else now
    start = _aware(datetime.fromisoformat(period_start)) if period_start else end - timedelta(days=default_days)
    return start, end


def _recon_status(variance_percent: float, runtime_cost: float = -1) -> str:
    # No telemetry found for the period — can't do a real reconciliation
    if runtime_cost == 0.0 and variance_percent <= -99.0:
        return "no_data"
    pct = abs(variance_percent)
    if pct < HEALTHY_THRESHOLD:
        return "healthy"
    if pct < WARNING_THRESHOLD:
        return "warning"
    return "investigate"


def _provider_model_filter(q, provider: str):
    """Add a model-name filter that approximates traffic for a given provider."""
    if provider == "openai":
        return q.filter(or_(
            Telemetry.model.like("gpt%"),
            Telemetry.model.like("o1%"),
            Telemetry.model.like("o3%"),
            Telemetry.model.like("o4%"),
        ))
    if provider in ("anthropic",):
        return q.filter(Telemetry.model.like("claude%"))
    if provider in ("google", "gemini"):
        return q.filter(Telemetry.model.like("gemini%"))
    return q


def _runtime_cost_query(
    db: Session,
    org_id: int,
    start: datetime,
    end: datetime,
    team_scope: Optional[str] = None,
    provider: Optional[str] = None,
    demo_mode: bool = False,
) -> float:
    """Sum telemetry.cost_usd for the given period."""
    q = db.query(func.sum(Telemetry.cost_usd)).filter(
        Telemetry.organization_id == org_id,
        Telemetry.timestamp >= start,
        Telemetry.timestamp <= end,
        Telemetry.is_demo == demo_mode,
    )
    if team_scope:
        q = q.filter(Telemetry.team == team_scope)
    if provider:
        q = _provider_model_filter(q, provider)
    return round(float(q.scalar() or 0.0), 6)


# ── Public API ────────────────────────────────────────────────────────────────

def get_cost_overview(
    db: Session,
    org_id: int,
    period_start: Optional[str] = None,
    period_end: Optional[str] = None,
    team_scope: Optional[str] = None,
    demo_mode: bool = False,
) -> dict:
    """
    Top-level cost summary for the dashboard overview cards.
    Returns runtime estimate, provider billing totals, and reconciliation status.
    """
    start, end = _parse_period(period_start, period_end)
    period_days = max((end - start).days, 1)

    # Layer 1 — runtime (telemetry)
    runtime_total = _runtime_cost_query(db, org_id, start, end, team_scope, demo_mode=demo_mode)

    # Trend vs previous same-length period
    prev_start = start - timedelta(days=period_days)
    prev_total = _runtime_cost_query(db, org_id, prev_start, start, team_scope, demo_mode=demo_mode)

    if prev_total > 0:
        trend_pct = round(((runtime_total - prev_total) / prev_total) * 100, 1)
    elif runtime_total > 0:
        trend_pct = 100.0
    else:
        trend_pct = 0.0
    trend_dir = "up" if trend_pct > 1 else "down" if trend_pct < -1 else "flat"

    # Layer 2 — all provider billing records for the org (not date-filtered so the KPI
    # always reflects what the user has imported, regardless of the current view window).
    # Per provider, keep the most recent record for the KPI summary.
    all_billing = db.query(ProviderBilling).filter(
        ProviderBilling.organization_id == org_id,
    ).order_by(ProviderBilling.created_at.desc()).all()

    provider_billing: dict[str, dict] = {}
    for b in all_billing:
        if b.provider not in provider_billing:   # keep most recent per provider
            provider_billing[b.provider] = {
                "total_usd":    b.actual_billed_cost_usd,
                "period_start": b.billing_period_start.isoformat() if b.billing_period_start else None,
                "period_end":   b.billing_period_end.isoformat()   if b.billing_period_end   else None,
                "billing_id":   b.id,
                "source":       b.source,
            }
    total_billed = sum(v["total_usd"] for v in provider_billing.values())

    # Layer 3 — most recent reconciliation record
    recon_row = db.query(CostReconciliation).filter(
        CostReconciliation.organization_id == org_id,
        CostReconciliation.period_start >= start - timedelta(days=5),
    ).order_by(CostReconciliation.created_at.desc()).first()

    if recon_row:
        reconciliation = {
            "status":               recon_row.status,
            "variance_absolute_usd": recon_row.variance_absolute_usd,
            "variance_percent":      recon_row.variance_percent,
            "runtime_estimate_usd":  recon_row.runtime_cost_estimate_usd,
            "provider_billed_usd":   recon_row.provider_billed_cost_usd,
            "provider":              recon_row.provider,
        }
    elif total_billed > 0:
        variance_abs = round(runtime_total - total_billed, 6)
        variance_pct = round((variance_abs / total_billed) * 100, 2)
        reconciliation = {
            "status":               _recon_status(variance_pct),
            "variance_absolute_usd": variance_abs,
            "variance_percent":      variance_pct,
            "runtime_estimate_usd":  runtime_total,
            "provider_billed_usd":   total_billed,
            "provider":              None,
        }
    else:
        reconciliation = {}

    return {
        "period": {"start": start.isoformat(), "end": end.isoformat()},
        "runtime_cost": {
            "total_usd":      runtime_total,
            "prev_period_usd": prev_total,
            "trend_percent":  trend_pct,
            "trend_direction": trend_dir,
        },
        "provider_billing": provider_billing,
        "total_billed_usd":  total_billed,
        "reconciliation":    reconciliation,
    }


def get_cost_breakdown(
    db: Session,
    org_id: int,
    breakdown_by: str = "agent",
    period_start: Optional[str] = None,
    period_end: Optional[str] = None,
    team_scope: Optional[str] = None,
    demo_mode: bool = False,
) -> list[dict]:
    """
    Cost breakdown ranked by cost desc.
    breakdown_by: agent | team | model | environment | provider
    """
    start, end = _parse_period(period_start, period_end)

    q = db.query(Telemetry).filter(
        Telemetry.organization_id == org_id,
        Telemetry.timestamp >= start,
        Telemetry.timestamp <= end,
        Telemetry.is_demo == demo_mode,
    )
    if team_scope:
        q = q.filter(Telemetry.team == team_scope)
    rows = q.all()

    buckets: dict[str, dict] = defaultdict(lambda: {"cost": 0.0, "calls": 0, "tokens": 0})
    total_cost = sum(r.cost_usd or 0.0 for r in rows)

    for r in rows:
        if breakdown_by == "agent":
            key = r.agent or "unknown"
        elif breakdown_by == "team":
            key = r.team or "Unknown"
        elif breakdown_by == "model":
            key = r.model or "unknown"
        elif breakdown_by == "environment":
            key = getattr(r, "environment_raw", None) or "Unknown"
        elif breakdown_by == "provider":
            key = pricing_registry.get_provider(r.model or "")
        else:
            key = r.agent or "unknown"

        buckets[key]["cost"]   += r.cost_usd or 0.0
        buckets[key]["calls"]  += 1
        buckets[key]["tokens"] += r.total_tokens or 0

    result = []
    for name, data in sorted(buckets.items(), key=lambda x: -x[1]["cost"]):
        pct = round((data["cost"] / total_cost) * 100, 1) if total_cost > 0 else 0.0
        result.append({
            "name":             name,
            "cost_usd":         round(data["cost"], 6),
            "calls":            data["calls"],
            "tokens":           data["tokens"],
            "percent_of_total": pct,
        })
    return result


def get_cost_trends(
    db: Session,
    org_id: int,
    days: int = 30,
    team_scope: Optional[str] = None,
    demo_mode: bool = False,
) -> list[dict]:
    """
    Daily cost totals for the last N days.
    Returns [{"date": "2026-06-01", "cost_usd": 45.23, "calls": 234}, ...]
    """
    end = _now()
    start = end - timedelta(days=days)

    q = db.query(Telemetry).filter(
        Telemetry.organization_id == org_id,
        Telemetry.timestamp >= start,
        Telemetry.is_demo == demo_mode,
    )
    if team_scope:
        q = q.filter(Telemetry.team == team_scope)
    rows = q.all()

    daily: dict[str, dict] = defaultdict(lambda: {"cost": 0.0, "calls": 0})
    for r in rows:
        ts = _aware(r.timestamp)
        day = ts.strftime("%Y-%m-%d")
        daily[day]["cost"]  += r.cost_usd or 0.0
        daily[day]["calls"] += 1

    result = []
    for i in range(days):
        day = (start + timedelta(days=i + 1)).strftime("%Y-%m-%d")
        data = daily.get(day, {"cost": 0.0, "calls": 0})
        result.append({
            "date":     day,
            "cost_usd": round(data["cost"], 6),
            "calls":    data["calls"],
        })
    return result


def get_agent_cost_detail(
    db: Session,
    org_id: int,
    agent_id: str,
    days: int = 90,
    demo_mode: bool = False,
) -> Optional[dict]:
    """
    Per-agent cost detail: monthly/lifetime totals, MoM trend, model breakdown,
    token split, and cost-risk signals.
    agent_id is the telemetry agent name.
    """
    now = _now()
    cutoff_30d  = now - timedelta(days=30)
    cutoff_60d  = now - timedelta(days=60)
    cutoff_all  = now - timedelta(days=max(days, 60))

    all_calls = db.query(Telemetry).filter(
        Telemetry.organization_id == org_id,
        Telemetry.agent == agent_id,
        Telemetry.timestamp >= cutoff_all,
        Telemetry.is_demo == demo_mode,
    ).all()

    if not all_calls:
        return None

    calls_30d      = [c for c in all_calls if _aware(c.timestamp) >= cutoff_30d]
    calls_prev_30d = [c for c in all_calls if cutoff_60d <= _aware(c.timestamp) < cutoff_30d]

    monthly_cost      = sum(c.cost_usd or 0.0 for c in calls_30d)
    prev_monthly_cost = sum(c.cost_usd or 0.0 for c in calls_prev_30d)
    lifetime_cost     = sum(c.cost_usd or 0.0 for c in all_calls)
    total_calls       = len(all_calls)
    avg_cost          = round(lifetime_cost / total_calls, 8) if total_calls > 0 else 0.0

    if prev_monthly_cost > 0:
        trend_pct = round(((monthly_cost - prev_monthly_cost) / prev_monthly_cost) * 100, 1)
    elif monthly_cost > 0:
        trend_pct = 100.0
    else:
        trend_pct = 0.0

    # Model breakdown (last 30 days)
    model_costs: dict[str, float] = defaultdict(float)
    model_calls: dict[str, int]   = defaultdict(int)
    for c in calls_30d:
        m = c.model or "unknown"
        model_costs[m] += c.cost_usd or 0.0
        model_calls[m] += 1

    models_used = []
    for model, cost in sorted(model_costs.items(), key=lambda x: -x[1]):
        pct = round((cost / monthly_cost) * 100, 1) if monthly_cost > 0 else 0.0
        models_used.append({
            "model":    model,
            "cost_usd": round(cost, 6),
            "calls":    model_calls[model],
            "percent":  pct,
            "provider": pricing_registry.get_provider(model),
        })

    # Token split (30d)
    input_tokens  = sum(c.prompt_tokens or 0 for c in calls_30d)
    output_tokens = sum(c.completion_tokens or 0 for c in calls_30d)

    # Cost-risk signals
    signals = []
    if trend_pct > 30:
        signals.append({"level": "high",   "message": f"Cost spike: +{trend_pct:.0f}% vs previous month"})
    elif trend_pct > 10:
        signals.append({"level": "medium", "message": f"Cost increase: +{trend_pct:.0f}% vs previous month"})

    HIGH_COST_MODELS = {"claude-opus-4-8", "claude-opus-4-5", "o1", "o3", "gpt-4-turbo"}
    for m in models_used:
        if m["model"] in HIGH_COST_MODELS and m["percent"] > 30:
            signals.append({"level": "medium", "message": f"High-cost model: {m['model']} ({m['percent']:.0f}% of spend)"})

    return {
        "agent_id":                 agent_id,
        "monthly_runtime_cost_usd": round(monthly_cost, 6),
        "prev_monthly_cost_usd":    round(prev_monthly_cost, 6),
        "lifetime_runtime_cost_usd": round(lifetime_cost, 6),
        "avg_cost_per_request_usd": avg_cost,
        "cost_trend_percent":       trend_pct,
        "cost_trend_direction":     "up" if trend_pct > 1 else "down" if trend_pct < -1 else "flat",
        "total_calls":              total_calls,
        "calls_30d":                len(calls_30d),
        "input_tokens_30d":         input_tokens,
        "output_tokens_30d":        output_tokens,
        "models_used":              models_used,
        "cost_signals":             signals,
    }


def import_provider_billing(
    db: Session,
    org_id: int,
    provider: str,
    data: dict,
    imported_by: Optional[str] = None,
) -> dict:
    """
    Import a provider billing record and automatically run reconciliation.
    Returns the created billing_id and reconciliation summary.
    """
    period_start = _aware(datetime.fromisoformat(str(data["billing_period_start"])))
    period_end   = _aware(datetime.fromisoformat(str(data["billing_period_end"])))

    billing = ProviderBilling(
        organization_id     = org_id,
        provider            = provider,
        billing_period_start = period_start,
        billing_period_end   = period_end,
        actual_billed_cost_usd = float(data.get("actual_billed_cost_usd", 0.0)),
        currency            = data.get("currency", "USD"),
        billing_breakdown   = json.dumps(data["billing_breakdown"]) if data.get("billing_breakdown") else None,
        source              = data.get("source", "manual_upload"),
        notes               = data.get("notes"),
        imported_by         = imported_by,
    )
    db.add(billing)
    db.flush()  # get billing.id without commit

    # Reconcile: compare runtime estimate vs billed
    runtime_cost = _runtime_cost_query(db, org_id, period_start, period_end, provider=provider)
    billed_cost  = billing.actual_billed_cost_usd
    variance_abs = round(runtime_cost - billed_cost, 6)
    variance_pct = round((variance_abs / billed_cost) * 100, 2) if billed_cost > 0 else 0.0
    status       = _recon_status(variance_pct, runtime_cost)

    recon = CostReconciliation(
        organization_id           = org_id,
        billing_id                = billing.id,
        period_start              = period_start,
        period_end                = period_end,
        provider                  = provider,
        runtime_cost_estimate_usd = runtime_cost,
        provider_billed_cost_usd  = billed_cost,
        variance_absolute_usd     = variance_abs,
        variance_percent          = variance_pct,
        status                    = status,
    )
    db.add(recon)
    db.commit()

    return {
        "status":     "imported",
        "billing_id": billing.id,
        "reconciliation": {
            "status":               status,
            "runtime_estimate_usd": runtime_cost,
            "provider_billed_usd":  billed_cost,
            "variance_absolute_usd": variance_abs,
            "variance_percent":     variance_pct,
        },
    }


def update_provider_billing(
    db: Session,
    org_id: int,
    period_id: int,
    data: dict,
) -> dict:
    """Update an existing billing record and re-run reconciliation."""
    billing = db.query(ProviderBilling).filter(
        ProviderBilling.id == period_id,
        ProviderBilling.organization_id == org_id,
    ).first()
    if not billing:
        raise ValueError(f"Billing period {period_id} not found")

    if "billing_period_start" in data:
        billing.billing_period_start = _aware(datetime.fromisoformat(str(data["billing_period_start"])))
    if "billing_period_end" in data:
        billing.billing_period_end = _aware(datetime.fromisoformat(str(data["billing_period_end"])))
    if "actual_billed_cost_usd" in data:
        billing.actual_billed_cost_usd = float(data["actual_billed_cost_usd"])
    if "currency" in data:
        billing.currency = data["currency"]
    if "source" in data:
        billing.source = data["source"]
    if "notes" in data:
        billing.notes = data["notes"]

    db.flush()

    # Re-run reconciliation
    runtime_cost = _runtime_cost_query(db, org_id, billing.billing_period_start, billing.billing_period_end, provider=billing.provider)
    billed_cost  = billing.actual_billed_cost_usd
    variance_abs = round(runtime_cost - billed_cost, 6)
    variance_pct = round((variance_abs / billed_cost) * 100, 2) if billed_cost > 0 else 0.0
    status       = _recon_status(variance_pct, runtime_cost)

    recon = db.query(CostReconciliation).filter(CostReconciliation.billing_id == period_id).first()
    if recon:
        recon.runtime_cost_estimate_usd = runtime_cost
        recon.provider_billed_cost_usd  = billed_cost
        recon.variance_absolute_usd     = variance_abs
        recon.variance_percent          = variance_pct
        recon.status                    = status
    else:
        db.add(CostReconciliation(
            organization_id=org_id, billing_id=period_id,
            period_start=billing.billing_period_start, period_end=billing.billing_period_end,
            provider=billing.provider,
            runtime_cost_estimate_usd=runtime_cost, provider_billed_cost_usd=billed_cost,
            variance_absolute_usd=variance_abs, variance_percent=variance_pct, status=status,
        ))

    db.commit()
    return {
        "status":     "updated",
        "billing_id": period_id,
        "reconciliation": {
            "status":               status,
            "runtime_estimate_usd": runtime_cost,
            "provider_billed_usd":  billed_cost,
            "variance_absolute_usd": variance_abs,
            "variance_percent":     variance_pct,
        },
    }


def get_billing_periods(db: Session, org_id: int) -> list[dict]:
    """List all billing records for the org, most-recent first."""
    records = db.query(ProviderBilling).filter(
        ProviderBilling.organization_id == org_id,
    ).order_by(ProviderBilling.billing_period_end.desc()).all()

    if not records:
        return []

    # Fetch all reconciliations in one query instead of N+1.
    billing_ids = [r.id for r in records]
    recons = db.query(CostReconciliation).filter(
        CostReconciliation.billing_id.in_(billing_ids),
    ).all()
    recon_map: dict[int, CostReconciliation] = {rc.billing_id: rc for rc in recons}

    result = []
    for r in records:
        recon = recon_map.get(r.id)
        result.append({
            "id":                    r.id,
            "provider":              r.provider,
            "billing_period_start":  r.billing_period_start.isoformat() if r.billing_period_start else None,
            "billing_period_end":    r.billing_period_end.isoformat()   if r.billing_period_end   else None,
            "actual_billed_cost_usd": r.actual_billed_cost_usd,
            "currency":              r.currency,
            "source":                r.source,
            "notes":                 r.notes,
            "imported_by":           r.imported_by,
            "created_at":            r.created_at.isoformat() if r.created_at else None,
            "reconciliation": {
                "status":               recon.status,
                "variance_percent":     recon.variance_percent,
                "variance_absolute_usd": recon.variance_absolute_usd,
            } if recon else None,
        })
    return result


def get_billing_period(db: Session, org_id: int, period_id: int) -> Optional[dict]:
    """Get a single billing record with full reconciliation detail."""
    r = db.query(ProviderBilling).filter(
        ProviderBilling.organization_id == org_id,
        ProviderBilling.id == period_id,
    ).first()
    if not r:
        return None

    recon = db.query(CostReconciliation).filter(
        CostReconciliation.billing_id == r.id,
    ).first()

    return {
        "id":                    r.id,
        "provider":              r.provider,
        "billing_period_start":  r.billing_period_start.isoformat() if r.billing_period_start else None,
        "billing_period_end":    r.billing_period_end.isoformat()   if r.billing_period_end   else None,
        "actual_billed_cost_usd": r.actual_billed_cost_usd,
        "currency":              r.currency,
        "billing_breakdown":     json.loads(r.billing_breakdown) if r.billing_breakdown else None,
        "source":                r.source,
        "notes":                 r.notes,
        "imported_by":           r.imported_by,
        "created_at":            r.created_at.isoformat() if r.created_at else None,
        "reconciliation": {
            "status":                    recon.status,
            "runtime_cost_estimate_usd": recon.runtime_cost_estimate_usd,
            "provider_billed_cost_usd":  recon.provider_billed_cost_usd,
            "variance_absolute_usd":     recon.variance_absolute_usd,
            "variance_percent":          recon.variance_percent,
            "created_at":                recon.created_at.isoformat() if recon.created_at else None,
        } if recon else None,
    }
