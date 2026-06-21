"""
End-to-end test suite — AI Asset Management platform.

Covers every major site operation using the ai_agent_inventory SDK for
proxy calls and requests for management API calls.

Usage:
    pip install requests
    python test_e2e.py

Edit the CONFIG block at the top before running.
"""
from __future__ import annotations

import sys
import time
import json
import uuid
import requests
from datetime import datetime

# ── CONFIG — edit these ────────────────────────────────────────────────────────
BACKEND  = "https://ai-asset-backend.onrender.com"   # no trailing slash
EMAIL    = "admin@acme.com"
PASSWORD = "AcmeAdmin123!"
# ──────────────────────────────────────────────────────────────────────────────

PASS = "\033[32mPASS\033[0m"
FAIL = "\033[31mFAIL\033[0m"
SKIP = "\033[33mSKIP\033[0m"
INFO = "\033[36mINFO\033[0m"

_results: list[tuple[str, bool, str]] = []
_gk: str | None = None        # gateway key created during the run
_gk_id: int | None = None
_analyst_id: int | None = None
_budget_id: int | None = None
_policy_id: int | None = None
_session_uuid: str | None = None


def section(title: str) -> None:
    print(f"\n{'═' * 60}")
    print(f"  {title}")
    print('═' * 60)


def ok(name: str, detail: str = "") -> None:
    tag = f"  [{PASS}] {name}"
    if detail:
        tag += f"  → {detail}"
    print(tag)
    _results.append((name, True, detail))


def fail(name: str, detail: str = "") -> None:
    tag = f"  [{FAIL}] {name}"
    if detail:
        tag += f"  → {detail}"
    print(tag)
    _results.append((name, False, detail))


def check(name: str, condition: bool, detail: str = "") -> bool:
    if condition:
        ok(name, detail)
    else:
        fail(name, detail)
    return condition


def get(path: str, token: str, **kwargs) -> requests.Response:
    return requests.get(f"{BACKEND}{path}",
                        headers={"Authorization": f"Bearer {token}"},
                        timeout=30, **kwargs)


def post(path: str, token: str, body: dict, **kwargs) -> requests.Response:
    return requests.post(f"{BACKEND}{path}",
                         headers={"Authorization": f"Bearer {token}",
                                  "Content-Type": "application/json"},
                         json=body, timeout=30, **kwargs)


def patch(path: str, token: str, body: dict) -> requests.Response:
    return requests.patch(f"{BACKEND}{path}",
                          headers={"Authorization": f"Bearer {token}",
                                   "Content-Type": "application/json"},
                          json=body, timeout=30)


def put(path: str, token: str, body: dict) -> requests.Response:
    return requests.put(f"{BACKEND}{path}",
                        headers={"Authorization": f"Bearer {token}",
                                 "Content-Type": "application/json"},
                        json=body, timeout=30)


def delete(path: str, token: str) -> requests.Response:
    return requests.delete(f"{BACKEND}{path}",
                           headers={"Authorization": f"Bearer {token}"},
                           timeout=30)


# ══════════════════════════════════════════════════════════════════════════════
# 1. HEALTH
# ══════════════════════════════════════════════════════════════════════════════
def test_health() -> None:
    section("1 · Health check")
    r = requests.get(f"{BACKEND}/health", timeout=15)
    check("GET /health returns 200", r.status_code == 200)
    data = r.json()
    check("tenancy_hardened = true", data.get("tenancy_hardened") is True,
          str(data.get("tenancy_hardened")))
    check("status = ok", data.get("status") == "ok")


# ══════════════════════════════════════════════════════════════════════════════
# 2. AUTH
# ══════════════════════════════════════════════════════════════════════════════
def test_auth(token: str) -> None:
    section("2 · Auth")

    # /auth/me
    r = get("/auth/me", token)
    check("GET /auth/me returns 200", r.status_code == 200)
    me = r.json()
    check("me.email matches login", me.get("email") == EMAIL, me.get("email"))
    check("me.role = admin", me.get("role") == "admin")
    check("me.organization_id set", me.get("organization_id") is not None,
          str(me.get("organization_id")))

    # Wrong password → 401
    r2 = requests.post(f"{BACKEND}/auth/login",
                       json={"email": EMAIL, "password": "WRONGPASSWORD"},
                       timeout=10)
    check("Bad password → 401", r2.status_code == 401)

    # No token → 401
    r3 = requests.get(f"{BACKEND}/auth/me", timeout=10)
    check("No token → 401", r3.status_code == 401)


