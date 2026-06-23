import json
import logging
import os
from typing import List

from fastapi import APIRouter, Body, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import ProviderCredential, encrypt_credential
from app.schemas import GuardModeOut, GuardModeUpdate
from app.auth import get_current_user, require_admin, require_page_access
from app.org_config import get_org_config as _get_org_config, set_org_config as _set_org_config, PLATFORM_MODE as _PLATFORM_MODE
from app.client import invalidate_org_client
from app import telemetry as tel

router = APIRouter()

# ── Provider credentials (BYOK — per-org encrypted keys) ─────────────────────

@router.get("/provider-credentials", tags=["Auth — Users"])
def list_provider_credentials(
    db: Session = Depends(get_db),
    actor=Depends(require_page_access("settings")),
):
    """List provider credentials for the caller's org. Returns last4 only — never the key."""
    creds = db.query(ProviderCredential).filter(
        ProviderCredential.organization_id == actor.organization_id
    ).all()
    return [
        {
            "id":       c.id,
            "provider": c.provider,
            "last4":    c.last4,
            "base_url": c.base_url,
            "is_active": c.is_active,
            "updated_at": c.updated_at.isoformat(),
        }
        for c in creds
    ]


@router.post("/provider-credentials", status_code=201, tags=["Auth — Users"])
async def upsert_provider_credential(
    body: dict = Body(...),
    db: Session = Depends(get_db),
    actor=Depends(require_page_access("settings")),
):
    """
    Add or update a provider API key for the caller's org.
    The plaintext key is encrypted immediately and never stored.
    Validates the key with a cheap test call before saving.
    """
    from app.client import _validate_local_url
    from openai import AsyncOpenAI as _AsyncOpenAI

    provider = body.get("provider", "").lower()
    raw_key  = body.get("key", "").strip()
    base_url = body.get("base_url")

    if provider not in ("openai", "anthropic", "google", "local"):
        raise HTTPException(status_code=400, detail="provider must be openai|anthropic|google|local")
    if not raw_key:
        raise HTTPException(status_code=400, detail="key is required")

    async def _validate():
        timeout = 10.0
        if provider == "openai":
            c = _AsyncOpenAI(api_key=raw_key, timeout=timeout)
        elif provider == "anthropic":
            c = _AsyncOpenAI(api_key=raw_key, base_url="https://api.anthropic.com/v1", timeout=timeout)
        elif provider == "google":
            c = _AsyncOpenAI(api_key=raw_key, base_url="https://generativelanguage.googleapis.com/v1beta/openai", timeout=timeout)
        else:  # local
            burl = _validate_local_url(base_url or "http://localhost:11434/v1")
            c = _AsyncOpenAI(api_key="local", base_url=burl, timeout=timeout)
        test_model = {"openai": "gpt-4o-mini", "anthropic": "claude-haiku-4-5", "google": "gemini-2.0-flash", "local": "llama-3.1-8b-local"}[provider]
        await c.chat.completions.create(
            model=test_model,
            messages=[{"role": "user", "content": "hi"}],
            max_tokens=1,
        )

    try:
        await _validate()
    except Exception as exc:
        msg = str(exc).lower()
        if "incorrect api key" in msg or "invalid api key" in msg or "unauthorized" in msg or "401" in msg:
            reason = "key was rejected as invalid or inactive"
        elif "rate limit" in msg or "429" in msg:
            reason = "rate limit hit during validation — wait a moment and try again"
        elif "quota" in msg or "402" in msg or "insufficient" in msg:
            reason = "account quota exceeded or billing issue on this key"
        elif "timeout" in msg or "connect" in msg:
            reason = "could not reach the provider — check network or base_url"
        else:
            reason = "provider returned an error — check the key is correct and active"
        raise HTTPException(status_code=422, detail=f"Key validation failed: {reason}")

    try:
        enc = encrypt_credential(raw_key)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    last4 = raw_key[-4:] if len(raw_key) >= 4 else raw_key

    existing = db.query(ProviderCredential).filter(
        ProviderCredential.organization_id == actor.organization_id,
        ProviderCredential.provider == provider,
    ).first()

    if existing:
        existing.encrypted_key = enc
        existing.last4         = last4
        existing.base_url      = base_url
        existing.is_active     = True
        invalidate_org_client(actor.organization_id, provider)
        logging.getLogger("ai_asset_mgmt").info(
            "Provider credential updated: org=%s provider=%s by=%s", actor.organization_id, provider, actor.email
        )
    else:
        db.add(ProviderCredential(
            organization_id=actor.organization_id,
            provider=provider,
            encrypted_key=enc,
            last4=last4,
            base_url=base_url,
        ))
        logging.getLogger("ai_asset_mgmt").info(
            "Provider credential created: org=%s provider=%s by=%s", actor.organization_id, provider, actor.email
        )

    db.commit()
    return {"provider": provider, "last4": last4, "status": "saved"}


