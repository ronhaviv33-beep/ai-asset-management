import React, { useState, useEffect, useMemo } from "react";
import { fetchAgents, fetchCostIntelligence } from "../api.js";

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
  github:            { label: "GitHub Repositories", color: T.info,  icon: "◎", desc: "Repositories with AI SDK dependencies" },
  n8n:               { label: "n8n Workflows",       color: T.purple, icon: "◈", desc: "Automation workflows using AI nodes" },
  slack:             { label: "Slack Bots",           color: "#E8A138", icon: "◆", desc: "Slack app integrations using AI" },
  jira:              { label: "Jira Automations",    color: T.warn,   icon: "◇", desc: "Jira automation rules with AI actions" },
  servicenow:        { label: "ServiceNow",           color: T.crit,   icon: "⊗", desc: "ServiceNow virtual agents and flows" },
  mcp:               { label: "MCP Server",           color: T.purple, icon: "⊙", desc: "Model Context Protocol server integrations" },
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

function ProviderCard({ meta, agentCount, costUsd, maxCount }) {
  const pct = maxCount > 0 ? (agentCount / maxCount) * 100 : 0;
  return (
    <div style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 8, padding: "18px 20px" }}>
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
    </div>
  );
}

export default function EcosystemDiscovery() {
  const [agents, setAgents]     = useState([]);
  const [costData, setCostData] = useState(null);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [a, c] = await Promise.allSettled([
          fetchAgents({ limit: 500 }),
          fetchCostIntelligence({ breakdown_by: "provider", days: 30 }),
        ]);
        if (a.status === "fulfilled" && a.value) {
          setAgents(Array.isArray(a.value) ? a.value : a.value?.agents || []);
        }
        if (c.status === "fulfilled" && c.value) setCostData(c.value);
      } finally { setLoading(false); }
    })();
  }, []);

  // Platforms: group by discovery_source
  const platformData = useMemo(() => {
    const groups = {};
    agents.forEach(a => {
      const src = a.discovery_source || "unknown";
      if (!groups[src]) groups[src] = { count: 0, agentNames: [] };
      groups[src].count++;
      groups[src].agentNames.push(a.agent_name || a.agent_id_raw || a.agent_id);
    });
    return Object.entries(groups)
      .sort((a, b) => b[1].count - a[1].count)
      .map(([key, { count, agentNames }]) => ({
        key, count, agentNames,
        meta: PLATFORM_META[key] || { label: key, color: T.textDim, icon: "○", desc: "" },
      }));
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

    // Always derive agent counts from agents' models_used array
    const provAgents = {};
    agents.forEach(a => {
      const models = a.models_used || (a.model ? [a.model] : []);
      const seen = new Set();
      models.forEach(m => {
        const prov = providerFromModel(m);
        if (prov && !seen.has(prov)) {
          seen.add(prov);
          provAgents[prov] = (provAgents[prov] || new Set());
          provAgents[prov].add(a.id || a.agent_name || a.name);
        }
      });
    });

    const allProviders = new Set([...Object.keys(provCosts), ...Object.keys(provAgents)]);
    return [...allProviders]
      .filter(Boolean)
      .map(p => ({
        key: p,
        agentCount: provAgents[p]?.size || 0,
        costUsd: provCosts[p] || 0,
        meta: PROVIDER_META[p] || { label: p, color: T.textDim, icon: "○" },
      }))
      .filter(p => p.agentCount > 0 || p.costUsd > 0)
      .sort((a, b) => b.costUsd - a.costUsd);
  }, [agents, costData]);

  const maxPlatformCount = Math.max(1, ...platformData.map(p => p.count));
  const maxProviderCount = Math.max(1, ...providerData.map(p => p.agentCount));
  const totalAgents      = agents.length;

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
          { label: "Discovery Sources",   value: platformData.length,   color: T.accent },
          { label: "Connected Providers", value: providerData.length,   color: T.info },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 8, padding: "18px 22px", flex: 1 }}>
            <div style={{ fontSize: 9, fontFamily: MONO, color: T.textMute, letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 10 }}>{label}</div>
            <div style={{ fontSize: 30, fontWeight: 700, color, letterSpacing: "-0.03em" }}>{value}</div>
          </div>
        ))}
      </div>

      {/* ── Connected Platforms ────────────────────────────────────────────── */}
      <div>
        <div style={{ fontSize: 16, fontWeight: 600, color: T.text, marginBottom: 4 }}>Connected Platforms</div>
        <div style={{ fontSize: 12, color: T.textMute, fontFamily: MONO, marginBottom: 16 }}>
          Sources where AI agents have been detected across your organization
        </div>
        {platformData.length > 0 ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14 }}>
            {platformData.map(p => (
              <PlatformCard key={p.key} meta={p.meta} count={p.count} agentNames={p.agentNames} maxCount={maxPlatformCount} />
            ))}
          </div>
        ) : (
          <div style={{ padding: "28px", background: T.panel, border: `1px solid ${T.border}`, borderRadius: 8, color: T.textMute, fontFamily: MONO, fontSize: 13, textAlign: "center" }}>
            No platform connections discovered yet. Start by routing AI traffic through the gateway.
          </div>
        )}
      </div>

      {/* ── Connected Providers ────────────────────────────────────────────── */}
      <div>
        <div style={{ fontSize: 16, fontWeight: 600, color: T.text, marginBottom: 4 }}>Connected AI Providers</div>
        <div style={{ fontSize: 12, color: T.textMute, fontFamily: MONO, marginBottom: 16 }}>
          LLM providers in use across all discovered agents (last 30 days)
        </div>
        {providerData.length > 0 ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 14 }}>
            {providerData.map(p => (
              <ProviderCard key={p.key} meta={p.meta} agentCount={p.agentCount} costUsd={p.costUsd} maxCount={maxProviderCount} />
            ))}
          </div>
        ) : (
          <div style={{ padding: "28px", background: T.panel, border: `1px solid ${T.border}`, borderRadius: 8, color: T.textMute, fontFamily: MONO, fontSize: 13, textAlign: "center" }}>
            No provider usage detected. Ensure agents are routing through the gateway with correct attribution headers.
          </div>
        )}
      </div>


    </div>
  );
}
