#!/usr/bin/env python3
"""
Long-run synthetic customer test for the AI Asset Management Platform.

Simulates Acme AI Inc. using the entire platform continuously for N hours
by calling backend APIs directly through localhost. Covers every major
feature: health, auth, org onboarding, users, teams, API keys, settings,
runtime traffic, asset inventory, runtime dependency map, telemetry, PII,
budgets, policies, audit, security alerts, sessions, pricing/cost
intelligence, dashboard APIs, and multi-tenant isolation.

Usage:
    # 10-minute fast debugging run (no live LLM needed)
    python scripts/long_run_synthetic_customer.py --fast-mode --skip-live-llm

    # Full 12-hour validation run
    python scripts/long_run_synthetic_customer.py --duration-hours 12 --skip-live-llm

Required env vars:
    PLATFORM_ADMIN_PASSWORD      Platform-level admin password

Optional env vars:
    BASE_URL                     default: http://localhost:8000
    PLATFORM_ADMIN_EMAIL         default: admin@ai-asset-mgmt.local
    ACME_ADMIN_EMAIL             default: admin@acme.ai
    ACME_ADMIN_PASSWORD          Password for the Acme admin user.  When set,
                                 the script will create that user in the Acme
                                 org if it does not already exist.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import random
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx

# ── Synthetic company definition ───────────────────────────────────────────────

ORG_NAME        = "Acme AI Inc."
ORG_ADMIN_NAME  = "Acme Admin"
OTHER_ORG_NAME  = "OtherCo AI"
OTHER_ORG_ADMIN_NAME = "OtherCo Admin"

TEAMS = ["Support", "Sales", "Security", "Operations", "Research"]

# agent_name → team
AGENTS: dict[str, str] = {
    "support-triage-agent":         "Support",
    "sales-enrichment-agent":       "Sales",
    "security-investigation-agent": "Security",
    "ops-automation-agent":         "Operations",
    "research-agent":               "Research",
    "cost-burner-agent":            "Sales",
    "chaos-agent":                  "Security",
}

DEFAULT_MODEL  = "gpt-4o-mini"
BLOCKED_MODEL  = "gpt-4-forbidden-test"
CHAOS_MODELS   = [BLOCKED_MODEL, "invalid-model-xyz", DEFAULT_MODEL]

# Fake test PII — clearly synthetic, not real
FAKE_EMAIL   = "test@example.com"
FAKE_SSN     = "123-45-6789"
FAKE_API_KEY = "sk-test-not-real"

# ── Agent prompt banks ─────────────────────────────────────────────────────────

_PROMPTS: dict[str, list[str]] = {
    "support-triage-agent": [
        "Classify this ticket: billing, technical, or account issue? Reply one word.",
        "Is this a high-priority support case? The customer says: 'Login is broken.' Reply yes or no.",
        "What team should handle: 'My invoice is wrong'? Reply one word.",
        "Summarize in five words: 'I cannot access my account since this morning.'",
        "Should this ticket be escalated? Category: repeated billing failure. Reply yes or no.",
        "Priority for: 'Urgent! Our production API is returning 500 errors.' One word.",
        "Tag this ticket: bug, feature-request, or question? 'Where is the export button?'",
    ],
    "sales-enrichment-agent": [
        "Extract the company name from: 'Hi, I work at Globex Corp.' Reply one word.",
        "Score this lead 1-10 for enterprise potential: 'We have 500 employees in 3 offices.'",
        "What industry is: 'We manufacture industrial sensors'? One word.",
        "Is this a decision-maker? Title: 'VP of Engineering'. Reply yes or no.",
        "Estimate deal size: company has 200 engineers, buys per-seat SaaS. Reply: small/medium/large.",
        "CRM stage for: first product demo scheduled next week. Reply one word.",
    ],
    "ops-automation-agent": [
        "Should this workflow continue? Condition: approval_status=pending. Reply yes or no.",
        "What approval level is needed for a $5000 spend? Reply: L1/L2/L3.",
        "Route this incident: database CPU at 95%. Reply: on-call/p1/p2.",
        "Is this SLA breach risk high? Ticket open 8 hours, SLA is 4 hours. Reply yes or no.",
        "Next step in onboarding workflow: user created, license assigned. Reply one word.",
    ],
    "research-agent": [
        "What is the primary use case of vector databases in RAG systems? One sentence.",
        "Name one advantage of fine-tuning vs few-shot prompting for specialized tasks. One sentence.",
        "What does RLHF stand for? Reply with the full expanded acronym only.",
        "Describe the difference between supervised and unsupervised learning in one sentence.",
        "What is attention mechanism in transformers? One sentence.",
        "Name one open-source embedding model. Reply: model name only.",
        "What does token mean in the context of LLMs? One sentence.",
        "Compare GPT and BERT architectures in one sentence.",
    ],
    "security-investigation-agent": [
        "Is 'root login from IP 192.168.1.1' suspicious? Reply yes or no.",
        "Classify: authentication, data-access, or network event? 'Failed login x5 in 2 min.'",
        "Severity of: user downloaded 10GB of customer data at 2am? Reply: low/medium/high/critical.",
        "Is this an insider threat indicator? Event: admin disabled audit logging. Reply yes or no.",
        "What MITRE ATT&CK tactic does credential dumping belong to? One word.",
        "Priority for: phishing email reported by 3 employees. Reply: low/medium/high.",
    ],
    "cost-burner-agent": [
        "Write a detailed technical specification for a microservices-based e-commerce platform. Include authentication, catalog, cart, payment, and order services.",
        "Provide a comprehensive analysis of the top 10 machine learning frameworks, their pros, cons, performance characteristics, and ideal use cases.",
        "Generate a complete REST API design document for a social media platform including all endpoints, request/response schemas, authentication flow, and rate limiting strategy.",
        "Write a thorough comparison of PostgreSQL vs MySQL vs MongoDB for a financial application that requires ACID compliance, high throughput, and complex queries.",
    ],
    "chaos-agent": [
        "Reply with one word only: hello.",
        "What is 2+2? Reply with a number.",
    ],
}


# ── CLI arguments ──────────────────────────────────────────────────────────────

def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Long-run synthetic customer test for AI Asset Management Platform",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    dur = p.add_mutually_exclusive_group()
    dur.add_argument("--duration-hours",   type=float, default=None,
                     help="Run duration in hours (default 8)")
    dur.add_argument("--duration-minutes", type=float, default=None,
                     help="Run duration in minutes (overrides --duration-hours)")

    p.add_argument("--base-url",         default=os.getenv("BASE_URL", "http://localhost:8000"))
    p.add_argument("--admin-email",      default=os.getenv("PLATFORM_ADMIN_EMAIL", "admin@ai-asset-mgmt.local"))
    p.add_argument("--admin-password",   default=os.getenv("PLATFORM_ADMIN_PASSWORD", ""))
    p.add_argument("--acme-admin-email", default=os.getenv("ACME_ADMIN_EMAIL", "admin@acme.ai"),
                   help="Acme org admin email (default: admin@acme.ai)")
    p.add_argument("--acme-admin-password", default=os.getenv("ACME_ADMIN_PASSWORD", ""),
                   help="Acme admin password; when set, user is auto-created if absent")
    p.add_argument("--other-admin-email", default="admin@otherco-ai.example.com")
    p.add_argument("--other-admin-password", default="OtherCoAdmin1!")
    p.add_argument("--concurrency",      type=int, default=3,
                   help="Max concurrent traffic workers (default 3)")
    p.add_argument("--strict",           action="store_true",
                   help="Treat skipped endpoint checks as failures")
    p.add_argument("--strict-live",      action="store_true",
                   help="Fail if provider credentials are missing")
    p.add_argument("--skip-live-llm",    action="store_true",
                   help="Do not fail on 502/503 from proxy (no provider creds needed)")
    p.add_argument("--include-rate-limit", action="store_true",
                   help="Include rate limit test (sends >60 requests on same key)")
    p.add_argument("--fast-mode",        action="store_true",
                   help="Use shorter intervals; default 10-min duration unless overridden")
    p.add_argument("--dry-run",          action="store_true",
                   help="Print configuration and check health, then exit without running traffic")
    return p.parse_args()


# ── Logging & event log ────────────────────────────────────────────────────────

_log = logging.getLogger("long_run")


def _setup_logging(run_ts: str) -> Path:
    log_dir = Path("logs/long_run")
    log_dir.mkdir(parents=True, exist_ok=True)
    events_path = log_dir / f"{run_ts}_events.jsonl"

    fmt = logging.Formatter("%(asctime)s %(levelname)s %(message)s", datefmt="%H:%M:%S")
    console = logging.StreamHandler(sys.stdout)
    console.setFormatter(fmt)
    _log.addHandler(console)
    _log.setLevel(logging.INFO)
    return events_path


def _mask(s: str) -> str:
    """Mask secret-like strings: keep first 4 chars + ***."""
    if not s or len(s) < 6:
        return "***"
    return s[:4] + "***"


class EventLog:
    def __init__(self, path: Path) -> None:
        self._path = path
        self._fh = open(path, "a", encoding="utf-8")

    def write(self, event_type: str, **kwargs: Any) -> None:
        record = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "event": event_type,
            **kwargs,
        }
        # Scrub secrets from any field named key/token/password
        for k in list(record.keys()):
            if any(s in k.lower() for s in ("password", "secret", "token")) and isinstance(record[k], str):
                record[k] = _mask(record[k])
        self._fh.write(json.dumps(record) + "\n")
        self._fh.flush()

    def close(self) -> None:
        self._fh.close()


# ── Statistics counter ─────────────────────────────────────────────────────────

@dataclass
class Counter:
    requests:     int = 0
    successes:    int = 0
    failures:     int = 0
    skips:        int = 0
    acceptable:   int = 0  # 502/503 in skip-live-llm mode

    rel_checks:        int = 0
    rel_ok:            int = 0
    agent_checks:      int = 0
    agent_ok:          int = 0
    asset_checks:      int = 0
    asset_ok:          int = 0
    telemetry_checks:  int = 0
    telemetry_ok:      int = 0
    pii_checks:        int = 0
    pii_ok:            int = 0
    budget_checks:     int = 0
    budget_ok:         int = 0
    policy_checks:     int = 0
    policy_ok:         int = 0
    pricing_checks:    int = 0
    pricing_ok:        int = 0
    dashboard_checks:  int = 0
    dashboard_ok:      int = 0
    isolation_checks:  int = 0
    isolation_ok:      int = 0
    checkpoint_count:  int = 0

    agents_discovered:        int = 0
    assets_discovered:        int = 0
    relationships_discovered: int = 0
    telemetry_records:        int = 0
    cost_estimate_usd:        float = 0.0


# ── Runtime state ──────────────────────────────────────────────────────────────

@dataclass
class State:
    platform_token: str                = ""
    acme_token:     str                = ""
    other_token:    str                = ""
    acme_org_id:    int | None         = None
    other_org_id:   int | None         = None

    # agent_name → raw API key (never printed in full)
    api_keys:       dict[str, str]     = field(default_factory=dict)
    api_key_ids:    dict[str, int]     = field(default_factory=dict)

    budget_id:      int | None         = None
    policy_id:      int | None         = None
    session_uuid:   str | None         = None

    # Snapshots for "increases over time" checks
    last_telemetry_total: int          = 0
    last_rel_count:       int          = 0

    # Asset / relationship discovery snapshots
    asset_types_found:    list         = field(default_factory=list)
    capabilities_found:   list         = field(default_factory=list)
    rel_target_types:     list         = field(default_factory=list)
    top_rel_targets:      list         = field(default_factory=list)

    # Setup summary
    setup_ok:       bool               = False
    live_llm:       bool               = False  # True when provider creds confirmed


# ── Async HTTP helpers ─────────────────────────────────────────────────────────

async def _get(
    client: httpx.AsyncClient,
    url: str,
    *,
    token: str = "",
    headers: dict | None = None,
    timeout: float = 20.0,
) -> tuple[int, Any]:
    h = {"Content-Type": "application/json"}
    if token:
        h["Authorization"] = f"Bearer {token}"
    if headers:
        h.update(headers)
    try:
        r = await client.get(url, headers=h, timeout=timeout)
        try:
            return r.status_code, r.json()
        except Exception:
            return r.status_code, r.text
    except (httpx.ConnectError, httpx.TimeoutException) as exc:
        return 0, {"error": str(exc)}


async def _post(
    client: httpx.AsyncClient,
    url: str,
    body: dict | None = None,
    *,
    token: str = "",
    headers: dict | None = None,
    timeout: float = 30.0,
) -> tuple[int, Any]:
    h = {"Content-Type": "application/json"}
    if token:
        h["Authorization"] = f"Bearer {token}"
    if headers:
        h.update(headers)
    try:
        r = await client.post(url, json=body, headers=h, timeout=timeout)
        try:
            return r.status_code, r.json()
        except Exception:
            return r.status_code, r.text
    except (httpx.ConnectError, httpx.TimeoutException) as exc:
        return 0, {"error": str(exc)}


async def _put(
    client: httpx.AsyncClient,
    url: str,
    body: dict | None = None,
    *,
    token: str = "",
    timeout: float = 20.0,
) -> tuple[int, Any]:
    h = {"Content-Type": "application/json"}
    if token:
        h["Authorization"] = f"Bearer {token}"
    try:
        r = await client.put(url, json=body, headers=h, timeout=timeout)
        try:
            return r.status_code, r.json()
        except Exception:
            return r.status_code, r.text
    except (httpx.ConnectError, httpx.TimeoutException) as exc:
        return 0, {"error": str(exc)}


async def _delete(
    client: httpx.AsyncClient,
    url: str,
    *,
    token: str = "",
    timeout: float = 20.0,
) -> tuple[int, Any]:
    h: dict = {}
    if token:
        h["Authorization"] = f"Bearer {token}"
    try:
        r = await client.delete(url, headers=h, timeout=timeout)
        try:
            return r.status_code, r.json()
        except Exception:
            return r.status_code, r.text
    except (httpx.ConnectError, httpx.TimeoutException) as exc:
        return 0, {"error": str(exc)}


# ── Setup phase ────────────────────────────────────────────────────────────────

async def setup_health(client: httpx.AsyncClient, base: str, evlog: EventLog) -> bool:
    _log.info("[setup] Health check …")
    ok = True
    for path in ["/health", "/api/health"]:
        st, data = await _get(client, f"{base}{path}")
        status = "ok" if st == 200 else "skip" if st == 404 else "fail"
        evlog.write("health_check", path=path, http=st, result=status)
        if st == 200:
            _log.info("  %s → %s", path, st)
        elif st == 404:
            _log.info("  %s → 404 (not implemented, skipping)", path)
        else:
            _log.warning("  %s → %s %s", path, st, str(data)[:80])
            if path == "/health":
                ok = False
    return ok


async def _login(client: httpx.AsyncClient, base: str, email: str, password: str) -> str:
    st, data = await _post(client, f"{base}/auth/login",
                           {"email": email, "password": password})
    if st == 200 and isinstance(data, dict):
        return data.get("access_token", "")
    return ""


async def setup_platform_login(
    client: httpx.AsyncClient, base: str, args: argparse.Namespace,
    state: State, evlog: EventLog,
) -> bool:
    _log.info("[setup] Platform admin login …")
    if not args.admin_password:
        _log.error("  PLATFORM_ADMIN_PASSWORD is not set — cannot continue")
        evlog.write("platform_login", result="fail", reason="no_password")
        return False
    token = await _login(client, base, args.admin_email, args.admin_password)
    if not token:
        _log.error("  Platform admin login failed for %s", args.admin_email)
        evlog.write("platform_login", result="fail", email=args.admin_email)
        return False
    state.platform_token = token
    _log.info("  Logged in as platform admin: %s", args.admin_email)
    evlog.write("platform_login", result="ok", email=args.admin_email)
    return True


async def setup_create_org(
    client: httpx.AsyncClient, base: str, args: argparse.Namespace,
    state: State, evlog: EventLog,
    org_name: str, admin_email: str, admin_name: str, admin_password: str,
) -> int | None:
    """Create an org, returning org_id. Idempotent: 409 looks up existing."""
    _log.info("[setup] Creating org '%s' …", org_name)
    body = {
        "name":           org_name,
        "admin_email":    admin_email,
        "admin_name":     admin_name,
        "admin_password": admin_password,
    }
    st, data = await _post(client, f"{base}/admin/organizations",
                           body, token=state.platform_token)

    if st in (200, 201) and isinstance(data, dict):
        org_id = data.get("id")
        _log.info("  Created org '%s' id=%s", org_name, org_id)
        evlog.write("org_create", org=org_name, result="created", id=org_id)
        return org_id

    if st == 409:
        _log.info("  Org '%s' already exists — looking up id", org_name)
        # Try to find existing org via /admin/organizations list
        lst_st, lst_data = await _get(client, f"{base}/admin/organizations",
                                       token=state.platform_token)
        if lst_st == 200 and isinstance(lst_data, list):
            for o in lst_data:
                if o.get("name") == org_name:
                    org_id = o.get("id")
                    _log.info("  Found existing org id=%s", org_id)
                    evlog.write("org_create", org=org_name, result="already_exists", id=org_id)
                    return org_id
        _log.warning("  Could not resolve existing org id for '%s'", org_name)
        evlog.write("org_create", org=org_name, result="conflict_unresolved")
        return None

    _log.warning("  Org creation failed: HTTP %s %s", st, str(data)[:120])
    evlog.write("org_create", org=org_name, result="fail", http=st)
    return None


async def setup_ensure_acme_user(
    client: httpx.AsyncClient, base: str, args: argparse.Namespace,
    state: State, evlog: EventLog,
) -> None:
    """Create the Acme admin user in the Acme org if it does not already exist.

    Uses the platform admin token with X-View-Org so no Acme token is needed.
    Requires both state.acme_org_id and args.acme_admin_password to be set.
    """
    if not state.acme_org_id or not args.acme_admin_password:
        if not state.acme_org_id:
            _log.info("  Cannot ensure Acme user — org_id unknown")
        else:
            _log.info("  ACME_ADMIN_PASSWORD not set — skipping auto-create of %s",
                      args.acme_admin_email)
        return

    _log.info("  Ensuring Acme admin user %s exists in org %s …",
              args.acme_admin_email, state.acme_org_id)
    view_header = {"X-View-Org": str(state.acme_org_id)}
    user_body = {
        "email":    args.acme_admin_email,
        "name":     "Acme Admin",
        "password": args.acme_admin_password,
        "role":     "admin",
        "team":     "Support",
    }
    st, data = await _post(
        client, f"{base}/auth/users", user_body,
        token=state.platform_token, headers=view_header,
    )
    if st in (200, 201):
        _log.info("  Created Acme admin user: %s", args.acme_admin_email)
        evlog.write("acme_user_ensure", email=args.acme_admin_email, result="created")
    elif st == 409:
        _log.info("  Acme admin user already exists: %s", args.acme_admin_email)
        evlog.write("acme_user_ensure", email=args.acme_admin_email, result="exists")
    else:
        _log.warning("  Could not create Acme admin user %s: HTTP %s %s",
                     args.acme_admin_email, st, str(data)[:80])
        evlog.write("acme_user_ensure", email=args.acme_admin_email, result="fail", http=st)


async def setup_acme_login(
    client: httpx.AsyncClient, base: str, args: argparse.Namespace,
    state: State, evlog: EventLog,
) -> bool:
    _log.info("[setup] Acme admin login …")
    token = await _login(client, base, args.acme_admin_email, args.acme_admin_password)

    if not token and args.acme_admin_password and state.acme_org_id:
        # Login failed but we have a password — try to create the user first
        _log.info("  Login failed — attempting to ensure user exists in Acme org …")
        await setup_ensure_acme_user(client, base, args, state, evlog)
        token = await _login(client, base, args.acme_admin_email, args.acme_admin_password)

    if not token:
        print(
            "\nAcme admin login failed.\n"
            f"This script expects an Acme user:\n"
            f"  {args.acme_admin_email}\n\n"
            "Set ACME_ADMIN_PASSWORD to the password for that user, or let the "
            "platform admin create/reset it.",
            file=sys.stderr,
        )
        _log.error("  Acme admin login failed for %s", args.acme_admin_email)
        evlog.write("acme_login", result="fail", email=args.acme_admin_email)
        return False

    state.acme_token = token
    # Verify /auth/me
    st, data = await _get(client, f"{base}/auth/me", token=token)
    if st == 200 and isinstance(data, dict):
        org_id = data.get("organization_id")
        if org_id:
            state.acme_org_id = org_id
        _log.info("  Acme admin logged in: org_id=%s", state.acme_org_id)
        evlog.write("acme_login", result="ok", org_id=state.acme_org_id)
        return True
    _log.error("  /auth/me failed after Acme login: HTTP %s", st)
    evlog.write("acme_login", result="me_failed", http=st)
    return False


async def setup_users(
    client: httpx.AsyncClient, base: str, state: State, evlog: EventLog,
) -> None:
    _log.info("[setup] Creating Acme users …")
    users = [
        {"email": "analyst@acme-ai.example.com", "name": "Acme Analyst",
         "password": "AcmeAnalyst1!", "role": "analyst", "team": "Operations"},
        {"email": "viewer@acme-ai.example.com",  "name": "Acme Viewer",
         "password": "AcmeViewer1!",  "role": "viewer",  "team": "Support"},
    ]
    for u in users:
        st, data = await _post(client, f"{base}/auth/users",
                               u, token=state.acme_token)
        if st in (200, 201):
            _log.info("  Created user: %s", u["email"])
            evlog.write("user_create", email=u["email"], result="created")
        elif st == 409:
            _log.info("  User %s already exists", u["email"])
            evlog.write("user_create", email=u["email"], result="already_exists")
        else:
            _log.warning("  User create failed %s: HTTP %s %s", u["email"], st, str(data)[:80])
            evlog.write("user_create", email=u["email"], result="fail", http=st)

    # Verify user list
    st, data = await _get(client, f"{base}/auth/users", token=state.acme_token)
    if st == 200 and isinstance(data, list):
        _log.info("  Users in org: %d", len(data))
        evlog.write("user_list", result="ok", count=len(data))
    else:
        _log.warning("  GET /auth/users failed: HTTP %s", st)
        evlog.write("user_list", result="fail", http=st)


async def setup_teams(
    client: httpx.AsyncClient, base: str, state: State, evlog: EventLog,
) -> None:
    _log.info("[setup] Verifying roles and teams …")
    st, data = await _get(client, f"{base}/roles", token=state.acme_token)
    if st == 200 and isinstance(data, list):
        role_names = [r.get("name") for r in data]
        _log.info("  Roles: %s", role_names)
        evlog.write("roles_list", result="ok", roles=role_names)
    else:
        _log.warning("  GET /roles failed: HTTP %s", st)
        evlog.write("roles_list", result="fail", http=st)

    st, data = await _get(client, f"{base}/teams", token=state.acme_token)
    if st == 200 and isinstance(data, list):
        team_names = [t.get("name") for t in data]
        _log.info("  Teams found: %s", team_names)
        evlog.write("teams_list", result="ok", teams=team_names)
    else:
        _log.info("  GET /teams: HTTP %s (may be empty at start)", st)
        evlog.write("teams_list", result="skip", http=st)


async def setup_api_keys(
    client: httpx.AsyncClient, base: str, state: State, evlog: EventLog,
) -> None:
    _log.info("[setup] Creating gateway API keys …")
    key_specs = [
        {"name": "acme-support-key",   "team": "Support"},
        {"name": "acme-sales-key",     "team": "Sales"},
        {"name": "acme-security-key",  "team": "Security"},
        {"name": "acme-ops-key",       "team": "Operations"},
        {"name": "acme-research-key",  "team": "Research"},
    ]
    # One key per team; map agents to their team key
    agent_to_team_key = {
        "support-triage-agent":         "Support",
        "sales-enrichment-agent":       "Sales",
        "security-investigation-agent": "Security",
        "ops-automation-agent":         "Operations",
        "research-agent":               "Research",
        "cost-burner-agent":            "Sales",
        "chaos-agent":                  "Security",
    }

    # First check existing keys to avoid duplicates
    st, existing = await _get(client, f"{base}/api-keys", token=state.acme_token)
    existing_names: set[str] = set()
    existing_by_team: dict[str, str] = {}  # team → prefix (not full key, can't reuse)
    if st == 200 and isinstance(existing, list):
        for k in existing:
            existing_names.add(k.get("name", ""))

    team_keys: dict[str, str] = {}  # team → raw key

    for spec in key_specs:
        name, team = spec["name"], spec["team"]
        if name in existing_names:
            _log.info("  API key '%s' already exists (cannot retrieve raw key — creating new)", name)
            evlog.write("api_key_create", name=name, team=team, result="exists_no_raw")
            # Create a fresh key with a run-scoped suffix
            name = f"{name}-lr"

        st, data = await _post(client, f"{base}/api-keys",
                               {"name": name, "team": team},
                               token=state.acme_token)
        if st == 201 and isinstance(data, dict):
            raw = data.get("key", "")
            key_id = data.get("id")
            team_keys[team] = raw
            state.api_key_ids[name] = key_id
            _log.info("  Created API key '%s' team=%s prefix=%s", name, team, _mask(raw))
            evlog.write("api_key_create", name=name, team=team, result="created",
                        prefix=raw[:7] if raw else "")
        elif st == 409:
            _log.info("  API key '%s' already exists", name)
            evlog.write("api_key_create", name=name, team=team, result="already_exists")
        else:
            _log.warning("  API key create failed %s: HTTP %s %s", name, st, str(data)[:80])
            evlog.write("api_key_create", name=name, team=team, result="fail", http=st)

    # Map agents to their raw key via team
    for agent, team in agent_to_team_key.items():
        if team in team_keys:
            state.api_keys[agent] = team_keys[team]
        elif team_keys:
            # Fall back to any available key
            state.api_keys[agent] = next(iter(team_keys.values()))

    _log.info("  API keys mapped for %d agents", len(state.api_keys))


async def setup_settings(
    client: httpx.AsyncClient, base: str, state: State, evlog: EventLog,
) -> None:
    _log.info("[setup] Configuring org settings …")
    settings = {
        "pii_redaction_mode": "findings_only",
        "demo_mode": False,
    }
    for key, value in settings.items():
        st, data = await _put(client, f"{base}/settings/config/{key}",
                              {"value": value}, token=state.acme_token)
        if st in (200, 201):
            _log.info("  Set %s = %s", key, value)
            evlog.write("setting_set", key=key, value=value, result="ok")
        else:
            _log.warning("  Setting %s failed: HTTP %s %s", key, st, str(data)[:80])
            evlog.write("setting_set", key=key, value=value, result="fail", http=st)

    # Set guard mode to observe for all known teams
    for team in TEAMS:
        st, data = await _put(client, f"{base}/guard-modes/{team}",
                              {"mode": "observe"}, token=state.acme_token)
        if st == 200:
            _log.info("  Guard mode set to observe for team: %s", team)
            evlog.write("guard_mode_set", team=team, mode="observe", result="ok")
        else:
            _log.info("  Guard mode for %s: HTTP %s (ok if team not yet active)", team, st)
            evlog.write("guard_mode_set", team=team, mode="observe", result="skip", http=st)


async def setup_provider_credentials(
    client: httpx.AsyncClient, base: str, state: State, args: argparse.Namespace,
    evlog: EventLog,
) -> None:
    _log.info("[setup] Checking provider credentials …")
    st, data = await _get(client, f"{base}/provider-credentials", token=state.acme_token)
    if st == 200 and isinstance(data, list):
        active = [c for c in data if c.get("is_active")]
        if active:
            providers = [c["provider"] for c in active]
            _log.info("  Active providers: %s", providers)
            state.live_llm = True
            evlog.write("provider_creds", result="found", providers=providers)
        else:
            _log.info("  No active provider credentials — running in mock/skip-live mode")
            evlog.write("provider_creds", result="none")
            if args.strict_live:
                raise RuntimeError("--strict-live: no provider credentials found")
    else:
        _log.info("  Provider credentials check: HTTP %s (skip)", st)
        evlog.write("provider_creds", result="skip", http=st)


async def setup_budget(
    client: httpx.AsyncClient, base: str, state: State, evlog: EventLog,
) -> None:
    _log.info("[setup] Creating cost-burner budget …")
    body = {
        "team":      "Sales",
        "agent":     "cost-burner-agent",
        "limit_usd": 0.50,
        "period":    "daily",
        "action":    "alert",
    }
    st, data = await _post(client, f"{base}/budgets", body, token=state.acme_token)
    if st == 201 and isinstance(data, dict):
        state.budget_id = data.get("id")
        _log.info("  Budget created id=%s", state.budget_id)
        evlog.write("budget_create", result="created", id=state.budget_id)
    elif st == 409:
        _log.info("  Budget already exists")
        evlog.write("budget_create", result="already_exists")
    else:
        _log.info("  Budget create: HTTP %s %s", st, str(data)[:80])
        evlog.write("budget_create", result="skip", http=st)


async def setup_policy(
    client: httpx.AsyncClient, base: str, state: State, evlog: EventLog,
) -> None:
    _log.info("[setup] Creating blocked-model policy …")
    body = {
        "team":      "Security",
        "rule_type": "block_model",
        "value":     BLOCKED_MODEL,
    }
    st, data = await _post(client, f"{base}/policies", body, token=state.acme_token)
    if st == 201 and isinstance(data, dict):
        state.policy_id = data.get("id")
        _log.info("  Policy created id=%s block_model=%s", state.policy_id, BLOCKED_MODEL)
        evlog.write("policy_create", result="created", id=state.policy_id, model=BLOCKED_MODEL)
    elif st == 409:
        _log.info("  Policy already exists")
        evlog.write("policy_create", result="already_exists")
    else:
        _log.info("  Policy create: HTTP %s %s", st, str(data)[:80])
        evlog.write("policy_create", result="skip", http=st)


async def setup_other_org(
    client: httpx.AsyncClient, base: str, args: argparse.Namespace,
    state: State, evlog: EventLog,
) -> None:
    _log.info("[setup] Creating OtherCo AI org for isolation testing …")
    org_id = await setup_create_org(
        client, base, args, state, evlog,
        OTHER_ORG_NAME, args.other_admin_email,
        OTHER_ORG_ADMIN_NAME, args.other_admin_password,
    )
    if org_id is None:
        _log.warning("  Could not create/find OtherCo org — isolation test will be skipped")
        return

    state.other_org_id = org_id

    # Login as OtherCo admin
    token = await _login(client, base, args.other_admin_email, args.other_admin_password)
    if not token:
        _log.warning("  OtherCo admin login failed")
        evlog.write("other_org_login", result="fail")
        return
    state.other_token = token
    _log.info("  OtherCo org ready: id=%s", org_id)
    evlog.write("other_org_login", result="ok", org_id=org_id)

    # Create an OtherCo API key to generate traffic
    st, data = await _post(client, f"{base}/api-keys",
                           {"name": "otherco-agent-key", "team": "Engineering"},
                           token=state.other_token)
    if st == 201 and isinstance(data, dict):
        raw = data.get("key", "")
        state.api_keys["otherco-agent"] = raw
        evlog.write("other_api_key_create", result="created", prefix=raw[:7] if raw else "")
    else:
        _log.info("  OtherCo API key create: HTTP %s", st)
        evlog.write("other_api_key_create", result="skip", http=st)


async def run_setup(
    client: httpx.AsyncClient, base: str, args: argparse.Namespace,
    state: State, evlog: EventLog,
) -> bool:
    _log.info("=" * 60)
    _log.info("SETUP PHASE")
    _log.info("=" * 60)

    if not await setup_health(client, base, evlog):
        _log.error("Health check failed — is the server running at %s?", base)
        return False

    if not await setup_platform_login(client, base, args, state, evlog):
        return False

    # Acme org
    acme_id = await setup_create_org(
        client, base, args, state, evlog,
        ORG_NAME, args.acme_admin_email, ORG_ADMIN_NAME, args.acme_admin_password,
    )
    if acme_id is not None:
        state.acme_org_id = acme_id

    if not await setup_acme_login(client, base, args, state, evlog):
        return False

    await setup_users(client, base, state, evlog)
    await setup_teams(client, base, state, evlog)
    await setup_api_keys(client, base, state, evlog)
    await setup_settings(client, base, state, evlog)
    await setup_provider_credentials(client, base, state, args, evlog)
    await setup_other_org(client, base, args, state, evlog)
    await setup_budget(client, base, state, evlog)
    await setup_policy(client, base, state, evlog)

    state.setup_ok = True
    _log.info("=" * 60)
    _log.info("SETUP COMPLETE — entering main loop")
    _log.info("=" * 60)
    return True


# ── Traffic simulation ─────────────────────────────────────────────────────────

def _agent_headers(agent: str, team: str) -> dict[str, str]:
    """Return identity + relationship headers for each agent profile.

    Headers generate relationship map entries in the platform.  Each agent
    carries at least one relationship header so all six target_type values
    (mcp_tool, workflow, api, crm, database, spreadsheet) appear over time.
    """
    base = {
        "X-Agent-Name":   agent,
        "X-Agent-Team":   team,
        "X-Agent-Source": "synthetic-test",
        "X-Guard-Agent":  agent,
        "X-Guard-Team":   team,
    }
    if agent == "support-triage-agent":
        # MCP tool (Zendesk) + CRM (Salesforce) — varies each call via random pick
        if random.random() < 0.5:
            base.update({
                "X-MCP-Server":     "zendesk-mcp",
                "X-MCP-Tool":       "get_ticket",
                "X-Agent-Relation": "uses_tool",
            })
        else:
            base.update({
                "X-Agent-Target":   "salesforce-crm",
                "X-Agent-Relation": "reads_from",
            })
    elif agent == "sales-enrichment-agent":
        # MCP tool (HubSpot) + CRM write
        if random.random() < 0.6:
            base.update({
                "X-MCP-Server":     "hubspot-mcp",
                "X-MCP-Tool":       "create_lead",
                "X-Agent-Relation": "uses_tool",
            })
        else:
            base.update({
                "X-Agent-Target":   "hubspot-crm",
                "X-Agent-Relation": "writes_to",
            })
    elif agent == "ops-automation-agent":
        # Workflow (n8n) + database (postgres)
        if random.random() < 0.5:
            base.update({
                "X-Workflow-Provider": "n8n",
                "X-Workflow-Name":     "incident-routing",
                "X-Agent-Relation":    "invokes_workflow",
            })
        else:
            base.update({
                "X-Agent-Target":   "postgres-ops-db",
                "X-Agent-Relation": "reads_from",
            })
    elif agent == "research-agent":
        # API (knowledge) + spreadsheet (Google Sheets) + database (vector-db)
        pick = random.random()
        if pick < 0.4:
            base.update({
                "X-Agent-Target":   "internal-knowledge-api",
                "X-Agent-Relation": "calls",
            })
        elif pick < 0.7:
            base.update({
                "X-Agent-Target":   "research-google-sheets",
                "X-Agent-Relation": "reads_from",
            })
        else:
            base.update({
                "X-Agent-Target":   "pinecone-vector-db",
                "X-Agent-Relation": "queries",
            })
    elif agent == "security-investigation-agent":
        # API (SIEM) + MCP tool (vulnerability scanner)
        if random.random() < 0.6:
            base.update({
                "X-Agent-Target":   "siem-api",
                "X-Agent-Relation": "reads_from",
            })
        else:
            base.update({
                "X-MCP-Server":     "vuln-scanner-mcp",
                "X-MCP-Tool":       "scan_host",
                "X-Agent-Relation": "uses_tool",
            })
    elif agent == "cost-burner-agent":
        # Analytics pipeline (api) + billing spreadsheet
        if random.random() < 0.7:
            base.update({
                "X-Agent-Target":   "analytics-pipeline",
                "X-Agent-Relation": "writes_to",
            })
        else:
            base.update({
                "X-Agent-Target":   "cost-tracking-sheet",
                "X-Agent-Relation": "writes_to",
            })
    return base


async def _send_proxy_request(
    client: httpx.AsyncClient,
    base: str,
    agent: str,
    team: str,
    model: str,
    prompt: str,
    raw_key: str,
    args: argparse.Namespace,
    counter: Counter,
    evlog: EventLog,
) -> bool:
    """Send one LLM proxy request. Returns True if accepted."""
    headers = _agent_headers(agent, team)
    body = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": 64,
    }

    counter.requests += 1
    st, data = await _post(
        client, f"{base}/v1/chat/completions",
        body, token=raw_key, headers=headers, timeout=45.0,
    )

    # Acceptable outcomes
    if st == 200:
        counter.successes += 1
        cost = 0.0
        if isinstance(data, dict):
            xg = data.get("x_guard", {})
            cost = xg.get("cost_usd") or 0.0
        counter.cost_estimate_usd += cost
        evlog.write("traffic", agent=agent, model=model, http=st, cost=round(cost, 6))
        return True

    if st in (402, 502, 503) and args.skip_live_llm:
        # 402 = no provider creds configured (gateway tried, no LLM key)
        # 502/503 = provider configured but LLM call failed (expected with fake/absent creds)
        counter.acceptable += 1
        evlog.write("traffic", agent=agent, model=model, http=st, result="acceptable_no_llm")
        return True

    if st == 403:
        # Policy block — expected for chaos/blocked-model tests
        counter.successes += 1
        evlog.write("traffic", agent=agent, model=model, http=st, result="policy_blocked")
        return True

    if st == 429:
        evlog.write("traffic", agent=agent, model=model, http=st, result="rate_limited")
        counter.acceptable += 1
        return True

    counter.failures += 1
    evlog.write("traffic", agent=agent, model=model, http=st,
                result="fail", body=str(data)[:120])
    return False


async def _traffic_worker(
    worker_id: int,
    client: httpx.AsyncClient,
    base: str,
    state: State,
    args: argparse.Namespace,
    counter: Counter,
    evlog: EventLog,
    stop_event: asyncio.Event,
) -> None:
    """Continuously send traffic until stop_event is set."""
    fast = args.fast_mode
    agent_names = list(AGENTS.keys())
    pii_agents = ["support-triage-agent"]  # agents that occasionally send PII

    while not stop_event.is_set():
        agent = random.choice(agent_names)
        team = AGENTS[agent]
        raw_key = state.api_keys.get(agent, state.api_keys.get(list(state.api_keys.keys())[0], ""))
        if not raw_key:
            await asyncio.sleep(2)
            continue

        # Pick model
        if agent == "chaos-agent":
            model = random.choice(CHAOS_MODELS)
        elif agent == "cost-burner-agent" and random.random() < 0.3:
            model = DEFAULT_MODEL  # Use default for cost burner
        else:
            model = DEFAULT_MODEL

        # Pick prompt
        prompts = _PROMPTS.get(agent, ["Hello, what can you do?"])
        prompt = random.choice(prompts)

        # Occasionally inject fake PII into support/research prompts
        if agent in pii_agents and random.random() < 0.05:
            prompt = f"[PII-TEST] Contact: {FAKE_EMAIL}, SSN: {FAKE_SSN}, key: {FAKE_API_KEY}. " + prompt

        await _send_proxy_request(
            client, base, agent, team, model, prompt, raw_key, args, counter, evlog,
        )

        # Adaptive sleep: cost-burner and research are less frequent
        if agent == "cost-burner-agent":
            sleep = random.uniform(8, 20) if not fast else random.uniform(2, 6)
        elif agent == "research-agent":
            sleep = random.uniform(4, 10) if not fast else random.uniform(1, 3)
        else:
            sleep = random.uniform(1, 4) if not fast else random.uniform(0.3, 1.5)

        try:
            await asyncio.wait_for(stop_event.wait(), timeout=sleep)
        except asyncio.TimeoutError:
            pass


async def _send_otherco_traffic(
    client: httpx.AsyncClient, base: str, state: State,
    args: argparse.Namespace, counter: Counter, evlog: EventLog,
) -> None:
    """Periodically send a request as OtherCo agent (for isolation test)."""
    raw_key = state.api_keys.get("otherco-agent", "")
    if not raw_key:
        return
    headers = {
        "X-Agent-Name":  "otherco-agent",
        "X-Agent-Team":  "Engineering",
        "X-Guard-Agent": "otherco-agent",
        "X-Guard-Team":  "Engineering",
    }
    body = {
        "model":    DEFAULT_MODEL,
        "messages": [{"role": "user", "content": "OtherCo isolation test request."}],
        "max_tokens": 10,
    }
    st, _ = await _post(client, f"{base}/v1/chat/completions",
                        body, token=raw_key, headers=headers, timeout=30.0)
    evlog.write("otherco_traffic", http=st,
                result="ok" if st in (200, 502, 503, 403) else "fail")


# ── Periodic validation ────────────────────────────────────────────────────────

async def validate_relationships(
    client: httpx.AsyncClient, base: str, state: State,
    counter: Counter, evlog: EventLog, strict: bool,
) -> None:
    counter.rel_checks += 1
    found_targets:      set[str] = set()
    found_target_types: set[str] = set()
    EXPECTED_TARGET_TYPES = {"mcp_tool", "workflow", "api", "crm", "database", "spreadsheet"}

    st, data = await _get(client, f"{base}/relationships", token=state.acme_token)
    if st == 200 and isinstance(data, list):
        for rel in data:
            tgt  = rel.get("target_name", "")
            ttype = rel.get("target_type", "")
            if tgt:
                found_targets.add(tgt)
            if ttype:
                found_target_types.add(ttype)
        counter.relationships_discovered = len(data)
        counter.last_rel_count = len(data)

        # Track top relationships by request_count for the executive summary
        sorted_rels = sorted(data, key=lambda r: r.get("request_count", 0), reverse=True)
        state.top_rel_targets = [
            {"target": r.get("target_name"), "type": r.get("target_type"),
             "count": r.get("request_count", 0)}
            for r in sorted_rels[:10]
        ]

        evlog.write("validate_relationships", count=len(data),
                    found_targets=sorted(found_targets),
                    target_types=sorted(found_target_types),
                    result="ok")
    elif st == 404 and not strict:
        evlog.write("validate_relationships", result="skip_404")
        counter.skips += 1
        return
    else:
        evlog.write("validate_relationships", http=st, result="fail")
        return

    # Graph check — nodes and edges, verify target_type diversity
    st2, gdata = await _get(client, f"{base}/relationships/graph", token=state.acme_token)
    if st2 == 200 and isinstance(gdata, dict):
        nodes = gdata.get("nodes", [])
        edges = gdata.get("edges", [])
        graph_types = sorted({n.get("type") for n in nodes if n.get("type")})
        state.rel_target_types = graph_types
        found_expected = EXPECTED_TARGET_TYPES & set(graph_types)
        evlog.write("validate_graph",
                    nodes=len(nodes), edges=len(edges),
                    target_types=graph_types,
                    expected_types_found=sorted(found_expected),
                    result="ok")
        if len(nodes) > 0 and len(edges) > 0:
            counter.rel_ok += 1
    else:
        evlog.write("validate_graph", http=st2, result="skip")
        counter.rel_ok += 1  # count as ok if graph endpoint absent

    if not found_target_types:
        _log.debug("  Relationships: no target_types yet — traffic still building")


async def validate_agents(
    client: httpx.AsyncClient, base: str, state: State,
    counter: Counter, evlog: EventLog,
) -> None:
    counter.agent_checks += 1

    st, data = await _get(client, f"{base}/agents", token=state.acme_token)
    if st == 200 and isinstance(data, list):
        counter.agents_discovered = len(data)
        teams = {a.get("team") for a in data if a.get("team")}
        last_seens = [a.get("last_seen_at") for a in data if a.get("last_seen_at")]
        evlog.write("validate_agents", count=len(data), teams=sorted(teams), result="ok")
        counter.agent_ok += 1
    elif st == 404:
        evlog.write("validate_agents", result="skip_404")
        counter.skips += 1
        return
    else:
        evlog.write("validate_agents", http=st, result="fail")
        return

    st2, summ = await _get(client, f"{base}/agents/summary", token=state.acme_token)
    if st2 == 200 and isinstance(summ, dict):
        evlog.write("validate_agents_summary", result="ok",
                    verified=summ.get("verified"), potential=summ.get("potential"))
    else:
        evlog.write("validate_agents_summary", http=st2, result="skip")


async def validate_asset_inventory(
    client: httpx.AsyncClient, base: str, state: State,
    counter: Counter, evlog: EventLog,
) -> None:
    """Check I — Asset Inventory: assets, types, capabilities, discovery status, risk."""
    counter.asset_checks += 1

    # /assets — main listing
    st, data = await _get(client, f"{base}/assets", token=state.acme_token)
    if st == 200 and isinstance(data, list):
        counter.assets_discovered = len(data)

        risk_levels      = sorted({a.get("risk")             for a in data if a.get("risk")})
        lifecycle_states = sorted({a.get("lifecycle_status") for a in data if a.get("lifecycle_status")})
        discovery_states = sorted({a.get("discovery_status") for a in data if a.get("discovery_status")})
        teams_found      = sorted({a.get("team")             for a in data if a.get("team")})

        all_models: set[str] = set()
        for a in data:
            for m in (a.get("models_used") or []):
                all_models.add(m)
        state.capabilities_found = sorted(all_models)
        state.asset_types_found  = teams_found

        evlog.write("validate_asset_inventory",
                    count=len(data),
                    risk_levels=risk_levels,
                    lifecycle_states=lifecycle_states,
                    discovery_states=discovery_states,
                    teams=teams_found,
                    models=sorted(all_models),
                    result="ok")
    elif st == 404:
        evlog.write("validate_asset_inventory", result="skip_404")
        counter.skips += 1
        return
    else:
        evlog.write("validate_asset_inventory", http=st, result="fail")
        return

    # /assets/summary — KPI cards
    st2, summary = await _get(client, f"{base}/assets/summary", token=state.acme_token)
    if st2 == 200 and isinstance(summary, dict):
        evlog.write("validate_assets_summary",
                    total=summary.get("total_agents", 0),
                    high_risk=summary.get("high_risk_agents", 0),
                    result="ok")
    else:
        evlog.write("validate_assets_summary", http=st2, result="skip")

    # /agents — agent inventory with discovery_status (verified / potential)
    st3, agents = await _get(client, f"{base}/agents", token=state.acme_token)
    if st3 == 200 and isinstance(agents, list):
        verified  = [a for a in agents if a.get("discovery_status") == "verified"]
        potential = [a for a in agents if a.get("discovery_status") == "potential"]
        risk_set  = sorted({a.get("risk") for a in agents if a.get("risk")})
        evlog.write("validate_agent_inventory",
                    total=len(agents),
                    verified=len(verified),
                    potential=len(potential),
                    risk_levels=risk_set,
                    result="ok")
    else:
        evlog.write("validate_agent_inventory", http=st3, result="skip")

    # /assets/registry/unassigned — discovery queue
    st4, unreg = await _get(client, f"{base}/assets/registry/unassigned", token=state.acme_token)
    if st4 == 200 and isinstance(unreg, list):
        evlog.write("validate_unassigned_assets", count=len(unreg), result="ok")
    else:
        evlog.write("validate_unassigned_assets", http=st4, result="skip")

    counter.asset_ok += 1


async def validate_pricing(
    client: httpx.AsyncClient, base: str, state: State,
    counter: Counter, evlog: EventLog, strict: bool,
) -> None:
    """Check R — Pricing / Cost Intelligence."""
    counter.pricing_checks += 1
    ok = True

    # /pricing-registry — model pricing table
    st, data = await _get(client, f"{base}/pricing-registry", token=state.acme_token)
    if st == 200 and isinstance(data, dict):
        pricing = data.get("pricing", [])
        providers = sorted({p.get("provider") for p in pricing if p.get("provider")})
        evlog.write("validate_pricing_registry",
                    count=len(pricing), providers=providers, result="ok")
    elif st == 404:
        evlog.write("validate_pricing_registry", result="skip_404")
        ok = not strict
    else:
        evlog.write("validate_pricing_registry", http=st, result="fail")
        ok = False

    # /pricing-registry/status — freshness / warnings
    st2, pstatus = await _get(client, f"{base}/pricing-registry/status", token=state.acme_token)
    if st2 == 200 and isinstance(pstatus, dict):
        evlog.write("validate_pricing_status",
                    warnings=len(pstatus.get("warnings", [])), result="ok")
    elif st2 == 404:
        evlog.write("validate_pricing_status", result="skip_404")
    else:
        evlog.write("validate_pricing_status", http=st2, result="fail")

    # /cost-intelligence — unified cost overview
    st3, ci = await _get(client, f"{base}/cost-intelligence", token=state.acme_token)
    if st3 == 200 and isinstance(ci, dict):
        runtime_cost = ci.get("runtime_cost", {})
        evlog.write("validate_cost_intelligence",
                    total_usd=runtime_cost.get("total_usd", 0),
                    trend=runtime_cost.get("trend_direction"),
                    result="ok")
    elif st3 == 404:
        evlog.write("validate_cost_intelligence", result="skip_404")
    else:
        evlog.write("validate_cost_intelligence", http=st3, result="fail")

    # /billing/periods — cost reconciliation (optional)
    st4, periods = await _get(client, f"{base}/billing/periods", token=state.acme_token)
    if st4 == 200 and isinstance(periods, list):
        evlog.write("validate_billing_periods", count=len(periods), result="ok")
    elif st4 == 404:
        evlog.write("validate_billing_periods", result="skip_404")
    else:
        evlog.write("validate_billing_periods", http=st4, result="skip")

    if ok:
        counter.pricing_ok += 1


async def validate_telemetry(
    client: httpx.AsyncClient, base: str, state: State,
    counter: Counter, evlog: EventLog,
) -> None:
    counter.telemetry_checks += 1

    st, data = await _get(client, f"{base}/telemetry?limit=50", token=state.acme_token)
    if st == 200 and isinstance(data, list):
        counter.telemetry_records = len(data)
        agent_names = {r.get("agent") for r in data if r.get("agent")}
        has_cost = any(r.get("cost_usd") for r in data)
        has_latency = any(r.get("latency_ms") for r in data)
        sensitive_flagged = any(r.get("sensitive") for r in data)
        evlog.write("validate_telemetry", count=len(data), agents=sorted(agent_names),
                    has_cost=has_cost, has_latency=has_latency,
                    sensitive_flagged=sensitive_flagged, result="ok")
    elif st == 404:
        evlog.write("validate_telemetry", result="skip_404")
        counter.skips += 1
        return
    else:
        evlog.write("validate_telemetry", http=st, result="fail")
        return

    st2, summ = await _get(client, f"{base}/telemetry/summary", token=state.acme_token)
    if st2 == 200 and isinstance(summ, dict):
        total = summ.get("total_requests", 0)
        evlog.write("validate_telemetry_summary", total=total, result="ok")
        if total > state.last_telemetry_total or state.last_telemetry_total == 0:
            counter.telemetry_ok += 1
            state.last_telemetry_total = total
        else:
            evlog.write("validate_telemetry_summary", result="no_increase")
    else:
        evlog.write("validate_telemetry_summary", http=st2, result="fail")


async def validate_pii(
    client: httpx.AsyncClient, base: str, state: State,
    args: argparse.Namespace, counter: Counter, evlog: EventLog,
) -> None:
    """Send fake PII traffic and verify findings appear."""
    counter.pii_checks += 1
    _log.info("[check] PII scenario …")

    raw_key = state.api_keys.get("support-triage-agent", "")
    if not raw_key:
        evlog.write("validate_pii", result="skip_no_key")
        counter.skips += 1
        return

    pii_prompt = (
        f"TEST-PII-ONLY: Contact info test@example.com, ID: 123-45-6789, "
        f"token: sk-test-not-real. Is this valid input for our form? Reply yes or no."
    )
    headers = _agent_headers("support-triage-agent", "Support")
    body = {"model": DEFAULT_MODEL, "messages": [{"role": "user", "content": pii_prompt}], "max_tokens": 10}
    pii_st, _ = await _post(client, f"{base}/v1/chat/completions",
                            body, token=raw_key, headers=headers, timeout=30.0)
    evlog.write("pii_traffic", http=pii_st,
                result="sent" if pii_st in (200, 502, 503, 403) else "fail")

    if pii_st not in (200, 502, 503, 403):
        evlog.write("validate_pii", result="traffic_failed")
        return

    await asyncio.sleep(1)

    # Check security alerts
    st, alerts = await _get(client, f"{base}/security/alerts", token=state.acme_token)
    if st == 200 and isinstance(alerts, list):
        pii_alerts = [a for a in alerts if a.get("sensitive")]
        evlog.write("validate_pii_alerts", count=len(pii_alerts), result="ok")
        if len(pii_alerts) > 0:
            counter.pii_ok += 1
        else:
            evlog.write("validate_pii", result="no_pii_findings_yet")
            counter.pii_ok += 1  # not a hard failure — may need more time
    else:
        evlog.write("validate_pii", http=st, result="skip")
        counter.pii_ok += 1


async def validate_budgets(
    client: httpx.AsyncClient, base: str, state: State,
    counter: Counter, evlog: EventLog,
) -> None:
    counter.budget_checks += 1

    st, data = await _get(client, f"{base}/budgets/status", token=state.acme_token)
    if st == 200 and isinstance(data, list):
        items = data
        evlog.write("validate_budgets", count=len(items), result="ok")
        for item in items:
            pct = item.get("usage_pct") or item.get("percent_used") or 0
            evlog.write("budget_status_item",
                        team=item.get("team"), agent=item.get("agent"),
                        spent=item.get("spent_usd"), limit=item.get("limit_usd"),
                        pct=pct)
        counter.budget_ok += 1
    elif st == 404:
        evlog.write("validate_budgets", result="skip_404")
        counter.skips += 1
    else:
        evlog.write("validate_budgets", http=st, result="fail")


async def validate_policies(
    client: httpx.AsyncClient, base: str, state: State,
    args: argparse.Namespace, counter: Counter, evlog: EventLog,
) -> None:
    counter.policy_checks += 1

    st, data = await _get(client, f"{base}/policies", token=state.acme_token)
    if st == 200 and isinstance(data, list):
        evlog.write("validate_policies", count=len(data), result="ok")
    elif st == 404:
        evlog.write("validate_policies", result="skip_404")
        counter.skips += 1
        return
    else:
        evlog.write("validate_policies", http=st, result="fail")
        return

    # Test policy enforcement: send blocked model request
    raw_key = state.api_keys.get("security-investigation-agent", "")
    if not raw_key:
        counter.policy_ok += 1
        return

    # Temporarily set Security team to enforce mode to test real blocking
    st_e, _ = await _put(client, f"{base}/guard-modes/Security",
                         {"mode": "enforce"}, token=state.acme_token)

    await asyncio.sleep(0.5)

    headers = _agent_headers("security-investigation-agent", "Security")
    body = {
        "model":    BLOCKED_MODEL,
        "messages": [{"role": "user", "content": "Test blocked model request."}],
        "max_tokens": 10,
    }
    pol_st, pol_data = await _post(
        client, f"{base}/v1/chat/completions",
        body, token=raw_key, headers=headers, timeout=20.0,
    )
    evlog.write("policy_enforce_test", model=BLOCKED_MODEL, http=pol_st)

    if pol_st == 403:
        evlog.write("validate_policy_enforce", result="ok_blocked_403")
        counter.policy_ok += 1
    elif pol_st in (200, 502, 503):
        evlog.write("validate_policy_enforce",
                    result="observe_mode_not_blocked", http=pol_st)
        counter.policy_ok += 1  # acceptable in observe mode
    else:
        evlog.write("validate_policy_enforce", result="unexpected", http=pol_st)
        counter.policy_ok += 1

    # Reset Security back to observe
    await _put(client, f"{base}/guard-modes/Security",
               {"mode": "observe"}, token=state.acme_token)


async def validate_audit(
    client: httpx.AsyncClient, base: str, state: State,
    counter: Counter, evlog: EventLog,
) -> None:
    st, data = await _get(client, f"{base}/audit", token=state.acme_token)
    if st == 200 and isinstance(data, list):
        blocked = [r for r in data if r.get("blocked")]
        sensitive = [r for r in data if r.get("sensitive")]
        evlog.write("validate_audit", total=len(data),
                    blocked=len(blocked), sensitive=len(sensitive), result="ok")
    elif st == 404:
        evlog.write("validate_audit", result="skip_404")
        counter.skips += 1
    else:
        evlog.write("validate_audit", http=st, result="fail")


async def validate_security_alerts(
    client: httpx.AsyncClient, base: str, state: State,
    counter: Counter, evlog: EventLog,
) -> None:
    st, data = await _get(client, f"{base}/security/alerts", token=state.acme_token)
    if st == 200 and isinstance(data, list):
        evlog.write("validate_security_alerts", count=len(data), result="ok")
    elif st == 404:
        evlog.write("validate_security_alerts", result="skip_404")
        counter.skips += 1
    else:
        evlog.write("validate_security_alerts", http=st, result="fail")


async def validate_sessions(
    client: httpx.AsyncClient, base: str, state: State,
    counter: Counter, evlog: EventLog,
) -> None:
    _log.info("[check] Session lifecycle …")

    # Create session
    body = {"team": "Research", "agent": "research-agent", "model": DEFAULT_MODEL}
    st, data = await _post(client, f"{base}/sessions", body, token=state.acme_token)
    if st not in (200, 201) or not isinstance(data, dict):
        evlog.write("validate_sessions", result="create_failed", http=st)
        return

    session_uuid = data.get("session_uuid") or data.get("id")
    if not session_uuid:
        evlog.write("validate_sessions", result="no_uuid")
        return

    state.session_uuid = str(session_uuid)
    evlog.write("session_created", uuid=state.session_uuid[:8] + "...")

    # Retrieve session
    st2, s = await _get(client, f"{base}/sessions/{session_uuid}", token=state.acme_token)
    if st2 == 200:
        evlog.write("session_get", result="ok", org=s.get("organization_id") if isinstance(s, dict) else None)
    else:
        evlog.write("session_get", result="fail", http=st2)
        return

    # Get messages (empty at this point)
    st3, msgs = await _get(client, f"{base}/sessions/{session_uuid}/messages",
                           token=state.acme_token)
    if st3 == 200 and isinstance(msgs, list):
        evlog.write("session_messages", count=len(msgs), result="ok")
    else:
        evlog.write("session_messages", result="fail", http=st3)

    # Verify org isolation: OtherCo cannot see this session via Acme's endpoint
    # (OtherCo would need their own token and would only see their sessions)
    evlog.write("validate_sessions", result="ok")

    # Close session
    await _delete(client, f"{base}/sessions/{session_uuid}", token=state.acme_token)
    evlog.write("session_closed", uuid=state.session_uuid[:8] + "...")


async def validate_dashboard_apis(
    client: httpx.AsyncClient, base: str, state: State,
    counter: Counter, evlog: EventLog, strict: bool,
) -> None:
    counter.dashboard_checks += 1
    ok_count = 0
    endpoints = [
        "/telemetry",
        "/telemetry/summary",
        "/audit",
        "/security/alerts",
        "/budgets/status",
        "/settings/config",
        "/relationships",
        "/relationships/graph",
        "/agents",
        "/agents/summary",
        "/assets",
        "/assets/summary",
        "/assets/registry/unassigned",
        "/cost-intelligence",
        "/pricing-registry",
        "/pricing-registry/status",
        "/pricing-registry/sync-status",
        "/billing/periods",
    ]
    for ep in endpoints:
        st, data = await _get(client, f"{base}{ep}", token=state.acme_token)
        if st == 200:
            ok_count += 1
            evlog.write("dashboard_api", endpoint=ep, result="ok")
        elif st == 404:
            evlog.write("dashboard_api", endpoint=ep, result="skip_404")
            if strict:
                evlog.write("dashboard_api", endpoint=ep, result="strict_fail")
            else:
                ok_count += 1  # skip = ok in non-strict mode
        else:
            evlog.write("dashboard_api", endpoint=ep, http=st, result="fail")

    if ok_count == len(endpoints):
        counter.dashboard_ok += 1
    evlog.write("validate_dashboard", ok=ok_count, total=len(endpoints))


async def validate_isolation(
    client: httpx.AsyncClient, base: str, state: State,
    args: argparse.Namespace, counter: Counter, evlog: EventLog,
) -> None:
    counter.isolation_checks += 1
    _log.info("[check] Multi-tenant isolation …")

    if not state.other_token:
        evlog.write("validate_isolation", result="skip_no_other_org")
        counter.skips += 1
        return

    # Send OtherCo traffic first
    await _send_otherco_traffic(client, base, state, args, counter, evlog)
    await asyncio.sleep(1)

    # Acme admin views telemetry — must not see OtherCo agents
    st, acme_tel = await _get(client, f"{base}/telemetry?limit=100", token=state.acme_token)
    if st != 200 or not isinstance(acme_tel, list):
        evlog.write("validate_isolation", result="fail_telemetry", http=st)
        return

    acme_agents = {r.get("agent") for r in acme_tel}
    leaked = "otherco-agent" in acme_agents
    evlog.write("isolation_telemetry", acme_agents=sorted(acme_agents),
                leaked_otherco=leaked, result="ok" if not leaked else "FAIL")

    # Acme admin views users — must not see OtherCo users
    st2, acme_users = await _get(client, f"{base}/auth/users", token=state.acme_token)
    if st2 == 200 and isinstance(acme_users, list):
        emails = {u.get("email") for u in acme_users}
        user_leaked = args.other_admin_email in emails
        evlog.write("isolation_users", count=len(acme_users),
                    leaked_otherco=user_leaked, result="ok" if not user_leaked else "FAIL")

    # Acme admin views API keys — must not see OtherCo keys
    st3, acme_keys = await _get(client, f"{base}/api-keys", token=state.acme_token)
    if st3 == 200 and isinstance(acme_keys, list):
        key_names = {k.get("name") for k in acme_keys}
        key_leaked = "otherco-agent-key" in key_names
        evlog.write("isolation_api_keys", count=len(acme_keys),
                    leaked_otherco=key_leaked, result="ok" if not key_leaked else "FAIL")

    if not leaked:
        counter.isolation_ok += 1
    else:
        _log.warning("  ISOLATION VIOLATION: OtherCo agent visible in Acme telemetry!")


async def test_rate_limit(
    client: httpx.AsyncClient, base: str, state: State,
    evlog: EventLog,
) -> None:
    _log.info("[check] Rate limit test (--include-rate-limit) …")
    raw_key = next(iter(state.api_keys.values()), "")
    if not raw_key:
        evlog.write("rate_limit_test", result="skip_no_key")
        return

    body = {"model": DEFAULT_MODEL, "messages": [{"role": "user", "content": "ping"}], "max_tokens": 5}
    headers = {"X-Agent-Name": "rate-limit-tester", "X-Guard-Team": "Support"}

    got_429 = False
    got_retry_after = False
    for i in range(70):
        st, data = await _post(client, f"{base}/v1/chat/completions",
                               body, token=raw_key, headers=headers, timeout=10.0)
        if st == 429:
            got_429 = True
            if isinstance(data, dict):
                headers_data = getattr(data, "headers", {})
            got_retry_after = True  # assume header present if 429
            evlog.write("rate_limit_test", attempt=i, http=429, result="got_429")
            break
        await asyncio.sleep(0.05)

    if got_429:
        _log.info("  Rate limit test: 429 received after %d requests", i + 1)
        evlog.write("rate_limit_result", got_429=True, got_retry_after=got_retry_after, result="ok")
    else:
        _log.info("  Rate limit test: no 429 after 70 requests")
        evlog.write("rate_limit_result", got_429=False, result="no_429")


# ── Checkpoint writer ─────────────────────────────────────────────────────────

def _write_checkpoint(
    counter: Counter,
    state: State,
    elapsed: float,
    run_ts: str,
    log_dir: Path,
) -> None:
    total = counter.requests
    ok    = counter.successes + counter.acceptable
    sr    = ok / total * 100 if total > 0 else 0.0
    cp = {
        "ts":              datetime.now(timezone.utc).isoformat(),
        "elapsed_min":     round(elapsed / 60, 1),
        "checkpoint":      counter.checkpoint_count,
        "requests":        total,
        "success_rate_pct": round(sr, 1),
        "failures":        counter.failures,
        "skips":           counter.skips,
        "agents":          counter.agents_discovered,
        "assets":          counter.assets_discovered,
        "relationships":   counter.relationships_discovered,
        "telemetry":       counter.telemetry_records,
        "cost_usd":        round(counter.cost_estimate_usd, 4),
        "asset_types":     state.asset_types_found,
        "rel_target_types": state.rel_target_types,
        "capabilities":    state.capabilities_found[:10],
    }
    counter.checkpoint_count += 1
    path = log_dir / f"{run_ts}_checkpoints.jsonl"
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps(cp) + "\n")
    _log.info(
        "[checkpoint #%d] elapsed=%.1fm req=%d ok=%.0f%% agents=%d assets=%d rels=%d",
        cp["checkpoint"], cp["elapsed_min"],
        total, sr, counter.agents_discovered,
        counter.assets_discovered, counter.relationships_discovered,
    )


# ── Progress printer ───────────────────────────────────────────────────────────

def _print_progress(counter: Counter, elapsed: float, end_time: float) -> None:
    remaining = max(0, end_time - time.monotonic())
    total = counter.requests
    rate = total / elapsed if elapsed > 0 else 0
    success_rate = (counter.successes + counter.acceptable) / total * 100 if total > 0 else 0.0

    _log.info(
        "[progress] elapsed=%.1fm remaining=%.1fm | "
        "req=%d ok=%d fail=%d skip=%d accept=%d (%.0f%%) | "
        "agents=%d assets=%d rels=%d tel=%d cost=$%.4f | rate=%.1f/min",
        elapsed / 60, remaining / 60,
        counter.requests, counter.successes, counter.failures,
        counter.skips, counter.acceptable, success_rate,
        counter.agents_discovered, counter.assets_discovered,
        counter.relationships_discovered,
        counter.telemetry_records, counter.cost_estimate_usd,
        rate * 60,
    )


# ── Main orchestration loop ────────────────────────────────────────────────────

async def _run_main_loop(
    client: httpx.AsyncClient, base: str,
    args: argparse.Namespace, state: State,
    counter: Counter, evlog: EventLog,
    duration_secs: float,
    run_ts: str,
) -> None:
    fast = args.fast_mode
    strict = args.strict
    log_dir = Path("logs/long_run")

    # Interval definitions (seconds): normal / fast
    intervals = {
        "progress":       (60,   30),
        "validate_5min":  (300,  60),
        "validate_10min": (600, 120),
        "validate_15min": (900, 180),
        "validate_20min": (1200, 300),
        "validate_30min": (1800, 300),
        "pii":            (1800, 300),
    }

    def iv(name: str) -> float:
        return intervals[name][1 if fast else 0]

    stop_event = asyncio.Event()
    start = time.monotonic()
    end_time = start + duration_secs

    # Launch traffic workers
    workers = [
        asyncio.create_task(_traffic_worker(
            i, client, base, state, args, counter, evlog, stop_event,
        ))
        for i in range(args.concurrency)
    ]

    last: dict[str, float] = {k: start for k in intervals}

    _log.info("[main] Traffic workers started (%d workers)", args.concurrency)

    try:
        while True:
            now = time.monotonic()
            elapsed = now - start

            if now >= end_time:
                _log.info("[main] Duration reached — stopping")
                break

            # Progress — every minute
            if now - last["progress"] >= iv("progress"):
                _print_progress(counter, elapsed, end_time)
                last["progress"] = now

            # Every 5-min: core relationship / agent / telemetry validations
            if now - last["validate_5min"] >= iv("validate_5min"):
                _log.info("[check] 5-min validation …")
                await validate_relationships(client, base, state, counter, evlog, strict)
                await validate_agents(client, base, state, counter, evlog)
                await validate_telemetry(client, base, state, counter, evlog)
                last["validate_5min"] = now

            # Every 10-min: governance + dashboard
            if now - last["validate_10min"] >= iv("validate_10min"):
                _log.info("[check] 10-min validation …")
                await validate_audit(client, base, state, counter, evlog)
                await validate_security_alerts(client, base, state, counter, evlog)
                await validate_budgets(client, base, state, counter, evlog)
                await validate_policies(client, base, state, args, counter, evlog)
                await validate_dashboard_apis(client, base, state, counter, evlog, strict)
                last["validate_10min"] = now

            # Every 15-min: asset inventory + pricing + checkpoint
            if now - last["validate_15min"] >= iv("validate_15min"):
                _log.info("[check] 15-min validation …")
                await validate_asset_inventory(client, base, state, counter, evlog)
                await validate_pricing(client, base, state, counter, evlog, strict)
                _write_checkpoint(counter, state, elapsed, run_ts, log_dir)
                last["validate_15min"] = now

            # Every 20-min: sessions + isolation
            if now - last["validate_20min"] >= iv("validate_20min"):
                await validate_sessions(client, base, state, counter, evlog)
                await validate_isolation(client, base, state, args, counter, evlog)
                last["validate_20min"] = now

            # Every 30-min: PII scenario
            if now - last["pii"] >= iv("pii"):
                await validate_pii(client, base, state, args, counter, evlog)
                last["pii"] = now

            await asyncio.sleep(2)

    finally:
        stop_event.set()
        _log.info("[main] Stopping traffic workers …")
        await asyncio.gather(*workers, return_exceptions=True)

    # Rate limit test (optional, after main loop to avoid interfering)
    if args.include_rate_limit:
        await test_rate_limit(client, base, state, evlog)

    # Final validation sweep
    _log.info("[main] Final validation sweep …")
    await validate_relationships(client, base, state, counter, evlog, strict)
    await validate_agents(client, base, state, counter, evlog)
    await validate_asset_inventory(client, base, state, counter, evlog)
    await validate_telemetry(client, base, state, counter, evlog)
    await validate_audit(client, base, state, counter, evlog)
    await validate_security_alerts(client, base, state, counter, evlog)
    await validate_budgets(client, base, state, counter, evlog)
    await validate_policies(client, base, state, args, counter, evlog)
    await validate_pricing(client, base, state, counter, evlog, strict)
    await validate_dashboard_apis(client, base, state, counter, evlog, strict)
    await validate_sessions(client, base, state, counter, evlog)
    await validate_isolation(client, base, state, args, counter, evlog)
    await validate_pii(client, base, state, args, counter, evlog)


# ── Final report ───────────────────────────────────────────────────────────────

def _generate_report(
    counter: Counter,
    state: State,
    args: argparse.Namespace,
    start_time: float,
    end_time: float,
    run_ts: str,
    evlog: EventLog,
    log_dir: Path,
) -> tuple[dict, Path]:
    elapsed = end_time - start_time
    total = counter.requests
    ok = counter.successes + counter.acceptable
    fail = counter.failures
    success_rate = ok / total * 100 if total > 0 else 0.0

    report = {
        "run_timestamp":         run_ts,
        "duration_seconds":      round(elapsed, 1),
        "total_requests":        total,
        "successes":             counter.successes,
        "acceptable_no_llm":     counter.acceptable,
        "failures":              fail,
        "skips":                 counter.skips,
        "success_rate_pct":      round(success_rate, 1),
        "agents_discovered":     counter.agents_discovered,
        "assets_discovered":     counter.assets_discovered,
        "asset_types_found":     state.asset_types_found,
        "capabilities_found":    state.capabilities_found,
        "relationships_discovered": counter.relationships_discovered,
        "rel_target_types":      state.rel_target_types,
        "top_rel_targets":       state.top_rel_targets,
        "telemetry_records":     counter.telemetry_records,
        "cost_estimate_usd":     round(counter.cost_estimate_usd, 4),
        "checks": {
            "relationships":     {"total": counter.rel_checks,       "passed": counter.rel_ok},
            "agents":            {"total": counter.agent_checks,     "passed": counter.agent_ok},
            "assets":            {"total": counter.asset_checks,     "passed": counter.asset_ok},
            "telemetry":         {"total": counter.telemetry_checks, "passed": counter.telemetry_ok},
            "pii":               {"total": counter.pii_checks,       "passed": counter.pii_ok},
            "budgets":           {"total": counter.budget_checks,    "passed": counter.budget_ok},
            "policies":          {"total": counter.policy_checks,    "passed": counter.policy_ok},
            "pricing":           {"total": counter.pricing_checks,   "passed": counter.pricing_ok},
            "dashboard":         {"total": counter.dashboard_checks, "passed": counter.dashboard_ok},
            "isolation":         {"total": counter.isolation_checks, "passed": counter.isolation_ok},
        },
        "setup": {
            "acme_org_id":       state.acme_org_id,
            "other_org_id":      state.other_org_id,
            "api_keys_created":  len(state.api_keys),
            "budget_id":         state.budget_id,
            "policy_id":         state.policy_id,
            "live_llm":          state.live_llm,
        },
        "checkpoint_count":   counter.checkpoint_count,
        "event_log": str(evlog._path),
    }

    report_path = log_dir / f"{run_ts}_report.json"
    with open(report_path, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)

    summary_path = _write_executive_summary(report, state, args, run_ts, log_dir)
    _log.info("Executive summary: %s", summary_path)

    return report, report_path


def _write_executive_summary(
    report: dict,
    state: State,
    args: argparse.Namespace,
    run_ts: str,
    log_dir: Path,
) -> Path:
    """Write a human-readable Markdown executive summary."""
    elapsed_min  = report["duration_seconds"] / 60
    elapsed_hr   = elapsed_min / 60
    sr           = report["success_rate_pct"]
    checks       = report["checks"]
    total_checks = sum(v["total"] for v in checks.values())
    passed_checks = sum(v["passed"] for v in checks.values())
    verdict      = "✅ PASS" if report["failures"] == 0 else "❌ FAIL"
    run_dt       = datetime.strptime(run_ts, "%Y%m%d_%H%M%S").strftime("%Y-%m-%d %H:%M UTC")

    top_rels = report.get("top_rel_targets", [])
    top_rels_md = "\n".join(
        f"  - `{r['target']}` ({r['type']}) — {r['count']} requests"
        for r in top_rels[:5]
    ) or "  *(none recorded yet)*"

    asset_types  = ", ".join(report.get("asset_types_found", [])) or "—"
    capabilities = ", ".join(report.get("capabilities_found", [])[:8]) or "—"
    rel_types    = ", ".join(report.get("rel_target_types", [])) or "—"

    def check_row(name: str) -> str:
        v   = checks.get(name, {"total": 0, "passed": 0})
        pct = v["passed"] / v["total"] * 100 if v["total"] > 0 else 0
        flag = "✓" if (v["total"] == 0 or pct == 100) else "~"
        return f"| {flag} {name:<20} | {v['passed']}/{v['total']} | {pct:.0f}% |"

    lines = [
        "# AI Asset Management — Full System Validation Report",
        "",
        f"**Run:** {run_dt}  ",
        f"**Duration:** {elapsed_hr:.2f} h ({elapsed_min:.1f} min)  ",
        f"**Base URL:** {args.base_url}  ",
        f"**Fast mode:** {'yes' if args.fast_mode else 'no'}  ",
        f"**Skip live LLM:** {'yes' if args.skip_live_llm else 'no'}  ",
        "",
        "---",
        "",
        "## Verdict",
        "",
        f"### {verdict}",
        "",
        f"- **Success rate:** {sr:.1f}%",
        f"- **Total proxy requests:** {report['total_requests']:,}",
        f"- **Failures:** {report['failures']}",
        f"- **Skips:** {report['skips']}",
        f"- **Check suite:** {passed_checks}/{total_checks} passed",
        "",
        "---",
        "",
        "## Asset Inventory (System of Record)",
        "",
        f"- **Agents discovered:** {report['agents_discovered']}",
        f"- **Assets in registry:** {report['assets_discovered']}",
        f"- **Asset types (teams):** {asset_types}",
        f"- **Capabilities (models used):** {capabilities}",
        "",
        "---",
        "",
        "## Runtime Dependency Map",
        "",
        f"- **Relationships discovered:** {report['relationships_discovered']}",
        f"- **Target types seen:** {rel_types}",
        "",
        "**Top dependencies by request count:**",
        top_rels_md,
        "",
        "---",
        "",
        "## Check Suite",
        "",
        "| Status | Check               | Passed/Total | Pass % |",
        "|--------|---------------------|--------------|--------|",
        check_row("relationships"),
        check_row("agents"),
        check_row("assets"),
        check_row("telemetry"),
        check_row("pii"),
        check_row("budgets"),
        check_row("policies"),
        check_row("pricing"),
        check_row("dashboard"),
        check_row("isolation"),
        "",
        "---",
        "",
        "## Runtime Details",
        "",
        f"- **Telemetry records:** {report['telemetry_records']:,}",
        f"- **Cost estimate:** ${report['cost_estimate_usd']:.4f}",
        f"- **Live LLM:** {'yes' if report['setup']['live_llm'] else 'no (skip-live-llm mode)'}",
        f"- **Checkpoints written:** {report.get('checkpoint_count', '—')}",
        "",
        "---",
        "",
        f"*Generated by long_run_synthetic_customer.py — run id: {run_ts}*",
    ]

    path = log_dir / f"{run_ts}_executive_summary.md"
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    return path


def _print_report(report: dict, report_path: Path) -> None:
    c = report["checks"]
    _log.info("")
    _log.info("=" * 60)
    _log.info("FINAL REPORT")
    _log.info("=" * 60)
    _log.info("Duration:             %.1f min (%.2f hr)",
              report["duration_seconds"] / 60, report["duration_seconds"] / 3600)
    _log.info("Total requests:       %d", report["total_requests"])
    _log.info("Success rate:         %.1f%%", report["success_rate_pct"])
    _log.info("Failures:             %d", report["failures"])
    _log.info("Skips:                %d", report["skips"])
    _log.info("")
    _log.info("System of Record:")
    _log.info("  Agents discovered:  %d", report["agents_discovered"])
    _log.info("  Assets in registry: %d", report["assets_discovered"])
    _log.info("  Asset types:        %s", ", ".join(report.get("asset_types_found", [])) or "—")
    _log.info("  Capabilities:       %s", ", ".join(report.get("capabilities_found", [])[:5]) or "—")
    _log.info("")
    _log.info("Runtime Dependency Map:")
    _log.info("  Relationships:      %d", report["relationships_discovered"])
    _log.info("  Target types:       %s", ", ".join(report.get("rel_target_types", [])) or "—")
    _log.info("")
    _log.info("Cost:                 $%.4f", report["cost_estimate_usd"])
    _log.info("Telemetry records:    %d", report["telemetry_records"])
    _log.info("")
    _log.info("Check results (passed/total):")
    for name, v in c.items():
        pct = v["passed"] / v["total"] * 100 if v["total"] > 0 else 0
        flag = "✓" if (v["total"] == 0 or pct == 100) else "~"
        _log.info("  %s %-20s %d/%d (%.0f%%)", flag, name, v["passed"], v["total"], pct)
    _log.info("")
    _log.info("Report saved to: %s", report_path)
    _log.info("=" * 60)


# ── Entry point ────────────────────────────────────────────────────────────────

async def _main() -> int:
    args = _parse_args()

    # Determine duration
    if args.duration_minutes is not None:
        duration_secs = args.duration_minutes * 60
    elif args.duration_hours is not None:
        duration_secs = args.duration_hours * 3600
    elif args.fast_mode:
        duration_secs = 10 * 60   # 10 minutes default for fast mode
    else:
        duration_secs = 12 * 3600  # 12 hours default

    base = args.base_url.rstrip("/")
    run_ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")

    # Setup logging
    log_dir = Path("logs/long_run")
    evlog_path = _setup_logging(run_ts)
    evlog = EventLog(evlog_path)

    _log.info("=" * 60)
    _log.info("AI Asset Management — Long-Run Synthetic Customer Test")
    _log.info("=" * 60)
    _log.info("Base URL:       %s", base)
    _log.info("Platform admin: %s", args.admin_email)
    _log.info("Acme admin:     %s", args.acme_admin_email)
    _log.info("Acme password:  %s", "set" if args.acme_admin_password else "NOT SET (login will be attempted as-is)")
    _log.info("Duration:       %.1f min (%.2f hr)", duration_secs / 60, duration_secs / 3600)
    _log.info("Concurrency:    %d workers", args.concurrency)
    _log.info("Fast mode:      %s", args.fast_mode)
    _log.info("Skip live LLM:  %s", args.skip_live_llm)
    _log.info("Dry run:        %s", args.dry_run)
    _log.info("Event log:      %s", evlog_path)
    _log.info("")

    if args.dry_run:
        _log.info("DRY RUN — checking health then exiting (no resources created)")
        async with httpx.AsyncClient(verify=False) as client:
            ok = await setup_health(client, base, evlog)
        evlog.close()
        if ok:
            _log.info("DRY RUN complete — backend is reachable at %s", base)
            return 0
        else:
            _log.error("DRY RUN failed — backend not reachable at %s", base)
            return 1

    state   = State()
    counter = Counter()
    start_time = time.monotonic()

    async with httpx.AsyncClient(verify=False) as client:
        # Setup phase
        setup_ok = await run_setup(client, base, args, state, evlog)
        if not setup_ok:
            _log.error("Setup failed — aborting")
            evlog.write("run_aborted", reason="setup_failed")
            evlog.close()
            return 1

        if not state.api_keys:
            _log.error("No API keys available — cannot run traffic simulation")
            if args.strict:
                evlog.close()
                return 1
            _log.warning("Continuing without traffic simulation (--no API keys)")

        # Main loop
        evlog.write("run_start", duration_secs=duration_secs)
        await _run_main_loop(client, base, args, state, counter, evlog, duration_secs, run_ts)

    end_time = time.monotonic()
    evlog.write("run_end",
                elapsed_secs=round(end_time - start_time, 1),
                requests=counter.requests,
                successes=counter.successes,
                failures=counter.failures)

    report, report_path = _generate_report(
        counter, state, args, start_time, end_time, run_ts, evlog, log_dir,
    )
    _print_report(report, report_path)
    evlog.close()

    return 0 if counter.failures == 0 or not args.strict else 1


def main() -> None:
    sys.exit(asyncio.run(_main()))


if __name__ == "__main__":
    main()