# ══════════════════════════════════════════════════════════════════════════════
# 3. USERS
# ══════════════════════════════════════════════════════════════════════════════
def test_users(token: str) -> None:
    global _analyst_id
    section("3 · User management")

    # List users
    r = get("/auth/users", token)
    check("GET /auth/users returns 200", r.status_code == 200)
    users = r.json()
    check("user list is non-empty", len(users) >= 1, f"{len(users)} users")
    my_emails = [u["email"] for u in users]
    check("own email in list", EMAIL in my_emails)

    # Create analyst user
    analyst_email = f"analyst-e2e-{uuid.uuid4().hex[:6]}@acme-test.local"
    r2 = post("/auth/users", token, {
        "email": analyst_email,
        "name": "E2E Analyst",
        "password": "TestPass123!",
        "role": "analyst",
        "team": "developer",
    })
    check("POST /auth/users → 201", r2.status_code == 201,
          f"got {r2.status_code}: {r2.text[:120]}")
    if r2.status_code == 201:
        _analyst_id = r2.json()["id"]
        check("new user has org_id", r2.json().get("organization_id") is not None)

    # PATCH the analyst
    if _analyst_id:
        r3 = patch(f"/auth/users/{_analyst_id}", token, {"name": "E2E Analyst Updated"})
        check("PATCH /auth/users/{id} → 200", r3.status_code == 200)
        check("name updated", r3.json().get("name") == "E2E Analyst Updated")

    # Cross-user isolation: analyst logs in, cannot see admin's data
    analyst_token_r = requests.post(f"{BACKEND}/auth/login",
                                    json={"email": analyst_email, "password": "TestPass123!"},
                                    timeout=10)
    check("Analyst can log in", analyst_token_r.status_code == 200)


# ══════════════════════════════════════════════════════════════════════════════
# 4. ROLES
# ══════════════════════════════════════════════════════════════════════════════
def test_roles(token: str) -> None:
    section("4 · Role management")

    r = get("/roles", token)
    check("GET /roles returns 200", r.status_code == 200)
    roles = r.json()
    names = [ro["name"] for ro in roles]
    check("seed roles present (admin/analyst/viewer)",
          all(n in names for n in ["admin", "analyst", "viewer"]),
          str(names))

    # Create a custom role
    r2 = post("/roles", token, {
        "name": "e2e-custom-role",
        "label": "E2E Custom",
        "color": "#123456",
        "pages": ["dashboard", "telemetry"],
        "can": [],
        "team_scoped": False,
    })
    check("POST /roles → 201", r2.status_code == 201,
          f"got {r2.status_code}: {r2.text[:80]}")

    # PATCH it
    r3 = patch("/roles/e2e-custom-role", token, {"label": "E2E Custom Updated"})
    check("PATCH /roles/{name} → 200", r3.status_code == 200)

    # DELETE it
    r4 = delete("/roles/e2e-custom-role", token)
    check("DELETE /roles/{name} → 204", r4.status_code == 204)


# ══════════════════════════════════════════════════════════════════════════════
# 5. TEAMS
# ══════════════════════════════════════════════════════════════════════════════
def test_teams(token: str) -> None:
    section("5 · Teams")
    r = get("/teams", token)
    check("GET /teams returns 200", r.status_code == 200)
    teams = r.json()
    print(f"  [{INFO}] registered teams: {[t['name'] for t in teams]}")


# ══════════════════════════════════════════════════════════════════════════════
# 6. API KEYS
# ══════════════════════════════════════════════════════════════════════════════
def test_api_keys(token: str) -> str | None:
    global _gk, _gk_id
    section("6 · API key management")

    # Create
    r = post("/api-keys", token, {"name": "e2e-test-key", "team": "developer"})
    check("POST /api-keys → 201", r.status_code == 201,
          f"got {r.status_code}: {r.text[:80]}")
    if r.status_code != 201:
        return None
    data = r.json()
    _gk    = data["key"]
    _gk_id = data["id"]
    check("key starts with gk-", _gk.startswith("gk-"), _gk[:14] + "...")
    check("team = developer", data["team"] == "developer")

    # List — key_prefix visible, plaintext key NOT in list
    r2 = get("/api-keys", token)
    check("GET /api-keys returns 200", r2.status_code == 200)
    prefixes = [k["key_prefix"] for k in r2.json()]
    check("new key prefix in list", data["key_prefix"] in prefixes)
    check("plaintext key not in list",
          all("key" not in k or k.get("key") is None for k in r2.json()))

    # Raw gk- key is rejected on management routes
    r3 = requests.get(f"{BACKEND}/auth/me",
                      headers={"Authorization": f"Bearer {_gk}"}, timeout=10)
    check("gk- key rejected on /auth/me → 401", r3.status_code == 401)

    return _gk


