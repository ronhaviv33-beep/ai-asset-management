import React, { useState, useEffect, useMemo, useCallback } from "react";
import { fetchAgents, claimInventoryAgent, validateInventoryAgent, rejectInventoryAgent, fetchOrgConfig } from "../api.js";

const T = {
  bg: "#0A0B0F", panel: "#0F1117", panelHi: "#141823",
  border: "#1E2230", borderHi: "#2A3142",
  text: "#E8ECF4", textDim: "#7A8499", textMute: "#4B5468",
  accent: "#7CFFB2", warn: "#FFB547", crit: "#FF5C7A",
  info: "#6FA8FF", yellow: "#FFD700", purple: "#B47AFF",
};
const MONO = "'JetBrains Mono','IBM Plex Mono',monospace";
const FONT = "'Geist','Söhne',-apple-system,sans-serif";

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
const fmtUSD = (v) => v > 0 ? "$" + (+(v)).toFixed(2) : "—";

const SOURCE_MAP = {
  gateway_telemetry: { label: "Gateway",    color: T.accent },
  github:            { label: "GitHub",     color: T.info },
  n8n:               { label: "n8n",        color: T.purple },
  slack:             { label: "Slack",      color: "#E8A138" },
  jira:              { label: "Jira",       color: T.warn },
  servicenow:        { label: "ServiceNow", color: T.crit },
  mcp:               { label: "MCP",        color: T.purple },
};

function SourceBadge({ source }) {
  const m = SOURCE_MAP[source] || { label: source || "Unknown", color: T.textDim };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, background: m.color + "1A", color: m.color, border: `1px solid ${m.color}33`, fontSize: 10, fontFamily: MONO, padding: "2px 8px", borderRadius: 20, letterSpacing: "0.05em" }}>
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: m.color }} />
      {m.label}
    </span>
  );
}

function ConfidenceBadge({ score }) {
  const color = score >= 80 ? T.accent : score >= 50 ? T.warn : T.crit;
  return (
    <span style={{ fontFamily: MONO, fontSize: 12, color }}>
      {score ?? "—"}%
    </span>
  );
}

function DiscoveryStatusBadge({ status }) {
  const map = {
    verified:   { label: "Verified",   color: T.accent,    bg: "#1A3D2B" },
    likely:     { label: "Likely",     color: "#2DD4BF",   bg: "#0D2E2B" },
    potential:  { label: "Potential",  color: T.warn,      bg: "#3D2E0D" },
    historical: { label: "Historical", color: T.textDim,   bg: T.panelHi },
  };
  const m = map[status] || { label: status || "—", color: T.textDim, bg: T.panelHi };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, background: m.bg, color: m.color, border: `1px solid ${m.color}33`, fontSize: 10, fontFamily: MONO, fontWeight: 600, padding: "2px 8px", borderRadius: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>
      <span style={{ width: 4, height: 4, borderRadius: "50%", background: m.color }} />
      {m.label}
    </span>
  );
}

function AssetTypeBadge({ assetType }) {
  const map = {
    agent:       { label: "Agent",    color: "#B47AFF", bg: "#1E1A3D" },
    workflow:    { label: "Workflow",  color: "#6FA8FF", bg: "#0D1F3D" },
    application: { label: "App",      color: "#F472B6", bg: "#2D0D1E" },
    copilot:     { label: "Copilot",  color: "#FB923C", bg: "#2D1A0A" },
    service:     { label: "Service",  color: T.accent,  bg: "#1A3D2B" },
  };
  const m = map[assetType] || { label: assetType || "agent", color: T.textDim, bg: T.panelHi };
  return (
    <span style={{ display: "inline-block", background: m.bg, color: m.color, border: `1px solid ${m.color}33`, fontSize: 9, fontFamily: MONO, fontWeight: 600, padding: "1px 6px", borderRadius: 3, textTransform: "uppercase", letterSpacing: "0.05em" }}>
      {m.label}
    </span>
  );
}

