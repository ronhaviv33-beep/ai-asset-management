#!/usr/bin/env python3
"""
8-hour soak / traffic-generation script for AI Asset Management platform.

Sends one proxy call every CALL_INTERVAL seconds through the gateway.
Proxy calls go through the ai_agent_inventory SDK when available (preferred)
and fall back to raw requests otherwise.  Every HEALTH_INTERVAL seconds it
also hits the management API for a health snapshot (telemetry count, active
agents, budget warnings).  Prints a live rolling summary and a final report
on exit.

Usage:
    python run_8h.py --gk gk-<your-key>
    python run_8h.py --gk gk-<your-key> --hours 2 --interval 60
    python run_8h.py --gk gk-<your-key> --batch 3 --interval 30
"""
from __future__ import annotations

import argparse
import sys
import time
import random
import requests
from datetime import datetime, timedelta

# ── SDK import (optional — falls back to raw requests if not installed) ────────
try:
    from ai_agent_inventory import OpenAI as _InventoryOpenAI
    _SDK_AVAILABLE = True
except ImportError:
    _SDK_AVAILABLE = False

# ── CONFIG — edit if your deployment differs ───────────────────────────────────
BACKEND  = "https://ai-asset-backend.onrender.com"
EMAIL    = "admin@acme.com"
PASSWORD = "AcmeAdmin123!"
# ──────────────────────────────────────────────────────────────────────────────

# Rotating agent identities — generates multi-agent telemetry across teams
AGENT_IDENTITIES = [
    {"name": "soak-rag-agent",      "team": "Engineering",  "env": "prod"},
    {"name": "soak-chat-agent",     "team": "Support",      "env": "prod"},
    {"name": "soak-summary-agent",  "team": "Analytics",    "env": "staging"},
    {"name": "soak-qa-agent",       "team": "QA",           "env": "prod"},
    {"name": "soak-report-agent",   "team": "Finance",      "env": "prod"},
    {"name": "soak-search-agent",   "team": "Engineering",  "env": "prod"},
    {"name": "soak-ingest-agent",   "team": "DataEng",      "env": "staging"},
    {"name": "soak-monitor-agent",  "team": "Operations",   "env": "prod"},
]

PROMPTS = [
    "What is 2+2? Answer in one word.",
    "Name one planet in our solar system.",
    "What color is the sky? One word.",
    "Complete: The capital of France is ___.",
    "Is water wet? Yes or no.",
    "What is 5 times 3? Number only.",
    "Name one programming language.",
    "What year did WWII end? Number only.",
    "Is Python a compiled language? Yes or no.",
    "Name one element from the periodic table.",
    "Translate 'hello' to Spanish. One word.",
    "What is the boiling point of water in Celsius? Number only.",
    "Name the author of Romeo and Juliet. Surname only.",
    "What is the square root of 16? Number only.",
    "Name one primary colour.",
    "What continent is Brazil on? One word.",
    "Is the sun a star? Yes or no.",
    "How many days in a week? Number only.",
    "What language does Python code run in? One word.",
    "Name one type of database.",
]

# ── ANSI colours ──────────────────────────────────────────────────────────────
GREEN  = "\033[32m"
RED    = "\033[31m"
YELLOW = "\033[33m"
CYAN   = "\033[36m"
BOLD   = "\033[1m"
RESET  = "\033[0m"


# ── helpers ───────────────────────────────────────────────────────────────────

def ts() -> str:
    return datetime.now().strftime("%H:%M:%S")


def fmt_elapsed(seconds: float) -> str:
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    if h:
        return f"{h}h {m:02d}m {s:02d}s"
    return f"{m}m {s:02d}s"


def login() -> str | None:
    try:
        r = requests.post(f"{BACKEND}/auth/login",
                          json={"email": EMAIL, "password": PASSWORD},
                          timeout=15)
        if r.status_code == 200:
            return r.json()["access_token"]
        print(f"  {RED}Login failed: {r.status_code}{RESET}")
    except Exception as e:
        print(f"  {RED}Login error: {e}{RESET}")
    return None


def proxy_call(gk: str, identity: dict, prompt: str) -> tuple[bool, int, str]:
    """Send one chat/completions call through the gateway. Returns (ok, status, detail)."""
    headers = {
        "Authorization":     f"Bearer {gk}",
        "X-Agent-Name":      identity["name"],
        "X-Agent-Team":      identity["team"],
        "X-Agent-Environment": identity["env"],
        "Content-Type":      "application/json",
    }
    body = {
        "model":      "gpt-4o-mini",
        "messages":   [{"role": "user", "content": prompt}],
        "max_tokens": 50,
    }
    try:
        r = requests.post(f"{BACKEND}/v1/chat/completions",
                          headers=headers, json=body, timeout=45)
        ok = r.status_code in (200, 201)
        snippet = ""
        if ok:
            try:
                snippet = r.json()["choices"][0]["message"]["content"][:40]
            except Exception:
                snippet = r.text[:40]
        else:
            snippet = r.text[:60]
        return ok, r.status_code, snippet
    except requests.exceptions.Timeout:
        return False, 0, "timeout"
    except Exception as exc:
        return False, 0, str(exc)[:60]


