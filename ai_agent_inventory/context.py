"""
Collect lightweight runtime context for agent identity headers.
All fields fall back gracefully — nothing here raises.
"""
from __future__ import annotations

import os
import platform
import socket


def collect_context(
    *,
    agent_name: str | None = None,
    team: str | None = None,
    owner: str | None = None,
    environment: str | None = None,
    version: str | None = None,
) -> dict:
    """
    Return a dict of identity fields derived from explicit params,
    environment variables, and lightweight runtime inspection.

    Priority for agent_name:
      1. Explicit ``agent_name`` parameter
      2. SERVICE_NAME env var
      3. APP_NAME env var
      4. "unknown-service"

    Hostname is collected as metadata only — never used as the primary name.
    """
    name = (
        agent_name
        or os.getenv("SERVICE_NAME")
        or os.getenv("APP_NAME")
        or "unknown-service"
    )

    env = (
        environment
        or os.getenv("ENVIRONMENT")
        or os.getenv("ENV")
    )

    ver = (
        version
        or os.getenv("APP_VERSION")
    )

    tm = team or os.getenv("TEAM")
    ow = owner or os.getenv("OWNER")

    try:
        hostname = socket.gethostname()
    except Exception:
        hostname = None

    runtime = f"python/{platform.python_version()}"

    return {
        "agent_name":  name,
        "team":        tm,
        "owner":       ow,
        "environment": env,
        "version":     ver,
        # metadata — not used as identity, stored in evidence
        "hostname":    hostname,
        "runtime":     runtime,
    }