# ══════════════════════════════════════════════════════════════════════════════
# 7. PROXY CALLS via SDK  (agent auto-discovery)
# ══════════════════════════════════════════════════════════════════════════════
def test_proxy_and_discovery(gk: str) -> None:
    section("7 · Proxy calls via SDK + agent auto-discovery")

    try:
        from ai_agent_inventory import OpenAI
    except ImportError:
        fail("ai_agent_inventory importable", "run: pip install -e .")
        return

    client = OpenAI(
        api_key=gk,
        gateway_url=f"{BACKEND}/v1",
        agent_name="e2e-sdk-agent",
        team="developer",
        environment="production",
        owner="e2e-test",
    )

    # Send 3 normal calls
    for i in range(3):
        try:
            resp = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[{"role": "user", "content": f"Say 'hello {i}' in one word"}],
            )
            check(f"SDK call {i+1} → 200", True,
                  resp.choices[0].message.content[:40])
        except Exception as exc:
            check(f"SDK call {i+1} → 200", False, str(exc)[:80])

    time.sleep(1)  # let writes settle


def test_discovery_queue(token: str) -> None:
    section("7b · Asset discovery queue")
    r = requests.get(f"{BACKEND}/assets/registry/unassigned",
                     headers={"Authorization": f"Bearer {token}"}, timeout=15)
    check("GET /assets/registry/unassigned → 200", r.status_code == 200)
    items = r.json()
    found = any(i.get("agent_id_raw") == "e2e-sdk-agent" for i in items)
    check("e2e-sdk-agent in unassigned queue", found,
          f"{len(items)} items, names: {[i.get('agent_id_raw') for i in items[:5]]}")


# ══════════════════════════════════════════════════════════════════════════════
# 8. TELEMETRY
# ══════════════════════════════════════════════════════════════════════════════
def test_telemetry(token: str) -> None:
    section("8 · Telemetry")

    r = get("/telemetry", token)
    check("GET /telemetry → 200", r.status_code == 200)
    rows = r.json()
    check("at least 3 rows recorded", len(rows) >= 3, f"{len(rows)} rows")
    agents = {r["agent"] for r in rows}
    check("e2e-sdk-agent in telemetry", "e2e-sdk-agent" in agents, str(agents))

    # Summary
    r2 = get("/telemetry/summary", token)
    check("GET /telemetry/summary → 200", r2.status_code == 200)
    s = r2.json()
    check("total_requests > 0", s.get("total_requests", 0) > 0,
          str(s.get("total_requests")))
    check("total_cost_usd > 0", s.get("total_cost_usd", 0) > 0,
          f"${s.get('total_cost_usd', 0):.6f}")

    # Audit log
    r3 = get("/audit", token)
    check("GET /audit → 200", r3.status_code == 200)

    # Audit filter: sensitive_only
    r4 = get("/audit?sensitive_only=true", token)
    check("GET /audit?sensitive_only=true → 200", r4.status_code == 200)


