import React, { useState, useCallback, useEffect } from "react";
import { fetchAssets, fetchAssetsSummary, fetchUnassignedAssets, fetchAssetTelemetry, claimAsset } from "../api.js";
import { T, FONT_MONO, FONT_UI } from "../theme.js";

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
              <div style={{ padding: 40, textAlign: "center", color: T2.textMute, fontFamily: FONT_MONO, lineHeight: 1.7 }}>
                No agents discovered yet.<br/>
                Send your first request through the gateway and we'll discover agents automatically.
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

export default AssetsPage;
