import React, { useState } from "react";
import { login as apiLogin, setToken } from "../api.js";
import { T, FONT_UI, FONT_MONO } from "../theme.js";
import { BRAND } from "../config.js";

export default function LoginPage({ onLogin }) {
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [loading,  setLoading]  = useState(false);
  const [err,      setErr]      = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    setLoading(true);
    try {
      const data = await apiLogin(email, password);
      setToken(data.access_token);
      onLogin(data.user, data.access_token);
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ position:"fixed", inset:0, background:T.bg, display:"flex", alignItems:"center", justifyContent:"center", zIndex:9999 }}>
      <form onSubmit={submit} style={{ background:T.panel, border:`1px solid ${T.borderHi}`, borderRadius:12, padding:40, width:380, display:"flex", flexDirection:"column", gap:22 }}>
        <div>
          <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:8 }}>
            <div style={{ width:22, height:22, background:T.accent, borderRadius:4, display:"flex", alignItems:"center", justifyContent:"center", fontFamily:FONT_MONO, fontWeight:600, fontSize:12, color:T.bg }}>◆</div>
            <span style={{ fontSize:15, fontWeight:500, letterSpacing:"-0.01em" }}>{BRAND.name}</span>
          </div>
          <div style={{ fontSize:12, color:T.textMute, fontFamily:FONT_MONO, marginBottom:4 }}>{BRAND.subtitle}</div>
          <div style={{ fontSize:13, color:T.textDim }}>Sign in to your account</div>
        </div>
        <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
          {[
            { label:"Email", val:email, set:setEmail, type:"email",    placeholder:"you@company.com" },
            { label:"Password", val:password, set:setPassword, type:"password", placeholder:"••••••••" },
          ].map(({ label, val, set, type, placeholder }) => (
            <div key={label} style={{ display:"flex", flexDirection:"column", gap:5 }}>
              <label style={{ fontSize:9, fontFamily:FONT_MONO, letterSpacing:"0.12em", textTransform:"uppercase", color:T.textMute }}>{label}</label>
              <input type={type} value={val} onChange={e => set(e.target.value)} placeholder={placeholder} required
                style={{ background:T.panelHi, color:T.text, border:`1px solid ${T.border}`, padding:"9px 12px", borderRadius:6, fontSize:13, fontFamily:FONT_UI, outline:"none" }}/>
            </div>
          ))}
        </div>
        {err && <div style={{ fontSize:12, color:T.crit, fontFamily:FONT_MONO }}>{err}</div>}
        <button type="submit" disabled={loading}
          style={{ background:T.accent, color:T.bg, border:"none", padding:"12px 0", borderRadius:7, fontSize:13, fontFamily:FONT_MONO, fontWeight:600, cursor:"pointer", opacity:loading?0.6:1 }}>
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
