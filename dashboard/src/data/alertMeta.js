import { tierFromModel, approvedModel } from "./demoData.js";

export const ALERT_META = {
  agent_cost_spike:         { title: "Agent cost spike detected",           category: "Cost Anomaly",       checks: "Compares an agent's spend in the current 24h window against its trailing 7-day daily average. Fires when today exceeds 2× that baseline.", matters: "A sudden cost jump usually means an agent is doing far more work than usual — often from a prompt change, a retry loop, or an upstream input that balloomed in size.", causes: ["Prompt template change that inflated context size", "Tool-call retry loop with no termination", "Upstream data source returning much larger payloads", "New high-volume workload without a budget guardrail"], detail: (a) => `${a.entity} is the affected agent. ${a.msg}. At this rate it is on track to consume a disproportionate share of its team's budget.` },
  high_token_prompt:        { title: "Unusually large prompt",              category: "Cost Optimization",  checks: "Flags any single request whose total token count exceeds 30,000 tokens.", matters: "Token cost scales linearly with size. Very large prompts are frequently caused by stuffing entire documents into context when only a fraction is relevant.", causes: ["Full-document context with no retrieval or chunking", "Unbounded conversation history replayed each turn", "Retrieved chunks not deduplicated or truncated", "Verbose system prompts duplicated across calls"], detail: (a) => `The request from ${a.entity} carried ${a.msg.split(" ")[0]} — well above threshold. Adding retrieval truncation typically cuts this by 60–80%.` },
  failed_workflow_spike:    { title: "Workflow failure rate elevated",       category: "Reliability Risk",   checks: "Tracks the failure ratio per workflow over a rolling 48h window. Fires when rate exceeds 25% with meaningful call volume.", matters: "High failure rates mean users aren't getting results and you're still paying for failed attempts.", causes: ["Upstream tool or API outage / rate limiting", "Expired or rotated auth credentials", "Breaking change in a tool's response schema", "Timeout thresholds too aggressive for the model"], detail: (a) => `Workflow ${a.entity} ${a.msg.toLowerCase()}. Each failed run still incurs partial token cost.` },
  expensive_model_usage:    { title: "Premium model used on trivial prompts", category: "Cost Optimization", checks: "Counts calls to a premium-tier model where total prompt was under 200 tokens — work a mid-tier model handles at a fraction of the cost.", matters: "Premium models cost 5–10× more per token. Short, simple prompts rarely benefit from the extra capability.", causes: ["Single default model hardcoded for all routes", "No model-routing tier based on task complexity", "Premium model chosen 'to be safe' without measuring need"], detail: (a) => `${a.msg}. Confirm these calls don't require premium reasoning before routing them down.` },
  unusual_after_hours_usage: { title: "After-hours activity spike",          category: "Security Signal",    checks: "Counts requests outside business hours (before 07:00 or after 20:00) over the last 7 days.", matters: "Off-hours bursts can be a legitimate batch job — or an early indicator of a leaked API key or unauthorized access.", causes: ["Undocumented scheduled batch job", "Leaked or shared API credential being used externally", "Retry loop that only triggers under low-traffic conditions"], detail: (a) => `${a.entity} logged ${a.msg.toLowerCase()}. If this batch window is expected, suppress the rule; if not, rotate the key.` },
  repeated_agent_loop:      { title: "Agent stuck in a loop",               category: "Reliability Risk",   checks: "Buckets each agent's calls into 30-min windows. Fires when any window exceeds 40 calls from the same agent.", matters: "A looping agent burns tokens continuously with no useful output — one of the fastest ways to run up an unexpected bill.", causes: ["Tool-call retry with no max-attempts cap", "Missing or unreachable termination condition", "Agent re-planning indefinitely on an unsolvable step"], detail: (a) => `${a.entity} produced ${a.msg.toLowerCase()}. Add a hard call cap and termination check before re-enabling.` },
  unapproved_model_usage:   { title: "Unapproved model in use",             category: "Governance Violation", checks: "Flags any request routed to a model not on the organization's approved allowlist.", matters: "Unapproved models may not meet data-residency, security, or contractual requirements.", causes: ["Developer testing a new provider in production", "Missing enforcement at the model gateway", "SDK default that bypassed the allowlist"], detail: (a) => `${a.msg}. Either add to the allowlist through governance review, or block at the gateway.` },
  sensitive_data_exposure:  { title: "Sensitive content in AI requests",    category: "Runtime Signal",      checks: "Detects requests flagged with sensitive content patterns.", matters: "Sensitive content sent to external models may need review depending on your data policies.", causes: ["Unstructured user input passed to model without filtering", "Raw documents included in context"], detail: (a) => `${a.entity} triggered this: ${a.msg.toLowerCase()}. Review request patterns for this asset.` },
};

export function applyFilters(events, f) {
  const cutoff = Date.now() - f.range * 86400000;
  return events.filter((e) => {
    if (e.ts < cutoff) return false;
    if (f.team  !== "all" && e.team  !== f.team)  return false;
    if (f.model !== "all" && e.model !== f.model)  return false;
    if (f.agent !== "all" && e.agent !== f.agent)  return false;
    return true;
  });
}

export function runDetections(events) {
  const alerts = [];
  const DAY = 86400000;
  const now = Date.now();
  const byAgentToday = {}, byAgent7d = {};
  events.forEach((e) => {
    const age = now - e.ts;
    if (age < DAY)             byAgentToday[e.agent] = (byAgentToday[e.agent] || 0) + e.cost;
    if (age >= DAY && age < 8 * DAY) byAgent7d[e.agent]  = (byAgent7d[e.agent]  || 0) + e.cost;
  });
  const latestTsByAgent = {};
  events.forEach((e) => { if (!latestTsByAgent[e.agent] || e.ts > latestTsByAgent[e.agent]) latestTsByAgent[e.agent] = e.ts; });
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

export function agg(events) {
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

export function estimateSavings(events) {
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

export function computeRiskScore(events, alerts) {
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

export function execSummary(A, savings, risk, alerts) {
  const crit   = alerts.filter((a)=>a.sev==="critical").length;
  const topAgent= Object.entries(A.costByAgent).sort((a,b)=>b[1]-a[1])[0];
  const topModel= Object.entries(A.costByModel).sort((a,b)=>b[1]-a[1])[0];
  return {
    what: `Across the selected window, AI runtime spend reached $${A.total.cost.toFixed(2)} with ${crit} critical alert${crit===1?"":"s"} firing. The top cost driver is ${topAgent?.[0]||"—"} on ${topModel?.[0]||"—"}.`,
    why:  `Roughly $${savings.total.toFixed(2)} of spend appears recoverable — primarily from premium-model calls on short prompts, agent loops, and failed workflows. The runtime risk score is ${risk.score}/100${risk.score>50?", which is above the recommended threshold":""}.`,
    next: crit>0 ? `Address the ${crit} critical alert${crit===1?"":"s"} first. Then route short premium-model prompts to a mid-tier alternative to capture estimated savings.` : `Continue monitoring. Consider routing short prompts on premium models to a mid-tier alternative to capture estimated savings.`,
  };
}