@router.delete("/provider-credentials/{provider}", status_code=204, tags=["Auth — Users"])
def delete_provider_credential(
    provider: str,
    db: Session = Depends(get_db),
    actor=Depends(require_page_access("settings")),
):
    cred = db.query(ProviderCredential).filter(
        ProviderCredential.organization_id == actor.organization_id,
        ProviderCredential.provider == provider,
    ).first()
    if not cred:
        raise HTTPException(status_code=404, detail="No credential found for this provider")
    db.delete(cred)
    db.commit()
    invalidate_org_client(actor.organization_id, provider)


# ── Guard modes (per-team governance) ─────────────────────────────────────────

@router.get("/guard-modes", response_model=list[GuardModeOut], tags=["GET — Read / Monitor"])
def list_guard_modes(db: Session = Depends(get_db), actor=Depends(require_page_access("settings"))):
    """
    One row per team that appears in this org's telemetry, showing its effective mode,
    whether it's an explicit override, and how many requests would have been
    blocked in the last 30 days (shadow-block preview).
    """
    from app.models import GuardMode, Telemetry, Team as TeamModel, ApiKey as ApiKeyModel

    try:
        overrides = {g.team: g for g in db.query(GuardMode).filter(
            GuardMode.organization_id == actor.organization_id
        ).all()}
    except Exception:
        try:
            overrides = {g.team: g for g in db.query(GuardMode).all()}
        except Exception:
            overrides = {}
    _dm = bool(_get_org_config(db, actor.organization_id, "demo_mode"))
    shadow = tel.would_block_counts(db, days=30, organization_id=actor.organization_id, demo_mode=_dm)
    teams = set(shadow.keys()) | set(overrides.keys())
    try:
        teams |= {r[0] for r in db.query(Telemetry.team).filter(
            Telemetry.organization_id == actor.organization_id
        ).distinct().all()}
    except Exception:
        pass
    try:
        teams |= {r[0] for r in db.query(TeamModel.name).filter(
            TeamModel.organization_id == actor.organization_id
        ).all()}
    except Exception:
        pass
    try:
        teams |= {r[0] for r in db.query(ApiKeyModel.team).filter(
            ApiKeyModel.organization_id == actor.organization_id,
            ApiKeyModel.team.isnot(None), ApiKeyModel.team != "", ApiKeyModel.team != "unknown",
            ApiKeyModel.is_active == True,  # noqa: E712
        ).distinct().all()}
    except Exception:
        try:
            teams |= {r[0] for r in db.query(ApiKeyModel.team).filter(
                ApiKeyModel.team.isnot(None), ApiKeyModel.team != "", ApiKeyModel.team != "unknown",
                ApiKeyModel.is_active == True,  # noqa: E712
            ).distinct().all()}
        except Exception:
            pass
    out = []
    for team in sorted(t for t in teams if t):
        ov = overrides.get(team)
        out.append(GuardModeOut(
            team=team,
            mode=ov.mode if ov else _PLATFORM_MODE,
            is_override=ov is not None,
            would_block_30d=shadow.get(team, 0),
            updated_at=ov.updated_at if ov else None,
        ))
    return out


@router.put("/guard-modes/{team}", response_model=GuardModeOut, tags=["POST — Ask / Create"])
def set_guard_mode(team: str, req: GuardModeUpdate, db: Session = Depends(get_db), actor=Depends(require_page_access("settings"))):
    """
    Set a team's guard mode. mode="default" removes the override so the team
    falls back to the platform default. Every change is written to the audit log.
    """
    from app.models import GuardMode
    org_id = actor.organization_id
    old = db.query(GuardMode).filter(
        GuardMode.organization_id == org_id, GuardMode.team == team
    ).first()
    old_mode = old.mode if old else f"default({_PLATFORM_MODE})"

    if req.mode == "default":
        if old:
            db.delete(old)
            db.commit()
        new_mode = f"default({_PLATFORM_MODE})"
        effective = _PLATFORM_MODE
        is_override = False
        updated_at = None
    else:
        if old:
            old.mode = req.mode
            old.updated_by_id = actor.id
        else:
            db.add(GuardMode(organization_id=org_id, team=team,
                             mode=req.mode, updated_by_id=actor.id))
        db.commit()
        row = db.query(GuardMode).filter(
            GuardMode.organization_id == org_id, GuardMode.team == team
        ).first()
        new_mode = req.mode
        effective = req.mode
        is_override = True
        updated_at = row.updated_at

    logging.getLogger("ai_asset_mgmt.security").warning(
        "GUARD MODE: team=%s %s -> %s by=%s", team, old_mode, new_mode, actor.email
    )
    tel.save_blocked(
        db, team=team, agent="guard-mode", model="-",
        prompt=f"Guard mode change by {actor.email}",
        reason=f"GUARD_MODE: team '{team}' {old_mode} → {new_mode} by {actor.email}",
        organization_id=org_id,
    )

    _dm2 = bool(_get_org_config(db, org_id, "demo_mode"))
    shadow = tel.would_block_counts(db, days=30, organization_id=org_id, demo_mode=_dm2)
    return GuardModeOut(team=team, mode=effective, is_override=is_override,
                        would_block_30d=shadow.get(team, 0), updated_at=updated_at)


