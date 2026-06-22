# AI Asset Management

**The AI Agent System of Record — discover every agent, map every dependency, assign ownership, understand risk, and govern AI operations.**

> We don't only discover AI agents. We map what they touch.

AI Agent Inventory tells you which agents exist, who owns them, and what risk they carry. Runtime Dependency Map tells you what they interact with at runtime. Together, they become the system of record for enterprise AI operations. Optional sensitive-content checks can be enabled for customers that want additional runtime safety signals.

---

## The Integration

```python
# Before
client = openai.OpenAI(api_key="sk-...")

# After — one line change, full governance
client = openai.OpenAI(
    base_url="https://your-guard-instance/v1",
    api_key="<jwt>",
)
```

Works with OpenAI SDK, Anthropic SDK, LangChain, Node.js, and any HTTP client. No agent code changes beyond `base_url`.

---

## Architecture

```
Agent / SDK  (OpenAI · Anthropic · LangChain · curl)
      │  base_url = https://your-guard/v1
      ▼
POST /v1/chat/completions  (OpenAI-compatible)
POST /v1/messages          (Anthropic-compatible)
      │
      ├─ JWT or opaque Bearer auth
      ├─ Optional runtime safety check (sensitive content, opt-in per org)
      ├─ Model policy check         (allowlist / blocklist per team)
      ├─ Budget enforcement         (daily / monthly per team + agent)
      ├─ Relationship capture       (X-MCP-* / X-Agent-* / X-Workflow-* headers)
      ├─ Real upstream SSE streaming + disconnect detection
      └─ Telemetry saved to SQLite
                   │
           React Dashboard
  (Agent Inventory · Runtime Dependency Map · Cost Intelligence ·
   Security Intelligence · Governance · Discovery · Ecosystem ·
   Pricing Registry · Budgets · Audit · Users · Settings · Chat)
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| API | FastAPI + Uvicorn |
| ORM / DB | SQLAlchemy + SQLite |
| Auth | HS256 JWT (pure Python) |
| LLM clients | OpenAI SDK (multi-provider via compatible endpoints) |
| Encryption | Fernet (per-org provider credential storage) |
| Frontend | React 19 + Vite 8 + Tailwind CSS 4 + Recharts |
| Deploy | Render (backend web service + persistent disk + static frontend) |

---

## Features

### Gateway
- **OpenAI-compatible proxy** — `POST /v1/chat/completions` accepts any OpenAI SDK call
- **Anthropic-compatible proxy** — `POST /v1/messages` accepts any Anthropic SDK call
- **Real streaming** — SSE chunks relayed as they arrive from the upstream provider; client disconnect stops the upstream call immediately (no wasted tokens)
- **Full body passthrough** — `tool_calls`, `temperature`, `response_format`, `seed`, and every other parameter forwarded unchanged
- **Opaque Bearer auth** — accepts dashboard JWT *or* any arbitrary token (`sk-...`); no agent code changes required
- **Fail mode** — `GATEWAY_FAIL_MODE=closed` (default) blocks on errors; `open` passes through. Policy/budget blocks always propagate.
- **Provider routing** by model name prefix: `claude-*` → Anthropic, `gemini-*` → Google, `llama-*` → Local/Ollama, everything else → OpenAI
- **Bring Your Own Key (BYOK)** — per-org provider credentials stored encrypted (Fernet); used in place of server-level env vars when present

### Enforcement Pipeline (every call)
1. **Safety check** — model policy enforcement; blocked calls return HTTP 403 and are logged. Optional sensitive-content scan (10 pattern types) can be enabled per org.
2. **Budget check** — per-team and per-agent daily/monthly limits; `action=alert` warns, `action=block` returns HTTP 429
3. **LLM call** — forwarded to the real provider
4. **Telemetry** — tokens, cost (versioned per-model pricing), latency, team, agent, and findings all persisted
5. **Relationship capture** — non-fatal; extracts runtime dependencies from headers and upserts into `agent_relationships`

### Auth & Users
- JWT login (`POST /auth/login`) with 8-hour expiry
- Role-based access: **admin** / **analyst** / **viewer**
- Admin user seeded automatically on first start
- User CRUD with inline role/team editing
- Settings page: live API key management (reads/writes `.env` without restart)

### AI Agent Inventory
- **Two-tier discovery**: *Verified* agents (seen in gateway traffic, confidence 95%) vs *Potential* agents (platform signals, confidence 30–70%)
- **Stable identity**: `asset_key = sha256(org_id + ":" + agent_id_raw)` — survives restarts and renames
- **Governance lifecycle**: `unassigned → managed → retired`; claim, retire, and annotate agents from the UI
- **CMDB model**: immutable `telemetry` table (runtime facts) + mutable `asset_registry` (governance layer)
- Filter by team, environment, discovery status, and confidence tier

### Runtime Dependency Map
The second pillar of the system of record — maps what every AI agent touches at runtime.

- **Header-based detection** — reads `X-Agent-Name`, `X-MCP-Server`, `X-MCP-Tool`, `X-Agent-Workflow`, `X-Agent-Target`, and `X-Workflow-*` headers on every proxied call
- **Target types**: `mcp_tool`, `mcp_server`, `workflow`, `api`, `database`, `crm`, `spreadsheet`, `unknown`
- **Relationship types**: `calls`, `uses_tool`, `invokes_workflow`, `triggers`, `writes_to`, `reads_from`, `sends_event_to`
- **Upsert with telemetry**: each rediscovery increments `request_count`, updates `last_seen_at`, and takes the max `confidence_score`
- **Metadata safety**: never stores raw prompt or response content; only header-derived facts
- **SDK support**: `build_headers()` accepts `mcp_server`, `mcp_tool`, `workflow_provider`, `workflow_name`, `parent_agent`, `target`, `tool`, `relation`
- `GET /relationships` — filterable list (source agent, target type, relationship type)
- `GET /relationships/graph` — nodes + edges for graph visualisation

**Add relationship headers to any agent call:**
```python
extra_headers={
    "X-Agent-Name":   "sales-enrichment-agent",
    "X-MCP-Server":   "hubspot-mcp",
    "X-MCP-Tool":     "create_lead",
    "X-Agent-Relation": "uses_tool",
}
```

### Cost Intelligence
Three-layer financial analysis:
1. **Runtime estimate** — token counts × versioned pricing from the Pricing Registry
2. **Provider billed** — import actual invoices (API / manual / CSV); stored in `provider_billing`
3. **Reconciliation** — variance analysis per period per provider; healthy < 2%, warning 2–5%, investigate > 5%

- Cost breakdown by agent, team, model, environment, or provider
- Daily cost trend charts (Recharts)
- Per-agent cost detail: monthly, lifetime, models used, cost signals

### Pricing Registry
- **Versioned, immutable rows** — prices are never updated; each change inserts a new version with `effective_from` / `effective_to` timestamps
- **Org-specific overrides** — `organization_id = NULL` = global default; non-null = org override that shadows the global row
- **Background sync daemon** — compares built-in price table against DB every 3600 s; creates new versions on drift
- **Historical cost accuracy** — `get_active_pricing(as_of=timestamp)` returns the price that was active at any past datetime, enabling cost replay
- **Admin UI** — view all prices, filter by provider, see version history per model, apply overrides with mandatory audit reason
- **Freshness warnings** — amber > 24 h, red > 48 h since last sync
- 24 models seeded on first start across OpenAI, Anthropic, Google, and Local

### AI Operational Risk & Compliance
- **Operational risk center** — monitor unmanaged assets, high-capability agents, policy violations, budget anomalies, and unusual runtime behavior
- 8 automated detection rules (cost spike, large prompt, workflow failure spike, premium model misuse, after-hours activity, agent loop, unapproved model, sensitive content)
- Each alert includes root cause analysis and recommended remediation
- Full audit log — expandable rows with prompt, response, block reason, and findings; load-more pagination
- Optional sensitive-content checks — can be enabled per org for customers that want additional runtime safety signals
- TLS via reverse proxy, HS256 JWT, secrets never returned via API, all data stays in your deployment

---

## Dashboard Pages

| Page | Who can see it |
|---|---|
| Home | Everyone |
| Overview, Agents, Models, Workflows, Alerts | Everyone |
| Agent Inventory | Everyone |
| Runtime Dependency Map | Everyone |
| Cost Intelligence | Everyone |
| Security (operational risk + alerts) | Everyone |
| Security (policy rules + audit log) | Admin only |
| Pricing Registry | Admin only |
| Budgets, Users, Settings | Admin only |
| Integrations | Admin + Analyst |
| Chat | Admin + Analyst |

- **Sortable columns** on every table — click any header to toggle asc/desc
- **Free-text search** on every table — instant filter across all columns, shows match count
- **Live mode** (real API data) / **Demo mode** (synthetic events) — switches automatically

---

## Quick Start

### Prerequisites
- Python 3.12+
- Node.js 18+

### Backend

```bash
git clone https://github.com/ronhaviv33-beep/ai-asset-management.git
cd ai-asset-management

