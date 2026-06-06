# AIFinOps Guard

**AI Runtime Intelligence Platform — inline governance, cost control, and security for every LLM call in your organisation.**

> Closer to Cloudflare or Okta for AI traffic than to a dashboard tool. Every agent call flows *through* it — PII scanned, budget enforced, policy checked, fully audited — before it reaches the model.

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
      ├─ PII / sensitive data scan  (10 pattern types)
      ├─ Model policy check         (allowlist / blocklist per team)
      ├─ Budget enforcement         (daily / monthly per team + agent)
      ├─ Real upstream SSE streaming + disconnect detection
      └─ Telemetry saved to SQLite
                   │
           React Dashboard
  (Overview · Cost · Agents · Models · Workflows ·
   Alerts · Budgets · Security · Audit · Users ·
   Settings · Integrations · Chat)
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| API | FastAPI + Uvicorn |
| ORM / DB | SQLAlchemy + SQLite |
| Auth | HS256 JWT (pure Python) |
| LLM clients | OpenAI SDK (multi-provider via compatible endpoints) |
| Frontend | React 18 + Vite + Recharts |
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

### Enforcement Pipeline (every call)
1. **PII scan** — emails, phone numbers, credit cards, SSNs, API keys, passwords, AWS keys, private keys, JWT tokens, IP addresses
2. **Model policy** — per-team allowlist / blocklist; blocked calls return HTTP 403 and are logged
3. **Budget check** — per-team and per-agent daily/monthly limits; `action=alert` warns, `action=block` returns HTTP 429
4. **LLM call** — forwarded to the real provider
5. **Telemetry** — tokens, cost (correct per-model pricing for 15+ models), latency, team, agent, PII findings all persisted

### Auth & Users
- JWT login (`POST /auth/login`) with 8-hour expiry
- Role-based access: **admin** / **analyst** / **viewer**
- Admin seeds automatically on first start: `admin@aifinops.local` / `Admin123!`
- User CRUD with inline role/team editing
- Settings page: live API key management (reads/writes `.env` without restart)

### Dashboard Pages

| Page | Who can see it |
|---|---|
| Home | Everyone |
| Overview, Cost, Agents, Models, Workflows, Alerts | Everyone |
| Security (alerts + PII scanner) | Everyone |
| Security (policy rules + audit log) | Admin only |
| Budgets, Users, Settings | Admin only |
| Integrations | Admin + Analyst |
| Chat | Admin + Analyst |

- **Sortable columns** on every table — click any header to toggle asc/desc
- **Free-text search** on every table — instant filter across all columns, shows match count
- **Audit log** — expandable rows with full prompt, response, block reason, PII findings; load-more pagination
- **Live mode** (real API data) / **Demo mode** (6,000 synthetic events) — switches automatically

### Security & Compliance
- 8 automated detection rules (cost spike, large prompt, workflow failure spike, premium model misuse, after-hours activity, agent loop, unapproved model, sensitive data)
- Each alert includes root cause analysis and recommended remediation
- Security posture: TLS (via reverse proxy), HS256 JWT, secrets never returned via API, full audit trail, all data stays in your deployment
- SOC 2: pre-certification — audit log, RBAC, and secrets isolation in place

---

## Quick Start

### Prerequisites
- Python 3.12+
- Node.js 18+

### Backend

```bash
git clone https://github.com/ronhaviv33-beep/aifinops-guard.git
cd aifinops-guard

python -m venv venv
source venv/bin/activate          # Mac/Linux
venv\Scripts\Activate.ps1         # Windows PowerShell

pip install -r requirements.txt

cp .env.example .env              # then fill in your API keys

# Install the pre-commit hook (blocks commits if isolation/structural checks fail)
cp tests/pre-commit-hook .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit
# Or run the harnesses manually at any time:
# make verify

uvicorn app.main:app
# API + Swagger UI → http://localhost:8000/docs
```

### Frontend

```bash
cd dashboard
npm install
npm run dev
# Dashboard → http://localhost:5173
# Login: admin@aifinops.local / Admin123!
```

### `.env` reference

```env
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_API_KEY=AIza...
LOCAL_LLM_URL=http://localhost:11434/v1   # Ollama / vLLM / LM Studio
JWT_SECRET=change-me-in-production        # long random string
GATEWAY_FAIL_MODE=closed                  # closed | open
```

---

## API Reference

### OpenAI-compatible proxy

```python
import openai

client = openai.OpenAI(
    base_url="http://localhost:8000/v1",
    api_key="<jwt from POST /auth/login>",
)

# Non-streaming
response = client.chat.completions.create(
    model="gpt-4o-mini",   # or "claude-sonnet-4-5", "gemini-2.0-flash", etc.
    messages=[{"role": "user", "content": "Hello"}],
    extra_headers={"X-Guard-Team": "SOC", "X-Guard-Agent": "my-agent"},
)
print(response.choices[0].message.content)
# response.x_guard → {"team", "agent", "cost_usd", "latency_ms", "security_findings", ...}

# Streaming
stream = client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[{"role": "user", "content": "Hello"}],
    stream=True,
    extra_headers={"X-Guard-Team": "SOC", "X-Guard-Agent": "my-agent"},
)
for chunk in stream:
    print(chunk.choices[0].delta.content or "", end="")
```

### Anthropic-compatible proxy

```python
import anthropic

client = anthropic.Anthropic(
    base_url="http://localhost:8000",
    api_key="<jwt>",
    default_headers={"X-Guard-Team": "SOC", "X-Guard-Agent": "my-agent"},
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

### Other endpoints

```http
POST /auth/login          # { email, password } → { access_token, user }
POST /ask                 # single-shot with full enforcement pipeline
POST /chat                # multi-turn with full enforcement pipeline
GET  /telemetry           # paginated request log
GET  /telemetry/summary   # totals: requests, tokens, cost, latency
GET  /audit               # filtered audit log (team, agent, sensitive, blocked)
GET  /security/alerts     # live detection rule results
POST /budgets             # create budget rule
GET  /budgets/status      # live spend vs limit per rule
POST /policies            # create model allow/block rule
GET  /settings/keys       # API key status (never exposes values)
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
| Anthropic | `claude-opus-4-5`, `claude-sonnet-4-5`, `claude-haiku-4-5` |
| Google | `gemini-2.5-pro`, `gemini-2.0-flash`, `gemini-1.5-pro` |
| Local | `llama-3.1-70b-local`, `llama-3.1-8b-local` (Ollama / vLLM / LM Studio) |

---

## Roadmap

| Status | Item |
|---|---|
| ✅ | OpenAI-compatible proxy (`/v1/chat/completions`) with real streaming |
| ✅ | Anthropic-compatible proxy (`/v1/messages`) with real streaming |
| ✅ | JWT auth + RBAC (admin / analyst / viewer) |
| ✅ | PII scanning (10 pattern types) |
| ✅ | Budget enforcement (daily / monthly, alert / block) |
| ✅ | Model policy (allowlist / blocklist per team) |
| ✅ | Full audit log with expandable rows + pagination |
| ✅ | Sortable + searchable tables on every dashboard page |
| ✅ | Render deployment (`render.yaml` Blueprint) |
| 🔜 | Per-tenant API key table (issue org keys, not user JWTs) |
| 🔜 | Budget alerts via webhook (Slack / Teams at 80%) |
| 🔜 | Cost forecasting (end-of-month projection from burn rate) |
| 🔜 | SSO (Okta / Google OAuth) |
| 🔜 | HA / fail-over story for enterprise SLA conversations |

---

## Author

**Ron Haviv**  
SOC Analyst · Security Operations · AI Runtime Intelligence
