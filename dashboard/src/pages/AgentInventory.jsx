import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  fetchAgents, fetchAgentsSummary,
  claimInventoryAgent, validateInventoryAgent, rejectInventoryAgent,
  updateInventoryAgent, fetchOrgConfig,
} from "../api.js";

// ─── Design tokens — mirror App.jsx T ────────────────────────────────────────
const T = {
  bg: "#0A0B0F", panel: "#0F1117", panelHi: "#141823",
  border: "#1E2230", borderHi: "#2A3142",
  text: "#E8ECF4", textDim: "#7A8499", textMute: "#4B5468",
  accent: "#7CFFB2", accentDim: "#3A7A5C",
  warn: "#FFB547", crit: "#FF5C7A", info: "#6FA8FF", purple: "#B47AFF",
};
const FONT_UI   = "'Geist','Söhne',-apple-system,BlinkMacSystemFont,sans-serif";
const FONT_MONO = "'JetBrains Mono','IBM Plex Mono',ui-monospace,SFMono-Regular,monospace";

// ─── Formatters ───────────────────────────────────────────────────────────────
const fmtCost = (v) =>
  "$" + (+(v || 0)).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function relativeTime(iso) {
  if (!iso) return "—";
  const diff  = Date.now() - new Date(iso).getTime();
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (mins  <  2) return "just now";
  if (mins  < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days  < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ─── Shared primitives ────────────────────────────────────────────────────────
function KpiCard({ label, value, sub, color }) {
  return (
    <div style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 8, padding: "18px 20px", flex: 1, minWidth: 140 }}>
      <div style={{ fontSize: 10, fontFamily: FONT_MONO, color: T.textMute, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 600, color: color || T.text, letterSpacing: "-0.02em", lineHeight: 1 }}>{value ?? "—"}</div>
      {sub && <div style={{ fontSize: 11, color: T.textMute, fontFamily: FONT_MONO, marginTop: 6 }}>{sub}</div>}
    </div>
  );
}

function DiscoveryBadge({ source }) {
  const map = {
    gateway_telemetry: { label: "Gateway",  color: T.accent,  bg: "#1A3D2B" },
    github:            { label: "GitHub",   color: T.info,    bg: "#0D1F3D" },
    jira:              { label: "Jira",     color: T.purple,  bg: "#1E1A3D" },
    servicenow:        { label: "ServiceNow", color: T.warn,  bg: "#3D2E0D" },
    slack:             { label: "Slack",    color: "#E8A138", bg: "#3D2A0D" },
    mcp:               { label: "MCP",      color: T.purple,  bg: "#1E1A3D" },
    cloud_functions:   { label: "Cloud Fn", color: T.info,    bg: "#0D1F3D" },
  };
  const m = map[source] || { label: source || "Unknown", color: T.textMute, bg: T.panelHi };
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      background: m.bg, color: m.color, border: `1px solid ${m.color}33`,
      fontSize: 10, fontFamily: FONT_MONO, fontWeight: 600,
      padding: "2px 8px", borderRadius: 20, textTransform: "uppercase", letterSpacing: "0.05em",
    }}>
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: m.color }} />
      {m.label}
    </span>
  );
}

function LifecycleBadge({ status }) {
  const map = {
    unassigned:       { label: "Unassigned",       color: T.warn,    bg: "#3D2E0D" },
    needs_validation: { label: "Needs Validation",  color: T.purple,  bg: "#1E1A3D" },
    managed:          { label: "Managed",           color: T.accent,  bg: "#1A3D2B" },
    retired:          { label: "Retired",           color: T.textMute, bg: T.panelHi },
  };
  const m = map[status] || { label: status, color: T.textMute, bg: T.panelHi };
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      background: m.bg, color: m.color,
      fontSize: 10, fontFamily: FONT_MONO, fontWeight: 600,
      padding: "2px 8px", borderRadius: 4, textTransform: "uppercase", letterSpacing: "0.04em",
    }}>
      {m.label}
    </span>
  );
}

const StatusPill = ({ status }) => {
  const map = { active: [T.accent, "#1A3D2B"], dormant: [T.warn, "#3D2E0D"], inactive: [T.textDim, T.panelHi] };
  const [c, bg] = map[status] || [T.textMute, T.panelHi];
  return <span style={{ background: bg, color: c, fontSize: 11, fontFamily: FONT_MONO, padding: "2px 8px", borderRadius: 4, fontWeight: 600, textTransform: "capitalize" }}>{status || "—"}</span>;
};

const RiskChip = ({ risk }) => {
  const map = { high: [T.crit, "#3D0F1A"], medium: [T.warn, "#3D2E0D"], low: [T.accent, "#1A3D2B"] };
  const [c, bg] = map[risk] || [T.textMute, T.panelHi];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, background: bg, color: c, fontSize: 11, fontFamily: FONT_MONO, padding: "2px 8px", borderRadius: 4, fontWeight: 600, textTransform: "capitalize" }}>
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: c }} />{risk || "—"}
    </span>
  );
};

function ConfidenceBar({ score }) {
  const pct = Math.min(100, Math.max(0, score || 0));
  const color = pct >= 80 ? T.accent : pct >= 50 ? T.warn : T.crit;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ flex: 1, height: 4, background: T.panelHi, borderRadius: 2, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 2 }} />
      </div>
      <span style={{ fontSize: 11, fontFamily: FONT_MONO, color, minWidth: 32 }}>{pct.toFixed(0)}%</span>
    </div>
  );
}

