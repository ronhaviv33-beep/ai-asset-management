import React, { useState, useEffect, useMemo } from "react";
import { fetchAgents, fetchCostIntelligence, fetchRelationships } from "../api.js";
import { relationshipEvidenceLabel } from "../discoveryStatus.js";
import CollapsiblePanel, { PanelGroupControls } from "../components/CollapsiblePanel.jsx";

const T = {
  bg: "#0A0B0F", panel: "#0F1117", panelHi: "#141823",
  border: "#1E2230", borderHi: "#2A3242",
  text: "#E8ECF4", textDim: "#7A8499", textMute: "#4B5468",
  accent: "#7CFFB2", warn: "#FFB547", crit: "#FF5C7A",
  info: "#6FA8FF", yellow: "#FFD700", purple: "#B47AFF",
};
const MONO = "'JetBrains Mono','IBM Plex Mono',monospace";
const FONT = "'Geist','Söhne',-apple-system,sans-serif";

const PLATFORM_META = {
  gateway_telemetry: { label: "Gateway Telemetry", color: T.accent,  icon: "◉", desc: "AI runtime gateway — primary discovery source" },
  sdk_runtime:       { label: "SDK Runtime",        color: "#34d399", icon: "◈", desc: "Agents discovered through lightweight SDK metadata attached at runtime" },
  github:            { label: "GitHub Repositories", color: T.info,  icon: "◎", desc: "Repositories with AI SDK dependencies" },
  n8n:               { label: "n8n Workflows",       color: T.purple, icon: "◈", desc: "Automation workflows using AI nodes" },
  slack:             { label: "Slack Bots",           color: "#E8A138", icon: "◆", desc: "Slack app integrations using AI" },
  jira:              { label: "Jira Automations",    color: T.warn,   icon: "◇", desc: "Jira automation rules with AI actions" },
  servicenow:        { label: "ServiceNow",           color: T.crit,   icon: "⊗", desc: "ServiceNow virtual agents and flows" },
  cloud_functions:   { label: "Cloud Functions",      color: T.info,   icon: "⊹", desc: "Serverless functions invoking AI models" },
  azure_devops:      { label: "Azure DevOps",         color: T.info,   icon: "◌", desc: "CI/CD pipelines with AI steps" },
  unknown:           { label: "Unknown Source",       color: T.textDim, icon: "○", desc: "Source not yet classified" },
};

const PROVIDER_META = {
  anthropic:     { label: "Anthropic",    color: T.accent,  icon: "◆" },
  openai:        { label: "OpenAI",       color: T.info,    icon: "●" },
  google:        { label: "Google",       color: T.warn,    icon: "◇" },
  local:         { label: "Local / OSS", color: T.purple,  icon: "◎" },
  azure:         { label: "Azure OpenAI", color: T.info,    icon: "◌" },
  bedrock:       { label: "AWS Bedrock",  color: "#FF9900", icon: "◉" },
  unknown:       { label: "Unknown",      color: T.textDim, icon: "○" },
};

// Relationship-derived ecosystem categories (runtime dependencies, from GET /relationships
// — the same source the Dependency Map uses). Order = display order.
const ECOSYSTEM_META = {
  mcp:      { label: "MCP Activity",            color: T.purple, icon: "⊙", desc: "MCP tools & servers used at runtime", modalTitle: "MCP Activity" },
  crm:      { label: "CRM Systems",             color: "#E8A138", icon: "◆", desc: "CRM systems agents read from / write to", modalTitle: "CRM Systems touched" },
  api:      { label: "External APIs",           color: T.info,   icon: "🌐", desc: "External APIs agents call", modalTitle: "APIs touched" },
  database: { label: "Databases",               color: T.accent, icon: "🗄", desc: "Databases agents read from / write to", modalTitle: "Databases touched" },
  workflow: { label: "Workflows",               color: T.warn,   icon: "⚡", desc: "Workflows agents invoke", modalTitle: "Workflows touched" },
  external: { label: "External Systems Touched", color: T.textDim, icon: "◇", desc: "Other external systems observed at runtime", modalTitle: "External systems touched" },
};
// Categories always shown (even at 0) so empty states stay correct. "external" is the
// catch-all fallback and is only shown when it has rows.
const ECOSYSTEM_ALWAYS = ["mcp", "crm", "api", "database", "workflow"];