function LifecycleBadge({ status }) {
  const map = {
    unassigned:       { label: "Unassigned",      color: T.yellow },
    needs_validation: { label: "Needs Validation", color: T.warn },
    managed:          { label: "Managed",          color: T.accent },
    retired:          { label: "Retired",          color: "#555" },
  };
  const m = map[status] || { label: status || "—", color: T.textDim };
  return (
    <span style={{ display: "inline-block", background: m.color + "1A", color: m.color, border: `1px solid ${m.color}33`, fontSize: 10, fontFamily: MONO, padding: "2px 8px", borderRadius: 4, letterSpacing: "0.05em" }}>
      {m.label}
    </span>
  );
}

function ActionBtn({ label, color, onClick }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ background: hover ? color + "22" : "transparent", border: `1px solid ${hover ? color : T.border}`, color: hover ? color : T.textDim, padding: "4px 10px", borderRadius: 4, fontSize: 11, fontFamily: MONO, cursor: "pointer", transition: "all 0.12s" }}
    >
      {label}
    </button>
  );
}

function ModalOverlay({ onClose, children }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 24 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 10, padding: 28, width: "100%", maxWidth: 520, maxHeight: "90vh", overflowY: "auto", fontFamily: FONT }}>
        {children}
      </div>
    </div>
  );
}

function ModalField({ label, children, required }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: "block", fontSize: 11, fontFamily: MONO, color: T.textMute, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 5 }}>
        {label}{required && <span style={{ color: T.crit }}> *</span>}
      </label>
      {children}
    </div>
  );
}

const claimInputStyle = { width: "100%", background: T.panelHi, border: `1px solid ${T.border}`, color: T.text, padding: "8px 10px", borderRadius: 5, fontSize: 13, fontFamily: FONT, outline: "none", boxSizing: "border-box" };

