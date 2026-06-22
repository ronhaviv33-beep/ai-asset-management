# Long-Run Synthetic Customer Test

Simulates **Acme AI Inc.** using the entire AI Asset Management Platform
continuously for up to 8 hours through local backend APIs.  Covers every
major feature: health, auth, org onboarding, users, teams, API keys, LLM
gateway traffic, relationship mapping, agent inventory, telemetry, PII
detection, budgets, policies, audit, security alerts, chat sessions,
dashboard APIs, and multi-tenant isolation.

---

## VS Code local setup

### Prerequisites

- Python 3.11+
- Node.js 18+ (for the frontend, optional for this test)
- `pip install -r requirements.txt` (in the repo root)

Verify the backend requirement:

```bash
pip show httpx       # must be installed
python -c "import httpx; print(httpx.__version__)"
```

---

## How to start the backend

```bash
# Terminal 1 — backend
cd /path/to/ai-asset-management
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Wait until you see `Application startup complete`.

Health check:

```bash
curl http://localhost:8000/health
```

---

## How to start the frontend (optional)

The long-run test calls backend APIs directly and does **not** require the
frontend. However, you can run the dashboard alongside to observe changes in
real time:

```bash
# Terminal 2 — frontend (optional)
cd dashboard
npm install
npm run dev
# Open http://localhost:5173
```

---

## Required environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `PLATFORM_ADMIN_PASSWORD` | **Yes** | — | Password for the platform admin account |
| `BASE_URL` | No | `http://localhost:8000` | Backend base URL |
| `PLATFORM_ADMIN_EMAIL` | No | `admin@ai-asset-mgmt.local` | Platform admin email |
| `ACME_ADMIN_EMAIL` | No | `admin@acme.ai` | Acme org admin email |
| `ACME_ADMIN_PASSWORD` | No | *(empty)* | Acme admin password. When set, the script auto-creates the user if absent |

**bash / zsh:**

```bash
export PLATFORM_ADMIN_PASSWORD="your-admin-password-here"
export ACME_ADMIN_EMAIL="admin@acme.ai"
export ACME_ADMIN_PASSWORD="your-acme-password-here"
export BASE_URL="http://localhost:8000"
```

**PowerShell:**

```powershell
$env:BASE_URL="http://localhost:8000"
$env:PLATFORM_ADMIN_EMAIL="admin@ai-asset-mgmt.local"
$env:PLATFORM_ADMIN_PASSWORD="YOUR_PLATFORM_ADMIN_PASSWORD"
$env:ACME_ADMIN_EMAIL="admin@acme.ai"
$env:ACME_ADMIN_PASSWORD="YOUR_ACME_ADMIN_PASSWORD"

python scripts/long_run_synthetic_customer.py --fast-mode --duration-minutes 10 --skip-live-llm
```

---

## Quick start (dry-run first)

Check that the script can reach the backend without creating anything:

```bash
PLATFORM_ADMIN_PASSWORD='your-password' \
  python scripts/long_run_synthetic_customer.py --dry-run
```

---

## How to run the 10-minute fast test

Use `--fast-mode` to run with shortened intervals and a 10-minute default
duration.  Combined with `--skip-live-llm` the test runs without any LLM
provider credentials — all proxy calls are recorded as "blocked (upstream
error)" in telemetry, which is sufficient to exercise the enforcement
pipeline, relationship mapping, and agent discovery.

```bash
# Terminal 3 — test runner (bash / zsh)
cd /path/to/ai-asset-management

PLATFORM_ADMIN_PASSWORD='your-password' \
ACME_ADMIN_EMAIL='admin@acme.ai' \
ACME_ADMIN_PASSWORD='your-acme-password' \
  python scripts/long_run_synthetic_customer.py \
  --fast-mode \
  --skip-live-llm
```

Override the duration while keeping fast intervals:

