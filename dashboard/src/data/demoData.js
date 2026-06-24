// Static metadata and demo data generation for AI asset management

export const ORGS = [
  { id: "org_001", name: "Northwind Labs" },
  { id: "org_002", name: "Helix Financial" },
  { id: "org_003", name: "Atlas Logistics" },
];
export const TEAMS = [
  { id: "team_01", org: "org_001", name: "Platform AI" },
  { id: "team_02", org: "org_001", name: "Customer Support" },
  { id: "team_03", org: "org_002", name: "Risk Analytics" },
  { id: "team_04", org: "org_002", name: "Trading Research" },
  { id: "team_05", org: "org_003", name: "Route Optimization" },
];
export const AGENTS = [
  { id: "ag_01", name: "support-triage-v2",  team: "team_02", workflow: "wf_01", tool: "zendesk_api" },
  { id: "ag_02", name: "doc-summarizer",      team: "team_01", workflow: "wf_02", tool: "notion_api" },
  { id: "ag_03", name: "code-reviewer",       team: "team_01", workflow: "wf_03", tool: "github_api" },
  { id: "ag_04", name: "risk-classifier",     team: "team_03", workflow: "wf_04", tool: "internal_db" },
  { id: "ag_05", name: "trade-narrator",      team: "team_04", workflow: "wf_05", tool: "bloomberg_api" },
  { id: "ag_06", name: "route-planner",       team: "team_05", workflow: "wf_06", tool: "maps_api" },
  { id: "ag_07", name: "invoice-extractor",   team: "team_03", workflow: "wf_07", tool: "ocr_service" },
  { id: "ag_08", name: "kb-rag-search",       team: "team_02", workflow: "wf_08", tool: "vector_db" },
  { id: "ag_09", name: "research-deepdive",   team: "team_04", workflow: "wf_09", tool: "web_search" },
  { id: "ag_10", name: "qa-test-generator",   team: "team_01", workflow: "wf_10", tool: "github_api" },
];
export const MODELS = [
  // Anthropic
  { name: "claude-opus-4-5",      provider: "Anthropic", cost1k_in: 0.015,    cost1k_out: 0.075,   tier: "premium", approved: true  },
  { name: "claude-sonnet-4-5",    provider: "Anthropic", cost1k_in: 0.003,    cost1k_out: 0.015,   tier: "mid",     approved: true  },
  { name: "claude-haiku-4-5",     provider: "Anthropic", cost1k_in: 0.0008,   cost1k_out: 0.004,   tier: "cheap",   approved: true  },
  // OpenAI
  { name: "gpt-4.1",              provider: "OpenAI",    cost1k_in: 0.002,    cost1k_out: 0.008,   tier: "premium", approved: true  },
  { name: "gpt-4.1-mini",         provider: "OpenAI",    cost1k_in: 0.0004,   cost1k_out: 0.0016,  tier: "mid",     approved: true  },
  { name: "gpt-4o",               provider: "OpenAI",    cost1k_in: 0.0025,   cost1k_out: 0.01,    tier: "mid",     approved: true  },
  { name: "gpt-4o-mini",          provider: "OpenAI",    cost1k_in: 0.00015,  cost1k_out: 0.0006,  tier: "cheap",   approved: true  },
  { name: "gpt-4-turbo",          provider: "OpenAI",    cost1k_in: 0.01,     cost1k_out: 0.03,    tier: "premium", approved: true  },
  { name: "o3",                   provider: "OpenAI",    cost1k_in: 0.01,     cost1k_out: 0.04,    tier: "premium", approved: true  },
  { name: "o4-mini",              provider: "OpenAI",    cost1k_in: 0.0011,   cost1k_out: 0.0044,  tier: "mid",     approved: true  },
  // Google
  { name: "gemini-2.5-pro",       provider: "Google",    cost1k_in: 0.00125,  cost1k_out: 0.01,    tier: "premium", approved: false },
  { name: "gemini-2.0-flash",     provider: "Google",    cost1k_in: 0.000075, cost1k_out: 0.0003,  tier: "cheap",   approved: false },
  { name: "gemini-1.5-pro",       provider: "Google",    cost1k_in: 0.00125,  cost1k_out: 0.005,   tier: "mid",     approved: false },
  // Local / open-source
  { name: "llama-3.1-70b-local",  provider: "Local",     cost1k_in: 0.0002,   cost1k_out: 0.0002,  tier: "cheap",   approved: true  },
  { name: "llama-3.1-8b-local",   provider: "Local",     cost1k_in: 0.00005,  cost1k_out: 0.00005, tier: "cheap",   approved: true  },
];

