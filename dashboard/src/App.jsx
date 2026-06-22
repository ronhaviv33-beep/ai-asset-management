import React, { useState, useMemo, useEffect, useCallback, useRef, createContext, useContext, Component } from "react";

class PageErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(e) { return { error: e }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, fontFamily: "monospace", fontSize: 13, color: "#FF5C7A", background: "#1a1a1a", borderRadius: 8, border: "1px solid #FF5C7A44" }}>
          <strong>Page error:</strong> {String(this.state.error.message || this.state.error)}
          <br /><br />
          <button onClick={() => this.setState({ error: null })} style={{ background: "transparent", border: "1px solid #FF5C7A", color: "#FF5C7A", padding: "4px 12px", borderRadius: 4, cursor: "pointer", fontFamily: "monospace" }}>Retry</button>
        </div>
      );
    }
    return this.props.children;
  }
}
import { login as apiLogin, fetchMe, fetchUsers, createUser, updateUser, deleteUser, getToken, setToken, authFetch, fetchKeyStatuses, updateKey, BASE, fetchApiKeys, createApiKey, revokeApiKey, deleteApiKey, fetchGuardModes, setGuardMode, fetchHealth, fetchProviderCredentials, upsertProviderCredential, deleteProviderCredential, fetchRoles, createRole, updateRole, deleteRole, fetchTeams, fetchAssets, fetchAssetsSummary, fetchAssetTelemetry, fetchUnassignedAssets, claimAsset, updateAssetRegistry, fetchOrgConfig, updateOrgConfig, getDemoMode, setDemoMode, fetchOrganizations, setViewOrg, getViewOrg, fetchAgentsSummary, fetchRelationships } from "./api.js";
import AgentInventory from "./pages/AgentInventory.jsx";
import CostIntelligence from "./pages/CostIntelligence.jsx";
import PricingRegistry from "./pages/PricingRegistry.jsx";
import ExecutiveDashboard from "./pages/ExecutiveDashboard.jsx";
import DiscoveryCenter from "./pages/DiscoveryCenter.jsx";
import GovernanceCenter from "./pages/GovernanceCenter.jsx";
import SecurityIntelligence from "./pages/SecurityIntelligence.jsx";
import EcosystemDiscovery from "./pages/EcosystemDiscovery.jsx";
import RelationshipMap from "./pages/RelationshipMap.jsx";
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
  const ts = parseUTC(r.timestamp).getTime();
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
    cost:              r.cost_usd,
    pricing_estimated: r.pricing_estimated ?? false,
    latency:      r.latency_ms,
    status:       "success",
    error:        null,
    afterHours,
    sensitive:    r.sensitive ?? false,
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
  const liveOrg   = { id: "org_live", name: "Live (AI Asset Management)" };
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
  const [serverTeams, setServerTeams] = useState([]);
  const [serverAlerts, setServerAlerts] = useState([]);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [isLive, setIsLive] = useState(false);
  const [demoMode, setDemoModeState] = useState(true);

  const load = useCallback(async () => {
    if (!getToken()) { setApiRecords([]); return; }
    try {
      const [telR, teamsR, alertsR, dm] = await Promise.all([
        authFetch(`${BASE}/telemetry?limit=1000`),
        fetchTeams().catch(() => []),
        authFetch(`${BASE}/security/alerts`).catch(() => null),
        getDemoMode().catch(() => true),
      ]);
      if (!telR || !telR.ok) throw new Error("API error");
      const data = await telR.json();
      setApiRecords(data);
      setServerTeams(Array.isArray(teamsR) ? teamsR : []);
      if (alertsR?.ok) {
        const sa = await alertsR.json();
        setServerAlerts(Array.isArray(sa) ? sa : []);
      }
      setDemoModeState(!!dm);
      setIsLive(!dm);
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

  return { apiRecords, serverTeams, serverAlerts, lastRefresh, isLive, demoMode, setDemoModeState, refresh: load };
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
  sensitive_data_exposure:  { title: "Sensitive content in AI requests",      category: "Runtime Signal",               checks: "Detects requests flagged with sensitive content patterns.", matters: "Sensitive content sent to external models may need review depending on your data policies.", causes: ["Unstructured user input passed to model without filtering", "Raw documents included in context"], detail: (a) => `${a.entity} triggered this: ${a.msg.toLowerCase()}. Review request patterns for this asset.` },
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
  // Helpers to get the most recent event timestamp for an agent
  const latestTsByAgent = {};
  events.forEach((e) => { if (!latestTsByAgent[e.agent] || e.ts > latestTsByAgent[e.agent]) latestTsByAgent[e.agent] = e.ts; });

  // Cost spike: 7-day comparison OR high absolute spend today (> $0.05)
  Object.keys(byAgentToday).forEach((a) => {
    const today = byAgentToday[a]; const avg7 = (byAgent7d[a] || 0) / 7;
    const spike = (avg7 > 0.01 && today > 2 * avg7) || (avg7 === 0 && today > 0.05);
    if (spike) alerts.push({ type: "agent_cost_spike", sev: "critical", entity: a, msg: `Agent cost $${today.toFixed(4)} today vs $${avg7.toFixed(4)} 7-day avg`, action: "Inspect prompt construction and tool-call loops", ts: latestTsByAgent[a] || now });
  });
  events.filter((e) => e.tokens_total > 30000).slice(0, 5).forEach((e) => alerts.push({ type: "high_token_prompt", sev: "warning", entity: e.agent, msg: `${e.tokens_total.toLocaleString()} tokens in single request (${e.model})`, action: "Add context compaction or retrieval truncation", ts: e.ts }));
  const wfFails = {}, wfTotal = {}, wfLatestTs = {};
  events.filter((e) => now - e.ts < 2 * DAY).forEach((e) => { wfTotal[e.workflow] = (wfTotal[e.workflow] || 0) + 1; if (e.status === "failed") wfFails[e.workflow] = (wfFails[e.workflow] || 0) + 1; if (!wfLatestTs[e.workflow] || e.ts > wfLatestTs[e.workflow]) wfLatestTs[e.workflow] = e.ts; });
  Object.keys(wfTotal).forEach((w) => { const rate = (wfFails[w] || 0) / wfTotal[w]; if (rate > 0.25 && wfTotal[w] > 10) alerts.push({ type: "failed_workflow_spike", sev: "critical", entity: w, msg: `${(rate * 100).toFixed(0)}% failure rate over last 48h`, action: "Check upstream tool availability and auth tokens", ts: wfLatestTs[w] || now }); });
  const cheapCandidates = events.filter((e) => tierFromModel(e.model) === "premium" && e.tokens_total < 200);
  if (cheapCandidates.length > 5) alerts.push({ type: "expensive_model_usage", sev: "warning", entity: cheapCandidates[0].agent, msg: `${cheapCandidates.length} premium-model calls under 200 tokens`, action: "Route short prompts to gpt-4o-mini or claude-sonnet", ts: cheapCandidates[0].ts });
  const afterHoursAgents = {}, afterHoursLatestTs = {};
  events.filter((e) => now - e.ts < 7 * DAY && e.afterHours).forEach((e) => { afterHoursAgents[e.agent] = (afterHoursAgents[e.agent] || 0) + 1; if (!afterHoursLatestTs[e.agent] || e.ts > afterHoursLatestTs[e.agent]) afterHoursLatestTs[e.agent] = e.ts; });
  Object.keys(afterHoursAgents).forEach((a) => { if (afterHoursAgents[a] > 5) alerts.push({ type: "unusual_after_hours_usage", sev: "info", entity: a, msg: `${afterHoursAgents[a]} calls outside 07:00–20:00 in last 7d`, action: "Confirm batch job is intentional; otherwise rotate keys", ts: afterHoursLatestTs[a] || now }); });
  // Loop detection: >5 calls from same agent in any 30-min window
  const buckets = {}, bucketLatestTs = {};
  events.forEach((e) => { const k = `${e.agent}:${Math.floor(e.ts / 1_800_000)}`; buckets[k] = (buckets[k] || 0) + 1; if (!bucketLatestTs[k] || e.ts > bucketLatestTs[k]) bucketLatestTs[k] = e.ts; });
  const flagged = new Set();
  Object.entries(buckets).forEach(([k, v]) => { const [agent] = k.split(":"); if (v > 5 && !flagged.has(agent)) { flagged.add(agent); alerts.push({ type: "repeated_agent_loop", sev: "critical", entity: agent, msg: `${v} calls in a single 30-min window`, action: "Check for tool-call retry loop or missing termination", ts: bucketLatestTs[k] || now }); } });
  const unapproved = events.filter((e) => !approvedModel(e.model));
  if (unapproved.length > 0) alerts.push({ type: "unapproved_model_usage", sev: "warning", entity: unapproved[0].agent, msg: `${unapproved.length} calls to non-allowlisted model "${unapproved[0].model}"`, action: "Block at gateway or request governance approval", ts: unapproved.reduce((max, e) => e.ts > max ? e.ts : max, 0) });
  const sensitive = events.filter((e) => e.sensitive);
  if (sensitive.length > 0) alerts.push({ type: "sensitive_data_exposure", sev: "warning", entity: sensitive[0].agent, msg: `${sensitive.length} requests flagged with sensitive content patterns`, action: "Review asset request patterns", ts: sensitive.reduce((max, e) => e.ts > max ? e.ts : max, 0) });
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
  const estCount = events.filter((e)=>e.pricing_estimated).length;
  const f7 = Math.min(Math.round(estCount/2),10); score+=f7; factors.push({ label:"Unknown models", value:f7, max:10, raw:estCount });
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
// SQLite returns naive UTC strings without Z; append it so the browser parses them as UTC → local time
const parseUTC = (s) => new Date(typeof s === "string" && !s.endsWith("Z") && !s.includes("+") ? s + "Z" : s);

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
function Home({ onNavigate }) {
  const [summary,   setSummary]   = useState(null);
  const [assets,    setAssets]    = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [lastRefresh, setLastRefresh] = useState(null);

  const load = useCallback(async () => {
    try {
      const [s, a] = await Promise.all([
        fetchAssetsSummary(90),
        fetchAssets({ days: 90, sort_by: "monthly_cost_usd", order: "desc" }),
      ]);
      setSummary(s);
      setAssets(Array.isArray(a) ? a : []);
      setLastRefresh(new Date());
    } catch {
      setSummary(null);
      setAssets([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [load]);

  // Derived data
  const highRisk   = (assets || []).filter(a => a.risk === "high");
  const unowned    = (assets || []).filter(a => !a.owner);
  const noActivity = (assets || []).filter(a => a.status === "inactive");

  // Team distribution — group by team, count agents + sum monthly cost
  const teamMap = {};
  (assets || []).forEach(a => {
    const t = a.team || "Unknown";
    if (!teamMap[t]) teamMap[t] = { team: t, count: 0, cost: 0, high_risk: 0 };
    teamMap[t].count++;
    teamMap[t].cost += a.monthly_cost_usd || 0;
    if (a.risk === "high") teamMap[t].high_risk++;
  });
  const teamRows = Object.values(teamMap).sort((a, b) => b.count - a.count);
  const maxTeamCount = Math.max(...teamRows.map(t => t.count), 1);

  const riskColor  = r => r === "high" ? T.crit : r === "medium" ? T.warn : T.accent;
  const statusColor = s => s === "active" ? T.accent : s === "dormant" ? T.warn : T.textMute;

  if (loading) return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:300, color:T.textMute, fontFamily:FONT_MONO }}>
      Loading estate overview…
    </div>
  );

  const s = summary || {};

  return (
    <div style={{ padding:"0 0 32px" }}>

      {/* Header */}
      <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", marginBottom:24 }}>
        <div>
          <div style={{ fontSize:22, fontWeight:600, letterSpacing:"-0.02em", color:T.text }}>AI Agent System of Record</div>
          <div style={{ fontSize:12, color:T.textDim, marginTop:4, fontFamily:FONT_MONO }}>
            {s.total_agents ?? 0} agents discovered · runtime dependencies mapped · last 90 days
            {lastRefresh && <span style={{ color:T.textMute, marginLeft:12 }}>· {lastRefresh.toLocaleTimeString()}</span>}
          </div>
        </div>
        <button onClick={() => onNavigate("assets")}
          style={{ background:`${T.accent}15`, border:`1px solid ${T.accent}55`, color:T.accent,
            padding:"8px 16px", borderRadius:5, fontSize:11, fontFamily:FONT_MONO, cursor:"pointer",
            letterSpacing:"0.08em", textTransform:"uppercase", flexShrink:0 }}>
          Full Inventory →
        </button>
      </div>

      {/* KPI strip */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:10, marginBottom:24 }}>
        {[
          { label:"Total Agents",   value: s.total_agents   ?? 0, color:T.text,    sub:"discovered" },
          { label:"Active",         value: s.active_agents  ?? 0, color:T.accent,  sub:"seen ≤ 7 days" },
          { label:"Dormant",        value: s.dormant_agents ?? 0, color:T.warn,    sub:"7–30 days idle" },
          { label:"Inactive",       value: s.inactive_agents?? 0, color:T.textMute,sub:"> 30 days idle" },
          { label:"No Owner",       value: unowned.length,         color: unowned.length > 0 ? T.warn : T.accent, sub:"unassigned" },
          { label:"High Risk",      value: s.high_risk_agents?? 0, color: s.high_risk_agents > 0 ? T.crit : T.accent, sub:"need review" },
          { label:"Monthly Spend",  value:`$${(s.monthly_cost_usd ?? 0).toFixed(2)}`, color:T.purple, sub:"last 30 days", big:true },
        ].map(({ label, value, color, sub, big }) => (
          <div key={label} style={{ background:T.panel, border:`1px solid ${T.border}`, borderRadius:8, padding:"14px 14px 12px" }}>
            <div style={{ fontSize:10, color:T.textMute, fontFamily:FONT_MONO, textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:8 }}>{label}</div>
            <div style={{ fontSize: big ? 18 : 28, fontWeight:600, color, fontFamily:FONT_MONO, lineHeight:1 }}>{value}</div>
            <div style={{ fontSize:10, color:T.textMute, fontFamily:FONT_MONO, marginTop:6 }}>{sub}</div>
          </div>
        ))}
      </div>

      {/* Main two-column layout */}
      <div style={{ display:"grid", gridTemplateColumns:"1.1fr 0.9fr", gap:16, marginBottom:16 }}>

        {/* Agents requiring attention */}
        <div style={{ background:T.panel, border:`1px solid ${T.border}`, borderRadius:8, overflow:"hidden" }}>
          <div style={{ padding:"14px 16px", borderBottom:`1px solid ${T.border}`, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
            <div>
              <div style={{ fontSize:13, fontWeight:500, color:T.text }}>Agents Requiring Attention</div>
              <div style={{ fontSize:11, color:T.textDim, fontFamily:FONT_MONO, marginTop:2 }}>High-risk agents with active signals</div>
            </div>
            {highRisk.length > 0 && (
              <span style={{ background:`${T.crit}22`, color:T.crit, fontSize:11, fontFamily:FONT_MONO, padding:"2px 10px", borderRadius:10, fontWeight:600 }}>
                {highRisk.length} agent{highRisk.length !== 1 ? "s" : ""}
              </span>
            )}
          </div>
          {highRisk.length === 0 ? (
            <div style={{ padding:32, textAlign:"center", color:T.accent, fontFamily:FONT_MONO, fontSize:13 }}>
              ✓ No high-risk agents detected
            </div>
          ) : (
            <div>
              {highRisk.slice(0, 6).map(a => {
                const sig = a.signals || {};
                const lastSeen = new Date(a.last_seen);
                const daysAgo = Math.floor((Date.now() - lastSeen.getTime()) / 86400000);
                return (
                  <div key={a.agent_name}
                    onClick={() => onNavigate("assets")}
                    style={{ padding:"12px 16px", borderBottom:`1px solid ${T.border}`, cursor:"pointer", transition:"background 0.1s" }}
                    onMouseEnter={e => e.currentTarget.style.background = T.panelHi}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:6 }}>
                      <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                        <span style={{ fontFamily:FONT_MONO, fontSize:13, color:T.text, fontWeight:500 }}>{a.agent_name}</span>
                        <span style={{ fontSize:10, background:`${statusColor(a.status)}18`, color:statusColor(a.status), padding:"1px 7px", borderRadius:8, fontFamily:FONT_MONO }}>{a.status}</span>
                      </div>
                      <span style={{ fontSize:11, color:T.textMute, fontFamily:FONT_MONO }}>{daysAgo === 0 ? "today" : `${daysAgo}d ago`}</span>
                    </div>
                    <div style={{ display:"flex", alignItems:"center", gap:6, flexWrap:"wrap" }}>
                      <span style={{ fontSize:11, color:T.textDim, fontFamily:FONT_MONO }}>{a.team}</span>
                      <span style={{ color:T.textMute, fontSize:11 }}>·</span>
                      <span style={{ fontSize:11, color:T.purple, fontFamily:FONT_MONO }}>${(a.monthly_cost_usd||0).toFixed(3)}/mo</span>
                      {sig.has_blocked && <span style={{ fontSize:10, background:`${T.warn}22`, color:T.warn, padding:"1px 7px", borderRadius:8, fontFamily:FONT_MONO }}>{sig.blocked_count} blocked</span>}
                      {sig.has_loop    && <span style={{ fontSize:10, background:`${T.crit}22`, color:T.crit, padding:"1px 7px", borderRadius:8, fontFamily:FONT_MONO }}>loop detected</span>}
                    </div>
                  </div>
                );
              })}
              {highRisk.length > 6 && (
                <div style={{ padding:"10px 16px" }}>
                  <button onClick={() => onNavigate("assets")}
                    style={{ background:"transparent", border:"none", color:T.textDim, fontSize:11, fontFamily:FONT_MONO, cursor:"pointer", textDecoration:"underline" }}>
                    +{highRisk.length - 6} more — view all in Asset Inventory
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Team distribution */}
        <div style={{ background:T.panel, border:`1px solid ${T.border}`, borderRadius:8, overflow:"hidden" }}>
          <div style={{ padding:"14px 16px", borderBottom:`1px solid ${T.border}` }}>
            <div style={{ fontSize:13, fontWeight:500, color:T.text }}>Team Distribution</div>
            <div style={{ fontSize:11, color:T.textDim, fontFamily:FONT_MONO, marginTop:2 }}>Agents and spend per team</div>
          </div>
          {teamRows.length === 0 ? (
            <div style={{ padding:32, textAlign:"center", color:T.textMute, fontFamily:FONT_MONO, fontSize:12 }}>No team data</div>
          ) : (
            <div style={{ padding:"8px 0" }}>
              {teamRows.map(row => (
                <div key={row.team} style={{ padding:"8px 16px", display:"flex", alignItems:"center", gap:10 }}>
                  <div style={{ width:130, fontSize:12, color:T.text, fontFamily:FONT_MONO, flexShrink:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }} title={row.team}>{row.team}</div>
                  <div style={{ flex:1, height:6, background:T.border, borderRadius:3, overflow:"hidden" }}>
                    <div style={{ width:`${(row.count / maxTeamCount) * 100}%`, height:"100%",
                      background: row.high_risk > 0 ? T.crit : T.accent, borderRadius:3, transition:"width 0.3s" }} />
                  </div>
                  <div style={{ width:20, textAlign:"right", fontSize:12, fontFamily:FONT_MONO, color:T.text, flexShrink:0 }}>{row.count}</div>
                  <div style={{ width:68, textAlign:"right", fontSize:11, fontFamily:FONT_MONO, color:T.textDim, flexShrink:0 }}>${row.cost.toFixed(2)}</div>
                  {row.high_risk > 0 && (
                    <div style={{ width:28, flexShrink:0 }}>
                      <span style={{ fontSize:10, background:`${T.crit}22`, color:T.crit, padding:"1px 5px", borderRadius:6, fontFamily:FONT_MONO }}>{row.high_risk}!</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Ownership gap banner */}
      {unowned.length > 0 && (
        <div style={{ background:`${T.warn}0D`, border:`1px solid ${T.warn}33`, borderRadius:8, padding:"16px 20px", marginBottom:16,
          display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          <div>
            <div style={{ fontSize:13, fontWeight:500, color:T.warn }}>Ownership Gap</div>
            <div style={{ fontSize:12, color:T.textDim, fontFamily:FONT_MONO, marginTop:2 }}>
              {unowned.length} of {(assets||[]).length} agents have no assigned owner — accountability is untracked
            </div>
          </div>
          <button onClick={() => onNavigate("assets")}
            style={{ background:"transparent", border:`1px solid ${T.warn}55`, color:T.warn,
              padding:"7px 14px", borderRadius:5, fontSize:11, fontFamily:FONT_MONO, cursor:"pointer",
              letterSpacing:"0.06em", whiteSpace:"nowrap" }}>
            Assign Owners →
          </button>
        </div>
      )}

      {/* Inactive agents banner */}
      {noActivity.length > 0 && (
        <div style={{ background:`${T.textMute}0A`, border:`1px solid ${T.border}`, borderRadius:8, padding:"16px 20px",
          display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          <div>
            <div style={{ fontSize:13, fontWeight:500, color:T.textDim }}>Inactive Agents</div>
            <div style={{ fontSize:12, color:T.textMute, fontFamily:FONT_MONO, marginTop:2 }}>
              {noActivity.length} agent{noActivity.length !== 1 ? "s" : ""} not seen in 30+ days — consider decommissioning
            </div>
          </div>
          <button onClick={() => onNavigate("assets")}
            style={{ background:"transparent", border:`1px solid ${T.border}`, color:T.textDim,
              padding:"7px 14px", borderRadius:5, fontSize:11, fontFamily:FONT_MONO, cursor:"pointer",
              letterSpacing:"0.06em", whiteSpace:"nowrap" }}>
            Review →
          </button>
        </div>
      )}
    </div>
  );
}

function RiskScoreCard({ risk }) {
  const color = risk.score>60?T.crit:risk.score>35?T.warn:T.accent;
  const label = risk.score>60?"ELEVATED":risk.score>35?"MODERATE":"HEALTHY";
  return (
    <Card title="AI Runtime Risk Score" subtitle="Composite of 7 factors, 0–100">
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

function FilterBar({ filters, setFilters, allTeams, allAgents, user, rolesMap }) {
  const isTeamScoped = !!(rolesMap?.[user?.role]?.team_scoped);
  const lockedTeam   = user?.team || "";

  const Select = ({ label, value, onChange, options }) => (
    <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
      <label style={{ fontSize:9, fontFamily:FONT_MONO, letterSpacing:"0.12em", textTransform:"uppercase", color:T.textMute }}>{label}</label>
      <select value={value} onChange={(e)=>onChange(e.target.value)} style={{ background:T.panelHi, color:T.text, border:`1px solid ${T.border}`, padding:"5px 8px", borderRadius:3, fontSize:12, fontFamily:FONT_MONO, cursor:"pointer", minWidth:100 }}>
        {options.map((o)=><option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );

  const TeamField = isTeamScoped ? (
    <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
      <label style={{ fontSize:9, fontFamily:FONT_MONO, letterSpacing:"0.12em", textTransform:"uppercase", color:T.textMute }}>Team</label>
      <div style={{ display:"flex", alignItems:"center", gap:6, background:T.panelHi, border:`1px solid ${T.border}`, padding:"5px 10px", borderRadius:3, fontSize:12, fontFamily:FONT_MONO, color:T.accent, minWidth:100 }}>
        <span style={{ fontSize:9, color:T.accentDim }}>⬤</span>
        {lockedTeam || "—"}
      </div>
    </div>
  ) : (
    <Select label="Team" value={filters.team} onChange={(v)=>setFilters({...filters,team:v})}
      options={[{value:"all",label:"All teams"}, ...allTeams.map((t)=>({value:t.id,label:t.name}))]}/>
  );

  const handleReset = () => setFilters({
    team:  isTeamScoped ? filters.team : "all",
    model: "all", agent: "all", sev: "all", range: 30,
  });

  return (
    <div style={{ display:"flex", gap:16, padding:"12px 18px", background:T.panel, border:`1px solid ${T.border}`, borderRadius:6, marginBottom:14, alignItems:"flex-end", flexWrap:"wrap" }}>
      {TeamField}
      <Select label="Model"    value={filters.model} onChange={(v)=>setFilters({...filters,model:v})} options={[{value:"all",label:"All models"}, ...MODELS.map((m)=>({value:m.name,label:m.name}))]}/>
      <Select label="Agent"    value={filters.agent} onChange={(v)=>setFilters({...filters,agent:v})} options={[{value:"all",label:"All agents"}, ...allAgents.map((a)=>({value:a.id,label:a.name}))]}/>
      <Select label="Severity" value={filters.sev}   onChange={(v)=>setFilters({...filters,sev:v})}   options={[{value:"all",label:"All"},{value:"critical",label:"Critical"},{value:"warning",label:"Warning"},{value:"info",label:"Info"}]}/>
      <Select label="Range"    value={String(filters.range)} onChange={(v)=>setFilters({...filters,range:parseInt(v)})} options={[{value:"1",label:"Last 24h"},{value:"7",label:"Last 7d"},{value:"30",label:"Last 30d"}]}/>
      <button onClick={handleReset} style={{ background:"transparent", color:T.textDim, border:`1px solid ${T.border}`, padding:"6px 12px", borderRadius:3, fontSize:11, fontFamily:FONT_MONO, cursor:"pointer", marginLeft:"auto" }}>Reset</button>
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
        authFetch(`${BASE}/budgets/status`).then((x) => x.json()).catch(() => []),
      ]);
      setRules(r);
      setStatus(s);
    } catch { /* ignore load errors — show empty state */ }
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

  const colKey = { "Time":"timestamp","Team":"team","Agent":"agent","Model":"model","Status":"blocked","Flags":"sensitive","Tokens":"total_tokens","Cost":"cost_usd" };

  // Build a lookup: agent → sorted timestamps, for loop detection per-row
  const agentTimes = React.useMemo(() => {
    const m = {};
    audit.forEach(r => { (m[r.agent] = m[r.agent] || []).push(parseUTC(r.timestamp).getTime()); });
    Object.values(m).forEach(a => a.sort((x,y) => x - y));
    return m;
  }, [audit]);
  const isLoopRow = (r) => {
    const times = agentTimes[r.agent] || [];
    const t = parseUTC(r.timestamp).getTime();
    const nearby = times.filter(x => Math.abs(x - t) < 5 * 60 * 1000);
    return nearby.length >= 5;
  };
  const isAfterHours = (r) => { const h = parseUTC(r.timestamp).getHours(); return h < 7 || h >= 20; };
  const sorted = sort(audit, (r, k) => {
    if (k === "timestamp") return parseUTC(r.timestamp).getTime();
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
            {["Time","Team","Agent","Model","Status","Flags","Tokens","Cost",""].map((h) => h === "" ? (
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
            const rowBg = r.blocked ? `${T.crit}08` : "transparent";
            let findings = [];
            try { findings = JSON.parse(r.sensitive_findings || "[]"); } catch {}
            return (
              <React.Fragment key={r.id}>
                <tr style={{ borderBottom: isOpen ? "none" : `1px solid ${T.border}`, background: rowBg, cursor:"pointer" }}
                    onClick={() => toggleExpand(r.id)}>
                  <td style={{ padding:"10px 8px", fontFamily:FONT_MONO, fontSize:11, color:T.textMute }}>{parseUTC(r.timestamp).toLocaleString()}</td>
                  <td style={{ padding:"10px 8px", fontSize:12, color:T.text }}>{r.team}</td>
                  <td style={{ padding:"10px 8px", fontSize:12, color:T.textDim }}>{r.agent}</td>
                  <td style={{ padding:"10px 8px", fontFamily:FONT_MONO, fontSize:11, color:T.textDim }}>{r.model}</td>
                  <td style={{ padding:"10px 8px" }}>
                    {r.blocked ? <Pill color={T.crit}>blocked</Pill> : <Pill color={T.accent}>ok</Pill>}
                  </td>
                  <td style={{ padding:"6px 8px" }}>
                    <div style={{ display:"flex", flexWrap:"wrap", gap:3 }}>
                      {r.pricing_estimated && <Pill color="#f97316">unknown mdl</Pill>}
                      {isLoopRow(r)      && <Pill color="#eab308">loop</Pill>}
                      {isAfterHours(r)   && <Pill color={T.info}>after-hrs</Pill>}
                      {!r.pricing_estimated && !isLoopRow(r) && !isAfterHours(r) && (
                        <span style={{ color:T.textMute, fontFamily:FONT_MONO, fontSize:11 }}>—</span>
                      )}
                    </div>
                  </td>
                  <td style={{ padding:"10px 8px", fontFamily:FONT_MONO, fontSize:12, color:T.textDim }}>{r.total_tokens.toLocaleString()}</td>
                  <td style={{ padding:"10px 8px", fontFamily:FONT_MONO, fontSize:12, color: r.pricing_estimated ? "#f97316" : T.text }}>
                    {r.pricing_estimated && <span title="Conservative estimate — model not in pricing table" style={{ marginRight:2 }}>~</span>}
                    ${r.cost_usd.toFixed(6)}
                  </td>
                  <td style={{ padding:"10px 8px", fontFamily:FONT_MONO, fontSize:10, color: isOpen ? T.accent : T.textMute, userSelect:"none" }}>
                    {isOpen ? "▲" : "▼"}
                  </td>
                </tr>
                {isOpen && (() => {
                  const startTime = parseUTC(r.timestamp);
                  const endTime   = new Date(startTime.getTime() + (r.latency_ms || 0));
                  const afterHrs  = isAfterHours(r);
                  const loopFlag  = isLoopRow(r);
                  const Field = ({ label, value, color, mono = true }) => (
                    <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
                      <div style={{ fontSize:9, fontFamily:FONT_MONO, letterSpacing:"0.12em", textTransform:"uppercase", color:T.textMute }}>{label}</div>
                      <div style={{ fontSize:12, fontFamily: mono ? FONT_MONO : FONT_UI, color: color || T.text, wordBreak:"break-all" }}>{value ?? "—"}</div>
                    </div>
                  );
                  return (
                    <tr style={{ background: r.blocked ? `${T.crit}06` : T.panelHi }}>
                      <td colSpan={9} style={{ borderBottom:`1px solid ${T.border}`, padding:0 }}>
                        <div style={{ padding:"20px 24px", display:"flex", flexDirection:"column", gap:18, borderTop:`1px solid ${T.border}` }}>

                          {/* Section header */}
                          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                            <div style={{ fontSize:11, fontFamily:FONT_MONO, letterSpacing:"0.14em", textTransform:"uppercase", color:T.textDim, fontWeight:600 }}>Request Details</div>
                            <div style={{ display:"flex", gap:6 }}>
                              {r.blocked   && <Pill color={T.crit}>blocked</Pill>}
                              {r.sensitive && <Pill color={T.warn}>Sensitive Content</Pill>}
                              {loopFlag    && <Pill color="#eab308">loop</Pill>}
                              {afterHrs    && <Pill color={T.info}>after-hrs</Pill>}
                              {r.pricing_estimated && <Pill color="#f97316">est. pricing</Pill>}
                            </div>
                          </div>

                          {/* Identity grid */}
                          <div style={{ display:"grid", gridTemplateColumns:"repeat(6,1fr)", gap:12, background:T.panel, border:`1px solid ${T.border}`, borderRadius:8, padding:"14px 16px" }}>
                            <Field label="Request ID"  value={`#${r.id}`}                              color={T.textDim} />
                            <Field label="Team"        value={r.team}                                  color={T.text} />
                            <Field label="Agent"       value={r.agent}                                 color={T.text} />
                            <Field label="Model"       value={r.model}                                 color={T.text} />
                            <Field label="Status"      value={r.blocked ? "BLOCKED" : "OK"}            color={r.blocked ? T.crit : T.accent} />
                            <Field label="Latency"     value={`${Math.round(r.latency_ms || 0)} ms`}   color={T.text} />
                          </div>

                          {/* Timing + tokens + cost grid */}
                          <div style={{ display:"grid", gridTemplateColumns:"repeat(6,1fr)", gap:12, background:T.panel, border:`1px solid ${T.border}`, borderRadius:8, padding:"14px 16px" }}>
                            <Field label="Start Time"         value={startTime.toLocaleTimeString()}                        color={T.text} />
                            <Field label="End Time"           value={endTime.toLocaleTimeString()}                          color={T.text} />
                            <Field label="Total Tokens"       value={(r.total_tokens || 0).toLocaleString()}                color={T.text} />
                            <Field label="Prompt Tokens"      value={(r.prompt_tokens || 0).toLocaleString()}               color={T.text} />
                            <Field label="Completion Tokens"  value={(r.completion_tokens || 0).toLocaleString()}           color={T.text} />
                            <Field label="Spend"
                              value={`${r.pricing_estimated === true ? "~" : ""}$${(r.cost_usd || 0).toFixed(6)}`}
                              color={r.pricing_estimated === true ? "#f97316" : T.text} />
                          </div>

                          {/* Prompt */}
                          <div>
                            <div style={{ fontSize:9, fontFamily:FONT_MONO, letterSpacing:"0.14em", textTransform:"uppercase", color:T.info, marginBottom:8 }}>Prompt</div>
                            <div style={{ background:T.bg, border:`1px solid ${T.border}`, borderRadius:6, padding:"12px 16px", fontFamily:FONT_MONO, fontSize:12, color:T.text, lineHeight:1.7, whiteSpace:"pre-wrap", wordBreak:"break-word", maxHeight:180, overflowY:"auto" }}>
                              {r.prompt || <span style={{ color:T.textMute }}>—</span>}
                            </div>
                          </div>

                          {/* Block reason OR Response */}
                          {r.blocked ? (
                            <div>
                              <div style={{ fontSize:9, fontFamily:FONT_MONO, letterSpacing:"0.14em", textTransform:"uppercase", color:T.crit, marginBottom:8 }}>Block Reason</div>
                              <div style={{ background:`${T.crit}10`, border:`1px solid ${T.crit}33`, borderRadius:6, padding:"12px 16px", fontFamily:FONT_MONO, fontSize:12, color:T.crit, lineHeight:1.6 }}>
                                {r.block_reason || "—"}
                              </div>
                            </div>
                          ) : r.response ? (
                            <div>
                              <div style={{ fontSize:9, fontFamily:FONT_MONO, letterSpacing:"0.14em", textTransform:"uppercase", color:T.accent, marginBottom:8 }}>Response</div>
                              <div style={{ background:T.bg, border:`1px solid ${T.border}`, borderRadius:6, padding:"12px 16px", fontFamily:FONT_MONO, fontSize:12, color:T.text, lineHeight:1.7, whiteSpace:"pre-wrap", wordBreak:"break-word", maxHeight:180, overflowY:"auto" }}>
                                {r.response}
                              </div>
                            </div>
                          ) : null}

                          {/* Security findings */}
                          {findings.length > 0 && (
                            <div>
                              <div style={{ fontSize:9, fontFamily:FONT_MONO, letterSpacing:"0.14em", textTransform:"uppercase", color:T.warn, marginBottom:8 }}>
                                Security Findings ({findings.length})
                              </div>
                              <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                                {findings.map((f, i) => (
                                  <div key={i} style={{ display:"grid", gridTemplateColumns:"90px 160px 1fr", alignItems:"center", gap:12, padding:"8px 14px", background:T.bg, border:`1px solid ${T.border}`, borderLeft:`3px solid ${f.severity==="critical"?T.crit:T.warn}`, borderRadius:4 }}>
                                    <Pill color={f.severity==="critical"?T.crit:T.warn}>{f.severity}</Pill>
                                    <span style={{ fontFamily:FONT_MONO, fontSize:12, color:T.text }}>{f.type}</span>
                                    <span style={{ fontFamily:FONT_MONO, fontSize:11, color:T.textMute }}>{f.sample}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                        </div>
                      </td>
                    </tr>
                  );
                })()}
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
  const roles = useRoles();
  const isAdmin = canSeePage(currentUser, "settings", roles);

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
  const [alertsOpen, setAlertsOpen] = useState(false);

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

      {/* Live alerts — collapsible */}
      <div style={{ background:T.panel, border:`1px solid ${T.border}`, borderRadius:6, overflow:"hidden" }}>
        <button
          onClick={() => setAlertsOpen(o => !o)}
          style={{ width:"100%", display:"flex", alignItems:"center", justifyContent:"space-between", padding:"14px 18px", background:"transparent", border:"none", cursor:"pointer", textAlign:"left" }}
        >
          <div>
            <div style={{ fontSize:11, letterSpacing:"0.12em", textTransform:"uppercase", color:T.textDim, fontFamily:FONT_MONO, fontWeight:500 }}>
              Live Security Alerts
              {alerts.length > 0 && (
                <span style={{ marginLeft:8, background:T.crit+"22", color:T.crit, border:`1px solid ${T.crit}44`, borderRadius:4, padding:"1px 7px", fontSize:10 }}>
                  {alerts.length}
                </span>
              )}
            </div>
            <div style={{ fontSize:13, color:T.textMute, marginTop:4, fontFamily:FONT_MONO }}>Detected from real telemetry data</div>
          </div>
          <span style={{ color:T.textDim, fontSize:16, transition:"transform 0.2s", transform:alertsOpen?"rotate(180deg)":"rotate(0deg)", display:"block" }}>▾</span>
        </button>

        {alertsOpen && (
          <div style={{ padding:"0 18px 18px" }}>
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
          </div>
        )}
      </div>

      {/* Sensitive content check — optional, collapsed by default */}
      <Card title="Sensitive Content Check" subtitle="Optional — test text for credential or sensitive-data patterns">
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          <textarea
            value={scanText} onChange={(e) => setScanText(e.target.value)}
            placeholder="Paste text to check for sensitive data patterns…"
            rows={4}
            style={{ width:"100%", background:T.panelHi, color:T.text, border:`1px solid ${T.border}`, borderRadius:4, padding:"10px 12px", fontSize:12, fontFamily:FONT_MONO, resize:"vertical", boxSizing:"border-box" }}
          />
          <div style={{ display:"flex", gap:10, alignItems:"center" }}>
            <button onClick={handleScan} disabled={scanning || !scanText.trim()}
              style={{ background:T.accent, color:T.bg, border:"none", padding:"8px 18px", borderRadius:4, fontSize:12, fontFamily:FONT_MONO, fontWeight:600, cursor:"pointer", opacity:scanning?0.6:1 }}>
              {scanning ? "Scanning…" : "Check Text"}
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

// Roles loaded from the server at app init; keyed by role name for O(1) lookup
const RolesContext = createContext({});
const useRoles = () => useContext(RolesContext);

const ROLES = {
  // pages  — controls navigation visibility and page-level UI gates
  // can    — explicit data/action capabilities not expressible as page visibility
  admin:   { label:"Admin",   color: T.crit,   pages: ["dashboard","welcome","agent_inventory","discovery","governance","relationship_map","cost","security_intel","ecosystem","budgets","pricing","security","users","apikeys","settings","home","overview","agents","models","workflows","alerts","assets","chat","integrations","onboarding"], can: ["view_all_sessions"], team_scoped: false },
  analyst: { label:"Analyst", color: T.warn,   pages: ["dashboard","welcome","agent_inventory","discovery","governance","relationship_map","cost","security_intel","ecosystem","home","overview","agents","models","workflows","alerts","assets","chat","integrations","onboarding"],                                                           can: [], team_scoped: true },
  viewer:  { label:"Viewer",  color: T.info,   pages: ["dashboard","welcome","agent_inventory","discovery","governance","relationship_map","cost","security_intel","ecosystem","home","overview","agents","models","workflows","alerts","assets"],                                                                                            can: [], team_scoped: true },
};

// deny-by-default: unknown/null role → false, never crashes, never leaks.
// rolesMap is always the server-loaded map from RolesContext; the ROLES
// fallback only applies if a component somehow calls this outside the provider.
function canSeePage(user, page, rolesMap = ROLES) {
  return (rolesMap[user?.role]?.pages ?? []).includes(page);
}

function userCan(user, capability, rolesMap = ROLES) {
  return (rolesMap[user?.role]?.can ?? []).includes(capability);
}

// router alias — delegates to canSeePage so deny-by-default lives in one place
function canAccess(role, page, rolesMap = ROLES) {
  return canSeePage({ role }, page, rolesMap);
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
            <span style={{ fontSize:15, fontWeight:500, letterSpacing:"-0.01em" }}>AI Asset Management</span>
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
      </form>
    </div>
  );
}

function SortableUsersTable({ users, currentUser, editing, editSaving, setEditing, saveEdit, cancelEdit, handleToggle, handleDelete, onDisable, inlineInput, inlineSelect, onChangePassword }) {
  const roles = useRoles();
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
                  ? inlineSelect(editing.role, v => setEditing({...editing, role:v}), Object.entries(roles).map(([r, m]) => [r, m.label]))
                  : <Pill color={roles[u.role]?.color ?? T.textDim}>{u.role}</Pill>}
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
                      <button onClick={() => u.is_active ? onDisable(u) : handleToggle(u)}
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

      {/* ── Page header ── */}
      <div>
        <div style={{ fontSize: 20, fontWeight: 500, color: T.text, letterSpacing: "-0.01em" }}>API Keys</div>
        <div style={{ fontSize: 12, color: T.textDim, marginTop: 4 }}>Keys authenticate AI agents through the runtime gateway. Each key is shown once — copy it immediately.</div>
      </div>

      {/* ── Create key ── */}
      <Card title="New Key">
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
            {saving ? "Generating…" : "+ Generate"}
          </button>
        </form>
        {err && <div style={{ color: T.crit, fontFamily: FONT_MONO, fontSize: 12, marginTop: 10 }}>{err}</div>}
      </Card>

      {/* ── Keys table ── */}
      <Card title={`Keys · ${keys.length}`}>
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
            <div style={{ fontFamily: FONT_MONO, fontWeight: 700, color: T.accent, fontSize: 14 }}>Copy your key — shown once only</div>
            <div style={{ fontFamily: FONT_MONO, fontSize: 11, color: T.textDim }}>
              This will not be shown again. Store it in your secrets manager now.
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
  const rolesMap = useRoles();
  const [serverRoles, setServerRoles] = useState(null); // null = not yet loaded
  const roles = serverRoles
    ? Object.fromEntries(serverRoles.map(r => [r.name, r]))
    : rolesMap;
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
  // disable confirmation: user object | null
  const [disableConfirm, setDisableConfirm] = useState(null);

  const load = useCallback(async () => {
    try {
      const [data, roleData] = await Promise.all([fetchUsers(), fetchRoles().catch(() => null)]);
      setUsers(data);
      if (roleData) setServerRoles(roleData);
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
              {Object.entries(roles).map(([r, m]) => <option key={r} value={r}>{m.label}</option>)}
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
          onDisable={setDisableConfirm}
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

      {/* ── Disable Confirmation Modal ── */}
      {disableConfirm && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.65)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:1000 }}>
          <div style={{ background:T.panel, border:`1px solid ${T.warn}55`, borderRadius:10, padding:28, minWidth:340, maxWidth:420, display:"flex", flexDirection:"column", gap:18 }}>
            <div style={{ display:"flex", alignItems:"center", gap:10 }}>
              <span style={{ fontSize:20, color:T.warn }}>⚠</span>
              <div style={{ fontWeight:700, color:T.text, fontSize:15 }}>Disable user?</div>
            </div>
            <div style={{ fontSize:13, color:T.textDim, lineHeight:1.6 }}>
              You are about to disable{" "}
              <strong style={{ color:T.text }}>{disableConfirm.name || disableConfirm.email}</strong>.
              {disableConfirm.id === currentUser?.id && (
                <span style={{ display:"block", marginTop:8, color:T.warn, fontWeight:600 }}>
                  Warning: this is your own account. You will be logged out immediately.
                </span>
              )}
            </div>
            <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
              <button onClick={() => setDisableConfirm(null)}
                style={{ background:"transparent", border:`1px solid ${T.border}`, color:T.textDim, padding:"7px 18px", borderRadius:5, fontSize:12, fontFamily:FONT_MONO, cursor:"pointer" }}>
                Cancel
              </button>
              <button onClick={() => { handleToggle(disableConfirm); setDisableConfirm(null); }}
                style={{ background:`${T.warn}18`, border:`1px solid ${T.warn}55`, color:T.warn, padding:"7px 18px", borderRadius:5, fontSize:12, fontFamily:FONT_MONO, cursor:"pointer", fontWeight:600 }}>
                Disable
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
  const roles = useRoles();
  const isAdmin = userCan(user, "view_all_sessions", roles);

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
  const roleColor = roles[user?.role]?.color ?? T.textDim;

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
                  const visible = isAdmin
                    ? activeSessions
                    : activeSessions.filter(s => s.user_name === user?.name);
                  if (visible.length === 0) return (
                    <div style={{ color:T.textMute, fontSize:11, fontFamily:FONT_MONO, textAlign:"center", marginTop:20 }}>
                      {isAdmin ? "No active sessions" : "No active sessions for you"}
                    </div>
                  );
                  return visible.map(s => {
                  const isMe = s.session_uuid === sessionUuid;
                  const idleMins = Math.floor((Date.now() - new Date(s.last_activity_at).getTime()) / 60000);
                  const rc = roles[s.user_role]?.color ?? T.textDim;
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
                            {(isAdmin || s.user_name === user?.name) && (
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
                  const visible = isAdmin
                    ? allSessions
                    : allSessions.filter(s => s.user_name === user?.name);
                  if (visible.length === 0) return (
                    <div style={{ color:T.textMute, fontSize:11, fontFamily:FONT_MONO, textAlign:"center", marginTop:20 }}>No sessions yet</div>
                  );
                  return visible.map(s => {
                  const isActive = s.is_active;
                  const isMe = s.session_uuid === sessionUuid;
                  const rc = roles[s.user_role]?.color ?? T.textDim;
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
              <div style={{ fontSize:11 }}>Budget check · policy enforcement · cost tracking · agent identity</div>
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
                  {msg.meta.findings?.length > 0 && <span style={{ color:T.warn }}>⚠ {msg.meta.findings.length} safety finding{msg.meta.findings.length===1?"":"s"}</span>}
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
function IntegrationsPage({ onNavigate }) {
  const currentUser = useUser();
  const roles = useRoles();
  const isAdmin = canSeePage(currentUser, "apikeys", roles);
  const [copied,    setCopied]    = useState(null);
  const [apiKey,    setApiKey]    = useState("");
  const [teamName,  setTeamName]  = useState(currentUser?.team || "my-team");
  const [agentName, setAgentName] = useState("my-agent");
  const [codeTab,   setCodeTab]   = useState("python");

  const gatewayUrl = BASE.startsWith("http") ? BASE : window.location.origin;
  const cred       = apiKey || "gk-...";

  const copy = (id, text) => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  const CopyBtn = ({ id, text }) => (
    <button onClick={() => copy(id, text)}
      style={{ background: copied===id ? `${T.accent}20` : "transparent",
        border:`1px solid ${copied===id ? T.accent+"55" : T.border}`,
        color: copied===id ? T.accent : T.textMute,
        padding:"3px 10px", borderRadius:3, fontSize:10, fontFamily:FONT_MONO, cursor:"pointer", flexShrink:0 }}>
      {copied===id ? "✓ copied" : "copy"}
    </button>
  );

  const CodeBlock = ({ id, code }) => (
    <div style={{ position:"relative" }}>
      <pre style={{ background:T.bg, border:`1px solid ${T.border}`, borderRadius:6,
        padding:"14px 16px 14px 16px", fontSize:12, fontFamily:FONT_MONO, color:T.text,
        lineHeight:1.7, overflow:"auto", margin:0, whiteSpace:"pre" }}>{code}</pre>
      <div style={{ position:"absolute", top:8, right:8 }}>
        <CopyBtn id={id} text={code} />
      </div>
    </div>
  );

  // ── Code snippets (trimmed — no wall-of-comments) ─────────────────────────
  const snippets = {
    python: `import openai

client = openai.OpenAI(
    base_url="${gatewayUrl}/v1",
    api_key="${cred}",
)

response = client.chat.completions.create(
    model="gpt-4o-mini",          # swap to claude-sonnet-4-5, gemini-2.0-flash, etc.
    messages=[{"role": "user", "content": "Hello"}],
    extra_headers={
        "X-Guard-Team":  "${teamName}",
        "X-Guard-Agent": "${agentName}",
    },
)
print(response.choices[0].message.content)

# Streaming
stream = client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[{"role": "user", "content": "Hello"}],
    stream=True,
    extra_headers={"X-Guard-Team": "${teamName}", "X-Guard-Agent": "${agentName}"},
)
for chunk in stream:
    print(chunk.choices[0].delta.content or "", end="", flush=True)`,

    nodejs: `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "${gatewayUrl}/v1",
  apiKey: "${cred}",
});

const response = await client.chat.completions.create({
  model: "gpt-4o-mini",         // or "claude-sonnet-4-5", "gemini-2.0-flash"
  messages: [{ role: "user", content: "Hello" }],
  headers: {
    "X-Guard-Team":  "${teamName}",
    "X-Guard-Agent": "${agentName}",
  },
});

console.log(response.choices[0].message.content);`,

    curl: `curl -X POST ${gatewayUrl}/v1/chat/completions \\
  -H "Authorization: Bearer ${cred}" \\
  -H "Content-Type: application/json" \\
  -H "X-Guard-Team: ${teamName}" \\
  -H "X-Guard-Agent: ${agentName}" \\
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"Hello"}]}'`,

    anthropic: `import anthropic

client = anthropic.Anthropic(
    base_url="${gatewayUrl}",
    api_key="${cred}",
    default_headers={
        "X-Guard-Team":  "${teamName}",
        "X-Guard-Agent": "${agentName}",
    },
)

message = client.messages.create(
    model="claude-haiku-4-5",
    max_tokens=1024,
    messages=[{"role": "user", "content": "Hello"}],
)
print(message.content[0].text)`,

    langchain: `from langchain_openai import ChatOpenAI

llm = ChatOpenAI(
    model="gpt-4o-mini",
    openai_api_base="${gatewayUrl}/v1",
    openai_api_key="${cred}",
    default_headers={
        "X-Guard-Team":  "${teamName}",
        "X-Guard-Agent": "${agentName}",
    },
)
print(llm.invoke("Hello").content)`,
  };

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:16, maxWidth:900 }}>

      {/* ── Setup steps ── */}
      <Card title="Connect your agent" subtitle="Three steps, no code changes to existing agents">
        <div style={{ display:"flex", flexDirection:"column", gap:0 }}>
          {[
            {
              n:"1", color:T.warn, done: false,
              label: "Add your provider key",
              detail: <>Go to <strong style={{ color:T.accent }}>Settings → Provider Keys</strong> and paste your OpenAI / Anthropic / Google key. It's encrypted at rest — only the last 4 chars are shown after saving.</>,
              action: isAdmin ? { label:"Open Settings →", href:"settings" } : null,
            },
            {
              n:"2", color:T.info, done: false,
              label: "Create an API key for your agent",
              detail: <>Go to <strong style={{ color:T.accent }}>API Keys → Generate Key</strong>. Give it a name and team. The <code style={{ color:T.accent, fontFamily:FONT_MONO, fontSize:11 }}>gk-…</code> key is shown <strong style={{ color:T.warn }}>once</strong> — copy it now.</>,
              action: isAdmin ? { label:"Open API Keys →", href:"apikeys" } : null,
            },
            {
              n:"3", color:T.accent, done: false,
              label: "Point your agent at this gateway",
              detail: <>Change <code style={{ color:T.info, fontFamily:FONT_MONO, fontSize:11 }}>base_url</code> to <code style={{ color:T.accent, fontFamily:FONT_MONO, fontSize:11 }}>{gatewayUrl}/v1</code> and use your <code style={{ color:T.accent, fontFamily:FONT_MONO, fontSize:11 }}>gk-…</code> key as <code style={{ color:T.info, fontFamily:FONT_MONO, fontSize:11 }}>api_key</code>. That's it — every model routes through here automatically.</>,
            },
          ].map((s, i, arr) => (
            <div key={s.n} style={{ display:"flex", gap:16 }}>
              <div style={{ display:"flex", flexDirection:"column", alignItems:"center", flexShrink:0 }}>
                <div style={{ width:30, height:30, borderRadius:"50%", background:`${s.color}18`,
                  border:`1px solid ${s.color}55`, display:"flex", alignItems:"center",
                  justifyContent:"center", fontFamily:FONT_MONO, fontSize:12, color:s.color, fontWeight:700 }}>
                  {s.n}
                </div>
                {i < arr.length-1 && <div style={{ width:1, flex:1, background:T.border, minHeight:24, margin:"4px 0" }}/>}
              </div>
              <div style={{ paddingBottom:20, flex:1 }}>
                <div style={{ fontSize:13, fontWeight:600, color:T.text, marginBottom:4 }}>{s.label}</div>
                <div style={{ fontSize:12, color:T.textDim, lineHeight:1.65 }}>{s.detail}</div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* ── Config builder + code tabs ── */}
      <Card title="Code snippets" subtitle="Fill in your details — snippets update live">

        {/* Inputs row */}
        <div style={{ display:"flex", gap:10, flexWrap:"wrap", alignItems:"flex-end", marginBottom:16 }}>
          {[
            { label:"Team",  val:teamName,  set:setTeamName,  w:130 },
            { label:"Agent", val:agentName, set:setAgentName, w:130 },
          ].map(f => (
            <div key={f.label} style={{ display:"flex", flexDirection:"column", gap:4 }}>
              <label style={{ fontSize:9, fontFamily:FONT_MONO, letterSpacing:"0.12em", textTransform:"uppercase", color:T.textMute }}>{f.label}</label>
              <input value={f.val} onChange={e => f.set(e.target.value)}
                style={{ background:T.panelHi, color:T.text, border:`1px solid ${T.border}`,
                  padding:"6px 10px", borderRadius:4, fontSize:12, fontFamily:FONT_MONO, width:f.w }} />
            </div>
          ))}

          <div style={{ display:"flex", flexDirection:"column", gap:4, flex:1, minWidth:220 }}>
            <div style={{ display:"flex", alignItems:"baseline", justifyContent:"space-between" }}>
              <label style={{ fontSize:9, fontFamily:FONT_MONO, letterSpacing:"0.12em", textTransform:"uppercase", color:T.textMute }}>
                Gateway key (gk-…)
              </label>
              {isAdmin && (
                <button onClick={() => onNavigate("apikeys")}
                  style={{ background:"transparent", border:"none", color:T.accent, fontSize:10,
                    fontFamily:FONT_MONO, cursor:"pointer", padding:0, textDecoration:"underline" }}>
                  Get one in 10s →
                </button>
              )}
            </div>
            <input type="password"
              placeholder="Paste your gk-… key — snippets fill in live"
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              style={{ background:T.panelHi, color:T.text, border:`1px solid ${T.border}`,
                padding:"6px 10px", borderRadius:4, fontSize:12, fontFamily:FONT_MONO }} />
          </div>
        </div>

        {/* Language tabs */}
        <div style={{ display:"flex", gap:2, marginBottom:0, borderBottom:`1px solid ${T.border}`, paddingBottom:0 }}>
          {[
            {id:"python",   label:"Python"},
            {id:"nodejs",   label:"Node.js"},
            {id:"curl",     label:"curl"},
            {id:"anthropic",label:"Anthropic SDK"},
            {id:"langchain",label:"LangChain"},
          ].map(t => (
            <button key={t.id} onClick={() => setCodeTab(t.id)}
              style={{ background:"transparent", border:"none",
                borderBottom: codeTab===t.id ? `2px solid ${T.accent}` : "2px solid transparent",
                color: codeTab===t.id ? T.accent : T.textDim,
                padding:"7px 14px", fontSize:11, fontFamily:FONT_MONO, cursor:"pointer",
                marginBottom:"-1px" }}>
              {t.label}
            </button>
          ))}
        </div>
        <div style={{ marginTop:0 }}>
          <CodeBlock id={codeTab} code={snippets[codeTab]} />
        </div>
      </Card>

      {/* ── Reference: headers + models ── */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>

        {/* Attribution headers */}
        <Card title="Attribution headers" subtitle="Add to every request">
          <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
            {[
              { h:"X-Guard-Team",  ex:teamName,  desc:"Team for budget & policy enforcement" },
              { h:"X-Guard-Agent", ex:agentName, desc:"Agent name for cost attribution" },
            ].map(r => (
              <div key={r.h} style={{ background:T.bg, border:`1px solid ${T.border}`, borderRadius:5, padding:"10px 12px" }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:4 }}>
                  <code style={{ fontFamily:FONT_MONO, fontSize:12, color:T.info }}>{r.h}</code>
                  <code style={{ fontFamily:FONT_MONO, fontSize:11, color:T.accent }}>"{r.ex}"</code>
                </div>
                <div style={{ fontSize:11, color:T.textMute }}>{r.desc}</div>
              </div>
            ))}
          </div>
        </Card>

        {/* Supported models */}
        <Card title="Supported models" subtitle="Swap the model name — routing is automatic">
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            {[
              { provider:"OpenAI",    color:T.info,   models:"gpt-4.1, gpt-4o, gpt-4o-mini, o3, o4-mini" },
              { provider:"Anthropic", color:T.warn,   models:"claude-opus-4-5, claude-sonnet-4-5, claude-haiku-4-5" },
              { provider:"Google",    color:T.accent, models:"gemini-2.5-pro, gemini-2.0-flash, gemini-1.5-pro" },
              { provider:"Local",     color:T.purple, models:"llama-3.1-70b-local, llama-3.1-8b-local" },
            ].map(g => (
              <div key={g.provider} style={{ display:"flex", gap:10, alignItems:"baseline" }}>
                <span style={{ fontFamily:FONT_MONO, fontSize:10, color:g.color, letterSpacing:"0.08em",
                  textTransform:"uppercase", width:72, flexShrink:0 }}>{g.provider}</span>
                <span style={{ fontFamily:FONT_MONO, fontSize:11, color:T.textDim }}>{g.models}</span>
              </div>
            ))}
          </div>
          <div style={{ marginTop:10, fontSize:10, color:T.textMute, fontFamily:FONT_MONO }}>
            Provider key must be configured in <strong style={{ color:T.accent }}>Settings → Provider Keys</strong>
          </div>
        </Card>
      </div>

      {/* ── How it works (compact) ── */}
      <Card title="What happens on every call" subtitle="The enforcement pipeline — in order">
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"4px 24px" }}>
          {[
            { n:"1", color:T.info,   label:"Auth",        desc:"JWT or API key validated; org resolved from DB" },
            { n:"2", color:T.warn,   label:"Safety check", desc:"Content safety and redaction check (if enabled)" },
            { n:"3", color:T.info,   label:"Policy",      desc:"Blocked model for this team → 403" },
            { n:"4", color:T.crit,   label:"Budget",      desc:"Over limit with action=block → 429" },
            { n:"5", color:T.accent, label:"Credential",  desc:"Your org's encrypted key decrypted; no fallback → 402 if missing" },
            { n:"6", color:T.accent, label:"LLM call",    desc:"Forwarded using your key, billed to your account" },
            { n:"7", color:T.purple, label:"Telemetry",   desc:"Cost, tokens, findings stored — org-scoped, isolated" },
          ].map(s => (
            <div key={s.n} style={{ display:"flex", gap:10, alignItems:"baseline", padding:"8px 0",
              borderBottom:`1px solid ${T.border}` }}>
              <span style={{ fontFamily:FONT_MONO, fontSize:10, color:s.color, fontWeight:700, width:14, flexShrink:0 }}>{s.n}</span>
              <span style={{ fontFamily:FONT_MONO, fontSize:11, color:s.color, width:76, flexShrink:0 }}>{s.label}</span>
              <span style={{ fontSize:12, color:T.textDim }}>{s.desc}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* ── Guard modes (compact) ── */}
      <Card title="Guard modes" subtitle="Graduate each team independently — Settings → Guard Modes">
        <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10 }}>
          {[
            { mode:"Observe",  color:T.info, desc:"Log + count shadow-blocks. Never blocks traffic. Start here." },
            { mode:"Alert",    color:T.warn, desc:"Log + fire alerts. Still never blocks." },
            { mode:"Enforce",  color:T.crit, desc:"Policy → 403, budget → 429. Graduate after reviewing shadow counts." },
          ].map(m => (
            <div key={m.mode} style={{ background:T.panelHi, border:`1px solid ${m.color}33`, borderRadius:6, padding:"12px 14px" }}>
              <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:6 }}>
                <span style={{ width:7, height:7, borderRadius:"50%", background:m.color }} />
                <span style={{ fontFamily:FONT_MONO, fontSize:12, color:m.color, fontWeight:600 }}>{m.mode}</span>
              </div>
              <div style={{ fontSize:11, color:T.textDim, lineHeight:1.55 }}>{m.desc}</div>
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
    } catch { /* ignore load errors — show empty state */ }
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


// ─── Role management section ──────────────────────────────────────────────────
const ALL_PAGES = ["home","chat","overview","cost","agents","models","workflows","alerts","budgets","security","users","apikeys","settings","integrations","onboarding","agent_inventory","discovery","governance","relationship_map","security_intel","ecosystem","pricing","welcome"];
const ALL_CAPS  = ["view_all_sessions"];

function RolesManagementSection() {
  const rolesMap = useRoles();
  const [serverRoles, setServerRoles] = useState(Object.values(rolesMap));
  const [err, setErr] = useState(null);
  const [adding, setAdding] = useState(false);
  const [newForm, setNewForm] = useState({ name:"", label:"", color:"#7A8499", pages:[], can:[] });
  const [saving, setSaving] = useState(false);
  const [editingRole, setEditingRole] = useState(null); // role name being edited

  const load = useCallback(async () => {
    try {
      const data = await fetchRoles();
      setServerRoles(data);
      setErr(null);
    } catch { /* silently keep showing the initial state */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async () => {
    if (!newForm.name || !newForm.label) { setErr("Name and label are required"); return; }
    setSaving(true); setErr(null);
    try {
      await createRole(newForm);
      setAdding(false);
      setNewForm({ name:"", label:"", color:"#7A8499", pages:[], can:[] });
      await load();
    } catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  };

  const handleDelete = async (name) => {
    if (!window.confirm(`Delete role "${name}"? Users assigned to it will be unable to log in until reassigned.`)) return;
    setErr(null);
    try { await deleteRole(name); await load(); }
    catch (e) { setErr(e.message); }
  };

  const togglePage = (role, page) => {
    const current = role.pages.includes(page) ? role.pages.filter(p => p !== page) : [...role.pages, page];
    return { ...role, pages: current };
  };

  const toggleCap = (role, cap) => {
    const current = role.can.includes(cap) ? role.can.filter(c => c !== cap) : [...role.can, cap];
    return { ...role, can: current };
  };

  const saveEdit = async (role) => {
    setSaving(true); setErr(null);
    try {
      await updateRole(role.name, { label: role.label, color: role.color, pages: role.pages, can: role.can });
      setEditingRole(null);
      await load();
    } catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  };

  const ADMIN_REQUIRED = new Set(["settings", "users"]);

  const PageToggle = ({ page, active, onChange, locked }) => (
    <button onClick={locked ? undefined : onChange}
      title={locked ? "Required for admin — cannot be removed" : undefined}
      style={{ padding:"3px 8px", borderRadius:4, fontSize:10, fontFamily:FONT_MONO,
        cursor: locked ? "not-allowed" : "pointer", opacity: locked ? 0.5 : 1,
        background: active ? `${T.accent}22` : T.panelHi,
        border: `1px solid ${active ? T.accent : T.border}`,
        color: active ? T.accent : T.textDim }}>
      {page}{locked ? " 🔒" : ""}
    </button>
  );

  return (
    <Card title="Role Management" subtitle="Define roles and their page access. Changes take effect on next login.">
      {/* W-3 banner: backend enforcement not yet wired for custom roles */}
      <div style={{ background:`${T.warn}12`, border:`1px solid ${T.warn}44`, borderRadius:6, padding:"10px 14px", marginBottom:14, display:"flex", gap:10, alignItems:"flex-start" }}>
        <span style={{ color:T.warn, fontSize:13, flexShrink:0 }}>⚠</span>
        <div style={{ fontSize:12, color:T.warn, lineHeight:1.6 }}>
          <strong>Custom roles are not yet server-enforced.</strong>{" "}
          Roles beyond <code style={{ fontFamily:FONT_MONO, fontSize:11 }}>admin</code>, <code style={{ fontFamily:FONT_MONO, fontSize:11 }}>analyst</code>, and <code style={{ fontFamily:FONT_MONO, fontSize:11 }}>viewer</code> control the UI only — backend endpoints still require admin.
          Do not assign users to custom roles until server enforcement is complete.
        </div>
      </div>
      {err && <div style={{ color:T.crit, fontFamily:FONT_MONO, fontSize:12, marginBottom:10 }}>{err}</div>}

      <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
        {serverRoles.map(role => {
          const isEditing = editingRole?.name === role.name;
          const r = isEditing ? editingRole : role;
          return (
            <div key={role.name} style={{ background:T.panelHi, border:`1px solid ${T.border}`, borderRadius:8, padding:14 }}>
              <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom: isEditing ? 12 : 0 }}>
                <div style={{ width:10, height:10, borderRadius:"50%", background:r.color, flexShrink:0 }}/>
                {isEditing ? (
                  <input value={r.label} onChange={e => setEditingRole({...r, label:e.target.value})}
                    style={{ background:T.panel, color:T.text, border:`1px solid ${T.border}`, padding:"4px 8px", borderRadius:4, fontSize:13, fontWeight:600, width:160 }}/>
                ) : (
                  <span style={{ fontSize:13, fontWeight:600, flex:1 }}>{r.label}</span>
                )}
                <span style={{ fontSize:10, fontFamily:FONT_MONO, color:T.textMute }}>{role.name}</span>
                {isEditing && (
                  <input type="color" value={r.color} onChange={e => setEditingRole({...r, color:e.target.value})}
                    style={{ width:28, height:28, borderRadius:4, border:"none", background:"none", cursor:"pointer", padding:0 }}/>
                )}
                {!["admin","analyst","viewer"].includes(role.name) && !isEditing && (
                  <button onClick={() => setEditingRole({...role})}
                    style={{ background:"transparent", border:`1px solid ${T.border}`, color:T.textDim, borderRadius:4, padding:"3px 10px", fontSize:11, fontFamily:FONT_MONO, cursor:"pointer" }}>
                    Edit
                  </button>
                )}
                {!["admin","analyst","viewer"].includes(role.name) && !isEditing && (
                  <button onClick={() => handleDelete(role.name)}
                    style={{ background:`${T.crit}15`, border:`1px solid ${T.crit}44`, color:T.crit, borderRadius:4, padding:"3px 10px", fontSize:11, fontFamily:FONT_MONO, cursor:"pointer" }}>
                    Delete
                  </button>
                )}
              </div>

              {isEditing && (
                <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                  <div>
                    <div style={{ fontSize:9, fontFamily:FONT_MONO, letterSpacing:"0.12em", textTransform:"uppercase", color:T.textMute, marginBottom:6 }}>Pages</div>
                    <div style={{ display:"flex", flexWrap:"wrap", gap:5 }}>
                      {ALL_PAGES.map(p => (
                        <PageToggle key={p} page={p} active={r.pages.includes(p)}
                          onChange={() => setEditingRole(togglePage(r, p))}
                          locked={r.name === "admin" && ADMIN_REQUIRED.has(p)}/>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize:9, fontFamily:FONT_MONO, letterSpacing:"0.12em", textTransform:"uppercase", color:T.textMute, marginBottom:6 }}>Capabilities</div>
                    <div style={{ display:"flex", flexWrap:"wrap", gap:5 }}>
                      {ALL_CAPS.map(c => (
                        <PageToggle key={c} page={c} active={r.can.includes(c)} onChange={() => setEditingRole(toggleCap(r, c))}/>
                      ))}
                    </div>
                  </div>
                  <div style={{ display:"flex", gap:8, marginTop:4 }}>
                    <button onClick={() => saveEdit(r)} disabled={saving}
                      style={{ background:T.accent, color:T.bg, border:"none", borderRadius:4, padding:"6px 16px", fontSize:11, fontFamily:FONT_MONO, fontWeight:600, cursor:"pointer", opacity:saving?0.6:1 }}>
                      {saving ? "Saving…" : "Save"}
                    </button>
                    <button onClick={() => setEditingRole(null)}
                      style={{ background:"transparent", border:`1px solid ${T.border}`, color:T.textDim, borderRadius:4, padding:"6px 12px", fontSize:11, fontFamily:FONT_MONO, cursor:"pointer" }}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {!isEditing && (
                <div style={{ marginTop:8, display:"flex", flexWrap:"wrap", gap:4 }}>
                  {role.pages.map(p => (
                    <span key={p} style={{ fontSize:9, fontFamily:FONT_MONO, color:T.textMute, background:T.panel, border:`1px solid ${T.border}`, padding:"2px 6px", borderRadius:3 }}>{p}</span>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {!adding && (
          <button onClick={() => setAdding(true)}
            style={{ background:`${T.accent}12`, border:`1px dashed ${T.accentDim}`, color:T.accent, borderRadius:6, padding:"10px 0", fontSize:12, fontFamily:FONT_MONO, cursor:"pointer" }}>
            + Add Role
          </button>
        )}

        {adding && (
          <div style={{ background:T.panelHi, border:`1px solid ${T.borderHi}`, borderRadius:8, padding:14, display:"flex", flexDirection:"column", gap:10 }}>
            <div style={{ fontSize:12, fontWeight:600, color:T.text }}>New Role</div>
            <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
              <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
                <label style={{ fontSize:9, fontFamily:FONT_MONO, letterSpacing:"0.12em", textTransform:"uppercase", color:T.textMute }}>Name (slug)</label>
                <input placeholder="billing-admin" value={newForm.name} onChange={e => setNewForm({...newForm, name:e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g,"")})}
                  style={{ background:T.panel, color:T.text, border:`1px solid ${T.border}`, padding:"6px 10px", borderRadius:4, fontSize:12, fontFamily:FONT_MONO, width:140 }}/>
              </div>
              <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
                <label style={{ fontSize:9, fontFamily:FONT_MONO, letterSpacing:"0.12em", textTransform:"uppercase", color:T.textMute }}>Display Label</label>
                <input placeholder="Billing Admin" value={newForm.label} onChange={e => setNewForm({...newForm, label:e.target.value})}
                  style={{ background:T.panel, color:T.text, border:`1px solid ${T.border}`, padding:"6px 10px", borderRadius:4, fontSize:12, fontFamily:FONT_MONO, width:160 }}/>
              </div>
              <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
                <label style={{ fontSize:9, fontFamily:FONT_MONO, letterSpacing:"0.12em", textTransform:"uppercase", color:T.textMute }}>Color</label>
                <input type="color" value={newForm.color} onChange={e => setNewForm({...newForm, color:e.target.value})}
                  style={{ width:40, height:34, borderRadius:4, border:`1px solid ${T.border}`, background:T.panel, cursor:"pointer", padding:2 }}/>
              </div>
            </div>
            <div>
              <div style={{ fontSize:9, fontFamily:FONT_MONO, letterSpacing:"0.12em", textTransform:"uppercase", color:T.textMute, marginBottom:6 }}>Pages</div>
              <div style={{ display:"flex", flexWrap:"wrap", gap:5 }}>
                {ALL_PAGES.map(p => (
                  <PageToggle key={p} page={p} active={newForm.pages.includes(p)}
                    onChange={() => setNewForm(f => ({...f, pages: f.pages.includes(p) ? f.pages.filter(x=>x!==p) : [...f.pages, p]}))}/>
                ))}
              </div>
            </div>
            <div>
              <div style={{ fontSize:9, fontFamily:FONT_MONO, letterSpacing:"0.12em", textTransform:"uppercase", color:T.textMute, marginBottom:6 }}>Capabilities</div>
              <div style={{ display:"flex", flexWrap:"wrap", gap:5 }}>
                {ALL_CAPS.map(c => (
                  <PageToggle key={c} page={c} active={newForm.can.includes(c)}
                    onChange={() => setNewForm(f => ({...f, can: f.can.includes(c) ? f.can.filter(x=>x!==c) : [...f.can, c]}))}/>
                ))}
              </div>
            </div>
            <div style={{ display:"flex", gap:8 }}>
              <button onClick={handleCreate} disabled={saving}
                style={{ background:T.accent, color:T.bg, border:"none", borderRadius:4, padding:"7px 18px", fontSize:11, fontFamily:FONT_MONO, fontWeight:600, cursor:"pointer", opacity:saving?0.6:1 }}>
                {saving ? "Creating…" : "Create Role"}
              </button>
              <button onClick={() => { setAdding(false); setErr(null); }}
                style={{ background:"transparent", border:`1px solid ${T.border}`, color:T.textDim, borderRadius:4, padding:"7px 12px", fontSize:11, fontFamily:FONT_MONO, cursor:"pointer" }}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}


function SettingsPage() {
  const [keys,      setKeys]      = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [editing,   setEditing]   = useState(null);
  const [editVal,   setEditVal]   = useState("");
  const [saving,    setSaving]    = useState(false);
  const [saved,     setSaved]     = useState(null);
  const [err,       setErr]       = useState(null);

  // Gateway test state
  const [gwTesting,  setGwTesting]  = useState(false);
  const [gwResult,   setGwResult]   = useState(null); // null | {ok:bool, msg:string, status?:number}

  // Environments config
  const [environments, setEnvironments] = useState(["production", "staging", "development"]);
  const [envInput,     setEnvInput]     = useState("");
  const [envSaving,    setEnvSaving]    = useState(false);
  const [envSaved,     setEnvSaved]     = useState(false);

  const load = useCallback(async () => {
    try {
      const [data, cfg] = await Promise.all([fetchKeyStatuses(), fetchOrgConfig().catch(() => null)]);
      setKeys(data);
      if (cfg?.environments?.length) setEnvironments(cfg.environments);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const startEdit = (k) => { setEditing(k.key); setEditVal(""); setSaved(null); setErr(null); };
  const cancelEdit = () => { setEditing(null); setEditVal(""); };

  const addEnv = () => {
    const val = envInput.trim().toLowerCase().replace(/\s+/g, "-");
    if (!val || environments.includes(val)) return;
    setEnvironments(prev => [...prev, val]);
    setEnvInput("");
  };
  const removeEnv = (v) => setEnvironments(prev => prev.filter(e => e !== v));
  const saveEnvs = async () => {
    setEnvSaving(true);
    try { await updateOrgConfig("environments", environments); setEnvSaved(true); setTimeout(() => setEnvSaved(false), 2500); }
    catch (e) { setErr(e.message); }
    finally { setEnvSaving(false); }
  };

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

  const testGateway = async () => {
    setGwTesting(true);
    setGwResult(null);
    const t0 = performance.now();
    try {
      const resp = await authFetch(`${BASE}/v1/chat/completions`, {
        method: "POST",
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: "ping" }],
        }),
      });
      const ms = Math.round(performance.now() - t0);
      if (!resp) {
        setGwResult({ ok: false, msg: "Not authenticated or network error", status: null });
      } else if (resp.ok || resp.status === 200) {
        setGwResult({ ok: true, msg: `Gateway reachable — responded in ${ms}ms`, status: resp.status });
      } else if (resp.status === 429) {
        setGwResult({ ok: null, msg: `Rate limited (429) — gateway is reachable`, status: 429 });
      } else {
        const body = await resp.json().catch(() => ({}));
        const detail = body.detail || body.error?.message || resp.statusText || "Unknown error";
        setGwResult({ ok: false, msg: `Gateway error: ${detail}`, status: resp.status });
      }
    } catch (e) {
      setGwResult({ ok: false, msg: `Gateway error: ${e.message}`, status: null });
    } finally {
      setGwTesting(false);
    }
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

      {/* Page header */}
      <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:16 }}>
        <div>
          <div style={{ fontSize:20, fontWeight:500, color:T.text, letterSpacing:"-0.01em" }}>Settings</div>
          <div style={{ fontSize:12, color:T.textDim, marginTop:4 }}>Configure provider keys, guard modes, and platform behaviour.</div>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:10, flexShrink:0 }}>
          {gwResult && (
            <span style={{
              fontFamily: FONT_MONO,
              fontSize: 11,
              color: gwResult.ok === true ? T.accent : gwResult.ok === null ? T.warn : T.crit,
              background: gwResult.ok === true ? `${T.accent}15` : gwResult.ok === null ? `${T.warn}15` : `${T.crit}15`,
              border: `1px solid ${gwResult.ok === true ? T.accent + "44" : gwResult.ok === null ? T.warn + "44" : T.crit + "44"}`,
              borderRadius: 4,
              padding: "5px 10px",
              maxWidth: 340,
              wordBreak: "break-word",
            }}>{gwResult.msg}</span>
          )}
          <button
            onClick={testGateway}
            disabled={gwTesting}
            style={{
              background: `${T.info}15`,
              border: `1px solid ${T.info}44`,
              color: T.info,
              padding: "7px 16px",
              borderRadius: 4,
              fontSize: 12,
              fontFamily: FONT_MONO,
              cursor: gwTesting ? "default" : "pointer",
              opacity: gwTesting ? 0.6 : 1,
              whiteSpace: "nowrap",
            }}
          >
            {gwTesting ? "Testing…" : "Test Gateway"}
          </button>
        </div>
      </div>

      {/* Provider API keys (BYOK) */}
      <ProviderCredentialsSection />

      {/* Guard modes */}
      <GuardModesSection />

      {/* Keys table */}
      <Card title="Provider Keys" subtitle="Values are write-only — status only shown after save">
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

      {/* Environments */}
      <Card title="Environments" subtitle="Shown in the Environment dropdown when claiming or validating agents">
        <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginBottom:14 }}>
          {environments.map(env => (
            <div key={env} style={{ display:"flex", alignItems:"center", gap:6, background:T.panelHi, border:`1px solid ${T.border}`, borderRadius:4, padding:"5px 10px" }}>
              <span style={{ fontFamily:FONT_MONO, fontSize:12, color:T.text }}>{env}</span>
              <button onClick={() => removeEnv(env)}
                style={{ background:"transparent", border:"none", color:T.crit, cursor:"pointer", fontSize:14, lineHeight:1, padding:0 }}>×</button>
            </div>
          ))}
        </div>
        <div style={{ display:"flex", gap:8, alignItems:"center" }}>
          <input
            value={envInput}
            onChange={e => setEnvInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && addEnv()}
            placeholder="New environment name…"
            style={{ background:T.panelHi, border:`1px solid ${T.border}`, color:T.text, padding:"7px 10px", borderRadius:4, fontSize:12, fontFamily:FONT_MONO, width:200 }}
          />
          <button onClick={addEnv}
            style={{ background:`${T.info}15`, border:`1px solid ${T.info}44`, color:T.info, padding:"7px 14px", borderRadius:4, fontSize:12, fontFamily:FONT_MONO, cursor:"pointer" }}>
            + Add
          </button>
          <button onClick={saveEnvs} disabled={envSaving}
            style={{ background:T.accent, color:T.bg, border:"none", padding:"7px 16px", borderRadius:4, fontSize:12, fontFamily:FONT_MONO, fontWeight:600, cursor:"pointer", opacity:envSaving?0.6:1 }}>
            {envSaving ? "Saving…" : "Save"}
          </button>
          {envSaved && <span style={{ fontFamily:FONT_MONO, fontSize:11, color:T.accent }}>✓ Saved</span>}
        </div>
      </Card>

    </div>
  );
}

// ─── Onboarding page ──────────────────────────────────────────────────────────
function OnboardingPage({ onNavigate }) {
  const currentUser = useUser();
  const gatewayUrl  = BASE.startsWith("http") ? BASE : window.location.origin;
  const [copied, setCopied] = useState(null);

  const copy = (id, text) => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  const CopyBtn = ({ id, text }) => (
    <button onClick={() => copy(id, text)}
      style={{ background: copied === id ? `${T.accent}20` : "transparent",
        border: `1px solid ${copied === id ? T.accent + "55" : T.border}`,
        color: copied === id ? T.accent : T.textMute,
        padding: "3px 10px", borderRadius: 3, fontSize: 10,
        fontFamily: FONT_MONO, cursor: "pointer", flexShrink: 0 }}>
      {copied === id ? "✓ copied" : "copy"}
    </button>
  );

  const CodeBlock = ({ id, code, lang }) => (
    <div style={{ position: "relative" }}>
      {lang && (
        <div style={{ position: "absolute", top: 8, left: 12, fontFamily: FONT_MONO,
          fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase",
          color: T.textMute, pointerEvents: "none" }}>{lang}</div>
      )}
      <pre style={{ background: T.bg, border: `1px solid ${T.border}`, borderRadius: 6,
        padding: lang ? "28px 16px 14px" : "14px 16px",
        fontSize: 12, fontFamily: FONT_MONO, color: T.text,
        lineHeight: 1.7, overflow: "auto", margin: 0, whiteSpace: "pre" }}>{code}</pre>
      <div style={{ position: "absolute", top: 8, right: 8 }}>
        <CopyBtn id={id} text={code} />
      </div>
    </div>
  );

  const InlineNav = ({ label, target }) => (
    <button onClick={() => onNavigate(target)}
      style={{ background: "transparent", border: "none", color: T.accent,
        fontFamily: FONT_UI, fontSize: "inherit", cursor: "pointer",
        padding: 0, textDecoration: "underline", textDecorationColor: `${T.accent}55` }}>
      {label}
    </button>
  );

  const openaiSnippet =
`import openai

client = openai.OpenAI(
    base_url="${gatewayUrl}/v1",   # ← only change needed
    api_key="gk-…",                # ← your gateway key, NOT your OpenAI key
)

response = client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[{"role": "user", "content": "Hello"}],
)`;

  const anthropicSnippet =
`import anthropic

client = anthropic.Anthropic(
    base_url="${gatewayUrl}",      # ← only change needed
    api_key="gk-…",                # ← your gateway key, NOT your Anthropic key
)

message = client.messages.create(
    model="claude-haiku-4-5",
    max_tokens=1024,
    messages=[{"role": "user", "content": "Hello"}],
)`;

  const GUARD_MODES = [
    {
      mode: "observe",
      color: T.accent,
      label: "Observe",
      tagline: "Start here.",
      desc: "Every request is logged and visible in your dashboard. Nothing is blocked or flagged to users. Zero impact on your application.",
      when: "Default for all new teams. Stay here until you've seen what your traffic looks like.",
    },
    {
      mode: "alert",
      color: T.warn,
      label: "Alert",
      tagline: "Verify before enforcing.",
      desc: "Policy violations surface as dashboard alerts. Requests still pass through. You see what enforcement would block before you turn it on.",
      when: "Move here after a week or two in observe. Confirm the alerts match real issues, not false positives.",
    },
    {
      mode: "enforce",
      color: T.crit,
      label: "Enforce",
      tagline: "Block in production.",
      desc: "Requests that violate policy are blocked before they reach the provider. Your rules are active.",
      when: "Move here once you've verified alerts in production and are confident in your policies.",
    },
  ];

  const steps = [
    {
      n: "1",
      color: T.warn,
      label: "Add your provider key",
      required: true,
      content: (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 12, color: T.textDim, lineHeight: 1.65 }}>
            Go to <InlineNav label="Settings → Provider Keys" target="settings" /> and paste your
            OpenAI, Anthropic, or Google API key.{" "}
            <strong style={{ color: T.warn }}>Until this is done, every request fails with a 402
            "no credential configured" error.</strong> This is the step that stops most setups cold.
          </div>
          <div style={{ background: T.bg, border: `1px solid ${T.border}`, borderRadius: 5,
            padding: "10px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
            {[
              { label: "Your key", example: "sk-…  /  sk-ant-…  /  AIza…", note: "Goes in Settings — never in your app code" },
              { label: "After saving", example: "…k3f9 (last 4 chars)", note: "Full key is never displayed again" },
              { label: "Validation", example: "Checked before storing", note: "Invalid keys are rejected immediately" },
            ].map(r => (
              <div key={r.label} style={{ display: "flex", gap: 10, alignItems: "baseline", fontSize: 12 }}>
                <div style={{ width: 90, fontFamily: FONT_MONO, fontSize: 10, color: T.textMute,
                  letterSpacing: "0.08em", textTransform: "uppercase", flexShrink: 0 }}>{r.label}</div>
                <code style={{ fontFamily: FONT_MONO, fontSize: 11, color: T.accent, flex: 1 }}>{r.example}</code>
                <div style={{ color: T.textMute, fontSize: 11 }}>{r.note}</div>
              </div>
            ))}
          </div>
          <button onClick={() => onNavigate("settings")}
            style={{ alignSelf: "flex-start", background: `${T.warn}15`, border: `1px solid ${T.warn}55`,
              color: T.warn, padding: "6px 14px", borderRadius: 4, fontSize: 11,
              fontFamily: FONT_MONO, cursor: "pointer", letterSpacing: "0.08em", textTransform: "uppercase" }}>
            Open Settings →
          </button>
        </div>
      ),
    },
    {
      n: "2",
      color: T.info,
      label: "Point your app at the gateway",
      content: (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 12, color: T.textDim, lineHeight: 1.65 }}>
            Change <code style={{ fontFamily: FONT_MONO, fontSize: 11, color: T.info }}>base_url</code> in
            your SDK client to point here. That's the only code change — every model, every provider,
            routes through the gateway automatically.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <div style={{ fontFamily: FONT_MONO, fontSize: 9, color: T.textMute, letterSpacing: "0.12em",
                textTransform: "uppercase", marginBottom: 6 }}>OpenAI SDK → /v1/chat/completions</div>
              <CodeBlock id="openai-snippet" code={openaiSnippet} />
            </div>
            <div>
              <div style={{ fontFamily: FONT_MONO, fontSize: 9, color: T.textMute, letterSpacing: "0.12em",
                textTransform: "uppercase", marginBottom: 6 }}>Anthropic SDK → /v1/messages</div>
              <CodeBlock id="anthropic-snippet" code={anthropicSnippet} />
            </div>
          </div>
          <div style={{ background: T.bg, border: `1px solid ${T.border}`, borderRadius: 5,
            padding: "10px 14px", display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ fontFamily: FONT_MONO, fontSize: 10, color: T.textMute,
              letterSpacing: "0.08em", textTransform: "uppercase", flexShrink: 0 }}>Gateway URL</div>
            <code style={{ fontFamily: FONT_MONO, fontSize: 12, color: T.accent, flex: 1 }}>{gatewayUrl}</code>
            <CopyBtn id="gateway-url" text={gatewayUrl} />
          </div>
        </div>
      ),
    },
    {
      n: "3",
      color: T.accent,
      label: "Authenticate with your gateway key",
      content: (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 12, color: T.textDim, lineHeight: 1.65 }}>
            Requests authenticate using a <strong style={{ color: T.accent }}>gateway key</strong> (
            <code style={{ fontFamily: FONT_MONO, fontSize: 11, color: T.accent }}>gk-…</code>),
            issued from the <InlineNav label="API Keys" target="apikeys" /> page.
            This is <strong style={{ color: T.warn }}>not</strong> your provider key — those go in Settings (Step 1).
          </div>
          <div style={{ background: T.bg, border: `1px solid ${T.border}`, borderRadius: 5,
            padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
            {[
              {
                label: "Provider key",
                example: "sk-…  /  sk-ant-…",
                color: T.textMute,
                note: "Stored in Settings → Provider Keys. Never in your app.",
              },
              {
                label: "Gateway key",
                example: "gk-…",
                color: T.accent,
                note: 'Used as api_key= in your SDK client. Issued in API Keys.',
              },
            ].map(r => (
              <div key={r.label} style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 12,
                paddingBottom: 8, borderBottom: `1px solid ${T.border}:last-child:border-0` }}>
                <div style={{ width: 110, fontFamily: FONT_MONO, fontSize: 10, color: T.textMute,
                  letterSpacing: "0.08em", textTransform: "uppercase", flexShrink: 0 }}>{r.label}</div>
                <code style={{ fontFamily: FONT_MONO, fontSize: 12, color: r.color, flex: 1 }}>{r.example}</code>
                <div style={{ color: T.textMute, fontSize: 11, maxWidth: 260, textAlign: "right" }}>{r.note}</div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 12, color: T.textDim, lineHeight: 1.65 }}>
            The <code style={{ fontFamily: FONT_MONO, fontSize: 11, color: T.accent }}>gk-…</code> key
            is shown <strong style={{ color: T.warn }}>once</strong> when created — copy it immediately.
            If you lose it, revoke it and generate a new one.
          </div>
          <button onClick={() => onNavigate("apikeys")}
            style={{ alignSelf: "flex-start", background: `${T.accent}12`, border: `1px solid ${T.accent}44`,
              color: T.accent, padding: "6px 14px", borderRadius: 4, fontSize: 11,
              fontFamily: FONT_MONO, cursor: "pointer", letterSpacing: "0.08em", textTransform: "uppercase" }}>
            Create API Key →
          </button>
        </div>
      ),
    },
    {
      n: "4",
      color: T.purple,
      label: "Organise by team",
      content: (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 12, color: T.textDim, lineHeight: 1.65 }}>
            Each API key carries a <strong style={{ color: T.purple }}>team</strong> name, set when you
            create the key. Team is how activity is attributed in telemetry and how guard modes and
            budgets are scoped. An engineering team and a support team can have different rules.
          </div>
          <div style={{ background: T.bg, border: `1px solid ${T.border}`, borderRadius: 5,
            padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontFamily: FONT_MONO, fontSize: 10, color: T.textMute, letterSpacing: "0.1em",
              textTransform: "uppercase", marginBottom: 4 }}>What team controls</div>
            {[
              { label: "Telemetry", desc: "Calls grouped and attributed by team in cost and usage views" },
              { label: "Guard modes", desc: "observe / alert / enforce set independently per team" },
              { label: "Budgets", desc: "Spend limits and alerts scoped per team" },
            ].map(r => (
              <div key={r.label} style={{ display: "flex", gap: 10, fontSize: 12 }}>
                <code style={{ fontFamily: FONT_MONO, fontSize: 11, color: T.purple, width: 100, flexShrink: 0 }}>{r.label}</code>
                <div style={{ color: T.textDim }}>{r.desc}</div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 12, color: T.textMute, lineHeight: 1.5, fontStyle: "italic" }}>
            Tip: one key per team is a good starting point. You can always create more keys for the same team later.
          </div>
        </div>
      ),
    },
    {
      n: "5",
      color: T.warn,
      label: "Choose your guard mode",
      content: (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 12, color: T.textDim, lineHeight: 1.65 }}>
            Guard modes are set per team in <InlineNav label="Settings → Guard Modes" target="settings" />.
            The product philosophy: you see what enforcement would do <em>before</em> you turn it on.
            Start in observe. Move forward only when you're confident.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            {GUARD_MODES.map((gm, i) => (
              <div key={gm.mode} style={{ background: T.bg, border: `1px solid ${gm.color}33`,
                borderRadius: 6, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8,
                position: "relative", overflow: "hidden" }}>
                {i === 0 && (
                  <div style={{ position: "absolute", top: 8, right: 8, background: `${T.accent}18`,
                    border: `1px solid ${T.accent}44`, borderRadius: 3, padding: "2px 7px",
                    fontFamily: FONT_MONO, fontSize: 9, color: T.accent, letterSpacing: "0.1em",
                    textTransform: "uppercase" }}>recommended</div>
                )}
                <div>
                  <code style={{ fontFamily: FONT_MONO, fontSize: 13, color: gm.color, fontWeight: 600 }}>{gm.mode}</code>
                  <div style={{ fontFamily: FONT_MONO, fontSize: 9, color: gm.color, opacity: 0.7,
                    textTransform: "uppercase", letterSpacing: "0.1em", marginTop: 2 }}>{gm.tagline}</div>
                </div>
                <div style={{ fontSize: 12, color: T.textDim, lineHeight: 1.55 }}>{gm.desc}</div>
                <div style={{ fontSize: 11, color: T.textMute, lineHeight: 1.5, borderTop: `1px solid ${T.border}`,
                  paddingTop: 8, marginTop: "auto" }}>{gm.when}</div>
              </div>
            ))}
          </div>
        </div>
      ),
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 960 }}>

      {/* Hero */}
      <div style={{ background: `linear-gradient(135deg, ${T.panel} 0%, ${T.panelHi} 100%)`,
        border: `1px solid ${T.border}`, borderRadius: 8, padding: "32px 36px",
        position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", top: 0, right: 0, width: 260, height: 260,
          background: `radial-gradient(circle, ${T.accent}0C 0%, transparent 70%)`,
          pointerEvents: "none" }} />
        <div style={{ fontFamily: FONT_MONO, fontSize: 10, letterSpacing: "0.18em",
          textTransform: "uppercase", color: T.accent, marginBottom: 10 }}>◆ Setup guide</div>
        <h2 style={{ fontSize: 26, fontWeight: 400, letterSpacing: "-0.02em", margin: "0 0 10px",
          color: T.text, lineHeight: 1.25 }}>
          Get from zero to traffic in five steps
        </h2>
        <p style={{ fontSize: 14, color: T.textDim, margin: 0, maxWidth: 620, lineHeight: 1.65 }}>
          Your organisation is already provisioned — this guide takes you from first login to requests
          flowing through the gateway and visible in your dashboard.
          Follow each step in order; Step 1 is a hard prerequisite.
        </p>
        {currentUser && (
          <div style={{ marginTop: 14, display: "inline-flex", alignItems: "center", gap: 8,
            background: T.panel, border: `1px solid ${T.border}`, borderRadius: 5,
            padding: "7px 12px", fontSize: 12, fontFamily: FONT_MONO }}>
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: T.accent }} />
            <span style={{ color: T.textDim }}>Logged in as</span>
            <span style={{ color: T.text }}>{currentUser.name}</span>
            <span style={{ color: T.textMute }}>·</span>
            <span style={{ color: T.textMute }}>{currentUser.role}</span>
          </div>
        )}
      </div>

      {/* Steps */}
      <Card style={{ padding: "24px 28px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
          {steps.map((s, i) => (
            <div key={s.n} style={{ display: "flex", gap: 20 }}>
              {/* Step indicator column */}
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
                <div style={{ width: 34, height: 34, borderRadius: "50%",
                  background: `${s.color}15`, border: `1px solid ${s.color}55`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontFamily: FONT_MONO, fontSize: 13, color: s.color, fontWeight: 700,
                  flexShrink: 0 }}>
                  {s.n}
                </div>
                {i < steps.length - 1 && (
                  <div style={{ width: 1, flex: 1, background: T.border, minHeight: 20, margin: "6px 0" }} />
                )}
              </div>

              {/* Step body */}
              <div style={{ paddingBottom: i < steps.length - 1 ? 28 : 0, flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                  <div style={{ fontSize: 15, fontWeight: 600, color: T.text }}>{s.label}</div>
                  {s.required && (
                    <span style={{ background: `${T.warn}15`, border: `1px solid ${T.warn}44`,
                      borderRadius: 3, padding: "1px 7px", fontFamily: FONT_MONO, fontSize: 9,
                      color: T.warn, letterSpacing: "0.1em", textTransform: "uppercase" }}>required first</span>
                  )}
                </div>
                {s.content}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Done banner */}
      <div style={{ background: `linear-gradient(135deg, ${T.panel} 0%, ${T.panelHi} 100%)`,
        border: `1px solid ${T.accent}33`, borderRadius: 8, padding: "24px 28px",
        display: "flex", alignItems: "center", gap: 20 }}>
        <div style={{ width: 44, height: 44, borderRadius: "50%", background: `${T.accent}15`,
          border: `1px solid ${T.accent}44`, display: "flex", alignItems: "center",
          justifyContent: "center", fontSize: 20, flexShrink: 0 }}>✓</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: T.accent, marginBottom: 6 }}>
            You're set up — traffic is flowing
          </div>
          <div style={{ fontSize: 13, color: T.textDim, lineHeight: 1.6 }}>
            Once your app is pointed at the gateway and requests are coming through, everything
            is visible in your dashboard. Start with the{" "}
            <InlineNav label="Overview" target="overview" /> to confirm data is landing, then
            check <InlineNav label="Cost Intelligence" target="cost" /> to see spend by team.
            Use <InlineNav label="Alerts" target="alerts" /> to catch issues early.
          </div>
        </div>
        <button onClick={() => onNavigate("overview")}
          style={{ background: `${T.accent}15`, border: `1px solid ${T.accent}55`, color: T.accent,
            padding: "10px 20px", borderRadius: 5, fontSize: 12, fontFamily: FONT_MONO,
            cursor: "pointer", letterSpacing: "0.08em", textTransform: "uppercase", flexShrink: 0 }}>
          Go to Overview →
        </button>
      </div>

    </div>
  );
}

// ─── Assets Page ─────────────────────────────────────────────────────────────
function AssetsPage() {
  const T2 = T;
  const [assets,   setAssets]   = useState(null);
  const [summary,  setSummary]  = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [telRows,  setTelRows]  = useState({});
  const [telLoading, setTelLoading] = useState({});
  const [lastRefresh, setLastRefresh] = useState(null);

  // Filters
  const [search,    setSearch]   = useState("");
  const [fTeam,     setFTeam]    = useState("");
  const [fStatus,   setFStatus]  = useState("");
  const [fRisk,     setFRisk]    = useState("");
  const [sortBy,    setSortBy]   = useState("monthly_cost_usd");
  const [sortOrder, setSortOrder] = useState("desc");
  const [days,      setDays]     = useState(90);

  // New lifecycle / governance filters
  const [fLifecycle,    setFLifecycle]    = useState("");
  const [fEnvironment,  setFEnvironment]  = useState("");
  const [includeRetired, setIncludeRetired] = useState(false);

  // Tab state
  const [activeTab,   setActiveTab]   = useState("inventory");
  const [unassigned,  setUnassigned]  = useState([]);

  // Claim modal state
  const [claimTarget, setClaimTarget] = useState(null);
  const [claimForm,   setClaimForm]   = useState({ owner: "", team: "", environment: "prod", criticality: "medium", business_purpose: "", agent_name: "" });
  const [claimSaving, setClaimSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const params = { sort_by: sortBy, order: sortOrder, days };
      if (search)  params.search  = search;
      if (fTeam)   params.team    = fTeam;
      if (fStatus) params.status  = fStatus;
      if (fRisk)   params.risk    = fRisk;
      if (fLifecycle)    params.lifecycle_status = fLifecycle;
      if (fEnvironment)  params.environment      = fEnvironment;
      if (includeRetired) params.include_retired = true;
      const [a, s] = await Promise.all([
        fetchAssets(params),
        fetchAssetsSummary(days),
      ]);
      setAssets(Array.isArray(a) ? a : []);
      setSummary(s);
      setLastRefresh(new Date());
    } catch(e) {
      setError(e.message);
      setAssets([]);
    } finally {
      setLoading(false);
    }
  }, [search, fTeam, fStatus, fRisk, fLifecycle, fEnvironment, includeRetired, sortBy, sortOrder, days]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [load]);

  const loadUnassigned = useCallback(async () => {
    try {
      const data = await fetchUnassignedAssets();
      setUnassigned(Array.isArray(data) ? data : []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (activeTab === "unassigned") {
      loadUnassigned();
    }
  }, [activeTab, loadUnassigned]);

  const loadTelemetry = async (agentName) => {
    if (telRows[agentName]) return;
    setTelLoading(l => ({ ...l, [agentName]: true }));
    try {
      const data = await fetchAssetTelemetry(agentName, { limit: 20, days });
      setTelRows(r => ({ ...r, [agentName]: data }));
    } catch { /* ignore */ } finally {
      setTelLoading(l => ({ ...l, [agentName]: false }));
    }
  };

  const toggleRow = (name) => {
    if (expanded === name) {
      setExpanded(null);
    } else {
      setExpanded(name);
      loadTelemetry(name);
    }
  };

  const handleSort = (field) => {
    if (sortBy === field) {
      setSortOrder(o => o === "desc" ? "asc" : "desc");
    } else {
      setSortBy(field);
      setSortOrder("desc");
    }
  };

  const riskColor = (r) => r === "high" ? T2.crit : r === "medium" ? T2.warn : T2.accent;
  const statusColor = (s) => s === "active" ? T2.accent : s === "dormant" ? T2.warn : T2.textMute;

  const lifecycleBadge = (ls) => {
    const cfg = {
      managed:    { color: T2.accent,   label: "Managed" },
      unassigned: { color: T2.warn,     label: "Unassigned" },
      retired:    { color: T2.textMute, label: "Retired" },
    }[ls || "unassigned"] || { color: T2.textMute, label: ls || "—" };
    return <span style={{ fontSize: 10, fontWeight: 600, color: cfg.color, background: `${cfg.color}18`, padding: "2px 8px", borderRadius: 10 }}>{cfg.label}</span>;
  };

  const cell = { padding: "10px 12px", fontSize: 12, fontFamily: FONT_MONO, borderBottom: `1px solid ${T2.border}` };
  const hdr  = { ...cell, fontSize: 11, color: T2.textDim, cursor: "pointer", userSelect: "none", textTransform: "uppercase", letterSpacing: "0.08em" };

  const sortArrow = (field) => sortBy === field ? (sortOrder === "desc" ? " ↓" : " ↑") : "";

  const uniqueTeams = [...new Set((assets || []).map(a => a.team).filter(Boolean))].sort();

  const unassignedCount = (assets || []).filter(a => a.lifecycle_status === "unassigned").length;
  const managedCount    = (assets || []).filter(a => a.lifecycle_status === "managed").length;

  const openClaimModal = (a) => {
    setClaimForm({
      owner:            a.owner            || "",
      team:             a.team             || "",
      environment:      a.environment      || "prod",
      criticality:      a.criticality      || "medium",
      business_purpose: a.business_purpose || "",
      agent_name:       a.agent_name       || a.agent_id_raw || "",
    });
    setClaimTarget(a.agent_name || a.agent_id_raw);
  };

  const handleClaim = async () => {
    setClaimSaving(true);
    try {
      await claimAsset(claimTarget, claimForm);
      setClaimTarget(null);
      await load();
      if (activeTab === "unassigned") await loadUnassigned();
    } catch(e) {
      alert(`Failed to claim asset: ${e.message}`);
    } finally {
      setClaimSaving(false);
    }
  };

  return (
    <div style={{ padding: 24, fontFamily: FONT_UI }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.02em" }}>AI Agent Inventory</div>
          <div style={{ fontSize: 12, color: T2.textDim, marginTop: 2, fontFamily: FONT_MONO }}>
            Which agents exist · who owns them · what they cost · how they're governed
            {lastRefresh && <span style={{ marginLeft: 12, color: T2.textMute }}>· refreshed {lastRefresh.toLocaleTimeString()}</span>}
          </div>
        </div>
        <button onClick={load} disabled={loading}
          style={{ background: `${T2.accent}15`, border: `1px solid ${T2.accent}55`, color: T2.accent,
            padding: "7px 14px", borderRadius: 5, fontSize: 11, fontFamily: FONT_MONO,
            cursor: loading ? "default" : "pointer", opacity: loading ? 0.5 : 1, letterSpacing: "0.06em" }}>
          {loading ? "Loading…" : "↺ Refresh"}
        </button>
      </div>

      {/* Tab Bar */}
      <div style={{ display: "flex", gap: 4, marginBottom: 20, borderBottom: `1px solid ${T2.border}`, paddingBottom: 0 }}>
        {[
          { key: "inventory",  label: `Inventory (${(assets || []).length})` },
          { key: "unassigned", label: `Unassigned (${unassignedCount})` },
        ].map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            style={{
              background: activeTab === tab.key ? T2.panel : "transparent",
              border: `1px solid ${activeTab === tab.key ? T2.border : "transparent"}`,
              borderBottom: activeTab === tab.key ? `1px solid ${T2.panel}` : `1px solid ${T2.border}`,
              color: activeTab === tab.key ? T2.text : T2.textDim,
              padding: "8px 16px", fontSize: 12, fontFamily: FONT_MONO,
              cursor: "pointer", borderRadius: "5px 5px 0 0", marginBottom: -1,
              fontWeight: activeTab === tab.key ? 600 : 400,
            }}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* KPI Cards */}
      {summary && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginBottom: 24 }}>
          {[
            { label: "Total Agents",   value: summary.total_agents,       color: T2.text },
            { label: "Active",         value: summary.active_agents,      color: T2.accent },
            { label: "Dormant",        value: summary.dormant_agents,     color: T2.warn },
            { label: "Inactive",       value: summary.inactive_agents,    color: T2.textMute },
            { label: "High Risk",      value: summary.high_risk_agents,   color: T2.crit },
            { label: "Monthly Cost",   value: `$${(summary.monthly_cost_usd || 0).toFixed(2)}`, color: T2.purple },
            { label: "Total Cost",     value: `$${(summary.total_cost_usd || 0).toFixed(2)}`,   color: T2.textDim },
            { label: "Unassigned",     value: unassignedCount,            color: T2.warn },
            { label: "Managed",        value: managedCount,               color: T2.accent },
          ].map(({ label, value, color }) => (
            <div key={label} style={{ background: T2.panel, border: `1px solid ${T2.border}`, borderRadius: 8, padding: "14px 16px" }}>
              <div style={{ fontSize: 10, color: T2.textMute, fontFamily: FONT_MONO, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>{label}</div>
              <div style={{ fontSize: 22, fontWeight: 600, color, fontFamily: FONT_MONO }}>{value}</div>
            </div>
          ))}
        </div>
      )}

      {activeTab === "inventory" && (
        <>
          {/* Filters */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
            <input
              placeholder="Search agents or teams…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ background: T2.panel, border: `1px solid ${T2.border}`, color: T2.text, borderRadius: 5, padding: "7px 10px", fontSize: 12, fontFamily: FONT_MONO, minWidth: 200, outline: "none" }}
            />
            <select value={fTeam} onChange={e => setFTeam(e.target.value)}
              style={{ background: T2.panel, border: `1px solid ${T2.border}`, color: fTeam ? T2.text : T2.textDim, borderRadius: 5, padding: "7px 10px", fontSize: 12, fontFamily: FONT_MONO }}>
              <option value="">All teams</option>
              {uniqueTeams.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <select value={fStatus} onChange={e => setFStatus(e.target.value)}
              style={{ background: T2.panel, border: `1px solid ${T2.border}`, color: fStatus ? T2.text : T2.textDim, borderRadius: 5, padding: "7px 10px", fontSize: 12, fontFamily: FONT_MONO }}>
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="dormant">Dormant</option>
              <option value="inactive">Inactive</option>
            </select>
            <select value={fRisk} onChange={e => setFRisk(e.target.value)}
              style={{ background: T2.panel, border: `1px solid ${T2.border}`, color: fRisk ? T2.text : T2.textDim, borderRadius: 5, padding: "7px 10px", fontSize: 12, fontFamily: FONT_MONO }}>
              <option value="">All risk levels</option>
              <option value="high">High risk</option>
              <option value="medium">Medium risk</option>
              <option value="low">Low risk</option>
            </select>
            <select value={fLifecycle} onChange={e => setFLifecycle(e.target.value)}
              style={{ background: T2.panel, border: `1px solid ${T2.border}`, color: fLifecycle ? T2.text : T2.textDim, borderRadius: 5, padding: "7px 10px", fontSize: 12, fontFamily: FONT_MONO }}>
              <option value="">All lifecycle</option>
              <option value="unassigned">Unassigned</option>
              <option value="managed">Managed</option>
              <option value="retired">Retired</option>
            </select>
            <select value={fEnvironment} onChange={e => setFEnvironment(e.target.value)}
              style={{ background: T2.panel, border: `1px solid ${T2.border}`, color: fEnvironment ? T2.text : T2.textDim, borderRadius: 5, padding: "7px 10px", fontSize: 12, fontFamily: FONT_MONO }}>
              <option value="">All environments</option>
              <option value="prod">prod</option>
              <option value="staging">staging</option>
              <option value="dev">dev</option>
            </select>
            <select value={days} onChange={e => setDays(Number(e.target.value))}
              style={{ background: T2.panel, border: `1px solid ${T2.border}`, color: T2.text, borderRadius: 5, padding: "7px 10px", fontSize: 12, fontFamily: FONT_MONO }}>
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
            </select>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontFamily: FONT_MONO, color: T2.textDim, cursor: "pointer" }}>
              <input type="checkbox" checked={includeRetired} onChange={e => setIncludeRetired(e.target.checked)}
                style={{ accentColor: T2.accent }} />
              Include retired
            </label>
            {(search || fTeam || fStatus || fRisk || fLifecycle || fEnvironment || includeRetired) && (
              <button onClick={() => { setSearch(""); setFTeam(""); setFStatus(""); setFRisk(""); setFLifecycle(""); setFEnvironment(""); setIncludeRetired(false); }}
                style={{ background: "transparent", border: `1px solid ${T2.border}`, color: T2.textDim, borderRadius: 5, padding: "7px 12px", fontSize: 12, fontFamily: FONT_MONO, cursor: "pointer" }}>
                Clear filters
              </button>
            )}
          </div>

          {/* Error */}
          {error && (
            <div style={{ background: `${T2.crit}15`, border: `1px solid ${T2.crit}44`, borderRadius: 6, padding: "10px 14px", marginBottom: 16, color: T2.crit, fontSize: 12, fontFamily: FONT_MONO }}>
              Error loading assets: {error}
            </div>
          )}

          {/* Table */}
          <div style={{ background: T2.panel, border: `1px solid ${T2.border}`, borderRadius: 8, overflow: "hidden" }}>
            {loading && !assets ? (
              <div style={{ padding: 40, textAlign: "center", color: T2.textMute, fontFamily: FONT_MONO }}>Loading agents…</div>
            ) : !assets || assets.length === 0 ? (
              <div style={{ padding: 40, textAlign: "center", color: T2.textMute, fontFamily: FONT_MONO }}>
                No agents found. Run <span style={{ color: T2.accent }}>python scripts/seed_demo_data.py</span> to create demo data.
              </div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${T2.borderHi}` }}>
                    <th style={hdr} onClick={() => handleSort("agent_name")}>Agent{sortArrow("agent_name")}</th>
                    <th style={hdr}>Lifecycle</th>
                    <th style={hdr}>Team</th>
                    <th style={hdr} onClick={() => handleSort("status")}>Status{sortArrow("status")}</th>
                    <th style={hdr} onClick={() => handleSort("risk")}>Risk{sortArrow("risk")}</th>
                    <th style={{ ...hdr, textAlign: "right" }} onClick={() => handleSort("monthly_cost_usd")}>30d Cost{sortArrow("monthly_cost_usd")}</th>
                    <th style={{ ...hdr, textAlign: "right" }} onClick={() => handleSort("total_calls")}>Calls{sortArrow("total_calls")}</th>
                    <th style={hdr} onClick={() => handleSort("last_seen")}>Last Seen{sortArrow("last_seen")}</th>
                    <th style={hdr}>Signals</th>
                    <th style={{ ...hdr, cursor: "default" }}></th>
                  </tr>
                </thead>
                <tbody>
                  {assets.map((a) => {
                    const isExpanded = expanded === a.agent_name;
                    const lastSeen = new Date(a.last_seen);
                    const daysAgo = Math.floor((Date.now() - lastSeen.getTime()) / 86400000);
                    const lastSeenStr = daysAgo === 0 ? "today" : daysAgo === 1 ? "yesterday" : `${daysAgo}d ago`;
                    const sig = a.signals || {};
                    return (
                      <React.Fragment key={a.agent_name}>
                        <tr
                          onClick={() => toggleRow(a.agent_name)}
                          style={{ cursor: "pointer", background: isExpanded ? T2.panelHi : "transparent",
                            transition: "background 0.1s" }}
                          onMouseEnter={e => { if (!isExpanded) e.currentTarget.style.background = `${T2.panelHi}88`; }}
                          onMouseLeave={e => { if (!isExpanded) e.currentTarget.style.background = "transparent"; }}
                        >
                          <td style={cell}>
                            <span style={{ color: T2.text, fontWeight: 500 }}>{a.agent_name}</span>
                          </td>
                          <td style={cell}>{lifecycleBadge(a.lifecycle_status)}</td>
                          <td style={{ ...cell, color: T2.textDim }}>{a.team || "—"}</td>
                          <td style={cell}>
                            <span style={{ color: statusColor(a.status), fontSize: 11, fontWeight: 600,
                              background: `${statusColor(a.status)}18`, padding: "2px 8px", borderRadius: 10 }}>
                              {a.status}
                            </span>
                          </td>
                          <td style={cell}>
                            <span style={{ color: riskColor(a.risk), fontSize: 11, fontWeight: 600,
                              background: `${riskColor(a.risk)}18`, padding: "2px 8px", borderRadius: 10 }}>
                              {a.risk}
                            </span>
                          </td>
                          <td style={{ ...cell, textAlign: "right", color: a.monthly_cost_usd > 1 ? T2.warn : T2.text }}>
                            ${(a.monthly_cost_usd || 0).toFixed(4)}
                          </td>
                          <td style={{ ...cell, textAlign: "right", color: T2.textDim }}>
                            {(a.total_calls || 0).toLocaleString()}
                          </td>
                          <td style={{ ...cell, color: T2.textDim }}>{lastSeenStr}</td>
                          <td style={cell}>
                            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                              {sig.has_blocked && <span style={{ fontSize: 10, background: `${T2.warn}22`, color: T2.warn, padding: "1px 6px", borderRadius: 8, fontFamily: FONT_MONO }}>blocked</span>}
                              {sig.has_loop && <span style={{ fontSize: 10, background: `${T2.crit}22`, color: T2.crit, padding: "1px 6px", borderRadius: 8, fontFamily: FONT_MONO }}>loop</span>}
                              {sig.after_hours_calls > 5 && <span style={{ fontSize: 10, background: `${T2.info}22`, color: T2.info, padding: "1px 6px", borderRadius: 8, fontFamily: FONT_MONO }}>after-hours</span>}
                            </div>
                          </td>
                          <td style={{ ...cell, color: T2.textDim, fontSize: 14 }}>
                            {isExpanded ? "▲" : "▼"}
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr>
                            <td colSpan={10} style={{ background: `${T2.panelHi}`, borderBottom: `1px solid ${T2.border}`, padding: 0 }}>
                              <div style={{ padding: "16px 20px" }}>
                                {/* Details grid — 8 cells */}
                                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 16 }}>
                                  {[
                                    { label: "First Seen",       value: new Date(a.first_seen).toLocaleDateString() },
                                    { label: "Total Cost",       value: `$${(a.total_cost_usd || 0).toFixed(4)}` },
                                    { label: "Total Tokens",     value: (a.total_tokens || 0).toLocaleString() },
                                    { label: "Models Used",      value: (a.models_used || []).join(", ") || "—" },
                                    { label: "Owner",            value: a.owner || "Unassigned" },
                                    { label: "Environment",      value: a.environment || "Unknown" },
                                    { label: "Criticality",      value: a.criticality || "—" },
                                    { label: "Business Purpose", value: a.business_purpose || "—" },
                                  ].map(({ label, value }) => (
                                    <div key={label} style={{ background: T2.panel, border: `1px solid ${T2.border}`, borderRadius: 6, padding: "10px 12px" }}>
                                      <div style={{ fontSize: 10, color: T2.textMute, fontFamily: FONT_MONO, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>{label}</div>
                                      <div style={{ fontSize: 12, color: T2.text, fontFamily: FONT_MONO, wordBreak: "break-all" }}>{value}</div>
                                    </div>
                                  ))}
                                </div>

                                {/* Runtime Hints */}
                                <div style={{ marginBottom: 12 }}>
                                  <div style={{ fontSize: 10, color: T2.textMute, fontFamily: FONT_MONO, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>
                                    Runtime Hints · from telemetry headers, not canonical
                                  </div>
                                  <div style={{ display: "flex", gap: 16, fontSize: 11, fontFamily: FONT_MONO, color: T2.textMute }}>
                                    <span>team_raw: <span style={{ color: T2.textDim }}>{a.signals?.team_raw || "—"}</span></span>
                                    <span>environment_raw: <span style={{ color: T2.textDim }}>{a.signals?.environment_raw || "—"}</span></span>
                                    <span>asset_key: <span style={{ color: T2.textDim, fontFamily: FONT_MONO, fontSize: 10 }}>{(a.asset_key || "").slice(0, 16)}…</span></span>
                                  </div>
                                </div>

                                {/* Claim button */}
                                {a.lifecycle_status !== "managed" && (
                                  <div style={{ marginBottom: 16 }}>
                                    <button
                                      onClick={e => { e.stopPropagation(); openClaimModal(a); }}
                                      style={{ background: `${T2.accent}18`, border: `1px solid ${T2.accent}55`, color: T2.accent,
                                        padding: "6px 14px", borderRadius: 5, fontSize: 11, fontFamily: FONT_MONO,
                                        cursor: "pointer", letterSpacing: "0.06em" }}>
                                      Claim This Asset
                                    </button>
                                  </div>
                                )}

                                {/* Risk signals detail */}
                                <div style={{ marginBottom: 16 }}>
                                  <div style={{ fontSize: 11, color: T2.textMute, fontFamily: FONT_MONO, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>Risk Signals</div>
                                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                                    {sig.has_blocked && (
                                      <div style={{ background: `${T2.warn}15`, border: `1px solid ${T2.warn}44`, borderRadius: 6, padding: "6px 12px", fontSize: 12, color: T2.warn, fontFamily: FONT_MONO }}>
                                        {sig.blocked_count} blocked requests
                                      </div>
                                    )}
                                    {sig.has_loop && (
                                      <div style={{ background: `${T2.crit}15`, border: `1px solid ${T2.crit}44`, borderRadius: 6, padding: "6px 12px", fontSize: 12, color: T2.crit, fontFamily: FONT_MONO }}>
                                        Loop: {sig.loop_max_window} calls in 5-min window
                                      </div>
                                    )}
                                    {sig.after_hours_calls > 0 && (
                                      <div style={{ background: `${T2.info}15`, border: `1px solid ${T2.info}44`, borderRadius: 6, padding: "6px 12px", fontSize: 12, color: T2.info, fontFamily: FONT_MONO }}>
                                        {sig.after_hours_calls} after-hours calls
                                      </div>
                                    )}
                                    {!sig.has_blocked && !sig.has_loop && sig.after_hours_calls <= 0 && (
                                      <div style={{ color: T2.textMute, fontSize: 12, fontFamily: FONT_MONO }}>No risk signals detected</div>
                                    )}
                                  </div>
                                </div>

                                {/* Recent telemetry */}
                                <div>
                                  <div style={{ fontSize: 11, color: T2.textMute, fontFamily: FONT_MONO, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>Recent Calls</div>
                                  {telLoading[a.agent_name] ? (
                                    <div style={{ color: T2.textMute, fontSize: 12, fontFamily: FONT_MONO }}>Loading…</div>
                                  ) : telRows[a.agent_name] ? (
                                    <div style={{ overflowX: "auto" }}>
                                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, fontFamily: FONT_MONO }}>
                                        <thead>
                                          <tr>
                                            {["Timestamp", "Model", "Tokens", "Cost", "Latency", "Flags"].map(h => (
                                              <th key={h} style={{ textAlign: "left", padding: "4px 10px", color: T2.textMute, borderBottom: `1px solid ${T2.border}`, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em" }}>{h}</th>
                                            ))}
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {(telRows[a.agent_name].items || []).map(r => (
                                            <tr key={r.id}>
                                              <td style={{ padding: "4px 10px", color: T2.textDim }}>{new Date(r.timestamp).toLocaleString()}</td>
                                              <td style={{ padding: "4px 10px", color: T2.text }}>{r.model}</td>
                                              <td style={{ padding: "4px 10px", color: T2.textDim }}>{(r.total_tokens || 0).toLocaleString()}</td>
                                              <td style={{ padding: "4px 10px", color: T2.textDim }}>${(r.cost_usd || 0).toFixed(5)}</td>
                                              <td style={{ padding: "4px 10px", color: T2.textDim }}>{Math.round(r.latency_ms)}ms</td>
                                              <td style={{ padding: "4px 10px" }}>
                                                {r.blocked   && <span style={{ color: T2.warn, marginRight: 4, fontSize: 10, background: `${T2.warn}22`, padding: "1px 6px", borderRadius: 8, fontFamily: FONT_MONO }}>blocked</span>}
                                                {(() => { const h = new Date(r.timestamp).getHours(); return (h < 7 || h >= 20); })() && <span style={{ color: T2.info, fontSize: 10, background: `${T2.info}22`, padding: "1px 6px", borderRadius: 8, fontFamily: FONT_MONO }}>after-hrs</span>}
                                              </td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                      {telRows[a.agent_name].total > 20 && (
                                        <div style={{ color: T2.textMute, fontSize: 11, padding: "6px 10px" }}>
                                          Showing 20 of {telRows[a.agent_name].total} calls
                                        </div>
                                      )}
                                    </div>
                                  ) : null}
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
          </div>

          {assets && assets.length > 0 && (
            <div style={{ marginTop: 8, fontSize: 11, color: T2.textMute, fontFamily: FONT_MONO }}>
              {assets.length} agent{assets.length !== 1 ? "s" : ""} · auto-refreshes every 30s
            </div>
          )}
        </>
      )}

      {activeTab === "unassigned" && (
        <div style={{ background: T2.panel, border: `1px solid ${T2.border}`, borderRadius: 8, overflow: "hidden" }}>
          {unassigned.length === 0 ? (
            <div style={{ padding: 40, textAlign: "center", color: T2.textMute, fontFamily: FONT_MONO }}>
              No unassigned assets in the discovery queue.
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${T2.borderHi}` }}>
                  <th style={hdr}>Agent ID</th>
                  <th style={hdr}>First Seen</th>
                  <th style={{ ...hdr, cursor: "default" }}></th>
                </tr>
              </thead>
              <tbody>
                {unassigned.map((u, idx) => (
                  <tr key={u.agent_id_raw || idx}
                    style={{ borderBottom: `1px solid ${T2.border}` }}
                    onMouseEnter={e => { e.currentTarget.style.background = `${T2.panelHi}88`; }}
                    onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}>
                    <td style={{ ...cell, color: T2.text, fontWeight: 500 }}>{u.agent_id_raw}</td>
                    <td style={{ ...cell, color: T2.textDim }}>{u.first_seen_at ? new Date(u.first_seen_at).toLocaleDateString() : "—"}</td>
                    <td style={cell}>
                      <button
                        onClick={() => openClaimModal({ agent_name: u.agent_id_raw, agent_id_raw: u.agent_id_raw })}
                        style={{ background: `${T2.accent}18`, border: `1px solid ${T2.accent}55`, color: T2.accent,
                          padding: "4px 12px", borderRadius: 5, fontSize: 11, fontFamily: FONT_MONO, cursor: "pointer" }}>
                        Claim
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Claim Modal */}
      {claimTarget !== null && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={e => { if (e.target === e.currentTarget) setClaimTarget(null); }}>
          <div style={{ background: T2.panel, border: `1px solid ${T2.border}`, borderRadius: 10, padding: 32, width: "100%", maxWidth: 800, fontFamily: FONT_UI, maxHeight: "90vh", overflowY: "auto" }}>
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 20, letterSpacing: "-0.01em" }}>
              Claim Agent: <span style={{ color: T2.accent, fontFamily: FONT_MONO }}>{claimTarget}</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
              <div>
                <label style={{ display: "block", fontSize: 10, color: T2.textMute, fontFamily: FONT_MONO, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>Display Name (agent_name)</label>
                <input value={claimForm.agent_name} onChange={e => setClaimForm(f => ({ ...f, agent_name: e.target.value }))}
                  style={{ width: "100%", background: T2.bg, border: `1px solid ${T2.border}`, color: T2.text, borderRadius: 5, padding: "8px 10px", fontSize: 12, fontFamily: FONT_MONO, outline: "none", boxSizing: "border-box" }} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 10, color: T2.textMute, fontFamily: FONT_MONO, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>Owner <span style={{ color: T2.crit }}>*</span></label>
                <input value={claimForm.owner} onChange={e => setClaimForm(f => ({ ...f, owner: e.target.value }))}
                  placeholder="e.g. platform-team"
                  style={{ width: "100%", background: T2.bg, border: `1px solid ${T2.border}`, color: T2.text, borderRadius: 5, padding: "8px 10px", fontSize: 12, fontFamily: FONT_MONO, outline: "none", boxSizing: "border-box" }} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 10, color: T2.textMute, fontFamily: FONT_MONO, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>Team</label>
                <input value={claimForm.team} onChange={e => setClaimForm(f => ({ ...f, team: e.target.value }))}
                  placeholder="e.g. engineering"
                  style={{ width: "100%", background: T2.bg, border: `1px solid ${T2.border}`, color: T2.text, borderRadius: 5, padding: "8px 10px", fontSize: 12, fontFamily: FONT_MONO, outline: "none", boxSizing: "border-box" }} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 10, color: T2.textMute, fontFamily: FONT_MONO, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>Environment</label>
                <select value={claimForm.environment} onChange={e => setClaimForm(f => ({ ...f, environment: e.target.value }))}
                  style={{ width: "100%", background: T2.bg, border: `1px solid ${T2.border}`, color: T2.text, borderRadius: 5, padding: "8px 10px", fontSize: 12, fontFamily: FONT_MONO, outline: "none", boxSizing: "border-box" }}>
                  <option value="prod">prod</option>
                  <option value="staging">staging</option>
                  <option value="dev">dev</option>
                  <option value="unknown">unknown</option>
                </select>
              </div>
              <div>
                <label style={{ display: "block", fontSize: 10, color: T2.textMute, fontFamily: FONT_MONO, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>Criticality</label>
                <select value={claimForm.criticality} onChange={e => setClaimForm(f => ({ ...f, criticality: e.target.value }))}
                  style={{ width: "100%", background: T2.bg, border: `1px solid ${T2.border}`, color: T2.text, borderRadius: 5, padding: "8px 10px", fontSize: 12, fontFamily: FONT_MONO, outline: "none", boxSizing: "border-box" }}>
                  <option value="critical">critical</option>
                  <option value="high">high</option>
                  <option value="medium">medium</option>
                  <option value="low">low</option>
                </select>
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <label style={{ display: "block", fontSize: 10, color: T2.textMute, fontFamily: FONT_MONO, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>Business Purpose</label>
                <textarea value={claimForm.business_purpose} onChange={e => setClaimForm(f => ({ ...f, business_purpose: e.target.value }))}
                  rows={3} placeholder="Describe the purpose of this agent…"
                  style={{ width: "100%", background: T2.bg, border: `1px solid ${T2.border}`, color: T2.text, borderRadius: 5, padding: "8px 10px", fontSize: 12, fontFamily: FONT_MONO, outline: "none", resize: "vertical", boxSizing: "border-box" }} />
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button onClick={() => setClaimTarget(null)}
                style={{ background: "transparent", border: `1px solid ${T2.border}`, color: T2.textDim,
                  padding: "8px 18px", borderRadius: 5, fontSize: 12, fontFamily: FONT_MONO, cursor: "pointer" }}>
                Cancel
              </button>
              <button onClick={handleClaim} disabled={claimSaving || !claimForm.owner}
                style={{ background: `${T2.accent}22`, border: `1px solid ${T2.accent}66`, color: T2.accent,
                  padding: "8px 18px", borderRadius: 5, fontSize: 12, fontFamily: FONT_MONO,
                  cursor: claimSaving || !claimForm.owner ? "default" : "pointer",
                  opacity: claimSaving || !claimForm.owner ? 0.5 : 1 }}>
                {claimSaving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Customer Welcome / Platform Guide ───────────────────────────────────────
function CustomerWelcomePage({ onNavigate }) {
  const features = [
    { icon: "◈", color: T.accent,  title: "Agent Inventory",          page: "agent_inventory",  desc: "Which agents exist — who owns them, what they cost, how risky they are. The foundation of the system of record." },
    { icon: "🔗", color: T.teal,   title: "Runtime Dependency Map",   page: "relationship_map",  desc: "What every agent touches — MCP servers, tools, workflows, APIs, databases, and CRMs mapped at runtime." },
    { icon: "⊙", color: T.yellow,  title: "Discovery Center",         page: "discovery",         desc: "Automatically surface AI agents that were created without going through official channels." },
    { icon: "⊛", color: T.info,    title: "Governance Center",        page: "governance",        desc: "Review and approve new agents before they go live. Assign owners, set policies." },
    { icon: "$", color: T.accent,  title: "Cost Intelligence",        page: "cost",              desc: "Track how much each team and agent is spending on AI APIs each month." },
    { icon: "⚑", color: T.crit,   title: "Security Intelligence",    page: "security_intel",    desc: "Get alerts on unusual activity, prompt injection attempts, and policy violations." },
  ];
  const steps = [
    { n:"1", title:"Connect your AI gateway",    desc:"Point your AI agent code at our gateway instead of directly at OpenAI or Anthropic. One line of code change.", cta:"See Integration Guide →", page:"integrations" },
    { n:"2", title:"Tag your agents",             desc:"Add identity headers to every request — team, agent name, and optionally the MCP server or tool being called. This tells us who sent what to where.", cta:null, page:null },
    { n:"3", title:"Invite your team",            desc:"Add colleagues as Viewers or Analysts so they can see the agents their team owns.", cta:"Manage Users →", page:"users" },
    { n:"4", title:"Explore inventory and deps",  desc:"Within minutes of sending the first request through the gateway, agents appear in the inventory and their dependencies start populating the Runtime Dependency Map.", cta:"View Agent Inventory →", page:"agent_inventory" },
  ];
  return (
    <div style={{ maxWidth:880, margin:"0 auto", padding:"32px 24px", fontFamily:FONT_UI }}>
      {/* Hero */}
      <div style={{ marginBottom:36, padding:"36px 40px", background:T.panel, border:`1px solid ${T.border}`, borderRadius:12, position:"relative", overflow:"hidden" }}>
        <div style={{ position:"absolute", top:-50, right:-50, width:220, height:220, borderRadius:"50%", background:`${T.accent}07`, pointerEvents:"none" }} />
        <div style={{ fontSize:11, fontFamily:FONT_MONO, color:T.accent, letterSpacing:"0.15em", textTransform:"uppercase", marginBottom:10 }}>AI Agent System of Record</div>
        <div style={{ fontSize:30, fontWeight:700, color:T.text, marginBottom:10, lineHeight:1.2 }}>Discover every agent.<br/>Map every dependency.</div>
        <div style={{ fontSize:14, color:T.textDim, lineHeight:1.7, maxWidth:560, marginBottom:6 }}>
          AI Agent Inventory tells you which agents exist. Runtime Dependency Map tells you what they interact with. Together, they become the system of record for enterprise AI operations.
        </div>
        <div style={{ fontSize:13, color:T.textMute, lineHeight:1.6, maxWidth:540, marginBottom:22 }}>
          Govern every AI interaction — from the agents your team built intentionally to the ones that appeared without anyone knowing.
        </div>
        <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
          <button onClick={() => onNavigate("agent_inventory")}
            style={{ background:T.accent, color:"#000", border:"none", borderRadius:6, padding:"10px 22px", fontSize:13, fontWeight:600, fontFamily:FONT_UI, cursor:"pointer" }}>
            Open Agent Inventory →
          </button>
          <button onClick={() => onNavigate("relationship_map")}
            style={{ background:"transparent", color:T.teal, border:`1px solid ${T.teal}55`, borderRadius:6, padding:"10px 22px", fontSize:13, fontWeight:600, fontFamily:FONT_UI, cursor:"pointer" }}>
            View Dependency Map →
          </button>
        </div>
      </div>
      {/* Features */}
      <div style={{ fontSize:11, fontFamily:FONT_MONO, color:T.textMute, letterSpacing:"0.12em", textTransform:"uppercase", marginBottom:14 }}>What you can do</div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(250px,1fr))", gap:12, marginBottom:36 }}>
        {features.map(f => (
          <button key={f.page} onClick={() => onNavigate(f.page)}
            style={{ background:T.panel, border:`1px solid ${T.border}`, borderRadius:10, padding:"20px", textAlign:"left", cursor:"pointer", transition:"border-color 0.15s" }}
            onMouseEnter={e => e.currentTarget.style.borderColor = f.color+"55"}
            onMouseLeave={e => e.currentTarget.style.borderColor = T.border}>
            <div style={{ fontSize:20, marginBottom:10, color:f.color }}>{f.icon}</div>
            <div style={{ fontSize:14, fontWeight:600, color:T.text, marginBottom:6 }}>{f.title}</div>
            <div style={{ fontSize:12, color:T.textDim, lineHeight:1.6 }}>{f.desc}</div>
          </button>
        ))}
      </div>
      {/* Getting started */}
      <div style={{ fontSize:11, fontFamily:FONT_MONO, color:T.textMute, letterSpacing:"0.12em", textTransform:"uppercase", marginBottom:14 }}>Getting started</div>
      <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
        {steps.map(s => (
          <div key={s.n} style={{ background:T.panel, border:`1px solid ${T.border}`, borderRadius:10, padding:"16px 20px", display:"flex", gap:14, alignItems:"flex-start" }}>
            <div style={{ width:28, height:28, borderRadius:"50%", background:`${T.accent}15`, border:`1px solid ${T.accent}30`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, fontSize:12, fontWeight:700, color:T.accent, fontFamily:FONT_MONO }}>{s.n}</div>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:14, fontWeight:600, color:T.text, marginBottom:4 }}>{s.title}</div>
              <div style={{ fontSize:12, color:T.textDim, lineHeight:1.6 }}>{s.desc}</div>
            </div>
            {s.cta && (
              <button onClick={() => onNavigate(s.page)}
                style={{ background:"transparent", border:`1px solid ${T.border}`, color:T.accent, borderRadius:5, padding:"6px 14px", fontSize:11, fontFamily:FONT_MONO, cursor:"pointer", flexShrink:0, whiteSpace:"nowrap" }}>
                {s.cta}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Simple Integration Setup Page ───────────────────────────────────────────
function SimpleIntegrationsPage({ onNavigate }) {
  const gatewayUrl = typeof BASE !== "undefined" && BASE.startsWith("http") ? BASE : window.location.origin;
  const [copied, setCopied] = useState(null);
  const [open, setOpen]     = useState({ sdk_openai: true, sdk_anthropic: false, sdk_env: false, manual_openai: false, manual_curl: false });
  const [section, setSection] = useState(null); // "sdk" | "gateway" | "platform" | null
  const [metrics, setMetrics] = useState({ agents: null, dependencies: null, workflows: null, platforms: null });
  const copy   = (id, text) => { navigator.clipboard.writeText(text).catch(() => {}); setCopied(id); setTimeout(() => setCopied(null), 2000); };
  const toggle = (k) => setOpen(o => ({ ...o, [k]: !o[k] }));

  useEffect(() => {
    Promise.allSettled([fetchAgentsSummary(), fetchRelationships()]).then(([agRes, relRes]) => {
      const ag   = agRes.status  === "fulfilled" ? agRes.value  : null;
      const rels = relRes.status === "fulfilled" ? relRes.value : [];
      const wfRels = (rels || []).filter(r => ["triggers_workflow", "uses_workflow"].includes(r.relationship_type));
      const platformCount = ag?.discovery_coverage ? Object.keys(ag.discovery_coverage).length : null;
      setMetrics({
        agents:       ag ? (ag.verified_agents?.total || 0) + (ag.potential_agents?.total || 0) : null,
        dependencies: Array.isArray(rels) ? rels.length : null,
        workflows:    new Set(wfRels.map(r => r.target_name)).size,
        platforms:    platformCount,
      });
    });
  }, []);

  // ── Discovery method cards ─────────────────────────────────────────────────
  const METHODS = [
    {
      id: "sdk",
      badge: "Recommended",
      badgeColor: "#34d399",
      title: "Connect AI Applications",
      customerDesc: "Best for production AI apps, copilots, and agents where you want the most accurate runtime identity.",
      benefits: [
        "Identify AI apps and agents",
        "Track owner, team, and environment",
        "Attribute cost and usage",
        "Map tools and dependencies",
      ],
      cta: "Install SDK →",
      color: "#34d399",
    },
    {
      id: "gateway",
      badge: null,
      title: "Route AI Traffic",
      customerDesc: "Best for getting quick visibility by routing OpenAI or Anthropic-compatible traffic through the gateway.",
      benefits: [
        "Discover active AI assets",
        "Capture usage and telemetry",
        "Apply budgets and policies",
        "Detect unknown runtime activity",
      ],
      cta: "Route Traffic →",
      color: T.info,
    },
    {
      id: "platform",
      badge: null,
      title: "Connect AI Ecosystem",
      customerDesc: "Best for finding potential AI assets and shadow AI activity across platforms like GitHub, n8n, Slack, Jira, ServiceNow, and MCP servers.",
      benefits: [
        "Detect potential AI assets",
        "Discover workflows and automations",
        "Surface unmanaged dependencies",
        "Send findings for validation",
      ],
      cta: "Connect Ecosystem →",
      color: T.purple,
    },
  ];

  // ── Flows ──────────────────────────────────────────────────────────────────
  const SDK_FLOW = [
    { label:"Create Organisation API Key", color:T.accent },
    { label:"Install SDK",                 color:"#34d399" },
    { label:"Wrap AI Client",              color:"#34d399" },
    { label:"Route Through Gateway",       color:T.warn   },
    { label:"Verified Agent Created",      color:T.yellow },
    { label:"Admin Claims Agent",          color:T.purple },
  ];
  const GW_FLOW = [
    { label:"Create Organisation API Key", color:T.accent },
    { label:"Route Traffic Through Gateway", color:T.warn },
    { label:"Gateway Derives Identity",    color:T.info   },
    { label:"Verified / Unassigned Agent Created", color:T.yellow },
    { label:"Admin Reviews Agent",         color:T.purple },
  ];
  const PLATFORM_FLOW = [
    { label:"Connect Platform",            color:T.info   },
    { label:"Scan for AI Signals",         color:T.warn   },
    { label:"Potential Agent Created",     color:T.yellow },
    { label:"Admin Validates or Rejects",  color:T.purple },
    { label:"Managed Agent",               color:T.accent },
  ];

  const GW_SIGNALS = [
    { label:"API Key Scope",       desc:"Key named after a service — no headers needed" },
    { label:"Framework Hints",     desc:"LangChain, CrewAI, AutoGen, n8n in User-Agent" },
    { label:"Request Origin",      desc:"Meaningful hostname or service label" },
    { label:"Provider Metadata",   desc:"User-Agent and client library name" },
    { label:"Stable Fingerprint",  desc:"Hash of org + key + origin — flags for review" },
  ];

  const PLATFORMS = [
    "GitHub", "n8n", "Slack", "Jira", "ServiceNow",
    "Cloud Functions", "MCP Servers", "Azure DevOps", "Zapier",
    "Copilot Studio", "Bedrock Agents", "OpenAI Agents SDK",
  ];

  const OPT_HEADERS = [
    { name:"X-Agent-Name",        desc:"Override auto-detected agent name",    example:"soc-investigation-agent" },
    { name:"X-Agent-Team",        desc:"Team or department",                   example:"Security" },
    { name:"X-Agent-Owner",       desc:"Owner email or name",                  example:"alice@acme.com" },
    { name:"X-Agent-Environment", desc:"prod / staging / dev",                 example:"prod" },
    { name:"X-Agent-Version",     desc:"Version tag",                          example:"v1.2.0" },
    { name:"X-Agent-Source",      desc:"Set by SDK automatically (sdk-python)",example:"sdk-python" },
  ];

  const snippets = {
    sdk_openai:
`pip install ai-agent-inventory-sdk

from ai_agent_inventory import OpenAI

# Option A: explicit params
client = OpenAI(
    api_key="org_gateway_key",
    gateway_url="GATEWAY_URL/v1",
    agent_name="soc-investigation-agent",
    team="Security",
    environment="prod",
    debug=True,          # prints attached headers on first call
)

# Option B: zero-code env-var setup
# SERVICE_NAME=soc-investigation-agent  TEAM=Security  ENVIRONMENT=prod
client = OpenAI(api_key="org_gateway_key", gateway_url="GATEWAY_URL/v1")

response = client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[{"role": "user", "content": "Analyze this alert"}],
)

# Per-request override — X-Agent-Name in extra_headers wins over SDK default
response = client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[{"role": "user", "content": "Investigate phishing"}],
    extra_headers={"X-Agent-Name": "phishing-investigation-agent"},
)`,

    sdk_anthropic:
`pip install ai-agent-inventory-sdk anthropic

from ai_agent_inventory import Anthropic

client = Anthropic(
    api_key="org_gateway_key",
    gateway_url="GATEWAY_URL",   # no /v1 — Anthropic SDK adds the path
    agent_name="document-summariser",
    team="Legal",
    environment="prod",
)

response = client.messages.create(
    model="claude-haiku-4-5-20251001",
    max_tokens=1024,
    messages=[{"role": "user", "content": "Summarise this contract"}],
)`,

    sdk_env:
`# Zero-code setup: set these env vars before starting your service.
SERVICE_NAME=soc-investigation-agent
TEAM=Security
ENVIRONMENT=prod
APP_VERSION=1.2.0

# SDK reads them automatically:
pip install ai-agent-inventory-sdk
from ai_agent_inventory import OpenAI
client = OpenAI(api_key="org_gateway_key", gateway_url="GATEWAY_URL/v1")

# For LangChain / CrewAI / custom httpx clients:
import httpx
from ai_agent_inventory import wrap_httpx_client

http = wrap_httpx_client(httpx.Client(), agent_name="langchain-rag-agent", team="DataEng")
# Pass to: ChatOpenAI(http_client=http, openai_api_base="GATEWAY_URL/v1", openai_api_key="org_gateway_key")`,

    manual_openai:
`# Advanced override — use when you need per-request control without the SDK.
import openai

client = openai.OpenAI(base_url="GATEWAY_URL/v1", api_key="gk-...")

client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[{"role": "user", "content": "Hello"}],
    extra_headers={
        "X-Agent-Name":        "soc-investigation-agent",
        "X-Agent-Team":        "Security",
        "X-Agent-Environment": "prod",
    },
)`,

    manual_curl:
`# Advanced override — minimal curl example.
curl GATEWAY_URL/v1/chat/completions \\
  -H "Authorization: Bearer gk-..." \\
  -H "X-Agent-Name: soc-investigation-agent" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"Hello"}]}'`,
  };

  const resolvedSnippets = Object.fromEntries(
    Object.entries(snippets).map(([k, v]) => [k, v.replace(/GATEWAY_URL/g, gatewayUrl)])
  );

  // ── Small helpers ──────────────────────────────────────────────────────────
  const AccuracyDot = ({ label, color }) => (
    <span style={{ display:"inline-flex", alignItems:"center", gap:5 }}>
      <span style={{ width:7, height:7, borderRadius:"50%", background:color, flexShrink:0 }} />
      <span style={{ fontSize:11, color, fontFamily:FONT_MONO }}>{label}</span>
    </span>
  );

  const FlowColumn = ({ steps }) => (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-start", gap:0 }}>
      {steps.map((s, i) => (
        <div key={i} style={{ display:"flex", flexDirection:"column", alignItems:"flex-start" }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <div style={{ width:8, height:8, borderRadius:"50%", background:s.color, flexShrink:0 }} />
            <span style={{ fontSize:12, color:T.text }}>{s.label}</span>
          </div>
          {i < steps.length - 1 && (
            <div style={{ width:1, height:16, background:T.border, marginLeft:3 }} />
          )}
        </div>
      ))}
    </div>
  );

  const SectionHeader = ({ id, label, badge, color }) => (
    <div
      onClick={() => setSection(s => s === id ? null : id)}
      style={{ display:"flex", alignItems:"center", gap:10, cursor:"pointer", userSelect:"none", marginBottom: section === id ? 20 : 0 }}
    >
      <div style={{ width:3, height:20, borderRadius:2, background:color }} />
      <div style={{ fontSize:15, fontWeight:700, color:T.text }}>{label}</div>
      {badge && (
        <span style={{ background:`${color}18`, color, border:`1px solid ${color}44`, fontSize:10, fontFamily:FONT_MONO, padding:"2px 8px", borderRadius:3, textTransform:"uppercase", letterSpacing:"0.08em" }}>{badge}</span>
      )}
      <div style={{ flex:1 }} />
      <span style={{ color:T.textMute, fontSize:11, fontFamily:FONT_MONO }}>{section === id ? "▲ collapse" : "▼ expand"}</span>
    </div>
  );

  const fmtMetric = (v) => v === null ? "—" : String(v);

  return (
    <div style={{ maxWidth:900, margin:"0 auto", padding:"32px 24px", fontFamily:FONT_UI }}>

      {/* ── Page header ── */}
      <div style={{ marginBottom:28 }}>
        <div style={{ fontSize:11, fontFamily:FONT_MONO, color:T.textMute, letterSpacing:"0.12em", textTransform:"uppercase", marginBottom:6 }}>Administration · Setup</div>
        <div style={{ fontSize:24, fontWeight:700, color:T.text, marginBottom:10, lineHeight:1.2 }}>Build Your AI Operations Record</div>
        <div style={{ fontSize:13, color:T.textDim, lineHeight:1.7, maxWidth:660, marginBottom:18 }}>
          Discover AI assets, map runtime dependencies, and understand how AI is operating across your organization.
        </div>
        <div style={{ background:T.panel, border:`1px solid ${T.border}`, borderRadius:8, padding:"14px 18px" }}>
          <div style={{ fontSize:11, fontFamily:FONT_MONO, color:T.textMute, textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:10 }}>Your AI Operations Record includes</div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"4px 24px" }}>
            {[
              "AI agents and copilots",
              "AI applications and services",
              "Workflows and automations",
              "MCP tools and external systems",
              "Runtime relationships between them",
            ].map(item => (
              <div key={item} style={{ display:"flex", alignItems:"center", gap:7, fontSize:12, color:T.textDim, lineHeight:1.6 }}>
                <span style={{ width:4, height:4, borderRadius:"50%", background:T.accent, flexShrink:0 }} />{item}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Your AI Operations Record summary panel ── */}
      <div style={{ background:T.panel, border:`1px solid ${T.border}`, borderRadius:10, padding:"18px 24px", marginBottom:32 }}>
        <div style={{ fontSize:11, fontFamily:FONT_MONO, color:T.textMute, textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:14 }}>Your AI Operations Record</div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:0 }}>
          {[
            { label:"AI Assets",         value:fmtMetric(metrics.agents),       color:T.accent },
            { label:"Dependencies",       value:fmtMetric(metrics.dependencies), color:"#5BD9C5" },
            { label:"Workflows",          value:fmtMetric(metrics.workflows),    color:T.warn },
            { label:"Discovery Sources",  value:fmtMetric(metrics.platforms),    color:T.info },
          ].map((m, i) => (
            <div key={m.label} style={{ padding:"0 20px 0 0", borderRight: i < 3 ? `1px solid ${T.border}` : "none", marginRight: i < 3 ? 20 : 0 }}>
              <div style={{ fontSize:26, fontWeight:700, color:m.color, fontFamily:FONT_MONO, letterSpacing:"-0.02em", lineHeight:1 }}>{m.value}</div>
              <div style={{ fontSize:11, color:T.textMute, marginTop:5 }}>{m.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Three method cards ── */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:16, marginBottom:28 }}>
        {METHODS.map(m => (
          <div key={m.id} style={{ background:T.panel, border:`1px solid ${section === m.id ? m.color+"66" : T.border}`, borderRadius:10, padding:"22px 18px", display:"flex", flexDirection:"column", gap:14, transition:"border-color 0.15s", cursor:"default" }}>
            <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:8 }}>
              <div style={{ fontSize:14, fontWeight:700, color:T.text, lineHeight:1.3 }}>{m.title}</div>
              {m.badge && (
                <span style={{ background:`${m.color}18`, color:m.color, border:`1px solid ${m.color}44`, fontSize:9, fontFamily:FONT_MONO, padding:"2px 8px", borderRadius:3, textTransform:"uppercase", letterSpacing:"0.1em", flexShrink:0 }}>{m.badge}</span>
              )}
            </div>

            <div style={{ fontSize:12, color:T.textDim, lineHeight:1.7 }}>{m.customerDesc}</div>

            <ul style={{ margin:0, padding:"0 0 0 14px", display:"flex", flexDirection:"column", gap:5 }}>
              {m.benefits.map(b => (
                <li key={b} style={{ fontSize:11, color:T.textDim, lineHeight:1.5 }}>{b}</li>
              ))}
            </ul>

            <button
              onClick={() => setSection(s => s === m.id ? null : m.id)}
              style={{ marginTop:"auto", background:`${m.color}14`, border:`1px solid ${m.color}44`, color:m.color, borderRadius:6, padding:"8px 14px", fontSize:12, fontFamily:FONT_MONO, cursor:"pointer", fontWeight:600, textAlign:"center" }}
            >
              {section === m.id ? "▲ Collapse" : m.cta}
            </button>
          </div>
        ))}
      </div>

      {/* ── SDK Runtime Discovery ── */}
      <div style={{ border:`1px solid ${section === "sdk" ? "#34d39944" : T.border}`, borderRadius:10, padding:"20px 24px", marginBottom:16, transition:"border-color 0.15s" }}>
        <SectionHeader id="sdk" label="SDK — Technical Setup" badge="Recommended" color="#34d399" />

        {section === "sdk" && (
          <div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:24, marginBottom:24 }}>
              <div>
                <div style={{ fontSize:12, color:T.textDim, lineHeight:1.7, marginBottom:16 }}>
                  The SDK automatically collects runtime context such as service name, environment, version, and framework metadata.
                  This improves discovery accuracy and reduces manual configuration.
                  The gateway automatically creates a verified agent record and enriches it with runtime metadata collected by the SDK.
                </div>
                <FlowColumn steps={SDK_FLOW} />
              </div>
              <div>
                <div style={{ fontSize:11, fontFamily:FONT_MONO, color:T.textMute, textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:10 }}>What the SDK collects</div>
                {[
                  ["SERVICE_NAME / APP_NAME", "Agent identity (env var or explicit param)"],
                  ["ENVIRONMENT / ENV",        "prod / staging / dev"],
                  ["TEAM",                     "Owning team"],
                  ["APP_VERSION",              "Version tag"],
                  ["Hostname",                 "Stored as metadata only — not used as name"],
                  ["Python version",           "Runtime metadata"],
                ].map(([k, v]) => (
                  <div key={k} style={{ display:"flex", gap:8, padding:"5px 0", borderBottom:`1px solid ${T.border}`, fontSize:12 }}>
                    <code style={{ fontFamily:FONT_MONO, color:"#34d399", fontSize:11, minWidth:180, flexShrink:0 }}>{k}</code>
                    <span style={{ color:T.textDim }}>{v}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* SDK code examples */}
            <div style={{ fontSize:11, fontFamily:FONT_MONO, color:T.textMute, textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:10 }}>SDK Examples</div>
            <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:20 }}>
              {[
                { key:"sdk_openai",    label:"Python · OpenAI SDK" },
                { key:"sdk_anthropic", label:"Python · Anthropic SDK" },
                { key:"sdk_env",       label:"Env-var · httpx · LangChain" },
              ].map(({ key, label }) => (
                <div key={key} style={{ border:`1px solid ${open[key] ? "#34d39944" : T.border}`, borderRadius:8, overflow:"hidden" }}>
                  <button onClick={() => toggle(key)}
                    style={{ width:"100%", background:open[key] ? T.panelHi : T.panel, border:"none", padding:"11px 16px", display:"flex", alignItems:"center", gap:12, cursor:"pointer", textAlign:"left" }}>
                    <span style={{ width:7, height:7, borderRadius:"50%", background:"#34d399", flexShrink:0 }} />
                    <span style={{ fontSize:12, fontFamily:FONT_MONO, color:open[key] ? T.text : T.textDim, flex:1 }}>{label}</span>
                    <span style={{ fontSize:11, fontFamily:FONT_MONO, color:T.textMute }}>{open[key] ? "▲ close" : "▼ open"}</span>
                  </button>
                  {open[key] && (
                    <div style={{ position:"relative", borderTop:`1px solid ${T.border}` }}>
                      <pre style={{ margin:0, padding:"16px", fontSize:12, fontFamily:FONT_MONO, color:T.text, lineHeight:1.7, overflow:"auto", background:T.bg, maxHeight:380 }}>{resolvedSnippets[key]}</pre>
                      <button onClick={() => copy(key, resolvedSnippets[key])}
                        style={{ position:"absolute", top:8, right:8, background:"transparent", border:`1px solid ${T.border}`, color:copied===key?"#34d399":T.textMute, borderRadius:4, padding:"3px 10px", fontSize:10, fontFamily:FONT_MONO, cursor:"pointer" }}>
                        {copied===key?"copied":"copy"}
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Advanced override */}
            <div style={{ background:`${T.warn}08`, border:`1px solid ${T.warn}22`, borderRadius:8, padding:"12px 16px", marginBottom:8 }}>
              <div style={{ fontSize:11, fontFamily:FONT_MONO, color:T.warn, textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:8 }}>Advanced Override — Manual Headers</div>
              <div style={{ fontSize:12, color:T.textDim, marginBottom:12, lineHeight:1.65 }}>
                Use manual headers when you need per-request control or cannot install the SDK.
                All existing X-Agent-* and X-Guard-* headers remain supported.
              </div>
              <div style={{ display:"flex", flexDirection:"column", gap:6, marginBottom:12 }}>
                {[
                  { key:"manual_openai", label:"Manual headers · OpenAI" },
                  { key:"manual_curl",   label:"Manual headers · cURL" },
                ].map(({ key, label }) => (
                  <div key={key} style={{ border:`1px solid ${T.border}`, borderRadius:6, overflow:"hidden" }}>
                    <button onClick={() => toggle(key)}
                      style={{ width:"100%", background:T.panel, border:"none", padding:"9px 14px", display:"flex", alignItems:"center", gap:10, cursor:"pointer", textAlign:"left" }}>
                      <span style={{ fontSize:12, fontFamily:FONT_MONO, color:T.textDim, flex:1 }}>{label}</span>
                      <span style={{ fontSize:11, fontFamily:FONT_MONO, color:T.textMute }}>{open[key] ? "▲ close" : "▼ open"}</span>
                    </button>
                    {open[key] && (
                      <div style={{ position:"relative", borderTop:`1px solid ${T.border}` }}>
                        <pre style={{ margin:0, padding:"14px", fontSize:12, fontFamily:FONT_MONO, color:T.text, lineHeight:1.7, overflow:"auto", background:T.bg, maxHeight:280 }}>{resolvedSnippets[key]}</pre>
                        <button onClick={() => copy(key, resolvedSnippets[key])}
                          style={{ position:"absolute", top:8, right:8, background:"transparent", border:`1px solid ${T.border}`, color:copied===key?T.accent:T.textMute, borderRadius:4, padding:"3px 10px", fontSize:10, fontFamily:FONT_MONO, cursor:"pointer" }}>
                          {copied===key?"copied":"copy"}
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <div style={{ background:T.panel, border:`1px solid ${T.border}`, borderRadius:6, overflow:"hidden" }}>
                <table style={{ width:"100%", borderCollapse:"collapse" }}>
                  <thead>
                    <tr style={{ background:T.panelHi }}>
                      {["Header","Description","Example"].map(h => (
                        <th key={h} style={{ padding:"7px 12px", textAlign:"left", fontSize:10, fontFamily:FONT_MONO, color:T.textMute, letterSpacing:"0.1em", textTransform:"uppercase", borderBottom:`1px solid ${T.border}` }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {OPT_HEADERS.map((row, i) => (
                      <tr key={row.name} style={{ background: i % 2 === 0 ? T.panel : T.bg }}>
                        <td style={{ padding:"7px 12px", borderBottom:`1px solid ${T.border}` }}>
                          <code style={{ fontSize:11, fontFamily:FONT_MONO, color:T.textDim }}>{row.name}</code>
                        </td>
                        <td style={{ padding:"7px 12px", borderBottom:`1px solid ${T.border}`, fontSize:11, color:T.textDim }}>{row.desc}</td>
                        <td style={{ padding:"7px 12px", borderBottom:`1px solid ${T.border}` }}>
                          <code style={{ fontSize:11, fontFamily:FONT_MONO, color:T.textMute }}>{row.example}</code>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Gateway Discovery ── */}
      <div style={{ border:`1px solid ${section === "gateway" ? T.info+"55" : T.border}`, borderRadius:10, padding:"20px 24px", marginBottom:16, transition:"border-color 0.15s" }}>
        <SectionHeader id="gateway" label="Gateway — Technical Setup" color={T.info} />

        {section === "gateway" && (
          <div>
            <div style={{ fontSize:12, color:T.textDim, lineHeight:1.7, marginBottom:20 }}>
              No SDK required. Simply point your AI client's base URL at the gateway. The gateway analyses every request and derives agent identity from available signals.
              Agents are created as <strong style={{ color:T.text }}>Verified · Unassigned</strong> and appear in the Discovery Center for admin review.
            </div>

            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:24, marginBottom:20 }}>
              <div>
                <div style={{ fontSize:11, fontFamily:FONT_MONO, color:T.textMute, textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:10 }}>Setup Flow</div>
                <FlowColumn steps={GW_FLOW} />
              </div>
              <div>
                <div style={{ fontSize:11, fontFamily:FONT_MONO, color:T.textMute, textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:10 }}>Identity Signals (in priority order)</div>
                {GW_SIGNALS.map((s, i) => (
                  <div key={i} style={{ display:"flex", gap:8, padding:"6px 0", borderBottom:`1px solid ${T.border}`, fontSize:12 }}>
                    <span style={{ color:T.textMute, fontFamily:FONT_MONO, fontSize:11, minWidth:16, flexShrink:0 }}>{i+1}.</span>
                    <div>
                      <span style={{ color:T.text, fontWeight:600 }}>{s.label}</span>
                      <span style={{ color:T.textDim, marginLeft:8 }}>{s.desc}</span>
                    </div>
                  </div>
                ))}
                <div style={{ marginTop:12, fontSize:12, color:T.textDim, lineHeight:1.6 }}>
                  If no signal is reliable, the gateway creates{" "}
                  <code style={{ fontFamily:FONT_MONO, color:T.warn, fontSize:11 }}>unknown-agent-&#123;hash&#125;</code>{" "}
                  with status <strong style={{ color:T.text }}>Needs Review</strong>.
                </div>
              </div>
            </div>

            <div style={{ background:T.panelHi, border:`1px solid ${T.border}`, borderRadius:8, padding:"12px 16px" }}>
              <div style={{ fontSize:12, color:T.textDim, lineHeight:1.65 }}>
                <strong style={{ color:T.text }}>Minimum setup:</strong> change{" "}
                <code style={{ fontFamily:FONT_MONO, color:T.info, fontSize:11 }}>base_url</code> to{" "}
                <code style={{ fontFamily:FONT_MONO, color:T.accent, fontSize:11 }}>{gatewayUrl}/v1</code>{" "}
                and use your organisation API key. That's all that's required. The gateway handles the rest.
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Platform / Ecosystem Discovery ── */}
      <div style={{ border:`1px solid ${section === "platform" ? T.purple+"55" : T.border}`, borderRadius:10, padding:"20px 24px", marginBottom:16, transition:"border-color 0.15s" }}>
        <SectionHeader id="platform" label="Ecosystem — Technical Setup" color={T.purple} />

        {section === "platform" && (
          <div>
            <div style={{ fontSize:12, color:T.textDim, lineHeight:1.7, marginBottom:20 }}>
              Platform discovery identifies AI-related signals outside the gateway.
              These are created as <strong style={{ color:T.text }}>potential agents</strong> and require admin validation before becoming managed inventory.
              Use this method to detect shadow AI and unmanaged workloads across your organisation.
            </div>

            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:24, marginBottom:20 }}>
              <div>
                <div style={{ fontSize:11, fontFamily:FONT_MONO, color:T.textMute, textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:10 }}>Discovery Flow</div>
                <FlowColumn steps={PLATFORM_FLOW} />

                <div style={{ marginTop:16, background:`${T.purple}0d`, border:`1px solid ${T.purple}33`, borderRadius:8, padding:"10px 14px" }}>
                  <div style={{ fontSize:11, color:T.purple, fontFamily:FONT_MONO, marginBottom:4 }}>Verified vs Potential</div>
                  <div style={{ fontSize:12, color:T.textDim, lineHeight:1.6 }}>
                    <strong style={{ color:T.text }}>Verified</strong> — came through gateway (SDK or direct routing)<br/>
                    <strong style={{ color:T.text }}>Potential</strong> — discovered from platform scan, no gateway traffic seen yet
                  </div>
                </div>
              </div>

              <div>
                <div style={{ fontSize:11, fontFamily:FONT_MONO, color:T.textMute, textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:10 }}>Supported Platforms</div>
                <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                  {PLATFORMS.map(p => (
                    <span key={p} style={{ background:T.panelHi, border:`1px solid ${T.border}`, color:T.textDim, fontSize:11, fontFamily:FONT_MONO, padding:"3px 10px", borderRadius:4 }}>{p}</span>
                  ))}
                </div>
                <div style={{ marginTop:14, fontSize:12, color:T.textDim, lineHeight:1.65 }}>
                  Platform integrations scan for AI API usage patterns, environment variables referencing AI providers, workflow nodes, and SDK dependencies — without requiring agent code changes.
                </div>
              </div>
            </div>

            <button onClick={() => onNavigate("ecosystem")}
              style={{ background:`${T.purple}14`, border:`1px solid ${T.purple}44`, color:T.purple, borderRadius:6, padding:"8px 18px", fontSize:12, fontFamily:FONT_MONO, cursor:"pointer", fontWeight:600 }}>
              View Connected Platforms →
            </button>
          </div>
        )}
      </div>

      {/* ── Recommended onboarding path ── */}
      <div style={{ background:T.panel, border:`1px solid ${T.border}`, borderRadius:10, padding:"22px 28px", marginTop:24 }}>
        <div style={{ fontSize:14, fontWeight:700, color:T.text, marginBottom:14 }}>Recommended onboarding path</div>
        <div style={{ display:"flex", flexDirection:"column", gap:10, marginBottom:16 }}>
          {[
            { n:"1", text:"Route traffic first to see active AI usage." },
            { n:"2", text:"Add SDK metadata for stronger identity and ownership." },
            { n:"3", text:"Connect ecosystem sources to find shadow AI and potential assets." },
            { n:"4", text:"Review and classify discovered records." },
          ].map(({ n, text }) => (
            <div key={n} style={{ display:"flex", gap:12, alignItems:"flex-start" }}>
              <div style={{ width:20, height:20, borderRadius:"50%", background:T.panelHi, border:`1px solid ${T.border}`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, marginTop:1 }}>
                <span style={{ fontSize:10, fontFamily:FONT_MONO, color:T.accent, fontWeight:700 }}>{n}</span>
              </div>
              <span style={{ fontSize:12, color:T.textDim, lineHeight:1.6, paddingTop:2 }}>{text}</span>
            </div>
          ))}
        </div>
        <div style={{ padding:"10px 14px", background:`${T.info}0d`, border:`1px solid ${T.info}33`, borderRadius:6, fontSize:12, color:T.textDim, lineHeight:1.65 }}>
          Some records are <strong style={{ color:T.text }}>verified runtime assets</strong>. Others are <strong style={{ color:T.text }}>potential dependencies or ecosystem signals</strong> that require validation.
        </div>
        <div style={{ display:"flex", gap:8, marginTop:14 }}>
          <button onClick={() => setSection(s => s === "gateway" ? null : "gateway")}
            style={{ background:`${T.info}14`, border:`1px solid ${T.info}44`, color:T.info, borderRadius:6, padding:"8px 16px", fontSize:12, fontFamily:FONT_MONO, cursor:"pointer", fontWeight:600 }}>
            Route Traffic →
          </button>
          <button onClick={() => onNavigate("agent_inventory")}
            style={{ background:"transparent", border:`1px solid ${T.border}`, color:T.textDim, borderRadius:6, padding:"8px 16px", fontSize:12, fontFamily:FONT_MONO, cursor:"pointer" }}>
            View Inventory
          </button>
          <button onClick={() => onNavigate("relationship_map")}
            style={{ background:"transparent", border:`1px solid ${T.border}`, color:T.textDim, borderRadius:6, padding:"8px 16px", fontSize:12, fontFamily:FONT_MONO, cursor:"pointer" }}>
            View Dependency Map
          </button>
        </div>
      </div>

    </div>
  );
}

// ─── Nav ──────────────────────────────────────────────────────────────────────
// PAGES: flat list for canAccess checks + header label lookup (includes legacy)
const PAGES = [
  { id:"dashboard",      label:"Dashboard" },
  { id:"welcome",        label:"Platform Guide" },
  { id:"agent_inventory",label:"AI Agent Inventory" },
  { id:"discovery",      label:"Discovery Center" },
  { id:"governance",     label:"Governance Center" },
  { id:"cost",           label:"Cost Intelligence" },
  { id:"security_intel", label:"Security Intelligence" },
  { id:"ecosystem",        label:"Ecosystem Discovery" },
  { id:"relationship_map", label:"Runtime Dependency Map" },
  { id:"budgets",          label:"Budgets" },
  { id:"pricing",        label:"Pricing Registry" },
  { id:"security",       label:"Security & Audit" },
  { id:"users",          label:"Users" },
  { id:"apikeys",        label:"API Keys" },
  { id:"settings",       label:"Settings" },
  // Legacy pages (not in primary nav but still routable)
  { id:"home",           label:"Home" },
  { id:"overview",       label:"Overview" },
  { id:"agents",         label:"Agent Activity" },
  { id:"models",         label:"Model Usage" },
  { id:"workflows",      label:"Workflow Health" },
  { id:"alerts",         label:"Alerts" },
  { id:"assets",         label:"Asset Inventory" },
  { id:"chat",           label:"Chat" },
  { id:"integrations",   label:"Setup" },
  { id:"onboarding",     label:"Setup Guide" },
];

// NAV_GROUPS: sidebar rendering — only primary navigation, grouped by section
const NAV_GROUPS = [
  {
    label: null,
    items: [
      { id: "dashboard", label: "Dashboard" },
      { id: "welcome",   label: "Platform Guide" },
    ],
  },
  {
    label: "INVENTORY",
    items: [
      { id: "agent_inventory",  label: "Agents" },
      { id: "discovery",        label: "Discovery Center" },
      { id: "governance",       label: "Governance Center" },
      { id: "relationship_map", label: "Dependency Map" },
    ],
  },
  {
    label: "INTELLIGENCE",
    items: [
      { id: "cost",          label: "Cost Intelligence" },
      { id: "security_intel",label: "Security Intelligence" },
      { id: "ecosystem",     label: "Ecosystem Discovery" },
    ],
  },
  {
    label: "ADMINISTRATION",
    items: [
      { id: "budgets",      label: "Budgets" },
      { id: "pricing",      label: "Pricing Registry" },
      { id: "security",     label: "Security & Audit" },
      { id: "users",        label: "Users" },
      { id: "apikeys",      label: "API Keys" },
      { id: "integrations", label: "Setup" },
      { id: "settings",     label: "Settings" },
    ],
  },
];

// ─── Root ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [page, setPage]       = useState("dashboard");
  const [discoveryInitialTab, setDiscoveryInitialTab] = useState("verified");
  const [filters, setFilters] = useState({ team:"all", model:"all", agent:"all", sev:"all", range:30 });

  // ── Real JWT auth ──
  const [user,         setUser]         = useState(null);
  const [authChecked,  setAuthChecked]  = useState(false);
  // rolesMap: null until server roles are fetched — gates rendering so the
  // init window never falls back to stale hardcoded permissions.
  const [rolesMap,     setRolesMap]     = useState(null);

  // ── Platform admin org switching ──
  const [viewOrgId,  setViewOrgId]  = useState(() => getViewOrg());
  const [allOrgs,    setAllOrgs]    = useState([]);

  // When the logged-in user has a team-scoped role, lock the team filter to their team.
  // Runs whenever user or rolesMap changes (e.g. after login).
  useEffect(() => {
    if (!user || !rolesMap) return;
    const isTeamScoped = !!(rolesMap[user.role]?.team_scoped);
    if (isTeamScoped && user.team) {
      const teamId = `live_team_${user.team.replace(/\s+/g, "_").toLowerCase()}`;
      setFilters(f => f.team === teamId ? f : { ...f, team: teamId });
    }
  }, [user, rolesMap]);

  // Fetch all orgs when logged in as platform admin; retry up to 3× if empty
  useEffect(() => {
    if (!user?.is_platform_admin) return;
    let cancelled = false;
    const load = (attempt = 0) => {
      fetchOrganizations().then(orgs => {
        if (cancelled) return;
        if (orgs.length > 0) { setAllOrgs(orgs); return; }
        if (attempt < 3) setTimeout(() => load(attempt + 1), 1500);
      }).catch(() => {
        if (!cancelled && attempt < 3) setTimeout(() => load(attempt + 1), 1500);
      });
    };
    load();
    return () => { cancelled = true; };
  }, [user]);

  // On mount, validate stored token; also listen for mid-session expiry
  useEffect(() => {
    const check = async () => {
      const token = getToken();
      if (token) {
        try {
          // Both arms raced against 5s timeouts — a server that accepts the TCP
          // connection but never responds can't hold the spinner open forever.
          // Both race arms always resolve (never reject), so Promise.all can only
          // fail if something else throws, which the outer catch covers.
          const withTimeout = (p, ms) => Promise.race([p, new Promise(r => setTimeout(() => r(null), ms))]);
          const [me, serverRoles] = await Promise.all([
            withTimeout(fetchMe().catch(() => null), 5000),
            withTimeout(fetchRoles().catch(() => null), 5000),
          ]);
          if (me) {
            setUser(me);
            const map = serverRoles?.length
              ? Object.fromEntries(serverRoles.map(r => [r.name, r]))
              : Object.fromEntries(Object.entries(ROLES).map(([k,v]) => [k, {name:k, ...v, pages: v.pages ?? [], can: v.can ?? []}]));
            setRolesMap(map);  // always set (even empty) so the init gate clears
          } else {
            setToken(null);
            setRolesMap({});  // no user → empty roles map, show login page
          }
        } catch {
          setToken(null);
          setRolesMap({});
        }
      } else {
        setRolesMap({});  // no token → set empty roles, unblock the login screen
      }
      setAuthChecked(true);
    };
    check();

    const onExpired = () => { setToken(null); setUser(null); };
    window.addEventListener('auth:expired', onExpired);
    return () => window.removeEventListener('auth:expired', onExpired);
  }, []);

  const handleLogin = async (u) => {
    setUser(u);
    try {
      const serverRoles = await fetchRoles();
      const map = serverRoles?.length
        ? Object.fromEntries(serverRoles.map(r => [r.name, r]))
        : Object.fromEntries(Object.entries(ROLES).map(([k,v]) => [k, {name:k, ...v, pages: v.pages ?? [], can: v.can ?? []}]));
      setRolesMap(map);
    } catch {
      setRolesMap(Object.fromEntries(Object.entries(ROLES).map(([k,v]) => [k, {name:k, ...v, pages: v.pages ?? [], can: v.can ?? []}])));
    }
  };

  const handleLogout = () => {
    setToken(null);
    setUser(null);
  };

  const { apiRecords, serverTeams, serverAlerts, lastRefresh, isLive, demoMode, setDemoModeState, refresh } = useLiveData(30_000);

  const handleToggleDemoMode = useCallback(async () => {
    const next = !demoMode;
    try {
      await setDemoMode(next);
      setDemoModeState(next);
      refresh();
    } catch (e) {
      console.error("Failed to toggle demo mode", e);
    }
  }, [demoMode, setDemoModeState, refresh]);

  // Platform guard mode badge (best-effort — silent if unauthenticated)
  const [platformMode,       setPlatformMode]       = useState(null);
  const [pricingLastUpdated, setPricingLastUpdated] = useState(null);
  useEffect(() => {
    if (!user) return;
    fetchHealth().then(h => {
      setPlatformMode(h?.platform_mode);
      setPricingLastUpdated(h?.pricing_last_updated || null);
    }).catch(() => {});
  }, [user]);

  // Build event list and metadata from live data or demo fallback.
  // serverTeams (from /teams) always includes every registered team even if it
  // has no telemetry yet, so new teams appear in the filter dropdown immediately.
  const { allEvents, allTeams, allAgents } = useMemo(() => {
    if (apiRecords === null) return { allEvents: [], allTeams: TEAMS, allAgents: AGENTS }; // still loading
    if (apiRecords.length === 0) {
      // No live data — use demo, but still surface any server-registered teams
      const extraTeams = serverTeams.map(t => ({ id: `live_team_${t.name.replace(/\s+/g,"_").toLowerCase()}`, org: "org_live", name: t.name }));
      const merged = extraTeams.length > 0 ? extraTeams : TEAMS;
      return { allEvents: genDemoEvents(), allTeams: merged, allAgents: AGENTS };
    }
    const { liveTeams, liveAgents } = buildLiveMetadata(apiRecords);
    // Merge server-registered teams (no telemetry yet) into the dropdown list
    const liveTeamNames = new Set(liveTeams.map(t => t.name));
    const extraTeams = serverTeams
      .filter(t => !liveTeamNames.has(t.name))
      .map(t => ({ id: `live_team_${t.name.replace(/\s+/g,"_").toLowerCase()}`, org: "org_live", name: t.name }));
    return {
      allEvents:  apiRecords.map(apiRecordToEvent),
      allTeams:   [...liveTeams, ...extraTeams],
      allAgents:  liveAgents,
    };
  }, [apiRecords, serverTeams]);

  const filteredEvents = useMemo(() => applyFilters(allEvents, filters), [allEvents, filters]);
  const A       = useMemo(() => agg(filteredEvents),               [filteredEvents]);
  const alerts  = useMemo(() => {
    const detected = runDetections(filteredEvents);
    // Patch timestamps from server-stored security alerts (which have the exact
    // time the backend first persisted each alert) so "X ago" reflects reality.
    if (serverAlerts.length === 0) return detected;
    const serverTsByType = {};
    serverAlerts.forEach(sa => {
      const t = parseUTC(sa.ts).getTime();
      if (!serverTsByType[sa.type] || t > serverTsByType[sa.type]) {
        serverTsByType[sa.type] = t;
      }
    });
    return detected.map(a => serverTsByType[a.type] ? { ...a, ts: serverTsByType[a.type] } : a);
  }, [filteredEvents, serverAlerts]);
  const savings = useMemo(() => estimateSavings(filteredEvents),   [filteredEvents]);
  const risk    = useMemo(() => computeRiskScore(filteredEvents, alerts), [filteredEvents, alerts]);
  const critCount = alerts.filter((a)=>a.sev==="critical").length;

  // Props passed down so page components use the right metadata
  const pageProps = { events: filteredEvents, allTeams, allAgents, A, alerts, savings, risk };

  const renderPage = () => {
    if (!canAccess(user?.role, page, rolesMap)) {
      return (
        <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", height:300, gap:12, color:T.textMute, fontFamily:FONT_MONO }}>
          <div style={{ fontSize:24, color:T.crit }}>⊘</div>
          <div style={{ fontSize:14 }}>Access denied — <strong style={{ color:T.warn }}>{rolesMap[user?.role]?.label}</strong> role cannot view this page</div>
        </div>
      );
    }
    switch (page) {
      // ── New primary pages ───────────────────────────────────────────────
      case "dashboard":      return <ExecutiveDashboard onNavigate={setPage} />;
      case "welcome":        return <CustomerWelcomePage onNavigate={setPage} />;
      case "agent_inventory":return <AgentInventory isAdmin={user?.role === "admin"} onNavigate={(pg, opts={}) => { if (opts.discoveryTab) setDiscoveryInitialTab(opts.discoveryTab); setPage(pg); }} />;
      case "discovery":      return <DiscoveryCenter initialTab={discoveryInitialTab} />;
      case "governance":     return <GovernanceCenter />;
      case "security_intel": return <SecurityIntelligence />;
      case "ecosystem":        return <EcosystemDiscovery />;
      case "relationship_map": return <RelationshipMap />;
      // ── Existing pages (unchanged) ──────────────────────────────────────
      case "cost":      return <CostIntelligence />;
      case "pricing":   return <PricingRegistry />;
      case "budgets":   return <BudgetsPage />;
      case "security":  return <SecurityPage />;
      case "users":     return <UsersPage />;
      case "apikeys":   return <ApiKeysPage />;
      case "settings":      return <SettingsPage />;
      // ── Legacy pages (still routable, removed from primary nav) ────────
      case "home":           return <Home onNavigate={setPage} />;
      case "chat":           return <ChatPage />;
      case "assets":    return <AssetsPage />;
      case "overview":  return <Overview  {...pageProps} />;
      case "agents":    return <AgentActivity {...pageProps} />;
      case "models":    return <ModelUsage A={A} />;
      case "workflows": return <WorkflowHealth {...pageProps} />;
      case "alerts":    return <AlertsPage alerts={alerts} sevFilter={filters.sev} />;
      case "integrations":  return <SimpleIntegrationsPage onNavigate={setPage} />;
      case "onboarding":    return <OnboardingPage onNavigate={setPage} />;
      default:              return null;
    }
  };

  if (!authChecked || apiRecords === null || rolesMap === null) {
    return <div style={{ minHeight:"100vh", background:T.bg, display:"flex", alignItems:"center", justifyContent:"center", color:T.textDim, fontFamily:FONT_MONO }}>Connecting to AI Asset Management…</div>;
  }

  if (!user) {
    return <LoginPage onLogin={handleLogin} />;
  }

  return (
    <UserContext.Provider value={user}>
    <RolesContext.Provider value={rolesMap}>
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
            <div style={{ fontSize:13, fontWeight:600, letterSpacing:"-0.01em" }}>AI Agent Inventory</div>
            <div style={{ fontSize:9, color:T.textMute, fontFamily:FONT_MONO, letterSpacing:"0.08em", textTransform:"uppercase", marginTop:1 }}>Runtime Intelligence</div>
          </div>
        </div>

        <nav style={{ display:"flex", flexDirection:"column", gap:0, flex:1, overflowY:"auto" }}>
          {NAV_GROUPS.map((group, gi) => {
            const visibleItems = group.items.filter(item => canAccess(user?.role, item.id, rolesMap));
            if (visibleItems.length === 0) return null;
            return (
              <div key={gi} style={{ marginBottom: group.label ? 6 : 8 }}>
                {group.label && (
                  <div style={{ fontSize:8, letterSpacing:"0.18em", textTransform:"uppercase", color:T.textMute, fontFamily:FONT_MONO, padding:"10px 10px 5px", fontWeight:500 }}>
                    {group.label}
                  </div>
                )}
                {visibleItems.map(item => (
                  <button key={item.id} onClick={()=>setPage(item.id)}
                    style={{ background:page===item.id?T.panelHi:"transparent", border:"none", color:page===item.id?T.text:T.textDim, textAlign:"left", padding:"8px 10px", fontSize:12, borderRadius:4, cursor:"pointer", fontFamily:FONT_UI, display:"flex", alignItems:"center", gap:10, borderLeft:page===item.id?`2px solid ${T.accent}`:"2px solid transparent", transition:"all 0.1s", width:"100%" }}>
                    {item.label}
                    {item.id==="alerts" && critCount>0 && (
                      <span style={{ marginLeft:"auto", background:T.crit, color:T.bg, fontSize:10, fontFamily:FONT_MONO, padding:"1px 6px", borderRadius:8, fontWeight:600 }}>{critCount}</span>
                    )}
                  </button>
                ))}
              </div>
            );
          })}
        </nav>

        <div style={{ marginTop:"auto", padding:"12px 8px", display:"flex", flexDirection:"column", gap:10 }}>
          {/* Platform admin org switcher */}
          {user?.is_platform_admin && (
            <div style={{ background:T.panelHi, border:`1px solid ${T.purple ?? "#a78bfa"}`, borderRadius:6, padding:"8px 10px" }}>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:5 }}>
                <div style={{ fontSize:8, fontFamily:FONT_MONO, color:T.purple ?? "#a78bfa", textTransform:"uppercase", letterSpacing:"0.12em", fontWeight:600 }}>
                  ◆ Platform View
                </div>
                {allOrgs.filter(o => !o.is_internal).length === 0 && (
                  <button
                    onClick={() => fetchOrganizations().then(orgs => { if (orgs.length) setAllOrgs(orgs); })}
                    title="Reload organizations"
                    style={{ background:"transparent", border:"none", color:T.purple ?? "#a78bfa", fontSize:11, cursor:"pointer", padding:"0 2px", lineHeight:1 }}
                  >↻</button>
                )}
              </div>
              <select
                value={viewOrgId || ""}
                onChange={e => {
                  const v = e.target.value || null;
                  setViewOrgId(v);
                  setViewOrg(v);
                  refresh();
                }}
                style={{ width:"100%", background:T.panel, border:`1px solid ${T.border}`, color:T.text, padding:"4px 6px", borderRadius:3, fontSize:11, fontFamily:FONT_MONO, cursor:"pointer" }}
              >
                <option value="">All / Platform</option>
                {allOrgs.filter(o => !o.is_internal).length === 0
                  ? <option disabled value="">loading orgs…</option>
                  : allOrgs.filter(o => !o.is_internal).map(o => (
                      <option key={o.id} value={String(o.id)}>{o.name}</option>
                    ))
                }
              </select>
            </div>
          )}
          {/* User badge */}
          {user && (
            <div style={{ background:T.panelHi, border:`1px solid ${T.border}`, borderRadius:6, padding:"8px 10px", display:"flex", alignItems:"center", gap:8 }}>
              <div style={{ width:8, height:8, borderRadius:"50%", background: rolesMap[user.role]?.color ?? T.textDim, flexShrink:0 }}/>
              <div style={{ flex:1, overflow:"hidden" }}>
                <div style={{ fontSize:12, fontWeight:500, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{user.name}</div>
                <div style={{ fontSize:9, fontFamily:FONT_MONO, color: user.is_platform_admin ? (T.purple ?? "#a78bfa") : (rolesMap[user.role]?.color ?? T.textDim), textTransform:"uppercase", letterSpacing:"0.1em" }}>
                  {user.is_platform_admin ? "platform admin" : `${user.role} · ${user.team}`}
                </div>
              </div>
              <button title="Sign out" onClick={handleLogout}
                style={{ background:"transparent", border:"none", color:T.textMute, fontSize:12, cursor:"pointer", padding:"2px 4px", lineHeight:1, fontFamily:FONT_MONO }}>⏻</button>
            </div>
          )}
          <div style={{ fontSize:10, color:T.textMute, fontFamily:FONT_MONO, letterSpacing:"0.08em", lineHeight:1.8 }}>
            <div style={{ color:demoMode?T.warn:T.accent }}>● {demoMode?"demo mode":"live data"}</div>
            <span style={{ color:T.textMute }}>{filteredEvents.length.toLocaleString()} events / {filters.range}d</span>
            {lastRefresh && <div style={{ color:T.textMute, marginTop:2 }}>updated {lastRefresh.toLocaleTimeString()}</div>}
          </div>
          <button onClick={handleToggleDemoMode} title={demoMode?"Switch to live data":"Switch to demo mode"} style={{ width:"100%", background:"transparent", border:`1px solid ${demoMode?T.warn:T.accentDim}`, color:demoMode?T.warn:T.accent, padding:"6px 10px", borderRadius:3, fontSize:10, fontFamily:FONT_MONO, cursor:"pointer", letterSpacing:"0.08em", textTransform:"uppercase" }}>{demoMode?"⇄ show live":"⇄ show demo"}</button>
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
            {user?.is_platform_admin && viewOrgId && (() => {
              const org = allOrgs.find(o => String(o.id) === String(viewOrgId));
              return org ? (
                <span style={{ display:"inline-flex", alignItems:"center", gap:5, background:"rgba(167,139,250,0.12)", border:"1px solid rgba(167,139,250,0.3)", color:T.purple ?? "#a78bfa", padding:"3px 9px", borderRadius:4, fontSize:10 }}>
                  ◆ Viewing: {org.name}
                </span>
              ) : null;
            })()}
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
            <span style={{ color:demoMode?T.warn:T.accent }}>● {demoMode?"demo":"live"}</span>
            {pricingLastUpdated && (
              <>
                <span style={{ color:T.textMute }}>|</span>
                <span title="Date pricing table was last audited against provider rates" style={{ color:T.textMute }}>pricing as of {pricingLastUpdated}</span>
              </>
            )}
          </div>
        </header>

        {!["dashboard","home","agent_inventory","discovery","governance","relationship_map","security_intel","ecosystem","cost","pricing","budgets","security","chat","users","apikeys","settings","integrations","onboarding","welcome"].includes(page) && <FilterBar filters={filters} setFilters={setFilters} allTeams={allTeams} allAgents={allAgents} user={user} rolesMap={rolesMap}/>}

        <PageErrorBoundary key={`${page}-${demoMode}`}>{renderPage()}</PageErrorBoundary>
      </main>
    </div>
    </RolesContext.Provider>
    </UserContext.Provider>
  );
}