```bash
PLATFORM_ADMIN_PASSWORD='your-password' \
ACME_ADMIN_PASSWORD='your-acme-password' \
  python scripts/long_run_synthetic_customer.py \
  --fast-mode \
  --duration-minutes 2 \
  --skip-live-llm
```

---

## How to run the full 8-hour test

```bash
PLATFORM_ADMIN_PASSWORD=your-password \
  python scripts/long_run_synthetic_customer.py \
  --duration-hours 8 \
  --skip-live-llm
```

With real LLM provider credentials configured in the platform:

```bash
PLATFORM_ADMIN_PASSWORD=your-password \
  python scripts/long_run_synthetic_customer.py \
  --duration-hours 8
```

---

## CLI reference

```
usage: long_run_synthetic_customer.py [-h]
  [--duration-hours HOURS | --duration-minutes MINUTES]
  [--base-url URL]
  [--admin-email EMAIL]
  [--admin-password PASSWORD]
  [--acme-admin-email EMAIL]
  [--acme-admin-email EMAIL]
  [--acme-admin-password PASSWORD]
  [--concurrency N]
  [--strict]
  [--strict-live]
  [--skip-live-llm]
  [--include-rate-limit]
  [--fast-mode]
  [--dry-run]
```

| Flag | Description |
|---|---|
| `--duration-hours N` | Run for N hours (default 8) |
| `--duration-minutes N` | Run for N minutes (overrides hours) |
| `--base-url URL` | Backend base URL (default `http://localhost:8000`) |
| `--admin-email EMAIL` | Platform admin email (default `admin@ai-asset-mgmt.local`) |
| `--acme-admin-email EMAIL` | Acme org admin email (default `admin@acme.ai`) |
| `--acme-admin-password PW` | Acme admin password; auto-creates user if absent when set |
| `--concurrency N` | Concurrent traffic workers (default 3) |
| `--strict` | Treat endpoint-not-found (404) as a failure |
| `--strict-live` | Fail if provider credentials are missing |
| `--skip-live-llm` | Accept 502/503 from proxy (no provider creds needed) |
| `--include-rate-limit` | Run rate-limit burst test after main loop |
| `--fast-mode` | Short intervals; default 10-min duration |
| `--dry-run` | Check health then exit without creating resources |

---

## Synthetic organisation

| Entity | Value |
|---|---|
| Organisation | Acme AI Inc. |
| Teams | Support, Sales, Security, Operations, Research |
| Users | admin, analyst, viewer |
| Agents | support-triage-agent, sales-enrichment-agent, security-investigation-agent, ops-automation-agent, research-agent, cost-burner-agent, chaos-agent |
| Isolation tenant | OtherCo AI |

---

## What the test covers

1. **Health checks** — `/health`, `/api/health`
2. **Auth** — platform admin login, Acme admin login, `/auth/me`
3. **Org onboarding** — create Acme AI Inc. (idempotent)
4. **Users** — create analyst, viewer; verify user list
5. **Teams / roles** — verify default roles; register teams
6. **API keys** — create one key per team; keep raw keys in memory only
7. **Settings** — set `pii_redaction_mode=findings_only`; guard mode `observe`
8. **Provider credentials** — check status; run mock/skip if missing
9. **Runtime traffic** — 7 agent profiles with relationship headers; 3 concurrent workers
10. **Relationship mapping** — validate every 5 min; check graph nodes/edges
11. **Agent inventory** — validate every 5 min; check team attribution, `last_seen_at`
12. **Telemetry** — validate every 5 min; check totals increase, costs, latency
13. **PII scenario** — fake PII every 30 min; verify findings; verify redaction
14. **Budgets** — create cost-burner budget; validate status updates
15. **Policies** — create blocked-model policy; verify 403 in enforce mode
16. **Audit** — validate every 10 min; check blocked/sensitive events
17. **Security alerts** — validate every 10 min; verify shape
18. **Sessions / chat** — create, read, verify, close every 20 min
19. **Dashboard APIs** — read all dashboard endpoints every 10 min
20. **Multi-tenant isolation** — verify Acme cannot see OtherCo data