// SQLite returns naive UTC strings without Z; append it so the browser parses as UTC
export const parseUTC = (s) => new Date(typeof s === "string" && !s.endsWith("Z") && !s.includes("+") ? s + "Z" : s);

export function providerFromModel(name = "") {
  if (name.startsWith("claude"))  return "Anthropic";
  if (name.startsWith("gpt") || name.startsWith("o3") || name.startsWith("o4")) return "OpenAI";
  if (name.startsWith("gemini")) return "Google";
  if (name.includes("local") || name.includes("llama")) return "Local";
  return "Unknown";
}

export function tierFromModel(name = "") {
  const m = MODELS.find((x) => x.name === name);
  if (m) return m.tier;
  if (name.includes("opus") || name.includes("4.1") || name.includes("turbo") || name === "o3") return "premium";
  if (name.includes("mini") || name.includes("haiku") || name.includes("flash") || name.includes("local") || name.includes("llama")) return "cheap";
  return "mid";
}

export function approvedModel(name = "") {
  const m = MODELS.find((x) => x.name === name);
  return m ? m.approved : true;
}

export function apiRecordToEvent(r) {
  const ts = parseUTC(r.timestamp).getTime();
  const hour = new Date(ts).getHours();
  const afterHours = hour < 7 || hour > 20;
  const teamId   = `live_team_${r.team.replace(/\s+/g, "_").toLowerCase()}`;
  const agentId  = `live_ag_${r.agent.replace(/\s+/g, "_").toLowerCase()}`;
  const workflow = `live_wf_${r.agent.replace(/\s+/g, "_").toLowerCase()}`;
  return {
    ts, org: "org_live", team: teamId, agent: agentId, workflow,
    tool: "openai_api", model: r.model, provider: providerFromModel(r.model),
    tokens_in: r.prompt_tokens, tokens_out: r.completion_tokens, tokens_total: r.total_tokens,
    cost: r.cost_usd, pricing_estimated: r.pricing_estimated ?? false,
    latency: r.latency_ms, status: "success", error: null, afterHours,
    sensitive: r.sensitive ?? false, _liveTeam: r.team, _liveAgent: r.agent,
  };
}

export function buildLiveMetadata(apiRecords) {
  const teamMap = {}, agentMap = {};
  for (const r of apiRecords) {
    const teamId  = `live_team_${r.team.replace(/\s+/g, "_").toLowerCase()}`;
    const agentId = `live_ag_${r.agent.replace(/\s+/g, "_").toLowerCase()}`;
    if (!teamMap[teamId])   teamMap[teamId]   = { id: teamId, org: "org_live", name: r.team };
    if (!agentMap[agentId]) agentMap[agentId] = { id: agentId, name: r.agent, team: teamId, workflow: `live_wf_${r.agent.replace(/\s+/g, "_").toLowerCase()}`, tool: "openai_api" };
  }
  return { liveOrg: { id: "org_live", name: "Live (AI Asset Management)" }, liveTeams: Object.values(teamMap), liveAgents: Object.values(agentMap) };
}

function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng  = mulberry32(42);
const pick = (arr) => arr[Math.floor(rng() * arr.length)];

