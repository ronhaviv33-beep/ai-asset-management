import React, { useState, useEffect, useCallback } from "react";
import { T, FONT_UI, FONT_MONO } from "../theme.js";
import { useRoles } from "../auth.jsx";
import {
  fetchGuardModes, setGuardMode, fetchHealth,
  fetchProviderCredentials, upsertProviderCredential, deleteProviderCredential,
  fetchRoles, createRole, updateRole, deleteRole,
  fetchKeyStatuses, fetchOrgConfig, updateOrgConfig, updateKey,
  authFetch, BASE,
} from "../api.js";

// ── Shared mini-primitives (local copies — Settings is self-contained) ─────────
const Card = ({ children, style, title, subtitle }) => (
  <div style={{ background:T.panel, border:`1px solid ${T.border}`, borderRadius:6, padding:18, ...style }}>
    {(title) && (
      <div style={{ marginBottom:14 }}>
        {title    && <div style={{ fontSize:11, letterSpacing:"0.12em", textTransform:"uppercase", color:T.textDim, fontFamily:FONT_MONO, fontWeight:500 }}>{title}</div>}
        {subtitle && <div style={{ fontSize:13, color:T.textMute, marginTop:4 }}>{subtitle}</div>}
      </div>
    )}
    {children}
  </div>
);

const Pill = ({ children, color }) => (
  <span style={{ display:"inline-flex", alignItems:"center", padding:"2px 8px", borderRadius:3, fontSize:10, fontFamily:FONT_MONO, letterSpacing:"0.08em", textTransform:"uppercase", background:`${color}18`, color, border:`1px solid ${color}33` }}>{children}</span>
);

// ── Guard Modes ───────────────────────────────────────────────────────────────
export const GUARD_MODE_META = {
  observe: { color: "#3b82f6", label: "Observe", desc: "Log & shadow-block only — never blocks" },
  alert:   { color: "#eab308", label: "Alert",   desc: "Logs + fires alerts — never blocks" },
  enforce: { color: "#ef4444", label: "Enforce", desc: "Actively blocks violations" },
};