function EvidenceChips({ evidence = {} }) {
  const signals = evidence.signals || evidence.discovery_time_signals ? [] : [];
  const chunks = [
    ...(evidence.signals || []),
    evidence.agent_version ? `version ${evidence.agent_version}` : null,
    evidence.team_hint    ? `team hint: ${evidence.team_hint}` : null,
  ].filter(Boolean);
  if (chunks.length === 0 && evidence.discovery_time_signals) {
    const s = evidence.discovery_time_signals;
    if (s.agent_version)     chunks.push(`version ${s.agent_version}`);
    if (s.team_hint)         chunks.push(`team: ${s.team_hint}`);
    if (s.environment_hint)  chunks.push(`env: ${s.environment_hint}`);
  }
  if (chunks.length === 0) return <span style={{ fontSize: 11, color: T.textMute, fontFamily: FONT_MONO }}>Gateway traffic</span>;
  return (
    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
      {chunks.slice(0, 4).map((c, i) => (
        <span key={i} style={{ fontSize: 9, fontFamily: FONT_MONO, color: T.purple, border: `1px solid ${T.purple}44`, padding: "1px 6px", borderRadius: 3 }}>{c}</span>
      ))}
    </div>
  );
}

// ─── Sort utility ─────────────────────────────────────────────────────────────
const RISK_RANK     = { high: 3, medium: 2, low: 1 };
const STATUS_RANK   = { active: 3, dormant: 2, inactive: 1 };

function sortAgents(list, key, dir) {
  if (!key) return list;
  const mul = dir === "asc" ? 1 : -1;
  return [...list].sort((a, b) => {
    let va = a[key], vb = b[key];
    if (key === "risk")            { va = RISK_RANK[va]   ?? 0; vb = RISK_RANK[vb]   ?? 0; }
    else if (key === "status")     { va = STATUS_RANK[va] ?? 0; vb = STATUS_RANK[vb] ?? 0; }
    else if (key === "monthly_cost_usd" || key === "confidence_score") { va = +(va || 0); vb = +(vb || 0); }
    else if (key === "last_seen" || key === "first_seen") {
      va = va ? new Date(va).getTime() : 0;
      vb = vb ? new Date(vb).getTime() : 0;
    }
    if (typeof va === "number" && typeof vb === "number") return (va - vb) * mul;
    return String(va || "").toLowerCase().localeCompare(String(vb || "").toLowerCase()) * mul;
  });
}

function useSort(defaultKey, defaultDir = "desc") {
  const [sort, setSort] = useState({ key: defaultKey, dir: defaultDir });
  const toggle = (key) => setSort(s => s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" });
  return [sort, toggle];
}

const Th = ({ label, sortKey, sort, onSort, style: s = {} }) => {
  const active = sort?.key === sortKey;
  const canSort = !!sortKey;
  return (
    <th
      onClick={canSort ? () => onSort(sortKey) : undefined}
      style={{
        padding: "10px 14px", textAlign: "left", fontSize: 10, fontFamily: FONT_MONO,
        color: active ? T.accent : T.textMute,
        letterSpacing: "0.1em", textTransform: "uppercase",
        borderBottom: `1px solid ${T.border}`, background: T.panel,
        whiteSpace: "nowrap", cursor: canSort ? "pointer" : "default",
        userSelect: "none", transition: "color 0.12s",
        ...s,
      }}
    >
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
        {label}
        {canSort && (
          <span style={{ fontSize: 9, color: active ? T.accent : T.textMute, opacity: active ? 1 : 0.4, lineHeight: 1 }}>
            {active ? (sort.dir === "asc" ? "▲" : "▼") : "⇅"}
          </span>
        )}
      </span>
    </th>
  );
};

const Td = ({ children, style: s = {} }) => (
  <td style={{ padding: "11px 14px", borderBottom: `1px solid ${T.border}`, ...s }}>{children}</td>
);

function ActionBtn({ label, color = T.accent, bg, onClick, disabled }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      background: bg || `${color}15`, border: `1px solid ${color}44`, color,
      padding: "4px 10px", borderRadius: 4, fontSize: 11, fontFamily: FONT_MONO,
      cursor: disabled ? "not-allowed" : "pointer", fontWeight: 600, opacity: disabled ? 0.5 : 1,
      whiteSpace: "nowrap",
    }}>{label}</button>
  );
}

