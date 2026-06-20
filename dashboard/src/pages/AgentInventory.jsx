import React, { useState, useEffect, useMemo, useCallback } from "react";
import { fetchAgents, fetchAgentsSummary } from "../api.js";

// ─── Design tokens — mirror App.jsx T object ──────────────────────────────────
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
function fmtCost(v) {
  if (v == null || v === 0) return "$0.00";
  return "$" + Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function relativeTime(iso) {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (mins < 2)   return "just now";
  if (mins < 60)  return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 30)  return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ─── Small presentational components ─────────────────────────────────────────
function KpiCard({ label, value, sub, color }) {
  return (
    <div style={{
      background: T.panel, border: `1px solid ${T.border}`, borderRadius: 8,
      padding: "18px 20px", flex: 1, minWidth: 130,
    }}>
      <div style={{ fontSize: 11, fontFamily: FONT_MONO, color: T.textMute, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 600, letterSpacing: "-0.02em", color: color || T.text, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: T.textMute, fontFamily: FONT_MONO, marginTop: 6 }}>{sub}</div>}
    </div>
  );
}

function LifecycleBadge({ status }) {
  const map = {
    managed:    { label: "Managed",    bg: "#1A3D2B", color: "#7CFFB2", dot: "#7CFFB2" },
    unassigned: { label: "Unassigned", bg: "#3D2E0D", color: "#FFB547", dot: "#FFB547" },
    retired:    { label: "Retired",    bg: "#1E2230", color: "#4B5468", dot: "#4B5468" },
  };
  const m = map[status] || map.unassigned;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      background: m.bg, color: m.color, border: `1px solid ${m.dot}33`,
      fontSize: 10, fontFamily: FONT_MONO, fontWeight: 600,
      padding: "2px 8px", borderRadius: 20, letterSpacing: "0.05em", textTransform: "uppercase",
      whiteSpace: "nowrap",
    }}>
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: m.dot, flexShrink: 0 }} />
      {m.label}
    </span>
  );
}

function StatusPill({ status }) {
  const map = {
    active:   { color: T.accent, bg: "#1A3D2B" },
    dormant:  { color: T.warn,   bg: "#3D2E0D" },
    inactive: { color: T.textDim, bg: T.panelHi },
  };
  const m = map[status] || map.inactive;
  return (
    <span style={{
      display: "inline-block", background: m.bg, color: m.color,
      fontSize: 11, fontFamily: FONT_MONO, padding: "2px 8px",
      borderRadius: 4, fontWeight: 600, textTransform: "capitalize",
    }}>
      {status || "—"}
    </span>
  );
}

function RiskChip({ risk }) {
  const map = {
    high:   { color: T.crit,   bg: "#3D0F1A" },
    medium: { color: T.warn,   bg: "#3D2E0D" },
    low:    { color: T.accent, bg: "#1A3D2B" },
  };
  const m = map[risk] || { color: T.textMute, bg: T.panelHi };
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      background: m.bg, color: m.color,
      fontSize: 11, fontFamily: FONT_MONO, padding: "2px 8px",
      borderRadius: 4, fontWeight: 600, textTransform: "capitalize",
    }}>
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: m.color }} />
      {risk || "—"}
    </span>
  );
}

function SignalChips({ signals = {} }) {
  const chips = [];
  if (signals.has_pii)     chips.push({ label: "PII",    color: T.crit });
  if (signals.has_blocked) chips.push({ label: "Blocked", color: T.warn });
  if (signals.has_loop)    chips.push({ label: "Loop",    color: T.purple });
  if (chips.length === 0)  return null;
  return (
    <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 4 }}>
      {chips.map(c => (
        <span key={c.label} style={{
          fontSize: 9, fontFamily: FONT_MONO, fontWeight: 600,
          color: c.color, border: `1px solid ${c.color}44`,
          padding: "1px 5px", borderRadius: 3, letterSpacing: "0.06em",
        }}>{c.label}</span>
      ))}
    </div>
  );
}

function SortIcon({ active, dir }) {
  if (!active) return <span style={{ color: T.textMute, marginLeft: 4, fontSize: 10 }}>⇅</span>;
  return <span style={{ color: T.accent, marginLeft: 4, fontSize: 10 }}>{dir === "asc" ? "↑" : "↓"}</span>;
}