function GuardModesSection() {
  const [rows,    setRows]    = useState([]);
  const [health,  setHealth]  = useState(null);
  const [loading, setLoading] = useState(true);
  const [err,     setErr]     = useState(null);
  const [busy,    setBusy]    = useState(null);

  const load = useCallback(async () => {
    try {
      const [modes, h] = await Promise.all([fetchGuardModes(), fetchHealth().catch(() => null)]);
      setRows(modes);
      setHealth(h);
    } catch { /* ignore load errors */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleChange = async (team, mode) => {
    setBusy(team); setErr(null);
    try { await setGuardMode(team, mode); await load(); }
    catch (e) { setErr(e.message); }
    finally { setBusy(null); }
  };

  const platformMode = health?.platform_mode || "observe";
  const cb = health?.circuit_breaker;

  return (
    <Card title="Guard Modes" subtitle="Visibility First → Governance Later. Graduate each team independently from observe to enforce.">
      {err && <div style={{ color:T.crit, fontFamily:FONT_MONO, fontSize:12, marginBottom:12 }}>{err}</div>}
      <div style={{ display:"flex", gap:12, flexWrap:"wrap", marginBottom:16 }}>
        <div style={{ background:T.panelHi, border:`1px solid ${T.border}`, borderRadius:6, padding:"10px 14px", flex:1, minWidth:200 }}>
          <div style={{ fontSize:9, fontFamily:FONT_MONO, letterSpacing:"0.12em", textTransform:"uppercase", color:T.textMute }}>Platform default</div>
          <div style={{ marginTop:6, display:"flex", alignItems:"center", gap:8 }}>
            <span style={{ width:8, height:8, borderRadius:"50%", background:GUARD_MODE_META[platformMode]?.color }} />
            <span style={{ fontFamily:FONT_MONO, fontSize:13, color:T.text, fontWeight:600 }}>{GUARD_MODE_META[platformMode]?.label || platformMode}</span>
            <span style={{ fontFamily:FONT_MONO, fontSize:10, color:T.textMute }}>(GUARD_MODE env var)</span>
          </div>
        </div>
        {cb && (
          <div style={{ background:T.panelHi, border:`1px solid ${T.border}`, borderRadius:6, padding:"10px 14px", flex:1, minWidth:200 }}>
            <div style={{ fontSize:9, fontFamily:FONT_MONO, letterSpacing:"0.12em", textTransform:"uppercase", color:T.textMute }}>Circuit breaker</div>
            <div style={{ marginTop:6, display:"flex", alignItems:"center", gap:8 }}>
              <span style={{ width:8, height:8, borderRadius:"50%", background: cb.state === "open" ? T.crit : T.accent }} />
              <span style={{ fontFamily:FONT_MONO, fontSize:13, color:T.text, fontWeight:600 }}>{cb.state === "open" ? "OPEN (bypassing)" : "Closed (healthy)"}</span>
              {health.uptime_seconds != null && (
                <span style={{ fontFamily:FONT_MONO, fontSize:10, color:T.textMute }}>· up {Math.floor(health.uptime_seconds/3600)}h</span>
              )}
            </div>
          </div>
        )}
      </div>
      {loading ? (
        <div style={{ color:T.textDim, fontFamily:FONT_MONO, fontSize:12, padding:12 }}>Loading…</div>
      ) : (
        <table style={{ width:"100%", borderCollapse:"collapse" }}>
          <thead>
            <tr style={{ borderBottom:`1px solid ${T.border}` }}>
              {["Team","Effective Mode","Would block (30d)","Set mode"].map(h => (
                <th key={h} style={{ textAlign:"left", padding:"10px 8px", fontFamily:FONT_MONO, fontSize:10, letterSpacing:"0.1em", textTransform:"uppercase", color:T.textDim, fontWeight:500 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={4} style={{ padding:20, textAlign:"center", color:T.textMute, fontFamily:FONT_MONO, fontSize:12 }}>No teams seen yet — they appear here once traffic flows.</td></tr>
            )}
            {rows.map(r => {
              const meta = GUARD_MODE_META[r.mode] || {};
              return (
                <tr key={r.team} style={{ borderBottom:`1px solid ${T.border}` }}>
                  <td style={{ padding:"12px 8px", fontSize:12, color:T.text, fontWeight:500 }}>{r.team}</td>
                  <td style={{ padding:"12px 8px" }}>
                    <span style={{ display:"inline-flex", alignItems:"center", gap:6 }}>
                      <span style={{ width:8, height:8, borderRadius:"50%", background:meta.color }} />
                      <span style={{ fontFamily:FONT_MONO, fontSize:12, color:T.text }}>{meta.label || r.mode}</span>
                      {!r.is_override && <span style={{ fontFamily:FONT_MONO, fontSize:9, color:T.textMute }}>(default)</span>}
                    </span>
                  </td>
                  <td style={{ padding:"12px 8px" }}>
                    <span style={{ fontFamily:FONT_MONO, fontSize:12, color: r.would_block_30d > 0 ? T.warn : T.textMute, fontWeight: r.would_block_30d > 0 ? 600 : 400 }}>
                      {r.would_block_30d}
                    </span>
                  </td>
                  <td style={{ padding:"10px 8px" }}>
                    <select
                      value={r.is_override ? r.mode : "default"}
                      disabled={busy === r.team}
                      onChange={e => handleChange(r.team, e.target.value)}
                      style={{ background:T.bg, color:T.text, border:`1px solid ${T.border}`, padding:"5px 10px", borderRadius:4, fontSize:12, fontFamily:FONT_MONO, cursor:"pointer" }}>
                      <option value="default">Default ({platformMode})</option>
                      <option value="observe">Observe</option>
                      <option value="alert">Alert</option>
                      <option value="enforce">Enforce</option>
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <div style={{ marginTop:14, fontSize:11, fontFamily:FONT_MONO, color:T.textMute, lineHeight:1.7 }}>
        <strong style={{ color:T.textDim }}>Would block (30d)</strong> shows how many requests <em>would</em> have been blocked in enforce mode — watch this before graduating a team. Every mode change is written to the audit log.
      </div>
    </Card>
  );
}

// ── Provider Credentials (BYOK) ───────────────────────────────────────────────
const PROVIDER_META = {
  openai:    { label: "OpenAI",    placeholder: "sk-…" },
  anthropic: { label: "Anthropic", placeholder: "sk-ant-…" },
  google:    { label: "Google",    placeholder: "AIza…" },
  local:     { label: "Local LLM", placeholder: "http://localhost:11434", isUrl: true },
};
const ALL_PROVIDERS = Object.keys(PROVIDER_META);

function ProviderCredentialsSection() {
  const [creds,      setCreds]      = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [err,        setErr]        = useState(null);
  const [editing,    setEditing]    = useState(null);
  const [keyVal,     setKeyVal]     = useState("");
  const [urlVal,     setUrlVal]     = useState("");
  const [saving,     setSaving]     = useState(false);
  const [confirmDel, setConfirmDel] = useState(null);
  const [deleting,   setDeleting]   = useState(null);
  const [flash,      setFlash]      = useState(null);
  const [saveErr,    setSaveErr]    = useState(null);

  const load = useCallback(async () => {
    try { const data = await fetchProviderCredentials(); setCreds(data); }
    catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const startEdit = (provider) => {
    setEditing(provider);
    setKeyVal("");
    setUrlVal(creds.find(c => c.provider === provider)?.base_url || "");
    setSaveErr(null); setFlash(null); setConfirmDel(null);
  };
  const cancelEdit = () => { setEditing(null); setKeyVal(""); setUrlVal(""); setSaveErr(null); };

  const handleSave = async () => {
    const meta = PROVIDER_META[editing];
    if (!meta) return;
    if (meta.isUrl ? !urlVal.trim() : !keyVal.trim()) return;
    setSaving(true); setSaveErr(null);
    try {
      await upsertProviderCredential(editing, meta.isUrl ? "local" : keyVal.trim(), meta.isUrl ? urlVal.trim() : undefined);
      setFlash(editing); cancelEdit(); await load();
    } catch (e) { setSaveErr(e.message); }
    finally { setSaving(false); }
  };

  const handleDeleteConfirmed = async (provider) => {
    setConfirmDel(null); setDeleting(provider); setErr(null);
    try { await deleteProviderCredential(provider); await load(); }
    catch (e) { setErr(e.message); }
    finally { setDeleting(null); }
  };

  return (
    <Card title="Provider Credentials" subtitle="Stored securely and used internally by the gateway to reach providers (OpenAI, Anthropic, Gemini, Azure). Write-only — only the last 4 characters are shown. Never expose provider keys in your application code; use a Gateway API Key there instead.">
      {err && <div style={{ color:T.crit, fontFamily:FONT_MONO, fontSize:12, marginBottom:12 }}>{err}</div>}
      {loading ? (
        <div style={{ color:T.textDim, fontFamily:FONT_MONO, fontSize:12, padding:12 }}>Loading…</div>
      ) : (
        <table style={{ width:"100%", borderCollapse:"collapse" }}>
          <thead>
            <tr style={{ borderBottom:`1px solid ${T.border}` }}>
              {["Provider","Status","Key (last 4)",""].map(h => (
                <th key={h} style={{ textAlign:"left", padding:"10px 8px", fontFamily:FONT_MONO, fontSize:10, letterSpacing:"0.1em", textTransform:"uppercase", color:T.textDim, fontWeight:500 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ALL_PROVIDERS.map(provider => {
              const meta = PROVIDER_META[provider];
              const cred = creds.find(c => c.provider === provider);
              const isSet = !!cred;
              const isOpen = editing === provider;
              const isPendingDel = confirmDel === provider;
              return (
                <React.Fragment key={provider}>
                  <tr style={{ borderBottom: (isOpen || isPendingDel) ? "none" : `1px solid ${T.border}` }}>
                    <td style={{ padding:"14px 8px", fontSize:13, color:T.text, fontWeight:500 }}>
                      {meta.label}
                      {meta.isUrl && <span style={{ fontFamily:FONT_MONO, fontSize:9, color:T.textMute, marginLeft:6 }}>base_url</span>}
                    </td>
                    <td style={{ padding:"14px 8px" }}>
                      {isSet ? <Pill color={T.accent}>configured</Pill> : <Pill color={T.textMute}>not set</Pill>}
                      {flash === provider && <span style={{ fontFamily:FONT_MONO, fontSize:10, color:T.accent, marginLeft:8 }}>✓ saved</span>}
                    </td>
                    <td style={{ padding:"14px 8px", fontFamily:FONT_MONO, fontSize:12, color:T.textDim }}>
                      {isSet ? (meta.isUrl ? <span style={{ color:T.textDim }}>{cred.base_url || "—"}</span> : <span>····{cred.last4}</span>) : <span style={{ color:T.textMute }}>—</span>}
                    </td>
                    <td style={{ padding:"14px 8px", display:"flex", gap:8, alignItems:"center" }}>
                      {!isOpen && !isPendingDel && (
                        <button onClick={() => startEdit(provider)}
                          style={{ background:`${T.info}15`, border:`1px solid ${T.info}44`, color:T.info, padding:"5px 12px", borderRadius:3, fontSize:11, fontFamily:FONT_MONO, cursor:"pointer" }}>
                          {isSet ? "Update" : "Set key"}
                        </button>
                      )}
                      {isSet && !isOpen && !isPendingDel && (
                        <button onClick={() => { setConfirmDel(provider); setEditing(null); }}
                          disabled={deleting === provider}
                          style={{ background:`${T.crit}15`, border:`1px solid ${T.crit}44`, color:T.crit, padding:"5px 10px", borderRadius:3, fontSize:11, fontFamily:FONT_MONO, cursor:"pointer", opacity: deleting===provider ? 0.5 : 1 }}>
                          {deleting === provider ? "…" : "Remove"}
                        </button>
                      )}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr style={{ borderBottom:`1px solid ${T.border}` }}>
                      <td colSpan={4} style={{ padding:"0 8px 14px" }}>
                        <div style={{ display:"flex", flexDirection:"column", gap:8, background:`${T.info}08`, border:`1px solid ${T.info}22`, borderRadius:6, padding:"12px 14px" }}>
                          {meta.isUrl ? (
                            <>
                              <input autoFocus type="text" placeholder="http://localhost:11434"
                                value={urlVal} onChange={e => setUrlVal(e.target.value)}
                                onKeyDown={e => { if (e.key==="Enter") handleSave(); if (e.key==="Escape") cancelEdit(); }}
                                style={{ flex:1, background:T.bg, color:T.text, border:`1px solid ${T.border}`, padding:"8px 12px", borderRadius:4, fontSize:13, fontFamily:FONT_MONO }} />
                              <div style={{ fontSize:10, fontFamily:FONT_MONO, color:T.warn, lineHeight:1.5 }}>
                                The server makes outbound requests to this URL. Only use trusted, controlled endpoints.
                              </div>
                            </>
                          ) : (
                            <input autoFocus type="password" placeholder={`Paste ${meta.label} key (${meta.placeholder})`}
                              value={keyVal} onChange={e => setKeyVal(e.target.value)}
                              onKeyDown={e => { if (e.key==="Enter") handleSave(); if (e.key==="Escape") cancelEdit(); }}
                              style={{ flex:1, background:T.bg, color:T.text, border:`1px solid ${T.border}`, padding:"8px 12px", borderRadius:4, fontSize:13, fontFamily:FONT_MONO }} />
                          )}
                          {saveErr && (
                            <div style={{ fontFamily:FONT_MONO, fontSize:11, color:T.crit, background:`${T.crit}10`, border:`1px solid ${T.crit}33`, borderRadius:4, padding:"8px 10px" }}>{saveErr}</div>
                          )}
                          <div style={{ display:"flex", gap:8 }}>
                            <button onClick={handleSave} disabled={saving || (meta.isUrl ? !urlVal.trim() : !keyVal.trim())}
                              style={{ background:T.accent, color:T.bg, border:"none", padding:"8px 18px", borderRadius:4, fontSize:12, fontFamily:FONT_MONO, fontWeight:600, cursor:"pointer", opacity:(saving||(meta.isUrl?!urlVal.trim():!keyVal.trim()))?0.5:1 }}>
                              {saving ? "Validating & saving…" : isSet ? "Rotate" : "Save"}
                            </button>
                            <button onClick={cancelEdit}
                              style={{ background:"transparent", border:`1px solid ${T.border}`, color:T.textDim, padding:"8px 12px", borderRadius:4, fontSize:12, fontFamily:FONT_MONO, cursor:"pointer" }}>
                              Cancel
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                  {isPendingDel && (
                    <tr style={{ borderBottom:`1px solid ${T.border}` }}>
                      <td colSpan={4} style={{ padding:"0 8px 14px" }}>
                        <div style={{ background:`${T.crit}08`, border:`1px solid ${T.crit}33`, borderRadius:6, padding:"12px 14px", display:"flex", flexDirection:"column", gap:10 }}>
                          <div style={{ fontFamily:FONT_MONO, fontSize:12, color:T.warn, lineHeight:1.6 }}>
                            Removing the {meta.label} key will <strong style={{ color:T.crit }}>block all {meta.label} requests</strong> immediately.
                          </div>
                          <div style={{ display:"flex", gap:8 }}>
                            <button onClick={() => handleDeleteConfirmed(provider)}
                              style={{ background:T.crit, color:"#fff", border:"none", padding:"7px 16px", borderRadius:4, fontSize:12, fontFamily:FONT_MONO, fontWeight:600, cursor:"pointer" }}>
                              Remove anyway
                            </button>
                            <button onClick={() => setConfirmDel(null)}
                              style={{ background:"transparent", border:`1px solid ${T.border}`, color:T.textDim, padding:"7px 12px", borderRadius:4, fontSize:12, fontFamily:FONT_MONO, cursor:"pointer" }}>
                              Cancel
                            </button>
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
    </Card>
  );
}

// ── Role Management ───────────────────────────────────────────────────────────
const ALL_PAGES = ["home","chat","overview","cost","agents","models","workflows","alerts","budgets","security","users","apikeys","settings","integrations","onboarding","agent_inventory","discovery","governance","relationship_map","security_intel","ecosystem","pricing","welcome"];
const ALL_CAPS  = ["view_all_sessions"];

function RolesManagementSection() {
  const rolesMap = useRoles();
  const [serverRoles, setServerRoles] = useState(Object.values(rolesMap));
  const [err, setErr] = useState(null);
  const [adding, setAdding] = useState(false);
  const [newForm, setNewForm] = useState({ name:"", label:"", color:"#7A8499", pages:[], can:[] });
  const [saving, setSaving] = useState(false);
  const [editingRole, setEditingRole] = useState(null);

  const load = useCallback(async () => {
    try { const data = await fetchRoles(); setServerRoles(data); setErr(null); }
    catch { /* silently keep showing initial state */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async () => {
    if (!newForm.name || !newForm.label) { setErr("Name and label are required"); return; }
    setSaving(true); setErr(null);
    try {
      await createRole(newForm);
      setAdding(false);
      setNewForm({ name:"", label:"", color:"#7A8499", pages:[], can:[] });
      await load();
    } catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  };

  const handleDelete = async (name) => {
    if (!window.confirm(`Delete role "${name}"? Users assigned to it will be unable to log in until reassigned.`)) return;
    setErr(null);
    try { await deleteRole(name); await load(); }
    catch (e) { setErr(e.message); }
  };

  const togglePage = (role, page) => ({
    ...role,
    pages: role.pages.includes(page) ? role.pages.filter(p => p !== page) : [...role.pages, page],
  });

  const toggleCap = (role, cap) => ({
    ...role,
    can: role.can.includes(cap) ? role.can.filter(c => c !== cap) : [...role.can, cap],
  });

  const saveEdit = async (role) => {
    setSaving(true); setErr(null);
    try {
      await updateRole(role.name, { label: role.label, color: role.color, pages: role.pages, can: role.can });
      setEditingRole(null); await load();
    } catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  };

  const ADMIN_REQUIRED = new Set(["settings", "users"]);

  const PageToggle = ({ page, active, onChange, locked }) => (
    <button onClick={locked ? undefined : onChange}
      title={locked ? "Required for admin — cannot be removed" : undefined}
      style={{ padding:"3px 8px", borderRadius:4, fontSize:10, fontFamily:FONT_MONO,
        cursor: locked ? "not-allowed" : "pointer", opacity: locked ? 0.5 : 1,
        background: active ? `${T.accent}22` : T.panelHi,
        border: `1px solid ${active ? T.accent : T.border}`,
        color: active ? T.accent : T.textDim }}>
      {page}{locked ? " 🔒" : ""}
    </button>
  );

  return (
    <Card title="Role Management" subtitle="Define roles and their page access. Changes take effect on next login.">
      <div style={{ background:`${T.warn}12`, border:`1px solid ${T.warn}44`, borderRadius:6, padding:"10px 14px", marginBottom:14, display:"flex", gap:10, alignItems:"flex-start" }}>
        <span style={{ color:T.warn, fontSize:13, flexShrink:0 }}>⚠</span>
        <div style={{ fontSize:12, color:T.warn, lineHeight:1.6 }}>
          <strong>Custom roles are not yet server-enforced.</strong>{" "}
          Roles beyond <code style={{ fontFamily:FONT_MONO, fontSize:11 }}>admin</code>, <code style={{ fontFamily:FONT_MONO, fontSize:11 }}>analyst</code>, and <code style={{ fontFamily:FONT_MONO, fontSize:11 }}>viewer</code> control the UI only — backend endpoints still require admin.
        </div>
      </div>
      {err && <div style={{ color:T.crit, fontFamily:FONT_MONO, fontSize:12, marginBottom:10 }}>{err}</div>}
      <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
        {serverRoles.map(role => {
          const isEditing = editingRole?.name === role.name;
          const r = isEditing ? editingRole : role;
          return (
            <div key={role.name} style={{ background:T.panelHi, border:`1px solid ${T.border}`, borderRadius:8, padding:14 }}>
              <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom: isEditing ? 12 : 0 }}>
                <div style={{ width:10, height:10, borderRadius:"50%", background:r.color, flexShrink:0 }}/>
                {isEditing ? (
                  <input value={r.label} onChange={e => setEditingRole({...r, label:e.target.value})}
                    style={{ background:T.panel, color:T.text, border:`1px solid ${T.border}`, padding:"4px 8px", borderRadius:4, fontSize:13, fontWeight:600, width:160 }}/>
                ) : (
                  <span style={{ fontSize:13, fontWeight:600, flex:1 }}>{r.label}</span>
                )}
                <span style={{ fontSize:10, fontFamily:FONT_MONO, color:T.textMute }}>{role.name}</span>
                {isEditing && (
                  <input type="color" value={r.color} onChange={e => setEditingRole({...r, color:e.target.value})}
                    style={{ width:28, height:28, borderRadius:4, border:"none", background:"none", cursor:"pointer", padding:0 }}/>
                )}
                {!["admin","analyst","viewer"].includes(role.name) && !isEditing && (
                  <button onClick={() => setEditingRole({...role})}
                    style={{ background:"transparent", border:`1px solid ${T.border}`, color:T.textDim, borderRadius:4, padding:"3px 10px", fontSize:11, fontFamily:FONT_MONO, cursor:"pointer" }}>
                    Edit
                  </button>
                )}
                {!["admin","analyst","viewer"].includes(role.name) && !isEditing && (
                  <button onClick={() => handleDelete(role.name)}
                    style={{ background:`${T.crit}15`, border:`1px solid ${T.crit}44`, color:T.crit, borderRadius:4, padding:"3px 10px", fontSize:11, fontFamily:FONT_MONO, cursor:"pointer" }}>
                    Delete
                  </button>
                )}
              </div>
              {isEditing && (
                <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                  <div>
                    <div style={{ fontSize:9, fontFamily:FONT_MONO, letterSpacing:"0.12em", textTransform:"uppercase", color:T.textMute, marginBottom:6 }}>Pages</div>
                    <div style={{ display:"flex", flexWrap:"wrap", gap:5 }}>
                      {ALL_PAGES.map(p => (
                        <PageToggle key={p} page={p} active={r.pages.includes(p)}
                          onChange={() => setEditingRole(togglePage(r, p))}
                          locked={r.name === "admin" && ADMIN_REQUIRED.has(p)}/>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize:9, fontFamily:FONT_MONO, letterSpacing:"0.12em", textTransform:"uppercase", color:T.textMute, marginBottom:6 }}>Capabilities</div>
                    <div style={{ display:"flex", flexWrap:"wrap", gap:5 }}>
                      {ALL_CAPS.map(c => (
                        <PageToggle key={c} page={c} active={r.can.includes(c)} onChange={() => setEditingRole(toggleCap(r, c))}/>
                      ))}
                    </div>
                  </div>
                  <div style={{ display:"flex", gap:8, marginTop:4 }}>
                    <button onClick={() => saveEdit(r)} disabled={saving}
                      style={{ background:T.accent, color:T.bg, border:"none", borderRadius:4, padding:"6px 16px", fontSize:11, fontFamily:FONT_MONO, fontWeight:600, cursor:"pointer", opacity:saving?0.6:1 }}>
                      {saving ? "Saving…" : "Save"}
                    </button>
                    <button onClick={() => setEditingRole(null)}
                      style={{ background:"transparent", border:`1px solid ${T.border}`, color:T.textDim, borderRadius:4, padding:"6px 12px", fontSize:11, fontFamily:FONT_MONO, cursor:"pointer" }}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              {!isEditing && (
                <div style={{ marginTop:8, display:"flex", flexWrap:"wrap", gap:4 }}>
                  {role.pages.map(p => (
                    <span key={p} style={{ fontSize:9, fontFamily:FONT_MONO, color:T.textMute, background:T.panel, border:`1px solid ${T.border}`, padding:"2px 6px", borderRadius:3 }}>{p}</span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {!adding && (
          <button onClick={() => setAdding(true)}
            style={{ background:`${T.accent}12`, border:`1px dashed ${T.accentDim}`, color:T.accent, borderRadius:6, padding:"10px 0", fontSize:12, fontFamily:FONT_MONO, cursor:"pointer" }}>
            + Add Role
          </button>
        )}
        {adding && (
          <div style={{ background:T.panelHi, border:`1px solid ${T.borderHi}`, borderRadius:8, padding:14, display:"flex", flexDirection:"column", gap:10 }}>
            <div style={{ fontSize:12, fontWeight:600, color:T.text }}>New Role</div>
            <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
              <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
                <label style={{ fontSize:9, fontFamily:FONT_MONO, letterSpacing:"0.12em", textTransform:"uppercase", color:T.textMute }}>Name (slug)</label>
                <input placeholder="billing-admin" value={newForm.name} onChange={e => setNewForm({...newForm, name:e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g,"")})}
                  style={{ background:T.panel, color:T.text, border:`1px solid ${T.border}`, padding:"6px 10px", borderRadius:4, fontSize:12, fontFamily:FONT_MONO, width:140 }}/>
              </div>
              <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
                <label style={{ fontSize:9, fontFamily:FONT_MONO, letterSpacing:"0.12em", textTransform:"uppercase", color:T.textMute }}>Display Label</label>
                <input placeholder="Billing Admin" value={newForm.label} onChange={e => setNewForm({...newForm, label:e.target.value})}
                  style={{ background:T.panel, color:T.text, border:`1px solid ${T.border}`, padding:"6px 10px", borderRadius:4, fontSize:12, fontFamily:FONT_MONO, width:160 }}/>
              </div>
              <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
                <label style={{ fontSize:9, fontFamily:FONT_MONO, letterSpacing:"0.12em", textTransform:"uppercase", color:T.textMute }}>Color</label>
                <input type="color" value={newForm.color} onChange={e => setNewForm({...newForm, color:e.target.value})}
                  style={{ width:40, height:34, borderRadius:4, border:`1px solid ${T.border}`, background:T.panel, cursor:"pointer", padding:2 }}/>
              </div>
            </div>
            <div>
              <div style={{ fontSize:9, fontFamily:FONT_MONO, letterSpacing:"0.12em", textTransform:"uppercase", color:T.textMute, marginBottom:6 }}>Pages</div>
              <div style={{ display:"flex", flexWrap:"wrap", gap:5 }}>
                {ALL_PAGES.map(p => (
                  <PageToggle key={p} page={p} active={newForm.pages.includes(p)}
                    onChange={() => setNewForm(f => ({...f, pages: f.pages.includes(p) ? f.pages.filter(x=>x!==p) : [...f.pages, p]}))}/>
                ))}
              </div>
            </div>
            <div style={{ display:"flex", gap:8 }}>
              <button onClick={handleCreate} disabled={saving}
                style={{ background:T.accent, color:T.bg, border:"none", borderRadius:4, padding:"7px 18px", fontSize:11, fontFamily:FONT_MONO, fontWeight:600, cursor:"pointer", opacity:saving?0.6:1 }}>
                {saving ? "Creating…" : "Create Role"}
              </button>
              <button onClick={() => { setAdding(false); setErr(null); }}
                style={{ background:"transparent", border:`1px solid ${T.border}`, color:T.textDim, borderRadius:4, padding:"7px 12px", fontSize:11, fontFamily:FONT_MONO, cursor:"pointer" }}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

// ── Settings Page ─────────────────────────────────────────────────────────────
export default function SettingsPage() {
  const [keys,      setKeys]      = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [editing,   setEditing]   = useState(null);
  const [editVal,   setEditVal]   = useState("");
  const [saving,    setSaving]    = useState(false);
  const [saved,     setSaved]     = useState(null);
  const [err,       setErr]       = useState(null);
  const [gwTesting, setGwTesting] = useState(false);
  const [gwResult,  setGwResult]  = useState(null);
  const [environments, setEnvironments] = useState(["production", "staging", "development"]);
  const [envInput,     setEnvInput]     = useState("");
  const [envSaving,    setEnvSaving]    = useState(false);
  const [envSaved,     setEnvSaved]     = useState(false);

  const load = useCallback(async () => {
    try {
      const [data, cfg] = await Promise.all([fetchKeyStatuses(), fetchOrgConfig().catch(() => null)]);
      setKeys(data);
      if (cfg?.environments?.length) setEnvironments(cfg.environments);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const startEdit = (k) => { setEditing(k.key); setEditVal(""); setSaved(null); setErr(null); };
  const cancelEdit = () => { setEditing(null); setEditVal(""); };

  const addEnv = () => {
    const val = envInput.trim().toLowerCase().replace(/\s+/g, "-");
    if (!val || environments.includes(val)) return;
    setEnvironments(prev => [...prev, val]);
    setEnvInput("");
  };
  const removeEnv = (v) => setEnvironments(prev => prev.filter(e => e !== v));
  const saveEnvs = async () => {
    setEnvSaving(true);
    try { await updateOrgConfig("environments", environments); setEnvSaved(true); setTimeout(() => setEnvSaved(false), 2500); }
    catch (e) { setErr(e.message); }
    finally { setEnvSaving(false); }
  };

  const handleSave = async (keyName) => {
    if (!editVal.trim()) return;
    setSaving(true); setErr(null);
    try {
      await updateKey(keyName, editVal.trim());
      setSaved(keyName); setEditing(null); setEditVal("");
      await load();
    } catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  };

  const testGateway = async () => {
    setGwTesting(true); setGwResult(null);
    const t0 = performance.now();
    try {
      const resp = await authFetch(`${BASE}/v1/chat/completions`, {
        method: "POST",
        body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "user", content: "ping" }] }),
      });
      const ms = Math.round(performance.now() - t0);
      if (!resp) {
        setGwResult({ ok: false, msg: "Not authenticated or network error", status: null });
      } else if (resp.ok || resp.status === 200) {
        setGwResult({ ok: true, msg: `Gateway reachable — responded in ${ms}ms`, status: resp.status });
      } else if (resp.status === 429) {
        setGwResult({ ok: null, msg: `Rate limited (429) — gateway is reachable`, status: 429 });
      } else {
        const body = await resp.json().catch(() => null);
        const e = body?.detail?.error || body?.error;
        if (e?.type === "provider_not_configured") {
          setGwResult({ ok: false, msg: `No ${e.provider || "AI"} provider credential configured. Add it under Settings → Organization AI Providers.`, status: resp.status });
        } else if (e?.type === "provider_auth_failed") {
          setGwResult({ ok: false, msg: e.message || "Provider authentication failed.", status: resp.status });
        } else {
          const msg = (body && typeof body.detail === "string" ? body.detail : null) || e?.message || body?.message || `HTTP ${resp.status}`;
          setGwResult({ ok: false, msg: `Gateway error: ${msg}`, status: resp.status });
        }
      }
    } catch (e) {
      setGwResult({ ok: false, msg: `Gateway error: ${e.message}`, status: null });
    } finally {
      setGwTesting(false);
    }
  };

  const statusColor = (k) => { if (!k.configured) return T.textMute; if (k.placeholder) return T.warn; return T.accent; };
  const statusLabel = (k) => { if (!k.configured) return "not set"; if (k.placeholder) return "placeholder"; return "configured"; };

  const PROVIDER_MODELS = {
    OpenAI:    ["gpt-4.1","gpt-4.1-mini","gpt-4o","gpt-4o-mini","o3","o4-mini"],
    Anthropic: ["claude-opus-4-5","claude-sonnet-4-5","claude-haiku-4-5"],
    Google:    ["gemini-2.5-pro","gemini-2.0-flash","gemini-1.5-pro"],
    "Local LLM": ["llama-3.1-70b-local","llama-3.1-8b-local"],
    Auth:      [],
  };

  if (loading) return <div style={{ color:T.textDim, fontFamily:FONT_MONO, padding:24 }}>Loading settings…</div>;

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:14, maxWidth:860 }}>

      <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:16 }}>
        <div>
          <div style={{ fontSize:20, fontWeight:500, color:T.text, letterSpacing:"-0.01em" }}>Settings</div>
          <div style={{ fontSize:12, color:T.textDim, marginTop:4 }}>Configure your organization's AI providers, guard modes, and platform settings.</div>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:10, flexShrink:0 }}>
          {gwResult && (
            <span style={{
              fontFamily: FONT_MONO, fontSize: 11,
              color: gwResult.ok === true ? T.accent : gwResult.ok === null ? T.warn : T.crit,
              background: gwResult.ok === true ? `${T.accent}15` : gwResult.ok === null ? `${T.warn}15` : `${T.crit}15`,
              border: `1px solid ${gwResult.ok === true ? T.accent+"44" : gwResult.ok === null ? T.warn+"44" : T.crit+"44"}`,
              borderRadius: 4, padding: "5px 10px", maxWidth: 340, wordBreak: "break-word",
            }}>{gwResult.msg}</span>
          )}
          <button onClick={testGateway} disabled={gwTesting}
            style={{ background:`${T.info}15`, border:`1px solid ${T.info}44`, color:T.info,
              padding:"7px 16px", borderRadius:4, fontSize:12, fontFamily:FONT_MONO,
              cursor:gwTesting?"default":"pointer", opacity:gwTesting?0.6:1, whiteSpace:"nowrap" }}>
            {gwTesting ? "Testing…" : "Test Gateway"}
          </button>
        </div>
      </div>

      <ProviderCredentialsSection />

      <div style={{ background:T.panel, border:`1px solid ${T.border}`, borderRadius:8, padding:"16px 20px" }}>
        <div style={{ fontSize:12, fontWeight:600, color:T.text, marginBottom:8 }}>Which keys should I configure?</div>
        <div style={{ fontSize:12, color:T.textMute, lineHeight:1.7, marginBottom:10 }}>
          <strong style={{ color:T.text }}>Provider Credentials</strong> are used internally by the gateway and never appear in your code.
          <strong style={{ color:T.text }}> Gateway API Keys</strong> are what you put in your AI applications.
        </div>
        <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
          {[
            { label:"Provider Credentials",   desc:"Stored securely; used internally by the gateway to reach OpenAI, Anthropic, Gemini, Azure. Never expose in code." },
            { label:"Gateway API Keys",       desc:"Used inside your applications, agents and SDK clients to authenticate calls through the gateway." },
            { label:"Platform Configuration", desc:"Runtime environment settings used by the platform deployment itself (JWT secret, etc.)." },
          ].map(({ label, desc }) => (
            <div key={label} style={{ display:"flex", gap:8, fontSize:11, color:T.textMute, fontFamily:FONT_MONO }}>
              <span style={{ color:T.accent, flexShrink:0 }}>▸</span>
              <span><strong style={{ color:T.textDim }}>{label}:</strong> {desc}</span>
            </div>
          ))}
        </div>
      </div>

      <GuardModesSection />

      <Card title="Platform Configuration" subtitle="Infrastructure-level settings used by the AI Operations platform. Stored in the server environment.">
        {err && <div style={{ color:T.crit, fontFamily:FONT_MONO, fontSize:12, marginBottom:12 }}>{err}</div>}
        <table style={{ width:"100%", borderCollapse:"collapse" }}>
          <thead>
            <tr style={{ borderBottom:`1px solid ${T.border}` }}>
              {["Service","Env Variable","Purpose","Status",""].map(h => (
                <th key={h} style={{ textAlign:"left", padding:"10px 8px", fontFamily:FONT_MONO, fontSize:10, letterSpacing:"0.1em", textTransform:"uppercase", color:T.textDim, fontWeight:500 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {keys.map(k => {
              const isEdit = editing === k.key;
              const sc = statusColor(k);
              const isAuth = k.provider === "Auth";
              const models = PROVIDER_MODELS[k.provider] || [];
              const SERVICE_LABELS = { OpenAI:"OpenAI Runtime", Anthropic:"Anthropic Runtime", Google:"Google Runtime", "Local LLM":"Local LLM Runtime", Auth:"Auth Secret" };
              const serviceLabel = SERVICE_LABELS[k.provider] || k.provider;
              return (
                <React.Fragment key={k.key}>
                  <tr style={{ borderBottom: isEdit ? "none" : `1px solid ${T.border}`, opacity: isAuth ? 0.7 : 1 }}>
                    <td style={{ padding:"14px 8px", fontSize:13, color: isAuth ? T.textDim : T.text, fontWeight:500 }}>{serviceLabel}</td>
                    <td style={{ padding:"14px 8px", fontFamily:FONT_MONO, fontSize:12, color:T.textDim }}>{k.key}</td>
                    <td style={{ padding:"14px 8px", fontSize:11, color:T.textMute }}>
                      {isAuth
                        ? <span style={{ fontFamily:FONT_MONO, color:T.textMute }}>JWT signing — dashboard and API authentication</span>
                        : models.length > 0 ? <span style={{ fontFamily:FONT_MONO }}>{models.join(", ")}</span> : <span style={{ color:T.textMute }}>—</span>}
                    </td>
                    <td style={{ padding:"14px 8px" }}>
                      <Pill color={sc}>{statusLabel(k)}</Pill>
                      {saved === k.key && <span style={{ fontFamily:FONT_MONO, fontSize:10, color:T.accent, marginLeft:8 }}>✓ saved</span>}
                    </td>
                    <td style={{ padding:"14px 8px" }}>
                      {!isEdit && (
                        <button onClick={() => startEdit(k)}
                          style={{ background:`${T.info}15`, border:`1px solid ${T.info}44`, color:T.info, padding:"5px 12px", borderRadius:3, fontSize:11, fontFamily:FONT_MONO, cursor:"pointer" }}>
                          {k.configured && !k.placeholder ? "Rotate" : "Set key"}
                        </button>
                      )}
                    </td>
                  </tr>
                  {isEdit && (
                    <tr style={{ borderBottom:`1px solid ${T.border}` }}>
                      <td colSpan={5} style={{ padding:"0 8px 14px" }}>
                        <div style={{ display:"flex", gap:10, alignItems:"center", background:`${T.info}08`, border:`1px solid ${T.info}22`, borderRadius:6, padding:"12px 14px" }}>
                          <input autoFocus type="password"
                            placeholder={`Paste new value for ${k.key} (${serviceLabel})…`}
                            value={editVal} onChange={e => setEditVal(e.target.value)}
                            onKeyDown={e => { if (e.key==="Enter") handleSave(k.key); if (e.key==="Escape") cancelEdit(); }}
                            style={{ flex:1, background:T.bg, color:T.text, border:`1px solid ${T.border}`, padding:"8px 12px", borderRadius:4, fontSize:13, fontFamily:FONT_MONO }}
                          />
                          <button onClick={() => handleSave(k.key)} disabled={saving || !editVal.trim()}
                            style={{ background:T.accent, color:T.bg, border:"none", padding:"8px 18px", borderRadius:4, fontSize:12, fontFamily:FONT_MONO, fontWeight:600, cursor:"pointer", opacity:(saving||!editVal.trim())?0.5:1 }}>
                            {saving ? "Saving…" : "Save"}
                          </button>
                          <button onClick={cancelEdit}
                            style={{ background:"transparent", border:`1px solid ${T.border}`, color:T.textDim, padding:"8px 12px", borderRadius:4, fontSize:12, fontFamily:FONT_MONO, cursor:"pointer" }}>
                            Cancel
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </Card>

      <Card title="Environments" subtitle="Shown in the Environment dropdown when claiming or validating agents">
        <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginBottom:14 }}>
          {environments.map(env => (
            <div key={env} style={{ display:"flex", alignItems:"center", gap:6, background:T.panelHi, border:`1px solid ${T.border}`, borderRadius:4, padding:"5px 10px" }}>
              <span style={{ fontFamily:FONT_MONO, fontSize:12, color:T.text }}>{env}</span>
              <button onClick={() => removeEnv(env)}
                style={{ background:"transparent", border:"none", color:T.crit, cursor:"pointer", fontSize:14, lineHeight:1, padding:0 }}>×</button>
            </div>
          ))}
        </div>
        <div style={{ display:"flex", gap:8, alignItems:"center" }}>
          <input value={envInput} onChange={e => setEnvInput(e.target.value)} onKeyDown={e => e.key === "Enter" && addEnv()}
            placeholder="New environment name…"
            style={{ background:T.panelHi, border:`1px solid ${T.border}`, color:T.text, padding:"7px 10px", borderRadius:4, fontSize:12, fontFamily:FONT_MONO, width:200 }}
          />
          <button onClick={addEnv}
            style={{ background:`${T.info}15`, border:`1px solid ${T.info}44`, color:T.info, padding:"7px 14px", borderRadius:4, fontSize:12, fontFamily:FONT_MONO, cursor:"pointer" }}>
            + Add
          </button>
          <button onClick={saveEnvs} disabled={envSaving}
            style={{ background:T.accent, color:T.bg, border:"none", padding:"7px 16px", borderRadius:4, fontSize:12, fontFamily:FONT_MONO, fontWeight:600, cursor:"pointer", opacity:envSaving?0.6:1 }}>
            {envSaving ? "Saving…" : "Save"}
          </button>
          {envSaved && <span style={{ fontFamily:FONT_MONO, fontSize:11, color:T.accent }}>✓ Saved</span>}
        </div>
      </Card>

    </div>
  );
}