function ClaimModal({ agent, onClose, onSave, environments = ["production", "staging", "development"] }) {
  const [form, setForm] = useState({
    owner: "",
    team: agent?.team && agent.team !== "Unknown" ? agent.team : "",
    environment: agent?.environment && agent.environment !== "Unknown" ? agent.environment : "",
    criticality: "",
    business_purpose: "",
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  const canSubmit = form.owner.trim() || form.team.trim();

  const submit = async () => {
    if (!canSubmit) { setErr("Enter an owner or a team — at least one is required"); return; }
    setSaving(true);
    setErr("");
    try {
      await onSave(agent.agent_id, { ...form, agent_name: agent.agent_name });
      onClose();
    } catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  };

  return (
    <ModalOverlay onClose={onClose}>
      <div style={{ fontSize: 17, fontWeight: 500, marginBottom: 4, color: T.text }}>Claim Agent</div>
      <div style={{ fontSize: 12, color: T.textMute, fontFamily: MONO, marginBottom: 20 }}>
        Assign ownership to <strong style={{ color: T.text }}>{agent?.agent_name}</strong>
      </div>

      {err && (
        <div style={{ background: "#FF5C7A18", border: "1px solid #FF5C7A44", borderRadius: 5, padding: "8px 12px", marginBottom: 14, fontSize: 12, color: T.crit, fontFamily: MONO }}>
          {err}
        </div>
      )}

      <div style={{ background: T.panelHi, border: `1px solid ${T.border}`, borderRadius: 6, padding: "10px 14px", marginBottom: 20, fontSize: 11, color: T.textMute, fontFamily: MONO }}>
        <div><span style={{ color: T.accent }}>●</span> Source: {(agent?.discovery_source || "gateway").replace(/_/g, " ")}</div>
        <div><span style={{ color: T.accent }}>●</span> Confidence: {(agent?.confidence_score || 95).toFixed(0)}%</div>
        <div style={{ marginTop: 6, fontSize: 10, color: T.textMute }}>Claiming only writes to the registry. Historical telemetry is never modified.</div>
      </div>

      <ModalField label="Owner">
        <input style={claimInputStyle} value={form.owner} onChange={set("owner")} placeholder="owner@company.com" />
        <div style={{ fontSize: 10, color: T.textMute, fontFamily: MONO, marginTop: 4 }}>
          Unknown individual? Leave blank and assign to the team below.
        </div>
      </ModalField>
      <ModalField label="Team">
        <input style={claimInputStyle} value={form.team} onChange={set("team")} placeholder={agent?.team && agent.team !== "Unknown" ? agent.team : "engineering"} />
      </ModalField>
      <ModalField label="Environment">
        <select style={{ ...claimInputStyle, appearance: "none" }} value={form.environment} onChange={set("environment")}>
          <option value="">Select…</option>
          {environments.map(e => <option key={e} value={e}>{e.charAt(0).toUpperCase() + e.slice(1)}</option>)}
        </select>
      </ModalField>
      <ModalField label="Criticality">
        <select style={{ ...claimInputStyle, appearance: "none" }} value={form.criticality} onChange={set("criticality")}>
          <option value="">Select…</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
      </ModalField>
      <ModalField label="Business Purpose">
        <textarea style={{ ...claimInputStyle, minHeight: 72, resize: "vertical" }} value={form.business_purpose} onChange={set("business_purpose")} placeholder="What does this agent do?" />
      </ModalField>

      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
        <button onClick={onClose} style={{ background: "transparent", border: `1px solid ${T.border}`, color: T.textDim, padding: "8px 16px", borderRadius: 5, fontSize: 13, cursor: "pointer", fontFamily: FONT }}>Cancel</button>
        <button onClick={submit} disabled={!canSubmit || saving} style={{ background: T.accent, color: T.bg, border: "none", padding: "8px 20px", borderRadius: 5, fontSize: 13, fontWeight: 600, cursor: canSubmit && !saving ? "pointer" : "not-allowed", opacity: !canSubmit || saving ? 0.6 : 1, fontFamily: FONT }}>
          {saving ? "Claiming…" : "Claim Agent →"}
        </button>
      </div>
    </ModalOverlay>
  );
}

function ValidateConfirmModal({ agent, onConfirm, onClose, busy }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 24 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 10, padding: 28, width: "100%", maxWidth: 420, fontFamily: FONT }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <span style={{ fontSize: 20, color: T.accent }}>✓</span>
          <div style={{ fontSize: 16, fontWeight: 600, color: T.text }}>Confirm Validation</div>
        </div>

        <div style={{ background: T.panelHi, border: `1px solid ${T.border}`, borderRadius: 6, padding: "12px 14px", marginBottom: 18 }}>
          <div style={{ fontSize: 13, fontFamily: MONO, color: T.text, fontWeight: 500, marginBottom: 8 }}>{agent?.agent_name}</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <SourceBadge source={agent?.discovery_source} />
            <ConfidenceBadge score={agent?.confidence_score} />
          </div>
        </div>

        <div style={{ fontSize: 12, color: T.textDim, lineHeight: 1.8, marginBottom: 20 }}>
          Validating this agent will:
          <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
            {["Promote it from Potential → Verified", "Set lifecycle status to Managed", "Record you as the validator in the audit trail"].map(t => (
              <div key={t} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <span style={{ color: T.accent, flexShrink: 0, marginTop: 1 }}>●</span>
                <span style={{ fontSize: 12, color: T.textDim, fontFamily: MONO }}>{t}</span>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ background: "transparent", border: `1px solid ${T.border}`, color: T.textDim, padding: "8px 16px", borderRadius: 5, fontSize: 13, cursor: "pointer", fontFamily: FONT }}>
            Cancel
          </button>
          <button onClick={onConfirm} disabled={busy} style={{ background: T.accent, border: "none", color: T.bg, padding: "8px 20px", borderRadius: 5, fontSize: 13, fontWeight: 600, cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.6 : 1, fontFamily: FONT }}>
            {busy ? "Validating…" : "Confirm Validate ✓"}
          </button>
        </div>
      </div>
    </div>
  );
}

function RejectConfirmModal({ agent, onConfirm, onClose, busy }) {
  const [reason, setReason] = useState("");
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 24 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 10, padding: 28, width: "100%", maxWidth: 420, fontFamily: FONT }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <span style={{ fontSize: 20, color: T.crit }}>✕</span>
          <div style={{ fontSize: 16, fontWeight: 600, color: T.text }}>Reject Agent</div>
        </div>

        <div style={{ background: "#1A0A0F", border: `1px solid ${T.crit}33`, borderRadius: 6, padding: "12px 14px", marginBottom: 18 }}>
          <div style={{ fontSize: 13, fontFamily: MONO, color: T.text, fontWeight: 500, marginBottom: 8 }}>{agent?.agent_name}</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <SourceBadge source={agent?.discovery_source} />
            <ConfidenceBadge score={agent?.confidence_score} />
          </div>
        </div>

        <div style={{ fontSize: 12, color: T.textDim, marginBottom: 16, lineHeight: 1.7 }}>
          Rejecting marks this agent as <strong style={{ color: T.crit }}>retired</strong>. It will no longer appear in active inventory. The registry record is preserved for audit history.
        </div>

        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, fontFamily: MONO, color: T.textMute, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>
            Reason <span style={{ color: T.textMute, textTransform: "none", letterSpacing: 0 }}>(optional)</span>
          </div>
          <textarea
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="e.g. Repository is a template project, not a deployed agent"
            style={{ width: "100%", background: T.panelHi, border: `1px solid ${T.border}`, color: T.text, padding: "8px 10px", borderRadius: 5, fontSize: 12, fontFamily: MONO, resize: "vertical", minHeight: 70, outline: "none", boxSizing: "border-box" }}
          />
        </div>

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ background: "transparent", border: `1px solid ${T.border}`, color: T.textDim, padding: "8px 16px", borderRadius: 5, fontSize: 13, cursor: "pointer", fontFamily: FONT }}>
            Cancel
          </button>
          <button onClick={() => onConfirm(reason)} disabled={busy} style={{ background: T.crit, border: "none", color: "#fff", padding: "8px 20px", borderRadius: 5, fontSize: 13, fontWeight: 600, cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.6 : 1, fontFamily: FONT }}>
            {busy ? "Rejecting…" : "Reject Agent ✕"}
          </button>
        </div>
      </div>
    </div>
  );
}