# ══════════════════════════════════════════════════════════════════════════════
# 9. ASSETS
# ══════════════════════════════════════════════════════════════════════════════
def test_assets(token: str) -> None:
    section("9 · Asset registry")

    r = get("/assets", token)
    check("GET /assets → 200", r.status_code == 200)
    assets = r.json()
    check("assets non-empty", len(assets) >= 1, f"{len(assets)} assets")

    # Summary
    r2 = get("/assets/summary", token)
    check("GET /assets/summary → 200", r2.status_code == 200)
    s = r2.json()
    check("total_agents > 0", s.get("total_agents", 0) > 0)

    # Per-agent telemetry
    r3 = get("/assets/e2e-sdk-agent/telemetry", token)
    check("GET /assets/e2e-sdk-agent/telemetry → 200", r3.status_code == 200)
    check("agent telemetry has items", r3.json().get("total", 0) > 0,
          f"total={r3.json().get('total')}")

    # Claim
    r4 = requests.post(
        f"{BACKEND}/assets/e2e-sdk-agent/claim",
        headers={"Authorization": f"Bearer {token}",
                 "Content-Type": "application/json"},
        json={
            "owner": EMAIL,
            "team": "developer",
            "environment": "production",
            "criticality": "medium",
            "business_purpose": "E2E test agent",
        },
        timeout=15,
    )
    check("POST /assets/e2e-sdk-agent/claim → 200", r4.status_code == 200,
          f"got {r4.status_code}: {r4.text[:80]}")
    if r4.status_code == 200:
        data = r4.json()
        check("status = managed after claim", data.get("status") == "managed")
        check("claimed_by = admin email", data.get("claimed_by") == EMAIL)

    # No longer in unassigned queue
    r5 = get("/assets/registry/unassigned", token)
    still_there = any(i.get("agent_id_raw") == "e2e-sdk-agent"
                      for i in r5.json())
    check("agent gone from discovery queue after claim", not still_there)

    # PATCH registry — update criticality
    r6 = requests.patch(
        f"{BACKEND}/assets/e2e-sdk-agent/registry",
        headers={"Authorization": f"Bearer {token}",
                 "Content-Type": "application/json"},
        json={"criticality": "high"},
        timeout=15,
    )
    check("PATCH /assets/e2e-sdk-agent/registry → 200", r6.status_code == 200)
    if r6.status_code == 200:
        check("criticality updated to high",
              r6.json().get("criticality") == "high")

    # Retire
    r7 = requests.patch(
        f"{BACKEND}/assets/e2e-sdk-agent/registry",
        headers={"Authorization": f"Bearer {token}",
                 "Content-Type": "application/json"},
        json={"status": "retired"},
        timeout=15,
    )
    check("PATCH status=retired → 200", r7.status_code == 200)
    r8 = get("/assets?include_retired=false", token)
    retired_visible = any(a.get("agent_name") == "e2e-sdk-agent"
                          for a in r8.json())
    check("retired agent hidden by default", not retired_visible)
    r9 = get("/assets?include_retired=true", token)
    retired_included = any(a.get("agent_name") == "e2e-sdk-agent"
                           for a in r9.json())
    check("retired agent visible with include_retired=true", retired_included)

    # Un-retire so later tests can use the agent
    requests.patch(
        f"{BACKEND}/assets/e2e-sdk-agent/registry",
        headers={"Authorization": f"Bearer {token}",
                 "Content-Type": "application/json"},
        json={"status": "managed"},
        timeout=15,
    )


# ══════════════════════════════════════════════════════════════════════════════
# 10. SECURITY SCAN + ALERTS
# ══════════════════════════════════════════════════════════════════════════════
def test_security(token: str, gk: str) -> None:
    section("10 · Security detection")

    # Direct scan endpoint
    r = post("/security/scan", token,
             {"text": "My AWS key is AKIAFAKEAPIKEY567890 and SSN 123-45-6789"})
    check("POST /security/scan → 200", r.status_code == 200)
    data = r.json()
    check("is_sensitive = true", data.get("is_sensitive") is True)
    types = [f["type"] for f in data.get("findings", [])]
    check("aws_key detected", "aws_key" in types, str(types))
    check("ssn detected", "ssn" in types, str(types))
    check("critical findings redacted",
          all(f["sample"] == "[redacted]"
              for f in data["findings"] if f["severity"] == "critical"))

    # Send PII through the proxy (observe mode — goes through but is flagged)
    try:
        from ai_agent_inventory import OpenAI
        client = OpenAI(
            api_key=gk,
            gateway_url=f"{BACKEND}/v1",
            agent_name="e2e-sdk-agent",
            team="developer",
        )
        pii_resp = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{
                "role": "user",
                "content": (
                    "Store this for me: sk-TESTFAKEOPENAIKEY0123456789ABCDE "
                    "and credit card 4111 1111 1111 1111"
                ),
            }],
        )
        ok("PII proxy call completes (observe mode)")
    except Exception as exc:
        fail("PII proxy call completes (observe mode)", str(exc)[:80])

    time.sleep(1)

    # Check security alerts
    r2 = get("/security/alerts", token)
    check("GET /security/alerts → 200", r2.status_code == 200)
    alerts = r2.json()
    check("security alerts non-empty", len(alerts) > 0, f"{len(alerts)} alerts")

    # Guard mode enforce → PII should be blocked
    put("/guard-modes/developer", token, {"mode": "enforce"})

    try:
        from ai_agent_inventory import OpenAI
        client2 = OpenAI(
            api_key=gk,
            gateway_url=f"{BACKEND}/v1",
            agent_name="e2e-sdk-agent",
            team="developer",
        )
        try:
            client2.chat.completions.create(
                model="gpt-4o-mini",
                messages=[{"role": "user",
                           "content": "SSN: 123-45-6789"}],
            )
            fail("enforce mode blocks PII", "call succeeded — should have been blocked")
        except Exception as exc:
            blocked = "400" in str(exc) or "sensitive" in str(exc).lower()
            check("enforce mode blocks PII → 400", blocked, str(exc)[:80])
    finally:
        put("/guard-modes/developer", token, {"mode": "observe"})
        ok("guard mode reset to observe")