# ── Settings / API Keys ───────────────────────────────────────────────────────

_ENV_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), ".env")

_KEY_DEFINITIONS = [
    {"key": "OPENAI_API_KEY",    "provider": "OpenAI",    "placeholder": "your-openai-api-key-here"},
    {"key": "ANTHROPIC_API_KEY", "provider": "Anthropic", "placeholder": "your-anthropic-api-key-here"},
    {"key": "GOOGLE_API_KEY",    "provider": "Google",    "placeholder": "your-google-api-key-here"},
    {"key": "LOCAL_LLM_URL",     "provider": "Local LLM", "placeholder": "http://localhost:11434/v1"},
    {"key": "JWT_SECRET",        "provider": "Auth",      "placeholder": "change-me-in-production-use-a-long-random-string-32chars"},
]


class KeyStatus(BaseModel):
    key: str
    provider: str
    configured: bool
    placeholder: bool


class KeyUpdateRequest(BaseModel):
    key: str
    value: str


@router.get("/settings/keys", response_model=List[KeyStatus], tags=["Auth — Users"])
def get_key_statuses(_=Depends(require_page_access("settings"))):
    """Return the configuration status of each provider API key (admin only). Never exposes actual values."""
    result = []
    for defn in _KEY_DEFINITIONS:
        env_val = os.environ.get(defn["key"], "")
        configured = bool(env_val)
        is_placeholder = env_val == defn["placeholder"]
        result.append(KeyStatus(
            key=defn["key"],
            provider=defn["provider"],
            configured=configured,
            placeholder=is_placeholder,
        ))
    return result


@router.patch("/settings/keys", tags=["Auth — Users"])
def update_key(req: KeyUpdateRequest, _=Depends(require_page_access("settings"))):
    """Write or update a provider API key in the .env file (admin only). The value is stored in the project root .env."""
    from dotenv import set_key

    _PROTECTED_KEYS = {"JWT_SECRET"}
    valid_keys = {d["key"] for d in _KEY_DEFINITIONS} - _PROTECTED_KEYS
    if req.key not in valid_keys:
        raise HTTPException(status_code=400, detail=f"Unknown or protected key '{req.key}'. Valid keys: {sorted(valid_keys)}")

    env_path = _ENV_FILE
    if not os.path.exists(env_path):
        open(env_path, "a").close()

    set_key(env_path, req.key, req.value)
    os.environ[req.key] = req.value
    from app.client import _clients
    _clients.clear()

    return {"key": req.key, "updated": True}


# ── Org Config (admin-managed key-value settings) ─────────────────────────────

@router.get("/settings/config", tags=["Auth — Users"])
def get_org_config_endpoint(user=Depends(get_current_user), db: Session = Depends(get_db)):
    """Return all org-level config values."""
    from app.models import OrgConfig, Organization
    from app.org_config import DEFAULTS as _OC_DEFAULTS
    org = db.query(Organization).filter(Organization.id == user.organization_id).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organisation not found")
    result = dict(_OC_DEFAULTS)
    rows = db.query(OrgConfig).filter(OrgConfig.organization_id == org.id).all()
    for row in rows:
        try:
            result[row.key] = json.loads(row.value)
        except Exception:
            result[row.key] = row.value
    return result


@router.put("/settings/config/{key}", tags=["Auth — Users"])
def set_org_config_endpoint(key: str, body: dict = Body(...), user=Depends(require_admin), db: Session = Depends(get_db)):
    """Set a single org config value (admin only). Body: {\"value\": ...}"""
    from app.models import Organization
    org = db.query(Organization).filter(Organization.id == user.organization_id).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organisation not found")
    _set_org_config(db, org.id, key, body.get("value"))
    return {"key": key, "value": body.get("value")}


@router.get("/settings/demo-mode", tags=["Auth — Users"])
def get_demo_mode(user=Depends(get_current_user), db: Session = Depends(get_db)):
    """Return the current demo-mode setting for this organisation."""
    org_id = user.organization_id
    demo = _get_org_config(db, org_id, "demo_mode")
    return {"demo_mode": bool(demo) if demo is not None else True}


@router.patch("/settings/demo-mode", tags=["Auth — Users"])
def set_demo_mode(body: dict = Body(...), user=Depends(require_admin), db: Session = Depends(get_db)):
    """Toggle demo mode on/off (admin only). Body: {\"demo_mode\": true|false}"""
    demo = bool(body.get("demo_mode", False))
    _set_org_config(db, user.organization_id, "demo_mode", demo)
    return {"demo_mode": demo}
