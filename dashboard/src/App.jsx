import React, { useState, useMemo, useEffect, useCallback, useRef, createContext, useContext } from "react";
import { login as apiLogin, fetchMe, fetchUsers, createUser, updateUser, deleteUser, getToken, setToken, authFetch, fetchKeyStatuses, updateKey, BASE, fetchApiKeys, createApiKey, revokeApiKey, deleteApiKey, fetchGuardModes, setGuardMode, fetchHealth, fetchProviderCredentials, upsertProviderCredential, deleteProviderCredential } from "./api.js";
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  PieChart, Pie, Cell,
} from "recharts";

// ─── Design tokens ────────────────────────────────────────────────────────────
const T = {
  bg: "#0A0B0F", panel: "#0F1117", panelHi: "#141823",
  border: "#1E2230", borderHi: "#2A3142",
  text: "#E8ECF4", textDim: "#7A8499", textMute: "#4B5468",
  accent: "#7CFFB2", accentDim: "#3A7A5C",
  warn: "#FFB547", crit: "#FF5C7A", info: "#6FA8FF", purple: "#B47AFF",
};
const FONT_UI   = "'Geist','Söhne',-apple-system,BlinkMacSystemFont,sans-serif";
const FONT_MONO = "'JetBrains Mono','IBM Plex Mono',ui-monospace,SFMono-Regular,monospace";

// ─── Static metadata (used for display names & governance rules) ──────────────
const ORGS = [
  { id: "org_001", name: "Northwind Labs" },
  { id: "org_002", name: "Helix Financial" },
  { id: "org_003", name: "Atlas Logistics" },
];
const TEAMS = [
  { id: "team_01", org: "org_001", name: "Platform AI" },
  { id: "team_02", org: "org_001", name: "Customer Support" },
  { id: "team_03", org: "org_002", name: "Risk Analytics" },
  { id: "team_04", org: "org_002", name: "Trading Research" },
  { id: "team_05", org: "org_003", name: "Route Optimization" },
];
const AGENTS = [
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
const MODELS = [
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

// ─── Provider / model lookup helpers ─────────────────────────────────────────
function providerFromModel(name = "") {
  if (name.startsWith("claude"))  return "Anthropic";
  if (name.startsWith("gpt") || name.startsWith("o3") || name.startsWith("o4")) return "OpenAI";
  if (name.startsWith("gemini")) return "Google";
  if (name.includes("local") || name.includes("llama")) return "Local";
  return "Unknown";
}

function tierFromModel(name = "") {
  const m = MODELS.find((x) => x.name === name);
  if (m) return m.tier;
  if (name.includes("opus") || name.includes("4.1") || name.includes("turbo") || name === "o3") return "premium";
  if (name.includes("mini") || name.includes("haiku") || name.includes("flash") || name.includes("local") || name.includes("llama")) return "cheap";
  return "mid";
}

function approvedModel(name = "") {
  const m = MODELS.find((x) => x.name === name);
  return m ? m.approved : true; // unknown models default to approved
}

// ─── Transform real API records → internal event shape ───────────────────────
function apiRecordToEvent(r, idx) {
  const ts = new Date(r.timestamp).getTime();
  const hour = new Date(ts).getHours();
  const afterHours = hour < 7 || hour > 20;

  // Map free-text team/agent names to stable IDs (or create synthetic ones)
  const teamId   = `live_team_${r.team.replace(/\s+/g, "_").toLowerCase()}`;
  const agentId  = `live_ag_${r.agent.replace(/\s+/g, "_").toLowerCase()}`;
  const workflow = `live_wf_${r.agent.replace(/\s+/g, "_").toLowerCase()}`;

  return {
    ts,
    org: "org_live",
    team: teamId,
    agent: agentId,
    workflow,
    tool: "openai_api",
    model: r.model,
    provider: providerFromModel(r.model),
    tokens_in:    r.prompt_tokens,
    tokens_out:   r.completion_tokens,
    tokens_total: r.total_tokens,
    cost:         r.cost_usd,
    latency:      r.latency_ms,
    status:       "success",
    error:        null,
    afterHours,
    sensitive:    false,
    _liveTeam:  r.team,
    _liveAgent: r.agent,
  };
}

// Build synthetic TEAMS / AGENTS from live records so lookups work
function buildLiveMetadata(apiRecords) {
  const teamMap  = {};
  const agentMap = {};
  for (const r of apiRecords) {
    const teamId  = `live_team_${r.team.replace(/\s+/g, "_").toLowerCase()}`;
    const agentId = `live_ag_${r.agent.replace(/\s+/g, "_").toLowerCase()}`;
    if (!teamMap[teamId])  teamMap[teamId]  = { id: teamId,  org: "org_live", name: r.team };
    if (!agentMap[agentId]) agentMap[agentId] = { id: agentId, name: r.agent, team: teamId, workflow: `live_wf_${r.agent.replace(/\s+/g, "_").toLowerCase()}`, tool: "openai_api" };
  }
  const liveOrg   = { id: "org_live", name: "Live (AIFinOps Guard)" };
  return { liveOrg, liveTeams: Object.values(teamMap), liveAgents: Object.values(agentMap) };
}

// ─── Demo data generator (fallback when API is empty) ────────────────────────
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

function genDemoEvents() {
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
  // Anomaly injections
  for (let i = 0; i < 40; i++) events.push({ ts: now - DAY - rng() * DAY * 0.5, org: "org_002", team: "team_04", agent: "ag_05", workflow: "wf_05", tool: "bloomberg_api", model: "claude-opus-4", provider: "Anthropic", tokens_in: 4000 + Math.floor(rng() * 3000), tokens_out: 1500 + Math.floor(rng() * 1000), tokens_total: 6000, cost: 0.35 + rng() * 0.2, latency: 2200 + rng() * 1500, status: "success", error: null, afterHours: false, sensitive: false });
  for (let i = 0; i < 12; i++) events.push({ ts: now - rng() * DAY * 5, org: "org_002", team: "team_04", agent: "ag_09", workflow: "wf_09", tool: "web_search", model: "claude-opus-4", provider: "Anthropic", tokens_in: 45000 + Math.floor(rng() * 30000), tokens_out: 3000, tokens_total: 75000, cost: 0.9 + rng() * 0.5, latency: 8000 + rng() * 4000, status: "success", error: null, afterHours: false, sensitive: false });
  for (let i = 0; i < 25; i++) events.push({ ts: now - DAY * 2 - rng() * DAY, org: "org_001", team: "team_01", agent: "ag_10", workflow: "wf_10", tool: "github_api", model: "gpt-4.1", provider: "OpenAI", tokens_in: 1200, tokens_out: 0, tokens_total: 1200, cost: 0.012, latency: 320, status: "failed", error: "tool_error", afterHours: false, sensitive: false });
  for (let i = 0; i < 30; i++) { const ts = now - rng() * DAY * 7; const d = new Date(ts); d.setHours(3, Math.floor(rng() * 60), 0); events.push({ ts: d.getTime(), org: "org_003", team: "team_05", agent: "ag_06", workflow: "wf_06", tool: "maps_api", model: "gpt-4.1", provider: "OpenAI", tokens_in: 1800, tokens_out: 800, tokens_total: 2600, cost: 0.042, latency: 1400, status: "success", error: null, afterHours: true, sensitive: false }); }
  for (let i = 0; i < 60; i++) events.push({ ts: now - DAY * 0.5 - rng() * 1000 * 60 * 30, org: "org_002", team: "team_03", agent: "ag_07", workflow: "wf_07", tool: "ocr_service", model: "claude-sonnet-4", provider: "Anthropic", tokens_in: 900, tokens_out: 300, tokens_total: 1200, cost: 0.0072, latency: 850, status: "success", error: null, afterHours: false, sensitive: true });
  for (let i = 0; i < 18; i++) events.push({ ts: now - rng() * DAY * 10, org: "org_001", team: "team_02", agent: "ag_08", workflow: "wf_08", tool: "vector_db", model: "gemini-2.0-pro", provider: "Google", tokens_in: 1500, tokens_out: 600, tokens_total: 2100, cost: 0.005, latency: 920, status: "success", error: null, afterHours: false, sensitive: false });
  return events.sort((a, b) => b.ts - a.ts);
}

// ─── Live data hook ───────────────────────────────────────────────────────────
function useLiveData(intervalMs = 30_000) {
  const [apiRecords, setApiRecords] = useState(null); // null = loading, [] = empty
  const [lastRefresh, setLastRefresh] = useState(null);
  const [isLive, setIsLive] = useState(false);

  const load = useCallback(async () => {
    if (!getToken()) { setApiRecords([]); return; }
    try {
      const r = await authFetch(`${BASE}/telemetry?limit=1000`);
      if (!r || !r.ok) throw new Error("API error");
      const data = await r.json();
      setApiRecords(data);
      setIsLive(data.length > 0);
      setLastRefresh(new Date());
    } catch {
      setApiRecords([]); // fall back to demo
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, intervalMs);
    return () => clearInterval(id);
  }, [load, intervalMs]);

  return { apiRecords, lastRefresh, isLive, refresh: load };
}

// ─── Filter / aggregation helpers ────────────────────────────────────────────
function applyFilters(events, f) {
  const cutoff = Date.now() - f.range * 86400000;
  return events.filter((e) => {
    if (e.ts < cutoff) return false;
    if (f.team  !== "all" && e.team  !== f.team)  return false;
    if (f.model !== "all" && e.model !== f.model)  return false;
    if (f.agent !== "all" && e.agent !== f.agent)  return false;
    return true;
  });
}

// ─── Alert metadata ───────────────────────────────────────────────────────────
const ALERT_META = {
  agent_cost_spike:         { title: "Agent cost spike detected",           category: "Cost Anomaly",                 checks: "Compares an agent's spend in the current 24h window against its trailing 7-day daily average. Fires when today exceeds 2× that baseline.", matters: "A sudden cost jump usually means an agent is doing far more work than usual — often from a prompt change, a retry loop, or an upstream input that ballooned in size.", causes: ["Prompt template change that inflated context size", "Tool-call retry loop with no termination", "Upstream data source returning much larger payloads", "New high-volume workload without a budget guardrail"], detail: (a) => `${a.entity} is the affected agent. ${a.msg}. At this rate it is on track to consume a disproportionate share of its team's budget.` },
  high_token_prompt:        { title: "Unusually large prompt",              category: "Cost Optimization",            checks: "Flags any single request whose total token count exceeds 30,000 tokens.", matters: "Token cost scales linearly with size. Very large prompts are frequently caused by stuffing entire documents into context when only a fraction is relevant.", causes: ["Full-document context with no retrieval or chunking", "Unbounded conversation history replayed each turn", "Retrieved chunks not deduplicated or truncated", "Verbose system prompts duplicated across calls"], detail: (a) => `The request from ${a.entity} carried ${a.msg.split(" ")[0]} — well above threshold. Adding retrieval truncation typically cuts this by 60–80%.` },
  failed_workflow_spike:    { title: "Workflow failure rate elevated",       category: "Reliability Risk",             checks: "Tracks the failure ratio per workflow over a rolling 48h window. Fires when rate exceeds 25% with meaningful call volume.", matters: "High failure rates mean users aren't getting results and you're still paying for failed attempts.", causes: ["Upstream tool or API outage / rate limiting", "Expired or rotated auth credentials", "Breaking change in a tool's response schema", "Timeout thresholds too aggressive for the model"], detail: (a) => `Workflow ${a.entity} ${a.msg.toLowerCase()}. Each failed run still incurs partial token cost.` },
  expensive_model_usage:    { title: "Premium model used on trivial prompts", category: "Cost Optimization",          checks: "Counts calls to a premium-tier model where total prompt was under 200 tokens — work a mid-tier model handles at a fraction of the cost.", matters: "Premium models cost 5–10× more per token. Short, simple prompts rarely benefit from the extra capability.", causes: ["Single default model hardcoded for all routes", "No model-routing tier based on task complexity", "Premium model chosen 'to be safe' without measuring need"], detail: (a) => `${a.msg}. Confirm these calls don't require premium reasoning before routing them down.` },
  unusual_after_hours_usage: { title: "After-hours activity spike",          category: "Security Signal",              checks: "Counts requests outside business hours (before 07:00 or after 20:00) over the last 7 days.", matters: "Off-hours bursts can be a legitimate batch job — or an early indicator of a leaked API key or unauthorized access.", causes: ["Undocumented scheduled batch job", "Leaked or shared API credential being used externally", "Retry loop that only triggers under low-traffic conditions"], detail: (a) => `${a.entity} logged ${a.msg.toLowerCase()}. If this batch window is expected, suppress the rule; if not, rotate the key.` },
  repeated_agent_loop:      { title: "Agent stuck in a loop",               category: "Reliability Risk",             checks: "Buckets each agent's calls into 30-min windows. Fires when any window exceeds 40 calls from the same agent.", matters: "A looping agent burns tokens continuously with no useful output — one of the fastest ways to run up an unexpected bill.", causes: ["Tool-call retry with no max-attempts cap", "Missing or unreachable termination condition", "Agent re-planning indefinitely on an unsolvable step"], detail: (a) => `${a.entity} produced ${a.msg.toLowerCase()}. Add a hard call cap and termination check before re-enabling.` },
  unapproved_model_usage:   { title: "Unapproved model in use",             category: "Governance Violation",         checks: "Flags any request routed to a model not on the organization's approved allowlist.", matters: "Unapproved models may not meet data-residency, security, or contractual requirements.", causes: ["Developer testing a new provider in production", "Missing enforcement at the model gateway", "SDK default that bypassed the allowlist"], detail: (a) => `${a.msg}. Either add to the allowlist through governance review, or block at the gateway.` },
  sensitive_data_exposure:  { title: "Sensitive data in AI requests",        category: "Security Risk",                checks: "Inspects request payloads for patterns matching PII or financial data.", matters: "Sending sensitive data to an external model can breach privacy regulations and contractual obligations.", causes: ["No PII redaction layer in front of the model call", "Raw documents passed through without scrubbing", "User input not sanitized before being added to context"], detail: (a) => `${a.entity} triggered this: ${a.msg.toLowerCase()}. Enable a redaction/DLP policy on this workflow immediately.` },
};

// ─── Detection engine ─────────────────────────────────────────────────────────
function runDetections(events) {
  const alerts = [];
  const DAY = 86400000;
  const now = Date.now();
  const byAgentToday = {}, byAgent7d = {};
  events.forEach((e) => {
    const age = now - e.ts;
    if (age < DAY)             byAgentToday[e.agent] = (byAgentToday[e.agent] || 0) + e.cost;
    if (age >= DAY && age < 8 * DAY) byAgent7d[e.agent]  = (byAgent7d[e.agent]  || 0) + e.cost;
  });
  // Cost spike: 7-day comparison OR high absolute spend today (> $0.05)
  Object.keys(byAgentToday).forEach((a) => {
    const today = byAgentToday[a]; const avg7 = (byAgent7d[a] || 0) / 7;
    const spike = (avg7 > 0.01 && today > 2 * avg7) || (avg7 === 0 && today > 0.05);
    if (spike) alerts.push({ type: "agent_cost_spike", sev: "critical", entity: a, msg: `Agent cost $${today.toFixed(4)} today vs $${avg7.toFixed(4)} 7-day avg`, action: "Inspect prompt construction and tool-call loops", ts: now - 720_000 });
  });
  events.filter((e) => e.tokens_total > 30000).slice(0, 5).forEach((e) => alerts.push({ type: "high_token_prompt", sev: "warning", entity: e.agent, msg: `${e.tokens_total.toLocaleString()} tokens in single request (${e.model})`, action: "Add context compaction or retrieval truncation", ts: e.ts }));
  const wfFails = {}, wfTotal = {};
  events.filter((e) => now - e.ts < 2 * DAY).forEach((e) => { wfTotal[e.workflow] = (wfTotal[e.workflow] || 0) + 1; if (e.status === "failed") wfFails[e.workflow] = (wfFails[e.workflow] || 0) + 1; });
  Object.keys(wfTotal).forEach((w) => { const rate = (wfFails[w] || 0) / wfTotal[w]; if (rate > 0.25 && wfTotal[w] > 10) alerts.push({ type: "failed_workflow_spike", sev: "critical", entity: w, msg: `${(rate * 100).toFixed(0)}% failure rate over last 48h`, action: "Check upstream tool availability and auth tokens", ts: now - 2_700_000 }); });
  const cheapCandidates = events.filter((e) => tierFromModel(e.model) === "premium" && e.tokens_total < 200);
  if (cheapCandidates.length > 5) alerts.push({ type: "expensive_model_usage", sev: "warning", entity: cheapCandidates[0].agent, msg: `${cheapCandidates.length} premium-model calls under 200 tokens`, action: "Route short prompts to gpt-4o-mini or claude-sonnet", ts: now - 5_400_000 });
  const afterHoursAgents = {};
  events.filter((e) => now - e.ts < 7 * DAY && e.afterHours).forEach((e) => { afterHoursAgents[e.agent] = (afterHoursAgents[e.agent] || 0) + 1; });
  Object.keys(afterHoursAgents).forEach((a) => { if (afterHoursAgents[a] > 5) alerts.push({ type: "unusual_after_hours_usage", sev: "info", entity: a, msg: `${afterHoursAgents[a]} calls outside 07:00–20:00 in last 7d`, action: "Confirm batch job is intentional; otherwise rotate keys", ts: now - 10_800_000 }); });
  // Loop detection: >5 calls from same agent in any 30-min window (was 40 — unreachable in practice)
  const buckets = {};
  events.forEach((e) => { const k = `${e.agent}:${Math.floor(e.ts / 1_800_000)}`; buckets[k] = (buckets[k] || 0) + 1; });
  const flagged = new Set();
  Object.entries(buckets).forEach(([k, v]) => { const [agent] = k.split(":"); if (v > 5 && !flagged.has(agent)) { flagged.add(agent); alerts.push({ type: "repeated_agent_loop", sev: "critical", entity: agent, msg: `${v} calls in a single 30-min window`, action: "Check for tool-call retry loop or missing termination", ts: now - 1_200_000 }); } });
  const unapproved = events.filter((e) => !approvedModel(e.model));
  if (unapproved.length > 0) alerts.push({ type: "unapproved_model_usage", sev: "warning", entity: unapproved[0].agent, msg: `${unapproved.length} calls to non-allowlisted model "${unapproved[0].model}"`, action: "Block at gateway or request governance approval", ts: now - 14_400_000 });
  const sensitive = events.filter((e) => e.sensitive);
  if (sensitive.length > 0) alerts.push({ type: "sensitive_data_exposure", sev: "critical", entity: sensitive[0].agent, msg: `${sensitive.length} requests flagged with sensitive payload patterns`, action: "Enable PII redaction policy on this workflow", ts: now - 7_200_000 });
  return alerts.sort((a, b) => { const o = { critical: 0, warning: 1, info: 2 }; return o[a.sev] - o[b.sev] || b.ts - a.ts; });
}

// ─── Aggregation ──────────────────────────────────────────────────────────────
function agg(events) {
  const now = Date.now();
  const today = events.filter((e) => now - e.ts < 86400000);
  const costByTeam = {}, costByAgent = {}, costByModel = {}, tokensByModel = {}, latencyByModel = {}, failsByWorkflow = {}, callsByWorkflow = {};
  events.forEach((e) => {
    costByTeam[e.team]   = (costByTeam[e.team]   || 0) + e.cost;
    costByAgent[e.agent] = (costByAgent[e.agent] || 0) + e.cost;
    costByModel[e.model] = (costByModel[e.model] || 0) + e.cost;
    tokensByModel[e.model] = (tokensByModel[e.model] || 0) + e.tokens_total;
    if (!latencyByModel[e.model]) latencyByModel[e.model] = [];
    latencyByModel[e.model].push(e.latency);
    callsByWorkflow[e.workflow] = (callsByWorkflow[e.workflow] || 0) + 1;
    if (e.status === "failed") failsByWorkflow[e.workflow] = (failsByWorkflow[e.workflow] || 0) + 1;
  });
  const buckets = {};
  events.forEach((e) => { const d = new Date(e.ts); d.setHours(0,0,0,0); const k = d.getTime(); if (!buckets[k]) buckets[k] = { date: k, tokens: 0, cost: 0, calls: 0 }; buckets[k].tokens += e.tokens_total; buckets[k].cost += e.cost; buckets[k].calls += 1; });
  const series = Object.values(buckets).sort((a, b) => a.date - b.date);
  return {
    today: { cost: today.reduce((s,e)=>s+e.cost,0), tokens: today.reduce((s,e)=>s+e.tokens_total,0), activeAgents: new Set(today.map((e)=>e.agent)).size, avgLatency: today.length>0 ? today.reduce((s,e)=>s+e.latency,0)/today.length : 0, failed: today.filter((e)=>e.status==="failed").length },
    total: { cost: events.reduce((s,e)=>s+e.cost,0), tokens: events.reduce((s,e)=>s+e.tokens_total,0) },
    costByTeam, costByAgent, costByModel, tokensByModel, latencyByModel, failsByWorkflow, callsByWorkflow, series,
  };
}

function estimateSavings(events) {
  const premShort = events.filter((e) => tierFromModel(e.model) === "premium" && e.tokens_total < 500);
  const premium   = premShort.reduce((s,e)=>s+e.cost*0.7, 0);
  const buckets   = {};
  events.forEach((e) => { const k = `${e.agent}:${Math.floor(e.ts/1_800_000)}`; if (!buckets[k]) buckets[k]=[]; buckets[k].push(e); });
  let loops = 0;
  Object.values(buckets).forEach((b) => { if (b.length>40) { loops += b.slice(40).reduce((s,e)=>s+e.cost,0)*0.6; } });
  const failed  = events.filter((e)=>e.status==="failed").reduce((s,e)=>s+e.cost, 0);
  const latency = events.filter((e)=>e.latency>3000).reduce((s,e)=>s+e.cost*0.1, 0);
  return { premium, loops, failed, latency, total: premium+loops+failed+latency };
}

function computeRiskScore(events, alerts) {
  let score = 0; const factors = [];
  const f1 = Math.min(alerts.filter((a)=>a.type==="agent_cost_spike").length*8,20); score+=f1; factors.push({ label:"Cost anomalies", value:f1, max:20, raw:alerts.filter((a)=>a.type==="agent_cost_spike").length });
  const failRate = events.length>0 ? events.filter((e)=>e.status==="failed").length/events.length : 0;
  const f2 = Math.min(Math.round(failRate*200),15); score+=f2; factors.push({ label:"Workflow failures", value:f2, max:15, raw:`${(failRate*100).toFixed(1)}%` });
  const unapp = events.filter((e)=>!approvedModel(e.model)).length;
  const f3 = Math.min(Math.round(unapp/5),15); score+=f3; factors.push({ label:"Unapproved models", value:f3, max:15, raw:unapp });
  const ah = events.filter((e)=>e.afterHours).length;
  const f4 = Math.min(Math.round(ah/30),10); score+=f4; factors.push({ label:"After-hours activity", value:f4, max:10, raw:ah });
  const sens = events.filter((e)=>e.sensitive).length;
  const f5 = Math.min(sens,25); score+=f5; factors.push({ label:"Sensitive data exposure", value:f5, max:25, raw:sens });
  const loopAlerts = alerts.filter((a)=>a.type==="repeated_agent_loop").length;
  const f6 = Math.min(loopAlerts*10,15); score+=f6; factors.push({ label:"Looping agents", value:f6, max:15, raw:loopAlerts });
  return { score:Math.min(score,100), factors };
}

function execSummary(A, savings, risk, alerts) {
  const crit   = alerts.filter((a)=>a.sev==="critical").length;
  const topAgent= Object.entries(A.costByAgent).sort((a,b)=>b[1]-a[1])[0];
  const topModel= Object.entries(A.costByModel).sort((a,b)=>b[1]-a[1])[0];
  return {
    what: `Across the selected window, AI runtime spend reached $${A.total.cost.toFixed(2)} with ${crit} critical alert${crit===1?"":"s"} firing. The top cost driver is ${topAgent?.[0]||"—"} on ${topModel?.[0]||"—"}.`,
    why:  `Roughly $${savings.total.toFixed(2)} of spend appears recoverable — primarily from premium-model calls on short prompts, agent loops, and failed workflows. The runtime risk score is ${risk.score}/100${risk.score>50?", which is above the recommended threshold":""}.`,
    next: crit>0 ? `Address the ${crit} critical alert${crit===1?"":"s"} first. Then route short premium-model prompts to a mid-tier alternative to capture estimated savings.` : `Continue monitoring. Consider routing short prompts on premium models to a mid-tier alternative to capture estimated savings.`,
  };
}

// ─── Shared UI primitives ─────────────────────────────────────────────────────
const Card = ({ children, style, title, subtitle, right }) => (
  <div style={{ background:T.panel, border:`1px solid ${T.border}`, borderRadius:6, padding:18, ...style }}>
    {(title||right) && (
      <div style={{ display:"flex", alignItems:"baseline", justifyContent:"space-between", marginBottom:14 }}>
        <div>
          {title    && <div style={{ fontSize:11, letterSpacing:"0.12em", textTransform:"uppercase", color:T.textDim, fontFamily:FONT_MONO, fontWeight:500 }}>{title}</div>}
          {subtitle && <div style={{ fontSize:13, color:T.textMute, marginTop:4 }}>{subtitle}</div>}
        </div>
        {right}
      </div>
    )}
    {children}
  </div>
);

const Stat = ({ label, value, delta, suffix, accent }) => (
  <Card>
    <div style={{ fontSize:10, letterSpacing:"0.14em", textTransform:"uppercase", color:T.textDim, fontFamily:FONT_MONO }}>{label}</div>
    <div style={{ fontSize:28, fontFamily:FONT_MONO, fontWeight:500, color:accent||T.text, marginTop:10, letterSpacing:"-0.02em", lineHeight:1 }}>
      {value}{suffix && <span style={{ fontSize:13, color:T.textDim, marginLeft:4, fontWeight:400 }}>{suffix}</span>}
    </div>
    {delta && <div style={{ fontSize:12, marginTop:8, fontFamily:FONT_MONO, color:delta.startsWith("+")?T.crit:T.accent }}>{delta} vs yesterday</div>}
  </Card>
);

const Pill = ({ children, color }) => (
  <span style={{ display:"inline-flex", alignItems:"center", padding:"2px 8px", borderRadius:3, fontSize:10, fontFamily:FONT_MONO, letterSpacing:"0.08em", textTransform:"uppercase", background:`${color}18`, color, border:`1px solid ${color}33` }}>{children}</span>
);

const sevColor = (s) => s==="critical"?T.crit:s==="warning"?T.warn:T.info;
const fmt$  = (n) => n>=1000?`$${(n/1000).toFixed(2)}k`:`$${n.toFixed(2)}`;
const fmtK  = (n) => n>=1_000_000?`${(n/1_000_000).toFixed(2)}M`:n>=1000?`${(n/1000).toFixed(1)}k`:n.toString();
const fmtTime=(ts)=>{ const d=Date.now()-ts; if(d<60_000)return"just now"; if(d<3_600_000)return`${Math.floor(d/60_000)}m ago`; if(d<86_400_000)return`${Math.floor(d/3_600_000)}h ago`; return new Date(ts).toLocaleDateString(); };

// ─── Sortable table helpers ───────────────────────────────────────────────────
function useSortable(defaultKey, defaultDir = "desc") {
  const [sortKey, setSortKey] = useState(defaultKey);
  const [sortDir, setSortDir] = useState(defaultDir);
  const toggle = (key) => {
    if (key === sortKey) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("desc"); }
  };
  const sort = (rows, getValue) => [...rows].sort((a, b) => {
    const va = getValue(a, sortKey), vb = getValue(b, sortKey);
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    const cmp = typeof va === "string" ? va.localeCompare(vb) : va - vb;
    return sortDir === "asc" ? cmp : -cmp;
  });
  return { sortKey, sortDir, toggle, sort };
}

const SortableTh = ({ label, sortKey, active, dir, onToggle, style: extraStyle = {} }) => (
  <th onClick={() => onToggle(sortKey)}
    style={{ textAlign:"left", padding:"10px 8px", fontFamily:FONT_MONO, fontSize:10, letterSpacing:"0.1em",
      textTransform:"uppercase", color: active ? T.text : T.textDim, fontWeight:500,
      cursor:"pointer", userSelect:"none", whiteSpace:"nowrap", ...extraStyle }}
    title={`Sort by ${label}`}>
    {label}
    <span style={{ marginLeft:4, opacity: active ? 1 : 0.3, fontSize:9 }}>
      {active ? (dir === "asc" ? "▲" : "▼") : "⇅"}
    </span>
  </th>
);

function useSearch(rows, getSearchString) {
  const [query, setQuery] = useState("");
  const filtered = query.trim()
    ? rows.filter(r => getSearchString(r).toLowerCase().includes(query.toLowerCase().trim()))
    : rows;
  return { query, setQuery, filtered };
}

const SearchBox = ({ query, onChange, placeholder = "Search…", count, total }) => (
  <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10 }}>
    <div style={{ position:"relative", flex:1, maxWidth:320 }}>
      <span style={{ position:"absolute", left:9, top:"50%", transform:"translateY(-50%)", color:T.textMute, fontSize:12, pointerEvents:"none" }}>⌕</span>
      <input
        value={query}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={{ width:"100%", boxSizing:"border-box", background:T.panelHi, color:T.text, border:`1px solid ${query ? T.accent+"55" : T.border}`,
          padding:"6px 10px 6px 28px", borderRadius:4, fontSize:12, fontFamily:FONT_MONO, outline:"none" }}
      />
      {query && (
        <button onClick={() => onChange("")}
          style={{ position:"absolute", right:6, top:"50%", transform:"translateY(-50%)", background:"none", border:"none", color:T.textMute, cursor:"pointer", fontSize:14, lineHeight:1, padding:0 }}>
          ×
        </button>
      )}
    </div>
    {query && (
      <span style={{ fontFamily:FONT_MONO, fontSize:11, color:T.textMute }}>
        {count} / {total}
      </span>
    )}
  </div>
);