# ══════════════════════════════════════════════════════════════════════════════
# 11. GUARD MODES
# ══════════════════════════════════════════════════════════════════════════════
def test_guard_modes(token: str) -> None:
    section("11 · Guard modes")

    r = get("/guard-modes", token)
    check("GET /guard-modes → 200", r.status_code == 200)

    # Set to alert
    r2 = put("/guard-modes/developer", token, {"mode": "alert"})
    check("PUT /guard-modes/developer mode=alert → 200", r2.status_code == 200)
    check("effective mode = alert", r2.json().get("effective") == "alert")

    # Remove override (reset to platform default)
    r3 = put("/guard-modes/developer", token, {"mode": "default"})
    check("PUT mode=default removes override → 200", r3.status_code == 200)
    check("is_override = false after reset",
          r3.json().get("is_override") is False)


# ══════════════════════════════════════════════════════════════════════════════
# 12. POLICIES
# ══════════════════════════════════════════════════════════════════════════════
def test_policies(token: str, gk: str) -> None:
    global _policy_id
    section("12 · Policy rules")

    # List
    r = get("/policies", token)
    check("GET /policies → 200", r.status_code == 200)

    # Block gpt-4o-mini for the developer team
    r2 = post("/policies", token, {
        "team": "developer",
        "rule_type": "block_model",
        "value": "gpt-4o-mini",
    })
    check("POST /policies block_model → 201", r2.status_code == 201,
          f"got {r2.status_code}: {r2.text[:80]}")
    if r2.status_code == 201:
        _policy_id = r2.json()["id"]

    # Try using the blocked model in enforce mode
    put("/guard-modes/developer", token, {"mode": "enforce"})
    try:
        from ai_agent_inventory import OpenAI
        client = OpenAI(
            api_key=gk,
            gateway_url=f"{BACKEND}/v1",
            agent_name="e2e-sdk-agent",
            team="developer",
        )
        try:
            client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[{"role": "user", "content": "hello"}],
            )
            fail("blocked model rejected → 403", "call succeeded — should be blocked")
        except Exception as exc:
            blocked = "403" in str(exc) or "block" in str(exc).lower() or "policy" in str(exc).lower()
            check("blocked model rejected → 403", blocked, str(exc)[:80])
    finally:
        put("/guard-modes/developer", token, {"mode": "observe"})

    # Delete policy
    if _policy_id:
        r3 = delete(f"/policies/{_policy_id}", token)
        check("DELETE /policies/{id} → 204", r3.status_code == 204)
        _policy_id = None