python -m venv venv
source venv/bin/activate          # Mac/Linux
venv\Scripts\Activate.ps1         # Windows PowerShell

pip install -r requirements.txt

cp .env.example .env              # then fill in your API keys

uvicorn app.main:app
# API + Swagger UI → http://localhost:8000/docs
```

### Frontend

```bash
cd dashboard
npm install
npm run dev
# Dashboard → http://localhost:5173
```

### `.env` reference

```env
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_API_KEY=AIza...
LOCAL_LLM_URL=http://localhost:11434/v1   # Ollama / vLLM / LM Studio
JWT_SECRET=change-me-in-production        # long random string
GATEWAY_FAIL_MODE=closed                  # closed | open
CREDENTIAL_ENCRYPTION_KEY=               # Fernet key for BYOK credential storage
```

### Seed demo data

```bash
python scripts/seed_demo_data.py
```

Populates the database with demo organizations, users, agents, and telemetry records.

---

## Data Model

| Table | Purpose |
|---|---|
| `organizations` | Multi-tenant org registry |
| `users` | Auth accounts; role (admin / analyst / viewer) |
| `roles` | Custom role definitions per org; page + capability ACLs |
| `api_keys` | Machine-to-machine auth; stored as SHA-256 hash |
| `provider_credentials` | Encrypted per-org LLM keys (Fernet / BYOK) |
| `telemetry` | Immutable proxy call records — tokens, cost, latency, agent identity, policy findings |
| `asset_registry` | Governance layer for AI agents; lifecycle, owner, criticality |
| `agent_relationships` | Runtime dependency map — what each agent calls, uses, or writes to |
| `teams` | Auto-registering soft team registry |
| `guard_modes` | Per-team governance mode (observe / alert / enforce) |
| `policy_rules` | Model allowlist / blocklist per team |
| `budget_rules` | Spend limits (daily / monthly, alert / block) |
| `chat_sessions` | Multi-turn session metadata |
| `chat_session_messages` | Session message history with security findings |
| `model_pricing` | Versioned pricing registry; immutable rows, org overrides |
| `pricing_change_log` | Audit trail for all pricing changes |
| `provider_billing` | Actual provider invoices imported for reconciliation |
| `cost_reconciliation` | Variance analysis between runtime estimates and billed amounts |

---

## API Reference

### OpenAI-compatible proxy

```python
import openai

