import React, { useState } from "react";
import { useUser, useRoles, canSeePage } from "../auth.jsx";
import { gatewayBaseUrl } from "../config.js";
import { T, FONT_MONO } from "../theme.js";
import { Card } from "./ui.jsx";

export default function IntegrationsPage({ onNavigate }) {
  const currentUser = useUser();
  const roles = useRoles();
  const isAdmin = canSeePage(currentUser, "apikeys", roles);
  const [copied,    setCopied]    = useState(null);
  const [apiKey,    setApiKey]    = useState("");
  const [teamName,  setTeamName]  = useState(currentUser?.team || "my-team");
  const [agentName, setAgentName] = useState("my-agent");
  const [codeTab,   setCodeTab]   = useState("python");

  const gatewayUrl = gatewayBaseUrl();
  const cred       = apiKey || "gk-...";

  const copy = (id, text) => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  const CopyBtn = ({ id, text }) => (
    <button onClick={() => copy(id, text)}
      style={{ background: copied===id ? `${T.accent}20` : "transparent",
        border:`1px solid ${copied===id ? T.accent+"55" : T.border}`,
        color: copied===id ? T.accent : T.textMute,
        padding:"3px 10px", borderRadius:3, fontSize:10, fontFamily:FONT_MONO, cursor:"pointer", flexShrink:0 }}>
      {copied===id ? "✓ copied" : "copy"}
    </button>
  );

  const CodeBlock = ({ id, code }) => (
    <div style={{ position:"relative" }}>
      <pre style={{ background:T.bg, border:`1px solid ${T.border}`, borderRadius:6,
        padding:"14px 16px 14px 16px", fontSize:12, fontFamily:FONT_MONO, color:T.text,
        lineHeight:1.7, overflow:"auto", margin:0, whiteSpace:"pre" }}>{code}</pre>
      <div style={{ position:"absolute", top:8, right:8 }}>
        <CopyBtn id={id} text={code} />
      </div>
    </div>
  );

  // ── Code snippets (trimmed — no wall-of-comments) ─────────────────────────
  const snippets = {
    python: `import openai

client = openai.OpenAI(
    base_url="${gatewayUrl}/v1",
    api_key="${cred}",
)

response = client.chat.completions.create(
    model="gpt-4o-mini",          # swap to claude-sonnet-4-5, gemini-2.0-flash, etc.
    messages=[{"role": "user", "content": "Hello"}],
    extra_headers={
        "X-Guard-Team":  "${teamName}",
        "X-Guard-Agent": "${agentName}",
    },
)
print(response.choices[0].message.content)

# Streaming
stream = client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[{"role": "user", "content": "Hello"}],
    stream=True,
    extra_headers={"X-Guard-Team": "${teamName}", "X-Guard-Agent": "${agentName}"},
)
for chunk in stream:
    print(chunk.choices[0].delta.content or "", end="", flush=True)`,

    nodejs: `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "${gatewayUrl}/v1",
  apiKey: "${cred}",
});

const response = await client.chat.completions.create({
  model: "gpt-4o-mini",         // or "claude-sonnet-4-5", "gemini-2.0-flash"
  messages: [{ role: "user", content: "Hello" }],
  headers: {
    "X-Guard-Team":  "${teamName}",
    "X-Guard-Agent": "${agentName}",
  },
});

console.log(response.choices[0].message.content);`,

    curl: `curl -X POST ${gatewayUrl}/v1/chat/completions \\
  -H "Authorization: Bearer ${cred}" \\
  -H "Content-Type: application/json" \\
  -H "X-Guard-Team: ${teamName}" \\
  -H "X-Guard-Agent: ${agentName}" \\
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"Hello"}]}'`,

    anthropic: `import anthropic

client = anthropic.Anthropic(
    base_url="${gatewayUrl}",
    api_key="${cred}",
    default_headers={
        "X-Guard-Team":  "${teamName}",
        "X-Guard-Agent": "${agentName}",
    },
)

message = client.messages.create(
    model="claude-haiku-4-5",
    max_tokens=1024,
    messages=[{"role": "user", "content": "Hello"}],
)
print(message.content[0].text)`,

    langchain: `from langchain_openai import ChatOpenAI

llm = ChatOpenAI(
    model="gpt-4o-mini",
    openai_api_base="${gatewayUrl}/v1",
    openai_api_key="${cred}",
    default_headers={
        "X-Guard-Team":  "${teamName}",
        "X-Guard-Agent": "${agentName}",
    },
)
print(llm.invoke("Hello").content)`,
  };

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:16, maxWidth:900 }}>

      {/* ── Setup steps ── */}
      <Card title="Connect your agent" subtitle="Three steps, no code changes to existing agents">
        <div style={{ display:"flex", flexDirection:"column", gap:0 }}>
          {[
            {
              n:"1", color:T.warn, done: false,
              label: "Add your provider key",
              detail: <>Go to <strong style={{ color:T.accent }}>Settings → Organization AI Providers</strong> and paste your OpenAI / Anthropic / Google key. It's encrypted at rest — only the last 4 chars are shown after saving.</>,
              action: isAdmin ? { label:"Open Settings →", href:"settings" } : null,
            },
            {
              n:"2", color:T.info, done: false,
              label: "Create an API key for your agent",
              detail: <>Go to <strong style={{ color:T.accent }}>API Keys → Generate Key</strong>. Give it a name and team. The <code style={{ color:T.accent, fontFamily:FONT_MONO, fontSize:11 }}>gk-…</code> key is shown <strong style={{ color:T.warn }}>once</strong> — copy it now.</>,
              action: isAdmin ? { label:"Open API Keys →", href:"apikeys" } : null,
            },
            {
              n:"3", color:T.accent, done: false,
              label: "Point your agent at this gateway",
              detail: <>Change <code style={{ color:T.info, fontFamily:FONT_MONO, fontSize:11 }}>base_url</code> to <code style={{ color:T.accent, fontFamily:FONT_MONO, fontSize:11 }}>{gatewayUrl}/v1</code> and use your <code style={{ color:T.accent, fontFamily:FONT_MONO, fontSize:11 }}>gk-…</code> key as <code style={{ color:T.info, fontFamily:FONT_MONO, fontSize:11 }}>api_key</code>. That's it — every model routes through here automatically.</>,
            },
          ].map((s, i, arr) => (
            <div key={s.n} style={{ display:"flex", gap:16 }}>
              <div style={{ display:"flex", flexDirection:"column", alignItems:"center", flexShrink:0 }}>
                <div style={{ width:30, height:30, borderRadius:"50%", background:`${s.color}18`,
                  border:`1px solid ${s.color}55`, display:"flex", alignItems:"center",
                  justifyContent:"center", fontFamily:FONT_MONO, fontSize:12, color:s.color, fontWeight:700 }}>
                  {s.n}
                </div>
                {i < arr.length-1 && <div style={{ width:1, flex:1, background:T.border, minHeight:24, margin:"4px 0" }}/>}
              </div>
              <div style={{ paddingBottom:20, flex:1 }}>
                <div style={{ fontSize:13, fontWeight:600, color:T.text, marginBottom:4 }}>{s.label}</div>
                <div style={{ fontSize:12, color:T.textDim, lineHeight:1.65 }}>{s.detail}</div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* ── Config builder + code tabs ── */}
      <Card title="Code snippets" subtitle="Fill in your details — snippets update live">

        {/* Inputs row */}
        <div style={{ display:"flex", gap:10, flexWrap:"wrap", alignItems:"flex-end", marginBottom:16 }}>
          {[
            { label:"Team",  val:teamName,  set:setTeamName,  w:130 },
            { label:"Agent", val:agentName, set:setAgentName, w:130 },
          ].map(f => (
            <div key={f.label} style={{ display:"flex", flexDirection:"column", gap:4 }}>
              <label style={{ fontSize:9, fontFamily:FONT_MONO, letterSpacing:"0.12em", textTransform:"uppercase", color:T.textMute }}>{f.label}</label>
              <input value={f.val} onChange={e => f.set(e.target.value)}
                style={{ background:T.panelHi, color:T.text, border:`1px solid ${T.border}`,
                  padding:"6px 10px", borderRadius:4, fontSize:12, fontFamily:FONT_MONO, width:f.w }} />
            </div>
          ))}

          <div style={{ display:"flex", flexDirection:"column", gap:4, flex:1, minWidth:220 }}>
            <div style={{ display:"flex", alignItems:"baseline", justifyContent:"space-between" }}>
              <label style={{ fontSize:9, fontFamily:FONT_MONO, letterSpacing:"0.12em", textTransform:"uppercase", color:T.textMute }}>
                Gateway key (gk-…)
              </label>
              {isAdmin && (
                <button onClick={() => onNavigate("apikeys")}
                  style={{ background:"transparent", border:"none", color:T.accent, fontSize:10,
                    fontFamily:FONT_MONO, cursor:"pointer", padding:0, textDecoration:"underline" }}>
                  Get one in 10s →
                </button>
              )}
            </div>
            <input type="password"
              placeholder="Paste your gk-… key — snippets fill in live"
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              style={{ background:T.panelHi, color:T.text, border:`1px solid ${T.border}`,
                padding:"6px 10px", borderRadius:4, fontSize:12, fontFamily:FONT_MONO }} />
          </div>
        </div>

        {/* Language tabs */}
        <div style={{ display:"flex", gap:2, marginBottom:0, borderBottom:`1px solid ${T.border}`, paddingBottom:0 }}>
          {[
            {id:"python",   label:"Python"},
            {id:"nodejs",   label:"Node.js"},
            {id:"curl",     label:"curl"},
            {id:"anthropic",label:"Anthropic SDK"},
            {id:"langchain",label:"LangChain"},
          ].map(t => (
            <button key={t.id} onClick={() => setCodeTab(t.id)}
              style={{ background:"transparent", border:"none",
                borderBottom: codeTab===t.id ? `2px solid ${T.accent}` : "2px solid transparent",
                color: codeTab===t.id ? T.accent : T.textDim,
                padding:"7px 14px", fontSize:11, fontFamily:FONT_MONO, cursor:"pointer",
                marginBottom:"-1px" }}>
              {t.label}
            </button>
          ))}
        </div>
        <div style={{ marginTop:0 }}>
          <CodeBlock id={codeTab} code={snippets[codeTab]} />
        </div>
      </Card>

      {/* ── Reference: headers + models ── */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>

        {/* Attribution headers */}
        <Card title="Attribution headers" subtitle="Add to every request">
          <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
            {[
              { h:"X-Guard-Team",  ex:teamName,  desc:"Team for budget & policy enforcement" },
              { h:"X-Guard-Agent", ex:agentName, desc:"Agent name for cost attribution" },
            ].map(r => (
              <div key={r.h} style={{ background:T.bg, border:`1px solid ${T.border}`, borderRadius:5, padding:"10px 12px" }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:4 }}>
                  <code style={{ fontFamily:FONT_MONO, fontSize:12, color:T.info }}>{r.h}</code>
                  <code style={{ fontFamily:FONT_MONO, fontSize:11, color:T.accent }}>"{r.ex}"</code>
                </div>
                <div style={{ fontSize:11, color:T.textMute }}>{r.desc}</div>
              </div>
            ))}
          </div>
        </Card>

        {/* Supported models */}
        <Card title="Supported models" subtitle="Swap the model name — routing is automatic">
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            {[
              { provider:"OpenAI",    color:T.info,   models:"gpt-4.1, gpt-4o, gpt-4o-mini, o3, o4-mini" },
              { provider:"Anthropic", color:T.warn,   models:"claude-opus-4-5, claude-sonnet-4-5, claude-haiku-4-5" },
              { provider:"Google",    color:T.accent, models:"gemini-2.5-pro, gemini-2.0-flash, gemini-1.5-pro" },
              { provider:"Local",     color:T.purple, models:"llama-3.1-70b-local, llama-3.1-8b-local" },
            ].map(g => (
              <div key={g.provider} style={{ display:"flex", gap:10, alignItems:"baseline" }}>
                <span style={{ fontFamily:FONT_MONO, fontSize:10, color:g.color, letterSpacing:"0.08em",
                  textTransform:"uppercase", width:72, flexShrink:0 }}>{g.provider}</span>
                <span style={{ fontFamily:FONT_MONO, fontSize:11, color:T.textDim }}>{g.models}</span>
              </div>
            ))}
          </div>
          <div style={{ marginTop:10, fontSize:10, color:T.textMute, fontFamily:FONT_MONO }}>
            Provider key must be configured in <strong style={{ color:T.accent }}>Settings → Organization AI Providers</strong>
          </div>
        </Card>
      </div>

      {/* ── How it works (compact) ── */}
      <Card title="What happens on every call" subtitle="The enforcement pipeline — in order">
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"4px 24px" }}>
          {[
            { n:"1", color:T.info,   label:"Auth",        desc:"JWT or API key validated; org resolved from DB" },
            { n:"2", color:T.warn,   label:"Safety check", desc:"Content safety and redaction check (if enabled)" },
            { n:"3", color:T.info,   label:"Policy",      desc:"Blocked model for this team → 403" },
            { n:"4", color:T.crit,   label:"Budget",      desc:"Over limit with action=block → 429" },
            { n:"5", color:T.accent, label:"Credential",  desc:"Your org's encrypted key decrypted; no fallback → 402 if missing" },
            { n:"6", color:T.accent, label:"LLM call",    desc:"Forwarded using your key, billed to your account" },
            { n:"7", color:T.purple, label:"Telemetry",   desc:"Cost, tokens, findings stored — org-scoped, isolated" },
          ].map(s => (
            <div key={s.n} style={{ display:"flex", gap:10, alignItems:"baseline", padding:"8px 0",
              borderBottom:`1px solid ${T.border}` }}>
              <span style={{ fontFamily:FONT_MONO, fontSize:10, color:s.color, fontWeight:700, width:14, flexShrink:0 }}>{s.n}</span>
              <span style={{ fontFamily:FONT_MONO, fontSize:11, color:s.color, width:76, flexShrink:0 }}>{s.label}</span>
              <span style={{ fontSize:12, color:T.textDim }}>{s.desc}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* ── Guard modes (compact) ── */}
      <Card title="Guard modes" subtitle="Graduate each team independently — Settings → Guard Modes">
        <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10 }}>
          {[
            { mode:"Observe",  color:T.info, desc:"Log + count shadow-blocks. Never blocks traffic. Start here." },
            { mode:"Alert",    color:T.warn, desc:"Log + fire alerts. Still never blocks." },
            { mode:"Enforce",  color:T.crit, desc:"Policy → 403, budget → 429. Graduate after reviewing shadow counts." },
          ].map(m => (
            <div key={m.mode} style={{ background:T.panelHi, border:`1px solid ${m.color}33`, borderRadius:6, padding:"12px 14px" }}>
              <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:6 }}>
                <span style={{ width:7, height:7, borderRadius:"50%", background:m.color }} />
                <span style={{ fontFamily:FONT_MONO, fontSize:12, color:m.color, fontWeight:600 }}>{m.mode}</span>
              </div>
              <div style={{ fontSize:11, color:T.textDim, lineHeight:1.55 }}>{m.desc}</div>
            </div>
          ))}
        </div>
      </Card>

    </div>
  );
}
