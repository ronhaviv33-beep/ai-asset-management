import json
import logging
import time
from collections import OrderedDict

from fastapi import APIRouter, Body, Depends, HTTPException, Request
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Role as RoleModel, Team as TeamModel
from app.schemas import (
    ApiKeyCreate, ApiKeyCreated, ApiKeyOut,
    LoginRequest, RoleCreate, RoleOut, RoleUpdate,
    TeamOut, TokenResponse, UserCreate, UserOut, UserUpdate,
)
from app.auth import (
    create_token, generate_api_key, get_current_user,
    hash_password, require_admin, require_page_access, verify_password,
)

router = APIRouter(tags=["Auth — Users"])

# ── Login rate limiter (bounded LRU, per IP) ──────────────────────────────────
_RATE_LIMIT_MAX        = 5
_RATE_LIMIT_WINDOW     = 60   # seconds
_RATE_LIMIT_CACHE_SIZE = 10_000
_login_attempts: OrderedDict = OrderedDict()


def _check_login_rate_limit(ip: str) -> None:
    now = time.time()
    window_start = now - _RATE_LIMIT_WINDOW
    attempts = [t for t in _login_attempts.get(ip, []) if t > window_start]
    if len(attempts) >= _RATE_LIMIT_MAX:
        retry_after = int(_RATE_LIMIT_WINDOW - (now - attempts[0]))
        raise HTTPException(
            status_code=429,
            detail=f"Too many login attempts. Try again in {retry_after} seconds.",
            headers={"Retry-After": str(retry_after)},
        )
    attempts.append(now)
    _login_attempts[ip] = attempts
    _login_attempts.move_to_end(ip)
    while len(_login_attempts) > _RATE_LIMIT_CACHE_SIZE:
        _login_attempts.popitem(last=False)


def register_team(db: Session, organization_id: int, team: str) -> None:
    """Idempotent insert of (organization_id, team) into the teams table.
    Skips blank/unknown teams — they don't represent real attribution entities.
    Called on every write path that accepts a team string."""
    if not team or team == "unknown":
        return
    if not db.query(TeamModel).filter(
        TeamModel.organization_id == organization_id,
        TeamModel.name == team,
    ).first():
        db.add(TeamModel(organization_id=organization_id, name=team))
        db.commit()


_ADMIN_REQUIRED_PAGES = frozenset({
    "home", "chat", "overview", "cost", "agents", "models", "workflows",
    "alerts", "budgets", "security", "users", "apikeys", "settings",
    "integrations", "onboarding",
})


# ── Auth ──────────────────────────────────────────────────────────────────────

