import os, time, random, schedule
from openai import OpenAI

# ── Config ─────────────────────────────────────────────────────────────────────
GATEWAY_URL  = "https://aifinops-backend.onrender.com/v1"
API_KEY      = "gk-PkdKHCmt9F6SiLrI9rruHkTCBK-dz8n7SGelbl2zqMQ"
TEAM         = "Developer"
RUN_HOURS    = 8                          # ← change this to run longer/shorter

START_TIME   = time.time()
END_TIME     = START_TIME + RUN_HOURS * 3600

client = OpenAI(api_key=API_KEY, base_url=GATEWAY_URL)

# ── Helper ─────────────────────────────────────────────────────────────────────
def call(agent, model, prompt, label="task"):
    print(f"[{time.strftime('%H:%M:%S')}] {label} | agent={agent} model={model}")
    try:
        resp = client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": prompt}],
            extra_headers={"X-Guard-Team": TEAM, "X-Guard-Agent": agent},
        )
        tokens = resp.usage.total_tokens
        print(f"  ✓ {tokens} tokens | {resp.choices[0].message.content[:80]}...")
        return tokens
    except Exception as e:
        print(f"  ✗ {e}")
        return 0

def time_left():
    remaining = END_TIME - time.time()
    h, m = divmod(int(remaining), 3600)
    m //= 60
    return f"{h}h {m}m remaining"

# ── Tasks ──────────────────────────────────────────────────────────────────────
TASKS = [
    ("finance-analysis",  "gpt-4o-mini",      "Summarize the key risks in AI spending for a SaaS company in 3 bullet points."),
    ("code-review",       "gpt-4o-mini",      "Review this Python snippet and suggest improvements: def add(a,b): return a+b"),
    ("report-generation", "gpt-4o-mini",      "Write a 2-sentence executive summary for a Q2 cost optimization report."),
    ("data-extraction",   "gpt-4o-mini",      "Extract the key metrics from: 'Revenue was $2.3M, costs $1.1M, headcount 42.'"),
    ("policy-check",      "gpt-4o-mini",      "What are best practices for managing LLM API costs in a multi-team org?"),
    ("claude-analyst",    "claude-haiku-4-5", "In 3 bullet points, what are the top risks of unmonitored AI agents in enterprise?"),
    ("claude-writer",     "claude-haiku-4-5", "Write a 2-sentence summary: why do companies need an AI usage audit trail?"),
    ("claude-advisor",    "claude-haiku-4-5", "What KPIs should a FinOps team track for LLM cost management?"),
    ("claude-reviewer",   "claude-haiku-4-5", "Review this code for security issues: token = request.headers.get('token')"),
]

def run_normal_task():
    name, model, prompt = random.choice(TASKS)
    call(name, model, prompt, label=f"normal  [{time_left()}]")

def run_pii_task():
    call("pii-tester", "gpt-4o-mini",
         "My SSN is 123-45-6789, can you help me fill out this form?",
         label=f"PII  [{time_left()}]")
    call("pii-tester", "claude-haiku-4-5",
         "Process this payment: card 4111-1111-1111-1111 exp 12/26 CVV 123",
         label=f"PII-card  [{time_left()}]")

def run_loop_simulation():
    print(f"\n[{time.strftime('%H:%M:%S')}] ⚠ Loop simulation  [{time_left()}]")
    loop_prompts = [
        "Is this task done? Check status.",
        "Retry: is the report ready?",
        "Still waiting — check again.",
        "Poll: has the data been processed?",
        "Verify completion of previous step.",
        "Re-check: did the last action succeed?",
        "Loop iteration: confirm state.",
        "Agent heartbeat: still running?",
    ]
    for i, prompt in enumerate(loop_prompts):
        call("runaway-agent", "gpt-4o-mini", prompt, label=f"loop-{i+1}")
        time.sleep(2)
    print(f"  → Done. Check Alerts page.\n")

def run_cost_spike():
    print(f"\n[{time.strftime('%H:%M:%S')}] ⚠ Cost spike  [{time_left()}]")
    for prompt in [
        "Write a detailed 5-paragraph technical report on LLM cost optimization strategies.",
        "Analyze this dataset and produce a full risk assessment with recommendations.",
        "Generate a complete financial model for AI infrastructure ROI over 3 years.",
    ]:
        call("cost-spike-agent", "gpt-4o", prompt, label="spike")
        time.sleep(3)

def run_unapproved_model():
    call("shadow-agent", "gpt-4o",
         "Summarize AI governance best practices.",
         label=f"unapproved  [{time_left()}]")

# ── Schedule ───────────────────────────────────────────────────────────────────
schedule.every(3).minutes.do(run_normal_task)
schedule.every(20).minutes.do(run_pii_task)
schedule.every(30).minutes.do(run_loop_simulation)
schedule.every(45).minutes.do(run_cost_spike)
schedule.every(25).minutes.do(run_unapproved_model)

# ── Main loop ──────────────────────────────────────────────────────────────────
print("=" * 60)
print(f"  AIFinOps Guard — test agent")
print(f"  Team:    {TEAM}")
print(f"  Started: {time.strftime('%Y-%m-%d %H:%M:%S')}")
print(f"  Stops:   {time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(END_TIME))}")
print(f"  Runtime: {RUN_HOURS}h")
print("=" * 60)

# Fire one of each immediately
run_normal_task()
time.sleep(5)
run_pii_task()
time.sleep(5)
run_loop_simulation()

while time.time() < END_TIME:
    schedule.run_pending()
    time.sleep(10)

print("\n" + "=" * 60)
print(f"  ✓ {RUN_HOURS}h run complete — {time.strftime('%H:%M:%S')}")
print(f"  Check the dashboard for the full telemetry.")
print("=" * 60)