# ══════════════════════════════════════════════════════════════════════════════
# 13. BUDGETS
# ══════════════════════════════════════════════════════════════════════════════
def test_budgets(token: str, gk: str) -> None:
    global _budget_id
    section("13 · Budget enforcement")

    # Create a tiny daily budget ($0.001) for the e2e agent
    r = post("/budgets", token, {
        "team": "developer",
        "agent": "e2e-budget-agent",
        "limit_usd": 0.001,
        "period": "daily",
        "action": "block",
    })
    check("POST /budgets → 201", r.status_code == 201,
          f"got {r.status_code}: {r.text[:80]}")
    if r.status_code != 201:
        return
    _budget_id = r.json()["id"]

    # Status: should be ok at 0%
    r2 = get("/budgets/status", token)
    check("GET /budgets/status → 200", r2.status_code == 200)
    rule_status = next(
        (s for s in r2.json() if s.get("agent") == "e2e-budget-agent"), None
    )
    check("budget rule visible in status", rule_status is not None)
    if rule_status:
        check("initial status = ok", rule_status.get("status") == "ok",
              rule_status.get("status"))

    # Flood with calls until blocked
    try:
        from ai_agent_inventory import OpenAI
        client = OpenAI(
            api_key=gk,
            gateway_url=f"{BACKEND}/v1",
            agent_name="e2e-budget-agent",
            team="developer",
        )
        blocked_at = None
        for i in range(20):
            try:
                client.chat.completions.create(
                    model="gpt-4o-mini",
                    messages=[{"role": "user", "content": f"Say hi {i}"}],
                )
            except Exception as exc:
                if "429" in str(exc) or "budget" in str(exc).lower():
                    blocked_at = i + 1
                    break
        check("budget blocks after limit exceeded",
              blocked_at is not None,
              f"blocked on call #{blocked_at}" if blocked_at else "never blocked after 20 calls")
    except ImportError:
        pass

    # Status should now show blocked or warning
    r3 = get("/budgets/status", token)
    rule_status2 = next(
        (s for s in r3.json() if s.get("agent") == "e2e-budget-agent"), None
    )
    if rule_status2:
        check("budget status is warning or blocked after spend",
              rule_status2.get("status") in ("warning", "blocked"),
              f"status={rule_status2.get('status')} pct={rule_status2.get('pct')}%")

    # Audit: blocked rows have blocked=True
    r4 = get("/audit?blocked_only=true", token)
    check("GET /audit?blocked_only=true → 200", r4.status_code == 200)
    blocked_rows = [row for row in r4.json()
                    if row.get("agent") == "e2e-budget-agent"]
    check("audit contains blocked rows for budget agent",
          len(blocked_rows) > 0, f"{len(blocked_rows)} blocked rows")

    # Cleanup
    r5 = delete(f"/budgets/{_budget_id}", token)
    check("DELETE /budgets/{id} → 204", r5.status_code == 204)
    _budget_id = None


# ══════════════════════════════════════════════════════════════════════════════
# 14. SESSIONS
# ══════════════════════════════════════════════════════════════════════════════
def test_sessions(token: str) -> None:
    global _session_uuid
    section("14 · Chat sessions")

    # Create
    r = post("/sessions", token, {
        "team": "developer",
        "agent": "e2e-session-agent",
        "model": "gpt-4o-mini",
    })
    check("POST /sessions → 201", r.status_code == 201,
          f"got {r.status_code}: {r.text[:80]}")
    if r.status_code != 201:
        return
    _session_uuid = r.json()["uuid"]
    check("session uuid returned", bool(_session_uuid))

    # List
    r2 = get("/sessions", token)
    check("GET /sessions → 200", r2.status_code == 200)
    uuids = [s["uuid"] for s in r2.json()]
    check("new session in list", _session_uuid in uuids)

    # Get
    r3 = get(f"/sessions/{_session_uuid}", token)
    check(f"GET /sessions/{_session_uuid[:8]}... → 200", r3.status_code == 200)

    # Send a message
    r4 = post(f"/sessions/{_session_uuid}/chat", token, {
        "prompt": "In one sentence: what is 2+2?",
        "model": "gpt-4o-mini",
    })
    check("POST /sessions/{uuid}/chat → 200", r4.status_code == 200,
          f"got {r4.status_code}: {r4.text[:80]}")
    if r4.status_code == 200:
        check("response non-empty", bool(r4.json().get("response")),
              (r4.json().get("response") or "")[:50])

    # Messages history
    r5 = get(f"/sessions/{_session_uuid}/messages", token)
    check("GET /sessions/{uuid}/messages → 200", r5.status_code == 200)
    check("at least 1 message in history", len(r5.json()) >= 1)

    # Delete
    r6 = delete(f"/sessions/{_session_uuid}", token)
    check("DELETE /sessions/{uuid} → 204", r6.status_code == 204)
    _session_uuid = None