// ─── Page components ──────────────────────────────────────────────────────────
function Home({ risk, savings, alerts, A, onNavigate }) {
  const crit = alerts.filter((a)=>a.sev==="critical").length;
  return (
    <div>
      <div style={{ background:`linear-gradient(135deg,${T.panel} 0%,${T.panelHi} 100%)`, border:`1px solid ${T.border}`, borderRadius:8, padding:"44px 40px", marginBottom:18, position:"relative", overflow:"hidden" }}>
        <div style={{ position:"absolute", top:0, right:0, width:300, height:300, background:`radial-gradient(circle,${T.accent}10 0%,transparent 70%)`, pointerEvents:"none" }} />
        <div style={{ fontFamily:FONT_MONO, fontSize:10, letterSpacing:"0.18em", textTransform:"uppercase", color:T.accent, marginBottom:14 }}>◆ AI Runtime Control Center</div>
        <h1 style={{ fontSize:36, fontWeight:400, letterSpacing:"-0.025em", lineHeight:1.15, margin:0, maxWidth:720, color:T.text }}>
          "We don't understand or control our<br /><span style={{ color:T.textDim }}>AI infrastructure."</span>
        </h1>
        <div style={{ fontSize:15, color:T.textDim, marginTop:18, maxWidth:680, lineHeight:1.65 }}>
          AIFinOps Guard gives organizations complete visibility, governance, security, and cost control over every AI agent, model, and workflow running inside their environment.
        </div>
        <div style={{ fontSize:13, color:T.textMute, marginTop:12, maxWidth:680, lineHeight:1.65 }}>
          If your company uses ChatGPT, Copilot, Claude, Gemini, AI agents, or custom LLM applications, AIFinOps Guard helps you understand where your money goes, what your AI is doing, and whether it operates securely and according to policy.
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:14, marginTop:28, maxWidth:880 }}>
          {[
            { k:"Cost",      v:"Visibility",    desc:"See every $ across teams, agents, models",       to:"cost" },
            { k:"Behavior",  v:"Intelligence",  desc:"Detect loops, spikes, anomalies in real time",    to:"agents" },
            { k:"Security",  v:"Posture",       desc:"Catch unapproved models & sensitive data",        to:"alerts" },
            { k:"Governance",v:"Controls",      desc:"Policy enforcement & audit trails",               to:"workflows" },
          ].map((p) => (
            <button key={p.k} onClick={()=>onNavigate(p.to)}
              style={{ background:T.panel, border:`1px solid ${T.border}`, borderRadius:5, padding:16, textAlign:"left", cursor:"pointer", color:T.text, fontFamily:FONT_UI, transition:"all 0.15s" }}
              onMouseEnter={(e)=>{ e.currentTarget.style.borderColor=T.accent; e.currentTarget.style.transform="translateY(-1px)"; }}
              onMouseLeave={(e)=>{ e.currentTarget.style.borderColor=T.border; e.currentTarget.style.transform="translateY(0)"; }}>
              <div style={{ fontFamily:FONT_MONO, fontSize:10, letterSpacing:"0.14em", textTransform:"uppercase", color:T.accent, marginBottom:6 }}>{p.k}</div>
              <div style={{ fontSize:16, marginBottom:6 }}>{p.v}</div>
              <div style={{ fontSize:12, color:T.textDim, lineHeight:1.4 }}>{p.desc}</div>
            </button>
          ))}
        </div>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"1.1fr 1.3fr 1fr", gap:14, marginBottom:14 }}>
        <RiskScoreCard risk={risk} />
        <SavingsCard savings={savings} />
        <Card title="Critical signal" subtitle={`${crit} critical · ${alerts.length} total`}>
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            {alerts.slice(0,3).map((a,i) => (
              <div key={i} style={{ padding:"10px 12px", background:T.panelHi, borderLeft:`2px solid ${sevColor(a.sev)}`, borderRadius:3 }}>
                <div style={{ fontFamily:FONT_MONO, fontSize:10, color:sevColor(a.sev), letterSpacing:"0.08em", textTransform:"uppercase", marginBottom:4 }}>{a.type}</div>
                <div style={{ fontSize:12, color:T.text, lineHeight:1.4 }}>{a.msg}</div>
              </div>
            ))}
            <button onClick={()=>onNavigate("alerts")} style={{ background:"transparent", border:`1px solid ${T.border}`, color:T.textDim, padding:"8px 12px", borderRadius:4, cursor:"pointer", fontSize:11, fontFamily:FONT_MONO, letterSpacing:"0.08em", textTransform:"uppercase", marginTop:4 }}>View all alerts →</button>
          </div>
        </Card>
      </div>
      <ExecSummaryCard A={A} savings={savings} risk={risk} alerts={alerts} />
    </div>
  );
}