@router.post("/auth/login", response_model=TokenResponse)
def login(req: LoginRequest, request: Request, db: Session = Depends(get_db)):
    from app.models import User
    ip = request.client.host if request.client else "unknown"
    _check_login_rate_limit(ip)
    user = db.query(User).filter(User.email == req.email, User.is_active == True).first()  # noqa: E712
    if not user or not verify_password(req.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    return TokenResponse(access_token=create_token(user), user=UserOut.model_validate(user))


@router.get("/auth/me", response_model=UserOut)
async def me(current_user=Depends(get_current_user)):
    return current_user


@router.get("/auth/users", response_model=list[UserOut])
async def list_users(db: Session = Depends(get_db), actor=Depends(require_page_access("users"))):
    from app.models import User
    return (
        db.query(User)
        .filter(
            User.organization_id == actor.organization_id,
            User.is_platform_admin == False,  # noqa: E712
        )
        .order_by(User.created_at)
        .all()
    )


@router.post("/auth/users", response_model=UserOut, status_code=201)
async def create_user(req: UserCreate, db: Session = Depends(get_db), actor=Depends(require_page_access("users"))):
    from app.models import User
    if db.query(User).filter(User.email == req.email).first():
        raise HTTPException(status_code=409, detail="Email already registered")
    if not db.query(RoleModel).filter(RoleModel.organization_id == actor.organization_id, RoleModel.name == req.role).first():
        raise HTTPException(status_code=422, detail=f"Role '{req.role}' does not exist. Create it in Settings → Roles first.")
    user = User(
        email=req.email,
        name=req.name,
        hashed_password=hash_password(req.password),
        role=req.role,
        team=req.team,
        organization_id=actor.organization_id,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    register_team(db, actor.organization_id, req.team)
    return user


@router.patch("/auth/users/{user_id}", response_model=UserOut)
async def update_user(user_id: int, req: UserUpdate, db: Session = Depends(get_db), actor=Depends(require_page_access("users"))):
    from app.models import User
    user = db.query(User).filter(
        User.id == user_id,
        User.organization_id == actor.organization_id,
        User.is_platform_admin == False,  # noqa: E712
    ).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    updates = req.model_dump(exclude_none=True)
    if "password" in updates:
        current_pw = updates.pop("current_password", None)
        if not current_pw or not verify_password(current_pw, user.hashed_password):
            raise HTTPException(status_code=400, detail="Current password is incorrect")
        updates["hashed_password"] = hash_password(updates.pop("password"))
    else:
        updates.pop("current_password", None)
    if "role" in updates and not db.query(RoleModel).filter(RoleModel.organization_id == actor.organization_id, RoleModel.name == updates["role"]).first():
        raise HTTPException(status_code=422, detail=f"Role '{updates['role']}' does not exist.")
    if "role" in updates and updates["role"] != user.role:
        logging.getLogger("ai_asset_mgmt.security").warning(
            "ROLE CHANGE: actor=%s(id=%s) changed user=%s(id=%s) role %s -> %s",
            actor.email, actor.id, user.email, user.id, user.role, updates["role"],
        )
    for field, value in updates.items():
        setattr(user, field, value)
    db.commit()
    db.refresh(user)
    return user


@router.delete("/auth/users/{user_id}", status_code=204)
async def delete_user(user_id: int, db: Session = Depends(get_db), current_user=Depends(require_page_access("users"))):
    from app.models import User
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")
    user = db.query(User).filter(
        User.id == user_id,
        User.organization_id == current_user.organization_id,
        User.is_platform_admin == False,  # noqa: E712
    ).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    db.delete(user)
    db.commit()


# ── Role management ───────────────────────────────────────────────────────────

@router.get("/roles", response_model=list[RoleOut], tags=["Roles"])
async def list_roles(db: Session = Depends(get_db), actor=Depends(get_current_user)):
    """Return roles for the caller's org. Any authenticated user can read this (needed for dropdowns)."""
    roles = db.query(RoleModel).filter(
        RoleModel.organization_id == actor.organization_id
    ).order_by(RoleModel.name).all()
    return [
        RoleOut(
            name=r.name,
            label=r.label,
            color=r.color,
            pages=json.loads(r.pages or "[]"),
            can=json.loads(r.can or "[]"),
            team_scoped=bool(r.team_scoped),
        )
        for r in roles
    ]


@router.get("/teams", response_model=list[TeamOut], tags=["Teams"])
async def list_teams(db: Session = Depends(get_db), actor=Depends(get_current_user)):
    """Return teams registered in the caller's org."""
    teams = db.query(TeamModel).filter(
        TeamModel.organization_id == actor.organization_id
    ).order_by(TeamModel.name).all()
    return teams


@router.post("/roles", response_model=RoleOut, status_code=201, tags=["Roles"])
async def create_role(req: RoleCreate, db: Session = Depends(get_db), actor=Depends(require_admin)):
    if db.query(RoleModel).filter(
        RoleModel.organization_id == actor.organization_id, RoleModel.name == req.name
    ).first():
        raise HTTPException(status_code=409, detail=f"Role '{req.name}' already exists")
    role = RoleModel(
        organization_id=actor.organization_id,
        name=req.name,
        label=req.label,
        color=req.color,
        pages=json.dumps(req.pages),
        can=json.dumps(req.can),
        team_scoped=req.team_scoped,
    )
    db.add(role)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail=f"Role '{req.name}' already exists (DB constraint: {exc.orig})")
    db.refresh(role)
    return RoleOut(name=role.name, label=role.label, color=role.color,
                   pages=json.loads(role.pages or "[]"), can=json.loads(role.can or "[]"),
                   team_scoped=bool(role.team_scoped))


@router.patch("/roles/{role_name}", response_model=RoleOut, tags=["Roles"])
async def update_role(role_name: str, req: RoleUpdate, db: Session = Depends(get_db), actor=Depends(require_admin)):
    role = db.query(RoleModel).filter(
        RoleModel.organization_id == actor.organization_id, RoleModel.name == role_name
    ).first()
    if not role:
        raise HTTPException(status_code=404, detail=f"Role '{role_name}' not found")
    if req.label is not None:
        role.label = req.label
    if req.color is not None:
        role.color = req.color
    if req.pages is not None:
        if role_name == "admin":
            missing = _ADMIN_REQUIRED_PAGES - set(req.pages)
            if missing:
                raise HTTPException(
                    status_code=400,
                    detail=f"Cannot remove required pages from admin role: {sorted(missing)}. "
                           "Removing these would lock all admins out of role/user management.",
                )
        role.pages = json.dumps(req.pages)
    if req.can is not None:
        role.can = json.dumps(req.can)
    if req.team_scoped is not None:
        role.team_scoped = req.team_scoped
    db.commit()
    db.refresh(role)
    return RoleOut(name=role.name, label=role.label, color=role.color,
                   pages=json.loads(role.pages or "[]"), can=json.loads(role.can or "[]"),
                   team_scoped=bool(role.team_scoped))


@router.delete("/roles/{role_name}", status_code=204, tags=["Roles"])
async def delete_role(role_name: str, db: Session = Depends(get_db), actor=Depends(require_admin)):
    if role_name == "admin":
        raise HTTPException(status_code=400, detail="Cannot delete the admin role")
    role = db.query(RoleModel).filter(
        RoleModel.organization_id == actor.organization_id, RoleModel.name == role_name
    ).first()
    if not role:
        raise HTTPException(status_code=404, detail=f"Role '{role_name}' not found")
    from app.models import User
    if db.query(User).filter(
        User.organization_id == actor.organization_id, User.role == role_name
    ).first():
        raise HTTPException(status_code=409, detail=f"Cannot delete role '{role_name}' — users are assigned to it")
    db.delete(role)
    db.commit()


# ── API Key management ────────────────────────────────────────────────────────

@router.post("/api-keys", response_model=ApiKeyCreated, status_code=201)
async def create_api_key(req: ApiKeyCreate, db: Session = Depends(get_db), actor=Depends(require_page_access("apikeys"))):
    from app.models import ApiKey
    if actor.organization_id is None:
        raise HTTPException(status_code=500, detail="Admin account has no organization assigned. Contact your administrator.")
    full_key, key_prefix, key_hash = generate_api_key()
    record = ApiKey(
        name=req.name,
        key_prefix=key_prefix,
        key_hash=key_hash,
        team=req.team,
        organization_id=actor.organization_id,
        created_by_id=actor.id,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    register_team(db, actor.organization_id, req.team)
    logging.getLogger("ai_asset_mgmt.security").info(
        "API key created: id=%s name=%s team=%s org=%s by=%s",
        record.id, record.name, record.team, record.organization_id, actor.email,
    )
    return ApiKeyCreated(
        id=record.id, name=record.name, key_prefix=record.key_prefix,
        team=record.team, created_by_id=record.created_by_id,
        created_at=record.created_at, last_used_at=record.last_used_at,
        is_active=record.is_active, key=full_key,
    )


@router.get("/api-keys", response_model=list[ApiKeyOut])
async def list_api_keys(db: Session = Depends(get_db), actor=Depends(require_page_access("apikeys"))):
    from app.models import ApiKey
    return db.query(ApiKey).filter(ApiKey.organization_id == actor.organization_id).order_by(ApiKey.created_at.desc()).all()


@router.patch("/api-keys/{key_id}", response_model=ApiKeyOut)
async def update_api_key(
    key_id: int,
    is_active: bool = Body(..., embed=True),
    db: Session = Depends(get_db),
    actor=Depends(require_page_access("apikeys")),
):
    from app.models import ApiKey
    key = db.query(ApiKey).filter(ApiKey.id == key_id, ApiKey.organization_id == actor.organization_id).first()
    if not key:
        raise HTTPException(status_code=404, detail="API key not found")
    key.is_active = is_active
    db.commit()
    db.refresh(key)
    action = "enabled" if is_active else "revoked"
    logging.getLogger("ai_asset_mgmt.security").info(
        "API key %s: id=%s name=%s by=%s", action, key.id, key.name, actor.email
    )
    return key


@router.delete("/api-keys/{key_id}", status_code=204)
async def delete_api_key(key_id: int, db: Session = Depends(get_db), actor=Depends(require_page_access("apikeys"))):
    from app.models import ApiKey
    key = db.query(ApiKey).filter(ApiKey.id == key_id, ApiKey.organization_id == actor.organization_id).first()
    if not key:
        raise HTTPException(status_code=404, detail="API key not found")
    logging.getLogger("ai_asset_mgmt.security").info(
        "API key deleted: id=%s name=%s by=%s", key.id, key.name, actor.email
    )
    db.delete(key)
    db.commit()