def make_sdk_client(gk: str):
    """
    Build one ai_agent_inventory.OpenAI client.  Per-call identity overrides
    are applied via extra_headers in sdk_call() so a single client handles
    all rotating agent names.  Returns None if SDK is not installed.
    """
    if not _SDK_AVAILABLE:
        return None
    return _InventoryOpenAI(
        api_key=gk,
        gateway_url=BACKEND,
        agent_name="soak-base",
        team="Engineering",
        environment="prod",
    )


def sdk_call(client, identity: dict, prompt: str) -> tuple[bool, int, str]:
    """
    Send one call through the ai_agent_inventory SDK.
    Per-request extra_headers override the base identity set in the client.
    Returns (ok, status, detail).
    """
    try:
        resp = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=50,
            extra_headers={
                "X-Agent-Name":        identity["name"],
                "X-Agent-Team":        identity["team"],
                "X-Agent-Environment": identity["env"],
            },
        )
        text = (resp.choices[0].message.content or "").strip()[:40]
        return True, 200, text
    except Exception as exc:
        status = getattr(exc, "status_code", 0)
        return False, status or 0, str(exc)[:60]


def health_snapshot(token: str) -> dict:
    """Fetch lightweight management stats. Returns dict of counts."""
    snap = {"telemetry": 0, "agents": 0, "budgets": 0, "health": False}
    try:
        r = requests.get(f"{BACKEND}/health",
                         headers={"Authorization": f"Bearer {token}"},
                         timeout=10)
        snap["health"] = r.status_code == 200
    except Exception:
        pass

    try:
        r = requests.get(f"{BACKEND}/telemetry",
                         headers={"Authorization": f"Bearer {token}"},
                         timeout=15)
        if r.status_code == 200:
            data = r.json()
            snap["telemetry"] = len(data) if isinstance(data, list) else data.get("total", 0)
    except Exception:
        pass

    try:
        r = requests.get(f"{BACKEND}/assets",
                         headers={"Authorization": f"Bearer {token}"},
                         timeout=15)
        if r.status_code == 200:
            data = r.json()
            snap["agents"] = len(data) if isinstance(data, list) else data.get("total", 0)
    except Exception:
        pass

    try:
        r = requests.get(f"{BACKEND}/budgets",
                         headers={"Authorization": f"Bearer {token}"},
                         timeout=15)
        if r.status_code == 200:
            data = r.json()
            snap["budgets"] = len(data) if isinstance(data, list) else 0
    except Exception:
        pass

    return snap