function RiskScoreCard({ risk }) {
  const color = risk.score>60?T.crit:risk.score>35?T.warn:T.accent;
  const label = risk.score>60?"ELEVATED":risk.score>35?"MODERATE":"HEALTHY";
  return (
    <Card title="AI Runtime Risk Score" subtitle="Composite of 6 factors, 0–100">
      <div style={{ display:"flex", gap:20, alignItems:"center" }}>
        <div style={{ position:"relative", width:110, height:110, flexShrink:0 }}>
          <svg width="110" height="110" viewBox="0 0 110 110">
            <circle cx="55" cy="55" r="46" fill="none" stroke={T.border}  strokeWidth="6" />
            <circle cx="55" cy="55" r="46" fill="none" stroke={color} strokeWidth="6" strokeLinecap="round" strokeDasharray={`${(risk.score/100)*289} 289`} transform="rotate(-90 55 55)" />
          </svg>
          <div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center" }}>
            <div style={{ fontSize:32, fontFamily:FONT_MONO, color, fontWeight:500, lineHeight:1 }}>{risk.score}</div>
            <div style={{ fontSize:9, color:T.textMute, fontFamily:FONT_MONO, letterSpacing:"0.12em", marginTop:2 }}>/ 100</div>
          </div>
        </div>
        <div style={{ flex:1, minWidth:0 }}>
          <Pill color={color}>{label}</Pill>
          <div style={{ display:"flex", flexDirection:"column", gap:4, marginTop:10 }}>
            {risk.factors.map((f) => (
              <div key={f.label} style={{ display:"flex", alignItems:"center", gap:8, fontSize:11 }}>
                <div style={{ flex:1, fontFamily:FONT_MONO, color:T.textDim }}>{f.label}</div>
                <div style={{ width:56, height:3, background:T.border, borderRadius:2, overflow:"hidden" }}>
                  <div style={{ width:`${(f.value/f.max)*100}%`, height:"100%", background:f.value>0?color:T.border }} />
                </div>
                <div style={{ width:30, textAlign:"right", fontFamily:FONT_MONO, color:T.text }}>{f.value}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}

function SavingsCard({ savings }) {
  const items = [
    { label:"Right-sizing premium models",  val:savings.premium, note:"Route short prompts to mid-tier" },
    { label:"Stopping agent loops",         val:savings.loops,   note:"Cap retries / add termination" },
    { label:"Reducing failed workflows",    val:savings.failed,  note:"Fix upstream tool errors" },
    { label:"Optimizing slow workflows",    val:savings.latency, note:"Reduce p95 latency penalty" },
  ];
  return (
    <Card title="Potential Monthly Savings" subtitle="Estimated based on current runtime patterns">
      <div style={{ display:"flex", alignItems:"baseline", gap:12, marginBottom:14 }}>
        <div style={{ fontSize:38, fontFamily:FONT_MONO, color:T.accent, fontWeight:500, letterSpacing:"-0.02em", lineHeight:1 }}>${savings.total.toFixed(0)}</div>
        <div style={{ fontSize:12, color:T.textDim, fontFamily:FONT_MONO }}>/ month recoverable</div>
      </div>
      <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
        {items.map((it) => (
          <div key={it.label} style={{ display:"flex", alignItems:"center", gap:10, fontSize:12 }}>
            <div style={{ flex:1 }}>
              <div style={{ color:T.text }}>{it.label}</div>
              <div style={{ color:T.textMute, fontSize:11, marginTop:2 }}>{it.note}</div>
            </div>
            <div style={{ fontFamily:FONT_MONO, color:T.accent, fontWeight:500 }}>${it.val.toFixed(2)}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function ExecSummaryCard({ A, savings, risk, alerts }) {
  const s = execSummary(A, savings, risk, alerts);
  return (
    <Card title="Executive Summary" subtitle="Plain-English digest of current runtime state" style={{ background:`linear-gradient(180deg,${T.panel} 0%,${T.panelHi} 100%)` }}>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:24 }}>
        {[
          { label:"What happened",   text:s.what, color:T.info },
          { label:"Why it matters",  text:s.why,  color:T.warn },
          { label:"What to do next", text:s.next, color:T.accent },
        ].map((b) => (
          <div key={b.label}>
            <div style={{ fontFamily:FONT_MONO, fontSize:10, letterSpacing:"0.12em", textTransform:"uppercase", color:b.color, marginBottom:10, paddingBottom:8, borderBottom:`1px solid ${b.color}33` }}>{b.label}</div>
            <div style={{ fontSize:13, color:T.text, lineHeight:1.6 }}>{b.text}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function RuntimeChain({ events, allAgents, allTeams, selectedAgentId, onSelectAgent }) {
  const ag = allAgents.find((a)=>a.id===selectedAgentId) || allAgents[0];
  if (!ag) return null;
  const agEvents   = events.filter((e)=>e.agent===ag.id);
  const totalCost  = agEvents.reduce((s,e)=>s+e.cost,0);
  const totalCalls = agEvents.length;
  const modelMix   = {};
  agEvents.forEach((e)=>{ modelMix[e.model]=(modelMix[e.model]||0)+1; });
  const topModel   = Object.entries(modelMix).sort((a,b)=>b[1]-a[1])[0]?.[0]||"—";
  const fails      = agEvents.filter((e)=>e.status==="failed").length;
  const sensitive  = agEvents.filter((e)=>e.sensitive).length;
  const unapproved = agEvents.filter((e)=>!approvedModel(e.model)).length;
  const riskLevel  = (fails/Math.max(totalCalls,1)>0.1||sensitive>0||unapproved>0)?"high":totalCost>50?"medium":"low";
  const riskColor  = riskLevel==="high"?T.crit:riskLevel==="medium"?T.warn:T.accent;
  const modelApproved = approvedModel(topModel);

  const Node = ({ label, value, sub, color }) => (
    <div style={{ background:T.panelHi, border:`1px solid ${T.border}`, borderRadius:6, padding:"14px 16px", minWidth:140, flex:1 }}>
      <div style={{ fontFamily:FONT_MONO, fontSize:9, letterSpacing:"0.14em", textTransform:"uppercase", color:T.textMute, marginBottom:6 }}>{label}</div>
      <div style={{ fontFamily:FONT_MONO, fontSize:15, color:color||T.text, marginBottom:4 }}>{value}</div>
      <div style={{ fontFamily:FONT_MONO, fontSize:11, color:T.textDim }}>{sub}</div>
    </div>
  );
  const Arrow = () => (
    <div style={{ display:"flex", alignItems:"center", padding:"0 6px" }}>
      <svg width="28" height="14" viewBox="0 0 28 14">
        <line x1="0" y1="7" x2="22" y2="7" stroke={T.borderHi} strokeWidth="1" strokeDasharray="3,3"/>
        <polygon points="22,3 28,7 22,11" fill={T.borderHi}/>
      </svg>
    </div>
  );

  return (
    <Card title="Runtime Chain" subtitle="Trace a single agent end-to-end: who, what tool, which model, what it cost, what risk">
      <div style={{ display:"flex", gap:6, marginBottom:18, flexWrap:"wrap" }}>
        {allAgents.map((a)=>(
          <button key={a.id} onClick={()=>onSelectAgent(a.id)}
            style={{ background:a.id===selectedAgentId?T.accent:"transparent", color:a.id===selectedAgentId?T.bg:T.textDim, border:`1px solid ${a.id===selectedAgentId?T.accent:T.border}`, padding:"5px 10px", borderRadius:3, fontSize:11, fontFamily:FONT_MONO, cursor:"pointer" }}>
            {a.name}
          </button>
        ))}
      </div>
      <div style={{ display:"flex", alignItems:"stretch", overflowX:"auto", paddingBottom:4 }}>
        <Node label="Agent"  value={ag.name}    sub={allTeams.find((t)=>t.id===ag.team)?.name||ag.team} />
        <Arrow />
        <Node label="Tool"   value={ag.tool}    sub={`${totalCalls.toLocaleString()} invocations`} />
        <Arrow />
        <Node label="Model"  value={topModel}   sub={providerFromModel(topModel)} color={!modelApproved?T.warn:T.text} />
        <Arrow />
        <Node label="Cost"   value={fmt$(totalCost)} sub={`avg $${(totalCost/Math.max(totalCalls,1)).toFixed(4)}/call`} />
        <Arrow />
        <Node label="Risk"   value={riskLevel.toUpperCase()} sub={`${fails} fail · ${sensitive} sens · ${unapproved} unapp`} color={riskColor} />
      </div>
    </Card>
  );
}

function Overview({ A, events, allAgents, allTeams }) {
  const [selectedAgent, setSelectedAgent] = useState(allAgents[0]?.id || "");
  return (
    <div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:14, marginBottom:14 }}>
        <Stat label="Cost today"    value={fmt$(A.today.cost)}         delta="+47%" />
        <Stat label="Tokens today"  value={fmtK(A.today.tokens)}       delta="+38%" />
        <Stat label="Active agents" value={A.today.activeAgents}       suffix={`/ ${allAgents.length}`} />
        <Stat label="Avg latency"   value={Math.round(A.today.avgLatency)} suffix="ms" delta="+12%" />
        <Stat label="Failed reqs"   value={A.today.failed}             accent={A.today.failed>5?T.crit:T.text} />
      </div>
      <div style={{ marginBottom:14 }}>
        <RuntimeChain events={events} allAgents={allAgents} allTeams={allTeams} selectedAgentId={selectedAgent} onSelectAgent={setSelectedAgent} />
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"2fr 1fr", gap:14 }}>
        <Card title="Cost trend" subtitle="Daily spend across the selected window">
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={A.series}>
              <defs><linearGradient id="g1" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={T.accent} stopOpacity={0.35}/><stop offset="100%" stopColor={T.accent} stopOpacity={0}/></linearGradient></defs>
              <CartesianGrid stroke={T.border} vertical={false}/>
              <XAxis dataKey="date" tickFormatter={(d)=>new Date(d).toLocaleDateString(undefined,{month:"short",day:"numeric"})} stroke={T.textMute} style={{ fontFamily:FONT_MONO, fontSize:10 }}/>
              <YAxis stroke={T.textMute} style={{ fontFamily:FONT_MONO, fontSize:10 }} tickFormatter={(v)=>`$${v.toFixed(0)}`}/>
              <Tooltip contentStyle={{ background:T.panelHi, border:`1px solid ${T.borderHi}`, borderRadius:4, fontFamily:FONT_MONO, fontSize:11 }} labelFormatter={(d)=>new Date(d).toLocaleDateString()} formatter={(v)=>[`$${v.toFixed(2)}`,"cost"]}/>
              <Area type="monotone" dataKey="cost" stroke={T.accent} strokeWidth={1.5} fill="url(#g1)"/>
            </AreaChart>
          </ResponsiveContainer>
        </Card>
        <Card title="Top agents by cost" subtitle="Window total">
          <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
            {Object.entries(A.costByAgent).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([id,cost])=>{
              const agent = allAgents.find((x)=>x.id===id);
              const max   = Math.max(...Object.values(A.costByAgent));
              return (
                <div key={id} style={{ fontSize:12 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
                    <span style={{ fontFamily:FONT_MONO, color:T.text }}>{agent?.name||id}</span>
                    <span style={{ fontFamily:FONT_MONO, color:T.textDim }}>{fmt$(cost)}</span>
                  </div>
                  <div style={{ height:4, background:T.border, borderRadius:2, overflow:"hidden" }}>
                    <div style={{ width:`${(cost/max)*100}%`, height:"100%", background:T.accent, opacity:0.85 }}/>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>
    </div>
  );
}

function CostIntel({ A, events, allTeams }) {
  const { sortKey, sortDir, toggle, sort } = useSortable("cost");
  const teamData  = Object.entries(A.costByTeam).map(([id,cost])=>({ name:allTeams.find((t)=>t.id===id)?.name||id, cost }));
  const modelData = Object.entries(A.costByModel).map(([name,cost])=>({ name, cost }));
  const COLORS    = [T.accent, T.info, T.warn, T.crit, T.purple, "#5BD9C5"];
  const wfCost    = {};
  events.forEach((e)=>{ wfCost[e.workflow]=(wfCost[e.workflow]||0)+e.cost; });
  const wfBaseRows = Object.entries(wfCost).map(([wf, cost]) => ({ wf, cost, calls: A.callsByWorkflow[wf]||0, avgCost: cost/Math.max(A.callsByWorkflow[wf]||0,1) }));
  const colKey = { "Workflow":"wf","Calls":"calls","Total cost":"cost","Avg cost/call":"avgCost" };
  const wfSorted = sort(wfBaseRows, (r, k) => r[k]);
  const { query: wfQuery, setQuery: setWfQuery, filtered: topWf } = useSearch(wfSorted, r => r.wf);
  return (
    <div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14, marginBottom:14 }}>
        <Card title="Cost by team" subtitle="Window cumulative">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={teamData} layout="vertical">
              <CartesianGrid stroke={T.border} horizontal={false}/>
              <XAxis type="number" stroke={T.textMute} style={{ fontFamily:FONT_MONO, fontSize:10 }} tickFormatter={(v)=>`$${v.toFixed(0)}`}/>
              <YAxis type="category" dataKey="name" stroke={T.textDim} style={{ fontFamily:FONT_MONO, fontSize:10 }} width={130}/>
              <Tooltip contentStyle={{ background:T.panelHi, border:`1px solid ${T.borderHi}`, borderRadius:4, fontFamily:FONT_MONO, fontSize:11 }} formatter={(v)=>[fmt$(v),"cost"]}/>
              <Bar dataKey="cost" fill={T.accent}/>
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Card title="Cost by model" subtitle="Provider mix">
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={modelData} dataKey="cost" nameKey="name" cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={2}>
                {modelData.map((_,i)=><Cell key={i} fill={COLORS[i%COLORS.length]} stroke={T.bg} strokeWidth={2}/>)}
              </Pie>
              <Tooltip contentStyle={{ background:T.panelHi, border:`1px solid ${T.borderHi}`, borderRadius:4, fontFamily:FONT_MONO, fontSize:11 }} formatter={(v)=>[fmt$(v),"cost"]}/>
            </PieChart>
          </ResponsiveContainer>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginTop:8 }}>
            {modelData.map((m,i)=>(
              <div key={m.name} style={{ fontSize:11, fontFamily:FONT_MONO, display:"flex", alignItems:"center", gap:6, color:T.textDim }}>
                <span style={{ width:8, height:8, background:COLORS[i%COLORS.length], borderRadius:1, flexShrink:0 }}/>{m.name}
              </div>
            ))}
          </div>
        </Card>
      </div>
      <Card title="Most expensive workflows" subtitle="Click a column header to sort">
        <SearchBox query={wfQuery} onChange={setWfQuery} placeholder="Search workflows…" count={topWf.length} total={wfBaseRows.length} />
        <table style={{ width:"100%", borderCollapse:"collapse" }}>
          <thead>
            <tr style={{ borderBottom:`1px solid ${T.border}` }}>
              {["Workflow","Calls","Total cost","Avg cost/call"].map((h)=>(
                <SortableTh key={h} label={h} sortKey={colKey[h]} active={sortKey===colKey[h]} dir={sortDir} onToggle={toggle} />
              ))}
            </tr>
          </thead>
          <tbody>
            {topWf.map((r)=>(
              <tr key={r.wf} style={{ borderBottom:`1px solid ${T.border}` }}>
                <td style={{ padding:"12px 8px", fontFamily:FONT_MONO, fontSize:12, color:T.text }}>{r.wf}</td>
                <td style={{ padding:"12px 8px", fontFamily:FONT_MONO, fontSize:12, color:T.textDim }}>{r.calls.toLocaleString()}</td>
                <td style={{ padding:"12px 8px", fontFamily:FONT_MONO, fontSize:12, color:T.text }}>{fmt$(r.cost)}</td>
                <td style={{ padding:"12px 8px", fontFamily:FONT_MONO, fontSize:12, color:T.textDim }}>${r.avgCost.toFixed(4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function AgentActivity({ events, allAgents, allTeams }) {
  const { sortKey, sortDir, toggle, sort } = useSortable("cost");
  const baseRows = allAgents.map((a)=>{
    const aev = events.filter((e)=>e.agent===a.id);
    const requests = aev.length;
    const cost     = aev.reduce((s,e)=>s+e.cost,0);
    const avgLat   = requests>0 ? aev.reduce((s,e)=>s+e.latency,0)/requests : 0;
    const errors   = aev.filter((e)=>e.status==="failed").length;
    const last     = aev[0]?.ts||0;
    const teamName = allTeams.find((t)=>t.id===a.team)?.name||a.team;
    return { ...a, requests, cost, avgLat, errors, last, teamName };
  });
  const colKey = { "Agent":"name","Team":"teamName","Requests":"requests","Cost":"cost","Avg latency":"avgLat","Errors":"errors","Last activity":"last" };
  const sorted = sort(baseRows, (r, k) => r[k]);
  const { query, setQuery, filtered: rows } = useSearch(sorted, r => `${r.name} ${r.teamName} ${r.id}`);
  return (
    <Card title="Agents" subtitle="Live runtime activity">
      <SearchBox query={query} onChange={setQuery} placeholder="Search agents or teams…" count={rows.length} total={baseRows.length} />
      <table style={{ width:"100%", borderCollapse:"collapse" }}>
        <thead>
          <tr style={{ borderBottom:`1px solid ${T.border}` }}>
            {["Agent","Team","Requests","Cost","Avg latency","Errors","Last activity"].map((h)=>(
              <SortableTh key={h} label={h} sortKey={colKey[h]} active={sortKey===colKey[h]} dir={sortDir} onToggle={toggle} />
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r)=>(
            <tr key={r.id} style={{ borderBottom:`1px solid ${T.border}` }}>
              <td style={{ padding:"12px 8px" }}>
                <div style={{ fontFamily:FONT_MONO, fontSize:12, color:T.text }}>{r.name}</div>
                <div style={{ fontFamily:FONT_MONO, fontSize:10, color:T.textMute, marginTop:2 }}>{r.id}</div>
              </td>
              <td style={{ padding:"12px 8px", fontSize:12, color:T.textDim }}>{r.teamName}</td>
              <td style={{ padding:"12px 8px", fontFamily:FONT_MONO, fontSize:12, color:T.text }}>{r.requests.toLocaleString()}</td>
              <td style={{ padding:"12px 8px", fontFamily:FONT_MONO, fontSize:12, color:T.text }}>{fmt$(r.cost)}</td>
              <td style={{ padding:"12px 8px", fontFamily:FONT_MONO, fontSize:12, color:r.avgLat>2000?T.warn:T.textDim }}>{Math.round(r.avgLat)}ms</td>
              <td style={{ padding:"12px 8px" }}>{r.errors>10?<Pill color={T.crit}>{r.errors}</Pill>:r.errors>0?<Pill color={T.warn}>{r.errors}</Pill>:<span style={{ fontFamily:FONT_MONO, fontSize:12, color:T.textMute }}>0</span>}</td>
              <td style={{ padding:"12px 8px", fontFamily:FONT_MONO, fontSize:12, color:T.textDim }}>{fmtTime(r.last)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function ModelUsage({ A }) {
  const { sortKey, sortDir, toggle, sort } = useSortable("cost");
  const allModelNames = [...new Set([...MODELS.map((m)=>m.name), ...Object.keys(A.costByModel)])];
  const baseRows = allModelNames.map((name)=>{
    const meta = MODELS.find((m)=>m.name===name);
    const cost  = A.costByModel[name]||0;
    const tokens= A.tokensByModel[name]||0;
    const lats  = A.latencyByModel[name]||[];
    const avgLat= lats.length>0 ? lats.reduce((s,x)=>s+x,0)/lats.length : 0;
    const p95   = lats.length>0 ? [...lats].sort((a,b)=>a-b)[Math.floor(lats.length*0.95)] : 0;
    return { name, provider:meta?.provider||providerFromModel(name), tier:meta?.tier||tierFromModel(name), approved:meta?.approved??approvedModel(name), cost, tokens, avgLat, p95, calls:lats.length };
  });
  const colKey = { "Model":"name","Provider":"provider","Tier":"tier","Approved":"approved","Calls":"calls","Tokens":"tokens","Cost":"cost","Avg latency":"avgLat","p95":"p95" };
  const sorted = sort(baseRows, (r, k) => r[k]);
  const { query, setQuery, filtered: modelRows } = useSearch(sorted, r => `${r.name} ${r.provider} ${r.tier}`);
  return (
    <Card title="Models" subtitle="Performance, spend, and governance posture">
      <SearchBox query={query} onChange={setQuery} placeholder="Search models or providers…" count={modelRows.length} total={baseRows.length} />
      <table style={{ width:"100%", borderCollapse:"collapse" }}>
        <thead>
          <tr style={{ borderBottom:`1px solid ${T.border}` }}>
            {["Model","Provider","Tier","Approved","Calls","Tokens","Cost","Avg latency","p95"].map((h)=>(
              <SortableTh key={h} label={h} sortKey={colKey[h]} active={sortKey===colKey[h]} dir={sortDir} onToggle={toggle} />
            ))}
          </tr>
        </thead>
        <tbody>
          {modelRows.map((m)=>(
            <tr key={m.name} style={{ borderBottom:`1px solid ${T.border}` }}>
              <td style={{ padding:"12px 8px", fontFamily:FONT_MONO, fontSize:12, color:T.text }}>{m.name}</td>
              <td style={{ padding:"12px 8px", fontSize:12, color:T.textDim }}>{m.provider}</td>
              <td style={{ padding:"12px 8px" }}><Pill color={m.tier==="premium"?T.warn:m.tier==="mid"?T.info:T.accent}>{m.tier}</Pill></td>
              <td style={{ padding:"12px 8px" }}>{m.approved?<Pill color={T.accent}>yes</Pill>:<Pill color={T.crit}>no</Pill>}</td>
              <td style={{ padding:"12px 8px", fontFamily:FONT_MONO, fontSize:12, color:T.text }}>{m.calls.toLocaleString()}</td>
              <td style={{ padding:"12px 8px", fontFamily:FONT_MONO, fontSize:12, color:T.text }}>{fmtK(m.tokens)}</td>
              <td style={{ padding:"12px 8px", fontFamily:FONT_MONO, fontSize:12, color:T.text }}>{fmt$(m.cost)}</td>
              <td style={{ padding:"12px 8px", fontFamily:FONT_MONO, fontSize:12, color:T.textDim }}>{Math.round(m.avgLat)}ms</td>
              <td style={{ padding:"12px 8px", fontFamily:FONT_MONO, fontSize:12, color:m.p95>3000?T.warn:T.textDim }}>{Math.round(m.p95)}ms</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function WorkflowHealth({ A, events }) {
  const { sortKey, sortDir, toggle, sort } = useSortable("rate");
  const baseRows = Object.keys(A.callsByWorkflow).map((wf)=>{
    const calls = A.callsByWorkflow[wf];
    const fails = A.failsByWorkflow[wf]||0;
    const cost  = events.filter((e)=>e.workflow===wf).reduce((s,e)=>s+e.cost,0);
    return { wf, calls, fails, rate:fails/calls, cost };
  });
  const colKey = { "Workflow":"wf","Calls":"calls","Failures":"fails","Rate":"rate","Cost":"cost","Status":"rate" };
  const sorted = sort(baseRows, (r, k) => r[k]);
  const { query, setQuery, filtered: rows } = useSearch(sorted, r => r.wf);
  return (
    <Card title="Workflow health" subtitle="Failure rate & spend per workflow">
      <SearchBox query={query} onChange={setQuery} placeholder="Search workflows…" count={rows.length} total={baseRows.length} />
      <table style={{ width:"100%", borderCollapse:"collapse" }}>
        <thead>
          <tr style={{ borderBottom:`1px solid ${T.border}` }}>
            {["Workflow","Calls","Failures","Rate","Cost","Status"].map((h)=>(
              <SortableTh key={h} label={h} sortKey={colKey[h]} active={sortKey===colKey[h]} dir={sortDir} onToggle={toggle} />
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r)=>(
            <tr key={r.wf} style={{ borderBottom:`1px solid ${T.border}` }}>
              <td style={{ padding:"12px 8px", fontFamily:FONT_MONO, fontSize:12, color:T.text }}>{r.wf}</td>
              <td style={{ padding:"12px 8px", fontFamily:FONT_MONO, fontSize:12, color:T.text }}>{r.calls.toLocaleString()}</td>
              <td style={{ padding:"12px 8px", fontFamily:FONT_MONO, fontSize:12, color:r.fails>0?T.warn:T.textDim }}>{r.fails}</td>
              <td style={{ padding:"12px 8px", fontFamily:FONT_MONO, fontSize:12, color:r.rate>0.2?T.crit:r.rate>0.05?T.warn:T.textDim }}>{(r.rate*100).toFixed(1)}%</td>
              <td style={{ padding:"12px 8px", fontFamily:FONT_MONO, fontSize:12, color:T.text }}>{fmt$(r.cost)}</td>
              <td style={{ padding:"12px 8px" }}>{r.rate>0.2?<Pill color={T.crit}>degraded</Pill>:r.rate>0.05?<Pill color={T.warn}>warning</Pill>:<Pill color={T.accent}>healthy</Pill>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function AlertCard({ a }) {
  const [open, setOpen] = useState(false);
  const meta = ALERT_META[a.type]||{};
  const c    = sevColor(a.sev);
  return (
    <div style={{ background:T.panelHi, border:`1px solid ${T.border}`, borderLeft:`2px solid ${c}`, borderRadius:5, overflow:"hidden" }}>
      <div style={{ padding:"16px 18px" }}>
        <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:16 }}>
          <div style={{ display:"flex", gap:14, alignItems:"flex-start" }}>
            <div style={{ width:34, height:34, borderRadius:7, background:`${c}1A`, border:`1px solid ${c}33`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, marginTop:2 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            </div>
            <div>
              <div style={{ fontSize:15, color:T.text, fontWeight:500, marginBottom:3 }}>{meta.title||a.type}</div>
              <div style={{ fontSize:12, color:T.textDim, fontFamily:FONT_MONO }}>{meta.category||"Alert"}<span style={{ color:T.textMute }}> · {a.entity}</span></div>
            </div>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:10, flexShrink:0 }}>
            <Pill color={c}>{a.sev}</Pill>
            <span style={{ fontFamily:FONT_MONO, fontSize:11, color:T.textMute }}>{fmtTime(a.ts)}</span>
          </div>
        </div>
        <div style={{ display:"flex", gap:8, marginTop:14, flexWrap:"wrap" }}>
          <button style={{ display:"inline-flex", alignItems:"center", gap:7, background:`${c}1A`, color:c, border:`1px solid ${c}44`, padding:"6px 12px", borderRadius:4, fontSize:12, fontFamily:FONT_UI, cursor:"pointer" }}>▶ Run an action</button>
          <button style={{ display:"inline-flex", alignItems:"center", gap:7, background:"transparent", color:T.textDim, border:`1px solid ${T.border}`, padding:"6px 12px", borderRadius:4, fontSize:12, fontFamily:FONT_UI, cursor:"pointer" }}>Ignore</button>
          <button style={{ display:"inline-flex", alignItems:"center", gap:7, background:"transparent", color:T.textDim, border:`1px solid ${T.border}`, padding:"6px 12px", borderRadius:4, fontSize:12, fontFamily:FONT_UI, cursor:"pointer" }}>Support</button>
          <button onClick={()=>setOpen((o)=>!o)} style={{ display:"inline-flex", alignItems:"center", gap:7, background:"transparent", color:T.textDim, border:`1px solid ${T.border}`, padding:"6px 12px", borderRadius:4, fontSize:12, fontFamily:FONT_UI, cursor:"pointer", marginLeft:"auto" }}>
            {open?"Hide explanation":"Why this fired"} {open?"▲":"▼"}
          </button>
        </div>
      </div>
      {open && (
        <div style={{ borderTop:`1px solid ${T.border}`, background:T.panel, padding:"18px 18px 18px 64px" }}>
          <div style={{ marginBottom:16 }}>
            <div style={{ fontSize:13, color:T.text, lineHeight:1.6 }}>{meta.detail?meta.detail(a):a.msg}</div>
          </div>
          {meta.checks && <ExplBlock label="What this rule checks" color={T.info}   text={meta.checks}  />}
          {meta.matters && <ExplBlock label="Why it matters"        color={T.warn}   text={meta.matters} />}
          {meta.causes && (
            <div style={{ marginBottom:16 }}>
              <div style={{ fontFamily:FONT_MONO, fontSize:10, letterSpacing:"0.12em", textTransform:"uppercase", color:T.purple, marginBottom:8 }}>Common causes</div>
              <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                {meta.causes.map((cz,i)=>(
                  <div key={i} style={{ display:"flex", gap:8, fontSize:13, color:T.textDim, lineHeight:1.5 }}>
                    <span style={{ color:T.purple, flexShrink:0 }}>—</span>{cz}
                  </div>
                ))}
              </div>
            </div>
          )}
          <div style={{ background:T.panelHi, border:`1px solid ${T.border}`, borderRadius:4, padding:"12px 14px", display:"flex", gap:10, alignItems:"flex-start" }}>
            <span style={{ color:T.accent, fontFamily:FONT_MONO, fontSize:13, flexShrink:0 }}>→</span>
            <div>
              <div style={{ fontFamily:FONT_MONO, fontSize:10, letterSpacing:"0.12em", textTransform:"uppercase", color:T.accent, marginBottom:4 }}>Recommended action</div>
              <div style={{ fontSize:13, color:T.text, lineHeight:1.5 }}>{a.action}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ExplBlock({ label, color, text }) {
  return (
    <div style={{ marginBottom:16 }}>
      <div style={{ fontFamily:FONT_MONO, fontSize:10, letterSpacing:"0.12em", textTransform:"uppercase", color, marginBottom:6 }}>{label}</div>
      <div style={{ fontSize:13, color:T.textDim, lineHeight:1.6 }}>{text}</div>
    </div>
  );
}

function AlertsPage({ alerts, sevFilter }) {
  const filtered = sevFilter==="all"?alerts:alerts.filter((a)=>a.sev===sevFilter);
  return (
    <Card title="Alerts" subtitle={`${filtered.length} of ${alerts.length} matching current filter · click any alert for the full explanation`}>
      <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
        {filtered.length===0 ? (
          <div style={{ color:T.textMute, fontFamily:FONT_MONO, fontSize:13, padding:"24px 0", textAlign:"center" }}>No alerts matching current filter</div>
        ) : filtered.map((a,i)=><AlertCard key={i} a={a}/>)}
      </div>
    </Card>
  );
}

function FilterBar({ filters, setFilters, allTeams, allAgents }) {
  const Select = ({ label, value, onChange, options }) => (
    <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
      <label style={{ fontSize:9, fontFamily:FONT_MONO, letterSpacing:"0.12em", textTransform:"uppercase", color:T.textMute }}>{label}</label>
      <select value={value} onChange={(e)=>onChange(e.target.value)} style={{ background:T.panelHi, color:T.text, border:`1px solid ${T.border}`, padding:"5px 8px", borderRadius:3, fontSize:12, fontFamily:FONT_MONO, cursor:"pointer", minWidth:100 }}>
        {options.map((o)=><option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
  return (
    <div style={{ display:"flex", gap:16, padding:"12px 18px", background:T.panel, border:`1px solid ${T.border}`, borderRadius:6, marginBottom:14, alignItems:"flex-end", flexWrap:"wrap" }}>
      <Select label="Team"     value={filters.team}  onChange={(v)=>setFilters({...filters,team:v})}  options={[{value:"all",label:"All teams"},  ...allTeams.map((t)=>({value:t.id,label:t.name}))]}/>
      <Select label="Model"    value={filters.model} onChange={(v)=>setFilters({...filters,model:v})} options={[{value:"all",label:"All models"}, ...MODELS.map((m)=>({value:m.name,label:m.name}))]}/>
      <Select label="Agent"    value={filters.agent} onChange={(v)=>setFilters({...filters,agent:v})} options={[{value:"all",label:"All agents"}, ...allAgents.map((a)=>({value:a.id,label:a.name}))]}/>
      <Select label="Severity" value={filters.sev}   onChange={(v)=>setFilters({...filters,sev:v})}   options={[{value:"all",label:"All"},{value:"critical",label:"Critical"},{value:"warning",label:"Warning"},{value:"info",label:"Info"}]}/>
      <Select label="Range"    value={String(filters.range)} onChange={(v)=>setFilters({...filters,range:parseInt(v)})} options={[{value:"1",label:"Last 24h"},{value:"7",label:"Last 7d"},{value:"30",label:"Last 30d"}]}/>
      <button onClick={()=>setFilters({team:"all",model:"all",agent:"all",sev:"all",range:30})} style={{ background:"transparent", color:T.textDim, border:`1px solid ${T.border}`, padding:"6px 12px", borderRadius:3, fontSize:11, fontFamily:FONT_MONO, cursor:"pointer", marginLeft:"auto" }}>Reset</button>
    </div>
  );
}

function SortableBudgetTable({ rules, onDelete }) {
  const { sortKey, sortDir, toggle, sort } = useSortable("created_at");
  const colKey = { "Team":"team","Agent":"agent","Limit":"limit_usd","Period":"period","Action":"action","Created":"created_at" };
  const sorted = sort(rules, (r, k) => {
    if (k === "created_at") return new Date(r.created_at).getTime();
    if (k === "limit_usd")  return r.limit_usd;
    return r[k] || "";
  });
  const { query, setQuery, filtered } = useSearch(sorted, r => `${r.team} ${r.agent||""} ${r.period} ${r.action}`);
  return (
    <>
    <SearchBox query={query} onChange={setQuery} placeholder="Search team, agent, period…" count={filtered.length} total={rules.length} />
    <table style={{ width:"100%", borderCollapse:"collapse" }}>
      <thead>
        <tr style={{ borderBottom:`1px solid ${T.border}` }}>
          {["Team","Agent","Limit","Period","Action","Created",""].map((h) => h === "" ? (
            <th key={h} style={{ padding:"10px 8px" }} />
          ) : (
            <SortableTh key={h} label={h} sortKey={colKey[h]} active={sortKey===colKey[h]} dir={sortDir} onToggle={toggle} />
          ))}
        </tr>
      </thead>
      <tbody>
        {filtered.map((r) => (
          <tr key={r.id} style={{ borderBottom:`1px solid ${T.border}` }}>
            <td style={{ padding:"12px 8px", fontFamily:FONT_MONO, fontSize:12, color:T.text }}>{r.team}</td>
            <td style={{ padding:"12px 8px", fontFamily:FONT_MONO, fontSize:12, color:T.textDim }}>{r.agent||<span style={{color:T.textMute}}>all agents</span>}</td>
            <td style={{ padding:"12px 8px", fontFamily:FONT_MONO, fontSize:12, color:T.accent }}>${r.limit_usd}</td>
            <td style={{ padding:"12px 8px" }}><Pill color={T.info}>{r.period}</Pill></td>
            <td style={{ padding:"12px 8px" }}><Pill color={r.action==="block"?T.crit:T.warn}>{r.action}</Pill></td>
            <td style={{ padding:"12px 8px", fontFamily:FONT_MONO, fontSize:11, color:T.textMute }}>{new Date(r.created_at).toLocaleDateString()}</td>
            <td style={{ padding:"12px 8px" }}>
              <button onClick={() => onDelete(r.id)}
                style={{ background:"transparent", border:`1px solid ${T.border}`, color:T.crit, padding:"4px 10px", borderRadius:3, fontSize:11, fontFamily:FONT_MONO, cursor:"pointer" }}>
                Delete
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
    </>
  );
}

// ─── Budgets page ─────────────────────────────────────────────────────────────
function BudgetsPage() {
  const [rules,    setRules]    = useState([]);
  const [status,   setStatus]   = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [form,     setForm]     = useState({ team:"", agent:"", limit_usd:"", period:"monthly", action:"alert" });
  const [saving,   setSaving]   = useState(false);
  const [err,      setErr]      = useState(null);

  const load = useCallback(async () => {
    try {
      const [r, s] = await Promise.all([
        authFetch(`${BASE}/budgets`).then((x) => x.json()),
        authFetch(`${BASE}/budgets/status`).then((x) => x.json()),
      ]);
      setRules(r);
      setStatus(s);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async (e) => {
    e.preventDefault();
    setSaving(true);
    setErr(null);
    try {
      const body = { ...form, limit_usd: parseFloat(form.limit_usd), agent: form.agent || null };
      const r = await authFetch(`${BASE}/budgets`, { method:"POST", body: JSON.stringify(body) });
      if (!r || !r.ok) throw new Error(await r.text());
      setForm({ team:"", agent:"", limit_usd:"", period:"monthly", action:"alert" });
      await load();
    } catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id) => {
    await authFetch(`${BASE}/budgets/${id}`, { method:"DELETE" });
    await load();
  };

  const statusColor = (s) => s==="blocked"?T.crit:s==="warning"?T.warn:T.accent;

  if (loading) return <div style={{ color:T.textDim, fontFamily:FONT_MONO, padding:24 }}>Loading budgets…</div>;

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:14 }}>

      {/* Status cards */}
      {status.length > 0 && (
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))", gap:12 }}>
          {status.map((s) => {
            const c = statusColor(s.status);
            return (
              <div key={s.id} style={{ background:T.panel, border:`1px solid ${s.status==="ok"?T.border:c}`, borderRadius:8, padding:16 }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:10 }}>
                  <div>
                    <div style={{ fontFamily:FONT_MONO, fontSize:13, color:T.text }}>{s.team}</div>
                    {s.agent && <div style={{ fontFamily:FONT_MONO, fontSize:11, color:T.textMute, marginTop:2 }}>{s.agent}</div>}
                  </div>
                  <Pill color={c}>{s.status}</Pill>
                </div>
                {/* Progress bar */}
                <div style={{ height:6, background:T.border, borderRadius:3, overflow:"hidden", marginBottom:8 }}>
                  <div style={{ width:`${Math.min(s.pct,100)}%`, height:"100%", background:c, borderRadius:3, transition:"width 0.4s" }}/>
                </div>
                <div style={{ display:"flex", justifyContent:"space-between", fontSize:11, fontFamily:FONT_MONO }}>
                  <span style={{ color:T.textDim }}>${s.spend_usd.toFixed(4)} spent</span>
                  <span style={{ color:T.textMute }}>limit ${s.limit_usd} / {s.period}</span>
                </div>
                <div style={{ fontSize:11, fontFamily:FONT_MONO, color:c, marginTop:4 }}>{s.pct.toFixed(1)}% used · action: {s.action}</div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add rule form */}
      <Card title="Add Budget Rule" subtitle="Set a spend limit per team or agent">
        <form onSubmit={handleCreate} style={{ display:"flex", gap:10, flexWrap:"wrap", alignItems:"flex-end" }}>
          {[
            { label:"Team *",       key:"team",      placeholder:"e.g. SOC or *" },
            { label:"Agent",        key:"agent",     placeholder:"optional" },
            { label:"Limit (USD) *",key:"limit_usd", placeholder:"e.g. 10.00", type:"number" },
          ].map(({ label, key, placeholder, type }) => (
            <div key={key} style={{ display:"flex", flexDirection:"column", gap:4 }}>
              <label style={{ fontSize:9, fontFamily:FONT_MONO, letterSpacing:"0.12em", textTransform:"uppercase", color:T.textMute }}>{label}</label>
              <input
                type={type||"text"} placeholder={placeholder} value={form[key]}
                onChange={(e)=>setForm({...form,[key]:e.target.value})}
                required={label.includes("*")}
                style={{ background:T.panelHi, color:T.text, border:`1px solid ${T.border}`, padding:"6px 10px", borderRadius:4, fontSize:12, fontFamily:FONT_MONO, width:150 }}
              />
            </div>
          ))}
          {[
            { label:"Period", key:"period", options:[["monthly","Monthly"],["daily","Daily"]] },
            { label:"Action", key:"action", options:[["alert","Alert only"],["block","Block requests"]] },
          ].map(({ label, key, options }) => (
            <div key={key} style={{ display:"flex", flexDirection:"column", gap:4 }}>
              <label style={{ fontSize:9, fontFamily:FONT_MONO, letterSpacing:"0.12em", textTransform:"uppercase", color:T.textMute }}>{label}</label>
              <select value={form[key]} onChange={(e)=>setForm({...form,[key]:e.target.value})}
                style={{ background:T.panelHi, color:T.text, border:`1px solid ${T.border}`, padding:"6px 10px", borderRadius:4, fontSize:12, fontFamily:FONT_MONO, minWidth:130 }}>
                {options.map(([v,l])=><option key={v} value={v}>{l}</option>)}
              </select>
            </div>
          ))}
          <button type="submit" disabled={saving}
            style={{ background:T.accent, color:T.bg, border:"none", padding:"8px 18px", borderRadius:4, fontSize:12, fontFamily:FONT_MONO, fontWeight:600, cursor:"pointer", opacity:saving?0.6:1 }}>
            {saving?"Saving…":"+ Add Rule"}
          </button>
        </form>
        {err && <div style={{ color:T.crit, fontFamily:FONT_MONO, fontSize:12, marginTop:10 }}>{err}</div>}
      </Card>

      {/* Rules table */}
      <Card title="Budget Rules" subtitle={`${rules.length} rule${rules.length===1?"":"s"} configured`}>
        {rules.length === 0 ? (
          <div style={{ color:T.textMute, fontFamily:FONT_MONO, fontSize:13, padding:"20px 0", textAlign:"center" }}>
            No budget rules yet — add one above to start enforcing limits.
          </div>
        ) : (
          <SortableBudgetTable rules={rules} onDelete={handleDelete} />
        )}
      </Card>
    </div>
  );
}

// ─── Audit log detail ─────────────────────────────────────────────────────────
function AuditLogTable({ audit, hasMore = false, loadingMore = false, onLoadMore }) {
  const [expanded, setExpanded] = useState(null);
  const { sortKey, sortDir, toggle: sortToggle, sort } = useSortable("timestamp");

  const toggleExpand = (id) => setExpanded(prev => prev === id ? null : id);

  const colKey = { "Time":"timestamp","Team":"team","Agent":"agent","Model":"model","Status":"blocked","Sensitive":"sensitive","Tokens":"total_tokens","Cost":"cost_usd" };
  const sorted = sort(audit, (r, k) => {
    if (k === "timestamp") return new Date(r.timestamp).getTime();
    if (k === "blocked")   return r.blocked ? 1 : 0;
    if (k === "sensitive") return r.sensitive ? 1 : 0;
    return r[k];
  });
  const { query, setQuery, filtered } = useSearch(sorted, r =>
    `${r.team} ${r.agent} ${r.model} ${r.prompt||""} ${r.block_reason||""}`
  );

  return (
    <Card title="Audit Log" subtitle="All requests — including blocked and sensitive-flagged. Click a row for full details.">
      <SearchBox query={query} onChange={setQuery} placeholder="Search team, agent, model, prompt…" count={filtered.length} total={audit.length} />
      <table style={{ width:"100%", borderCollapse:"collapse" }}>
        <thead>
          <tr style={{ borderBottom:`1px solid ${T.border}` }}>
            {["Time","Team","Agent","Model","Status","Sensitive","Tokens","Cost",""].map((h) => h === "" ? (
              <th key={h} style={{ padding:"10px 8px", width:24 }} />
            ) : (
              <SortableTh key={h} label={h} sortKey={colKey[h]} active={sortKey===colKey[h]} dir={sortDir} onToggle={sortToggle} />
            ))}
          </tr>
        </thead>
        <tbody>
          {filtered.length === 0 ? (
            <tr><td colSpan={9} style={{ padding:"20px 8px", color:T.textMute, fontFamily:FONT_MONO, fontSize:13 }}>{audit.length === 0 ? "No audit records yet." : "No records match your search."}</td></tr>
          ) : filtered.map((r) => {
            const isOpen = expanded === r.id;
            const rowBg = r.blocked ? `${T.crit}08` : r.sensitive ? `${T.warn}08` : "transparent";
            let findings = [];
            try { findings = JSON.parse(r.sensitive_findings || "[]"); } catch {}
            return (
              <React.Fragment key={r.id}>
                <tr style={{ borderBottom: isOpen ? "none" : `1px solid ${T.border}`, background: rowBg, cursor:"pointer" }}
                    onClick={() => toggleExpand(r.id)}>
                  <td style={{ padding:"10px 8px", fontFamily:FONT_MONO, fontSize:11, color:T.textMute }}>{new Date(r.timestamp).toLocaleString()}</td>
                  <td style={{ padding:"10px 8px", fontSize:12, color:T.text }}>{r.team}</td>
                  <td style={{ padding:"10px 8px", fontSize:12, color:T.textDim }}>{r.agent}</td>
                  <td style={{ padding:"10px 8px", fontFamily:FONT_MONO, fontSize:11, color:T.textDim }}>{r.model}</td>
                  <td style={{ padding:"10px 8px" }}>
                    {r.blocked ? <Pill color={T.crit}>blocked</Pill> : <Pill color={T.accent}>ok</Pill>}
                  </td>
                  <td style={{ padding:"10px 8px" }}>
                    {r.sensitive ? <Pill color={T.warn}>flagged</Pill> : <span style={{ color:T.textMute, fontFamily:FONT_MONO, fontSize:11 }}>—</span>}
                  </td>
                  <td style={{ padding:"10px 8px", fontFamily:FONT_MONO, fontSize:12, color:T.textDim }}>{r.total_tokens.toLocaleString()}</td>
                  <td style={{ padding:"10px 8px", fontFamily:FONT_MONO, fontSize:12, color:T.text }}>${r.cost_usd.toFixed(6)}</td>
                  <td style={{ padding:"10px 8px", fontFamily:FONT_MONO, fontSize:10, color: isOpen ? T.accent : T.textMute, userSelect:"none" }}>
                    {isOpen ? "▲" : "▼"}
                  </td>
                </tr>
                {isOpen && (
                  <tr style={{ background: rowBg }}>
                    <td colSpan={9} style={{ padding:"0 0 0 0", borderBottom:`1px solid ${T.border}` }}>
                      <div style={{ padding:"16px 20px", display:"flex", flexDirection:"column", gap:14, borderTop:`1px dashed ${T.border}` }}>
                        {/* Prompt */}
                        <div>
                          <div style={{ fontFamily:FONT_MONO, fontSize:9, letterSpacing:"0.14em", textTransform:"uppercase", color:T.info, marginBottom:6 }}>Prompt</div>
                          <div style={{ background:T.bg, border:`1px solid ${T.border}`, borderRadius:4, padding:"10px 14px", fontFamily:FONT_MONO, fontSize:12, color:T.text, lineHeight:1.6, whiteSpace:"pre-wrap", wordBreak:"break-word", maxHeight:200, overflow:"auto" }}>
                            {r.prompt || <span style={{ color:T.textMute }}>—</span>}
                          </div>
                        </div>
                        {/* Response or block reason */}
                        {r.blocked ? (
                          <div>
                            <div style={{ fontFamily:FONT_MONO, fontSize:9, letterSpacing:"0.14em", textTransform:"uppercase", color:T.crit, marginBottom:6 }}>Block Reason</div>
                            <div style={{ background:`${T.crit}10`, border:`1px solid ${T.crit}33`, borderRadius:4, padding:"10px 14px", fontFamily:FONT_MONO, fontSize:12, color:T.crit, lineHeight:1.6 }}>
                              {r.block_reason || "—"}
                            </div>
                          </div>
                        ) : (
                          <div>
                            <div style={{ fontFamily:FONT_MONO, fontSize:9, letterSpacing:"0.14em", textTransform:"uppercase", color:T.accent, marginBottom:6 }}>Response</div>
                            <div style={{ background:T.bg, border:`1px solid ${T.border}`, borderRadius:4, padding:"10px 14px", fontFamily:FONT_MONO, fontSize:12, color:T.text, lineHeight:1.6, whiteSpace:"pre-wrap", wordBreak:"break-word", maxHeight:200, overflow:"auto" }}>
                              {r.response || <span style={{ color:T.textMute }}>—</span>}
                            </div>
                          </div>
                        )}
                        {/* Security findings */}
                        {findings.length > 0 && (
                          <div>
                            <div style={{ fontFamily:FONT_MONO, fontSize:9, letterSpacing:"0.14em", textTransform:"uppercase", color:T.warn, marginBottom:6 }}>Security Findings ({findings.length})</div>
                            <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
                              {findings.map((f, i) => (
                                <div key={i} style={{ display:"flex", alignItems:"center", gap:12, padding:"6px 10px", background:T.panelHi, borderLeft:`2px solid ${T.warn}`, borderRadius:3 }}>
                                  <Pill color={f.severity==="critical"?T.crit:T.warn}>{f.severity}</Pill>
                                  <span style={{ fontFamily:FONT_MONO, fontSize:11, color:T.text }}>{f.type}</span>
                                  <span style={{ fontFamily:FONT_MONO, fontSize:11, color:T.textMute }}>{f.sample}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {/* Meta row */}
                        <div style={{ display:"flex", gap:20, fontFamily:FONT_MONO, fontSize:10, color:T.textMute }}>
                          <span>ID: <span style={{ color:T.textDim }}>{r.id}</span></span>
                          <span>Latency: <span style={{ color:T.textDim }}>{r.latency_ms.toFixed(0)}ms</span></span>
                          <span>Prompt tokens: <span style={{ color:T.textDim }}>{r.prompt_tokens}</span></span>
                          <span>Completion tokens: <span style={{ color:T.textDim }}>{r.completion_tokens}</span></span>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
      {(hasMore || loadingMore) && (
        <div style={{ marginTop:14, textAlign:"center" }}>
          <button onClick={onLoadMore} disabled={loadingMore}
            style={{ background:"transparent", border:`1px solid ${T.border}`, color:T.textDim, padding:"8px 24px", borderRadius:4, fontSize:11, fontFamily:FONT_MONO, cursor:"pointer", letterSpacing:"0.08em", textTransform:"uppercase", opacity:loadingMore?0.5:1 }}>
            {loadingMore ? "Loading…" : `Load more (50 at a time)`}
          </button>
        </div>
      )}
    </Card>
  );
}

// ─── Security page ────────────────────────────────────────────────────────────
function SecurityPage() {
  const currentUser = useUser();
  const isAdmin = currentUser?.role === "admin";

  const [alerts,    setAlerts]    = useState([]);
  const [policies,      setPolicies]      = useState([]);
  const [audit,         setAudit]         = useState([]);
  const [auditOffset,   setAuditOffset]   = useState(0);
  const [auditHasMore,  setAuditHasMore]  = useState(false);
  const [auditLoading,  setAuditLoading]  = useState(false);
  const AUDIT_PAGE = 50;
  const [scanText,  setScanText]  = useState("");
  const [scanResult,setScanResult]= useState(null);
  const [scanning,  setScanning]  = useState(false);
  const [pForm,     setPForm]     = useState({ team:"", rule_type:"block_model", value:"*" });
  const [saving,    setSaving]    = useState(false);
  const [loading,   setLoading]   = useState(true);

  const loadAudit = useCallback(async (offset = 0, append = false) => {
    if (!isAdmin) return;
    setAuditLoading(true);
    try {
      const r = await authFetch(`${BASE}/audit?sensitive_only=false&blocked_only=false&limit=${AUDIT_PAGE + 1}&skip=${offset}`);
      if (!r?.ok) return;
      const rows = await r.json();
      const hasMore = rows.length > AUDIT_PAGE;
      const page = rows.slice(0, AUDIT_PAGE);
      setAudit(prev => append ? [...prev, ...page] : page);
      setAuditHasMore(hasMore);
      setAuditOffset(offset + AUDIT_PAGE);
    } catch { /* ignore */ }
    finally { setAuditLoading(false); }
  }, [isAdmin]);

  const load = useCallback(async () => {
    try {
      const fetchers = [
        authFetch(`${BASE}/security/alerts`).then((x) => x.json()),
      ];
      if (isAdmin) {
        fetchers.push(
          authFetch(`${BASE}/policies`).then((x) => x.json()),
        );
      }
      const [a, p] = await Promise.all(fetchers);
      setAlerts(a);
      if (p) setPolicies(p);
      if (isAdmin) await loadAudit(0, false);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [isAdmin, loadAudit]);

  useEffect(() => { load(); }, [load]);

  const handleScan = async () => {
    if (!scanText.trim()) return;
    setScanning(true);
    try {
      const r = await authFetch(`${BASE}/security/scan`, {
        method: "POST",
        body: JSON.stringify({ text: scanText }),
      });
      setScanResult(await r.json());
    } finally { setScanning(false); }
  };

  const handleCreatePolicy = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await authFetch(`${BASE}/policies`, {
        method: "POST",
        body: JSON.stringify(pForm),
      });
      setPForm({ team:"", rule_type:"block_model", value:"*" });
      await load();
    } finally { setSaving(false); }
  };

  const handleDeletePolicy = async (id) => {
    await authFetch(`${BASE}/policies/${id}`, { method:"DELETE" });
    await load();
  };

  const sevColor = (s) => s==="critical"?T.crit:s==="high"?T.warn:s==="medium"?T.info:T.textDim;
  const alertColor = (s) => s==="critical"?T.crit:s==="warning"?T.warn:T.info;

  if (loading) return <div style={{ color:T.textDim, fontFamily:FONT_MONO, padding:24 }}>Loading security data…</div>;

  const sensitiveCount = audit.filter((r) => r.sensitive).length;
  const blockedCount   = audit.filter((r) => r.blocked).length;

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:14 }}>

      {/* KPI strip */}
      {(() => {
        const kpis = [
          { label:"Live Alerts",    value:alerts.length,   color:alerts.length>0?T.crit:T.accent },
          ...(isAdmin ? [
            { label:"Policy Rules",   value:policies.length, color:T.info },
            { label:"Sensitive Reqs", value:sensitiveCount,  color:sensitiveCount>0?T.warn:T.accent },
            { label:"Blocked Reqs",   value:blockedCount,    color:blockedCount>0?T.crit:T.accent },
          ] : []),
        ];
        return (
          <div style={{ display:"grid", gridTemplateColumns:`repeat(${kpis.length},1fr)`, gap:12 }}>
            {kpis.map((k) => (
              <div key={k.label} style={{ background:T.panel, border:`1px solid ${T.border}`, borderRadius:8, padding:16 }}>
                <div style={{ fontSize:10, fontFamily:FONT_MONO, letterSpacing:"0.12em", textTransform:"uppercase", color:T.textDim }}>{k.label}</div>
                <div style={{ fontSize:32, fontFamily:FONT_MONO, fontWeight:500, color:k.color, marginTop:8, lineHeight:1 }}>{k.value}</div>
              </div>
            ))}
          </div>
        );
      })()}

      {/* Live alerts */}
      <Card title="Live Security Alerts" subtitle="Detected from real telemetry data">
        {alerts.length === 0 ? (
          <div style={{ color:T.accent, fontFamily:FONT_MONO, fontSize:13, padding:"16px 0" }}>✓ No security alerts detected</div>
        ) : (
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            {alerts.map((a, i) => (
              <div key={i} style={{ padding:"12px 14px", background:T.panelHi, borderLeft:`2px solid ${alertColor(a.sev)}`, borderRadius:4 }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
                  <div>
                    <div style={{ fontFamily:FONT_MONO, fontSize:10, color:alertColor(a.sev), letterSpacing:"0.08em", textTransform:"uppercase", marginBottom:4 }}>{a.type}</div>
                    <div style={{ fontSize:13, color:T.text }}>{a.msg}</div>
                    <div style={{ fontSize:11, color:T.textMute, marginTop:4 }}>Agent: {a.entity} · {a.action}</div>
                  </div>
                  <Pill color={alertColor(a.sev)}>{a.sev}</Pill>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* PII Scanner */}
      <Card title="PII / Sensitive Data Scanner" subtitle="Test any text for credentials, PII, and sensitive patterns">
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          <textarea
            value={scanText} onChange={(e) => setScanText(e.target.value)}
            placeholder="Paste a prompt or document to scan for sensitive data…"
            rows={4}
            style={{ width:"100%", background:T.panelHi, color:T.text, border:`1px solid ${T.border}`, borderRadius:4, padding:"10px 12px", fontSize:12, fontFamily:FONT_MONO, resize:"vertical", boxSizing:"border-box" }}
          />
          <div style={{ display:"flex", gap:10, alignItems:"center" }}>
            <button onClick={handleScan} disabled={scanning || !scanText.trim()}
              style={{ background:T.accent, color:T.bg, border:"none", padding:"8px 18px", borderRadius:4, fontSize:12, fontFamily:FONT_MONO, fontWeight:600, cursor:"pointer", opacity:scanning?0.6:1 }}>
              {scanning ? "Scanning…" : "Scan Text"}
            </button>
            {scanResult && (
              <Pill color={scanResult.is_sensitive ? T.crit : T.accent}>
                {scanResult.is_sensitive ? `${scanResult.findings.length} finding${scanResult.findings.length===1?"":"s"}` : "Clean"}
              </Pill>
            )}
          </div>
          {scanResult?.findings?.length > 0 && (
            <div style={{ display:"flex", flexDirection:"column", gap:6, marginTop:4 }}>
              {scanResult.findings.map((f, i) => (
                <div key={i} style={{ display:"flex", alignItems:"center", gap:12, padding:"8px 12px", background:T.panelHi, borderLeft:`2px solid ${sevColor(f.severity)}`, borderRadius:3 }}>
                  <Pill color={sevColor(f.severity)}>{f.severity}</Pill>
                  <span style={{ fontFamily:FONT_MONO, fontSize:12, color:T.text }}>{f.type}</span>
                  <span style={{ fontFamily:FONT_MONO, fontSize:11, color:T.textMute }}>{f.sample}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>

      {/* Policy rules — admin only */}
      {isAdmin && <Card title="Model Policy Rules" subtitle="Control which models each team is allowed to use. Team must match exactly what's sent in chat requests.">
        <form onSubmit={handleCreatePolicy} style={{ display:"flex", gap:10, flexWrap:"wrap", alignItems:"flex-end", marginBottom:16 }}>
          <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
            <label style={{ fontSize:9, fontFamily:FONT_MONO, letterSpacing:"0.12em", textTransform:"uppercase", color:T.textMute }}>Team * <span style={{ color:T.textMute, textTransform:"none", fontSize:9 }}>(or * for all)</span></label>
            <input value={pForm.team} onChange={(e) => setPForm({...pForm,team:e.target.value})}
              placeholder="e.g. SOC or *" required
              style={{ background:T.panelHi, color:T.text, border:`1px solid ${T.border}`, padding:"6px 10px", borderRadius:4, fontSize:12, fontFamily:FONT_MONO, width:160 }}
            />
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
            <label style={{ fontSize:9, fontFamily:FONT_MONO, letterSpacing:"0.12em", textTransform:"uppercase", color:T.textMute }}>Model *</label>
            <select value={pForm.value} onChange={(e) => setPForm({...pForm,value:e.target.value})}
              style={{ background:T.panelHi, color:T.text, border:`1px solid ${T.border}`, padding:"6px 10px", borderRadius:4, fontSize:12, fontFamily:FONT_MONO, minWidth:200 }}>
              <option value="*">* (all models)</option>
              {MODELS.map(m => <option key={m.name} value={m.name}>{m.name}</option>)}
            </select>
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
            <label style={{ fontSize:9, fontFamily:FONT_MONO, letterSpacing:"0.12em", textTransform:"uppercase", color:T.textMute }}>Rule Type</label>
            <select value={pForm.rule_type} onChange={(e) => setPForm({...pForm,rule_type:e.target.value})}
              style={{ background:T.panelHi, color:T.text, border:`1px solid ${T.border}`, padding:"6px 10px", borderRadius:4, fontSize:12, fontFamily:FONT_MONO, minWidth:150 }}>
              <option value="block_model">Block model</option>
              <option value="allow_model">Allow model (allowlist)</option>
            </select>
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:4, alignSelf:"flex-end" }}>
            <div style={{ fontSize:9, fontFamily:FONT_MONO, letterSpacing:"0.08em", color: pForm.rule_type==="block_model" ? T.crit : T.accent, marginBottom:8 }}>
              {pForm.rule_type==="block_model"
                ? `⊘ Will BLOCK "${pForm.value}" for team "${pForm.team}"`
                : `✓ Will ALLOW only "${pForm.value}" for team "${pForm.team}"`}
            </div>
          </div>
          <button type="submit" disabled={saving}
            style={{ background: pForm.rule_type==="block_model" ? T.crit : T.accent, color: pForm.rule_type==="block_model" ? "#fff" : T.bg, border:"none", padding:"8px 18px", borderRadius:4, fontSize:12, fontFamily:FONT_MONO, fontWeight:600, cursor:"pointer", opacity:saving?0.6:1 }}>
            {saving ? "Saving…" : "+ Add Policy"}
          </button>
        </form>

        {policies.length === 0 ? (
          <div style={{ color:T.textMute, fontFamily:FONT_MONO, fontSize:13, padding:"8px 0" }}>No policy rules configured. Add one above.</div>
        ) : (
          <table style={{ width:"100%", borderCollapse:"collapse" }}>
            <thead>
              <tr style={{ borderBottom:`1px solid ${T.border}` }}>
                {["Team","Rule Type","Model","Created",""].map((h) => (
                  <th key={h} style={{ textAlign:"left", padding:"10px 8px", fontFamily:FONT_MONO, fontSize:10, letterSpacing:"0.1em", textTransform:"uppercase", color:T.textDim, fontWeight:500 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {policies.map((r) => (
                <tr key={r.id} style={{ borderBottom:`1px solid ${T.border}` }}>
                  <td style={{ padding:"12px 8px", fontFamily:FONT_MONO, fontSize:12, color:T.text }}>{r.team}</td>
                  <td style={{ padding:"12px 8px" }}><Pill color={r.rule_type==="block_model"?T.crit:T.accent}>{r.rule_type}</Pill></td>
                  <td style={{ padding:"12px 8px", fontFamily:FONT_MONO, fontSize:12, color:T.text }}>{r.value}</td>
                  <td style={{ padding:"12px 8px", fontFamily:FONT_MONO, fontSize:11, color:T.textMute }}>{new Date(r.created_at).toLocaleDateString()}</td>
                  <td style={{ padding:"12px 8px" }}>
                    <button onClick={() => handleDeletePolicy(r.id)}
                      style={{ background:"transparent", border:`1px solid ${T.border}`, color:T.crit, padding:"4px 10px", borderRadius:3, fontSize:11, fontFamily:FONT_MONO, cursor:"pointer" }}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>}

      {/* Audit log — admin only */}
      {isAdmin && <AuditLogTable audit={audit} hasMore={auditHasMore} loadingMore={auditLoading} onLoadMore={() => loadAudit(auditOffset, true)} />}
    </div>
  );
}

// ─── User context & RBAC ──────────────────────────────────────────────────────
const UserContext = createContext(null);
const useUser = () => useContext(UserContext);

const ROLES = {
  admin:   { label:"Admin",   color: T.crit,   pages: ["home","chat","overview","cost","agents","models","workflows","alerts","budgets","security","users","apikeys","settings","integrations"] },
  analyst: { label:"Analyst", color: T.warn,   pages: ["home","chat","overview","cost","agents","models","workflows","alerts","security","integrations"] },
  viewer:  { label:"Viewer",  color: T.info,   pages: ["home","overview","cost","agents","models","workflows","alerts","security"] },
};

function canAccess(role, page) {
  return (ROLES[role]?.pages ?? []).includes(page);
}

// ─── Login Page ───────────────────────────────────────────────────────────────
function LoginPage({ onLogin }) {
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [loading,  setLoading]  = useState(false);
  const [err,      setErr]      = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    setLoading(true);
    try {
      const data = await apiLogin(email, password);
      setToken(data.access_token);
      onLogin(data.user, data.access_token);
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ position:"fixed", inset:0, background:T.bg, display:"flex", alignItems:"center", justifyContent:"center", zIndex:9999 }}>
      <form onSubmit={submit} style={{ background:T.panel, border:`1px solid ${T.borderHi}`, borderRadius:12, padding:40, width:380, display:"flex", flexDirection:"column", gap:22 }}>
        <div>
          <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:8 }}>
            <div style={{ width:22, height:22, background:T.accent, borderRadius:4, display:"flex", alignItems:"center", justifyContent:"center", fontFamily:FONT_MONO, fontWeight:600, fontSize:12, color:T.bg }}>◆</div>
            <span style={{ fontSize:15, fontWeight:500, letterSpacing:"-0.01em" }}>AIFinOps Guard</span>
          </div>
          <div style={{ fontSize:13, color:T.textDim }}>Sign in to your account</div>
        </div>
        <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
          {[
            { label:"Email", val:email, set:setEmail, type:"email",    placeholder:"you@company.com" },
            { label:"Password", val:password, set:setPassword, type:"password", placeholder:"••••••••" },
          ].map(({ label, val, set, type, placeholder }) => (
            <div key={label} style={{ display:"flex", flexDirection:"column", gap:5 }}>
              <label style={{ fontSize:9, fontFamily:FONT_MONO, letterSpacing:"0.12em", textTransform:"uppercase", color:T.textMute }}>{label}</label>
              <input type={type} value={val} onChange={e => set(e.target.value)} placeholder={placeholder} required
                style={{ background:T.panelHi, color:T.text, border:`1px solid ${T.border}`, padding:"9px 12px", borderRadius:6, fontSize:13, fontFamily:FONT_UI, outline:"none" }}/>
            </div>
          ))}
        </div>
        {err && <div style={{ fontSize:12, color:T.crit, fontFamily:FONT_MONO }}>{err}</div>}
        <button type="submit" disabled={loading}
          style={{ background:T.accent, color:T.bg, border:"none", padding:"12px 0", borderRadius:7, fontSize:13, fontFamily:FONT_MONO, fontWeight:600, cursor:"pointer", opacity:loading?0.6:1 }}>
          {loading ? "Signing in…" : "Sign in"}
        </button>
        <div style={{ fontSize:11, color:T.textMute, fontFamily:FONT_MONO, textAlign:"center" }}>
          Default: admin@aifinops.local / Admin123!
        </div>
      </form>
    </div>
  );
}

function SortableUsersTable({ users, currentUser, editing, editSaving, setEditing, saveEdit, cancelEdit, handleToggle, handleDelete, inlineInput, inlineSelect, onChangePassword }) {
  const { sortKey, sortDir, toggle, sort } = useSortable("created_at");
  const colKey = { "Name":"name","Email":"email","Role":"role","Team":"team","Status":"is_active","Created":"created_at" };
  const sorted = sort(users, (u, k) => {
    if (k === "created_at") return new Date(u.created_at).getTime();
    if (k === "is_active")  return u.is_active ? 1 : 0;
    return u[k] || "";
  });
  const { query, setQuery, filtered } = useSearch(sorted, u => `${u.name} ${u.email} ${u.role} ${u.team||""}`);
  return (
    <>
    <SearchBox query={query} onChange={setQuery} placeholder="Search name, email, role, team…" count={filtered.length} total={users.length} />
    <table style={{ width:"100%", borderCollapse:"collapse" }}>
      <thead>
        <tr style={{ borderBottom:`1px solid ${T.border}` }}>
          {["Name","Email","Role","Team","Status","Created",""].map(h => h === "" ? (
            <th key={h} style={{ padding:"10px 8px" }} />
          ) : (
            <SortableTh key={h} label={h} sortKey={colKey[h]} active={sortKey===colKey[h]} dir={sortDir} onToggle={toggle} />
          ))}
        </tr>
      </thead>
      <tbody>
        {filtered.map(u => {
          const isEditing = editing?.id === u.id;
          const isSelf    = u.id === currentUser?.id;
          return (
            <tr key={u.id} style={{ borderBottom:`1px solid ${T.border}`, opacity:u.is_active?1:0.5, background: isEditing ? `${T.accent}06` : "transparent" }}>
              <td style={{ padding:"12px 8px", fontSize:12, color:T.text, fontWeight:500 }}>{u.name}</td>
              <td style={{ padding:"12px 8px", fontFamily:FONT_MONO, fontSize:11, color:T.textDim }}>{u.email}</td>
              <td style={{ padding:"10px 8px" }}>
                {isEditing
                  ? inlineSelect(editing.role, v => setEditing({...editing, role:v}), Object.entries(ROLES).map(([r, m]) => [r, m.label]))
                  : <Pill color={ROLES[u.role]?.color ?? T.textDim}>{u.role}</Pill>}
              </td>
              <td style={{ padding:"10px 8px" }}>
                {isEditing
                  ? inlineInput(editing.team, v => setEditing({...editing, team:v}), 90)
                  : <span style={{ fontSize:12, color:T.textDim }}>{u.team || "—"}</span>}
              </td>
              <td style={{ padding:"12px 8px" }}>{u.is_active ? <Pill color={T.accent}>active</Pill> : <Pill color={T.textMute}>inactive</Pill>}</td>
              <td style={{ padding:"12px 8px", fontFamily:FONT_MONO, fontSize:11, color:T.textMute }}>{new Date(u.created_at).toLocaleDateString()}</td>
              <td style={{ padding:"10px 8px" }}>
                <div style={{ display:"flex", gap:6, flexWrap:"nowrap" }}>
                  {isEditing ? (
                    <>
                      <button onClick={saveEdit} disabled={editSaving}
                        style={{ background:`${T.accent}20`, border:`1px solid ${T.accent}55`, color:T.accent, padding:"4px 12px", borderRadius:3, fontSize:11, fontFamily:FONT_MONO, cursor:"pointer", fontWeight:600, opacity:editSaving?0.6:1 }}>
                        {editSaving ? "…" : "Save"}
                      </button>
                      <button onClick={cancelEdit}
                        style={{ background:"transparent", border:`1px solid ${T.border}`, color:T.textDim, padding:"4px 10px", borderRadius:3, fontSize:11, fontFamily:FONT_MONO, cursor:"pointer" }}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => setEditing({ id: u.id, role: u.role, team: u.team || "" })}
                        style={{ background:`${T.info}15`, border:`1px solid ${T.info}44`, color:T.info, padding:"4px 10px", borderRadius:3, fontSize:11, fontFamily:FONT_MONO, cursor:"pointer" }}>
                        Edit
                      </button>
                      <button onClick={() => onChangePassword && onChangePassword(u)}
                        style={{ background:`${T.accent}12`, border:`1px solid ${T.accent}44`, color:T.accent, padding:"4px 10px", borderRadius:3, fontSize:11, fontFamily:FONT_MONO, cursor:"pointer" }}>
                        Password
                      </button>
                      <button onClick={() => handleToggle(u)}
                        style={{ background:"transparent", border:`1px solid ${T.border}`, color:u.is_active?T.warn:T.accent, padding:"4px 10px", borderRadius:3, fontSize:11, fontFamily:FONT_MONO, cursor:"pointer" }}>
                        {u.is_active ? "Disable" : "Enable"}
                      </button>
                      <button onClick={() => handleDelete(u.id)} disabled={isSelf}
                        style={{ background:"transparent", border:`1px solid ${T.border}`, color:isSelf?T.textMute:T.crit, padding:"4px 10px", borderRadius:3, fontSize:11, fontFamily:FONT_MONO, cursor:isSelf?"not-allowed":"pointer", opacity:isSelf?0.4:1 }}
                        title={isSelf ? "Cannot delete your own account" : ""}>
                        Delete
                      </button>
                    </>
                  )}
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
    </>
  );
}

// ─── Users Page (admin only) ──────────────────────────────────────────────────
// ─── API Keys page ────────────────────────────────────────────────────────────
function ApiKeysPage() {
  const [keys,      setKeys]      = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [form,      setForm]      = useState({ name: "", team: "" });
  const [saving,    setSaving]    = useState(false);
  const [err,       setErr]       = useState(null);
  const [newKey,    setNewKey]    = useState(null); // shown-once modal

  const load = useCallback(async () => {
    try { setKeys(await fetchApiKeys()); }
    catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) { setErr("Name is required."); return; }
    setSaving(true); setErr(null);
    try {
      const created = await createApiKey({ name: form.name.trim(), team: form.team.trim() || "unknown" });
      setNewKey(created.key);
      setForm({ name: "", team: "" });
      await load();
    } catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  };

  const handleRevoke = async (id) => {
    try { await revokeApiKey(id); await load(); }
    catch (e) { setErr(e.message); }
  };

  const handleDelete = async (id) => {
    try { await deleteApiKey(id); await load(); }
    catch (e) { setErr(e.message); }
  };

  const fmtDate = (d) => d ? new Date(d).toLocaleString() : "—";

  const inputStyle = { background: T.panelHi, color: T.text, border: `1px solid ${T.border}`,
    padding: "6px 10px", borderRadius: 4, fontSize: 12, fontFamily: FONT_MONO, width: 200 };

  if (loading) return <div style={{ color: T.textDim, fontFamily: FONT_MONO, padding: 24 }}>Loading…</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

      {/* ── Create key ── */}
      <Card title="Issue API Key" subtitle="Keys authenticate agents against the gateway — stored as SHA-256 hash, shown once">
        <form onSubmit={handleCreate} style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          {[
            { label: "Name *", key: "name", placeholder: "e.g. soc-agent-prod" },
            { label: "Team",   key: "team", placeholder: "e.g. SOC" },
          ].map(({ label, key, placeholder }) => (
            <div key={key} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label style={{ fontSize: 9, fontFamily: FONT_MONO, letterSpacing: "0.12em", textTransform: "uppercase", color: T.textMute }}>{label}</label>
              <input type="text" placeholder={placeholder} value={form[key]}
                onChange={e => setForm({ ...form, [key]: e.target.value })}
                style={inputStyle} />
            </div>
          ))}
          <button type="submit" disabled={saving}
            style={{ background: T.accent, color: T.bg, border: "none", padding: "8px 18px", borderRadius: 4, fontSize: 12, fontFamily: FONT_MONO, fontWeight: 600, cursor: "pointer", opacity: saving ? 0.6 : 1 }}>
            {saving ? "Generating…" : "+ Generate Key"}
          </button>
        </form>
        {err && <div style={{ color: T.crit, fontFamily: FONT_MONO, fontSize: 12, marginTop: 10 }}>{err}</div>}
      </Card>

      {/* ── Keys table ── */}
      <Card title="Issued Keys" subtitle={`${keys.length} key${keys.length === 1 ? "" : "s"} — the full key is never stored or retrievable`}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${T.border}` }}>
              {["Name", "Prefix", "Team", "Created", "Last Used", "Status", ""].map(h => (
                <th key={h} style={{ padding: "10px 8px", textAlign: "left", fontSize: 10, fontFamily: FONT_MONO, letterSpacing: "0.1em", textTransform: "uppercase", color: T.textMute }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {keys.length === 0 && (
              <tr><td colSpan={7} style={{ padding: 20, textAlign: "center", color: T.textMute, fontFamily: FONT_MONO, fontSize: 12 }}>No API keys yet.</td></tr>
            )}
            {keys.map(k => (
              <tr key={k.id} style={{ borderBottom: `1px solid ${T.border}`, opacity: k.is_active ? 1 : 0.45 }}>
                <td style={{ padding: "12px 8px", fontSize: 12, color: T.text, fontWeight: 500 }}>{k.name}</td>
                <td style={{ padding: "12px 8px", fontFamily: FONT_MONO, fontSize: 11, color: T.textDim }}>{k.key_prefix}…</td>
                <td style={{ padding: "12px 8px", fontSize: 12, color: T.textDim }}>{k.team}</td>
                <td style={{ padding: "12px 8px", fontFamily: FONT_MONO, fontSize: 11, color: T.textMute }}>{fmtDate(k.created_at)}</td>
                <td style={{ padding: "12px 8px", fontFamily: FONT_MONO, fontSize: 11, color: T.textMute }}>{fmtDate(k.last_used_at)}</td>
                <td style={{ padding: "12px 8px" }}>
                  {k.is_active ? <Pill color={T.accent}>active</Pill> : <Pill color={T.textMute}>revoked</Pill>}
                </td>
                <td style={{ padding: "10px 8px" }}>
                  <div style={{ display: "flex", gap: 6 }}>
                    {k.is_active && (
                      <button onClick={() => handleRevoke(k.id)}
                        style={{ background: "transparent", border: `1px solid ${T.border}`, color: T.warn, padding: "4px 10px", borderRadius: 3, fontSize: 11, fontFamily: FONT_MONO, cursor: "pointer" }}>
                        Revoke
                      </button>
                    )}
                    <button onClick={() => handleDelete(k.id)}
                      style={{ background: "transparent", border: `1px solid ${T.border}`, color: T.crit, padding: "4px 10px", borderRadius: 3, fontSize: 11, fontFamily: FONT_MONO, cursor: "pointer" }}>
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {/* ── Show-once modal ── */}
      {newKey && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div style={{ background: T.panel, border: `1px solid ${T.accent}66`, borderRadius: 8, padding: 28, maxWidth: 540, width: "90%", display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ fontFamily: FONT_MONO, fontWeight: 700, color: T.accent, fontSize: 14 }}>⚠ Copy your API key — shown only once</div>
            <div style={{ fontFamily: FONT_MONO, fontSize: 11, color: T.textDim, lineHeight: 1.6 }}>
              This key will <strong style={{ color: T.text }}>never be shown again</strong>. Copy it now and store it in a secrets manager (e.g. Render Secret Files, GitHub Actions secrets).
            </div>
            <div style={{ background: T.panelHi, border: `1px solid ${T.border}`, borderRadius: 4, padding: "10px 14px", fontFamily: FONT_MONO, fontSize: 12, color: T.text, wordBreak: "break-all", userSelect: "all" }}>
              {newKey}
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button onClick={() => navigator.clipboard.writeText(newKey).catch(() => {})}
                style={{ background: `${T.accent}20`, border: `1px solid ${T.accent}55`, color: T.accent, padding: "7px 16px", borderRadius: 4, fontSize: 12, fontFamily: FONT_MONO, cursor: "pointer" }}>
                Copy to clipboard
              </button>
              <button onClick={() => setNewKey(null)}
                style={{ background: T.accent, color: T.bg, border: "none", padding: "7px 18px", borderRadius: 4, fontSize: 12, fontFamily: FONT_MONO, fontWeight: 600, cursor: "pointer" }}>
                I've saved it — close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


function UsersPage() {
  const currentUser = useUser();
  const [users,    setUsers]    = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [form,     setForm]     = useState({ email:"", name:"", password:"", role:"analyst", team:"" });
  const [saving,   setSaving]   = useState(false);
  const [err,      setErr]      = useState(null);
  // editing: { id, role, team } | null
  const [editing,  setEditing]  = useState(null);
  const [editSaving, setEditSaving] = useState(false);
  // password change modal: { id, name } | null
  const [pwModal,   setPwModal]   = useState(null);
  const [pwOld,     setPwOld]     = useState("");
  const [pwNew,     setPwNew]     = useState("");
  const [pwConfirm, setPwConfirm] = useState("");
  const [pwSaving,  setPwSaving]  = useState(false);
  const [pwErr,     setPwErr]     = useState(null);

  const load = useCallback(async () => {
    try {
      const data = await fetchUsers();
      setUsers(data);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async (e) => {
    e.preventDefault();
    setSaving(true); setErr(null);
    try {
      await createUser(form);
      setForm({ email:"", name:"", password:"", role:"analyst", team:"" });
      await load();
    } catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  };

  const handleToggle = async (u) => {
    try { await updateUser(u.id, { is_active: !u.is_active }); await load(); }
    catch (e) { setErr(e.message); }
  };

  const handleDelete = async (id) => {
    try { await deleteUser(id); await load(); }
    catch (e) { setErr(e.message); }
  };

  const startEdit = (u) => setEditing({ id: u.id, role: u.role, team: u.team || "" });
  const cancelEdit = () => setEditing(null);

  const saveEdit = async () => {
    setEditSaving(true); setErr(null);
    try {
      await updateUser(editing.id, { role: editing.role, team: editing.team });
      setEditing(null);
      await load();
    } catch (e) { setErr(e.message); }
    finally { setEditSaving(false); }
  };

  const openPwModal = (u) => { setPwModal(u); setPwOld(""); setPwNew(""); setPwConfirm(""); setPwErr(null); };
  const closePwModal = () => { setPwModal(null); setPwOld(""); setPwNew(""); setPwConfirm(""); setPwErr(null); };

  const savePassword = async () => {
    if (!pwOld) { setPwErr("Current password is required."); return; }
    if (pwNew.length < 8) { setPwErr("New password must be at least 8 characters."); return; }
    if (pwNew !== pwConfirm) { setPwErr("Passwords do not match."); return; }
    setPwSaving(true); setPwErr(null);
    try {
      await updateUser(pwModal.id, { password: pwNew, current_password: pwOld });
      closePwModal();
    } catch (e) { setPwErr(e.message); }
    finally { setPwSaving(false); }
  };

  const inlineInput = (val, onChange, width = 100) => (
    <input value={val} onChange={e => onChange(e.target.value)}
      style={{ background:T.bg, color:T.text, border:`1px solid ${T.accent}44`, padding:"4px 8px", borderRadius:4, fontSize:12, fontFamily:FONT_MONO, width }} />
  );

  const inlineSelect = (val, onChange, options) => (
    <select value={val} onChange={e => onChange(e.target.value)}
      style={{ background:T.bg, color:T.text, border:`1px solid ${T.accent}44`, padding:"4px 8px", borderRadius:4, fontSize:12, fontFamily:FONT_MONO }}>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );

  if (loading) return <div style={{ color:T.textDim, fontFamily:FONT_MONO, padding:24 }}>Loading users…</div>;

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
      <Card title="Add User" subtitle="Create a new platform user">
        <form onSubmit={handleCreate} style={{ display:"flex", gap:10, flexWrap:"wrap", alignItems:"flex-end" }}>
          {[
            { label:"Email *",    key:"email",    placeholder:"ron@company.com", type:"email" },
            { label:"Name *",     key:"name",     placeholder:"Ron Haviv" },
            { label:"Password *", key:"password", placeholder:"min 8 chars", type:"password" },
            { label:"Team",       key:"team",     placeholder:"SOC" },
          ].map(({ label, key, placeholder, type }) => (
            <div key={key} style={{ display:"flex", flexDirection:"column", gap:4 }}>
              <label style={{ fontSize:9, fontFamily:FONT_MONO, letterSpacing:"0.12em", textTransform:"uppercase", color:T.textMute }}>{label}</label>
              <input type={type||"text"} placeholder={placeholder} value={form[key]}
                onChange={e => setForm({...form,[key]:e.target.value})}
                required={label.includes("*")}
                style={{ background:T.panelHi, color:T.text, border:`1px solid ${T.border}`, padding:"6px 10px", borderRadius:4, fontSize:12, fontFamily:FONT_MONO, width:160 }}/>
            </div>
          ))}
          <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
            <label style={{ fontSize:9, fontFamily:FONT_MONO, letterSpacing:"0.12em", textTransform:"uppercase", color:T.textMute }}>Role</label>
            <select value={form.role} onChange={e => setForm({...form, role:e.target.value})}
              style={{ background:T.panelHi, color:T.text, border:`1px solid ${T.border}`, padding:"6px 10px", borderRadius:4, fontSize:12, fontFamily:FONT_MONO, minWidth:120 }}>
              {Object.entries(ROLES).map(([r, m]) => <option key={r} value={r}>{m.label}</option>)}
            </select>
          </div>
          <button type="submit" disabled={saving}
            style={{ background:T.accent, color:T.bg, border:"none", padding:"8px 18px", borderRadius:4, fontSize:12, fontFamily:FONT_MONO, fontWeight:600, cursor:"pointer", opacity:saving?0.6:1 }}>
            {saving ? "Saving…" : "+ Add User"}
          </button>
        </form>
        {err && <div style={{ color:T.crit, fontFamily:FONT_MONO, fontSize:12, marginTop:10 }}>{err}</div>}
      </Card>

      <Card title="Platform Users" subtitle={`${users.length} user${users.length===1?"":"s"} registered — click Edit to change role or team`}>
        <SortableUsersTable users={users} currentUser={currentUser} editing={editing} editSaving={editSaving}
          setEditing={setEditing} saveEdit={saveEdit} cancelEdit={cancelEdit}
          handleToggle={handleToggle} handleDelete={handleDelete}
          inlineInput={inlineInput} inlineSelect={inlineSelect}
          onChangePassword={openPwModal} />
      </Card>

      {/* ── Change Password Modal ── */}
      {pwModal && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.6)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:1000 }}>
          <div style={{ background:T.panel, border:`1px solid ${T.border}`, borderRadius:8, padding:28, minWidth:340, display:"flex", flexDirection:"column", gap:16 }}>
            <div style={{ fontFamily:FONT_MONO, fontWeight:700, color:T.text, fontSize:14 }}>Change Password — {pwModal.name}</div>
            {[
              { label:"Current Password", val:pwOld,     set:setPwOld },
              { label:"New Password",     val:pwNew,     set:setPwNew },
              { label:"Confirm Password", val:pwConfirm, set:setPwConfirm },
            ].map(({ label, val, set }) => (
              <div key={label} style={{ display:"flex", flexDirection:"column", gap:4 }}>
                <label style={{ fontSize:9, fontFamily:FONT_MONO, letterSpacing:"0.12em", textTransform:"uppercase", color:T.textMute }}>{label}</label>
                <input type="password" value={val} onChange={e => set(e.target.value)} placeholder="min 8 characters"
                  style={{ background:T.panelHi, color:T.text, border:`1px solid ${T.border}`, padding:"8px 12px", borderRadius:4, fontSize:13, fontFamily:FONT_MONO, width:"100%", boxSizing:"border-box" }} />
              </div>
            ))}
            {pwErr && <div style={{ color:T.crit, fontFamily:FONT_MONO, fontSize:12 }}>{pwErr}</div>}
            <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
              <button onClick={closePwModal} style={{ background:"transparent", color:T.textDim, border:`1px solid ${T.border}`, padding:"7px 16px", borderRadius:4, fontSize:12, fontFamily:FONT_MONO, cursor:"pointer" }}>
                Cancel
              </button>
              <button onClick={savePassword} disabled={pwSaving}
                style={{ background:T.accent, color:T.bg, border:"none", padding:"7px 18px", borderRadius:4, fontSize:12, fontFamily:FONT_MONO, fontWeight:600, cursor:"pointer", opacity:pwSaving?0.6:1 }}>
                {pwSaving ? "Saving…" : "Save Password"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Chat page ────────────────────────────────────────────────────────────────
const CHAT_MODELS = [
  "gpt-4o-mini","gpt-4o","gpt-4.1","gpt-4.1-mini","o4-mini","o3",
  "claude-sonnet-4-5","claude-opus-4-5","claude-haiku-4-5",
  "gemini-2.0-flash","gemini-2.5-pro","gemini-1.5-pro",
];

const SESSION_TIMEOUT_MS  = 30 * 60 * 1000;   // 30 minutes
const SESSION_WARN_MS     = 5  * 60 * 1000;   // warn 5 min before

const CHAT_SESSION_KEY = "guardChatSessionUuid";

function ChatPage() {
  const user = useUser();
  const isAdmin = user?.role === "admin";

  const [messages,      setMessages]      = useState([]);
  const [input,         setInput]         = useState("");
  const [sending,       setSending]       = useState(false);
  // Non-admin: team is locked to their own team. Admin: editable.
  const [team,          setTeam]          = useState(user?.team || "SOC");
  const [agent,         setAgent]         = useState("IR-Agent");
  const [model,         setModel]         = useState("gpt-4o-mini");
  const [systemPrompt,  setSystemPrompt]  = useState("");
  const [showSystem,    setShowSystem]    = useState(false);
  const [error,         setError]         = useState(null);
  const [totalCost,     setTotalCost]     = useState(0);
  const [totalTokens,   setTotalTokens]   = useState(0);
  const [restoring,     setRestoring]     = useState(true); // true until mount restore attempt done

  // Session state
  const [sessionUuid,   setSessionUuid]   = useState(null);
  const [sessionClosed, setSessionClosed] = useState(false);
  const [timeoutSecsLeft, setTimeoutSecsLeft] = useState(null);
  const lastActivityRef  = useRef(Date.now());
  const timerRef         = useRef(null);

  // Mode: "chat" = multi-turn /sessions/{uuid}/chat | "ask" = single-shot /ask
  const [mode, setMode] = useState("chat");

  // Active sessions panel
  const [activeSessions, setActiveSessions] = useState([]);
  const [showSessions,   setShowSessions]   = useState(false);

  const bottomRef = useRef(null);
  const knownMsgCountRef = useRef(0);

  // ── Restore session from localStorage on mount ──
  useEffect(() => {
    const restore = async () => {
      const saved = localStorage.getItem(CHAT_SESSION_KEY);
      if (saved) {
        try {
          const sr = await authFetch(`${BASE}/sessions/${saved}`);
          if (sr?.ok) {
            const session = await sr.json();
            if (session.is_active) {
              const mr = await authFetch(`${BASE}/sessions/${saved}/messages`);
              if (mr?.ok) {
                const msgs = await mr.json();
                if (msgs.length > 0) {
                  const rebuilt = msgs.map(m => ({
                    role: m.role, content: m.content,
                    ...(m.role === "assistant" ? { meta: {
                      model: session.model,
                      tokens: m.prompt_tokens + m.completion_tokens,
                      cost: m.cost_usd, latency: m.latency_ms,
                      findings: JSON.parse(m.security_findings || "[]"),
                      warnings: JSON.parse(m.budget_warnings   || "[]"),
                    }} : {}),
                  }));
                  setMessages(rebuilt);
                  setTotalCost(msgs.filter(m=>m.role==="assistant").reduce((a,m)=>a+m.cost_usd,0));
                  setTotalTokens(msgs.reduce((a,m)=>a+m.prompt_tokens+m.completion_tokens,0));
                  knownMsgCountRef.current = msgs.length;
                  setTeam(session.team);
                  setAgent(session.agent);
                  setModel(session.model);
                  setSessionUuid(saved);
                }
              }
            } else {
              localStorage.removeItem(CHAT_SESSION_KEY);
            }
          } else {
            localStorage.removeItem(CHAT_SESSION_KEY);
          }
        } catch { localStorage.removeItem(CHAT_SESSION_KEY); }
      }
      setRestoring(false);
    };
    restore();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Persist session UUID to localStorage ──
  useEffect(() => {
    if (sessionUuid) localStorage.setItem(CHAT_SESSION_KEY, sessionUuid);
  }, [sessionUuid]);

  // ── Scroll to bottom on new messages ──
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const [sessionTab, setSessionTab] = useState("active"); // "active" | "recent"
  const [allSessions, setAllSessions] = useState([]);

  // ── Poll sessions every 10s ──
  useEffect(() => {
    const fetchSessions = async () => {
      try {
        const [activeR, allR] = await Promise.all([
          authFetch(`${BASE}/sessions?active_only=true`),
          authFetch(`${BASE}/sessions?active_only=false`),
        ]);
        if (activeR?.ok) setActiveSessions(await activeR.json());
        if (allR?.ok)    setAllSessions(await allR.json());
      } catch { /* ignore */ }
    };
    fetchSessions();
    const id = setInterval(fetchSessions, 10_000);
    return () => clearInterval(id);
  }, []);

  // ── Poll current session for external messages (e.g. from /ask) ──
  useEffect(() => {
    if (!sessionUuid || sessionClosed) return;
    const poll = async () => {
      try {
        const r = await authFetch(`${BASE}/sessions/${sessionUuid}/messages`);
        if (!r?.ok) return;
        const dbMsgs = await r.json();
        // Only act if DB has more messages than we've tracked
        if (dbMsgs.length <= knownMsgCountRef.current) return;
        knownMsgCountRef.current = dbMsgs.length;
        // Rebuild full message list from DB so external /ask calls appear
        setMessages(dbMsgs.map(m => ({
          role: m.role,
          content: m.content,
          ...(m.role === "assistant" ? {
            meta: {
              model: model,
              tokens: m.prompt_tokens + m.completion_tokens,
              cost: m.cost_usd,
              latency: m.latency_ms,
              findings: JSON.parse(m.security_findings || "[]"),
              warnings: JSON.parse(m.budget_warnings   || "[]"),
            }
          } : {}),
        })));
        const totalC = dbMsgs.filter(m => m.role==="assistant").reduce((a, m) => a + m.cost_usd, 0);
        const totalT = dbMsgs.reduce((a, m) => a + m.prompt_tokens + m.completion_tokens, 0);
        setTotalCost(totalC);
        setTotalTokens(totalT);
      } catch { /* ignore */ }
    };
    const id = setInterval(poll, 4_000);
    return () => clearInterval(id);
  }, [sessionUuid, sessionClosed]);

  // ── Inactivity timer ──
  useEffect(() => {
    if (!sessionUuid || sessionClosed) return;
    timerRef.current = setInterval(() => {
      const idle = Date.now() - lastActivityRef.current;
      const remaining = SESSION_TIMEOUT_MS - idle;
      if (remaining <= 0) {
        clearInterval(timerRef.current);
        setSessionClosed(true);
        setTimeoutSecsLeft(0);
        authFetch(`${BASE}/sessions/${sessionUuid}`, { method: "DELETE" }).catch(() => {});
      } else {
        setTimeoutSecsLeft(remaining <= SESSION_WARN_MS ? Math.ceil(remaining / 1000) : null);
      }
    }, 5000);
    return () => clearInterval(timerRef.current);
  }, [sessionUuid, sessionClosed]);

  const resetTimer = () => { lastActivityRef.current = Date.now(); setTimeoutSecsLeft(null); };

  // ── Create or reuse session ──
  const ensureSession = async () => {
    if (sessionUuid) return sessionUuid;
    const r = await authFetch(`${BASE}/sessions`, {
      method: "POST",
      body: JSON.stringify({ team, agent, model }),
    });
    if (!r?.ok) throw new Error("Failed to create session");
    const data = await r.json();
    knownMsgCountRef.current = 0;
    setSessionUuid(data.session_uuid);
    return data.session_uuid;
  };

  const send = async () => {
    const text = input.trim();
    if (!text || sending || sessionClosed) return;
    setInput("");
    setError(null);
    resetTimer();

    const userMsg = { role: "user", content: text };
    setMessages(prev => [...prev, userMsg]);
    setSending(true);

    try {
      if (mode === "chat") {
        // ── Multi-turn: pass full history, session-tracked ──
        const newHistory = [...messages.filter(m => m.role !== "typing"), userMsg];
        const uuid = await ensureSession();
        const r = await authFetch(`${BASE}/sessions/${uuid}/chat`, {
          method: "POST",
          body: JSON.stringify({
            session_uuid: uuid,
            team, agent, model,
            system_prompt: systemPrompt || null,
            messages: newHistory.map(m => ({ role: m.role, content: m.content })),
          }),
        });
        if (!r.ok) { const e = await r.json(); throw new Error(e.detail || `HTTP ${r.status}`); }
        const data = await r.json();
        setMessages(prev => [...prev, {
          role: "assistant", content: data.reply,
          meta: { model: data.model, tokens: data.total_tokens, cost: data.cost_usd,
                  latency: data.latency_ms, findings: data.security_findings, warnings: data.budget_warnings },
        }]);
        setTotalCost(c  => c + data.cost_usd);
        setTotalTokens(t => t + data.total_tokens);
      } else {
        // ── Single-shot: independent /ask, no history, auto-creates session ──
        const r = await authFetch(`${BASE}/ask`, {
          method: "POST",
          body: JSON.stringify({
            team, agent, model,
            prompt: text,
            system_prompt: systemPrompt || null,
          }),
        });
        if (!r.ok) { const e = await r.json(); throw new Error(e.detail || `HTTP ${r.status}`); }
        const data = await r.json();
        setMessages(prev => [...prev, {
          role: "assistant", content: data.response,
          meta: { model: data.model, tokens: data.total_tokens, cost: data.cost_usd,
                  latency: data.latency_ms, findings: data.security_findings, warnings: data.budget_warnings },
          askSession: data.session_uuid,  // badge to show which auto-session was created
        }]);
        setTotalCost(c  => c + data.cost_usd);
        setTotalTokens(t => t + data.total_tokens);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setSending(false);
    }
  };

  const handleKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  };

  const clearChat = async () => {
    if (sessionUuid) {
      await authFetch(`${BASE}/sessions/${sessionUuid}`, { method: "DELETE" }).catch(() => {});
    }
    localStorage.removeItem(CHAT_SESSION_KEY);
    setMessages([]); setTotalCost(0); setTotalTokens(0); setError(null);
    setSessionUuid(null); setSessionClosed(false); setTimeoutSecsLeft(null);
    resetTimer();
  };

  const resumeSession = async (s) => {
    // Load history from old session, create a fresh active session, restore messages
    try {
      const r = await authFetch(`${BASE}/sessions/${s.session_uuid}/messages`);
      if (!r?.ok) throw new Error("Could not load messages");
      const msgs = await r.json();

      // Close current session if one is open
      if (sessionUuid) {
        await fetch(`${BASE}/sessions/${sessionUuid}`, { method: "DELETE" }).catch(() => {});
      }
      // Always close the source session — we continue it in a new one
      if (s.session_uuid !== sessionUuid) {
        await fetch(`${BASE}/sessions/${s.session_uuid}`, { method: "DELETE" }).catch(() => {});
      }

      // Create a new session inheriting the old config
      const nr = await authFetch(`${BASE}/sessions`, {
        method: "POST",
        body: JSON.stringify({
          team: s.team, agent: s.agent, model: s.model,
        }),
      });
      if (!nr?.ok) throw new Error("Could not create session");
      const newSession = await nr.json();

      // Rebuild message display from stored history
      const rebuilt = msgs.map(m => ({
        role: m.role,
        content: m.content,
        ...(m.role === "assistant" ? {
          meta: {
            model: s.model,
            tokens: m.prompt_tokens + m.completion_tokens,
            cost: m.cost_usd,
            latency: m.latency_ms,
            findings: JSON.parse(m.security_findings || "[]"),
            warnings: JSON.parse(m.budget_warnings   || "[]"),
          }
        } : {}),
      }));

      const totalC = msgs.filter(m => m.role==="assistant").reduce((a, m) => a + m.cost_usd, 0);
      const totalT = msgs.reduce((a, m) => a + m.prompt_tokens + m.completion_tokens, 0);

      setTeam(s.team); setAgent(s.agent); setModel(s.model);
      setMessages(rebuilt);
      setTotalCost(totalC);
      setTotalTokens(totalT);
      knownMsgCountRef.current = msgs.length;
      setSessionUuid(newSession.session_uuid);
      setSessionClosed(false);
      setError(null);
      resetTimer();
      setSessionTab("active");
    } catch (e) {
      setError(`Resume failed: ${e.message}`);
    }
  };

  const LabelSelect = ({ label, value, onChange, options, disabled }) => (
    <div style={{ display:"flex", flexDirection:"column", gap:3 }}>
      <label style={{ fontSize:9, fontFamily:FONT_MONO, letterSpacing:"0.12em", textTransform:"uppercase", color:T.textMute }}>{label}</label>
      <select value={value} onChange={e => onChange(e.target.value)} disabled={disabled}
        style={{ background:T.panelHi, color:disabled?T.textMute:T.text, border:`1px solid ${T.border}`, padding:"5px 8px", borderRadius:4, fontSize:11, fontFamily:FONT_MONO, minWidth:120, opacity:disabled?0.5:1 }}>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );

  const fmtSecs = (s) => s >= 60 ? `${Math.floor(s/60)}m ${s%60}s` : `${s}s`;
  const roleColor = ROLES[user?.role]?.color ?? T.textDim;

  if (restoring) return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:300, color:T.textDim, fontFamily:FONT_MONO, fontSize:13, gap:8 }}>
      <span style={{ color:T.accent }}>↻</span> Restoring session…
    </div>
  );

  return (
    <div style={{ display:"flex", gap:16, height:"calc(100vh - 120px)" }}>

      {/* ── Sessions Panel ── */}
      {showSessions && (
        <div style={{ width:270, background:T.panel, border:`1px solid ${T.border}`, borderRadius:8, display:"flex", flexDirection:"column", flexShrink:0, overflow:"hidden" }}>
          {/* Tab bar */}
          <div style={{ display:"flex", borderBottom:`1px solid ${T.border}` }}>
            {[["active","Active"], ["recent","Recent"]].map(([tab, label]) => (
              <button key={tab} onClick={() => setSessionTab(tab)}
                style={{ flex:1, padding:"10px 0", background: sessionTab===tab ? T.panelHi : "transparent",
                  border:"none", borderBottom: sessionTab===tab ? `2px solid ${T.accent}` : "2px solid transparent",
                  color: sessionTab===tab ? T.text : T.textDim, fontSize:11, fontFamily:FONT_MONO,
                  letterSpacing:"0.08em", textTransform:"uppercase", cursor:"pointer" }}>
                {label}
                {tab==="active" && activeSessions.length > 0 &&
                  <span style={{ marginLeft:6, background:T.accent, color:T.bg, fontSize:9, padding:"1px 5px", borderRadius:8 }}>{activeSessions.length}</span>}
              </button>
            ))}
          </div>

          <div style={{ flex:1, overflow:"auto", padding:10, display:"flex", flexDirection:"column", gap:8 }}>
            {sessionTab === "active" && (
              <>
                {(() => {
                  const visible = user?.role === "admin"
                    ? activeSessions
                    : activeSessions.filter(s => s.user_name === user?.name);
                  if (visible.length === 0) return (
                    <div style={{ color:T.textMute, fontSize:11, fontFamily:FONT_MONO, textAlign:"center", marginTop:20 }}>
                      {user?.role === "admin" ? "No active sessions" : "No active sessions for you"}
                    </div>
                  );
                  return visible.map(s => {
                  const isMe = s.session_uuid === sessionUuid;
                  const idleMins = Math.floor((Date.now() - new Date(s.last_activity_at).getTime()) / 60000);
                  const rc = ROLES[s.user_role]?.color ?? T.textDim;
                  return (
                    <div key={s.session_uuid}
                      style={{ background: isMe ? `${T.accent}10` : T.panelHi, border:`1px solid ${isMe ? T.accent+"44" : T.border}`, borderRadius:6, padding:"10px 12px", display:"flex", flexDirection:"column", gap:5 }}>
                      <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                        <div style={{ width:7, height:7, borderRadius:"50%", background:T.accent, flexShrink:0 }}/>
                        <span style={{ fontSize:12, fontWeight:500, flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{s.user_name}</span>
                        <span style={{ fontSize:9, fontFamily:FONT_MONO, color:rc, background:`${rc}18`, padding:"1px 5px", borderRadius:3 }}>{s.user_role}</span>
                      </div>
                      <div style={{ fontSize:10, fontFamily:FONT_MONO, color:T.textMute, display:"flex", flexDirection:"column", gap:2 }}>
                        <span>{s.team} / {s.agent}</span>
                        <span>{s.model}</span>
                        <div style={{ display:"flex", gap:8, marginTop:2 }}>
                          <span style={{ color:T.accent }}>${s.total_cost_usd.toFixed(5)}</span>
                          <span>{s.message_count} msg{s.message_count!==1?"s":""}</span>
                          <span style={{ color: idleMins > 20 ? T.warn : T.textMute }}>idle {idleMins}m</span>
                        </div>
                      </div>
                      {isMe
                        ? (
                          <div style={{ display:"flex", gap:6, marginTop:2 }}>
                            <div style={{ fontSize:9, fontFamily:FONT_MONO, color:T.accent, flex:1, alignSelf:"center" }}>← your session</div>
                            <button onClick={clearChat}
                              style={{ background:`${T.crit}15`, border:`1px solid ${T.crit}44`, color:T.crit, borderRadius:4, padding:"4px 10px", fontSize:10, fontFamily:FONT_MONO, cursor:"pointer" }}>
                              End
                            </button>
                          </div>
                        )
                        : (
                          <div style={{ display:"flex", gap:6, marginTop:2 }}>
                            <button onClick={() => resumeSession(s)}
                              style={{ flex:1, background:`${T.info}18`, border:`1px solid ${T.info}44`, color:T.info, borderRadius:4, padding:"4px 0", fontSize:10, fontFamily:FONT_MONO, cursor:"pointer" }}>
                              ↩ Resume
                            </button>
                            {(user?.role === "admin" || s.user_name === user?.name) && (
                              <button onClick={async () => {
                                await authFetch(`${BASE}/sessions/${s.session_uuid}`, { method:"DELETE" }).catch(()=>{});
                                setActiveSessions(prev => prev.filter(x => x.session_uuid !== s.session_uuid));
                              }}
                                style={{ background:`${T.crit}15`, border:`1px solid ${T.crit}44`, color:T.crit, borderRadius:4, padding:"4px 10px", fontSize:10, fontFamily:FONT_MONO, cursor:"pointer" }}>
                                End
                              </button>
                            )}
                          </div>
                        )
                      }
                    </div>
                  );
                  })
                })()}
              </>
            )}

            {sessionTab === "recent" && (
              <>
                {(() => {
                  const visible = user?.role === "admin"
                    ? allSessions
                    : allSessions.filter(s => s.user_name === user?.name);
                  if (visible.length === 0) return (
                    <div style={{ color:T.textMute, fontSize:11, fontFamily:FONT_MONO, textAlign:"center", marginTop:20 }}>No sessions yet</div>
                  );
                  return visible.map(s => {
                  const isActive = s.is_active;
                  const isMe = s.session_uuid === sessionUuid;
                  const rc = ROLES[s.user_role]?.color ?? T.textDim;
                  const when = new Date(s.last_activity_at);
                  const timeAgo = (() => {
                    const diff = (Date.now() - when.getTime()) / 1000;
                    if (diff < 60)   return `${Math.floor(diff)}s ago`;
                    if (diff < 3600) return `${Math.floor(diff/60)}m ago`;
                    if (diff < 86400) return `${Math.floor(diff/3600)}h ago`;
                    return when.toLocaleDateString();
                  })();
                  return (
                    <div key={s.session_uuid}
                      style={{ background: isMe ? `${T.accent}10` : T.panelHi, border:`1px solid ${isMe ? T.accent+"44" : T.border}`, borderRadius:6, padding:"10px 12px", display:"flex", flexDirection:"column", gap:5, opacity: isActive ? 1 : 0.75 }}>
                      <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                        <div style={{ width:7, height:7, borderRadius:"50%", background: isActive ? T.accent : T.textMute, flexShrink:0 }}/>
                        <span style={{ fontSize:12, fontWeight:500, flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{s.user_name}</span>
                        <span style={{ fontSize:9, fontFamily:FONT_MONO, color:rc, background:`${rc}18`, padding:"1px 5px", borderRadius:3 }}>{s.user_role}</span>
                      </div>
                      <div style={{ fontSize:10, fontFamily:FONT_MONO, color:T.textMute, display:"flex", flexDirection:"column", gap:2 }}>
                        <span>{s.team} / {s.agent}</span>
                        <span>{s.model}</span>
                        <div style={{ display:"flex", gap:8, marginTop:2 }}>
                          <span style={{ color:T.accent }}>${s.total_cost_usd.toFixed(5)}</span>
                          <span>{s.message_count} msg{s.message_count!==1?"s":""}</span>
                          <span style={{ color:T.textMute }}>{timeAgo}</span>
                        </div>
                      </div>
                      {!isMe && s.message_count > 0 && (
                        <button onClick={() => resumeSession(s)}
                          style={{ marginTop:2, background:`${T.info}18`, border:`1px solid ${T.info}44`, color:T.info, borderRadius:4, padding:"4px 0", fontSize:10, fontFamily:FONT_MONO, cursor:"pointer" }}>
                          ↩ Resume
                        </button>
                      )}
                      {isMe && <div style={{ fontSize:9, fontFamily:FONT_MONO, color:T.accent }}>← current session</div>}
                    </div>
                  );
                  })
                })()}
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Main chat area ── */}
      <div style={{ flex:1, display:"flex", flexDirection:"column", gap:12, minWidth:0 }}>

        {/* Timeout warning */}
        {timeoutSecsLeft !== null && !sessionClosed && (
          <div style={{ background:`${T.warn}15`, border:`1px solid ${T.warn}44`, borderRadius:6, padding:"9px 14px", display:"flex", alignItems:"center", gap:10, fontFamily:FONT_MONO, fontSize:12 }}>
            <span style={{ color:T.warn }}>⏱</span>
            <span style={{ color:T.warn }}>Session closes due to inactivity in <strong>{fmtSecs(timeoutSecsLeft)}</strong> — send a message to keep it alive</span>
          </div>
        )}

        {/* Session closed banner */}
        {sessionClosed && (
          <div style={{ background:`${T.crit}15`, border:`1px solid ${T.crit}44`, borderRadius:6, padding:"9px 14px", display:"flex", alignItems:"center", justifyContent:"space-between", fontFamily:FONT_MONO, fontSize:12 }}>
            <span style={{ color:T.crit }}>⚠ Session closed after 30 min of inactivity</span>
            <button onClick={clearChat}
              style={{ background:T.accent, color:T.bg, border:"none", padding:"5px 14px", borderRadius:4, fontSize:11, fontFamily:FONT_MONO, fontWeight:600, cursor:"pointer" }}>
              New Session
            </button>
          </div>
        )}

        {/* Mode toggle + info panel */}
        <div style={{ background:T.panel, border:`1px solid ${T.border}`, borderRadius:8, overflow:"hidden" }}>
          {/* Toggle row */}
          <div style={{ display:"flex", borderBottom:`1px solid ${T.border}` }}>
            {[
              { id:"chat", icon:"◈", label:"Chat",        sub:"Multi-turn" },
              { id:"ask",  icon:"◇", label:"Single-shot", sub:"One-off"    },
            ].map(m => (
              <button key={m.id} onClick={() => setMode(m.id)}
                style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center", gap:8,
                  padding:"10px 16px", border:"none",
                  background: mode===m.id ? T.panelHi : "transparent",
                  borderBottom: mode===m.id ? `2px solid ${mode==="chat" ? T.accent : T.purple}` : "2px solid transparent",
                  color: mode===m.id ? T.text : T.textMute, cursor:"pointer", transition:"all 0.1s" }}>
                <span style={{ fontSize:14, color: mode===m.id ? (m.id==="chat" ? T.accent : T.purple) : T.textMute }}>{m.icon}</span>
                <span style={{ fontFamily:FONT_MONO, fontSize:12, fontWeight: mode===m.id ? 600 : 400 }}>{m.label}</span>
                <span style={{ fontSize:10, fontFamily:FONT_MONO, color:T.textMute }}>{m.sub}</span>
              </button>
            ))}
          </div>
          {/* Info strip */}
          {mode === "chat" && (
            <div style={{ padding:"10px 16px", display:"flex", alignItems:"flex-start", gap:12, background:`${T.accent}08` }}>
              <span style={{ color:T.accent, fontSize:16, flexShrink:0, marginTop:1 }}>◈</span>
              <div style={{ display:"flex", flexDirection:"column", gap:3 }}>
                <span style={{ fontSize:12, color:T.text, fontWeight:500 }}>Chat mode — Continuous conversation</span>
                <span style={{ fontSize:11, color:T.textDim, lineHeight:1.6 }}>
                  Every message you send includes the full conversation history. The model remembers context across turns.
                  Uses <code style={{ background:T.panelHi, padding:"1px 5px", borderRadius:3, fontSize:10 }}>/sessions/&#123;uuid&#125;/chat</code>.
                  A session is created on your first message and stays open for 30 min of inactivity.
                </span>
              </div>
            </div>
          )}
          {mode === "ask" && (
            <div style={{ padding:"10px 16px", display:"flex", alignItems:"flex-start", gap:12, background:`${T.purple}08` }}>
              <span style={{ color:T.purple, fontSize:16, flexShrink:0, marginTop:1 }}>◇</span>
              <div style={{ display:"flex", flexDirection:"column", gap:3 }}>
                <span style={{ fontSize:12, color:T.text, fontWeight:500 }}>Single-shot mode — Independent requests</span>
                <span style={{ fontSize:11, color:T.textDim, lineHeight:1.6 }}>
                  Each message is a standalone API call with no history. The model has no memory of previous messages.
                  Uses <code style={{ background:T.panelHi, padding:"1px 5px", borderRadius:3, fontSize:10 }}>/ask</code>.
                  Every send auto-creates its own session — check the Recent tab to see them.
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Config bar */}
        <div style={{ background:T.panel, border:`1px solid ${T.border}`, borderRadius:8, padding:"12px 16px", display:"flex", gap:16, alignItems:"flex-end", flexWrap:"wrap" }}>
          {/* Current user badge */}
          <div style={{ display:"flex", flexDirection:"column", gap:3 }}>
            <label style={{ fontSize:9, fontFamily:FONT_MONO, letterSpacing:"0.12em", textTransform:"uppercase", color:T.textMute }}>You</label>
            <div style={{ display:"flex", alignItems:"center", gap:6, background:T.panelHi, border:`1px solid ${T.border}`, borderRadius:4, padding:"5px 10px", height:29 }}>
              <div style={{ width:7, height:7, borderRadius:"50%", background:roleColor }}/>
              <span style={{ fontSize:11, fontFamily:FONT_MONO, color:T.text }}>{user?.name}</span>
              <span style={{ fontSize:9, fontFamily:FONT_MONO, color:roleColor, marginLeft:2 }}>{user?.role}</span>
            </div>
          </div>

          <div style={{ display:"flex", flexDirection:"column", gap:3 }}>
            <label style={{ fontSize:9, fontFamily:FONT_MONO, letterSpacing:"0.12em", textTransform:"uppercase", color:T.textMute }}>
              Team {!isAdmin && <span style={{ color:T.textMute, textTransform:"none", fontSize:9 }}>(locked)</span>}
            </label>
            {isAdmin ? (
              <input value={team} onChange={e => setTeam(e.target.value)} disabled={!!sessionUuid}
                style={{ background:T.panelHi, color:sessionUuid?T.textMute:T.text, border:`1px solid ${T.border}`, padding:"5px 8px", borderRadius:4, fontSize:11, fontFamily:FONT_MONO, width:110, opacity:sessionUuid?0.5:1 }}/>
            ) : (
              <div style={{ background:T.panelHi, border:`1px solid ${T.border}`, borderRadius:4, padding:"5px 10px", fontSize:11, fontFamily:FONT_MONO, color:T.textDim, width:110 }}>
                {user?.team || "—"}
              </div>
            )}
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:3 }}>
            <label style={{ fontSize:9, fontFamily:FONT_MONO, letterSpacing:"0.12em", textTransform:"uppercase", color:T.textMute }}>Agent</label>
            <input value={agent} onChange={e => setAgent(e.target.value)} disabled={!!sessionUuid}
              style={{ background:T.panelHi, color:sessionUuid?T.textMute:T.text, border:`1px solid ${T.border}`, padding:"5px 8px", borderRadius:4, fontSize:11, fontFamily:FONT_MONO, width:110, opacity:sessionUuid?0.5:1 }}/>
          </div>
          <LabelSelect label="Model" value={model} onChange={setModel} options={CHAT_MODELS} disabled={!!sessionUuid} />

          <button onClick={() => setShowSystem(s => !s)}
            style={{ background:"transparent", border:`1px solid ${T.border}`, color:T.textDim, padding:"6px 12px", borderRadius:4, fontSize:11, fontFamily:FONT_MONO, cursor:"pointer" }}>
            {showSystem ? "Hide system prompt" : "System prompt"}
          </button>

          <div style={{ marginLeft:"auto", display:"flex", gap:12, fontFamily:FONT_MONO, fontSize:11, color:T.textDim, alignItems:"center" }}>
            {sessionUuid && (
              <button
                title="Click to copy session_uuid — use it in /ask requests to attach them to this chat"
                onClick={() => navigator.clipboard.writeText(sessionUuid)}
                style={{ background:T.panelHi, border:`1px solid ${T.border}`, color:T.textMute, borderRadius:4, padding:"3px 8px", fontSize:10, fontFamily:FONT_MONO, cursor:"pointer", display:"flex", alignItems:"center", gap:5 }}>
                <span style={{ color:T.accentDim }}>⚡</span> ID: {sessionUuid.slice(0,8)}… <span style={{ fontSize:9, opacity:0.6 }}>copy</span>
              </button>
            )}
            <span>Tokens: <span style={{ color:T.text }}>{totalTokens.toLocaleString()}</span></span>
            <span>Cost: <span style={{ color:T.accent }}>${totalCost.toFixed(6)}</span></span>
            <button onClick={() => setShowSessions(s => !s)}
              style={{ background: showSessions ? `${T.info}18` : "transparent", border:`1px solid ${showSessions ? T.info+"44" : T.border}`, color: showSessions ? T.info : T.textDim, padding:"5px 10px", borderRadius:4, fontSize:11, fontFamily:FONT_MONO, cursor:"pointer" }}>
              Sessions {activeSessions.length > 0 && `(${activeSessions.length})`}
            </button>
            <button onClick={clearChat}
              style={{ background:"transparent", border:`1px solid ${T.border}`, color:T.crit, padding:"5px 12px", borderRadius:4, fontSize:11, fontFamily:FONT_MONO, cursor:"pointer" }}>
              End
            </button>
          </div>
        </div>

        {/* System prompt */}
        {showSystem && (
          <div style={{ background:T.panel, border:`1px solid ${T.borderHi}`, borderRadius:6, padding:12 }}>
            <textarea value={systemPrompt} onChange={e => setSystemPrompt(e.target.value)}
              placeholder="System prompt (optional) — e.g. 'You are a SOC analyst specializing in threat intelligence.'"
              rows={3}
              style={{ width:"100%", background:T.panelHi, color:T.text, border:`1px solid ${T.border}`, borderRadius:4, padding:"8px 10px", fontSize:12, fontFamily:FONT_MONO, resize:"vertical", boxSizing:"border-box" }}/>
          </div>
        )}

        {/* Message thread */}
        <div style={{ flex:1, overflow:"auto", display:"flex", flexDirection:"column", gap:12, padding:"4px 2px" }}>
          {messages.length === 0 && !sessionClosed && (
            <div style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", color:T.textMute, fontFamily:FONT_MONO, fontSize:13, gap:8, paddingTop:60 }}>
              <div style={{ fontSize:28, color: mode==="chat" ? T.accent : T.purple }}>{mode==="chat" ? "◈" : "◇"}</div>
              <div>{mode==="chat" ? "Start a conversation — history is preserved across turns" : "Send a single-shot prompt — no history, each message is independent"}</div>
              <div style={{ fontSize:11 }}>PII scan · budget check · policy enforcement · cost tracking</div>
              {mode==="chat" && <div style={{ fontSize:10, marginTop:4 }}>Session auto-closes after 30 min of inactivity</div>}
              {mode==="ask"  && <div style={{ fontSize:10, marginTop:4 }}>Each send creates its own session — visible in Recent tab</div>}
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} style={{ display:"flex", flexDirection:"column", alignItems: msg.role==="user" ? "flex-end" : "flex-start", gap:4 }}>
              <div style={{ fontSize:10, fontFamily:FONT_MONO, letterSpacing:"0.1em", textTransform:"uppercase",
                color: msg.role==="user" ? T.info : T.accent, marginBottom:2,
                paddingLeft: msg.role==="assistant" ? 4 : 0, paddingRight: msg.role==="user" ? 4 : 0 }}>
                {msg.role === "user" ? `${user?.name || team} / ${agent}` : msg.meta?.model || "assistant"}
              </div>
              <div style={{ maxWidth:"75%", padding:"12px 16px",
                borderRadius: msg.role==="user" ? "12px 12px 2px 12px" : "12px 12px 12px 2px",
                background: msg.role==="user" ? `${T.info}18` : T.panelHi,
                border: `1px solid ${msg.role==="user" ? T.info+"33" : T.border}`,
                fontSize:13, color:T.text, lineHeight:1.6, whiteSpace:"pre-wrap", wordBreak:"break-word" }}>
                {msg.content}
              </div>
              {msg.meta && (
                <div style={{ display:"flex", gap:14, fontSize:10, fontFamily:FONT_MONO, color:T.textMute, paddingLeft:4, flexWrap:"wrap", alignItems:"center" }}>
                  <span>{msg.meta.tokens.toLocaleString()} tokens</span>
                  <span style={{ color:T.accent }}>${msg.meta.cost.toFixed(6)}</span>
                  <span>{msg.meta.latency.toFixed(0)}ms</span>
                  {msg.meta.findings?.length > 0 && <span style={{ color:T.warn }}>⚠ {msg.meta.findings.length} PII finding{msg.meta.findings.length===1?"":"s"}</span>}
                  {msg.meta.warnings?.length > 0 && <span style={{ color:T.warn }}>⚠ Budget {msg.meta.warnings[0].pct}% used</span>}
                  {msg.askSession && <span style={{ color:T.purple, background:`${T.purple}15`, border:`1px solid ${T.purple}33`, borderRadius:3, padding:"1px 6px" }}>◇ single-shot · session {msg.askSession.slice(0,8)}…</span>}
                </div>
              )}
            </div>
          ))}

          {sending && (
            <div style={{ display:"flex", alignItems:"flex-start" }}>
              <div style={{ padding:"10px 14px", background:T.panelHi, border:`1px solid ${T.border}`, borderRadius:"12px 12px 12px 2px" }}>
                <div style={{ display:"flex", gap:4 }}>
                  {[0,1,2].map(i => (
                    <div key={i} style={{ width:6, height:6, borderRadius:"50%", background:T.accent, animation:`pulse 1.2s ease-in-out ${i*0.2}s infinite`, opacity:0.6 }}/>
                  ))}
                </div>
              </div>
            </div>
          )}

          {error && (
            <div style={{ padding:"10px 14px", background:`${T.crit}10`, border:`1px solid ${T.crit}33`, borderRadius:6, fontSize:12, color:T.crit, fontFamily:FONT_MONO }}>
              ✗ {error}
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input area */}
        <div style={{ background:T.panel, border:`1px solid ${sessionClosed ? T.crit+"44" : T.border}`, borderRadius:8, padding:12, display:"flex", gap:10, alignItems:"flex-end" }}>
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder={sessionClosed ? "Session closed — click 'New Session' to start again" : "Type a message… (Enter to send, Shift+Enter for new line)"}
            rows={2}
            disabled={sending || sessionClosed}
            style={{ flex:1, background:T.panelHi, color:T.text, border:`1px solid ${T.border}`, borderRadius:6, padding:"10px 12px", fontSize:13, fontFamily:FONT_UI, resize:"none", lineHeight:1.5, opacity:(sending||sessionClosed)?0.5:1 }}
          />
          <button onClick={send} disabled={sending || !input.trim() || sessionClosed}
            style={{ background:T.accent, color:T.bg, border:"none", padding:"10px 20px", borderRadius:6, fontSize:13, fontFamily:FONT_MONO, fontWeight:600, cursor:"pointer", opacity:(sending||!input.trim()||sessionClosed)?0.4:1, flexShrink:0 }}>
            {sending ? "…" : "Send"}
          </button>
        </div>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { transform: scale(1); opacity: 0.4; }
          50%       { transform: scale(1.3); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

// ─── Integrations page ────────────────────────────────────────────────────────
function IntegrationsPage() {
  const currentUser = useUser();
  const [copied, setCopied] = useState(null);
  const [authMode, setAuthMode] = useState("apikey");  // "apikey" (production) | "jwt" (testing)
  const [apiKey, setApiKey] = useState("");
  const [token, setToken] = useState("");
  const [teamName, setTeamName] = useState(currentUser?.team || "my-team");
  const [agentName, setAgentName] = useState("my-agent");

  const gatewayUrl = BASE.startsWith("http") ? BASE : window.location.origin;

  // The credential the snippets show. Production agents use a gk- API key;
  // manual testing uses a short-lived JWT from login.
  const isApiKey   = authMode === "apikey";
  const credValue  = isApiKey ? (apiKey || "gk-...") : (token || "<your-jwt-token>");
  const credNote   = isApiKey ? "the issued API key (never expires)" : "from POST /auth/login (expires in 8h)";

  const copy = (id, text) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  const CopyBtn = ({ id, text }) => (
    <button onClick={() => copy(id, text)}
      style={{ background: copied===id ? `${T.accent}20` : "transparent", border:`1px solid ${copied===id ? T.accent+"55" : T.border}`,
        color: copied===id ? T.accent : T.textMute, padding:"3px 10px", borderRadius:3, fontSize:10, fontFamily:FONT_MONO, cursor:"pointer", flexShrink:0 }}>
      {copied===id ? "✓ copied" : "copy"}
    </button>
  );

  const CodeBlock = ({ id, code }) => (
    <div style={{ position:"relative" }}>
      <pre style={{ background:T.bg, border:`1px solid ${T.border}`, borderRadius:6, padding:"14px 16px", fontSize:12, fontFamily:FONT_MONO, color:T.text, lineHeight:1.7, overflow:"auto", margin:0, whiteSpace:"pre" }}>
        {code}
      </pre>
      <div style={{ position:"absolute", top:8, right:8 }}>
        <CopyBtn id={id} text={code} />
      </div>
    </div>
  );

  const SectionHeader = ({ n, title, desc }) => (
    <div style={{ display:"flex", alignItems:"baseline", gap:12, marginTop:14, marginBottom:2, paddingBottom:8, borderBottom:`1px solid ${T.border}` }}>
      <span style={{ fontFamily:FONT_MONO, fontSize:11, color:T.accent, letterSpacing:"0.1em" }}>{n}</span>
      <div>
        <div style={{ fontSize:15, fontWeight:600, color:T.text, letterSpacing:"-0.01em" }}>{title}</div>
        {desc && <div style={{ fontSize:12, color:T.textMute, marginTop:2 }}>{desc}</div>}
      </div>
    </div>
  );

  const pythonSnippet = `import openai

# Works with ANY model — GPT, Claude, Gemini, Llama, and more.
# AIFinOps Guard routes the request to the right provider automatically.
client = openai.OpenAI(
    base_url="${gatewayUrl}/v1",
    api_key="${credValue}",   # ${credNote}
)

# Non-streaming
response = client.chat.completions.create(
    model="gpt-4o-mini",           # or "claude-sonnet-4-5", "gemini-2.0-flash", etc.
    messages=[
        {"role": "user", "content": "Write a daily standup summary"}
    ],
    extra_headers={
        "X-Guard-Team":  "${teamName}",
        "X-Guard-Agent": "${agentName}",
    },
)
print(response.choices[0].message.content)

# Streaming — works exactly the same way
stream = client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[{"role": "user", "content": "Write a daily standup summary"}],
    stream=True,
    extra_headers={
        "X-Guard-Team":  "${teamName}",
        "X-Guard-Agent": "${agentName}",
    },
)
for chunk in stream:
    print(chunk.choices[0].delta.content or "", end="", flush=True)

# Cost, PII findings, budget warnings → response.x_guard (non-streaming only)`;

  const nodejsSnippet = `import OpenAI from "openai";

// Works with GPT, Claude, Gemini, Llama — all routed through the guard.
const client = new OpenAI({
  baseURL: "${gatewayUrl}/v1",
  apiKey: "${credValue}",     // ${credNote}
});

const response = await client.chat.completions.create({
  model: "gpt-4o-mini",          // or "claude-sonnet-4-5", "gemini-2.0-flash", etc.
  messages: [
    { role: "user", content: "Write a daily standup summary" }
  ],
  // @ts-ignore — guard-specific headers
  headers: {
    "X-Guard-Team":  "${teamName}",
    "X-Guard-Agent": "${agentName}",
  },
});

console.log(response.choices[0].message.content);`;

  const curlSnippet = `# Works with any supported model — just change the "model" field.
# Supported: gpt-4o-mini, gpt-4o, claude-sonnet-4-5, claude-opus-4-5,
#            gemini-2.0-flash, gemini-2.5-pro, llama-3.1-70b-local, and more.

curl -X POST ${gatewayUrl}/v1/chat/completions \\
  -H "Authorization: Bearer ${credValue}" \\
  -H "Content-Type: application/json" \\
  -H "X-Guard-Team: ${teamName}" \\
  -H "X-Guard-Agent: ${agentName}" \\
  -d '{
    "model": "gpt-4o-mini",
    "messages": [
      {"role": "user", "content": "Write a daily standup summary"}
    ]
  }'`;

  const anthropicSnippet = `import anthropic

# Teams using the Anthropic SDK natively — no code changes needed.
# Just point base_url at this server instead of api.anthropic.com.
client = anthropic.Anthropic(
    base_url="${gatewayUrl}",   # note: no /v1 suffix — the SDK adds it
    api_key="${credValue}",             # ${credNote}
    default_headers={
        "X-Guard-Team":  "${teamName}",
        "X-Guard-Agent": "${agentName}",
    },
)

# Non-streaming
message = client.messages.create(
    model="claude-haiku-4-5",
    max_tokens=1024,
    messages=[{"role": "user", "content": "Write a daily standup summary"}],
)
print(message.content[0].text)

# Streaming
with client.messages.stream(
    model="claude-haiku-4-5",
    max_tokens=1024,
    messages=[{"role": "user", "content": "Write a daily standup summary"}],
) as stream:
    for text in stream.text_stream:
        print(text, end="", flush=True)`;

  const langchainSnippet = `from langchain_openai import ChatOpenAI

# AIFinOps Guard exposes a unified OpenAI-compatible endpoint for all providers.
# Swap the model name to route to a different LLM — no other code change needed.
llm = ChatOpenAI(
    model="gpt-4o-mini",           # or "claude-sonnet-4-5", "gemini-2.0-flash", etc.
    openai_api_base="${gatewayUrl}/v1",
    openai_api_key="${credValue}",   # ${credNote}
    default_headers={
        "X-Guard-Team":  "${teamName}",
        "X-Guard-Agent": "${agentName}",
    },
)

response = llm.invoke("Write a daily standup summary")
print(response.content)`;

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:18, maxWidth:900 }}>

      {/* Hero */}
      <div style={{ background:`linear-gradient(135deg,${T.panel} 0%,${T.panelHi} 100%)`, border:`1px solid ${T.border}`, borderRadius:8, padding:"28px 32px" }}>
        <div style={{ fontFamily:FONT_MONO, fontSize:10, letterSpacing:"0.16em", textTransform:"uppercase", color:T.accent, marginBottom:10 }}>◆ Universal AI Gateway</div>
        <div style={{ fontSize:20, fontWeight:500, letterSpacing:"-0.01em", marginBottom:10, color:T.text }}>
          Connect any agent to any LLM platform — through one gateway
        </div>
        <div style={{ fontSize:13, color:T.textDim, lineHeight:1.65, maxWidth:640 }}>
          Your agents keep their existing code. Just change <code style={{ background:T.panelHi, padding:"1px 6px", borderRadius:3, fontFamily:FONT_MONO, fontSize:12 }}>base_url</code> to this server — and every call to <strong style={{ color:T.text }}>OpenAI, Anthropic, Google, or any local model</strong> is automatically observed, governed, and logged.
        </div>
        <div style={{ display:"flex", gap:10, marginTop:14, flexWrap:"wrap" }}>
          {[
            { label:"OpenAI",     color:T.info   },
            { label:"Anthropic",  color:T.warn   },
            { label:"Google",     color:T.accent },
            { label:"Local LLMs", color:T.purple },
          ].map(p => (
            <span key={p.label} style={{ display:"inline-flex", alignItems:"center", gap:5, padding:"4px 10px", borderRadius:4, background:`${p.color}15`, border:`1px solid ${p.color}33`, color:p.color, fontSize:11, fontFamily:FONT_MONO }}>
              {p.label}
            </span>
          ))}
        </div>
        <div style={{ display:"flex", gap:10, marginTop:18, flexWrap:"wrap" }}>
          {[
            { label:"PII scanning",        color:T.warn },
            { label:"Model policy",        color:T.info },
            { label:"Budget enforcement",  color:T.crit },
            { label:"Cost tracking",       color:T.accent },
            { label:"Audit log",           color:T.purple },
          ].map(b => (
            <span key={b.label} style={{ display:"inline-flex", alignItems:"center", gap:5, padding:"5px 12px", borderRadius:4, background:`${b.color}15`, border:`1px solid ${b.color}33`, color:b.color, fontSize:11, fontFamily:FONT_MONO }}>
              ✓ {b.label}
            </span>
          ))}
        </div>
      </div>

      <SectionHeader n="01" title="Get started" desc="Configure your connection and onboard a customer agent" />

      {/* Config builder */}
      <Card title="Connection details" subtitle="Pick how the caller authenticates, then the code snippets below fill in automatically">

        {/* Auth mode toggle */}
        <div style={{ display:"flex", gap:0, marginBottom:18, background:T.bg, border:`1px solid ${T.border}`, borderRadius:6, padding:3, width:"fit-content" }}>
          {[
            { id:"apikey", label:"Production agent", sub:"API key" },
            { id:"jwt",    label:"Manual testing",   sub:"JWT login" },
          ].map(m => (
            <button key={m.id} onClick={() => setAuthMode(m.id)}
              style={{ background: authMode===m.id ? T.accent+"22" : "transparent", border:`1px solid ${authMode===m.id ? T.accent+"55" : "transparent"}`,
                borderRadius:4, padding:"7px 16px", cursor:"pointer", color: authMode===m.id ? T.accent : T.textMute, fontFamily:FONT_UI, textAlign:"left" }}>
              <div style={{ fontSize:12, fontWeight:600 }}>{m.label}</div>
              <div style={{ fontSize:10, fontFamily:FONT_MONO, opacity:0.8 }}>{m.sub}</div>
            </button>
          ))}
        </div>

        {/* Explainer per mode */}
        <div style={{ fontSize:12, color:T.textDim, lineHeight:1.65, marginBottom:16, background:T.panelHi, border:`1px solid ${T.border}`, borderRadius:6, padding:"12px 14px" }}>
          {isApiKey ? (
            <>
              <strong style={{ color:T.text }}>Use this for real customers and always-on agents.</strong> Generate a
              <code style={{ color:T.accent, background:T.bg, padding:"1px 6px", borderRadius:3, margin:"0 4px" }}>gk-…</code>
              key on the <strong style={{ color:T.accent }}>API Keys</strong> page. It never expires, carries its own team,
              and can be revoked independently. The customer just drops it into their existing code as the <code style={{ color:T.info }}>api_key</code>.
            </>
          ) : (
            <>
              <strong style={{ color:T.text }}>Use this only for quick manual testing from your own machine.</strong> A dashboard
              JWT expires after 8 hours, so it is <strong style={{ color:T.warn }}>not</strong> suitable for a deployed agent.
              Get one with <code style={{ color:T.info }}>POST {gatewayUrl}/auth/login</code> → copy <code style={{ color:T.accent }}>access_token</code>.
            </>
          )}
        </div>

        <div style={{ display:"flex", gap:12, flexWrap:"wrap", alignItems:"flex-end", marginBottom:16 }}>
          {[
            { label:"Gateway URL", val:gatewayUrl, set:null, width:280, readOnly:true },
            { label:"Team name",   val:teamName,   set:setTeamName,  width:140 },
            { label:"Agent name",  val:agentName,  set:setAgentName, width:140 },
          ].map(f => (
            <div key={f.label} style={{ display:"flex", flexDirection:"column", gap:4 }}>
              <label style={{ fontSize:9, fontFamily:FONT_MONO, letterSpacing:"0.12em", textTransform:"uppercase", color:T.textMute }}>{f.label}</label>
              <input value={f.val} onChange={f.set ? e => f.set(e.target.value) : undefined} readOnly={f.readOnly}
                style={{ background: f.readOnly ? T.bg : T.panelHi, color: f.readOnly ? T.textDim : T.text, border:`1px solid ${T.border}`, padding:"6px 10px", borderRadius:4, fontSize:12, fontFamily:FONT_MONO, width:f.width, cursor: f.readOnly ? "default" : "text" }}/>
            </div>
          ))}
          <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
            <label style={{ fontSize:9, fontFamily:FONT_MONO, letterSpacing:"0.12em", textTransform:"uppercase", color:T.textMute }}>
              {isApiKey ? <>API Key <span style={{ textTransform:"none", color:T.textMute }}>(gk-…)</span></>
                        : <>JWT Token <span style={{ textTransform:"none", color:T.textMute }}>(from login)</span></>}
            </label>
            <input type="password"
              placeholder={isApiKey ? "Paste a gk- key to see it in snippets…" : "Paste your JWT to see it in snippets…"}
              value={isApiKey ? apiKey : token}
              onChange={e => (isApiKey ? setApiKey(e.target.value) : setToken(e.target.value))}
              style={{ background:T.panelHi, color:T.text, border:`1px solid ${T.border}`, padding:"6px 10px", borderRadius:4, fontSize:12, fontFamily:FONT_MONO, width:240 }}/>
          </div>
        </div>
        <div style={{ fontSize:11, color:T.textMute, fontFamily:FONT_MONO }}>
          {isApiKey
            ? <>No key yet? Go to <strong style={{ color:T.accent }}>API Keys → Generate Key</strong>. Team & agent are attributed automatically from the key.</>
            : <>Team & agent below are sent as <code style={{ color:T.info }}>X-Guard-Team</code> / <code style={{ color:T.info }}>X-Guard-Agent</code> headers in the snippets.</>}
        </div>
      </Card>

      {/* How to give a customer access */}
      <Card title="Onboarding a customer" subtitle="Issue a long-lived API key instead of sharing a dashboard login">
        <div style={{ fontSize:12, color:T.textDim, fontFamily:FONT_MONO, lineHeight:1.7, marginBottom:14 }}>
          Dashboard JWTs expire after 8 hours — fine for the UI, wrong for an always-on agent.
          For customers and production agents, issue a dedicated <strong style={{ color:T.text }}>API key</strong> that
          you can revoke independently without affecting anyone else.
        </div>
        <ol style={{ margin:0, paddingLeft:20, display:"flex", flexDirection:"column", gap:10 }}>
          {[
            <>Go to the <strong style={{ color:T.accent }}>API Keys</strong> page → <strong style={{ color:T.text }}>Generate Key</strong>. Set a <em>Name</em> (e.g. <code style={{ color:T.info }}>acme-prod-agent</code>) and the <em>Team</em> it belongs to.</>,
            <>Copy the <code style={{ color:T.accent }}>gk-…</code> key from the popup — it is shown <strong style={{ color:T.warn }}>only once</strong> and stored only as a hash. Hand it to the customer over a secure channel.</>,
            <>The customer drops it into their existing agent as the <code style={{ color:T.info }}>api_key</code> — no other code change. The <code style={{ color:T.info }}>base_url</code> is this gateway. Works the same whether they call <strong style={{ color:T.text }}>OpenAI, Anthropic, Google, or a local model</strong> — the gateway routes by model name.</>,
            <>Every call is attributed to that key's team for budget &amp; policy enforcement, and the key's <em>last used</em> timestamp updates live on the API Keys page.</>,
            <>To cut off access, click <strong style={{ color:T.warn }}>Revoke</strong> — that key stops working immediately; all other customers are unaffected.</>,
          ].map((step, i) => (
            <li key={i} style={{ fontSize:12, color:T.textDim, fontFamily:FONT_MONO, lineHeight:1.6 }}>{step}</li>
          ))}
        </ol>
        <div style={{ marginTop:16 }}>
          <CodeBlock id="customer-key" code={`# One gateway, every provider. The customer changes only base_url + api_key;
# the "model" field decides which platform the call is routed to:
#   OpenAI      → gpt-4o-mini, gpt-4o, o3 ...
#   Anthropic   → claude-sonnet-4-5, claude-opus-4-5 ...
#   Google      → gemini-2.5-pro, gemini-2.0-flash ...
#   Local/Ollama→ llama-3.1-70b-local ...
import openai

client = openai.OpenAI(
    base_url="${gatewayUrl}/v1",
    api_key="gk-...",                      # the issued API key (not a JWT)
)

# Same code calls any provider — just swap the model name:
resp = client.chat.completions.create(
    model="claude-sonnet-4-5",             # ← or gpt-4o-mini, gemini-2.0-flash, llama-3.1-70b-local
    messages=[{"role": "user", "content": "Hello"}],
    extra_headers={"X-Guard-Agent": "acme-prod-agent"},
)
print(resp.choices[0].message.content)`} />
        </div>
      </Card>

      <SectionHeader n="02" title="Reference" desc="Attribution headers and the models you can route to" />

      {/* How attribution works */}
      <Card title="How team & agent attribution works" subtitle="Two HTTP headers on every request">
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
          {[
            { header:"X-Guard-Team", example:teamName, desc:"Maps this call to a team for policy enforcement and cost attribution. Must match a team name used in your Budget and Policy rules." },
            { header:"X-Guard-Agent", example:agentName, desc:"Identifies which agent or workflow made the call. Shows up in telemetry, cost charts, and the audit log." },
          ].map(h => (
            <div key={h.header} style={{ background:T.panelHi, border:`1px solid ${T.border}`, borderRadius:6, padding:"14px 16px" }}>
              <div style={{ fontFamily:FONT_MONO, fontSize:12, color:T.info, marginBottom:6 }}>{h.header}</div>
              <div style={{ fontFamily:FONT_MONO, fontSize:11, color:T.accent, marginBottom:8 }}>example: "{h.example}"</div>
              <div style={{ fontSize:12, color:T.textDim, lineHeight:1.6 }}>{h.desc}</div>
            </div>
          ))}
        </div>
      </Card>

      {/* Supported models quick reference */}
      <Card title="Supported models" subtitle="Use any of these as the model field — the gateway routes to the right provider automatically">
        <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:10 }}>
          {[
            { provider:"OpenAI",    color:T.info,   models:["gpt-4.1","gpt-4.1-mini","gpt-4o","gpt-4o-mini","o3","o4-mini"] },
            { provider:"Anthropic", color:T.warn,   models:["claude-opus-4-5","claude-sonnet-4-5","claude-haiku-4-5"] },
            { provider:"Google",    color:T.accent, models:["gemini-2.5-pro","gemini-2.0-flash","gemini-1.5-pro"] },
            { provider:"Local",     color:T.purple, models:["llama-3.1-70b-local","llama-3.1-8b-local"] },
          ].map(g => (
            <div key={g.provider} style={{ background:T.panelHi, border:`1px solid ${T.border}`, borderRadius:6, padding:"12px 14px" }}>
              <div style={{ fontFamily:FONT_MONO, fontSize:10, letterSpacing:"0.12em", textTransform:"uppercase", color:g.color, marginBottom:10 }}>{g.provider}</div>
              <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
                {g.models.map(m => (
                  <code key={m} style={{ fontSize:11, fontFamily:FONT_MONO, color:T.textDim, background:T.bg, padding:"2px 6px", borderRadius:3, display:"block" }}>{m}</code>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div style={{ marginTop:12, fontSize:11, color:T.textMute, fontFamily:FONT_MONO }}>
          Requires the corresponding API key to be configured in Settings → API Keys.
        </div>
      </Card>

      <SectionHeader n="03" title="Code examples" desc="Copy-paste snippets for your stack — Python, Anthropic SDK, LangChain, Node.js, curl" />

      {/* Code snippets */}
      <Card title="Python" subtitle="Works with any LLM — change the model name to switch between OpenAI, Anthropic, Google, or local">
        <CodeBlock id="python" code={pythonSnippet} />
      </Card>

      <Card title="Anthropic SDK (native)" subtitle="Teams using the Anthropic SDK directly — same one-line swap, full Anthropic Messages API + streaming">
        <CodeBlock id="anthropic" code={anthropicSnippet} />
      </Card>

      <Card title="LangChain" subtitle="Drop-in for any LangChain LLM — route GPT, Claude, Gemini through one gateway">
        <CodeBlock id="langchain" code={langchainSnippet} />
      </Card>

      <Card title="Node.js" subtitle="TypeScript / JavaScript agents — any model, one endpoint">
        <CodeBlock id="nodejs" code={nodejsSnippet} />
      </Card>

      <Card title="curl" subtitle="Test the connection from a terminal">
        <CodeBlock id="curl" code={curlSnippet} />
      </Card>

      <SectionHeader n="04" title="How it works & security" desc="The enforcement pipeline, fail-mode behavior, and security posture" />

      {/* What happens on each call */}
      <Card title="What happens on every agent call" subtitle="The enforcement pipeline">
        <div style={{ display:"flex", flexDirection:"column", gap:0 }}>
          {[
            { n:"1", label:"PII scan",          color:T.warn,   desc:"Prompt is scanned for API keys, passwords, credit card numbers, and PII. Findings are logged to the audit trail." },
            { n:"2", label:"Model policy check", color:T.info,   desc:"Request is checked against your policy rules. If the model is blocked for the team, the call is rejected with HTTP 403 and logged." },
            { n:"3", label:"Budget check",       color:T.crit,   desc:"Current team/agent spend is compared to budget rules. If over limit with action=block, the call is rejected with HTTP 429." },
            { n:"4", label:"LLM call",           color:T.accent, desc:"Request is forwarded to the real provider (OpenAI, Anthropic, Google) and the response returned to the agent." },
            { n:"5", label:"Telemetry saved",    color:T.purple, desc:"Tokens, cost, latency, model, team, agent, and security findings are all stored. Visible in Overview, Cost, and Audit Log pages." },
          ].map((s, i, arr) => (
            <div key={s.n} style={{ display:"flex", gap:16, paddingBottom: i<arr.length-1 ? 0 : 0 }}>
              <div style={{ display:"flex", flexDirection:"column", alignItems:"center", flexShrink:0 }}>
                <div style={{ width:28, height:28, borderRadius:"50%", background:`${s.color}20`, border:`1px solid ${s.color}44`, display:"flex", alignItems:"center", justifyContent:"center", fontFamily:FONT_MONO, fontSize:11, color:s.color, fontWeight:600 }}>{s.n}</div>
                {i < arr.length - 1 && <div style={{ width:1, flex:1, background:T.border, minHeight:20, margin:"4px 0" }}/>}
              </div>
              <div style={{ paddingBottom:16 }}>
                <div style={{ fontFamily:FONT_MONO, fontSize:12, color:s.color, marginBottom:4 }}>{s.label}</div>
                <div style={{ fontSize:13, color:T.textDim, lineHeight:1.6 }}>{s.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Fail mode */}
      <Card title="Gateway fail mode" subtitle="What happens if the gateway itself has an error">
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14, marginBottom:14 }}>
          {[
            { mode:"closed", color:T.crit,   label:"Fail-closed (default)", desc:"If enforcement encounters an unexpected error, the request is blocked and an HTTP 503 is returned. No unscanned call reaches the LLM. Correct default for security-sensitive teams." },
            { mode:"open",   color:T.warn,   label:"Fail-open", desc:"If enforcement encounters an unexpected error, the request passes through to the LLM unchecked. Use for teams where availability is more critical than enforcement. Set GATEWAY_FAIL_MODE=open in .env." },
          ].map(m => (
            <div key={m.mode} style={{ background:T.panelHi, border:`1px solid ${m.color}44`, borderRadius:6, padding:"14px 16px" }}>
              <div style={{ fontFamily:FONT_MONO, fontSize:11, color:m.color, marginBottom:6 }}>{m.label}</div>
              <div style={{ fontSize:12, color:T.textDim, lineHeight:1.6 }}>{m.desc}</div>
            </div>
          ))}
        </div>
        <div style={{ fontSize:11, color:T.textMute, fontFamily:FONT_MONO }}>
          Note: policy blocks (403) and budget blocks (429) always propagate regardless of fail mode — only unexpected internal errors are affected by this setting.
        </div>
      </Card>

      {/* Security posture */}
      <Card title="Security posture" subtitle="What we do and don't do — for enterprise conversations">
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14, marginBottom:12 }}>
          {[
            { label:"Data in transit", val:"TLS 1.2+ (via your reverse proxy / load balancer)", color:T.accent },
            { label:"Auth", val:"HS256 JWT, 30-minute expiry, per-user roles (admin / analyst / viewer)", color:T.accent },
            { label:"Secrets storage", val:"API keys stored in .env — never returned via API, only status exposed", color:T.accent },
            { label:"Audit log", val:"Every request logged with team, agent, model, tokens, cost, PII findings", color:T.accent },
            { label:"Data residency", val:"All data stays in your deployment — no telemetry leaves your environment", color:T.accent },
            { label:"SOC 2", val:"Pre-certification. Full audit log, RBAC, and secrets isolation in place. Formal certification roadmap available on request.", color:T.warn },
          ].map(i => (
            <div key={i.label} style={{ display:"flex", gap:10, alignItems:"flex-start" }}>
              <span style={{ color:i.color, fontFamily:FONT_MONO, fontSize:13, flexShrink:0 }}>{i.color === T.accent ? "✓" : "○"}</span>
              <div>
                <div style={{ fontSize:12, color:T.text, fontFamily:FONT_MONO, marginBottom:2 }}>{i.label}</div>
                <div style={{ fontSize:12, color:T.textDim, lineHeight:1.5 }}>{i.val}</div>
              </div>
            </div>
          ))}
        </div>
      </Card>

    </div>
  );
}

// ─── Settings page (admin only) ───────────────────────────────────────────────
const GUARD_MODE_META = {
  observe: { color: "#3b82f6", label: "Observe", desc: "Log & shadow-block only — never blocks" },
  alert:   { color: "#eab308", label: "Alert",   desc: "Logs + fires alerts — never blocks" },
  enforce: { color: "#ef4444", label: "Enforce", desc: "Actively blocks violations" },
};

function GuardModesSection() {
  const [rows,    setRows]    = useState([]);
  const [health,  setHealth]  = useState(null);
  const [loading, setLoading] = useState(true);
  const [err,     setErr]     = useState(null);
  const [busy,    setBusy]    = useState(null);  // team currently saving

  const load = useCallback(async () => {
    try {
      const [modes, h] = await Promise.all([fetchGuardModes(), fetchHealth().catch(() => null)]);
      setRows(modes);
      setHealth(h);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleChange = async (team, mode) => {
    setBusy(team); setErr(null);
    try { await setGuardMode(team, mode); await load(); }
    catch (e) { setErr(e.message); }
    finally { setBusy(null); }
  };

  const platformMode = health?.platform_mode || "observe";
  const cb = health?.circuit_breaker;

  return (
    <Card title="Guard Modes" subtitle="Visibility First → Governance Later. Graduate each team independently from observe to enforce.">
      {err && <div style={{ color:T.crit, fontFamily:FONT_MONO, fontSize:12, marginBottom:12 }}>{err}</div>}

      {/* Platform default + health */}
      <div style={{ display:"flex", gap:12, flexWrap:"wrap", marginBottom:16 }}>
        <div style={{ background:T.panelHi, border:`1px solid ${T.border}`, borderRadius:6, padding:"10px 14px", flex:1, minWidth:200 }}>
          <div style={{ fontSize:9, fontFamily:FONT_MONO, letterSpacing:"0.12em", textTransform:"uppercase", color:T.textMute }}>Platform default</div>
          <div style={{ marginTop:6, display:"flex", alignItems:"center", gap:8 }}>
            <span style={{ width:8, height:8, borderRadius:"50%", background:GUARD_MODE_META[platformMode]?.color }} />
            <span style={{ fontFamily:FONT_MONO, fontSize:13, color:T.text, fontWeight:600 }}>{GUARD_MODE_META[platformMode]?.label || platformMode}</span>
            <span style={{ fontFamily:FONT_MONO, fontSize:10, color:T.textMute }}>(GUARD_MODE env var)</span>
          </div>
        </div>
        {cb && (
          <div style={{ background:T.panelHi, border:`1px solid ${T.border}`, borderRadius:6, padding:"10px 14px", flex:1, minWidth:200 }}>
            <div style={{ fontSize:9, fontFamily:FONT_MONO, letterSpacing:"0.12em", textTransform:"uppercase", color:T.textMute }}>Circuit breaker</div>
            <div style={{ marginTop:6, display:"flex", alignItems:"center", gap:8 }}>
              <span style={{ width:8, height:8, borderRadius:"50%", background: cb.state === "open" ? T.crit : T.accent }} />
              <span style={{ fontFamily:FONT_MONO, fontSize:13, color:T.text, fontWeight:600 }}>{cb.state === "open" ? "OPEN (bypassing)" : "Closed (healthy)"}</span>
              {health.uptime_seconds != null && (
                <span style={{ fontFamily:FONT_MONO, fontSize:10, color:T.textMute }}>· up {Math.floor(health.uptime_seconds/3600)}h</span>
              )}
            </div>
          </div>
        )}
      </div>

      {loading ? (
        <div style={{ color:T.textDim, fontFamily:FONT_MONO, fontSize:12, padding:12 }}>Loading…</div>
      ) : (
        <table style={{ width:"100%", borderCollapse:"collapse" }}>
          <thead>
            <tr style={{ borderBottom:`1px solid ${T.border}` }}>
              {["Team","Effective Mode","Would block (30d)","Set mode"].map(h => (
                <th key={h} style={{ textAlign:"left", padding:"10px 8px", fontFamily:FONT_MONO, fontSize:10, letterSpacing:"0.1em", textTransform:"uppercase", color:T.textDim, fontWeight:500 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={4} style={{ padding:20, textAlign:"center", color:T.textMute, fontFamily:FONT_MONO, fontSize:12 }}>No teams seen yet — they appear here once traffic flows.</td></tr>
            )}
            {rows.map(r => {
              const meta = GUARD_MODE_META[r.mode] || {};
              return (
                <tr key={r.team} style={{ borderBottom:`1px solid ${T.border}` }}>
                  <td style={{ padding:"12px 8px", fontSize:12, color:T.text, fontWeight:500 }}>{r.team}</td>
                  <td style={{ padding:"12px 8px" }}>
                    <span style={{ display:"inline-flex", alignItems:"center", gap:6 }}>
                      <span style={{ width:8, height:8, borderRadius:"50%", background:meta.color }} />
                      <span style={{ fontFamily:FONT_MONO, fontSize:12, color:T.text }}>{meta.label || r.mode}</span>
                      {!r.is_override && <span style={{ fontFamily:FONT_MONO, fontSize:9, color:T.textMute }}>(default)</span>}
                    </span>
                  </td>
                  <td style={{ padding:"12px 8px" }}>
                    <span style={{ fontFamily:FONT_MONO, fontSize:12, color: r.would_block_30d > 0 ? T.warn : T.textMute, fontWeight: r.would_block_30d > 0 ? 600 : 400 }}>
                      {r.would_block_30d}
                    </span>
                  </td>
                  <td style={{ padding:"10px 8px" }}>
                    <select
                      value={r.is_override ? r.mode : "default"}
                      disabled={busy === r.team}
                      onChange={e => handleChange(r.team, e.target.value)}
                      style={{ background:T.bg, color:T.text, border:`1px solid ${T.border}`, padding:"5px 10px", borderRadius:4, fontSize:12, fontFamily:FONT_MONO, cursor:"pointer" }}>
                      <option value="default">Default ({platformMode})</option>
                      <option value="observe">Observe</option>
                      <option value="alert">Alert</option>
                      <option value="enforce">Enforce</option>
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <div style={{ marginTop:14, fontSize:11, fontFamily:FONT_MONO, color:T.textMute, lineHeight:1.7 }}>
        <strong style={{ color:T.textDim }}>Would block (30d)</strong> shows how many requests <em>would</em> have been blocked
        in enforce mode — watch this before graduating a team. Every mode change is written to the audit log.
      </div>
    </Card>
  );
}


// ─── Provider Credentials section (BYOK) ─────────────────────────────────────
const PROVIDER_META = {
  openai:    { label: "OpenAI",    placeholder: "sk-…" },
  anthropic: { label: "Anthropic", placeholder: "sk-ant-…" },
  google:    { label: "Google",    placeholder: "AIza…" },
  // Local LLM takes a base_url, not a secret key — treated separately because
  // it's an SSRF surface (server makes outbound requests to this URL), not a
  // credential surface. W-2: before any non-trusted admin can set base_url,
  // add server-side validation: allowlist http/https, block private/link-local
  // ranges and cloud metadata IPs (169.254.169.254, metadata.google.internal).
  local:     { label: "Local LLM", placeholder: "http://localhost:11434", isUrl: true },
};
const ALL_PROVIDERS = Object.keys(PROVIDER_META);

function ProviderCredentialsSection() {
  const [creds,       setCreds]       = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [err,         setErr]         = useState(null);
  const [editing,     setEditing]     = useState(null);   // provider currently open
  const [keyVal,      setKeyVal]      = useState("");
  const [urlVal,      setUrlVal]      = useState("");
  const [saving,      setSaving]      = useState(false);
  const [confirmDel,  setConfirmDel]  = useState(null);   // provider pending remove confirm
  const [deleting,    setDeleting]    = useState(null);
  const [flash,       setFlash]       = useState(null);
  const [saveErr,     setSaveErr]     = useState(null);   // scoped to the open inline form

  const load = useCallback(async () => {
    try {
      const data = await fetchProviderCredentials();
      setCreds(data);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const startEdit = (provider) => {
    setEditing(provider);
    setKeyVal("");
    setUrlVal(creds.find(c => c.provider === provider)?.base_url || "");
    setSaveErr(null);
    setFlash(null);
    setConfirmDel(null);
  };
  const cancelEdit = () => { setEditing(null); setKeyVal(""); setUrlVal(""); setSaveErr(null); };

  const handleSave = async () => {
    const meta = PROVIDER_META[editing];
    if (!meta) return;
    if (meta.isUrl ? !urlVal.trim() : !keyVal.trim()) return;
    setSaving(true); setSaveErr(null);
    try {
      await upsertProviderCredential(editing, meta.isUrl ? "local" : keyVal.trim(), meta.isUrl ? urlVal.trim() : undefined);
      setFlash(editing);
      cancelEdit();
      await load();
    } catch (e) { setSaveErr(e.message); }
    finally { setSaving(false); }
  };

  const handleDeleteConfirmed = async (provider) => {
    setConfirmDel(null);
    setDeleting(provider); setErr(null);
    try {
      await deleteProviderCredential(provider);
      await load();
    } catch (e) { setErr(e.message); }
    finally { setDeleting(null); }
  };

  return (
    <Card title="Provider API Keys" subtitle="Per-org encrypted credentials. Keys are stored as Fernet ciphertext — only the last 4 characters are shown here.">
      {err && <div style={{ color:T.crit, fontFamily:FONT_MONO, fontSize:12, marginBottom:12 }}>{err}</div>}
      {loading ? (
        <div style={{ color:T.textDim, fontFamily:FONT_MONO, fontSize:12, padding:12 }}>Loading…</div>
      ) : (
        <table style={{ width:"100%", borderCollapse:"collapse" }}>
          <thead>
            <tr style={{ borderBottom:`1px solid ${T.border}` }}>
              {["Provider","Status","Key (last 4)",""].map(h => (
                <th key={h} style={{ textAlign:"left", padding:"10px 8px", fontFamily:FONT_MONO, fontSize:10, letterSpacing:"0.1em", textTransform:"uppercase", color:T.textDim, fontWeight:500 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ALL_PROVIDERS.map(provider => {
              const meta    = PROVIDER_META[provider];
              const cred    = creds.find(c => c.provider === provider);
              const isSet   = !!cred;
              const isOpen  = editing === provider;
              const isPendingDel = confirmDel === provider;

              return (
                <React.Fragment key={provider}>
                  <tr style={{ borderBottom: (isOpen || isPendingDel) ? "none" : `1px solid ${T.border}` }}>
                    <td style={{ padding:"14px 8px", fontSize:13, color:T.text, fontWeight:500 }}>
                      {meta.label}
                      {meta.isUrl && <span style={{ fontFamily:FONT_MONO, fontSize:9, color:T.textMute, marginLeft:6 }}>base_url</span>}
                    </td>
                    <td style={{ padding:"14px 8px" }}>
                      {isSet
                        ? <Pill color={T.accent}>configured</Pill>
                        : <Pill color={T.textMute}>not set</Pill>}
                      {flash === provider && <span style={{ fontFamily:FONT_MONO, fontSize:10, color:T.accent, marginLeft:8 }}>✓ saved</span>}
                    </td>
                    <td style={{ padding:"14px 8px", fontFamily:FONT_MONO, fontSize:12, color:T.textDim }}>
                      {isSet
                        ? (meta.isUrl
                            ? <span style={{ color:T.textDim }}>{cred.base_url || "—"}</span>
                            : <span>····{cred.last4}</span>)
                        : <span style={{ color:T.textMute }}>—</span>}
                    </td>
                    <td style={{ padding:"14px 8px", display:"flex", gap:8, alignItems:"center" }}>
                      {!isOpen && !isPendingDel && (
                        <button onClick={() => startEdit(provider)}
                          style={{ background:`${T.info}15`, border:`1px solid ${T.info}44`, color:T.info, padding:"5px 12px", borderRadius:3, fontSize:11, fontFamily:FONT_MONO, cursor:"pointer" }}>
                          {isSet ? "Update" : "Set key"}
                        </button>
                      )}
                      {isSet && !isOpen && !isPendingDel && (
                        <button onClick={() => { setConfirmDel(provider); setEditing(null); }}
                          disabled={deleting === provider}
                          style={{ background:`${T.crit}15`, border:`1px solid ${T.crit}44`, color:T.crit, padding:"5px 10px", borderRadius:3, fontSize:11, fontFamily:FONT_MONO, cursor:"pointer", opacity: deleting===provider ? 0.5 : 1 }}>
                          {deleting === provider ? "…" : "Remove"}
                        </button>
                      )}
                    </td>
                  </tr>

                  {/* Inline key/url editor */}
                  {isOpen && (
                    <tr style={{ borderBottom:`1px solid ${T.border}` }}>
                      <td colSpan={4} style={{ padding:"0 8px 14px" }}>
                        <div style={{ display:"flex", flexDirection:"column", gap:8, background:`${T.info}08`, border:`1px solid ${T.info}22`, borderRadius:6, padding:"12px 14px" }}>
                          {meta.isUrl ? (
                            <>
                              <input autoFocus type="text" placeholder="http://localhost:11434"
                                value={urlVal} onChange={e => setUrlVal(e.target.value)}
                                onKeyDown={e => { if (e.key==="Enter") handleSave(); if (e.key==="Escape") cancelEdit(); }}
                                style={{ flex:1, background:T.bg, color:T.text, border:`1px solid ${T.border}`, padding:"8px 12px", borderRadius:4, fontSize:13, fontFamily:FONT_MONO }} />
                              <div style={{ fontSize:10, fontFamily:FONT_MONO, color:T.warn, lineHeight:1.5 }}>
                                The server makes outbound requests to this URL. Only use trusted, controlled endpoints.
                              </div>
                            </>
                          ) : (
                            <input autoFocus type="password" placeholder={`Paste ${meta.label} key (${meta.placeholder})`}
                              value={keyVal} onChange={e => setKeyVal(e.target.value)}
                              onKeyDown={e => { if (e.key==="Enter") handleSave(); if (e.key==="Escape") cancelEdit(); }}
                              style={{ flex:1, background:T.bg, color:T.text, border:`1px solid ${T.border}`, padding:"8px 12px", borderRadius:4, fontSize:13, fontFamily:FONT_MONO }} />
                          )}
                          {saveErr && (
                            <div style={{ fontFamily:FONT_MONO, fontSize:11, color:T.crit, background:`${T.crit}10`, border:`1px solid ${T.crit}33`, borderRadius:4, padding:"8px 10px" }}>
                              {saveErr}
                            </div>
                          )}
                          <div style={{ display:"flex", gap:8 }}>
                            <button onClick={handleSave} disabled={saving || (meta.isUrl ? !urlVal.trim() : !keyVal.trim())}
                              style={{ background:T.accent, color:T.bg, border:"none", padding:"8px 18px", borderRadius:4, fontSize:12, fontFamily:FONT_MONO, fontWeight:600, cursor:"pointer", opacity:(saving||(meta.isUrl?!urlVal.trim():!keyVal.trim()))?0.5:1 }}>
                              {saving ? "Validating & saving…" : isSet ? "Rotate" : "Save"}
                            </button>
                            <button onClick={cancelEdit}
                              style={{ background:"transparent", border:`1px solid ${T.border}`, color:T.textDim, padding:"8px 12px", borderRadius:4, fontSize:12, fontFamily:FONT_MONO, cursor:"pointer" }}>
                              Cancel
                            </button>
                          </div>
                          <div style={{ fontSize:10, fontFamily:FONT_MONO, color:T.textMute }}>
                            {meta.isUrl
                              ? "URL is saved immediately. The server will use it for the next request."
                              : `Key is validated against ${meta.label} before being stored as ciphertext. If validation fails, nothing is saved. Only the last 4 characters are retained for display.`}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}

                  {/* Remove confirmation */}
                  {isPendingDel && (
                    <tr style={{ borderBottom:`1px solid ${T.border}` }}>
                      <td colSpan={4} style={{ padding:"0 8px 14px" }}>
                        <div style={{ background:`${T.crit}08`, border:`1px solid ${T.crit}33`, borderRadius:6, padding:"12px 14px", display:"flex", flexDirection:"column", gap:10 }}>
                          <div style={{ fontFamily:FONT_MONO, fontSize:12, color:T.warn, lineHeight:1.6 }}>
                            Removing the {meta.label} key will <strong style={{ color:T.crit }}>block all {meta.label} requests</strong> from your organization immediately — any agent using a {meta.label} model will receive a 402 error until a new key is set.
                          </div>
                          <div style={{ display:"flex", gap:8 }}>
                            <button onClick={() => handleDeleteConfirmed(provider)}
                              style={{ background:T.crit, color:"#fff", border:"none", padding:"7px 16px", borderRadius:4, fontSize:12, fontFamily:FONT_MONO, fontWeight:600, cursor:"pointer" }}>
                              Remove anyway
                            </button>
                            <button onClick={() => setConfirmDel(null)}
                              style={{ background:"transparent", border:`1px solid ${T.border}`, color:T.textDim, padding:"7px 12px", borderRadius:4, fontSize:12, fontFamily:FONT_MONO, cursor:"pointer" }}>
                              Cancel
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      )}
    </Card>
  );
}


function SettingsPage() {
  const [keys,      setKeys]      = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [editing,   setEditing]   = useState(null);  // key name being edited
  const [editVal,   setEditVal]   = useState("");
  const [saving,    setSaving]    = useState(false);
  const [saved,     setSaved]     = useState(null);
  const [err,       setErr]       = useState(null);

  const load = useCallback(async () => {
    try {
      const data = await fetchKeyStatuses();
      setKeys(data);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const startEdit = (k) => { setEditing(k.key); setEditVal(""); setSaved(null); setErr(null); };
  const cancelEdit = () => { setEditing(null); setEditVal(""); };

  const handleSave = async (keyName) => {
    if (!editVal.trim()) return;
    setSaving(true); setErr(null);
    try {
      await updateKey(keyName, editVal.trim());
      setSaved(keyName);
      setEditing(null);
      setEditVal("");
      await load();
    } catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  };

  const statusColor = (k) => {
    if (!k.configured)  return T.textMute;
    if (k.placeholder)  return T.warn;
    return T.accent;
  };
  const statusLabel = (k) => {
    if (!k.configured)  return "not set";
    if (k.placeholder)  return "placeholder";
    return "configured";
  };

  const PROVIDER_MODELS = {
    OpenAI:    ["gpt-4.1","gpt-4.1-mini","gpt-4o","gpt-4o-mini","o3","o4-mini"],
    Anthropic: ["claude-opus-4-5","claude-sonnet-4-5","claude-haiku-4-5"],
    Google:    ["gemini-2.5-pro","gemini-2.0-flash","gemini-1.5-pro"],
    "Local LLM": ["llama-3.1-70b-local","llama-3.1-8b-local"],
    Auth:      [],
  };

  if (loading) return <div style={{ color:T.textDim, fontFamily:FONT_MONO, padding:24 }}>Loading settings…</div>;

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:14, maxWidth:860 }}>

      {/* Status overview */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:12 }}>
        {[
          { label:"Configured",  count: keys.filter(k=>k.configured&&!k.placeholder).length, color:T.accent },
          { label:"Placeholder", count: keys.filter(k=>k.placeholder).length,                color:T.warn  },
          { label:"Not set",     count: keys.filter(k=>!k.configured).length,                color:T.crit  },
          { label:"Total keys",  count: keys.length,                                          color:T.info  },
        ].map(s => (
          <div key={s.label} style={{ background:T.panel, border:`1px solid ${T.border}`, borderRadius:8, padding:16 }}>
            <div style={{ fontSize:10, fontFamily:FONT_MONO, letterSpacing:"0.12em", textTransform:"uppercase", color:T.textDim }}>{s.label}</div>
            <div style={{ fontSize:32, fontFamily:FONT_MONO, fontWeight:500, color:s.color, marginTop:8, lineHeight:1 }}>{s.count}</div>
          </div>
        ))}
      </div>

      {/* Provider API keys (BYOK) */}
      <ProviderCredentialsSection />

      {/* Guard modes (Visibility First → Governance Later) */}
      <GuardModesSection />

      {/* Keys table */}
      <Card title="API Keys & Configuration" subtitle="Keys are stored in the server .env file. Values are never exposed — only status is shown.">
        {err && <div style={{ color:T.crit, fontFamily:FONT_MONO, fontSize:12, marginBottom:12 }}>{err}</div>}
        <table style={{ width:"100%", borderCollapse:"collapse" }}>
          <thead>
            <tr style={{ borderBottom:`1px solid ${T.border}` }}>
              {["Provider","Env Variable","Models Unlocked","Status",""].map(h => (
                <th key={h} style={{ textAlign:"left", padding:"10px 8px", fontFamily:FONT_MONO, fontSize:10, letterSpacing:"0.1em", textTransform:"uppercase", color:T.textDim, fontWeight:500 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {keys.map(k => {
              const isEdit = editing === k.key;
              const sc = statusColor(k);
              const models = PROVIDER_MODELS[k.provider] || [];
              return (
                <React.Fragment key={k.key}>
                  <tr style={{ borderBottom: isEdit ? "none" : `1px solid ${T.border}` }}>
                    <td style={{ padding:"14px 8px", fontSize:13, color:T.text, fontWeight:500 }}>{k.provider}</td>
                    <td style={{ padding:"14px 8px", fontFamily:FONT_MONO, fontSize:12, color:T.textDim }}>{k.key}</td>
                    <td style={{ padding:"14px 8px", fontSize:11, color:T.textMute }}>
                      {models.length > 0
                        ? <span style={{ fontFamily:FONT_MONO }}>{models.join(", ")}</span>
                        : <span style={{ color:T.textMute }}>—</span>}
                    </td>
                    <td style={{ padding:"14px 8px" }}>
                      <Pill color={sc}>{statusLabel(k)}</Pill>
                      {saved === k.key && <span style={{ fontFamily:FONT_MONO, fontSize:10, color:T.accent, marginLeft:8 }}>✓ saved</span>}
                    </td>
                    <td style={{ padding:"14px 8px" }}>
                      {!isEdit && (
                        <button onClick={() => startEdit(k)}
                          style={{ background:`${T.info}15`, border:`1px solid ${T.info}44`, color:T.info, padding:"5px 12px", borderRadius:3, fontSize:11, fontFamily:FONT_MONO, cursor:"pointer" }}>
                          {k.configured && !k.placeholder ? "Rotate" : "Set key"}
                        </button>
                      )}
                    </td>
                  </tr>
                  {isEdit && (
                    <tr style={{ borderBottom:`1px solid ${T.border}` }}>
                      <td colSpan={5} style={{ padding:"0 8px 14px" }}>
                        <div style={{ display:"flex", gap:10, alignItems:"center", background:`${T.info}08`, border:`1px solid ${T.info}22`, borderRadius:6, padding:"12px 14px" }}>
                          <input
                            autoFocus
                            type="password"
                            placeholder={`Paste new value for ${k.key}…`}
                            value={editVal}
                            onChange={e => setEditVal(e.target.value)}
                            onKeyDown={e => { if (e.key==="Enter") handleSave(k.key); if (e.key==="Escape") cancelEdit(); }}
                            style={{ flex:1, background:T.bg, color:T.text, border:`1px solid ${T.border}`, padding:"8px 12px", borderRadius:4, fontSize:13, fontFamily:FONT_MONO }}
                          />
                          <button onClick={() => handleSave(k.key)} disabled={saving || !editVal.trim()}
                            style={{ background:T.accent, color:T.bg, border:"none", padding:"8px 18px", borderRadius:4, fontSize:12, fontFamily:FONT_MONO, fontWeight:600, cursor:"pointer", opacity:(saving||!editVal.trim())?0.5:1 }}>
                            {saving ? "Saving…" : "Save"}
                          </button>
                          <button onClick={cancelEdit}
                            style={{ background:"transparent", border:`1px solid ${T.border}`, color:T.textDim, padding:"8px 12px", borderRadius:4, fontSize:12, fontFamily:FONT_MONO, cursor:"pointer" }}>
                            Cancel
                          </button>
                        </div>
                        <div style={{ fontSize:10, fontFamily:FONT_MONO, color:T.textMute, marginTop:6, paddingLeft:2 }}>
                          Value is stored in the server .env file. Press Escape to cancel.
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </Card>

      {/* Info card */}
      <Card title="How to configure" subtitle="Environment variables are read on server startup">
        <div style={{ display:"flex", flexDirection:"column", gap:10, fontSize:13, color:T.textDim, lineHeight:1.7 }}>
          <div>You can set keys directly here (saved to <code style={{ background:T.panelHi, padding:"1px 6px", borderRadius:3, fontSize:12, fontFamily:FONT_MONO }}>.env</code> on the server), or edit the file manually and restart.</div>
          <div style={{ background:T.panelHi, border:`1px solid ${T.border}`, borderRadius:4, padding:"10px 14px", fontFamily:FONT_MONO, fontSize:12, color:T.text, lineHeight:2 }}>
            <div><span style={{ color:T.textMute }}># .env</span></div>
            <div><span style={{ color:T.info }}>OPENAI_API_KEY</span>=<span style={{ color:T.accent }}>sk-…</span></div>
            <div><span style={{ color:T.info }}>ANTHROPIC_API_KEY</span>=<span style={{ color:T.accent }}>sk-ant-…</span></div>
            <div><span style={{ color:T.info }}>GOOGLE_API_KEY</span>=<span style={{ color:T.accent }}>AIza…</span></div>
            <div><span style={{ color:T.info }}>JWT_SECRET</span>=<span style={{ color:T.accent }}>a-long-random-string</span></div>
          </div>
          <div style={{ color:T.warn, fontFamily:FONT_MONO, fontSize:11 }}>⚠ After setting OPENAI/ANTHROPIC/GOOGLE keys here, send one test message in Chat — the new client is initialized on first use.</div>
        </div>
      </Card>
    </div>
  );
}

// ─── Nav ──────────────────────────────────────────────────────────────────────
const PAGES = [
  { id:"home",      label:"Home" },
  { id:"chat",      label:"Chat" },
  { id:"overview",  label:"Overview" },
  { id:"cost",      label:"Cost Intelligence" },
  { id:"agents",    label:"Agent Activity" },
  { id:"models",    label:"Model Usage" },
  { id:"workflows", label:"Workflow Health" },
  { id:"alerts",    label:"Alerts" },
  { id:"budgets",   label:"Budgets" },
  { id:"security",  label:"Security" },
  { id:"users",     label:"Users" },
  { id:"apikeys",   label:"API Keys" },
  { id:"settings",     label:"Settings" },
  { id:"integrations", label:"Integrations" },
];

// ─── Root ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [page, setPage]       = useState("home");
  const [filters, setFilters] = useState({ team:"all", model:"all", agent:"all", sev:"all", range:30 });

  // ── Real JWT auth ──
  const [user,         setUser]         = useState(null);
  const [authChecked,  setAuthChecked]  = useState(false);

  // On mount, validate stored token; also listen for mid-session expiry
  useEffect(() => {
    const check = async () => {
      const token = getToken();
      if (token) {
        try {
          const me = await fetchMe();
          if (me) { setUser(me); }
          else    { setToken(null); }
        } catch { setToken(null); }
      }
      setAuthChecked(true);
    };
    check();

    const onExpired = () => { setToken(null); setUser(null); };
    window.addEventListener('auth:expired', onExpired);
    return () => window.removeEventListener('auth:expired', onExpired);
  }, []);

  const handleLogin = (u) => {
    setUser(u);
  };

  const handleLogout = () => {
    setToken(null);
    setUser(null);
  };

  const { apiRecords, lastRefresh, isLive, refresh } = useLiveData(30_000);

  // Platform guard mode badge (best-effort — silent if unauthenticated)
  const [platformMode, setPlatformMode] = useState(null);
  useEffect(() => {
    if (!user) return;
    fetchHealth().then(h => setPlatformMode(h?.platform_mode)).catch(() => {});
  }, [user]);

  // Build event list and metadata from live data or demo fallback
  const { allEvents, allTeams, allAgents } = useMemo(() => {
    if (apiRecords === null) return { allEvents: [], allTeams: TEAMS, allAgents: AGENTS }; // still loading
    if (apiRecords.length === 0) {
      // No live data — use demo
      return { allEvents: genDemoEvents(), allTeams: TEAMS, allAgents: AGENTS };
    }
    const { liveOrg, liveTeams, liveAgents } = buildLiveMetadata(apiRecords);
    const liveEvents = apiRecords.map(apiRecordToEvent);
    return {
      allEvents:  liveEvents,
      allTeams:   liveTeams,
      allAgents:  liveAgents,
    };
  }, [apiRecords]);

  const filteredEvents = useMemo(() => applyFilters(allEvents, filters), [allEvents, filters]);
  const A       = useMemo(() => agg(filteredEvents),               [filteredEvents]);
  const alerts  = useMemo(() => runDetections(filteredEvents),     [filteredEvents]);
  const savings = useMemo(() => estimateSavings(filteredEvents),   [filteredEvents]);
  const risk    = useMemo(() => computeRiskScore(filteredEvents, alerts), [filteredEvents, alerts]);
  const critCount = alerts.filter((a)=>a.sev==="critical").length;

  // Props passed down so page components use the right metadata
  const pageProps = { events: filteredEvents, allTeams, allAgents, A, alerts, savings, risk };

  const renderPage = () => {
    if (!canAccess(user?.role, page)) {
      return (
        <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", height:300, gap:12, color:T.textMute, fontFamily:FONT_MONO }}>
          <div style={{ fontSize:24, color:T.crit }}>⊘</div>
          <div style={{ fontSize:14 }}>Access denied — <strong style={{ color:T.warn }}>{ROLES[user?.role]?.label}</strong> role cannot view this page</div>
        </div>
      );
    }
    switch (page) {
      case "home":      return <Home      {...pageProps} onNavigate={setPage} />;
      case "chat":      return <ChatPage />;
      case "overview":  return <Overview  {...pageProps} />;
      case "cost":      return <CostIntel {...pageProps} />;
      case "agents":    return <AgentActivity {...pageProps} />;
      case "models":    return <ModelUsage A={A} />;
      case "workflows": return <WorkflowHealth {...pageProps} />;
      case "alerts":    return <AlertsPage alerts={alerts} sevFilter={filters.sev} />;
      case "budgets":   return <BudgetsPage />;
      case "security":  return <SecurityPage />;
      case "users":     return <UsersPage />;
      case "apikeys":   return <ApiKeysPage />;
      case "settings":      return <SettingsPage />;
      case "integrations":  return <IntegrationsPage />;
      default:              return null;
    }
  };

  if (!authChecked || apiRecords === null) {
    return <div style={{ minHeight:"100vh", background:T.bg, display:"flex", alignItems:"center", justifyContent:"center", color:T.textDim, fontFamily:FONT_MONO }}>Connecting to AIFinOps Guard…</div>;
  }

  if (!user) {
    return <LoginPage onLogin={handleLogin} />;
  }

  return (
    <UserContext.Provider value={user}>
    <div style={{ minHeight:"100vh", background:T.bg, color:T.text, fontFamily:FONT_UI, fontSize:14, display:"flex" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');
        * { box-sizing:border-box; }
        ::-webkit-scrollbar { width:8px; height:8px; }
        ::-webkit-scrollbar-track { background:${T.bg}; }
        ::-webkit-scrollbar-thumb { background:${T.border}; border-radius:4px; }
        ::-webkit-scrollbar-thumb:hover { background:${T.borderHi}; }
        select { appearance:none; background-image:url("data:image/svg+xml;utf8,<svg fill='%237A8499' xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24'><polygon points='6,9 18,9 12,16'/></svg>"); background-repeat:no-repeat; background-position:right 8px center; padding-right:22px !important; }
        button:focus { outline:none; }
      `}</style>

      {/* Sidebar */}
      <aside style={{ width:230, background:T.panel, borderRight:`1px solid ${T.border}`, padding:"22px 16px", display:"flex", flexDirection:"column", flexShrink:0 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:32, padding:"0 6px" }}>
          <div style={{ width:22, height:22, background:T.accent, borderRadius:4, display:"flex", alignItems:"center", justifyContent:"center", fontFamily:FONT_MONO, fontWeight:600, fontSize:12, color:T.bg }}>◆</div>
          <div>
            <div style={{ fontSize:13, fontWeight:500, letterSpacing:"-0.01em" }}>AIFinOps Guard</div>
            <div style={{ fontSize:9, color:T.textMute, fontFamily:FONT_MONO, letterSpacing:"0.1em", textTransform:"uppercase", marginTop:1 }}>control center</div>
          </div>
        </div>

        <div style={{ fontSize:9, letterSpacing:"0.14em", textTransform:"uppercase", color:T.textMute, fontFamily:FONT_MONO, padding:"0 8px 10px" }}>Telemetry</div>

        <nav style={{ display:"flex", flexDirection:"column", gap:2 }}>
          {PAGES.filter(p => canAccess(user?.role, p.id)).map((p)=>(
            <button key={p.id} onClick={()=>setPage(p.id)}
              style={{ background:page===p.id?T.panelHi:"transparent", border:"none", color:page===p.id?T.text:T.textDim, textAlign:"left", padding:"9px 10px", fontSize:13, borderRadius:4, cursor:"pointer", fontFamily:FONT_UI, display:"flex", alignItems:"center", gap:10, borderLeft:page===p.id?`2px solid ${T.accent}`:"2px solid transparent", transition:"all 0.12s" }}>
              {p.label}
              {p.id==="alerts" && critCount>0 && (
                <span style={{ marginLeft:"auto", background:T.crit, color:T.bg, fontSize:10, fontFamily:FONT_MONO, padding:"1px 6px", borderRadius:8, fontWeight:600 }}>{critCount}</span>
              )}
            </button>
          ))}
        </nav>

        <div style={{ marginTop:"auto", padding:"12px 8px", display:"flex", flexDirection:"column", gap:10 }}>
          {/* User badge */}
          {user && (
            <div style={{ background:T.panelHi, border:`1px solid ${T.border}`, borderRadius:6, padding:"8px 10px", display:"flex", alignItems:"center", gap:8 }}>
              <div style={{ width:8, height:8, borderRadius:"50%", background: ROLES[user.role]?.color ?? T.textDim, flexShrink:0 }}/>
              <div style={{ flex:1, overflow:"hidden" }}>
                <div style={{ fontSize:12, fontWeight:500, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{user.name}</div>
                <div style={{ fontSize:9, fontFamily:FONT_MONO, color: ROLES[user.role]?.color ?? T.textDim, textTransform:"uppercase", letterSpacing:"0.1em" }}>{user.role} · {user.team}</div>
              </div>
              <button title="Sign out" onClick={handleLogout}
                style={{ background:"transparent", border:"none", color:T.textMute, fontSize:12, cursor:"pointer", padding:"2px 4px", lineHeight:1, fontFamily:FONT_MONO }}>⏻</button>
            </div>
          )}
          <div style={{ fontSize:10, color:T.textMute, fontFamily:FONT_MONO, letterSpacing:"0.08em", lineHeight:1.8 }}>
            <div style={{ color:isLive?T.accent:T.warn }}>● {isLive?"live data":"demo mode"}</div>
            <span style={{ color:T.textMute }}>{filteredEvents.length.toLocaleString()} events / {filters.range}d</span>
            {lastRefresh && <div style={{ color:T.textMute, marginTop:2 }}>updated {lastRefresh.toLocaleTimeString()}</div>}
          </div>
          <button onClick={refresh} style={{ width:"100%", background:"transparent", border:`1px solid ${T.border}`, color:T.textDim, padding:"6px 10px", borderRadius:3, fontSize:10, fontFamily:FONT_MONO, cursor:"pointer", letterSpacing:"0.08em", textTransform:"uppercase" }}>↻ Refresh</button>
        </div>
      </aside>

      {/* Main */}
      <main style={{ flex:1, padding:"20px 28px", overflow:"auto" }}>
        <header style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:18 }}>
          <div>
            <div style={{ fontSize:11, color:T.textMute, fontFamily:FONT_MONO, letterSpacing:"0.12em", textTransform:"uppercase" }}>{page}</div>
            <h1 style={{ fontSize:22, fontWeight:500, margin:"4px 0 0", letterSpacing:"-0.015em" }}>{PAGES.find((p)=>p.id===page)?.label}</h1>
          </div>
          <div style={{ display:"flex", gap:10, alignItems:"center", fontFamily:FONT_MONO, fontSize:11, color:T.textDim }}>
            {platformMode && (
              <>
                <span title={GUARD_MODE_META[platformMode]?.desc}
                  style={{ display:"inline-flex", alignItems:"center", gap:5, color:GUARD_MODE_META[platformMode]?.color }}>
                  ● {(GUARD_MODE_META[platformMode]?.label || platformMode).toLowerCase()}
                </span>
                <span style={{ color:T.textMute }}>|</span>
              </>
            )}
            <span>{filters.team==="all"?"all teams":allTeams.find((t)=>t.id===filters.team)?.name}</span>
            <span style={{ color:T.textMute }}>|</span>
            <span>last {filters.range}d</span>
            <span style={{ color:T.textMute }}>|</span>
            <span style={{ color:isLive?T.accent:T.warn }}>● {isLive?"live":"demo"}</span>
          </div>
        </header>

        {!["home","budgets","security","chat","users","apikeys","settings","integrations"].includes(page) && <FilterBar filters={filters} setFilters={setFilters} allTeams={allTeams} allAgents={allAgents}/>}

        {renderPage()}
      </main>
    </div>
    </UserContext.Provider>
  );
}