const Th = ({ label, col, sortBy, sortDir, onSort, style: extra = {} }) => (
  <th
    onClick={() => onSort(col)}
    style={{
      padding: "10px 14px", textAlign: "left", fontSize: 11, fontFamily: FONT_MONO,
      color: sortBy === col ? T.textDim : T.textMute,
      letterSpacing: "0.08em", textTransform: "uppercase", cursor: "pointer",
      userSelect: "none", whiteSpace: "nowrap", fontWeight: 500,
      borderBottom: `1px solid ${T.border}`, background: T.panel,
      ...extra,
    }}
  >
    {label}<SortIcon active={sortBy === col} dir={sortDir} />
  </th>
);

function Select({ value, onChange, children, style: extra = {} }) {
  return (
    <select
      value={value} onChange={e => onChange(e.target.value)}
      style={{
        background: T.panelHi, border: `1px solid ${T.border}`, color: T.textDim,
        padding: "7px 28px 7px 10px", borderRadius: 5, fontSize: 12,
        fontFamily: FONT_UI, cursor: "pointer", outline: "none",
        appearance: "none",
        backgroundImage: "url(\"data:image/svg+xml;utf8,<svg fill='%237A8499' xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24'><polygon points='6,9 18,9 12,16'/></svg>\")",
        backgroundRepeat: "no-repeat", backgroundPosition: "right 8px center",
        ...extra,
      }}
    >
      {children}
    </select>
  );
}

