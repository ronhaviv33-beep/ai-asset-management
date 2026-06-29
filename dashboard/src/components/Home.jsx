import React, { useState, useCallback, useEffect } from "react";
import { fetchAssets, fetchAssetsSummary } from "../api.js";
import { T, FONT_MONO } from "../theme.js";
import { BRAND } from "../config.js";

export default function Home({ onNavigate }) {
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
          <div style={{ fontSize:22, fontWeight:600, letterSpacing:"-0.02em", color:T.text }}>{BRAND.name}</div>
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