client = openai.OpenAI(
    base_url="http://localhost:8000/v1",
    api_key="<jwt from POST /auth/login>",
)

response = client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[{"role": "user", "content": "Hello"}],
    extra_headers={
        "X-Guard-Team":     "SOC",
        "X-Guard-Agent":    "my-agent",
        # Relationship mapping (optional)
        "X-MCP-Server":     "hubspot-mcp",
        "X-MCP-Tool":       "create_lead",
        "X-Agent-Relation": "uses_tool",
    },
)
print(response.choices[0].message.content)
```

### Anthropic-compatible proxy

```python
import anthropic

client = anthropic.Anthropic(
    base_url="http://localhost:8000",
    api_key="<jwt>",
    default_headers={
        "X-Guard-Team":  "SOC",
        "X-Guard-Agent": "my-agent",
    },
)

message = client.messages.create(
    model="claude-haiku-4-5",
    max_tokens=1024,
    messages=[{"role": "user", "content": "Hello"}],
)
print(message.content[0].text)
```

### Attribution headers

| Header | Purpose |
|---|---|
| `X-Guard-Team` | Maps the call to a team for policy + budget enforcement |
| `X-Guard-Agent` | Identifies the agent/workflow in telemetry and audit log |
| `X-Agent-Name` | Primary agent identity for relationship mapping |
| `X-MCP-Server` | MCP server the agent is connecting to |
| `X-MCP-Tool` | Specific MCP tool being invoked |
| `X-Agent-Workflow` | Workflow being triggered |
| `X-Agent-Target` | Generic target system (API, database, CRM, etc.) |
| `X-Agent-Relation` | Explicit relationship type override |
| `X-Workflow-Provider` | Workflow platform (zapier, n8n, etc.) |
| `X-Workflow-Name` | Workflow name within the platform |

### Key endpoints

```http
POST /auth/login                          # { email, password } → { access_token, user }
POST /ask                                 # Single-shot LLM request with enforcement pipeline
POST /chat                                # Multi-turn with enforcement pipeline
GET  /telemetry                           # Paginated request log
GET  /telemetry/summary                   # Totals: requests, tokens, cost, latency
GET  /audit                               # Filtered audit log (team, agent, sensitive, blocked)
GET  /security/alerts                     # Live detection rule results
POST /budgets                             # Create budget rule
GET  /budgets/status                      # Live spend vs limit per rule
POST /policies                            # Create model allow/block rule
GET  /agents                              # Agent inventory (verified + potential)
GET  /agents/summary                      # Discovery stats
GET  /relationships                       # Runtime dependency map (filterable)
GET  /relationships/graph                 # Dependency graph — nodes + edges
GET  /cost-intelligence                   # Cost overview, breakdown, trends
POST /billing/{provider}/import           # Import provider invoice
GET  /pricing-registry                    # All pricing records (org overrides merged)
POST /pricing-registry/override           # Apply org-specific price override (admin)
POST /pricing-registry/sync              # Trigger immediate pricing sync (admin)
GET  /settings/keys                       # API key status (never exposes values)
```

Full interactive docs at `http://localhost:8000/docs`.