export function genDemoEvents() {
  const events = [];
  const now = Date.now();
  const DAY = 86400000;
  for (let i = 0; i < 6000; i++) {
    const ageDays = rng() * 30;
    const ts      = now - ageDays * DAY - rng() * DAY;
    const agent   = pick(AGENTS);
    const team    = TEAMS.find((t) => t.id === agent.team);
    const model   = pick(MODELS);
    const hour    = new Date(ts).getHours();
    const afterHours = hour < 7 || hour > 20;
    const baseIn  = Math.floor(200 + Math.pow(rng(), 3) * 8000);
    const baseOut = Math.floor(150 + Math.pow(rng(), 2.5) * 2000);
    const cost    = (baseIn / 1000) * model.cost1k_in + (baseOut / 1000) * model.cost1k_out;
    const failed  = rng() < 0.04;
    const latency = failed ? 200 + rng() * 400 : 400 + rng() * 1800 + (model.tier === "premium" ? 500 : 0);
    const sensitive = rng() < 0.015;
    events.push({ ts, org: team.org, team: team.id, agent: agent.id, workflow: agent.workflow, tool: agent.tool, model: model.name, provider: model.provider, tokens_in: baseIn, tokens_out: baseOut, tokens_total: baseIn + baseOut, cost, latency, status: failed ? "failed" : "success", error: failed ? pick(["rate_limit", "timeout", "tool_error", "content_filter"]) : null, afterHours, sensitive });
  }
  for (let i = 0; i < 40; i++) events.push({ ts: now - DAY - rng() * DAY * 0.5, org: "org_002", team: "team_04", agent: "ag_05", workflow: "wf_05", tool: "bloomberg_api", model: "claude-opus-4", provider: "Anthropic", tokens_in: 4000 + Math.floor(rng() * 3000), tokens_out: 1500 + Math.floor(rng() * 1000), tokens_total: 6000, cost: 0.35 + rng() * 0.2, latency: 2200 + rng() * 1500, status: "success", error: null, afterHours: false, sensitive: false });
  for (let i = 0; i < 12; i++) events.push({ ts: now - rng() * DAY * 5, org: "org_002", team: "team_04", agent: "ag_09", workflow: "wf_09", tool: "web_search", model: "claude-opus-4", provider: "Anthropic", tokens_in: 45000 + Math.floor(rng() * 30000), tokens_out: 3000, tokens_total: 75000, cost: 0.9 + rng() * 0.5, latency: 8000 + rng() * 4000, status: "success", error: null, afterHours: false, sensitive: false });
  for (let i = 0; i < 25; i++) events.push({ ts: now - DAY * 2 - rng() * DAY, org: "org_001", team: "team_01", agent: "ag_10", workflow: "wf_10", tool: "github_api", model: "gpt-4.1", provider: "OpenAI", tokens_in: 1200, tokens_out: 0, tokens_total: 1200, cost: 0.012, latency: 320, status: "failed", error: "tool_error", afterHours: false, sensitive: false });
  for (let i = 0; i < 30; i++) { const ts = now - rng() * DAY * 7; const d = new Date(ts); d.setHours(3, Math.floor(rng() * 60), 0); events.push({ ts: d.getTime(), org: "org_003", team: "team_05", agent: "ag_06", workflow: "wf_06", tool: "maps_api", model: "gpt-4.1", provider: "OpenAI", tokens_in: 1800, tokens_out: 800, tokens_total: 2600, cost: 0.042, latency: 1400, status: "success", error: null, afterHours: true, sensitive: false }); }
  for (let i = 0; i < 60; i++) events.push({ ts: now - DAY * 0.5 - rng() * 1000 * 60 * 30, org: "org_002", team: "team_03", agent: "ag_07", workflow: "wf_07", tool: "ocr_service", model: "claude-sonnet-4", provider: "Anthropic", tokens_in: 900, tokens_out: 300, tokens_total: 1200, cost: 0.0072, latency: 850, status: "success", error: null, afterHours: false, sensitive: true });
  for (let i = 0; i < 18; i++) events.push({ ts: now - rng() * DAY * 10, org: "org_001", team: "team_02", agent: "ag_08", workflow: "wf_08", tool: "vector_db", model: "gemini-2.0-pro", provider: "Google", tokens_in: 1500, tokens_out: 600, tokens_total: 2100, cost: 0.005, latency: 920, status: "success", error: null, afterHours: false, sensitive: false });
  return events.sort((a, b) => b.ts - a.ts);
}