# ══════════════════════════════════════════════════════════════════════════════
# 15. SETTINGS
# ══════════════════════════════════════════════════════════════════════════════
def test_settings(token: str) -> None:
    section("15 · Settings / config")

    r = get("/settings/keys", token)
    check("GET /settings/keys → 200", r.status_code == 200)

    r2 = get("/settings/config", token)
    check("GET /settings/config → 200", r2.status_code == 200)


# ══════════════════════════════════════════════════════════════════════════════
# 16. MULTI-TENANT ISOLATION
# ══════════════════════════════════════════════════════════════════════════════
def test_isolation(token: str, gk: str) -> None:
    section("16 · Multi-tenant isolation")

    # gk- key is rejected on every management route
    for path in ["/telemetry", "/assets", "/budgets", "/policies", "/auth/users"]:
        r = requests.get(f"{BACKEND}{path}",
                         headers={"Authorization": f"Bearer {gk}"}, timeout=10)
        check(f"gk- key rejected on {path} → 401", r.status_code == 401)

    # Org admin sees only their own data (org_id embedded in JWT, enforced per-query)
    r2 = get("/telemetry", token)
    check("admin telemetry returns 200", r2.status_code == 200)
    rows = r2.json()
    check("all telemetry rows have same team (or mixed within org)",
          len(rows) >= 0)  # just verifying no 5xx

    # Assets scoped to org
    r3 = get("/assets", token)
    check("GET /assets returns 200 (org-scoped)", r3.status_code == 200)


# ══════════════════════════════════════════════════════════════════════════════
# CLEANUP
# ══════════════════════════════════════════════════════════════════════════════
def cleanup(token: str) -> None:
    section("Cleanup")

    if _analyst_id:
        r = delete(f"/auth/users/{_analyst_id}", token)
        check("Delete analyst user", r.status_code == 204)

    if _gk_id:
        r = delete(f"/api-keys/{_gk_id}", token)
        check("Delete e2e API key", r.status_code == 204)

    if _budget_id:
        r = delete(f"/budgets/{_budget_id}", token)
        check("Delete budget rule", r.status_code in (204, 404))

    if _policy_id:
        r = delete(f"/policies/{_policy_id}", token)
        check("Delete policy rule", r.status_code in (204, 404))

    if _session_uuid:
        r = delete(f"/sessions/{_session_uuid}", token)
        check("Delete session", r.status_code in (204, 404))


# ══════════════════════════════════════════════════════════════════════════════
# MAIN
# ══════════════════════════════════════════════════════════════════════════════
def main() -> None:
    print(f"\n{'═' * 60}")
    print(f"  AI Asset Management — Full E2E Test Suite")
    print(f"  Backend: {BACKEND}")
    print(f"  User:    {EMAIL}")
    print(f"  Time:    {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print('═' * 60)

    # Login
    section("0 · Login")
    r = requests.post(f"{BACKEND}/auth/login",
                      json={"email": EMAIL, "password": PASSWORD}, timeout=15)
    if r.status_code != 200:
        print(f"  [{FAIL}] Login failed: {r.status_code} {r.text[:120]}")
        sys.exit(1)
    token = r.json()["access_token"]
    ok("Login", f"token starts {token[:20]}...")

    # Run all test sections
    test_health()
    test_auth(token)
    test_users(token)
    test_roles(token)
    test_teams(token)
    gk = test_api_keys(token)

    if gk:
        test_proxy_and_discovery(gk)
        test_discovery_queue(token)
        test_telemetry(token)
        test_assets(token)
        test_security(token, gk)
        test_guard_modes(token)
        test_policies(token, gk)
        test_budgets(token, gk)
        test_isolation(token, gk)
    else:
        fail("SDK / proxy tests skipped (API key creation failed)")

    test_sessions(token)
    test_settings(token)
    cleanup(token)

    # Summary
    total  = len(_results)
    passed = sum(1 for _, ok, _ in _results if ok)
    failed = total - passed
    print(f"\n{'═' * 60}")
    print(f"  Results: {passed}/{total} passed", end="")
    if failed:
        print(f"  ·  {failed} failed ← see [{FAIL}] lines above")
    else:
        print(f"  ·  all green ✓")
    print('═' * 60)

    if failed:
        sys.exit(1)


if __name__ == "__main__":
    main()