function EvidenceDrawer({ agent, onClose }) {
  if (!agent) return null;
  const evidence = typeof agent.evidence === "string" ? JSON.parse(agent.evidence || "{}") : (agent.evidence || {});
  return (
    <div style={{ position: "fixed", inset: 0, background: "#000A", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
      <div style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 8, padding: 28, minWidth: 420, maxWidth: 560, fontFamily: FONT }}>
        <div style={{ fontSize: 16, fontWeight: 600, color: T.text, marginBottom: 6 }}>Discovery Evidence</div>
        <div style={{ fontSize: 13, color: T.textDim, marginBottom: 20, fontFamily: MONO }}>{agent.agent_name}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <div style={{ fontSize: 10, color: T.textMute, fontFamily: MONO, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8 }}>Discovery Source</div>
            <SourceBadge source={agent.discovery_source} />
          </div>
          <div>
            <div style={{ fontSize: 10, color: T.textMute, fontFamily: MONO, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8 }}>Confidence Score</div>
            <ConfidenceBadge score={agent.confidence_score} />
          </div>
          {Object.keys(evidence).length > 0 && (
            <div>
              <div style={{ fontSize: 10, color: T.textMute, fontFamily: MONO, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8 }}>Evidence Signals</div>
              <pre style={{ background: T.panelHi, border: `1px solid ${T.border}`, borderRadius: 4, padding: "12px 14px", fontSize: 11, fontFamily: MONO, color: T.text, margin: 0, overflowX: "auto" }}>
                {JSON.stringify(evidence, null, 2)}
              </pre>
            </div>
          )}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 20 }}>
          <button onClick={onClose} style={{ background: "transparent", border: `1px solid ${T.border}`, color: T.textDim, padding: "8px 16px", borderRadius: 4, fontSize: 13, cursor: "pointer" }}>Close</button>
        </div>
      </div>
    </div>
  );
}

