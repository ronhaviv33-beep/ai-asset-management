import React, { useState, useEffect } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import {
  fetchAgentsSummary, fetchAgents,
  fetchCostIntelligence, fetchSecurityAlerts,
} from "../api.js";

const T = {
  bg: "#0A0B0F", panel: "#0F1117", panelHi: "#141823",
  border: "#1E2230", borderHi: "#2A3142",
  text: "#E8ECF4", textDim: "#7A8499", textMute: "#4B5468",
  accent: "#7CFFB2", warn: "#FFB547", crit: "#FF5C7A",
  info: "#6FA8FF", yellow: "#FFD700", purple: "#B47AFF",
};
const FONT = "'Geist','Söhne',-apple-system,sans-serif";
const MONO = "'JetBrains Mono','IBM Plex Mono',monospace";

const fmtUSD = (v) =>
  "$" + (+(v || 0)).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const SOURCE_META = {
  gateway_telemetry: { label: "Gateway Telemetry", color: T.accent },
  github:            { label: "GitHub Repositories", color: T.info },
  n8n:               { label: "n8n Workflows", color: T.purple },
  slack:             { label: "Slack Bots", color: "#E8A138" },
  jira:              { label: "Jira Automations", color: T.warn },
  servicenow:        { label: "ServiceNow", color: T.crit },
  mcp:               { label: "MCP Server", color: T.purple },
  cloud_functions:   { label: "Cloud Functions", color: T.info },
};

const LIFECYCLE = {
  managed:          { label: "Managed",          color: T.accent,  bg: "#1A3D2B" },
  unassigned:       { label: "Unassigned",        color: T.yellow,  bg: "#3D370D" },
  needs_validation: { label: "Needs Validation",  color: T.warn,    bg: "#3D2E0D" },
  retired:          { label: "Retired",           color: "#555",    bg: "#1A1A1A" },
};

function KpiCard({ label, value, sub, color, onClick }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: T.panel,
        border: `1px solid ${hover && onClick ? T.borderHi : T.border}`,
        borderRadius: 8, padding: "20px 22px", flex: 1, minWidth: 155,
        cursor: onClick ? "pointer" : "default", transition: "border-color 0.15s",
      }}
    >
      <div style={{ fontSize: 9, fontFamily: MONO, color: T.textMute, letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 10 }}>
        {label}
      </div>
      <div style={{ fontSize: 32, fontWeight: 700, color: color || T.text, letterSpacing: "-0.03em", lineHeight: 1 }}>
        {value ?? "—"}
      </div>
      {sub && <div style={{ fontSize: 11, color: T.textMute, fontFamily: MONO, marginTop: 8 }}>{sub}</div>}
    </div>
  );
}

function SectionTitle({ title, sub, action, onAction }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 16 }}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 600, color: T.text }}>{title}</div>
        {sub && <div style={{ fontSize: 11, color: T.textMute, fontFamily: MONO, marginTop: 3 }}>{sub}</div>}
      </div>
      {action && (
        <button onClick={onAction} style={{ background: "transparent", border: `1px solid ${T.border}`, color: T.textDim, padding: "4px 12px", borderRadius: 4, fontSize: 11, fontFamily: MONO, cursor: "pointer", letterSpacing: "0.04em" }}>
          {action}
        </button>
      )}
    </div>
  );
}

function Panel({ children, style }) {
  return (
    <div style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 8, padding: "20px 24px", ...style }}>
      {children}
    </div>
  );
}