function SearchBar({ value, onChange, placeholder }) {
  return (
    <div style={{ position: "relative", flex: "1 1 200px", minWidth: 160 }}>
      <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: T.textMute, pointerEvents: "none" }}>⌕</span>
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder || "Search…"}
        style={{ width: "100%", background: T.panelHi, border: `1px solid ${T.border}`, color: T.text, padding: "7px 10px 7px 28px", borderRadius: 5, fontSize: 13, fontFamily: FONT_UI, outline: "none" }} />
    </div>
  );
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────
function TabBar({ active, tabs, onChange }) {
  return (
    <div style={{ display: "flex", gap: 2, borderBottom: `1px solid ${T.border}`, marginBottom: 16 }}>
      {tabs.map(t => (
        <button key={t.id} onClick={() => onChange(t.id)} style={{
          background: "transparent", border: "none",
          borderBottom: active === t.id ? `2px solid ${T.accent}` : "2px solid transparent",
          color: active === t.id ? T.text : T.textDim,
          padding: "10px 16px", fontSize: 13, fontFamily: FONT_UI, cursor: "pointer",
          display: "flex", alignItems: "center", gap: 8, whiteSpace: "nowrap",
        }}>
          {t.label}
          {t.count != null && (
            <span style={{
              background: active === t.id ? T.accent : T.panelHi,
              color: active === t.id ? T.bg : T.textMute,
              fontSize: 10, fontFamily: FONT_MONO, fontWeight: 600,
              padding: "1px 7px", borderRadius: 20,
            }}>{t.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}

// ─── Table: Verified Agents ──────────────────────────────────────────────────
function VerifiedTable({ agents, onClaim, onEdit }) {
  const [sort, toggle] = useSort("monthly_cost_usd", "desc");
  const sorted = sortAgents(agents, sort.key, sort.dir);
  if (agents.length === 0) {
    return <EmptyState message="No verified agents in this view." />;
  }
  const sp = { sort, onSort: toggle };
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead><tr>
          <Th label="Agent"        sortKey="name"             {...sp} style={{ paddingLeft: 20 }} />
          <Th label="Source"       sortKey="discovery_source" {...sp} />
          <Th label="Team"         sortKey="team"             {...sp} />
          <Th label="Environment"  sortKey="environment"      {...sp} />
          <Th label="Owner"        sortKey="owner"            {...sp} />
          <Th label="Status"       sortKey="status"           {...sp} />
          <Th label="Risk"         sortKey="risk"             {...sp} />
          <Th label="Monthly Cost" sortKey="monthly_cost_usd" {...sp} style={{ textAlign: "right" }} />
          <Th label="Last Seen"    sortKey="last_seen"        {...sp} />
          <Th label="" />
        </tr></thead>
        <tbody>
          {sorted.map((a, i) => (
            <tr key={a.id} style={{ background: i % 2 === 0 ? T.panel : "#0C0E14" }}
              onMouseEnter={e => e.currentTarget.style.background = T.panelHi}
              onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? T.panel : "#0C0E14"}>
              <Td style={{ paddingLeft: 20 }}>
                <div style={{ fontSize: 13, fontFamily: FONT_MONO, color: T.text, fontWeight: 500 }}>{a.name}</div>
                <div style={{ marginTop: 4 }}><LifecycleBadge status={a.lifecycle_status} /></div>
              </Td>
              <Td><DiscoveryBadge source={a.discovery_source} /></Td>
              <Td><span style={{ fontSize: 12, color: T.textDim, fontFamily: FONT_MONO }}>{a.team}</span></Td>
              <Td>
                {a.environment && a.environment !== "Unknown"
                  ? <span style={{ fontSize: 11, fontFamily: FONT_MONO, color: T.info, background: "#0D1F3D", padding: "2px 7px", borderRadius: 3 }}>{a.environment}</span>
                  : <span style={{ fontSize: 11, color: T.textMute }}>—</span>}
              </Td>
              <Td>
                {a.owner === "Unassigned"
                  ? <span style={{ fontSize: 11, fontFamily: FONT_MONO, color: T.warn, background: "#3D2E0D", padding: "2px 7px", borderRadius: 3 }}>Unassigned</span>
                  : <span style={{ fontSize: 12, color: T.textDim }}>{a.owner}</span>}
              </Td>
              <Td><StatusPill status={a.status} /></Td>
              <Td><RiskChip risk={a.risk} /></Td>
              <Td style={{ textAlign: "right" }}>
                <span style={{ fontSize: 13, fontFamily: FONT_MONO, color: a.monthly_cost_usd > 0 ? T.text : T.textMute }}>
                  {fmtCost(a.monthly_cost_usd)}
                </span>
              </Td>
              <Td><span style={{ fontSize: 11, fontFamily: FONT_MONO, color: T.textDim }}>{relativeTime(a.last_seen)}</span></Td>
              <Td>
                <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                  {a.lifecycle_status === "unassigned" && (
                    <ActionBtn label="Claim →" color={T.accent} onClick={() => onClaim(a)} />
                  )}
                  {onEdit && <ActionBtn label="Edit" color={T.info} onClick={() => onEdit(a)} />}
                </div>
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Table: Potential Agents ──────────────────────────────────────────────────
function PotentialTable({ agents, onValidate, onReject, onEdit }) {
  const [sort, toggle] = useSort("confidence_score", "desc");
  const sorted = sortAgents(agents, sort.key, sort.dir);
  if (agents.length === 0) {
    return (
      <div style={{ padding: "48px 24px", textAlign: "center" }}>
        <div style={{ fontSize: 32, marginBottom: 16 }}>🔭</div>
        <div style={{ fontSize: 15, color: T.text, fontWeight: 500, marginBottom: 8 }}>No potential agents detected</div>
        <div style={{ fontSize: 13, color: T.textMute, maxWidth: 480, margin: "0 auto", lineHeight: 1.7 }}>
          Connect platform integrations to discover potential agents from GitHub, Jira, Slack, and more.
          <br />
          <span style={{ fontSize: 11, fontFamily: FONT_MONO, color: T.purple }}>Phase 4: Ecosystem Discovery</span>
        </div>
      </div>
    );
  }
  const sp = { sort, onSort: toggle };
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead><tr>
          <Th label="Detected Agent"  sortKey="name"             {...sp} style={{ paddingLeft: 20 }} />
          <Th label="Source"          sortKey="discovery_source" {...sp} />
          <Th label="Confidence"      sortKey="confidence_score" {...sp} style={{ minWidth: 140 }} />
          <Th label="Evidence" />
          <Th label="First Detected"  sortKey="first_seen"       {...sp} />
          <Th label="" style={{ minWidth: 160 }} />
        </tr></thead>
        <tbody>
          {sorted.map((a, i) => (
            <tr key={a.id} style={{ background: i % 2 === 0 ? T.panel : "#0C0E14" }}
              onMouseEnter={e => e.currentTarget.style.background = T.panelHi}
              onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? T.panel : "#0C0E14"}>
              <Td style={{ paddingLeft: 20 }}>
                <div title={a.name} style={{ fontSize: 13, fontFamily: FONT_MONO, color: T.text }}>{a.name}</div>
                {a.discovery_reason && (
                  <div title={a.discovery_reason} style={{ fontSize: 11, color: T.textMute, marginTop: 3 }}>{a.discovery_reason}</div>
                )}
              </Td>
              <Td><DiscoveryBadge source={a.discovery_source} /></Td>
              <Td><ConfidenceBar score={a.confidence_score} /></Td>
              <Td><EvidenceChips evidence={a.evidence} /></Td>
              <Td><span style={{ fontSize: 11, fontFamily: FONT_MONO, color: T.textDim }}>{relativeTime(a.first_seen)}</span></Td>
              <Td>
                <div style={{ display: "flex", gap: 6 }}>
                  <ActionBtn label="Validate ✓" color={T.accent} onClick={() => onValidate(a)} />
                  <ActionBtn label="Reject ✗"  color={T.crit}  onClick={() => onReject(a)} />
                  {onEdit && <ActionBtn label="Edit" color={T.info} onClick={() => onEdit(a)} />}
                </div>
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Table: Managed Agents ────────────────────────────────────────────────────
function ManagedTable({ agents, onEdit }) {
  const [sort, toggle] = useSort("monthly_cost_usd", "desc");
  const sorted = sortAgents(agents, sort.key, sort.dir);
  if (agents.length === 0) return <EmptyState message="No managed agents yet. Claim verified agents to see them here." />;
  const sp = { sort, onSort: toggle };
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead><tr>
          <Th label="Agent"        sortKey="name"             {...sp} style={{ paddingLeft: 20 }} />
          <Th label="Owner"        sortKey="owner"            {...sp} />
          <Th label="Team"         sortKey="team"             {...sp} />
          <Th label="Environment"  sortKey="environment"      {...sp} />
          <Th label="Criticality"  sortKey="criticality"      {...sp} />
          <Th label="Monthly Cost" sortKey="monthly_cost_usd" {...sp} style={{ textAlign: "right" }} />
          <Th label="Last Seen"    sortKey="last_seen"        {...sp} />
          {onEdit && <Th label="" />}
        </tr></thead>
        <tbody>
          {sorted.map((a, i) => (
            <tr key={a.id} style={{ background: i % 2 === 0 ? T.panel : "#0C0E14" }}
              onMouseEnter={e => e.currentTarget.style.background = T.panelHi}
              onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? T.panel : "#0C0E14"}>
              <Td style={{ paddingLeft: 20 }}>
                <div style={{ fontSize: 13, fontFamily: FONT_MONO, color: T.text, fontWeight: 500 }}>{a.name}</div>
                {a.business_purpose && (
                  <div title={a.business_purpose} style={{ fontSize: 11, color: T.textMute, marginTop: 3, maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.business_purpose}</div>
                )}
              </Td>
              <Td><span style={{ fontSize: 12, color: T.textDim }}>{a.owner}</span></Td>
              <Td><span style={{ fontSize: 12, color: T.textDim, fontFamily: FONT_MONO }}>{a.team}</span></Td>
              <Td>
                {a.environment && a.environment !== "Unknown"
                  ? <span style={{ fontSize: 11, fontFamily: FONT_MONO, color: T.info, background: "#0D1F3D", padding: "2px 7px", borderRadius: 3 }}>{a.environment}</span>
                  : <span style={{ fontSize: 11, color: T.textMute }}>—</span>}
              </Td>
              <Td>
                {a.criticality
                  ? <span style={{ fontSize: 11, fontFamily: FONT_MONO, color: a.criticality === "critical" ? T.crit : a.criticality === "high" ? T.warn : T.textDim, textTransform: "capitalize" }}>{a.criticality}</span>
                  : <span style={{ fontSize: 11, color: T.textMute }}>—</span>}
              </Td>
              <Td style={{ textAlign: "right" }}>
                <span style={{ fontSize: 13, fontFamily: FONT_MONO, color: a.monthly_cost_usd > 0 ? T.text : T.textMute }}>{fmtCost(a.monthly_cost_usd)}</span>
              </Td>
              <Td><span style={{ fontSize: 11, fontFamily: FONT_MONO, color: T.textDim }}>{relativeTime(a.last_seen)}</span></Td>
              {onEdit && <Td><ActionBtn label="Edit" color={T.info} onClick={() => onEdit(a)} /></Td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Table: Retired Agents ────────────────────────────────────────────────────
function RetiredTable({ agents, onEdit }) {
  const [sort, toggle] = useSort("last_seen", "desc");
  const sorted = sortAgents(agents, sort.key, sort.dir);
  if (agents.length === 0) return <EmptyState message="No retired agents." />;
  const sp = { sort, onSort: toggle };
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead><tr>
          <Th label="Agent"            sortKey="name"             {...sp} style={{ paddingLeft: 20 }} />
          <Th label="Discovery Source" sortKey="discovery_source" {...sp} />
          <Th label="Owner"            sortKey="owner"            {...sp} />
          <Th label="Purpose / Reason" />
          <Th label="Last Active"      sortKey="last_seen"        {...sp} />
          {onEdit && <Th label="" />}
        </tr></thead>
        <tbody>
          {sorted.map((a, i) => (
            <tr key={a.id} style={{ background: i % 2 === 0 ? T.panel : "#0C0E14", opacity: 0.7 }}
              onMouseEnter={e => { e.currentTarget.style.background = T.panelHi; e.currentTarget.style.opacity = "1"; }}
              onMouseLeave={e => { e.currentTarget.style.background = i % 2 === 0 ? T.panel : "#0C0E14"; e.currentTarget.style.opacity = "0.7"; }}>
              <Td style={{ paddingLeft: 20 }}>
                <div style={{ fontSize: 13, fontFamily: FONT_MONO, color: T.textMute }}>{a.name}</div>
                <div style={{ marginTop: 4 }}><LifecycleBadge status="retired" /></div>
              </Td>
              <Td><DiscoveryBadge source={a.discovery_source} /></Td>
              <Td><span style={{ fontSize: 12, color: T.textMute }}>{a.owner === "Unassigned" ? "—" : a.owner}</span></Td>
              <Td>
                <span title={a.business_purpose || undefined} style={{ fontSize: 11, color: T.textMute, maxWidth: 280, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {a.business_purpose || "—"}
                </span>
              </Td>
              <Td><span style={{ fontSize: 11, fontFamily: FONT_MONO, color: T.textMute }}>{relativeTime(a.last_seen)}</span></Td>
              {onEdit && <Td><ActionBtn label="Edit" color={T.info} onClick={() => onEdit(a)} /></Td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EmptyState({ message }) {
  return (
    <div style={{ padding: "48px 24px", textAlign: "center", color: T.textMute, fontFamily: FONT_MONO, fontSize: 13 }}>{message}</div>
  );
}

// ─── Modals ───────────────────────────────────────────────────────────────────
function ModalOverlay({ onClose, children }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 24 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 10, padding: 28, width: "100%", maxWidth: 520, maxHeight: "90vh", overflowY: "auto", fontFamily: FONT_UI }}>
        {children}
      </div>
    </div>
  );
}

function ModalField({ label, children, required }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: "block", fontSize: 11, fontFamily: FONT_MONO, color: T.textMute, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 5 }}>
        {label}{required && <span style={{ color: T.crit }}> *</span>}
      </label>
      {children}
    </div>
  );
}

const inputStyle = { width: "100%", background: T.panelHi, border: `1px solid ${T.border}`, color: T.text, padding: "8px 10px", borderRadius: 5, fontSize: 13, fontFamily: FONT_UI, outline: "none", boxSizing: "border-box" };

function ClaimModal({ agent, onSave, onClose, saving, environments = ["production","staging","development"], error }) {
  const [form, setForm] = useState({ owner: "", team: agent?.team !== "Unknown" ? (agent?.team || "") : "", environment: agent?.environment !== "Unknown" ? (agent?.environment || "") : "", criticality: "", business_purpose: "" });
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));
  const canSubmit = form.owner.trim() || form.team.trim();

  return (
    <ModalOverlay onClose={onClose}>
      <div style={{ fontSize: 17, fontWeight: 500, marginBottom: 4 }}>Claim Agent</div>
      <div style={{ fontSize: 12, color: T.textMute, fontFamily: FONT_MONO, marginBottom: 20 }}>Assign ownership to <strong>{agent?.name}</strong></div>
      {error && <div style={{ background: "#FF5C7A18", border: "1px solid #FF5C7A44", borderRadius: 5, padding: "8px 12px", marginBottom: 14, fontSize: 12, color: "#FF5C7A", fontFamily: FONT_MONO }}>{error}</div>}

      <div style={{ background: T.panelHi, border: `1px solid ${T.border}`, borderRadius: 6, padding: "10px 14px", marginBottom: 20, fontSize: 11, color: T.textMute, fontFamily: FONT_MONO }}>
        <div><span style={{ color: T.accent }}>●</span> Source: {agent?.discovery_source?.replace(/_/g, " ") || "gateway"}</div>
        <div><span style={{ color: T.accent }}>●</span> Confidence: {(agent?.confidence_score || 95).toFixed(0)}%</div>
        <div style={{ marginTop: 6, fontSize: 10, color: T.textMute }}>Claiming only writes to the registry. Historical telemetry is never modified.</div>
      </div>

      <ModalField label="Owner">
        <input style={inputStyle} value={form.owner} onChange={set("owner")} placeholder="owner@company.com" />
        <div style={{ fontSize: 10, color: T.textMute, fontFamily: FONT_MONO, marginTop: 4 }}>Unknown individual? Leave blank and assign to the team below.</div>
      </ModalField>
      <ModalField label="Team"><input style={inputStyle} value={form.team} onChange={set("team")} placeholder={agent?.team !== "Unknown" ? agent?.team : "engineering"} /></ModalField>
      <ModalField label="Environment">
        <select style={{ ...inputStyle, appearance: "none" }} value={form.environment} onChange={set("environment")}>
          <option value="">Select…</option>
          {environments.map(e => <option key={e} value={e}>{e.charAt(0).toUpperCase() + e.slice(1)}</option>)}
        </select>
      </ModalField>
      <ModalField label="Criticality">
        <select style={{ ...inputStyle, appearance: "none" }} value={form.criticality} onChange={set("criticality")}>
          <option value="">Select…</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
      </ModalField>
      <ModalField label="Business Purpose">
        <textarea style={{ ...inputStyle, minHeight: 72, resize: "vertical" }} value={form.business_purpose} onChange={set("business_purpose")} placeholder="What does this agent do?" />
      </ModalField>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 8 }}>
        <button onClick={onClose} style={{ background: "transparent", border: `1px solid ${T.border}`, color: T.textDim, padding: "8px 16px", borderRadius: 5, fontSize: 13, cursor: "pointer", fontFamily: FONT_UI }}>Cancel</button>
        <button onClick={() => onSave(agent.id, form)} disabled={!canSubmit || saving} style={{ background: T.accent, border: "none", color: T.bg, padding: "8px 20px", borderRadius: 5, fontSize: 13, fontWeight: 600, cursor: canSubmit && !saving ? "pointer" : "not-allowed", opacity: !canSubmit || saving ? 0.6 : 1, fontFamily: FONT_UI }}>
          {saving ? "Claiming…" : "Claim Agent →"}
        </button>
      </div>
    </ModalOverlay>
  );
}

function ValidateModal({ agent, onSave, onClose, saving, environments = ["production","staging","development"] }) {
  const [form, setForm] = useState({ confirmed_agent_name: agent?.name || "", owner: "", team: "", environment: "", criticality: "", business_purpose: "" });
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  return (
    <ModalOverlay onClose={onClose}>
      <div style={{ fontSize: 17, fontWeight: 500, marginBottom: 4 }}>Validate Potential Agent</div>
      <div style={{ fontSize: 12, color: T.textMute, fontFamily: FONT_MONO, marginBottom: 4 }}>{agent?.name}</div>
      <div style={{ marginBottom: 16 }}><DiscoveryBadge source={agent?.discovery_source} /></div>

      <div style={{ background: "#1E1A3D", border: `1px solid ${T.purple}33`, borderRadius: 6, padding: "10px 14px", marginBottom: 20 }}>
        <div style={{ fontSize: 11, fontFamily: FONT_MONO, color: T.purple, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.08em" }}>Evidence</div>
        <EvidenceChips evidence={agent?.evidence} />
        {agent?.discovery_reason && <div style={{ fontSize: 11, color: T.textMute, marginTop: 8 }}>{agent.discovery_reason}</div>}
      </div>

      <ModalField label="Confirmed Agent Name" required><input style={inputStyle} value={form.confirmed_agent_name} onChange={set("confirmed_agent_name")} /></ModalField>
      <ModalField label="Owner" required><input style={inputStyle} value={form.owner} onChange={set("owner")} placeholder="owner@company.com" /></ModalField>
      <ModalField label="Team"><input style={inputStyle} value={form.team} onChange={set("team")} /></ModalField>
      <ModalField label="Environment">
        <select style={{ ...inputStyle, appearance: "none" }} value={form.environment} onChange={set("environment")}>
          <option value="">Select…</option>
          {environments.map(e => <option key={e} value={e}>{e.charAt(0).toUpperCase() + e.slice(1)}</option>)}
        </select>
      </ModalField>
      <ModalField label="Criticality">
        <select style={{ ...inputStyle, appearance: "none" }} value={form.criticality} onChange={set("criticality")}>
          <option value="">Select…</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
      </ModalField>
      <ModalField label="Business Purpose">
        <textarea style={{ ...inputStyle, minHeight: 72, resize: "vertical" }} value={form.business_purpose} onChange={set("business_purpose")} />
      </ModalField>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 8 }}>
        <button onClick={onClose} style={{ background: "transparent", border: `1px solid ${T.border}`, color: T.textDim, padding: "8px 16px", borderRadius: 5, fontSize: 13, cursor: "pointer", fontFamily: FONT_UI }}>Cancel</button>
        <button onClick={() => onSave(agent.id, form)} disabled={!form.owner || saving} style={{ background: T.accent, border: "none", color: T.bg, padding: "8px 20px", borderRadius: 5, fontSize: 13, fontWeight: 600, cursor: form.owner && !saving ? "pointer" : "not-allowed", opacity: !form.owner || saving ? 0.6 : 1, fontFamily: FONT_UI }}>
          {saving ? "Validating…" : "Validate & Claim →"}
        </button>
      </div>
    </ModalOverlay>
  );
}

function RejectModal({ agent, onSave, onClose, saving }) {
  const [reason, setReason] = useState("");
  return (
    <ModalOverlay onClose={onClose}>
      <div style={{ fontSize: 17, fontWeight: 500, marginBottom: 4 }}>Reject Potential Agent</div>
      <div style={{ fontSize: 12, color: T.textMute, fontFamily: FONT_MONO, marginBottom: 20 }}>{agent?.name}</div>

      <div style={{ background: "#3D0F1A", border: `1px solid ${T.crit}33`, borderRadius: 6, padding: "10px 14px", marginBottom: 20, fontSize: 12, color: T.textDim }}>
        Rejecting marks this agent as retired. It will no longer appear in active inventory, but the registry record is preserved for audit history.
      </div>

      <ModalField label="Rejection Reason">
        <textarea style={{ ...inputStyle, minHeight: 80, resize: "vertical" }} value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Repository is a template project, not a deployed agent" />
      </ModalField>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 8 }}>
        <button onClick={onClose} style={{ background: "transparent", border: `1px solid ${T.border}`, color: T.textDim, padding: "8px 16px", borderRadius: 5, fontSize: 13, cursor: "pointer", fontFamily: FONT_UI }}>Cancel</button>
        <button onClick={() => onSave(agent.id, reason)} disabled={saving} style={{ background: T.crit, border: "none", color: "#fff", padding: "8px 20px", borderRadius: 5, fontSize: 13, fontWeight: 600, cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.6 : 1, fontFamily: FONT_UI }}>
          {saving ? "Rejecting…" : "Reject Agent"}
        </button>
      </div>
    </ModalOverlay>
  );
}

// ─── EditModal (admin only) ───────────────────────────────────────────────────
function EditModal({ agent, onSave, onClose, saving, environments = ["production","staging","development"], error }) {
  const [form, setForm] = useState({
    agent_name:       agent?.name || "",
    owner:            agent?.owner === "Unassigned" ? "" : (agent?.owner || ""),
    team:             agent?.team  === "Unknown"    ? "" : (agent?.team  || ""),
    environment:      agent?.environment === "Unknown" ? "" : (agent?.environment || ""),
    criticality:      agent?.criticality || "",
    business_purpose: agent?.business_purpose || "",
    lifecycle_status: agent?.lifecycle_status || "unassigned",
  });
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  return (
    <ModalOverlay onClose={onClose}>
      <div style={{ fontSize: 17, fontWeight: 500, marginBottom: 4 }}>Edit Agent</div>
      <div style={{ fontSize: 12, color: T.textMute, fontFamily: FONT_MONO, marginBottom: 20 }}>
        Editing registry metadata for <strong style={{ color: T.text }}>{agent?.name}</strong>
        <span style={{ marginLeft: 8, background: "#3D2A0D", color: T.warn, fontSize: 10, padding: "1px 7px", borderRadius: 3, textTransform: "uppercase", letterSpacing: "0.08em" }}>Admin</span>
      </div>

      {error && <div style={{ background: "#FF5C7A18", border: "1px solid #FF5C7A44", borderRadius: 5, padding: "8px 12px", marginBottom: 14, fontSize: 12, color: "#FF5C7A", fontFamily: FONT_MONO }}>{error}</div>}

      <ModalField label="Agent Name" required>
        <input style={inputStyle} value={form.agent_name} onChange={set("agent_name")} placeholder="agent-name" />
      </ModalField>
      <ModalField label="Owner">
        <input style={inputStyle} value={form.owner} onChange={set("owner")} placeholder="owner@company.com" />
        <div style={{ fontSize: 10, color: T.textMute, fontFamily: FONT_MONO, marginTop: 4 }}>Unknown individual? Leave blank and assign to the team below.</div>
      </ModalField>
      <ModalField label="Team">
        <input style={inputStyle} value={form.team} onChange={set("team")} placeholder="engineering" />
      </ModalField>
      <ModalField label="Environment">
        <select style={{ ...inputStyle, appearance: "none" }} value={form.environment} onChange={set("environment")}>
          <option value="">Select…</option>
          {environments.map(e => <option key={e} value={e}>{e.charAt(0).toUpperCase() + e.slice(1)}</option>)}
        </select>
      </ModalField>
      <ModalField label="Criticality">
        <select style={{ ...inputStyle, appearance: "none" }} value={form.criticality} onChange={set("criticality")}>
          <option value="">Select…</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
      </ModalField>
      <ModalField label="Business Purpose">
        <textarea style={{ ...inputStyle, minHeight: 72, resize: "vertical" }} value={form.business_purpose} onChange={set("business_purpose")} placeholder="What does this agent do?" />
      </ModalField>
      <ModalField label="Lifecycle Status">
        <select style={{ ...inputStyle, appearance: "none" }} value={form.lifecycle_status} onChange={set("lifecycle_status")}>
          <option value="unassigned">Unassigned</option>
          <option value="managed">Managed</option>
          <option value="retired">Retired</option>
        </select>
      </ModalField>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 8 }}>
        <button onClick={onClose} style={{ background: "transparent", border: `1px solid ${T.border}`, color: T.textDim, padding: "8px 16px", borderRadius: 5, fontSize: 13, cursor: "pointer", fontFamily: FONT_UI }}>Cancel</button>
        <button onClick={() => onSave(agent.id, form)} disabled={!form.agent_name || saving} style={{ background: T.info, border: "none", color: "#fff", padding: "8px 20px", borderRadius: 5, fontSize: 13, fontWeight: 600, cursor: form.agent_name && !saving ? "pointer" : "not-allowed", opacity: !form.agent_name || saving ? 0.6 : 1, fontFamily: FONT_UI }}>
          {saving ? "Saving…" : "Save Changes →"}
        </button>
      </div>
    </ModalOverlay>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function AgentInventory({ isAdmin = false, onNavigate }) {
  const [agents,       setAgents]       = useState([]);
  const [summary,      setSummary]      = useState(null);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState(null);
  const [tab,          setTab]          = useState("verified");
  const [search,       setSearch]       = useState("");
  const [saving,       setSaving]       = useState(false);
  const [environments, setEnvironments] = useState(["production","staging","development"]);

  const [claimTarget,    setClaimTarget]    = useState(null);
  const [validateTarget, setValidateTarget] = useState(null);
  const [rejectTarget,   setRejectTarget]   = useState(null);
  const [editTarget,     setEditTarget]     = useState(null);
  const [editError,      setEditError]      = useState(null);

  useEffect(() => {
    fetchOrgConfig().then(cfg => { if (cfg?.environments?.length) setEnvironments(cfg.environments); }).catch(() => {});
  }, []);

  const loadData = useCallback(async () => {
    try {
      const [a, s] = await Promise.all([
        fetchAgents({ include_retired: true }),
        fetchAgentsSummary(),
      ]);
      setAgents(a);
      setSummary(s);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Segmented views
  const verified  = useMemo(() => agents.filter(a => a.discovery_status === "verified" && a.lifecycle_status !== "retired"), [agents]);
  const potential = useMemo(() => agents.filter(a => a.discovery_status === "potential" && a.lifecycle_status !== "retired"), [agents]);
  const managed   = useMemo(() => agents.filter(a => a.lifecycle_status === "managed"), [agents]);
  const retired   = useMemo(() => agents.filter(a => a.lifecycle_status === "retired"), [agents]);

  const applySearch = useCallback((list) => {
    if (!search.trim()) return list;
    const q = search.toLowerCase();
    return list.filter(a => a.name.toLowerCase().includes(q) || (a.team || "").toLowerCase().includes(q));
  }, [search]);

  // Actions
  const [claimError, setClaimError] = useState(null);
  const handleClaim = async (agentId, form) => {
    setSaving(true);
    setClaimError(null);
    try {
      await claimInventoryAgent(agentId, form);
      setClaimTarget(null);
      setClaimError(null);
      await loadData();
    } catch (e) {
      setClaimError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleValidate = async (agentId, form) => {
    setSaving(true);
    try {
      await validateInventoryAgent(agentId, form);
      setValidateTarget(null);
      await loadData();
    } catch (e) {
      alert(`Validation failed: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleReject = async (agentId, reason) => {
    setSaving(true);
    try {
      await rejectInventoryAgent(agentId, reason);
      setRejectTarget(null);
      await loadData();
    } catch (e) {
      alert(`Rejection failed: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = async (agentId, form) => {
    setSaving(true);
    setEditError(null);
    try {
      await updateInventoryAgent(agentId, form);
      setEditTarget(null);
      await loadData();
    } catch (e) {
      setEditError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const tabs = [
    { id: "verified",  label: "Verified Agents",    count: verified.length },
    { id: "potential", label: "Needs Validation",   count: potential.length },
    { id: "managed",   label: "Managed",            count: managed.length },
    { id: "retired",   label: "Retired",            count: retired.length },
  ];

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 300, color: T.textMute, fontFamily: FONT_MONO, fontSize: 13 }}>
        Loading inventory…
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 24, background: "#1a0a0f", border: `1px solid ${T.crit}44`, borderRadius: 8, color: T.crit, fontFamily: FONT_MONO, fontSize: 13 }}>
        Failed to load inventory: {error}
        <button onClick={loadData} style={{ marginLeft: 16, background: "transparent", border: `1px solid ${T.crit}`, color: T.crit, padding: "4px 10px", borderRadius: 4, cursor: "pointer", fontFamily: FONT_MONO, fontSize: 11 }}>Retry</button>
      </div>
    );
  }

  const verifiedSummary = summary?.verified_agents || {};
  const potentialSummary = summary?.potential_agents || {};

  return (
    <div style={{ fontFamily: FONT_UI }}>
      {/* ── KPI Cards ─────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: 12, marginBottom: 24, flexWrap: "wrap" }}>
        <KpiCard
          label="Verified Agents"
          value={verifiedSummary.total ?? verified.length}
          color={T.accent}
          sub="confirmed from runtime traffic"
        />
        <KpiCard
          label="Unassigned"
          value={verifiedSummary.unassigned ?? 0}
          color={T.warn}
          sub="verified, need owner"
        />
        <KpiCard
          label="Managed"
          value={summary?.managed_agents ?? managed.length}
          color={T.info}
          sub="claimed & governed"
        />
        <KpiCard
          label="Needs Validation"
          value={potentialSummary.needs_validation ?? potential.length}
          color={T.purple}
          sub="potential agents pending review"
        />
        <KpiCard
          label="Monthly Cost"
          value={fmtCost(verifiedSummary.monthly_cost_usd)}
          color={T.text}
          sub={`${verifiedSummary.high_risk ?? 0} high-risk agents`}
        />
      </div>

      {/* ── Tabs + Search ─────────────────────────────────────────────────── */}
      <div style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 8, overflow: "hidden" }}>
        <div style={{ padding: "16px 20px 0", borderBottom: `1px solid ${T.border}` }}>
          <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap", marginBottom: 0 }}>
            <div style={{ flex: 1 }}>
              <TabBar active={tab} tabs={tabs} onChange={(id) => {
                if (id === "potential" && onNavigate) {
                  onNavigate("discovery", { discoveryTab: "potential" });
                } else {
                  setTab(id);
                }
              }} />
            </div>
            <div style={{ paddingBottom: 12 }}>
              <SearchBar value={search} onChange={setSearch} placeholder="Search agents…" />
            </div>
          </div>
        </div>

        {/* ── Tab content ─────────────────────────────────────────────────── */}
        {tab === "verified"  && <VerifiedTable  agents={applySearch(verified)}  onClaim={setClaimTarget} onEdit={isAdmin ? setEditTarget : null} />}
        {tab === "potential" && <PotentialTable agents={applySearch(potential)} onValidate={setValidateTarget} onReject={setRejectTarget} onEdit={isAdmin ? setEditTarget : null} />}
        {tab === "managed"   && <ManagedTable   agents={applySearch(managed)}   onEdit={isAdmin ? setEditTarget : null} />}
        {tab === "retired"   && <RetiredTable   agents={applySearch(retired)}   onEdit={isAdmin ? setEditTarget : null} />}

        {/* Footer */}
        <div style={{ borderTop: `1px solid ${T.border}`, padding: "10px 20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 11, fontFamily: FONT_MONO, color: T.textMute }}>
            {[verified, potential, retired].reduce((s, l) => s + l.length, 0) + managed.filter(a => !verified.includes(a)).length} total inventory records
          </span>
          <span style={{ fontSize: 10, fontFamily: FONT_MONO, color: T.textMute }}>
            Verified agents from runtime traffic · Potential agents from platform scans
          </span>
        </div>
      </div>

      {/* ── Modals ────────────────────────────────────────────────────────── */}
      {claimTarget    && <ClaimModal    agent={claimTarget}    onSave={handleClaim}    onClose={() => { setClaimTarget(null); setClaimError(null); }}    saving={saving} environments={environments} error={claimError} />}
      {validateTarget && <ValidateModal agent={validateTarget} onSave={handleValidate} onClose={() => setValidateTarget(null)} saving={saving} environments={environments} />}
      {rejectTarget   && <RejectModal   agent={rejectTarget}   onSave={handleReject}   onClose={() => setRejectTarget(null)}   saving={saving} />}
      {editTarget     && <EditModal     agent={editTarget}     onSave={handleEdit}     onClose={() => { setEditTarget(null); setEditError(null); }}     saving={saving} environments={environments} error={editError} />}
    </div>
  );
}