const TH = ({ children, style }) => (
  <th style={{ textAlign: "left", padding: "8px 12px", fontSize: 10, fontFamily: MONO, color: T.textMute, letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 500, borderBottom: `1px solid ${T.border}`, background: T.panelHi, ...style }}>
    {children}
  </th>
);

const TD = ({ children, style }) => (
  <td style={{ padding: "10px 12px", fontSize: 13, color: T.text, borderBottom: `1px solid ${T.border}`, verticalAlign: "middle", ...style }}>
    {children}
  </td>
);

function sortItems(list, key, dir) {
  if (!key) return list;
  const mul = dir === "asc" ? 1 : -1;
  const SEV_RANK = { critical: 3, warning: 2, info: 1 };
  return [...list].sort((a, b) => {
    let va = a[key], vb = b[key];
    if (key === "sev")  { va = SEV_RANK[va]  ?? 0; vb = SEV_RANK[vb]  ?? 0; }
    if (["confidence_score", "cost_usd"].includes(key)) { va = +(va||0); vb = +(vb||0); }
    if (["last_seen_at","last_seen","first_seen_at","created_at"].includes(key)) {
      va = va ? new Date(va).getTime() : 0; vb = vb ? new Date(vb).getTime() : 0;
    }
    if (typeof va === "number" && typeof vb === "number") return (va - vb) * mul;
    return String(va || "").toLowerCase().localeCompare(String(vb || "").toLowerCase()) * mul;
  });
}

const STH = ({ children, sortKey, sort, onSort, style }) => {
  const active = sort?.key === sortKey;
  const canSort = !!sortKey;
  return (
    <th onClick={canSort ? () => onSort(sortKey) : undefined}
      style={{ textAlign:"left", padding:"8px 12px", fontSize:10, fontFamily:MONO, color: active ? T.accent : T.textMute, letterSpacing:"0.1em", textTransform:"uppercase", fontWeight:500, borderBottom:`1px solid ${T.border}`, background:T.panelHi, cursor: canSort ? "pointer" : "default", userSelect:"none", ...style }}>
      <span style={{ display:"inline-flex", alignItems:"center", gap:4 }}>
        {children}
        {canSort && <span style={{ fontSize:9, opacity: active?1:0.4, color: active?T.accent:T.textMute }}>{active?(sort.dir==="asc"?"▲":"▼"):"⇅"}</span>}
      </span>
    </th>
  );
};