// Map a relationship target_type → ecosystem category key. provider/model/gateway are
// intentionally excluded (providers have their own section; model/gateway aren't external
// systems). Everything unrecognised falls back to "external".
function categoryForTargetType(targetType = "") {
  switch (targetType) {
    case "mcp_tool":
    case "mcp_server": return "mcp";
    case "crm":        return "crm";
    case "api":        return "api";
    case "database":   return "database";
    case "workflow":   return "workflow";
    case "provider":
    case "model":
    case "gateway":    return null;   // handled by other sections / not external systems
    default:           return "external";
  }
}

function providerFromModel(model = "") {
  model = model.toLowerCase();
  if (model.startsWith("claude"))                    return "anthropic";
  if (model.startsWith("gpt") || model.startsWith("o3") || model.startsWith("o4")) return "openai";
  if (model.startsWith("gemini"))                    return "google";
  if (model.includes("local") || model.includes("llama") || model.includes("mistral")) return "local";
  if (model.includes("azure"))                       return "azure";
  if (model.includes("bedrock"))                     return "bedrock";
  return "unknown";
}

function PlatformCard({ meta, count, agentNames, maxCount }) {
  const pct = maxCount > 0 ? (count / maxCount) * 100 : 0;
  const [expanded, setExpanded] = useState(false);
  return (
    <div style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 8, padding: "18px 20px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 12 }}>
        <span style={{ fontSize: 20, color: meta.color, flexShrink: 0 }}>{meta.icon}</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: T.text, marginBottom: 3 }}>{meta.label}</div>
          <div style={{ fontSize: 11, color: T.textMute }}>{meta.desc}</div>
        </div>
        <div style={{ fontSize: 28, fontWeight: 700, color: meta.color, fontFamily: MONO, flexShrink: 0 }}>{count}</div>
      </div>
      <div style={{ background: T.panelHi, borderRadius: 2, height: 4, marginBottom: 10 }}>
        <div style={{ width: `${pct}%`, background: meta.color, height: 4, borderRadius: 2, transition: "width 0.5s" }} />
      </div>
      {agentNames.length > 0 && (
        <button onClick={() => setExpanded(!expanded)} style={{ background: "transparent", border: "none", color: T.textDim, fontSize: 11, fontFamily: MONO, cursor: "pointer", padding: 0, letterSpacing: "0.04em" }}>
          {expanded ? "▲" : "▼"} {agentNames.length} agent{agentNames.length !== 1 ? "s" : ""}
        </button>
      )}
      {expanded && (
        <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 5 }}>
          {agentNames.slice(0, 12).map(name => (
            <span key={name} style={{ background: T.panelHi, color: T.textDim, fontSize: 10, fontFamily: MONO, padding: "2px 8px", borderRadius: 4, border: `1px solid ${T.border}` }}>
              {name}
            </span>
          ))}
          {agentNames.length > 12 && <span style={{ color: T.textMute, fontSize: 10, fontFamily: MONO }}>+{agentNames.length - 12} more</span>}
        </div>
      )}
    </div>
  );
}

function ProviderCard({ meta, agentCount, costUsd, maxCount, onClick }) {
  const pct = maxCount > 0 ? (agentCount / maxCount) * 100 : 0;
  const [hover, setHover] = useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ background: hover ? T.panelHi : T.panel, border: `1px solid ${hover ? meta.color + "66" : T.border}`, borderRadius: 8, padding: "18px 20px", cursor: "pointer", transition: "all 0.15s" }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <span style={{ fontSize: 16, color: meta.color }}>{meta.icon}</span>
        <div style={{ fontSize: 14, fontWeight: 600, color: T.text }}>{meta.label}</div>
        <div style={{ marginLeft: "auto", fontSize: 26, fontWeight: 700, color: meta.color, fontFamily: MONO }}>{agentCount}</div>
      </div>
      <div style={{ background: T.panelHi, borderRadius: 2, height: 6, marginBottom: 10 }}>
        <div style={{ width: `${pct}%`, background: meta.color, height: 6, borderRadius: 2, transition: "width 0.5s" }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, fontFamily: MONO, color: T.textMute }}>
        <span>{agentCount} agent{agentCount !== 1 ? "s" : ""}</span>
        {costUsd > 0 && <span style={{ color: T.textDim }}>${costUsd.toFixed(2)}/mo</span>}
      </div>
      {agentCount > 0 && (
        <div style={{ marginTop: 10, fontSize: 10, fontFamily: MONO, color: hover ? meta.color : T.textMute, letterSpacing: "0.06em" }}>
          View agents →
        </div>
      )}
    </div>
  );
}

