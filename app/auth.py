import os
import json
import hmac
import hashlib
import base64
import time
from passlib.context import CryptContext
from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from app.database import get_db

SECRET_KEY = os.getenv("JWT_SECRET", "change-me-in-production-use-a-long-random-string-32chars")
TOKEN_EXPIRE_SECS = 8 * 3600

pwd_context   = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")
bearer_scheme = HTTPBearer(auto_error=False)


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _b64url_decode(s: str) -> bytes:
    pad = 4 - len(s) % 4
    return base64.urlsafe_b64decode(s + "=" * (pad % 4))


def create_token(user) -> str:
    header  = _b64url_encode(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    payload = _b64url_encode(json.dumps({
        "sub": str(user.id), "email": user.email, "name": user.name,
        "role": user.role, "team": user.team,
        "exp": int(time.time()) + TOKEN_EXPIRE_SECS,
    }).encode())
    signing_input = f"{header}.{payload}".encode()
    sig = _b64url_encode(hmac.new(SECRET_KEY.encode(), signing_input, hashlib.sha256).digest())
    return f"{header}.{payload}.{sig}"


def _decode_token(token: str) -> dict:
    try:
        parts = token.split(".")
        if len(parts) != 3:
            raise ValueError("bad format")
        header_b64, payload_b64, sig_b64 = parts
        signing_input = f"{header_b64}.{payload_b64}".encode()
        expected_sig  = _b64url_encode(hmac.new(SECRET_KEY.encode(), signing_input, hashlib.sha256).digest())
        if not hmac.compare_digest(sig_b64, expected_sig):
            raise ValueError("invalid signature")
        payload = json.loads(_b64url_decode(payload_b64))
        if payload.get("exp", 0) < int(time.time()):
            raise ValueError("expired")
        return payload
    except Exception as exc:
        raise ValueError(str(exc))


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: Session = Depends(get_db),
):
    if not credentials:
        raise HTTPException(status_code=401, detail="Authentication required")
    try:
        payload = _decode_token(credentials.credentials)
    except ValueError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    from app.models import User
    user = db.query(User).filter(
        User.id == int(payload["sub"]), User.is_active == True  # noqa: E712
    ).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found or inactive")
    return user


async def require_admin(user=Depends(get_current_user)):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user