def print_banner(args: argparse.Namespace, end_time: datetime) -> None:
    width = 70
    sdk_label = f"{GREEN}ai_agent_inventory SDK{RESET}" if _SDK_AVAILABLE else f"{YELLOW}raw requests (SDK not installed){RESET}"
    print(f"\n{'═' * width}")
    print(f"  {BOLD}AI Asset Management — 8-Hour Soak Test{RESET}")
    print(f"  Backend:   {BACKEND}")
    print(f"  GK key:    {args.gk[:12]}…")
    print(f"  Call mode: {sdk_label}")
    print(f"  Duration:  {args.hours}h  ({args.batch} call/batch × every {args.interval}s)")
    total_calls = int(args.hours * 3600 / args.interval) * args.batch
    print(f"  Est. calls:{total_calls:>6,}")
    print(f"  Started:   {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"  Ends:      {end_time.strftime('%Y-%m-%d %H:%M:%S')}")
    print('═' * width)


def print_status(elapsed: float, total_calls: int, passed: int, failed: int,
                 snap: dict, budget_warnings: int, last_snap_age: float) -> None:
    total = passed + failed
    pct   = (passed / total * 100) if total else 0.0
    colour = GREEN if pct >= 95 else (YELLOW if pct >= 80 else RED)
    snap_info = (
        f"  telemetry rows: {snap['telemetry']:,}  │  "
        f"agents: {snap['agents']}  │  "
        f"budgets: {snap['budgets']}"
    )
    print(
        f"\n{'─' * 70}\n"
        f"  [{ts()}] {BOLD}Elapsed:{RESET} {fmt_elapsed(elapsed)}"
        f"  │  Calls: {total:,}/{total_calls:,}"
        f"  │  {colour}{pct:.1f}% pass{RESET}"
        f"  │  Fail: {RED}{failed}{RESET}"
        f"  │  Budget warnings: {YELLOW}{budget_warnings}{RESET}"
        f"\n{snap_info}"
        f"\n{'─' * 70}"
    )


def print_final(elapsed: float, passed: int, failed: int,
                budget_warnings: int, snap: dict) -> None:
    total = passed + failed
    pct   = (passed / total * 100) if total else 0.0
    colour = GREEN if pct >= 95 else (YELLOW if pct >= 80 else RED)
    width = 70
    print(f"\n{'═' * width}")
    print(f"  {BOLD}FINAL REPORT{RESET}")
    print(f"  Duration:         {fmt_elapsed(elapsed)}")
    print(f"  Total calls:      {total:,}")
    print(f"  Passed (2xx):     {colour}{passed:,}  ({pct:.1f}%){RESET}")
    print(f"  Failed:           {RED}{failed:,}{RESET}")
    print(f"  Budget warnings:  {YELLOW}{budget_warnings}{RESET}")
    print(f"  Telemetry rows:   {snap.get('telemetry', '?'):,}")
    print(f"  Agents tracked:   {snap.get('agents', '?')}")
    print('═' * width)


# ── main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="8-hour soak test")
    parser.add_argument("--gk",       required=True,       help="Gateway API key (gk-...)")
    parser.add_argument("--hours",    type=float, default=8.0, help="Duration in hours (default 8)")
    parser.add_argument("--interval", type=int,   default=30,  help="Seconds between batches (default 30)")
    parser.add_argument("--batch",    type=int,   default=1,   help="Calls per interval (default 1)")
    args = parser.parse_args()

    if not args.gk.startswith("gk-"):
        print(f"  {RED}Error: --gk must be a gateway key starting with gk-{RESET}")
        sys.exit(1)

    duration_s   = int(args.hours * 3600)
    total_cycles = duration_s // args.interval
    total_calls  = total_cycles * args.batch
    end_time     = datetime.now() + timedelta(seconds=duration_s)

    # Initial login
    token = login()
    if not token:
        print(f"  {RED}Cannot log in — aborting.{RESET}")
        sys.exit(1)

    # Build SDK client (preferred) or fall back to raw requests
    sdk_client = make_sdk_client(args.gk)

    snap = health_snapshot(token)
    print_banner(args, end_time)

    if not snap["health"]:
        print(f"  {RED}Warning: /health not returning 200. Proceeding anyway.{RESET}")
    else:
        print(f"  {GREEN}/health OK{RESET}  │  starting telemetry: {snap['telemetry']:,} rows  │  agents: {snap['agents']}")

    if sdk_client:
        print(f"  {CYAN}SDK client ready — calls go through ai_agent_inventory.OpenAI{RESET}")
    else:
        print(f"  {YELLOW}SDK not installed — using raw requests. Run: pip install -e .{RESET}")

    # Counters
    passed          = 0
    failed          = 0
    budget_warnings = 0
    start_time      = time.monotonic()
    last_health_ts  = start_time
    last_token_ts   = start_time
    TOKEN_REFRESH_S = 45 * 60   # re-login every 45 min
    HEALTH_INTERVAL = 5 * 60    # print health snapshot every 5 min

    identity_idx = 0
    prompt_idx   = 0

    print(f"\n  Running… (Ctrl-C to stop early and see final stats)\n")

    try:
        for cycle in range(total_cycles):
            now = time.monotonic()

            # Token refresh
            if now - last_token_ts >= TOKEN_REFRESH_S:
                new_token = login()
                if new_token:
                    token = new_token
                    last_token_ts = now
                    print(f"  [{ts()}] {CYAN}Token refreshed{RESET}")

            # Send BATCH calls
            for _ in range(args.batch):
                identity  = AGENT_IDENTITIES[identity_idx % len(AGENT_IDENTITIES)]
                prompt    = PROMPTS[prompt_idx % len(PROMPTS)]
                identity_idx += 1
                prompt_idx   += 1

                if sdk_client is not None:
                    ok, status, detail = sdk_call(sdk_client, identity, prompt)
                    mode_tag = f"{CYAN}SDK{RESET} "
                else:
                    ok, status, detail = proxy_call(args.gk, identity, prompt)
                    mode_tag = "HTTP"

                if ok:
                    passed += 1
                    tag = f"{GREEN}OK{RESET}    "
                elif status == 429:
                    failed += 1
                    budget_warnings += 1
                    tag = f"{YELLOW}429 BUDGET{RESET}"
                else:
                    failed += 1
                    tag = f"{RED}{status or 'ERR'}{RESET}  "

                total_done = passed + failed
                progress = total_done / total_calls * 100
                print(f"  [{ts()}] [{mode_tag}][{tag}] {identity['name']:<24} "
                      f"{progress:5.1f}%  \"{detail[:35]}\"")

            # Periodic health snapshot
            if now - last_health_ts >= HEALTH_INTERVAL:
                snap = health_snapshot(token)
                last_health_ts = now
                elapsed = time.monotonic() - start_time
                print_status(elapsed, total_calls, passed, failed,
                             snap, budget_warnings,
                             time.monotonic() - last_health_ts)

            # Sleep until next cycle (account for call time)
            cycle_elapsed = time.monotonic() - now
            sleep_s = max(0.0, args.interval - cycle_elapsed)
            if sleep_s > 0:
                time.sleep(sleep_s)

    except KeyboardInterrupt:
        print(f"\n  {YELLOW}Interrupted by user — computing final stats…{RESET}")

    # Final snapshot
    snap = health_snapshot(token)
    elapsed = time.monotonic() - start_time
    print_final(elapsed, passed, failed, budget_warnings, snap)

    if failed > 0 and (passed / (passed + failed) < 0.80 if (passed + failed) else True):
        sys.exit(1)


if __name__ == "__main__":
    main()
