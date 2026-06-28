import React, { useState, useEffect, useMemo, useCallback } from "react";
import { fetchAgents, claimInventoryAgent, approveSuggestions, ignoreInventoryAgent } from "../api.js";
import { stageMeta } from "../discoveryStatus.js";

const agentActionId = (a) => a?.id || a?.asset_key || a?.agent_id;

const T = {
  bg: "#0A0B0F", panel: "#0F1117", panelHi: "#141823",
  border: "#1E2230", borderHi: "#2A3242",
  text: "#E8ECF4", textDim: "#7A8499", textMute: "#4B5468",
  accent: "#7CFFB2", warn: "#FFB547", crit: "#FF5C7A",
  info: "#6FA8FF", yellow: "#FFD700", purple: "#B47AFF",
};
const MONO = "'JetBrains Mono','IBM Plex Mono',monospace";
const FONT = "'Geist','Söhne',-apple-system,sans-serif";

function relativeTime(iso) {
  if (!iso) return "—";
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (d === 0) return "today";
  if (d === 1) return "yesterday";
  return `${d}d ago`;
}

function CoverageBar({ label, value, total, color = T.accent }) {
  const pct = total > 0 ? (value / total) * 100 : 0;   // visual fill only — not shown as a number
  const remaining = Math.max(0, total - value);
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: T.text, marginBottom: 6 }}>
        <span>{label}</span>
        <span style={{ fontFamily: MONO }}>
          <span style={{ color }}>{value}</span>
          <span style={{ color: T.textMute }}> of {total} done</span>
          <span style={{ color: remaining > 0 ? T.warn : T.accent, marginLeft: 8, fontSize: 11 }}>
            {remaining > 0 ? `${remaining} to review` : "✓ complete"}
          </span>
        </span>
      </div>
      <div style={{ background: T.panelHi, borderRadius: 2, height: 6 }}>
        <div style={{ width: `${pct}%`, background: color, height: 6, borderRadius: 2, transition: "width 0.5s" }} />
      </div>
    </div>
  );
}

function StageBadge({ agent }) {
  const m = stageMeta(agent || {});
  return (
    <span title={m.description}
      style={{ display: "inline-flex", alignItems: "center", gap: 5, background: m.color + "1A", color: m.color, border: `1px solid ${m.color}44`, fontSize: 10, fontFamily: MONO, fontWeight: 600, padding: "2px 9px", borderRadius: 4, textTransform: "uppercase", letterSpacing: "0.05em", whiteSpace: "nowrap" }}>
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: m.color }} />
      {m.label}
    </span>
  );
}