export default function DiscoveryCenter({ initialTab = "verified" }) {
  const [agents, setAgents]             = useState([]);
  const [loading, setLoading]           = useState(true);
  const [tab, setTab]                   = useState(initialTab);
  const [search, setSearch]             = useState("");
  const [claimAgent, setClaimAgent]           = useState(null);
  const [evidenceAgent, setEvidenceAgent]     = useState(null);
  const [validateConfirm, setValidateConfirm] = useState(null);
  const [rejectConfirm, setRejectConfirm]     = useState(null);
  const [busy, setBusy]                       = useState({});
  const [toastMsg, setToastMsg]               = useState("");
  const [environments, setEnvironments] = useState(["production", "staging", "development"]);
  const [vSort, setVSort] = useState({ key: "cost_usd",          dir: "desc" });
  const [pSort, setPSort] = useState({ key: "confidence_score",  dir: "desc" });
  const toggleV = (key) => setVSort(s => s.key===key ? {key, dir: s.dir==="asc"?"desc":"asc"} : {key, dir:"desc"});
  const toggleP = (key) => setPSort(s => s.key===key ? {key, dir: s.dir==="asc"?"desc":"asc"} : {key, dir:"desc"});

  const toast = (msg) => { setToastMsg(msg); setTimeout(() => setToastMsg(""), 3000); };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const raw = await fetchAgents({ limit: 500 });
      setAgents(Array.isArray(raw) ? raw : raw?.agents || raw?.items || []);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    fetchOrgConfig().then(cfg => { if (cfg?.environments?.length) setEnvironments(cfg.environments); }).catch(() => {});
  }, []);

  const verified   = useMemo(() => agents.filter(a => a.discovery_status === "verified"), [agents]);
  const likely     = useMemo(() => agents.filter(a => a.discovery_status === "likely"), [agents]);
  const historical = useMemo(() => agents.filter(a => a.discovery_status === "historical"), [agents]);
  const potential  = useMemo(() => agents.filter(a => a.discovery_status === "potential"), [agents]);

  const filtered = useMemo(() => {
    const isVerifiedTab = tab === "verified" || tab === "historical";
    const sort = isVerifiedTab ? vSort : pSort;
    const list = tab === "verified" ? verified : tab === "likely" ? likely : tab === "historical" ? historical : potential;
    const q = search.toLowerCase();
    const searched = q ? list.filter(a => (a.agent_name || "").toLowerCase().includes(q) || (a.team || "").toLowerCase().includes(q) || (a.discovery_source || "").toLowerCase().includes(q)) : list;
    return sortItems(searched, sort.key, sort.dir);
  }, [tab, verified, likely, historical, potential, search, vSort, pSort]);

  const handleClaim = async (agentId, body) => {
    await claimInventoryAgent(agentId, body);
    toast("Agent claimed successfully");
    await load();
  };

  const handleValidate = async () => {
    if (!validateConfirm) return;
    const agentId = validateConfirm.agent_id || validateConfirm.id;
    setBusy(b => ({ ...b, [agentId]: "validate" }));
    try {
      await validateInventoryAgent(agentId, { validated: true });
      setValidateConfirm(null);
      toast("Agent validated — moved to Verified Agents");
      await load();
      setTab("verified");
    } catch (e) { toast("Error: " + e.message); }
    finally { setBusy(b => { const n = { ...b }; delete n[agentId]; return n; }); }
  };

  const handleReject = async (reason) => {
    if (!rejectConfirm) return;
    const agentId = rejectConfirm.agent_id || rejectConfirm.id;
    setBusy(b => ({ ...b, [agentId]: "reject" }));
    try {
      await rejectInventoryAgent(agentId, reason || "Rejected from Discovery Center");
      setRejectConfirm(null);
      toast("Agent rejected");
      await load();
    } catch (e) { toast("Error: " + e.message); }
    finally { setBusy(b => { const n = { ...b }; delete n[agentId]; return n; }); }
  };

  return (
    <div style={{ fontFamily: FONT }}>
      {toastMsg && (
        <div style={{ position: "fixed", bottom: 24, right: 24, background: T.panelHi, border: `1px solid ${T.accent}`, color: T.accent, padding: "10px 18px", borderRadius: 6, fontFamily: MONO, fontSize: 13, zIndex: 2000 }}>
          {toastMsg}
        </div>
      )}
      {claimAgent && <ClaimModal agent={claimAgent} onClose={() => setClaimAgent(null)} onSave={handleClaim} environments={environments} />}
      {evidenceAgent && <EvidenceDrawer agent={evidenceAgent} onClose={() => setEvidenceAgent(null)} />}
      {validateConfirm && (
        <ValidateConfirmModal
          agent={validateConfirm}
          onConfirm={handleValidate}
          onClose={() => setValidateConfirm(null)}
          busy={!!busy[validateConfirm.agent_id || validateConfirm.id]}
        />
      )}
      {rejectConfirm && (
        <RejectConfirmModal
          agent={rejectConfirm}
          onConfirm={handleReject}
          onClose={() => setRejectConfirm(null)}
          busy={!!busy[rejectConfirm.agent_id || rejectConfirm.id]}
        />
      )}

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div style={{ display: "flex", gap: 0, background: T.panelHi, border: `1px solid ${T.border}`, borderRadius: 6, padding: 3 }}>
          {[
            { id: "verified",   label: `Verified (${verified.length})` },
            { id: "likely",     label: `Likely (${likely.length})` },
            { id: "potential",  label: `Potential (${potential.length})` },
            { id: "historical", label: `Historical (${historical.length})` },
          ].map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{ background: tab === t.id ? T.panel : "transparent", border: tab === t.id ? `1px solid ${T.border}` : "1px solid transparent", color: tab === t.id ? T.text : T.textDim, padding: "7px 16px", borderRadius: 4, fontSize: 12, fontFamily: MONO, cursor: "pointer", transition: "all 0.12s" }}>
              {t.label}
            </button>
          ))}
        </div>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search agents…"
          style={{ background: T.panelHi, border: `1px solid ${T.border}`, color: T.text, padding: "8px 14px", borderRadius: 4, fontSize: 13, fontFamily: FONT, width: 220 }} />
      </div>

      {/* Context info */}
      {tab === "verified" && (
        <div style={{ marginBottom: 16, padding: "10px 14px", background: T.accent + "0D", border: `1px solid ${T.accent}33`, borderRadius: 6, fontSize: 12, color: T.textDim }}>
          <span style={{ color: T.accent }}>●</span>&nbsp; Verified agents have been observed making real API calls through the runtime gateway. Confidence: 95%.
        </div>
      )}
      {tab === "likely" && (
        <div style={{ marginBottom: 16, padding: "10px 14px", background: "#2DD4BF0D", border: "1px solid #2DD4BF33", borderRadius: 6, fontSize: 12, color: T.textDim }}>
          <span style={{ color: "#2DD4BF" }}>●</span>&nbsp; Likely agents have multiple evidence sources or high confidence scores (≥70%) from platform signals. Strong candidates for validation.
        </div>
      )}
      {tab === "potential" && (
        <div style={{ marginBottom: 16, padding: "10px 14px", background: T.warn + "0D", border: `1px solid ${T.warn}33`, borderRadius: 6, fontSize: 12, color: T.textDim }}>
          <span style={{ color: T.warn }}>●</span>&nbsp; Potential agents were detected from platform signals (GitHub, Slack, Jira, etc.) but have not yet been confirmed through runtime traffic. Validate or reject each signal.
        </div>
      )}
      {tab === "historical" && (
        <div style={{ marginBottom: 16, padding: "10px 14px", background: T.textDim + "0D", border: `1px solid ${T.border}`, borderRadius: 6, fontSize: 12, color: T.textDim }}>
          <span style={{ color: T.textDim }}>●</span>&nbsp; Historical agents were previously verified but have had no runtime activity for over 90 days. They may be decommissioned or hibernating.
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div style={{ color: T.textMute, fontFamily: MONO, fontSize: 13, padding: "32px 0", textAlign: "center" }}>Loading agents…</div>
      ) : (
        <div style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 8, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {(tab === "verified" || tab === "historical") ? (
                  <>
                    <STH sortKey="agent_name" sort={vSort} onSort={toggleV}>Agent Name</STH>
                    <STH sortKey="asset_type" sort={vSort} onSort={toggleV}>Type</STH>
                    <STH sortKey="discovery_status" sort={vSort} onSort={toggleV}>Discovery</STH>
                    <STH sortKey="team" sort={vSort} onSort={toggleV}>Team</STH>
                    <STH sortKey="environment" sort={vSort} onSort={toggleV}>Environment</STH>
                    <STH sortKey="owner" sort={vSort} onSort={toggleV}>Owner</STH>
                    <STH sortKey="last_seen_at" sort={vSort} onSort={toggleV}>Last Seen</STH>
                    <STH sortKey="cost_usd" sort={vSort} onSort={toggleV} style={{ textAlign: "right" }}>Monthly Cost</STH>
                    <STH sortKey="lifecycle_status" sort={vSort} onSort={toggleV}>Status</STH>
                    <STH sort={vSort} onSort={toggleV} style={{ textAlign: "right" }}>Actions</STH>
                  </>
                ) : (
                  <>
                    <STH sortKey="agent_name" sort={pSort} onSort={toggleP}>Agent Name</STH>
                    <STH sortKey="asset_type" sort={pSort} onSort={toggleP}>Type</STH>
                    <STH sortKey="discovery_status" sort={pSort} onSort={toggleP}>Discovery</STH>
                    <STH sortKey="discovery_source" sort={pSort} onSort={toggleP}>Source</STH>
                    <STH sortKey="confidence_score" sort={pSort} onSort={toggleP}>Confidence</STH>
                    <STH sortKey="first_seen_at" sort={pSort} onSort={toggleP}>First Detected</STH>
                    <STH sort={pSort} onSort={toggleP} style={{ textAlign: "right" }}>Actions</STH>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: "center", padding: 32, color: T.textMute, fontFamily: MONO, fontSize: 13 }}>
                    {search ? "No agents match your search" : tab === "verified" ? "No verified agents yet" : tab === "historical" ? "No historical agents" : tab === "likely" ? "No likely agents" : "No potential agents to review"}
                  </td>
                </tr>
              ) : filtered.map(agent => {
                const id = agent.agent_id || agent.id;
                const isBusy = busy[id];
                return (tab === "verified" || tab === "historical") ? (
                  <tr key={id}>
                    <TD><span style={{ fontFamily: MONO, color: T.accent }}>{agent.agent_name || agent.agent_id_raw || id}</span></TD>
                    <TD><AssetTypeBadge assetType={agent.asset_type} /></TD>
                    <TD><DiscoveryStatusBadge status={agent.discovery_status} /></TD>
                    <TD><span style={{ color: T.textDim }}>{agent.team || "—"}</span></TD>
                    <TD>
                      {agent.environment && agent.environment !== "Unknown"
                        ? <span style={{ fontSize: 11, fontFamily: MONO, color: T.info, background: "#0D1F3D", padding: "2px 7px", borderRadius: 3 }}>{agent.environment}</span>
                        : <span style={{ color: T.textMute }}>—</span>}
                    </TD>
                    <TD><span style={{ color: agent.owner ? T.text : T.textMute }}>{agent.owner || "Unassigned"}</span></TD>
                    <TD><span style={{ fontFamily: MONO, color: T.textDim, fontSize: 12 }}>{relativeTime(agent.last_seen_at || agent.last_seen)}</span></TD>
                    <TD style={{ textAlign: "right" }}><span style={{ fontFamily: MONO }}>{fmtUSD(agent.cost_usd || 0)}</span></TD>
                    <TD><LifecycleBadge status={agent.lifecycle_status} /></TD>
                    <TD style={{ textAlign: "right" }}>
                      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                        {(!agent.owner || agent.lifecycle_status === "unassigned") && (
                          <ActionBtn label="Claim" color={T.accent} onClick={() => setClaimAgent(agent)} />
                        )}
                      </div>
                    </TD>
                  </tr>
                ) : (
                  <tr key={id}>
                    <TD><span style={{ fontFamily: MONO, color: T.warn }}>{agent.agent_name || agent.agent_id_raw || id}</span></TD>
                    <TD><AssetTypeBadge assetType={agent.asset_type} /></TD>
                    <TD><DiscoveryStatusBadge status={agent.discovery_status} /></TD>
                    <TD><SourceBadge source={agent.discovery_source} /></TD>
                    <TD><ConfidenceBadge score={agent.confidence_score} /></TD>
                    <TD><span style={{ fontFamily: MONO, color: T.textDim, fontSize: 12 }}>{relativeTime(agent.first_seen_at || agent.created_at)}</span></TD>
                    <TD style={{ textAlign: "right" }}>
                      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                        <ActionBtn label={isBusy === "validate" ? "…" : "Validate"} color={T.accent} onClick={() => setValidateConfirm(agent)} />
                        <ActionBtn label={isBusy === "reject"   ? "…" : "Reject"}   color={T.crit}  onClick={() => setRejectConfirm(agent)} />
                        <ActionBtn label="Evidence" color={T.info} onClick={() => setEvidenceAgent(agent)} />
                      </div>
                    </TD>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div style={{ marginTop: 12, fontSize: 11, color: T.textMute, fontFamily: MONO }}>
        {filtered.length} agent{filtered.length !== 1 ? "s" : ""} shown{search ? ` matching "${search}"` : ""}
      </div>
    </div>
  );
}