function relativeTime(iso) {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000), h = Math.floor(diff / 3600000), d = Math.floor(diff / 86400000);
  if (m < 2) return "just now";
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const LIFECYCLE_MAP = {
  unassigned:       { label: "Unassigned",  color: "#FFB547", bg: "#3D2E0D" },
  needs_validation: { label: "Needs Val.",  color: "#B47AFF", bg: "#1E1A3D" },
  managed:          { label: "Managed",     color: "#7CFFB2", bg: "#1A3D2B" },
  retired:          { label: "Retired",     color: "#4B5468", bg: "#141823" },
};

function ProviderAgentsModal({ provider, agents, onClose }) {
  if (!provider) return null;
  const { meta, costUsd } = provider;

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 1000, padding: "0 0 0 0" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: T.panel, border: `1px solid ${T.border}`, borderTop: `2px solid ${meta.color}`, borderRadius: "12px 12px 0 0", width: "100%", maxWidth: 900, maxHeight: "75vh", display: "flex", flexDirection: "column", fontFamily: FONT }}>

        {/* Header */}
        <div style={{ padding: "20px 24px 16px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 20, color: meta.color }}>{meta.icon}</span>
          <div>
            <div style={{ fontSize: 16, fontWeight: 600, color: T.text }}>{meta.label} Agents</div>
            <div style={{ fontSize: 11, color: T.textMute, fontFamily: MONO, marginTop: 2 }}>
              {agents.length} agent{agents.length !== 1 ? "s" : ""} using this provider
              {costUsd > 0 && <span style={{ marginLeft: 12, color: T.textDim }}>${costUsd.toFixed(2)}/mo total</span>}
            </div>
          </div>
          <button onClick={onClose} style={{ marginLeft: "auto", background: "transparent", border: `1px solid ${T.border}`, color: T.textDim, padding: "6px 14px", borderRadius: 5, fontSize: 12, fontFamily: MONO, cursor: "pointer" }}>
            ✕ Close
          </button>
        </div>

        {/* Table */}
        <div style={{ overflowY: "auto", flex: 1 }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Agent", "Team", "Environment", "Owner", "Status", "Risk", "Monthly Cost", "Last Seen"].map(h => (
                  <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontSize: 10, fontFamily: MONO, color: T.textMute, letterSpacing: "0.1em", textTransform: "uppercase", borderBottom: `1px solid ${T.border}`, background: T.panelHi, whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {agents.map((a, i) => {
                const lc = LIFECYCLE_MAP[a.lifecycle_status] || LIFECYCLE_MAP.unassigned;
                const risk = a.risk || "—";
                const riskColor = risk === "high" ? T.crit : risk === "medium" ? T.warn : risk === "low" ? T.accent : T.textMute;
                return (
                  <tr key={a.id || a.name || i} style={{ background: i % 2 === 0 ? T.panel : "#0C0E14" }}
                    onMouseEnter={e => e.currentTarget.style.background = T.panelHi}
                    onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? T.panel : "#0C0E14"}>
                    <td style={{ padding: "11px 14px", borderBottom: `1px solid ${T.border}` }}>
                      <div style={{ fontSize: 13, fontFamily: MONO, color: T.text, fontWeight: 500 }}>{a.name || a.agent_name}</div>
                      <span style={{ display: "inline-block", background: lc.bg, color: lc.color, fontSize: 9, fontFamily: MONO, fontWeight: 600, padding: "1px 6px", borderRadius: 3, textTransform: "uppercase", letterSpacing: "0.05em", marginTop: 3 }}>{lc.label}</span>
                    </td>
                    <td style={{ padding: "11px 14px", borderBottom: `1px solid ${T.border}`, fontSize: 12, color: T.textDim, fontFamily: MONO }}>{a.team || "—"}</td>
                    <td style={{ padding: "11px 14px", borderBottom: `1px solid ${T.border}` }}>
                      {a.environment && a.environment !== "Unknown"
                        ? <span style={{ fontSize: 11, fontFamily: MONO, color: T.info, background: "#0D1F3D", padding: "2px 7px", borderRadius: 3 }}>{a.environment}</span>
                        : <span style={{ fontSize: 11, color: T.textMute }}>—</span>}
                    </td>
                    <td style={{ padding: "11px 14px", borderBottom: `1px solid ${T.border}`, fontSize: 12, color: T.textDim }}>{a.owner === "Unassigned" ? <span style={{ color: T.warn, fontSize: 11, fontFamily: MONO }}>Unassigned</span> : (a.owner || "—")}</td>
                    <td style={{ padding: "11px 14px", borderBottom: `1px solid ${T.border}` }}>
                      <span style={{ background: a.status === "active" ? "#1A3D2B" : "#141823", color: a.status === "active" ? T.accent : T.textDim, fontSize: 11, fontFamily: MONO, fontWeight: 600, padding: "2px 8px", borderRadius: 4, textTransform: "capitalize" }}>{a.status || "—"}</span>
                    </td>
                    <td style={{ padding: "11px 14px", borderBottom: `1px solid ${T.border}` }}>
                      <span style={{ fontSize: 11, fontFamily: MONO, color: riskColor, textTransform: "capitalize" }}>{risk}</span>
                    </td>
                    <td style={{ padding: "11px 14px", borderBottom: `1px solid ${T.border}`, fontSize: 13, fontFamily: MONO, color: a.monthly_cost_usd > 0 ? T.text : T.textMute }}>
                      {a.monthly_cost_usd > 0 ? `$${(+a.monthly_cost_usd).toFixed(2)}` : "—"}
                    </td>
                    <td style={{ padding: "11px 14px", borderBottom: `1px solid ${T.border}`, fontSize: 11, fontFamily: MONO, color: T.textDim }}>{relativeTime(a.last_seen)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function RelationshipModal({ category, rows, onClose }) {
  const [q, setQ] = useState("");
  if (!category) return null;
  const meta = ECOSYSTEM_META[category.key] || { label: category.key, color: T.textDim, modalTitle: category.key };

  const query = q.trim().toLowerCase();
  const filtered = query
    ? rows.filter(r =>
        (r.source_agent_name || "").toLowerCase().includes(query) ||
        (r.target_name || "").toLowerCase().includes(query))
    : rows;

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 1000 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: T.panel, border: `1px solid ${T.border}`, borderTop: `2px solid ${meta.color}`, borderRadius: "12px 12px 0 0", width: "100%", maxWidth: 980, maxHeight: "78vh", display: "flex", flexDirection: "column", fontFamily: FONT }}>

        {/* Header */}
        <div style={{ padding: "20px 24px 16px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 20, color: meta.color }}>{meta.icon}</span>
          <div>
            <div style={{ fontSize: 16, fontWeight: 600, color: T.text }}>{meta.modalTitle}</div>
            <div style={{ fontSize: 11, color: T.textMute, fontFamily: MONO, marginTop: 2 }}>
              {rows.length} relationship{rows.length !== 1 ? "s" : ""} · derived from runtime dependency data
            </div>
          </div>
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search agent or system…"
            style={{ marginLeft: "auto", background: T.panelHi, border: `1px solid ${T.border}`, color: T.text, padding: "7px 12px", borderRadius: 5, fontSize: 12, fontFamily: FONT, width: 220 }}
          />
          <button onClick={onClose} style={{ background: "transparent", border: `1px solid ${T.border}`, color: T.textDim, padding: "6px 14px", borderRadius: 5, fontSize: 12, fontFamily: MONO, cursor: "pointer" }}>
            ✕ Close
          </button>
        </div>

        {/* Body */}
        <div style={{ overflowY: "auto", flex: 1 }}>
          {filtered.length === 0 ? (
            <div style={{ padding: "40px 24px", textAlign: "center", color: T.textMute, fontFamily: MONO, fontSize: 13 }}>
              No matching relationships observed yet.
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["Source Agent", "Relationship", "Target Type", "Target System", "Evidence Source", "Strength", "Requests", "Last Seen"].map(h => (
                    <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontSize: 10, fontFamily: MONO, color: T.textMute, letterSpacing: "0.1em", textTransform: "uppercase", borderBottom: `1px solid ${T.border}`, background: T.panelHi, whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((r, i) => {
                  const ev = relationshipEvidenceLabel(r);
                  return (
                    <tr key={r.id ?? `${r.source_agent_name}-${r.target_name}-${i}`} style={{ background: i % 2 === 0 ? T.panel : "#0C0E14" }}>
                      <td style={{ padding: "11px 14px", borderBottom: `1px solid ${T.border}`, fontSize: 13, fontFamily: MONO, color: T.text, fontWeight: 500 }}>{r.source_agent_name}</td>
                      <td style={{ padding: "11px 14px", borderBottom: `1px solid ${T.border}`, fontSize: 12, fontFamily: MONO, color: T.textDim }}>{(r.relationship_type || "").replace(/_/g, " ")}</td>
                      <td style={{ padding: "11px 14px", borderBottom: `1px solid ${T.border}`, fontSize: 11, fontFamily: MONO, color: meta.color, textTransform: "uppercase" }}>{(r.target_type || "").replace(/_/g, " ")}</td>
                      <td style={{ padding: "11px 14px", borderBottom: `1px solid ${T.border}`, fontSize: 13, fontFamily: MONO, color: T.text }}>{r.target_name}</td>
                      <td style={{ padding: "11px 14px", borderBottom: `1px solid ${T.border}`, fontSize: 11, fontFamily: MONO, color: T.textDim }}>{(r.evidence_source || "").replace(/_/g, " ")}</td>
                      <td style={{ padding: "11px 14px", borderBottom: `1px solid ${T.border}` }}>
                        <span title={ev.why} style={{ padding: "2px 8px", borderRadius: 3, fontSize: 10, fontFamily: MONO, background: `${ev.color}18`, color: ev.color, border: `1px solid ${ev.color}33`, whiteSpace: "nowrap" }}>{ev.label}</span>
                      </td>
                      <td style={{ padding: "11px 14px", borderBottom: `1px solid ${T.border}`, fontSize: 12, fontFamily: MONO, color: T.textDim }}>{(r.request_count ?? 0).toLocaleString()}</td>
                      <td style={{ padding: "11px 14px", borderBottom: `1px solid ${T.border}`, fontSize: 11, fontFamily: MONO, color: T.textDim }}>{relativeTime(r.last_seen_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

export default function EcosystemDiscovery() {
  const [agents, setAgents]           = useState([]);
  const [costData, setCostData]       = useState(null);
  const [relationships, setRelationships] = useState([]);
  const [loading, setLoading]         = useState(true);
  const [selectedProvider, setSelectedProvider] = useState(null);
  const [selectedCategory, setSelectedCategory] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const [a, c, r] = await Promise.allSettled([
          fetchAgents({ limit: 500, include_retired: true }),
          fetchCostIntelligence({ breakdown_by: "provider", days: 30 }),
          fetchRelationships(),
        ]);
        if (a.status === "fulfilled" && a.value) {
          setAgents(Array.isArray(a.value) ? a.value : a.value?.agents || []);
        }
        if (c.status === "fulfilled" && c.value) setCostData(c.value);
        if (r.status === "fulfilled" && Array.isArray(r.value)) setRelationships(r.value);
      } finally { setLoading(false); }
    })();
  }, []);

  // Ecosystem categories derived from real relationship rows (same source as the
  // Dependency Map). Card count == number of rows in the category, so it matches the
  // drill-down modal exactly. Known categories always render (0 when empty); the
  // "external" catch-all renders only when it has rows.
  const ecosystemData = useMemo(() => {
    const groups = {};
    relationships.forEach(r => {
      const key = categoryForTargetType(r.target_type);
      if (!key) return;
      (groups[key] = groups[key] || []).push(r);
    });
    const keys = [...new Set([...ECOSYSTEM_ALWAYS, ...Object.keys(groups)])];
    return keys
      .filter(key => ECOSYSTEM_ALWAYS.includes(key) || (groups[key] && groups[key].length > 0))
      .map(key => ({
        key,
        meta: ECOSYSTEM_META[key] || { label: key, color: T.textDim, icon: "◇", desc: "", modalTitle: key },
        rows: groups[key] || [],
        count: (groups[key] || []).length,
        agentNames: [...new Set((groups[key] || []).map(r => r.source_agent_name))],
      }))
      .sort((a, b) => b.count - a.count);
  }, [relationships]);

  // Platforms: always show every known platform (hardcoded from PLATFORM_META).
  // Count comes from live agent data but the card is never removed — even if all
  // agents from a platform are validated/retired, the connection still exists.
  const platformData = useMemo(() => {
    const groups = {};
    agents.forEach(a => {
      const src = a.discovery_source || "unknown";
      if (!groups[src]) groups[src] = { count: 0, agentNames: [] };
      groups[src].count++;
      groups[src].agentNames.push(a.agent_name || a.agent_id_raw || a.agent_id);
    });
    return Object.keys(PLATFORM_META).map(key => ({
      key,
      count:      groups[key]?.count      || 0,
      agentNames: groups[key]?.agentNames || [],
      meta:       PLATFORM_META[key],
    })).sort((a, b) => b.count - a.count);
  }, [agents]);

  // Providers: costs from breakdown, agent counts from agents' models_used
  const providerData = useMemo(() => {
    const breakdown = costData?.breakdown?.items || costData?.breakdown || [];
    const byProvider = costData?.breakdown?.by === "provider";
    const provCosts  = {};

    breakdown.forEach(item => {
      const prov = byProvider
        ? item.name
        : (item.provider || providerFromModel(item.model || item.label || ""));
      if (!prov) return;
      provCosts[prov] = (provCosts[prov] || 0) + (item.cost_usd || 0);
    });

    // Always derive agent counts from agents' models_used array, keep full objects
    const provAgents = {};
    agents.forEach(a => {
      const models = a.models_used || (a.model ? [a.model] : []);
      const seen = new Set();
      models.forEach(m => {
        const prov = providerFromModel(m);
        if (prov && !seen.has(prov)) {
          seen.add(prov);
          if (!provAgents[prov]) provAgents[prov] = [];
          // dedupe by agent id
          const agentKey = a.id || a.agent_name || a.name;
          if (!provAgents[prov].some(x => (x.id || x.agent_name || x.name) === agentKey)) {
            provAgents[prov].push(a);
          }
        }
      });
    });

    const allProviders = new Set([...Object.keys(provCosts), ...Object.keys(provAgents)]);
    return [...allProviders]
      .filter(Boolean)
      .map(p => ({
        key: p,
        agentCount: provAgents[p]?.length || 0,
        agentList:  provAgents[p] || [],
        costUsd: provCosts[p] || 0,
        meta: PROVIDER_META[p] || { label: p, color: T.textDim, icon: "○" },
      }))
      .filter(p => p.agentCount > 0 || p.costUsd > 0)
      .sort((a, b) => b.costUsd - a.costUsd);
  }, [agents, costData]);

  const activePlatforms  = platformData.filter(p => p.count > 0).length;
  const maxPlatformCount = Math.max(1, ...platformData.map(p => p.count));
  const maxProviderCount = Math.max(1, ...providerData.map(p => p.agentCount));
  const maxEcosystemCount = Math.max(1, ...ecosystemData.map(e => e.count));
  const totalAgents      = agents.length;
  const externalSystems  = ecosystemData.reduce((n, e) => n + e.count, 0);

  if (loading) return (
    <div style={{ color: T.textMute, fontFamily: MONO, fontSize: 13, padding: "32px 0", textAlign: "center" }}>
      Loading ecosystem data…
    </div>
  );

  return (
    <div style={{ fontFamily: FONT, display: "flex", flexDirection: "column", gap: 28 }}>

      {/* ── Summary strip ──────────────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: 12 }}>
        {[
          { label: "Total Agents",        value: totalAgents,           color: T.text },
          { label: "Discovery Sources",   value: activePlatforms,       color: T.accent },
          { label: "Connected Providers", value: providerData.length,   color: T.info },
          { label: "Dependencies Mapped", value: externalSystems,       color: T.purple },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 8, padding: "18px 22px", flex: 1 }}>
            <div style={{ fontSize: 9, fontFamily: MONO, color: T.textMute, letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 10 }}>{label}</div>
            <div style={{ fontSize: 30, fontWeight: 700, color, letterSpacing: "-0.03em" }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Expand/Collapse all */}
      <PanelGroupControls group="ecosystem" style={{ justifyContent: "flex-end" }} />

      {/* ── Connected Platforms ────────────────────────────────────────────── */}
      <CollapsiblePanel group="ecosystem" storageKey="oa-panel-ecosystem-platforms"
        title="Connected Platforms" badge={activePlatforms}
        subtitle="Sources where AI agents have been detected across your organization">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14 }}>
          {platformData.map(p => (
            <PlatformCard key={p.key} meta={p.meta} count={p.count} agentNames={p.agentNames} maxCount={maxPlatformCount} />
          ))}
        </div>
      </CollapsiblePanel>

      {/* ── External Systems & Dependencies (relationship-derived) ─────────── */}
      <CollapsiblePanel group="ecosystem" storageKey="oa-panel-ecosystem-dependencies"
        title="External Systems & Dependencies" badge={externalSystems}
        subtitle="Runtime systems agents interact with — derived from the same dependency data as the Dependency Map. Click a card for details.">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14 }}>
          {ecosystemData.map(e => {
            const pct = maxEcosystemCount > 0 ? (e.count / maxEcosystemCount) * 100 : 0;
            const clickable = e.count > 0;
            return (
              <div key={e.key}
                onClick={() => clickable && setSelectedCategory(e)}
                style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 8, padding: "18px 20px", cursor: clickable ? "pointer" : "default", transition: "border-color 0.15s" }}
                onMouseEnter={ev => { if (clickable) ev.currentTarget.style.borderColor = e.meta.color + "66"; }}
                onMouseLeave={ev => { ev.currentTarget.style.borderColor = T.border; }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 12 }}>
                  <span style={{ fontSize: 20, color: e.meta.color, flexShrink: 0 }}>{e.meta.icon}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: T.text, marginBottom: 3 }}>{e.meta.label}</div>
                    <div style={{ fontSize: 11, color: T.textMute }}>{e.meta.desc}</div>
                  </div>
                  <div style={{ fontSize: 28, fontWeight: 700, color: e.meta.color, fontFamily: MONO, flexShrink: 0 }}>{e.count}</div>
                </div>
                <div style={{ background: T.panelHi, borderRadius: 2, height: 4, marginBottom: 10 }}>
                  <div style={{ width: `${pct}%`, background: e.meta.color, height: 4, borderRadius: 2, transition: "width 0.5s" }} />
                </div>
                <div style={{ fontSize: 10, fontFamily: MONO, color: clickable ? e.meta.color : T.textMute, letterSpacing: "0.06em" }}>
                  {clickable
                    ? `${e.agentNames.length} agent${e.agentNames.length !== 1 ? "s" : ""} · view details →`
                    : "No activity yet"}
                </div>
              </div>
            );
          })}
        </div>
      </CollapsiblePanel>

      {/* ── Connected Providers ────────────────────────────────────────────── */}
      <CollapsiblePanel group="ecosystem" storageKey="oa-panel-ecosystem-providers"
        title="Connected AI Providers" badge={providerData.length}
        subtitle="LLM providers in use across all discovered agents (last 30 days)">
        {providerData.length > 0 ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 14 }}>
            {providerData.map(p => (
              <ProviderCard key={p.key} meta={p.meta} agentCount={p.agentCount} costUsd={p.costUsd} maxCount={maxProviderCount} onClick={() => p.agentCount > 0 && setSelectedProvider(p)} />
            ))}
          </div>
        ) : (
          <div style={{ padding: "28px", background: T.panel, border: `1px solid ${T.border}`, borderRadius: 8, color: T.textMute, fontFamily: MONO, fontSize: 13, textAlign: "center" }}>
            No provider usage detected. Ensure agents are routing through the gateway with correct attribution headers.
          </div>
        )}
      </CollapsiblePanel>

      {selectedProvider && (
        <ProviderAgentsModal
          provider={selectedProvider}
          agents={selectedProvider.agentList}
          onClose={() => setSelectedProvider(null)}
        />
      )}

      {selectedCategory && (
        <RelationshipModal
          category={selectedCategory}
          rows={selectedCategory.rows}
          onClose={() => setSelectedCategory(null)}
        />
      )}
    </div>
  );
}
