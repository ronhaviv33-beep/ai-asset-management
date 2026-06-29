import React, { useState, useEffect, useRef } from "react";
import { authFetch, BASE } from "../api.js";
import { T, FONT_MONO, FONT_UI } from "../theme.js";
import { useUser, useRoles, userCan } from "../auth.jsx";

const CHAT_MODELS = [
  "gpt-4o-mini","gpt-4o","gpt-4.1","gpt-4.1-mini","o4-mini","o3",
  "claude-sonnet-4-5","claude-opus-4-5","claude-haiku-4-5",
  "gemini-2.0-flash","gemini-2.5-pro","gemini-1.5-pro",
];

const SESSION_TIMEOUT_MS  = 30 * 60 * 1000;   // 30 minutes
const SESSION_WARN_MS     = 5  * 60 * 1000;   // warn 5 min before

const CHAT_SESSION_KEY = "guardChatSessionUuid";

export default function ChatPage() {
  const user = useUser();
  const roles = useRoles();
  const isAdmin = userCan(user, "view_all_sessions", roles);

  const [messages,      setMessages]      = useState([]);
  const [input,         setInput]         = useState("");
  const [sending,       setSending]       = useState(false);
  // Non-admin: team is locked to their own team. Admin: editable.
  const [team,          setTeam]          = useState(user?.team || "SOC");
  const [agent,         setAgent]         = useState("IR-Agent");
  const [model,         setModel]         = useState("gpt-4o-mini");
  const [systemPrompt,  setSystemPrompt]  = useState("");
  const [showSystem,    setShowSystem]    = useState(false);
  const [error,         setError]         = useState(null);
  const [totalCost,     setTotalCost]     = useState(0);
  const [totalTokens,   setTotalTokens]   = useState(0);
  const [restoring,     setRestoring]     = useState(true); // true until mount restore attempt done

  // Session state
  const [sessionUuid,   setSessionUuid]   = useState(null);
  const [sessionClosed, setSessionClosed] = useState(false);
  const [timeoutSecsLeft, setTimeoutSecsLeft] = useState(null);
  const lastActivityRef  = useRef(Date.now());
  const timerRef         = useRef(null);

  // Mode: "chat" = multi-turn /sessions/{uuid}/chat | "ask" = single-shot /ask
  const [mode, setMode] = useState("chat");

  // Active sessions panel
  const [activeSessions, setActiveSessions] = useState([]);
  const [showSessions,   setShowSessions]   = useState(false);

  const bottomRef = useRef(null);
  const knownMsgCountRef = useRef(0);

  // ── Restore session from localStorage on mount ──
  useEffect(() => {
    const restore = async () => {
      const saved = localStorage.getItem(CHAT_SESSION_KEY);
      if (saved) {
        try {
          const sr = await authFetch(`${BASE}/sessions/${saved}`);
          if (sr?.ok) {
            const session = await sr.json();
            if (session.is_active) {
              const mr = await authFetch(`${BASE}/sessions/${saved}/messages`);
              if (mr?.ok) {
                const msgs = await mr.json();
                if (msgs.length > 0) {
                  const rebuilt = msgs.map(m => ({
                    role: m.role, content: m.content,
                    ...(m.role === "assistant" ? { meta: {
                      model: session.model,
                      tokens: m.prompt_tokens + m.completion_tokens,
                      cost: m.cost_usd, latency: m.latency_ms,
                      findings: JSON.parse(m.security_findings || "[]"),
                      warnings: JSON.parse(m.budget_warnings   || "[]"),
                    }} : {}),
                  }));
                  setMessages(rebuilt);
                  setTotalCost(msgs.filter(m=>m.role==="assistant").reduce((a,m)=>a+m.cost_usd,0));
                  setTotalTokens(msgs.reduce((a,m)=>a+m.prompt_tokens+m.completion_tokens,0));
                  knownMsgCountRef.current = msgs.length;
                  setTeam(session.team);
                  setAgent(session.agent);
                  setModel(session.model);
                  setSessionUuid(saved);
                }
              }
            } else {
              localStorage.removeItem(CHAT_SESSION_KEY);
            }
          } else {
            localStorage.removeItem(CHAT_SESSION_KEY);
          }
        } catch { localStorage.removeItem(CHAT_SESSION_KEY); }
      }
      setRestoring(false);
    };
    restore();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Persist session UUID to localStorage ──
  useEffect(() => {
    if (sessionUuid) localStorage.setItem(CHAT_SESSION_KEY, sessionUuid);
  }, [sessionUuid]);

  // ── Scroll to bottom on new messages ──
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const [sessionTab, setSessionTab] = useState("active"); // "active" | "recent"
  const [allSessions, setAllSessions] = useState([]);

  // ── Poll sessions every 10s ──
  useEffect(() => {
    const fetchSessions = async () => {
      try {
        const [activeR, allR] = await Promise.all([
          authFetch(`${BASE}/sessions?active_only=true`),
          authFetch(`${BASE}/sessions?active_only=false`),
        ]);
        if (activeR?.ok) setActiveSessions(await activeR.json());
        if (allR?.ok)    setAllSessions(await allR.json());
      } catch { /* ignore */ }
    };
    fetchSessions();
    const id = setInterval(fetchSessions, 10_000);
    return () => clearInterval(id);
  }, []);

  // ── Poll current session for external messages (e.g. from /ask) ──
  useEffect(() => {
    if (!sessionUuid || sessionClosed) return;
    const poll = async () => {
      try {
        const r = await authFetch(`${BASE}/sessions/${sessionUuid}/messages`);
        if (!r?.ok) return;
        const dbMsgs = await r.json();
        // Only act if DB has more messages than we've tracked
        if (dbMsgs.length <= knownMsgCountRef.current) return;
        knownMsgCountRef.current = dbMsgs.length;
        // Rebuild full message list from DB so external /ask calls appear
        setMessages(dbMsgs.map(m => ({
          role: m.role,
          content: m.content,
          ...(m.role === "assistant" ? {
            meta: {
              model: model,
              tokens: m.prompt_tokens + m.completion_tokens,
              cost: m.cost_usd,
              latency: m.latency_ms,
              findings: JSON.parse(m.security_findings || "[]"),
              warnings: JSON.parse(m.budget_warnings   || "[]"),
            }
          } : {}),
        })));
        const totalC = dbMsgs.filter(m => m.role==="assistant").reduce((a, m) => a + m.cost_usd, 0);
        const totalT = dbMsgs.reduce((a, m) => a + m.prompt_tokens + m.completion_tokens, 0);
        setTotalCost(totalC);
        setTotalTokens(totalT);
      } catch { /* ignore */ }
    };
    const id = setInterval(poll, 4_000);
    return () => clearInterval(id);
  }, [sessionUuid, sessionClosed]);

  // ── Inactivity timer ──
  useEffect(() => {
    if (!sessionUuid || sessionClosed) return;
    timerRef.current = setInterval(() => {
      const idle = Date.now() - lastActivityRef.current;
      const remaining = SESSION_TIMEOUT_MS - idle;
      if (remaining <= 0) {
        clearInterval(timerRef.current);
        setSessionClosed(true);
        setTimeoutSecsLeft(0);
        authFetch(`${BASE}/sessions/${sessionUuid}`, { method: "DELETE" }).catch(() => {});
      } else {
        setTimeoutSecsLeft(remaining <= SESSION_WARN_MS ? Math.ceil(remaining / 1000) : null);
      }
    }, 5000);
    return () => clearInterval(timerRef.current);
  }, [sessionUuid, sessionClosed]);

  const resetTimer = () => { lastActivityRef.current = Date.now(); setTimeoutSecsLeft(null); };

  // ── Create or reuse session ──
  const ensureSession = async () => {
    if (sessionUuid) return sessionUuid;
    const r = await authFetch(`${BASE}/sessions`, {
      method: "POST",
      body: JSON.stringify({ team, agent, model }),
    });
    if (!r?.ok) throw new Error("Failed to create session");
    const data = await r.json();
    knownMsgCountRef.current = 0;
    setSessionUuid(data.session_uuid);
    return data.session_uuid;
  };

  const send = async () => {
    const text = input.trim();
    if (!text || sending || sessionClosed) return;
    setInput("");
    setError(null);
    resetTimer();

    const userMsg = { role: "user", content: text };
    setMessages(prev => [...prev, userMsg]);
    setSending(true);

    try {
      if (mode === "chat") {
        // ── Multi-turn: pass full history, session-tracked ──
        const newHistory = [...messages.filter(m => m.role !== "typing"), userMsg];
        const uuid = await ensureSession();
        const r = await authFetch(`${BASE}/sessions/${uuid}/chat`, {
          method: "POST",
          body: JSON.stringify({
            session_uuid: uuid,
            team, agent, model,
            system_prompt: systemPrompt || null,
            messages: newHistory.map(m => ({ role: m.role, content: m.content })),
          }),
        });
        if (!r.ok) { const e = await r.json(); throw new Error(e.detail || `HTTP ${r.status}`); }
        const data = await r.json();
        setMessages(prev => [...prev, {
          role: "assistant", content: data.reply,
          meta: { model: data.model, tokens: data.total_tokens, cost: data.cost_usd,
                  latency: data.latency_ms, findings: data.security_findings, warnings: data.budget_warnings },
        }]);
        setTotalCost(c  => c + data.cost_usd);
        setTotalTokens(t => t + data.total_tokens);
      } else {
        // ── Single-shot: independent /ask, no history, auto-creates session ──
        const r = await authFetch(`${BASE}/ask`, {
          method: "POST",
          body: JSON.stringify({
            team, agent, model,
            prompt: text,
            system_prompt: systemPrompt || null,
          }),
        });
        if (!r.ok) { const e = await r.json(); throw new Error(e.detail || `HTTP ${r.status}`); }
        const data = await r.json();
        setMessages(prev => [...prev, {
          role: "assistant", content: data.response,
          meta: { model: data.model, tokens: data.total_tokens, cost: data.cost_usd,
                  latency: data.latency_ms, findings: data.security_findings, warnings: data.budget_warnings },
          askSession: data.session_uuid,  // badge to show which auto-session was created
        }]);
        setTotalCost(c  => c + data.cost_usd);
        setTotalTokens(t => t + data.total_tokens);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setSending(false);
    }
  };

  const handleKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  };

  const clearChat = async () => {
    if (sessionUuid) {
      await authFetch(`${BASE}/sessions/${sessionUuid}`, { method: "DELETE" }).catch(() => {});
    }
    localStorage.removeItem(CHAT_SESSION_KEY);
    setMessages([]); setTotalCost(0); setTotalTokens(0); setError(null);
    setSessionUuid(null); setSessionClosed(false); setTimeoutSecsLeft(null);
    resetTimer();
  };

  const resumeSession = async (s) => {
    // Load history from old session, create a fresh active session, restore messages
    try {
      const r = await authFetch(`${BASE}/sessions/${s.session_uuid}/messages`);
      if (!r?.ok) throw new Error("Could not load messages");
      const msgs = await r.json();

      // Close current session if one is open
      if (sessionUuid) {
        await fetch(`${BASE}/sessions/${sessionUuid}`, { method: "DELETE" }).catch(() => {});
      }
      // Always close the source session — we continue it in a new one
      if (s.session_uuid !== sessionUuid) {
        await fetch(`${BASE}/sessions/${s.session_uuid}`, { method: "DELETE" }).catch(() => {});
      }

      // Create a new session inheriting the old config
      const nr = await authFetch(`${BASE}/sessions`, {
        method: "POST",
        body: JSON.stringify({
          team: s.team, agent: s.agent, model: s.model,
        }),
      });
      if (!nr?.ok) throw new Error("Could not create session");
      const newSession = await nr.json();

      // Rebuild message display from stored history
      const rebuilt = msgs.map(m => ({
        role: m.role,
        content: m.content,
        ...(m.role === "assistant" ? {
          meta: {
            model: s.model,
            tokens: m.prompt_tokens + m.completion_tokens,
            cost: m.cost_usd,
            latency: m.latency_ms,
            findings: JSON.parse(m.security_findings || "[]"),
            warnings: JSON.parse(m.budget_warnings   || "[]"),
          }
        } : {}),
      }));

      const totalC = msgs.filter(m => m.role==="assistant").reduce((a, m) => a + m.cost_usd, 0);
      const totalT = msgs.reduce((a, m) => a + m.prompt_tokens + m.completion_tokens, 0);

      setTeam(s.team); setAgent(s.agent); setModel(s.model);
      setMessages(rebuilt);
      setTotalCost(totalC);
      setTotalTokens(totalT);
      knownMsgCountRef.current = msgs.length;
      setSessionUuid(newSession.session_uuid);
      setSessionClosed(false);
      setError(null);
      resetTimer();
      setSessionTab("active");
    } catch (e) {
      setError(`Resume failed: ${e.message}`);
    }
  };

  const LabelSelect = ({ label, value, onChange, options, disabled }) => (
    <div style={{ display:"flex", flexDirection:"column", gap:3 }}>
      <label style={{ fontSize:9, fontFamily:FONT_MONO, letterSpacing:"0.12em", textTransform:"uppercase", color:T.textMute }}>{label}</label>
      <select value={value} onChange={e => onChange(e.target.value)} disabled={disabled}
        style={{ background:T.panelHi, color:disabled?T.textMute:T.text, border:`1px solid ${T.border}`, padding:"5px 8px", borderRadius:4, fontSize:11, fontFamily:FONT_MONO, minWidth:120, opacity:disabled?0.5:1 }}>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );

  const fmtSecs = (s) => s >= 60 ? `${Math.floor(s/60)}m ${s%60}s` : `${s}s`;
  const roleColor = roles[user?.role]?.color ?? T.textDim;

  if (restoring) return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:300, color:T.textDim, fontFamily:FONT_MONO, fontSize:13, gap:8 }}>
      <span style={{ color:T.accent }}>↻</span> Restoring session…
    </div>
  );

  return (
    <div style={{ display:"flex", gap:16, height:"calc(100vh - 120px)" }}>

      {/* ── Sessions Panel ── */}
      {showSessions && (
        <div style={{ width:270, background:T.panel, border:`1px solid ${T.border}`, borderRadius:8, display:"flex", flexDirection:"column", flexShrink:0, overflow:"hidden" }}>
          {/* Tab bar */}
          <div style={{ display:"flex", borderBottom:`1px solid ${T.border}` }}>
            {[["active","Active"], ["recent","Recent"]].map(([tab, label]) => (
              <button key={tab} onClick={() => setSessionTab(tab)}
                style={{ flex:1, padding:"10px 0", background: sessionTab===tab ? T.panelHi : "transparent",
                  border:"none", borderBottom: sessionTab===tab ? `2px solid ${T.accent}` : "2px solid transparent",
                  color: sessionTab===tab ? T.text : T.textDim, fontSize:11, fontFamily:FONT_MONO,
                  letterSpacing:"0.08em", textTransform:"uppercase", cursor:"pointer" }}>
                {label}
                {tab==="active" && activeSessions.length > 0 &&
                  <span style={{ marginLeft:6, background:T.accent, color:T.bg, fontSize:9, padding:"1px 5px", borderRadius:8 }}>{activeSessions.length}</span>}
              </button>
            ))}
          </div>

          <div style={{ flex:1, overflow:"auto", padding:10, display:"flex", flexDirection:"column", gap:8 }}>
            {sessionTab === "active" && (
              <>
                {(() => {
                  const visible = isAdmin
                    ? activeSessions
                    : activeSessions.filter(s => s.user_name === user?.name);
                  if (visible.length === 0) return (
                    <div style={{ color:T.textMute, fontSize:11, fontFamily:FONT_MONO, textAlign:"center", marginTop:20 }}>
                      {isAdmin ? "No active sessions" : "No active sessions for you"}
                    </div>
                  );
                  return visible.map(s => {
                  const isMe = s.session_uuid === sessionUuid;
                  const idleMins = Math.floor((Date.now() - new Date(s.last_activity_at).getTime()) / 60000);
                  const rc = roles[s.user_role]?.color ?? T.textDim;
                  return (
                    <div key={s.session_uuid}
                      style={{ background: isMe ? `${T.accent}10` : T.panelHi, border:`1px solid ${isMe ? T.accent+"44" : T.border}`, borderRadius:6, padding:"10px 12px", display:"flex", flexDirection:"column", gap:5 }}>
                      <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                        <div style={{ width:7, height:7, borderRadius:"50%", background:T.accent, flexShrink:0 }}/>
                        <span style={{ fontSize:12, fontWeight:500, flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{s.user_name}</span>
                        <span style={{ fontSize:9, fontFamily:FONT_MONO, color:rc, background:`${rc}18`, padding:"1px 5px", borderRadius:3 }}>{s.user_role}</span>
                      </div>
                      <div style={{ fontSize:10, fontFamily:FONT_MONO, color:T.textMute, display:"flex", flexDirection:"column", gap:2 }}>
                        <span>{s.team} / {s.agent}</span>
                        <span>{s.model}</span>
                        <div style={{ display:"flex", gap:8, marginTop:2 }}>
                          <span style={{ color:T.accent }}>${s.total_cost_usd.toFixed(5)}</span>
                          <span>{s.message_count} msg{s.message_count!==1?"s":""}</span>
                          <span style={{ color: idleMins > 20 ? T.warn : T.textMute }}>idle {idleMins}m</span>
                        </div>
                      </div>
                      {isMe
                        ? (
                          <div style={{ display:"flex", gap:6, marginTop:2 }}>
                            <div style={{ fontSize:9, fontFamily:FONT_MONO, color:T.accent, flex:1, alignSelf:"center" }}>← your session</div>
                            <button onClick={clearChat}
                              style={{ background:`${T.crit}15`, border:`1px solid ${T.crit}44`, color:T.crit, borderRadius:4, padding:"4px 10px", fontSize:10, fontFamily:FONT_MONO, cursor:"pointer" }}>
                              End
                            </button>
                          </div>
                        )
                        : (
                          <div style={{ display:"flex", gap:6, marginTop:2 }}>
                            <button onClick={() => resumeSession(s)}
                              style={{ flex:1, background:`${T.info}18`, border:`1px solid ${T.info}44`, color:T.info, borderRadius:4, padding:"4px 0", fontSize:10, fontFamily:FONT_MONO, cursor:"pointer" }}>
                              ↩ Resume
                            </button>
                            {(isAdmin || s.user_name === user?.name) && (
                              <button onClick={async () => {
                                await authFetch(`${BASE}/sessions/${s.session_uuid}`, { method:"DELETE" }).catch(()=>{});
                                setActiveSessions(prev => prev.filter(x => x.session_uuid !== s.session_uuid));
                              }}
                                style={{ background:`${T.crit}15`, border:`1px solid ${T.crit}44`, color:T.crit, borderRadius:4, padding:"4px 10px", fontSize:10, fontFamily:FONT_MONO, cursor:"pointer" }}>
                                End
                              </button>
                            )}
                          </div>
                        )
                      }
                    </div>
                  );
                  })
                })()}
              </>
            )}

            {sessionTab === "recent" && (
              <>
                {(() => {
                  const visible = isAdmin
                    ? allSessions
                    : allSessions.filter(s => s.user_name === user?.name);
                  if (visible.length === 0) return (
                    <div style={{ color:T.textMute, fontSize:11, fontFamily:FONT_MONO, textAlign:"center", marginTop:20 }}>No sessions yet</div>
                  );
                  return visible.map(s => {
                  const isActive = s.is_active;
                  const isMe = s.session_uuid === sessionUuid;
                  const rc = roles[s.user_role]?.color ?? T.textDim;
                  const when = new Date(s.last_activity_at);
                  const timeAgo = (() => {
                    const diff = (Date.now() - when.getTime()) / 1000;
                    if (diff < 60)   return `${Math.floor(diff)}s ago`;
                    if (diff < 3600) return `${Math.floor(diff/60)}m ago`;
                    if (diff < 86400) return `${Math.floor(diff/3600)}h ago`;
                    return when.toLocaleDateString();
                  })();
                  return (
                    <div key={s.session_uuid}
                      style={{ background: isMe ? `${T.accent}10` : T.panelHi, border:`1px solid ${isMe ? T.accent+"44" : T.border}`, borderRadius:6, padding:"10px 12px", display:"flex", flexDirection:"column", gap:5, opacity: isActive ? 1 : 0.75 }}>
                      <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                        <div style={{ width:7, height:7, borderRadius:"50%", background: isActive ? T.accent : T.textMute, flexShrink:0 }}/>
                        <span style={{ fontSize:12, fontWeight:500, flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{s.user_name}</span>
                        <span style={{ fontSize:9, fontFamily:FONT_MONO, color:rc, background:`${rc}18`, padding:"1px 5px", borderRadius:3 }}>{s.user_role}</span>
                      </div>
                      <div style={{ fontSize:10, fontFamily:FONT_MONO, color:T.textMute, display:"flex", flexDirection:"column", gap:2 }}>
                        <span>{s.team} / {s.agent}</span>
                        <span>{s.model}</span>
                        <div style={{ display:"flex", gap:8, marginTop:2 }}>
                          <span style={{ color:T.accent }}>${s.total_cost_usd.toFixed(5)}</span>
                          <span>{s.message_count} msg{s.message_count!==1?"s":""}</span>
                          <span style={{ color:T.textMute }}>{timeAgo}</span>
                        </div>
                      </div>
                      {!isMe && s.message_count > 0 && (
                        <button onClick={() => resumeSession(s)}
                          style={{ marginTop:2, background:`${T.info}18`, border:`1px solid ${T.info}44`, color:T.info, borderRadius:4, padding:"4px 0", fontSize:10, fontFamily:FONT_MONO, cursor:"pointer" }}>
                          ↩ Resume
                        </button>
                      )}
                      {isMe && <div style={{ fontSize:9, fontFamily:FONT_MONO, color:T.accent }}>← current session</div>}
                    </div>
                  );
                  })
                })()}
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Main chat area ── */}
      <div style={{ flex:1, display:"flex", flexDirection:"column", gap:12, minWidth:0 }}>

        {/* Timeout warning */}
        {timeoutSecsLeft !== null && !sessionClosed && (
          <div style={{ background:`${T.warn}15`, border:`1px solid ${T.warn}44`, borderRadius:6, padding:"9px 14px", display:"flex", alignItems:"center", gap:10, fontFamily:FONT_MONO, fontSize:12 }}>
            <span style={{ color:T.warn }}>⏱</span>
            <span style={{ color:T.warn }}>Session closes due to inactivity in <strong>{fmtSecs(timeoutSecsLeft)}</strong> — send a message to keep it alive</span>
          </div>
        )}

        {/* Session closed banner */}
        {sessionClosed && (
          <div style={{ background:`${T.crit}15`, border:`1px solid ${T.crit}44`, borderRadius:6, padding:"9px 14px", display:"flex", alignItems:"center", justifyContent:"space-between", fontFamily:FONT_MONO, fontSize:12 }}>
            <span style={{ color:T.crit }}>⚠ Session closed after 30 min of inactivity</span>
            <button onClick={clearChat}
              style={{ background:T.accent, color:T.bg, border:"none", padding:"5px 14px", borderRadius:4, fontSize:11, fontFamily:FONT_MONO, fontWeight:600, cursor:"pointer" }}>
              New Session
            </button>
          </div>
        )}

        {/* Mode toggle + info panel */}
        <div style={{ background:T.panel, border:`1px solid ${T.border}`, borderRadius:8, overflow:"hidden" }}>
          {/* Toggle row */}
          <div style={{ display:"flex", borderBottom:`1px solid ${T.border}` }}>
            {[
              { id:"chat", icon:"◈", label:"Chat",        sub:"Multi-turn" },
              { id:"ask",  icon:"◇", label:"Single-shot", sub:"One-off"    },
            ].map(m => (
              <button key={m.id} onClick={() => setMode(m.id)}
                style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center", gap:8,
                  padding:"10px 16px", border:"none",
                  background: mode===m.id ? T.panelHi : "transparent",
                  borderBottom: mode===m.id ? `2px solid ${mode==="chat" ? T.accent : T.purple}` : "2px solid transparent",
                  color: mode===m.id ? T.text : T.textMute, cursor:"pointer", transition:"all 0.1s" }}>
                <span style={{ fontSize:14, color: mode===m.id ? (m.id==="chat" ? T.accent : T.purple) : T.textMute }}>{m.icon}</span>
                <span style={{ fontFamily:FONT_MONO, fontSize:12, fontWeight: mode===m.id ? 600 : 400 }}>{m.label}</span>
                <span style={{ fontSize:10, fontFamily:FONT_MONO, color:T.textMute }}>{m.sub}</span>
              </button>
            ))}
          </div>
          {/* Info strip */}
          {mode === "chat" && (
            <div style={{ padding:"10px 16px", display:"flex", alignItems:"flex-start", gap:12, background:`${T.accent}08` }}>
              <span style={{ color:T.accent, fontSize:16, flexShrink:0, marginTop:1 }}>◈</span>
              <div style={{ display:"flex", flexDirection:"column", gap:3 }}>
                <span style={{ fontSize:12, color:T.text, fontWeight:500 }}>Chat mode — Continuous conversation</span>
                <span style={{ fontSize:11, color:T.textDim, lineHeight:1.6 }}>
                  Every message you send includes the full conversation history. The model remembers context across turns.
                  Uses <code style={{ background:T.panelHi, padding:"1px 5px", borderRadius:3, fontSize:10 }}>/sessions/&#123;uuid&#125;/chat</code>.
                  A session is created on your first message and stays open for 30 min of inactivity.
                </span>
              </div>
            </div>
          )}
          {mode === "ask" && (
            <div style={{ padding:"10px 16px", display:"flex", alignItems:"flex-start", gap:12, background:`${T.purple}08` }}>
              <span style={{ color:T.purple, fontSize:16, flexShrink:0, marginTop:1 }}>◇</span>
              <div style={{ display:"flex", flexDirection:"column", gap:3 }}>
                <span style={{ fontSize:12, color:T.text, fontWeight:500 }}>Single-shot mode — Independent requests</span>
                <span style={{ fontSize:11, color:T.textDim, lineHeight:1.6 }}>
                  Each message is a standalone API call with no history. The model has no memory of previous messages.
                  Uses <code style={{ background:T.panelHi, padding:"1px 5px", borderRadius:3, fontSize:10 }}>/ask</code>.
                  Every send auto-creates its own session — check the Recent tab to see them.
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Config bar */}
        <div style={{ background:T.panel, border:`1px solid ${T.border}`, borderRadius:8, padding:"12px 16px", display:"flex", gap:16, alignItems:"flex-end", flexWrap:"wrap" }}>
          {/* Current user badge */}
          <div style={{ display:"flex", flexDirection:"column", gap:3 }}>
            <label style={{ fontSize:9, fontFamily:FONT_MONO, letterSpacing:"0.12em", textTransform:"uppercase", color:T.textMute }}>You</label>
            <div style={{ display:"flex", alignItems:"center", gap:6, background:T.panelHi, border:`1px solid ${T.border}`, borderRadius:4, padding:"5px 10px", height:29 }}>
              <div style={{ width:7, height:7, borderRadius:"50%", background:roleColor }}/>
              <span style={{ fontSize:11, fontFamily:FONT_MONO, color:T.text }}>{user?.name}</span>
              <span style={{ fontSize:9, fontFamily:FONT_MONO, color:roleColor, marginLeft:2 }}>{user?.role}</span>
            </div>
          </div>

          <div style={{ display:"flex", flexDirection:"column", gap:3 }}>
            <label style={{ fontSize:9, fontFamily:FONT_MONO, letterSpacing:"0.12em", textTransform:"uppercase", color:T.textMute }}>
              Team {!isAdmin && <span style={{ color:T.textMute, textTransform:"none", fontSize:9 }}>(locked)</span>}
            </label>
            {isAdmin ? (
              <input value={team} onChange={e => setTeam(e.target.value)} disabled={!!sessionUuid}
                style={{ background:T.panelHi, color:sessionUuid?T.textMute:T.text, border:`1px solid ${T.border}`, padding:"5px 8px", borderRadius:4, fontSize:11, fontFamily:FONT_MONO, width:110, opacity:sessionUuid?0.5:1 }}/>
            ) : (
              <div style={{ background:T.panelHi, border:`1px solid ${T.border}`, borderRadius:4, padding:"5px 10px", fontSize:11, fontFamily:FONT_MONO, color:T.textDim, width:110 }}>
                {user?.team || "—"}
              </div>
            )}
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:3 }}>
            <label style={{ fontSize:9, fontFamily:FONT_MONO, letterSpacing:"0.12em", textTransform:"uppercase", color:T.textMute }}>Agent</label>
            <input value={agent} onChange={e => setAgent(e.target.value)} disabled={!!sessionUuid}
              style={{ background:T.panelHi, color:sessionUuid?T.textMute:T.text, border:`1px solid ${T.border}`, padding:"5px 8px", borderRadius:4, fontSize:11, fontFamily:FONT_MONO, width:110, opacity:sessionUuid?0.5:1 }}/>
          </div>
          <LabelSelect label="Model" value={model} onChange={setModel} options={CHAT_MODELS} disabled={!!sessionUuid} />

          <button onClick={() => setShowSystem(s => !s)}
            style={{ background:"transparent", border:`1px solid ${T.border}`, color:T.textDim, padding:"6px 12px", borderRadius:4, fontSize:11, fontFamily:FONT_MONO, cursor:"pointer" }}>
            {showSystem ? "Hide system prompt" : "System prompt"}
          </button>

          <div style={{ marginLeft:"auto", display:"flex", gap:12, fontFamily:FONT_MONO, fontSize:11, color:T.textDim, alignItems:"center" }}>
            {sessionUuid && (
              <button
                title="Click to copy session_uuid — use it in /ask requests to attach them to this chat"
                onClick={() => navigator.clipboard.writeText(sessionUuid)}
                style={{ background:T.panelHi, border:`1px solid ${T.border}`, color:T.textMute, borderRadius:4, padding:"3px 8px", fontSize:10, fontFamily:FONT_MONO, cursor:"pointer", display:"flex", alignItems:"center", gap:5 }}>
                <span style={{ color:T.accentDim }}>⚡</span> ID: {sessionUuid.slice(0,8)}… <span style={{ fontSize:9, opacity:0.6 }}>copy</span>
              </button>
            )}
            <span>Tokens: <span style={{ color:T.text }}>{totalTokens.toLocaleString()}</span></span>
            <span>Cost: <span style={{ color:T.accent }}>${totalCost.toFixed(6)}</span></span>
            <button onClick={() => setShowSessions(s => !s)}
              style={{ background: showSessions ? `${T.info}18` : "transparent", border:`1px solid ${showSessions ? T.info+"44" : T.border}`, color: showSessions ? T.info : T.textDim, padding:"5px 10px", borderRadius:4, fontSize:11, fontFamily:FONT_MONO, cursor:"pointer" }}>
              Sessions {activeSessions.length > 0 && `(${activeSessions.length})`}
            </button>
            <button onClick={clearChat}
              style={{ background:"transparent", border:`1px solid ${T.border}`, color:T.crit, padding:"5px 12px", borderRadius:4, fontSize:11, fontFamily:FONT_MONO, cursor:"pointer" }}>
              End
            </button>
          </div>
        </div>

        {/* System prompt */}
        {showSystem && (
          <div style={{ background:T.panel, border:`1px solid ${T.borderHi}`, borderRadius:6, padding:12 }}>
            <textarea value={systemPrompt} onChange={e => setSystemPrompt(e.target.value)}
              placeholder="System prompt (optional) — e.g. 'You are a SOC analyst specializing in threat intelligence.'"
              rows={3}
              style={{ width:"100%", background:T.panelHi, color:T.text, border:`1px solid ${T.border}`, borderRadius:4, padding:"8px 10px", fontSize:12, fontFamily:FONT_MONO, resize:"vertical", boxSizing:"border-box" }}/>
          </div>
        )}

        {/* Message thread */}
        <div style={{ flex:1, overflow:"auto", display:"flex", flexDirection:"column", gap:12, padding:"4px 2px" }}>
          {messages.length === 0 && !sessionClosed && (
            <div style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", color:T.textMute, fontFamily:FONT_MONO, fontSize:13, gap:8, paddingTop:60 }}>
              <div style={{ fontSize:28, color: mode==="chat" ? T.accent : T.purple }}>{mode==="chat" ? "◈" : "◇"}</div>
              <div>{mode==="chat" ? "Start a conversation — history is preserved across turns" : "Send a single-shot prompt — no history, each message is independent"}</div>
              <div style={{ fontSize:11 }}>Budget check · policy enforcement · cost tracking · agent identity</div>
              {mode==="chat" && <div style={{ fontSize:10, marginTop:4 }}>Session auto-closes after 30 min of inactivity</div>}
              {mode==="ask"  && <div style={{ fontSize:10, marginTop:4 }}>Each send creates its own session — visible in Recent tab</div>}
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} style={{ display:"flex", flexDirection:"column", alignItems: msg.role==="user" ? "flex-end" : "flex-start", gap:4 }}>
              <div style={{ fontSize:10, fontFamily:FONT_MONO, letterSpacing:"0.1em", textTransform:"uppercase",
                color: msg.role==="user" ? T.info : T.accent, marginBottom:2,
                paddingLeft: msg.role==="assistant" ? 4 : 0, paddingRight: msg.role==="user" ? 4 : 0 }}>
                {msg.role === "user" ? `${user?.name || team} / ${agent}` : msg.meta?.model || "assistant"}
              </div>
              <div style={{ maxWidth:"75%", padding:"12px 16px",
                borderRadius: msg.role==="user" ? "12px 12px 2px 12px" : "12px 12px 12px 2px",
                background: msg.role==="user" ? `${T.info}18` : T.panelHi,
                border: `1px solid ${msg.role==="user" ? T.info+"33" : T.border}`,
                fontSize:13, color:T.text, lineHeight:1.6, whiteSpace:"pre-wrap", wordBreak:"break-word" }}>
                {msg.content}
              </div>
              {msg.meta && (
                <div style={{ display:"flex", gap:14, fontSize:10, fontFamily:FONT_MONO, color:T.textMute, paddingLeft:4, flexWrap:"wrap", alignItems:"center" }}>
                  <span>{msg.meta.tokens.toLocaleString()} tokens</span>
                  <span style={{ color:T.accent }}>${msg.meta.cost.toFixed(6)}</span>
                  <span>{msg.meta.latency.toFixed(0)}ms</span>
                  {msg.meta.findings?.length > 0 && <span style={{ color:T.warn }}>⚠ {msg.meta.findings.length} safety finding{msg.meta.findings.length===1?"":"s"}</span>}
                  {msg.meta.warnings?.length > 0 && <span style={{ color:T.warn }}>⚠ Budget {msg.meta.warnings[0].pct}% used</span>}
                  {msg.askSession && <span style={{ color:T.purple, background:`${T.purple}15`, border:`1px solid ${T.purple}33`, borderRadius:3, padding:"1px 6px" }}>◇ single-shot · session {msg.askSession.slice(0,8)}…</span>}
                </div>
              )}
            </div>
          ))}

          {sending && (
            <div style={{ display:"flex", alignItems:"flex-start" }}>
              <div style={{ padding:"10px 14px", background:T.panelHi, border:`1px solid ${T.border}`, borderRadius:"12px 12px 12px 2px" }}>
                <div style={{ display:"flex", gap:4 }}>
                  {[0,1,2].map(i => (
                    <div key={i} style={{ width:6, height:6, borderRadius:"50%", background:T.accent, animation:`pulse 1.2s ease-in-out ${i*0.2}s infinite`, opacity:0.6 }}/>
                  ))}
                </div>
              </div>
            </div>
          )}

          {error && (
            <div style={{ padding:"10px 14px", background:`${T.crit}10`, border:`1px solid ${T.crit}33`, borderRadius:6, fontSize:12, color:T.crit, fontFamily:FONT_MONO }}>
              ✗ {error}
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input area */}
        <div style={{ background:T.panel, border:`1px solid ${sessionClosed ? T.crit+"44" : T.border}`, borderRadius:8, padding:12, display:"flex", gap:10, alignItems:"flex-end" }}>
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder={sessionClosed ? "Session closed — click 'New Session' to start again" : "Type a message… (Enter to send, Shift+Enter for new line)"}
            rows={2}
            disabled={sending || sessionClosed}
            style={{ flex:1, background:T.panelHi, color:T.text, border:`1px solid ${T.border}`, borderRadius:6, padding:"10px 12px", fontSize:13, fontFamily:FONT_UI, resize:"none", lineHeight:1.5, opacity:(sending||sessionClosed)?0.5:1 }}
          />
          <button onClick={send} disabled={sending || !input.trim() || sessionClosed}
            style={{ background:T.accent, color:T.bg, border:"none", padding:"10px 20px", borderRadius:6, fontSize:13, fontFamily:FONT_MONO, fontWeight:600, cursor:"pointer", opacity:(sending||!input.trim()||sessionClosed)?0.4:1, flexShrink:0 }}>
            {sending ? "…" : "Send"}
          </button>
        </div>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { transform: scale(1); opacity: 0.4; }
          50%       { transform: scale(1.3); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
