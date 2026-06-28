"""
Centralized public URLs for ObserveAgents.

Values come from environment variables (set in the Render dashboard / .env) and
fall back to the production custom domains. Nothing here changes request
handling — it only provides canonical hostnames for CORS allow-listing and any
customer-facing links. The Render fallback URL is always allowed so existing
traffic through ai-asset-app.onrender.com keeps working.
"""
from __future__ import annotations

import os


def _clean(value: str, fallback: str) -> str:
    raw = (value or "").strip().rstrip("/")
    return raw or fallback


# Primary production app lives at the apex domain (observeagents.ai), NOT app.*.
PUBLIC_APP_URL     = _clean(os.getenv("PUBLIC_APP_URL"),     "https://observeagents.ai")
PUBLIC_GATEWAY_URL = _clean(os.getenv("PUBLIC_GATEWAY_URL"), "https://gateway.observeagents.ai")
PUBLIC_DEMO_URL    = _clean(os.getenv("PUBLIC_DEMO_URL"),    "https://demo.observeagents.ai")
PUBLIC_API_URL     = _clean(os.getenv("PUBLIC_API_URL"),     "https://api.observeagents.ai")
RENDER_FALLBACK_URL = _clean(os.getenv("RENDER_FALLBACK_URL"), "https://ai-asset-app.onrender.com")

# The canonical public origins that should always be allowed by CORS, in
# addition to any explicit FRONTEND_ORIGIN entries and local dev origins.
# app.observeagents.ai is kept allow-listed (its cert was issued) even though
# the apex domain is now canonical for customer-facing copy.
PUBLIC_ORIGINS = [
    PUBLIC_APP_URL,
    "https://observeagents.ai",
    "https://app.observeagents.ai",
    PUBLIC_GATEWAY_URL,
    PUBLIC_DEMO_URL,
    PUBLIC_API_URL,
    RENDER_FALLBACK_URL,
]

LOCAL_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]