// ─── Expanded row detail ──────────────────────────────────────────────────────
function AgentDetailRow({ agent, colSpan }) {
  return (
    <tr>
      <td colSpan={colSpan} style={{ padding: 0, borderBottom: `1px solid ${T.border}` }}>
        <div style={{
          background: T.panelHi, padding: "20px 28px",
          display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "20px 32px",
        }}>
          <Field label="Owner"            value={agent.owner === "Unassigned" ? null : agent.owner} fallback="Unassigned" />
          <Field label="Environment"      value={agent.environment === "Unknown" ? null : agent.environment} fallback="Unknown" />
          <Field label="Criticality"      value={agent.criticality} fallback="Not set" />
          <Field label="First Seen"       value={agent.first_seen ? relativeTime(agent.first_seen) : null} fallback="—" />
          <Field label="Total Calls"      value={agent.total_calls?.toLocaleString()} fallback="0" />
          <Field label="Total Tokens"     value={agent.total_tokens ? (agent.total_tokens / 1000).toFixed(1) + "k" : null} fallback="0" />
          <Field label="Total Cost"       value={agent.total_cost_usd ? fmtCost(agent.total_cost_usd) : null} fallback="$0.00" />
          <Field label="Models"           value={agent.models_used?.join(", ")} fallback="—" />
          {agent.business_purpose && (
            <div style={{ gridColumn: "1 / -1" }}>
              <div style={{ fontSize: 10, fontFamily: FONT_MONO, color: T.textMute, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4 }}>Business Purpose</div>
              <div style={{ fontSize: 13, color: T.textDim, lineHeight: 1.5 }}>{agent.business_purpose}</div>
            </div>
          )}
          {agent.asset_key && (
            <div style={{ gridColumn: "1 / -1", borderTop: `1px solid ${T.border}`, paddingTop: 14, marginTop: 4 }}>
              <div style={{ fontSize: 10, fontFamily: FONT_MONO, color: T.textMute, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>Runtime Hints (from telemetry headers — not canonical)</div>
              <div style={{ fontSize: 11, fontFamily: FONT_MONO, color: T.textMute }}>
                asset_key: {agent.asset_key?.slice(0, 16)}…
              </div>
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}

function Field({ label, value, fallback }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontFamily: FONT_MONO, color: T.textMute, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 13, color: value ? T.text : T.textMute }}>{value || fallback}</div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function AgentInventory() {
  const [agents,    setAgents]    = useState([]);
  const [summary,   setSummary]   = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState(null);
  const [expanded,  setExpanded]  = useState(null); // agent id

  // Filters (client-side for instant UX — dataset is small)
  const [search,     setSearch]     = useState("");
  const [fTeam,      setFTeam]      = useState("all");
  const [fStatus,    setFStatus]    = useState("all");
  const [fRisk,      setFRisk]      = useState("all");
  const [fOwner,     setFOwner]     = useState("all");
  const [fLifecycle, setFLifecycle] = useState("all");

  // Sort
  const [sortBy,  setSortBy]  = useState("monthly_cost_usd");
  const [sortDir, setSortDir] = useState("desc");

  // Fetch on mount
  useEffect(() => {
    setLoading(true);
    Promise.all([fetchAgents({ include_retired: true }), fetchAgentsSummary()])
      .then(([a, s]) => { setAgents(a); setSummary(s); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  // Derived team list for dropdown
  const teams = useMemo(() =>
    [...new Set(agents.map(a => a.team).filter(t => t && t !== "Unknown"))].sort()
  , [agents]);

  // Client-side filter
  const filtered = useMemo(() => {
    const riskOrd   = { high: 0, medium: 1, low: 2 };
    const statusOrd = { active: 0, dormant: 1, inactive: 2 };

    let result = agents;
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(a =>
        a.name.toLowerCase().includes(q) || a.team.toLowerCase().includes(q)
      );
    }
    if (fTeam      !== "all") result = result.filter(a => a.team === fTeam);
    if (fStatus    !== "all") result = result.filter(a => a.status === fStatus);
    if (fRisk      !== "all") result = result.filter(a => a.risk === fRisk);
    if (fOwner     === "unassigned") result = result.filter(a => a.owner === "Unassigned");
    if (fLifecycle !== "all") result = result.filter(a => a.lifecycle_status === fLifecycle);

    return [...result].sort((a, b) => {
      let av = a[sortBy], bv = b[sortBy];
      if (sortBy === "risk")   { av = riskOrd[av] ?? 99;   bv = riskOrd[bv] ?? 99; }
      if (sortBy === "status") { av = statusOrd[av] ?? 99; bv = statusOrd[bv] ?? 99; }
      if (av == null) av = "";
      if (bv == null) bv = "";
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
  }, [agents, search, fTeam, fStatus, fRisk, fOwner, fLifecycle, sortBy, sortDir]);

  const handleSort = useCallback((col) => {
    setSortBy(prev => {
      if (prev === col) { setSortDir(d => d === "asc" ? "desc" : "asc"); return col; }
      setSortDir("desc");
      return col;
    });
  }, []);

  const toggleExpand = useCallback((id) => {
    setExpanded(prev => prev === id ? null : id);
  }, []);

  const clearFilters = () => {
    setSearch(""); setFTeam("all"); setFStatus("all");
    setFRisk("all"); setFOwner("all"); setFLifecycle("all");
  };

  const hasFilters = search || fTeam !== "all" || fStatus !== "all" || fRisk !== "all" || fOwner !== "all" || fLifecycle !== "all";

  // ── Render ──────────────────────────────────────────────────────────────────
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
        Failed to load agent inventory: {error}
        <button onClick={() => window.location.reload()} style={{ marginLeft: 16, background: "transparent", border: `1px solid ${T.crit}`, color: T.crit, padding: "4px 10px", borderRadius: 4, cursor: "pointer", fontFamily: FONT_MONO, fontSize: 11 }}>Retry</button>
      </div>
    );
  }

  const COL_SPAN = 8;

  return (
    <div style={{ fontFamily: FONT_UI }}>

      {/* ── KPI Cards ───────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: 12, marginBottom: 24, flexWrap: "wrap" }}>
        <KpiCard label="Total Agents"   value={summary?.total_agents   ?? agents.length} />
        <KpiCard label="Active"         value={summary?.active_agents  ?? 0} color={T.accent}
          sub={summary ? `${summary.dormant_agents} dormant · ${summary.inactive_agents} inactive` : undefined} />
        <KpiCard label="High Risk"      value={summary?.high_risk_agents ?? 0} color={T.crit}
          sub={summary ? `${summary.medium_risk_agents} medium · ${summary.low_risk_agents} low` : undefined} />
        <KpiCard label="Unassigned"     value={summary?.unassigned_agents ?? 0} color={T.warn}
          sub="need owner assignment" />
        <KpiCard label="Managed"        value={summary?.managed_agents ?? 0} color={T.info} />
        <KpiCard label="Monthly Cost"   value={fmtCost(summary?.monthly_cost_usd)} color={T.purple} />
      </div>

      {/* ── Filter Bar ──────────────────────────────────────────────────────── */}
      <div style={{
        background: T.panel, border: `1px solid ${T.border}`, borderRadius: 8,
        padding: "14px 16px", marginBottom: 16,
        display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap",
      }}>
        {/* Search */}
        <div style={{ position: "relative", flex: "1 1 200px", minWidth: 160 }}>
          <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: T.textMute, fontSize: 13, pointerEvents: "none" }}>⌕</span>
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search agents…"
            style={{
              width: "100%", background: T.panelHi, border: `1px solid ${T.border}`,
              color: T.text, padding: "7px 10px 7px 30px", borderRadius: 5,
              fontSize: 13, fontFamily: FONT_UI, outline: "none",
            }}
          />
        </div>

        <Select value={fLifecycle} onChange={setFLifecycle}>
          <option value="all">All Lifecycle</option>
          <option value="managed">Managed</option>
          <option value="unassigned">Unassigned</option>
          <option value="retired">Retired</option>
        </Select>

        <Select value={fStatus} onChange={setFStatus}>
          <option value="all">All Status</option>
          <option value="active">Active</option>
          <option value="dormant">Dormant</option>
          <option value="inactive">Inactive</option>
        </Select>

        <Select value={fRisk} onChange={setFRisk}>
          <option value="all">All Risk</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </Select>

        <Select value={fOwner} onChange={setFOwner}>
          <option value="all">All Owners</option>
          <option value="unassigned">Unassigned Only</option>
        </Select>

        <Select value={fTeam} onChange={setFTeam} style={{ maxWidth: 180 }}>
          <option value="all">All Teams</option>
          {teams.map(t => <option key={t} value={t}>{t}</option>)}
        </Select>

        {/* Result count + clear */}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 11, fontFamily: FONT_MONO, color: T.textMute, whiteSpace: "nowrap" }}>
            {filtered.length} / {agents.length} agents
          </span>
          {hasFilters && (
            <button onClick={clearFilters} style={{
              background: "transparent", border: `1px solid ${T.border}`, color: T.textDim,
              padding: "5px 10px", borderRadius: 4, fontSize: 11, fontFamily: FONT_MONO,
              cursor: "pointer", whiteSpace: "nowrap",
            }}>✕ Clear</button>
          )}
        </div>
      </div>

      {/* ── Agent Table ─────────────────────────────────────────────────────── */}
      <div style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 8, overflow: "hidden" }}>
        {filtered.length === 0 ? (
          <div style={{ padding: "48px 24px", textAlign: "center", color: T.textMute, fontFamily: FONT_MONO, fontSize: 13 }}>
            {agents.length === 0
              ? "No agents discovered yet. Traffic through the AI Gateway will automatically populate the inventory."
              : "No agents match the current filters."
            }
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <Th label="Agent"        col="name"            sortBy={sortBy} sortDir={sortDir} onSort={handleSort} style={{ paddingLeft: 20, width: "22%" }} />
                  <Th label="Team"         col="team"            sortBy={sortBy} sortDir={sortDir} onSort={handleSort} style={{ width: "14%" }} />
                  <Th label="Owner"        col="owner"           sortBy={sortBy} sortDir={sortDir} onSort={handleSort} style={{ width: "14%" }} />
                  <Th label="Environment"  col="environment"     sortBy={sortBy} sortDir={sortDir} onSort={handleSort} style={{ width: "10%" }} />
                  <Th label="Status"       col="status"          sortBy={sortBy} sortDir={sortDir} onSort={handleSort} style={{ width: "10%" }} />
                  <Th label="Risk"         col="risk"            sortBy={sortBy} sortDir={sortDir} onSort={handleSort} style={{ width: "10%" }} />
                  <Th label="Monthly Cost" col="monthly_cost_usd" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} style={{ width: "10%", textAlign: "right" }} />
                  <Th label="Last Seen"    col="last_seen"       sortBy={sortBy} sortDir={sortDir} onSort={handleSort} style={{ width: "10%" }} />
                </tr>
              </thead>
              <tbody>
                {filtered.map((agent, idx) => {
                  const isExpanded = expanded === agent.id;
                  const rowBg = isExpanded ? T.panelHi : (idx % 2 === 0 ? T.panel : "#0C0E14");
                  return (
                    <React.Fragment key={agent.id}>
                      <tr
                        onClick={() => toggleExpand(agent.id)}
                        style={{ background: rowBg, cursor: "pointer", transition: "background 0.1s" }}
                        onMouseEnter={e => !isExpanded && (e.currentTarget.style.background = T.panelHi)}
                        onMouseLeave={e => !isExpanded && (e.currentTarget.style.background = rowBg)}
                      >
                        {/* Agent name + lifecycle */}
                        <td style={{ padding: "12px 14px 12px 20px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <span style={{ fontSize: 13, color: isExpanded ? T.accent : T.text, fontWeight: 500, fontFamily: FONT_MONO }}>
                              {isExpanded ? "▾" : "▸"} {agent.name}
                            </span>
                          </div>
                          <div style={{ marginTop: 5 }}>
                            <LifecycleBadge status={agent.lifecycle_status} />
                          </div>
                          <SignalChips signals={agent.signals} />
                        </td>

                        {/* Team */}
                        <td style={{ padding: "12px 14px" }}>
                          <span style={{ fontSize: 12, color: T.textDim, fontFamily: FONT_MONO }}>{agent.team}</span>
                        </td>

                        {/* Owner */}
                        <td style={{ padding: "12px 14px" }}>
                          {agent.owner === "Unassigned"
                            ? <span style={{ fontSize: 11, fontFamily: FONT_MONO, color: T.warn, background: "#3D2E0D", padding: "2px 7px", borderRadius: 3 }}>Unassigned</span>
                            : <span style={{ fontSize: 12, color: T.textDim }}>{agent.owner}</span>
                          }
                        </td>

                        {/* Environment */}
                        <td style={{ padding: "12px 14px" }}>
                          {agent.environment === "Unknown"
                            ? <span style={{ fontSize: 11, fontFamily: FONT_MONO, color: T.textMute }}>Unknown</span>
                            : <span style={{ fontSize: 11, fontFamily: FONT_MONO, color: T.info, background: "#0D1F3D", padding: "2px 7px", borderRadius: 3 }}>{agent.environment}</span>
                          }
                        </td>

                        {/* Status */}
                        <td style={{ padding: "12px 14px" }}>
                          <StatusPill status={agent.status} />
                        </td>

                        {/* Risk */}
                        <td style={{ padding: "12px 14px" }}>
                          <RiskChip risk={agent.risk} />
                        </td>

                        {/* Monthly Cost */}
                        <td style={{ padding: "12px 14px", textAlign: "right" }}>
                          <span style={{ fontSize: 13, fontFamily: FONT_MONO, color: agent.monthly_cost_usd > 0 ? T.text : T.textMute }}>
                            {fmtCost(agent.monthly_cost_usd)}
                          </span>
                        </td>

                        {/* Last Seen */}
                        <td style={{ padding: "12px 14px" }}>
                          <span style={{ fontSize: 11, fontFamily: FONT_MONO, color: T.textDim }}>
                            {relativeTime(agent.last_seen)}
                          </span>
                        </td>
                      </tr>

                      {isExpanded && <AgentDetailRow agent={agent} colSpan={COL_SPAN} />}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Table footer */}
        {filtered.length > 0 && (
          <div style={{
            borderTop: `1px solid ${T.border}`, padding: "10px 20px",
            display: "flex", justifyContent: "space-between", alignItems: "center",
          }}>
            <span style={{ fontSize: 11, fontFamily: FONT_MONO, color: T.textMute }}>
              {filtered.length} agent{filtered.length !== 1 ? "s" : ""}
              {hasFilters ? ` (filtered from ${agents.length})` : ""}
            </span>
            <span style={{ fontSize: 11, fontFamily: FONT_MONO, color: T.textMute }}>
              Sorted by {sortBy.replace(/_/g, " ")} · {sortDir}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