export default function ExecutiveDashboard({ onNavigate }) {
  const [summary, setSummary]   = useState(null);
  const [agents, setAgents]     = useState([]);
  const [costData, setCostData] = useState(null);
  const [alerts, setAlerts]     = useState([]);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [s, a, c, al] = await Promise.allSettled([
          fetchAgentsSummary(30),
          fetchAgents({ limit: 500 }),
          fetchCostIntelligence({ breakdown_by: "agent", days: 30 }),
          fetchSecurityAlerts(),
        ]);
        if (s.status === "fulfilled" && s.value) setSummary(s.value);
        if (a.status === "fulfilled" && a.value) {
          const raw = a.value;
          setAgents(Array.isArray(raw) ? raw : raw?.agents || raw?.items || []);
        }
        if (c.status === "fulfilled" && c.value) setCostData(c.value);
        if (al.status === "fulfilled" && al.value) setAlerts(Array.isArray(al.value) ? al.value : []);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 280, color: T.textMute, fontFamily: MONO, fontSize: 13 }}>
      Loading executive overview…
    </div>
  );

  // ── Derived metrics ──────────────────────────────────────────────────────────
  const total            = (summary?.verified_agents?.total ?? 0) + (summary?.potential_agents?.total ?? 0) || agents.length;
  const managed          = summary?.managed_agents ?? summary?.verified_agents?.managed ?? 0;
  const unassigned       = summary?.verified_agents?.unassigned ?? 0;
  const needsValidation  = summary?.potential_agents?.needs_validation ?? 0;
  const retired          = summary?.retired_agents ?? 0;
  const monthlyCost      = costData?.overview?.runtime_cost?.total_usd ?? 0;

  // Lifecycle donut
  const lifecycleSlices = [
    { name: "Managed",          value: managed,         color: T.accent  },
    { name: "Unassigned",       value: unassigned,      color: T.yellow  },
    { name: "Needs Validation", value: needsValidation, color: T.warn    },
    ...(retired > 0 ? [{ name: "Retired", value: retired, color: "#555" }] : []),
  ].filter(d => d.value > 0);

  // Discovery sources
  const sourceCounts = {};
  agents.forEach(a => {
    const src = a.discovery_source || "gateway_telemetry";
    sourceCounts[src] = (sourceCounts[src] || 0) + 1;
  });
  const maxSrc = Math.max(1, ...Object.values(sourceCounts));
  const sourceList = Object.entries(sourceCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([key, count]) => ({ key, count, meta: SOURCE_META[key] || { label: key, color: T.textDim } }));

  // Top cost drivers
  const breakdown = (costData?.breakdown?.items || costData?.breakdown || []).sort((a, b) => (b.cost_usd || 0) - (a.cost_usd || 0));
  const topCosts  = breakdown.slice(0, 10);
  const otherCost = Math.max(0, monthlyCost - topCosts.reduce((s, x) => s + (x.cost_usd || 0), 0));

  // Risk signals from security alerts
  const critAlerts = alerts.filter(a => a.sev === "critical");
  const warnAlerts = alerts.filter(a => a.sev === "warning");
  const highRiskCount = new Set(critAlerts.map(a => a.entity)).size;

  const agentByKey = {};
  agents.forEach(a => {
    if (a.agent_id)   agentByKey[a.agent_id]   = a;
    if (a.agent_name) agentByKey[a.agent_name] = a;
  });

  const riskList = [];
  const seen = new Set();
  [...critAlerts, ...warnAlerts].forEach(alert => {
    if (seen.has(alert.entity)) return;
    seen.add(alert.entity);
    const ag = agentByKey[alert.entity] || null;
    riskList.push({
      entity: alert.entity,
      name:   ag?.agent_name || alert.entity,
      level:  alert.sev === "critical" ? "High" : "Medium",
      risk:   alert.msg,
      owner:  ag?.owner || "Unassigned",
      team:   ag?.team  || "Unknown",
    });
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24, fontFamily: FONT }}>

      {/* ── Brand ──────────────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: T.text, letterSpacing: "-0.025em" }}>
            AI Agent Inventory
          </h2>
          <div style={{ fontSize: 12, color: T.textMute, fontFamily: MONO, marginTop: 5 }}>
            The System of Record for Enterprise AI Operations · Powered by AI Runtime Intelligence
          </div>
        </div>
        <div style={{ fontSize: 11, color: T.textMute, fontFamily: MONO, textAlign: "right" }}>
          <div style={{ marginBottom: 3 }}>Executive Overview</div>
          <div>{new Date().toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</div>
        </div>
      </div>

      {/* ── KPI Row ──────────────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <KpiCard label="Total AI Agents"    value={total}               sub="Across all teams"                     onClick={() => onNavigate?.("agent_inventory")} />
        <KpiCard label="Managed Agents"     value={managed}             sub={total ? `${Math.round(managed / total * 100)}% of total` : "—"}  color={T.accent} onClick={() => onNavigate?.("agent_inventory")} />
        <KpiCard label="Unassigned"         value={unassigned}          sub="Requires action"                      color={unassigned  > 0 ? T.yellow : T.accent} onClick={() => onNavigate?.("governance")} />
        <KpiCard label="Needs Validation"   value={needsValidation}     sub="Requires review"                      color={needsValidation > 0 ? T.warn : T.accent} onClick={() => onNavigate?.("discovery")} />
        <KpiCard label="Monthly AI Spend"   value={fmtUSD(monthlyCost)} sub="Runtime estimate (30d)"               color={T.info} onClick={() => onNavigate?.("cost")} />
        <KpiCard label="High Risk Agents"   value={highRiskCount}       sub={highRiskCount > 0 ? "Immediate review" : "No critical risks"} color={highRiskCount > 0 ? T.crit : T.accent} onClick={() => onNavigate?.("security_intel")} />
      </div>

      {/* ── Lifecycle + Discovery ─────────────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>

        {/* Lifecycle donut */}
        <Panel>
          <SectionTitle title="Agent Lifecycle Distribution" />
          {lifecycleSlices.length > 0 ? (
            <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
              <div style={{ flexShrink: 0 }}>
                <ResponsiveContainer width={160} height={160}>
                  <PieChart>
                    <Pie data={lifecycleSlices} cx="50%" cy="50%" innerRadius={44} outerRadius={70} dataKey="value" paddingAngle={2}>
                      {lifecycleSlices.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                    </Pie>
                    <Tooltip
                      contentStyle={{ background: T.panelHi, border: `1px solid ${T.border}`, borderRadius: 6, fontFamily: MONO, fontSize: 12 }}
                      formatter={(v, n) => [`${v} agents`, n]}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10 }}>
                {lifecycleSlices.map((d, i) => (
                  <div key={i}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: T.text, marginBottom: 4 }}>
                      <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
                        <span style={{ width: 9, height: 9, borderRadius: 2, background: d.color, flexShrink: 0, display: "inline-block" }} />
                        {d.name}
                      </span>
                      <span style={{ fontFamily: MONO, color: T.textDim }}>
                        {d.value} <span style={{ fontSize: 10, color: T.textMute }}>({total > 0 ? Math.round(d.value / total * 100) : 0}%)</span>
                      </span>
                    </div>
                    <div style={{ background: T.panelHi, borderRadius: 2, height: 4 }}>
                      <div style={{ width: `${total > 0 ? (d.value / total) * 100 : 0}%`, background: d.color, height: 4, borderRadius: 2, transition: "width 0.5s" }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ color: T.textMute, fontFamily: MONO, fontSize: 12, padding: "20px 0" }}>No agent data</div>
          )}
        </Panel>

        {/* Discovery sources */}
        <Panel>
          <SectionTitle title="Agent Discovery Sources" sub={`${sourceList.length} active source${sourceList.length !== 1 ? "s" : ""} · ${total} total signals`} />
          {sourceList.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {sourceList.map(({ key, count, meta }) => (
                <div key={key}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: T.text, marginBottom: 5 }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: meta.color, flexShrink: 0, display: "inline-block" }} />
                      {meta.label}
                    </span>
                    <span style={{ fontFamily: MONO, color: T.textDim }}>{count} agents</span>
                  </div>
                  <div style={{ background: T.panelHi, borderRadius: 2, height: 6 }}>
                    <div style={{ width: `${(count / maxSrc) * 100}%`, background: meta.color, height: 6, borderRadius: 2, opacity: 0.75, transition: "width 0.5s" }} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ color: T.textMute, fontFamily: MONO, fontSize: 12, padding: "20px 0" }}>No discovery data</div>
          )}
        </Panel>
      </div>

      {/* ── Top Cost Drivers ──────────────────────────────────────────────────── */}
      <Panel>
        <SectionTitle title="Top Cost Drivers" sub="Last 30 days · runtime estimate" action="View Cost Intelligence →" onAction={() => onNavigate?.("cost")} />
        {topCosts.length > 0 ? (
          <div>
            {topCosts.map((item, i) => {
              const name = item.name || item.agent_name || item.label || item.agent_id || "—";
              const pct  = monthlyCost > 0 ? (item.cost_usd || 0) / monthlyCost : 0;
              return (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 0", borderBottom: i < topCosts.length - 1 ? `1px solid ${T.border}` : "none" }}>
                  <div style={{ width: 22, fontSize: 11, fontFamily: MONO, color: T.textMute, textAlign: "right", flexShrink: 0 }}>{i + 1}.</div>
                  <div title={name} style={{ flex: 1, fontSize: 13, color: T.text, fontFamily: MONO, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</div>
                  <div style={{ fontSize: 11, color: T.textDim, width: 80, textAlign: "center" }}>{item.team || "—"}</div>
                  <div style={{ width: 100, display: "flex", alignItems: "center", gap: 6 }}>
                    <div style={{ flex: 1, background: T.panelHi, borderRadius: 2, height: 4 }}>
                      <div style={{ width: `${Math.min(100, pct * 100)}%`, background: T.info, height: 4, borderRadius: 2 }} />
                    </div>
                    <span style={{ fontSize: 10, fontFamily: MONO, color: T.textMute, width: 32, textAlign: "right" }}>{Math.round(pct * 100)}%</span>
                  </div>
                  <div style={{ width: 80, textAlign: "right", fontFamily: MONO, fontSize: 13, color: T.text }}>{fmtUSD(item.cost_usd)}</div>
                </div>
              );
            })}
            {otherCost > 1 && (
              <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 0", borderTop: `1px solid ${T.border}` }}>
                <div style={{ width: 22, fontSize: 11, fontFamily: MONO, color: T.textMute, textAlign: "right" }}>…</div>
                <div style={{ flex: 1, fontSize: 12, color: T.textMute, fontFamily: MONO }}>Others ({Math.max(0, total - topCosts.length)} agents)</div>
                <div style={{ width: 80 }} />
                <div style={{ width: 100 }} />
                <div style={{ width: 80, textAlign: "right", fontFamily: MONO, fontSize: 12, color: T.textMute }}>{fmtUSD(otherCost)}</div>
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12, paddingTop: 12, borderTop: `1px solid ${T.border}` }}>
              <span style={{ fontFamily: MONO, fontSize: 13, color: T.textDim }}>
                Total Monthly (Est):&nbsp;
                <strong style={{ color: T.text, fontSize: 15 }}>{fmtUSD(monthlyCost)}</strong>
              </span>
            </div>
          </div>
        ) : (
          <div style={{ color: T.textMute, fontFamily: MONO, fontSize: 12 }}>No cost data for the last 30 days</div>
        )}
      </Panel>

      {/* ── High Risk + Action Items ───────────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "3fr 2fr", gap: 16 }}>

        {/* High Risk Agents */}
        <Panel>
          <SectionTitle title="High Risk Agents" sub="Requires immediate action" action="View Security →" onAction={() => onNavigate?.("security_intel")} />
          {riskList.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {riskList.slice(0, 5).map((a, i) => (
                <div key={i} style={{
                  padding: "12px 14px", background: T.panelHi, borderRadius: 6,
                  border: `1px solid ${a.level === "High" ? T.crit + "44" : T.warn + "44"}`,
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 10, color: a.level === "High" ? T.crit : T.warn }}>●</span>
                    <span style={{ fontSize: 13, fontWeight: 500, color: T.text, fontFamily: MONO }}>{a.name}</span>
                    <span style={{
                      fontSize: 10, padding: "2px 7px", borderRadius: 10, fontFamily: MONO,
                      color: a.level === "High" ? T.crit : T.warn,
                      background: a.level === "High" ? T.crit + "1A" : T.warn + "1A",
                    }}>{a.level} Risk</span>
                  </div>
                  <div style={{ fontSize: 12, color: T.textMute, marginBottom: 6, marginLeft: 16 }}>{a.risk}</div>
                  <div style={{ fontSize: 11, color: T.textDim, fontFamily: MONO, marginLeft: 16, marginBottom: 8 }}>
                    Owner: {a.owner} · Team: {a.team}
                  </div>
                  <div style={{ display: "flex", gap: 8, marginLeft: 16 }}>
                    <button onClick={() => onNavigate?.("security_intel")} style={{ background: "transparent", border: `1px solid ${T.border}`, color: T.textDim, padding: "3px 10px", borderRadius: 4, fontSize: 11, fontFamily: MONO, cursor: "pointer" }}>
                      Review Risk
                    </button>
                    {a.owner === "Unassigned" && (
                      <button onClick={() => onNavigate?.("governance")} style={{ background: "transparent", border: `1px solid ${T.border}`, color: T.textDim, padding: "3px 10px", borderRadius: 4, fontSize: 11, fontFamily: MONO, cursor: "pointer" }}>
                        Assign Owner
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 10, color: T.accent, fontFamily: MONO, fontSize: 13, padding: "16px 0" }}>
              <span style={{ fontSize: 18 }}>✓</span> No high risk agents detected
            </div>
          )}
        </Panel>

        {/* Action Items */}
        <Panel>
          <SectionTitle title="Action Items" />
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {[
              { count: critAlerts.length,     label: "need review",     color: T.crit,   prefix: "Critical", nav: "security_intel", btn: "Resolve" },
              { count: warnAlerts.length,     label: "need attention",  color: T.warn,   prefix: "Warning",  nav: "security_intel", btn: "View" },
              { count: needsValidation,       label: "need validation", color: T.yellow, prefix: "Info",     nav: "discovery",      btn: "Review" },
              { count: unassigned,            label: "unassigned",      color: T.yellow, prefix: "Info",     nav: "governance",     btn: "Assign" },
            ].filter(x => x.count > 0).map(({ count, label, color, prefix, nav, btn }, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 13px", background: color + "0D", border: `1px solid ${color}33`, borderRadius: 6 }}>
                <span style={{ fontSize: 10, color, flexShrink: 0 }}>● {prefix}</span>
                <span style={{ flex: 1, fontSize: 12, color: T.text }}>{count} agent{count !== 1 ? "s" : ""} {label}</span>
                <button onClick={() => onNavigate?.(nav)} style={{ background: "transparent", border: `1px solid ${color}55`, color, padding: "3px 10px", borderRadius: 4, fontSize: 11, fontFamily: MONO, cursor: "pointer", flexShrink: 0 }}>
                  {btn}
                </button>
              </div>
            ))}
            {critAlerts.length === 0 && warnAlerts.length === 0 && needsValidation === 0 && unassigned === 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, color: T.accent, fontFamily: MONO, fontSize: 13, padding: "16px 0" }}>
                <span style={{ fontSize: 18 }}>✓</span> No action items
              </div>
            )}
          </div>

          {/* Governance coverage */}
          <div style={{ marginTop: 20, paddingTop: 16, borderTop: `1px solid ${T.border}` }}>
            <div style={{ fontSize: 9, color: T.textMute, fontFamily: MONO, letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 12 }}>Governance Coverage</div>
            {[
              { label: "Ownership",   pct: total > 0 ? Math.round(managed / total * 100) : 0, color: T.accent, target: 90 },
              { label: "Validated",   pct: total > 0 ? Math.round((total - needsValidation) / total * 100) : 0, color: T.info, target: 95 },
            ].map(({ label, pct, color, target }) => (
              <div key={label} style={{ marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: T.textDim, marginBottom: 5 }}>
                  <span>{label}</span>
                  <span style={{ fontFamily: MONO }}>
                    <span style={{ color }}>{pct}%</span>
                    <span style={{ color: T.textMute }}> / {target}% target</span>
                  </span>
                </div>
                <div style={{ background: T.panelHi, borderRadius: 2, height: 5, position: "relative" }}>
                  <div style={{ width: `${pct}%`, background: color, height: 5, borderRadius: 2, transition: "width 0.5s" }} />
                  <div style={{ position: "absolute", top: -1, left: `${target}%`, width: 1, height: 7, background: T.textMute, opacity: 0.5 }} />
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}