---

## How to read the logs

### JSONL event log

Each line is a JSON object with a `ts` timestamp and `event` type.

```bash
# Stream events during the run
tail -f logs/long_run/*_events.jsonl

# Count events by type
cat logs/long_run/*_events.jsonl | python3 -c "
import sys, json, collections
counts = collections.Counter(json.loads(l)['event'] for l in sys.stdin)
for k, v in sorted(counts.items()):
    print(f'{v:5d}  {k}')
"

# Show failures
cat logs/long_run/*_events.jsonl | python3 -c "
import sys, json
for l in sys.stdin:
    e = json.loads(l)
    if e.get('result') in ('fail', 'FAIL') or e.get('http', 200) not in (200, 201, 204, 404):
        print(e)
"
```

### JSON final report

```bash
cat logs/long_run/*_report.json | python3 -m json.tool
```

Key fields:

| Field | Meaning |
|---|---|
| `total_requests` | All proxy calls made |
| `success_rate_pct` | Percentage of 200 + acceptable-502/503 |
| `agents_discovered` | Agents visible in `/agents` at last check |
| `relationships_discovered` | Relationships in `/relationships` at last check |
| `cost_estimate_usd` | Sum of `x_guard.cost_usd` from 200 responses |
| `checks.*.passed/total` | Per-feature check pass rate |

---

## Common failures and meanings

### `Connection refused` / HTTP 0

The backend is not running.  Start it with:

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### `Platform admin login failed`

`PLATFORM_ADMIN_PASSWORD` is wrong or the admin account was not seeded.
Check the server startup logs for the seeded password, or set
`ADMIN_SEED_PASSWORD` in your `.env` and restart the server.

### `Org 'Acme AI Inc.' already exists — looking up id`

Normal on re-runs. The script finds the existing org and continues.

### `API key create failed: HTTP 403`

The Acme admin account does not have `apikeys` page access.  Ensure the
`admin` role includes `apikeys` in its pages list.

### Traffic: HTTP 502 / 503

No LLM provider credentials are configured.  Expected when using
`--skip-live-llm`.  Use `POST /provider-credentials` via the dashboard to
add a real key, or configure `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` in
`.env`.

### `validate_relationships: count=0`

Agents have not yet sent traffic with relationship headers, or the
`/relationships` endpoint is not yet populated.  Wait for more traffic
cycles, or increase concurrency with `--concurrency 5`.

### `ISOLATION VIOLATION: OtherCo agent visible in Acme telemetry!`

Multi-tenant isolation is broken.  This is a critical bug — every telemetry
query must filter by `organization_id`.

### Policy enforce test: no 403

The Security team guard mode was not set to `enforce` in time, or the
policy enforcement pipeline returned a different status.  Check the audit
log for the blocked request's `block_reason`.

---

## Example commands

```bash
# Terminal 1 — backend
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

# Terminal 2 — frontend (optional)
cd dashboard && npm run dev

# Terminal 3 — fast 2-minute smoke test
PLATFORM_ADMIN_PASSWORD=Admin123! \
  python scripts/long_run_synthetic_customer.py \
  --fast-mode --duration-minutes 2 --skip-live-llm

# Terminal 3 — full 8-hour run
PLATFORM_ADMIN_PASSWORD=Admin123! \
  python scripts/long_run_synthetic_customer.py \
  --duration-hours 8 --skip-live-llm

# With live LLM + strict mode
PLATFORM_ADMIN_PASSWORD=Admin123! \
  python scripts/long_run_synthetic_customer.py \
  --duration-hours 8 --strict --strict-live

# With rate-limit test and higher concurrency
PLATFORM_ADMIN_PASSWORD=Admin123! \
  python scripts/long_run_synthetic_customer.py \
  --fast-mode --duration-minutes 15 --skip-live-llm \
  --concurrency 5 --include-rate-limit
```