// Review modal — suggestions-first Approve / Edit / Ignore (mirrors Discovery Center).
function ReviewModal({ agent, onClose, onSave, onApprove, onIgnore }) {
  const sOwner = agent?.suggested_owner || "";
  const sTeam  = agent?.suggested_team || (agent?.team && agent.team !== "Unknown" ? agent.team : "");
  const sEnv   = agent?.suggested_environment || (agent?.environment && agent.environment !== "Unknown" ? agent.environment : "");
  const hasSuggestions = !!(sOwner || sTeam || sEnv);

  const [editing, setEditing] = useState(!hasSuggestions);
  const [owner, setOwner] = useState(sOwner);
  const [team, setTeam]   = useState(sTeam);
  const [busy, setBusy]   = useState("");
  const [err, setErr]     = useState("");
  const ev = agent?.identity_evidence || {};

  const run = async (fn) => { setErr(""); try { await fn(); onClose(); } catch (e) { setErr(e.message); } };
  const approve = () => run(async () => { setBusy("approve"); try { await onApprove(agent); } finally { setBusy(""); } });
  const ignore  = () => run(async () => { setBusy("ignore");  try { await onIgnore(agent);  } finally { setBusy(""); } });
  const save    = () => {
    if (!owner.trim() && !team.trim()) { setErr("Enter an owner or a team"); return; }
    run(async () => { setBusy("save"); try { await onSave(agentActionId(agent), { owner: owner.trim(), team: team.trim(), agent_name: agent.agent_name }); } finally { setBusy(""); } });
  };

  const row = (label, value) => value ? (
    <div style={{ display: "flex", gap: 10, fontSize: 12 }}>
      <span style={{ color: T.textMute, fontFamily: MONO, minWidth: 90 }}>{label}</span>
      <span style={{ color: T.text }}>{value}</span>
    </div>
  ) : null;

  return (
    <div style={{ position: "fixed", inset: 0, background: "#000A", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 24 }}>
      <div style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 8, padding: 28, width: "100%", maxWidth: 460, fontFamily: FONT }}>
        <div style={{ fontSize: 16, fontWeight: 600, color: T.text, marginBottom: 6 }}>New Agent Discovered</div>
        <div style={{ fontSize: 13, color: T.textDim, marginBottom: 16, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <StageBadge agent={agent} />
          <strong style={{ color: T.text, fontFamily: MONO }}>{agent?.agent_name}</strong>
        </div>

        {err && <div style={{ color: T.crit, fontSize: 12, fontFamily: MONO, marginBottom: 12 }}>{err}</div>}

        {/* Evidence */}
        <div style={{ background: T.panelHi, border: `1px solid ${T.border}`, borderRadius: 6, padding: "12px 14px", marginBottom: 16, display: "flex", flexDirection: "column", gap: 5 }}>
          <div style={{ fontSize: 10, color: T.textMute, fontFamily: MONO, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 4 }}>Evidence</div>
          {row("Seen via", (ev.source || agent?.discovery_source || "gateway").replace(/_/g, " "))}
          {row("Provider", ev.provider)}
          {row("Models", Array.isArray(ev.models) ? ev.models.join(", ") : ev.models)}
          {row("Last seen", agent?.last_seen ? relativeTime(agent.last_seen) : null)}
        </div>

        {!editing ? (
          <div style={{ marginBottom: 16, display: "flex", flexDirection: "column", gap: 5 }}>
            <div style={{ fontSize: 10, color: T.textMute, fontFamily: MONO, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 4 }}>Suggested</div>
            {row("Owner", sOwner || "—")}
            {row("Team", sTeam || "—")}
            {row("Environment", sEnv || "—")}
          </div>
        ) : (
          <>
            {[
              { label: "Owner", value: owner, set: setOwner, placeholder: "Email or display name" },
              { label: "Team",  value: team,  set: setTeam,  placeholder: "Team name" },
            ].map(({ label, value, set, placeholder }) => (
              <div key={label} style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 10, color: T.textMute, fontFamily: MONO, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 6 }}>{label}</div>
                <input value={value} onChange={e => set(e.target.value)} placeholder={placeholder}
                  style={{ width: "100%", background: T.panelHi, border: `1px solid ${T.border}`, color: T.text, padding: "8px 12px", borderRadius: 4, fontSize: 13, fontFamily: FONT, boxSizing: "border-box" }} />
              </div>
            ))}
          </>
        )}

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 16, flexWrap: "wrap" }}>
          <button onClick={ignore} disabled={!!busy} style={{ background: "transparent", border: `1px solid ${T.border}`, color: T.textDim, padding: "8px 14px", borderRadius: 4, fontSize: 13, cursor: busy ? "not-allowed" : "pointer", marginRight: "auto" }}>
            {busy === "ignore" ? "Ignoring…" : "Ignore"}
          </button>
          {editing ? (
            <button onClick={save} disabled={!!busy} style={{ background: T.accent, color: T.bg, border: "none", padding: "8px 16px", borderRadius: 4, fontSize: 13, fontWeight: 600, cursor: busy ? "not-allowed" : "pointer" }}>
              {busy === "save" ? "Saving…" : "Save & Claim"}
            </button>
          ) : (
            <>
              <button onClick={() => setEditing(true)} disabled={!!busy} style={{ background: "transparent", border: `1px solid ${T.border}`, color: T.text, padding: "8px 14px", borderRadius: 4, fontSize: 13, cursor: busy ? "not-allowed" : "pointer" }}>Edit</button>
              <button onClick={approve} disabled={!!busy} style={{ background: T.accent, color: T.bg, border: "none", padding: "8px 16px", borderRadius: 4, fontSize: 13, fontWeight: 600, cursor: busy ? "not-allowed" : "pointer" }}>
                {busy === "approve" ? "Approving…" : "Approve"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const TH = ({ children }) => (
  <th style={{ textAlign: "left", padding: "8px 14px", fontSize: 10, fontFamily: MONO, color: T.textMute, letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 500, borderBottom: `1px solid ${T.border}`, background: T.panelHi }}>
    {children}
  </th>
);
const TD = ({ children, style }) => (
  <td style={{ padding: "10px 14px", fontSize: 13, color: T.text, borderBottom: `1px solid ${T.border}`, verticalAlign: "middle", ...style }}>
    {children}
  </td>
);

function sortItems(list, key, dir) {
  if (!key) return list;
  const mul = dir === "asc" ? 1 : -1;
  return [...list].sort((a, b) => {
    let va = a[key], vb = b[key];
    if (["first_seen_at","created_at"].includes(key)) {
      va = va ? new Date(va).getTime() : 0; vb = vb ? new Date(vb).getTime() : 0;
    }
    if (typeof va === "number" && typeof vb === "number") return (va - vb) * mul;
    return String(va || "").toLowerCase().localeCompare(String(vb || "").toLowerCase()) * mul;
  });
}

const STH = ({ children, sortKey, sort, onSort }) => {
  const active = sort?.key === sortKey;
  const canSort = !!sortKey;
  return (
    <th onClick={canSort ? () => onSort(sortKey) : undefined}
      style={{ textAlign:"left", padding:"8px 14px", fontSize:10, fontFamily:MONO, color: active ? T.accent : T.textMute, letterSpacing:"0.1em", textTransform:"uppercase", fontWeight:500, borderBottom:`1px solid ${T.border}`, background:T.panelHi, cursor: canSort ? "pointer" : "default", userSelect:"none" }}>
      <span style={{ display:"inline-flex", alignItems:"center", gap:4 }}>
        {children}
        {canSort && <span style={{ fontSize:9, opacity: active?1:0.4, color: active?T.accent:T.textMute }}>{active?(sort.dir==="asc"?"▲":"▼"):"⇅"}</span>}
      </span>
    </th>
  );
};

export default function GovernanceCenter() {
  const [agents, setAgents]     = useState([]);
  const [loading, setLoading]   = useState(true);
  const [tab, setTab]           = useState("approvals");
  const [claimTarget, setClaimTarget] = useState(null);
  const [toastMsg, setToastMsg] = useState("");
  const [appSort, setAppSort]   = useState({ key: "first_seen_at", dir: "desc" });
  const [unaSort, setUnaSort]   = useState({ key: "first_seen_at", dir: "desc" });
  const toggleApp = (key) => setAppSort(s => s.key===key ? {key, dir: s.dir==="asc"?"desc":"asc"} : {key, dir:"desc"});
  const toggleUna = (key) => setUnaSort(s => s.key===key ? {key, dir: s.dir==="asc"?"desc":"asc"} : {key, dir:"desc"});

  const toast = (msg) => { setToastMsg(msg); setTimeout(() => setToastMsg(""), 3000); };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const raw = await fetchAgents({ limit: 500 });
      setAgents(Array.isArray(raw) ? raw : raw?.agents || raw?.items || []);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const total            = agents.length;
  const managed          = useMemo(() => agents.filter(a => a.lifecycle_status === "managed"), [agents]);
  const unassigned       = useMemo(() => agents.filter(a => a.lifecycle_status === "unassigned"), [agents]);
  const needsValidation  = useMemo(() => agents.filter(a => a.lifecycle_status === "needs_validation"), [agents]);
  const retired          = useMemo(() => agents.filter(a => a.lifecycle_status === "retired"), [agents]);

  const withEnv          = agents.filter(a => a.environment && a.environment !== "unknown").length;
  const withCrit         = agents.filter(a => a.criticality && a.criticality !== "unknown").length;
  const withOwner        = agents.filter(a => a.owner && a.owner !== "Unassigned").length;
  const withPurpose      = agents.filter(a => a.business_purpose || a.description).length;

  const pendingApprovals = [...needsValidation, ...unassigned];

  const handleClaim = async (agentId, body) => {
    await claimInventoryAgent(agentId, body);
    toast("Owner assigned successfully");
    await load();
  };

  const handleApprove = async (agent) => {
    await approveSuggestions(agentActionId(agent), {});
    toast("Suggestions approved — agent is now managed");
    await load();
  };

  const handleIgnore = async (agent) => {
    await ignoreInventoryAgent(agentActionId(agent));
    toast("Agent dismissed from review");
    await load();
  };

  const tabs = [
    { id: "approvals", label: `Review Queue (${pendingApprovals.length})` },
    { id: "ownership", label: `Ownership Review (${total - withOwner} need owner)` },
    { id: "policy",    label: "Policy Coverage" },
  ];

  return (
    <div style={{ fontFamily: FONT }}>
      {toastMsg && (
        <div style={{ position: "fixed", bottom: 24, right: 24, background: T.panelHi, border: `1px solid ${T.accent}`, color: T.accent, padding: "10px 18px", borderRadius: 6, fontFamily: MONO, fontSize: 13, zIndex: 2000 }}>
          {toastMsg}
        </div>
      )}
      {claimTarget && <ReviewModal agent={claimTarget} onClose={() => setClaimTarget(null)} onSave={handleClaim} onApprove={handleApprove} onIgnore={handleIgnore} />}

      {/* Tab bar */}
      <div style={{ display: "flex", gap: 0, background: T.panelHi, border: `1px solid ${T.border}`, borderRadius: 6, padding: 3, marginBottom: 24, alignSelf: "flex-start", width: "fit-content" }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ background: tab === t.id ? T.panel : "transparent", border: tab === t.id ? `1px solid ${T.border}` : "1px solid transparent", color: tab === t.id ? T.text : T.textDim, padding: "7px 18px", borderRadius: 4, fontSize: 12, fontFamily: MONO, cursor: "pointer", transition: "all 0.12s" }}>
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ color: T.textMute, fontFamily: MONO, fontSize: 13, padding: "32px 0", textAlign: "center" }}>Loading agents…</div>
      ) : tab === "approvals" ? (

        /* ── Approvals ─────────────────────────────────────────────────────── */
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
            {[
              { label: "Needs Validation",    count: needsValidation.length, color: T.warn,   desc: "Discovered agents to confirm" },
              { label: "Agents Needing Owner", count: unassigned.length,     color: T.yellow, desc: "Discovered agents without an owner yet" },
            ].map(({ label, count, color, desc }) => (
              <div key={label} style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 8, padding: "20px 24px" }}>
                <div style={{ fontSize: 9, fontFamily: MONO, color: T.textMute, letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 10 }}>{label}</div>
                <div style={{ fontSize: 36, fontWeight: 700, color, letterSpacing: "-0.03em", lineHeight: 1, marginBottom: 8 }}>{count}</div>
                <div style={{ fontSize: 12, color: T.textMute }}>{desc}</div>
              </div>
            ))}
          </div>

          {pendingApprovals.length === 0 ? (
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "28px", background: T.panel, border: `1px solid ${T.accent}33`, borderRadius: 8, color: T.accent, fontFamily: MONO, fontSize: 14 }}>
              <span style={{ fontSize: 22 }}>✓</span> Nothing to review — every discovered agent has an owner.
            </div>
          ) : (
            <div style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 8, overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <STH sortKey="agent_name" sort={appSort} onSort={toggleApp}>Agent</STH>
                    <STH sortKey="lifecycle_status" sort={appSort} onSort={toggleApp}>Action Required</STH>
                    <STH sortKey="team" sort={appSort} onSort={toggleApp}>Team</STH>
                    <STH sortKey="first_seen_at" sort={appSort} onSort={toggleApp}>First Seen</STH>
                    <STH>Actions</STH>
                  </tr>
                </thead>
                <tbody>
                  {sortItems(pendingApprovals, appSort.key, appSort.dir).map(agent => {
                    const isPending = agent.lifecycle_status === "needs_validation";
                    return (
                      <tr key={agent.agent_id || agent.id}>
                        <TD>
                          <div style={{ fontFamily: MONO, fontSize: 13, color: T.text }}>{agent.agent_name || agent.agent_id_raw}</div>
                          <div style={{ fontSize: 11, color: T.textMute, marginTop: 2 }}>{agent.agent_id}</div>
                        </TD>
                        <TD>
                          <span style={{ display: "inline-block", background: isPending ? T.warn + "1A" : T.yellow + "1A", color: isPending ? T.warn : T.yellow, border: `1px solid ${isPending ? T.warn : T.yellow}33`, fontSize: 11, fontFamily: MONO, padding: "2px 9px", borderRadius: 4 }}>
                            {isPending ? "Validate Agent" : "Needs Owner"}
                          </span>
                        </TD>
                        <TD><span style={{ color: T.textDim }}>{agent.team || "—"}</span></TD>
                        <TD><span style={{ fontFamily: MONO, color: T.textDim, fontSize: 12 }}>{relativeTime(agent.first_seen_at || agent.created_at)}</span></TD>
                        <TD>
                          {!isPending && (
                            <button onClick={() => setClaimTarget(agent)} style={{ background: "transparent", border: `1px solid ${T.border}`, color: T.textDim, padding: "4px 12px", borderRadius: 4, fontSize: 11, fontFamily: MONO, cursor: "pointer" }}>
                              Review
                            </button>
                          )}
                        </TD>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

      ) : tab === "ownership" ? (

        /* ── Ownership ─────────────────────────────────────────────────────── */
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
            {[
              { label: "Owned",         count: withOwner,         color: T.accent },
              { label: "Needs Owner",   count: total - withOwner, color: T.yellow },
              { label: "Total Agents",  count: total,             color: T.info },
            ].map(({ label, count, color }) => (
              <div key={label} style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 8, padding: "18px 20px" }}>
                <div style={{ fontSize: 9, fontFamily: MONO, color: T.textMute, letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 10 }}>{label}</div>
                <div style={{ fontSize: 30, fontWeight: 700, color, letterSpacing: "-0.03em" }}>{count}</div>
              </div>
            ))}
          </div>

          <div style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 8, padding: "20px 24px" }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: T.text, marginBottom: 16 }}>Ownership Review</div>
            <div style={{ marginBottom: 10, background: T.panelHi, borderRadius: 2, height: 8 }}>
              <div style={{ width: `${total > 0 ? (withOwner / total) * 100 : 0}%`, background: T.accent, height: 8, borderRadius: 2 }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, fontFamily: MONO, color: T.textMute, marginTop: 6 }}>
              <span><span style={{ color: T.accent }}>{withOwner}</span> owned</span>
              <span><span style={{ color: T.yellow }}>{total - withOwner}</span> awaiting ownership review</span>
            </div>
          </div>

          {unassigned.length > 0 && (
            <div style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 8, overflow: "hidden" }}>
              <div style={{ padding: "16px 20px", borderBottom: `1px solid ${T.border}`, fontSize: 14, fontWeight: 600, color: T.text }}>
                Agents Needing Owner ({unassigned.length})
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <STH sortKey="agent_name" sort={unaSort} onSort={toggleUna}>Agent</STH>
                    <STH sortKey="team" sort={unaSort} onSort={toggleUna}>Team</STH>
                    <STH sortKey="environment" sort={unaSort} onSort={toggleUna}>Environment</STH>
                    <STH sortKey="first_seen_at" sort={unaSort} onSort={toggleUna}>First Seen</STH>
                    <STH>Review</STH>
                  </tr>
                </thead>
                <tbody>
                  {sortItems(unassigned, unaSort.key, unaSort.dir).map(agent => (
                    <tr key={agent.agent_id || agent.id}>
                      <TD><span style={{ fontFamily: MONO, color: T.yellow }}>{agent.agent_name || agent.agent_id_raw}</span></TD>
                      <TD><span style={{ color: T.textDim }}>{agent.team || "—"}</span></TD>
                      <TD><span style={{ color: T.textDim, fontSize: 12, fontFamily: MONO }}>{agent.environment || "—"}</span></TD>
                      <TD><span style={{ fontFamily: MONO, color: T.textDim, fontSize: 12 }}>{relativeTime(agent.first_seen_at || agent.created_at)}</span></TD>
                      <TD>
                        <button onClick={() => setClaimTarget(agent)} style={{ background: "transparent", border: `1px solid ${T.border}`, color: T.textDim, padding: "4px 12px", borderRadius: 4, fontSize: 11, fontFamily: MONO, cursor: "pointer" }}>
                          Review
                        </button>
                      </TD>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

      ) : (

        /* ── Policy Coverage ───────────────────────────────────────────────── */
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 8, padding: "24px 28px" }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: T.text, marginBottom: 20 }}>Classification Completeness</div>
            <CoverageBar label="Owner Assigned"            value={withOwner}  total={total} color={T.accent} />
            <CoverageBar label="Environment Classified"    value={withEnv}    total={total} color={T.info} />
            <CoverageBar label="Criticality Assessed"      value={withCrit}   total={total} color={T.warn} />
            <CoverageBar label="Business Purpose Documented" value={withPurpose} total={total} color={T.purple} />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
            {[
              { label: "Managed",        count: managed.length,  color: T.accent,  sub: "Fully governed" },
              { label: "Needs Attention", count: needsValidation.length + unassigned.length, color: T.warn, sub: "Action required" },
              { label: "Retired",        count: retired.length,  color: "#555",    sub: "Decommissioned" },
            ].map(({ label, count, color, sub }) => (
              <div key={label} style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 8, padding: "18px 20px" }}>
                <div style={{ fontSize: 9, fontFamily: MONO, color: T.textMute, letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 10 }}>{label}</div>
                <div style={{ fontSize: 28, fontWeight: 700, color, letterSpacing: "-0.03em", lineHeight: 1 }}>{count}</div>
                <div style={{ fontSize: 11, color: T.textMute, fontFamily: MONO, marginTop: 6 }}>{sub}</div>
              </div>
            ))}
          </div>

          <div style={{ padding: "14px 18px", background: T.info + "0D", border: `1px solid ${T.info}33`, borderRadius: 6, fontSize: 12, color: T.textDim }}>
            <span style={{ color: T.info }}>ℹ</span>&nbsp; Policy coverage improves as agents are claimed, classified by environment and criticality, and have their business purpose documented.
          </div>
        </div>
      )}
    </div>
  );
}