---

## Deploy to Render

The repo includes a `render.yaml` Blueprint. Connect your GitHub repo in Render → **New** → **Blueprint** → select the repo.

Render will:
1. Create the backend web service with a 1 GB persistent disk for SQLite
2. Build the frontend, injecting the backend URL at build time via `VITE_API_URL`
3. Deploy both services with security headers and SPA routing configured

After first deploy, set `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, and/or `GOOGLE_API_KEY` in the Render dashboard (or via the Settings page in the UI).

---

## Supported Models

| Provider | Models |
|---|---|
| OpenAI | `gpt-4.1`, `gpt-4.1-mini`, `gpt-4o`, `gpt-4o-mini`, `gpt-4-turbo`, `o3`, `o4-mini` |
| Anthropic | `claude-opus-4-8`, `claude-sonnet-4-6`, `claude-haiku-4-5` |
| Google | `gemini-2.5-pro`, `gemini-2.0-flash`, `gemini-1.5-pro` |
| Local | `llama-3.1-70b-local`, `llama-3.1-8b-local` (Ollama / vLLM / LM Studio) |

Pricing for all models is seeded into the Pricing Registry on first start and kept in sync by the background daemon.

---

## Roadmap

| Status | Item |
|---|---|
| ✅ | OpenAI-compatible proxy (`/v1/chat/completions`) with real streaming |
| ✅ | Anthropic-compatible proxy (`/v1/messages`) with real streaming |
| ✅ | JWT auth + RBAC (admin / analyst / viewer) |
| ✅ | Safety checks — sensitive-content scan (10 pattern types, opt-in per org) |
| ✅ | Budget enforcement (daily / monthly, alert / block) |
| ✅ | Model policy (allowlist / blocklist per team) |
| ✅ | Full audit log with expandable rows + pagination |
| ✅ | Bring Your Own Key (BYOK) — per-org encrypted provider credentials |
| ✅ | AI Agent Inventory — two-tier discovery (verified / potential), CMDB governance |
| ✅ | Runtime Dependency Map — header-based relationship capture, graph API, dashboard page |
| ✅ | Cost Intelligence — three-layer analysis (runtime / billed / reconciliation) |
| ✅ | Pricing Registry — versioned, org-scoped, background sync, history |
| ✅ | Sortable + searchable tables on every dashboard page |
| ✅ | Render deployment (`render.yaml` Blueprint) |
| 🔜 | Per-tenant API key table (issue org keys, not user JWTs) |
| 🔜 | Budget alerts via webhook (Slack / Teams at 80%) |
| 🔜 | Cost forecasting (end-of-month projection from burn rate) |
| 🔜 | MCP payload parsing for richer relationship evidence |
| 🔜 | SSO (Okta / Google OAuth) |
| 🔜 | HA / fail-over story for enterprise SLA conversations |

---

## Author

**Ron Haviv**  
SOC Analyst · Security Operations · AI Runtime Intelligence

---

*Discover every AI agent. Map every dependency. Govern every AI interaction.*
