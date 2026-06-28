import React, { useState, useEffect } from "react";
import { T, FONT_UI, FONT_MONO } from "../theme.js";
import { fetchAgentsSummary, fetchRelationships, fetchProviderCredentials, fetchApiKeys, BASE } from "../api.js";

export default function SimpleIntegrationsPage({ onNavigate }) {
  const gatewayUrl = typeof BASE !== "undefined" && BASE.startsWith("http") ? BASE : window.location.origin;
  const [copied, setCopied]   = useState(null);
  const [open,   setOpen]     = useState({ sdk_openai: true, sdk_anthropic: false, sdk_env: false, manual_openai: false, manual_curl: false });
  const [section, setSection] = useState(null);
  const [metrics, setMetrics] = useState({ agents: null, dependencies: null, workflows: null, platforms: null });
  const [progress, setProgress] = useState({ provider: false, key: false, request: false, agent: false });

  const copy   = (id, text) => { navigator.clipboard.writeText(text).catch(() => {}); setCopied(id); setTimeout(() => setCopied(null), 2000); };
  const toggle = (k) => setOpen(o => ({ ...o, [k]: !o[k] }));

  useEffect(() => {
    Promise.allSettled([
      fetchAgentsSummary(), fetchRelationships(),
      fetchProviderCredentials().catch(() => []), fetchApiKeys().catch(() => []),
    ]).then(([agRes, relRes, credRes, keyRes]) => {
      const ag   = agRes.status  === "fulfilled" ? agRes.value  : null;
      const rels = relRes.status === "fulfilled" ? relRes.value : [];
      const creds = credRes.status === "fulfilled" && Array.isArray(credRes.value) ? credRes.value : [];
      const keys  = keyRes.status  === "fulfilled" && Array.isArray(keyRes.value)  ? keyRes.value  : [];
      const wfRels = (rels || []).filter(r => ["triggers_workflow", "uses_workflow"].includes(r.relationship_type));
      const platformCount = ag?.discovery_coverage ? Object.keys(ag.discovery_coverage).length : null;
      const agentCount = ag ? (ag.verified_agents?.total || 0) + (ag.potential_agents?.total || 0) : 0;
      setMetrics({
        agents:       ag ? agentCount : null,
        dependencies: Array.isArray(rels) ? rels.length : null,
        workflows:    new Set(wfRels.map(r => r.target_name)).size,
        platforms:    platformCount,
      });
      setProgress({
        provider: creds.length > 0,
        key:      keys.length > 0,
        request:  agentCount > 0,   // traffic produced at least one discovered agent
        agent:    agentCount > 0,
      });
    });
  }, []);

  const PROGRESS_STEPS = [
    { key: "provider", label: "Connect Provider" },
    { key: "key",      label: "Create Gateway API Key" },
    { key: "request",  label: "Send First Request" },
    { key: "agent",    label: "Discover First Agent" },
  ];

  const fmtMetric = (v) => v === null ? "—" : String(v);

  const OPTIONS = [
    {
      id: "gateway", badge: "Recommended", color: T.info,
      title: "Route AI Traffic",
      desc:  "Best for immediate visibility into active AI agents.",
      benefits: ["Discover active AI assets", "Track usage and cost", "Build the dependency map", "Apply governance controls"],
      cta: "Start Here →",
    },
    {
      id: "sdk", badge: null, color: "#34d399",
      title: "Connect AI Applications",
      desc:  "Best for applications you own and can modify.",
      benefits: ["Add rich identity metadata", "Improve team and owner attribution", "Track environment and version", "Increase discovery confidence"],
      cta: "Connect Applications →",
    },
    {
      id: "platform", badge: null, color: T.purple,
      title: "Connect AI Ecosystem",
      desc:  "Best for finding shadow AI and unmanaged automation.",
      benefits: ["Discover GitHub, Slack, Jira, ServiceNow, and MCP signals", "Find potential AI assets", "Surface unmanaged dependencies", "Send findings for validation"],
      cta: "Connect Ecosystem →",
    },
  ];

  const GW_FLOW = [
    { label:"Create Organisation API Key",           color:T.accent },
    { label:"Route Traffic Through Gateway",         color:T.warn   },
    { label:"Gateway Derives Identity",              color:T.info   },
    { label:"Verified / Unassigned Agent Created",   color:T.yellow },
    { label:"Admin Reviews Agent",                   color:T.purple },
  ];
  const SDK_FLOW = [
    { label:"Create Organisation API Key", color:T.accent },
    { label:"Install SDK",                 color:"#34d399" },
    { label:"Wrap AI Client",              color:"#34d399" },
    { label:"Route Through Gateway",       color:T.warn   },
    { label:"Verified Agent Created",      color:T.yellow },
    { label:"Admin Claims Agent",          color:T.purple },
  ];
  const PLATFORM_FLOW = [
    { label:"Connect Platform",            color:T.info   },
    { label:"Scan for AI Signals",         color:T.warn   },
    { label:"Potential Agent Created",     color:T.yellow },
    { label:"Admin Validates or Rejects",  color:T.purple },
    { label:"Managed Agent",               color:T.accent },
  ];
  const GW_SIGNALS = [
    { label:"API Key Scope",       desc:"Key named after a service — no headers needed" },
    { label:"Framework Hints",     desc:"LangChain, CrewAI, AutoGen, n8n in User-Agent" },
    { label:"Request Origin",      desc:"Meaningful hostname or service label" },
    { label:"Provider Metadata",   desc:"User-Agent and client library name" },
    { label:"Stable Fingerprint",  desc:"Hash of org + key + origin — flags for review" },
  ];
  const PLATFORMS = [
    "GitHub", "n8n", "Slack", "Jira", "ServiceNow",
    "Cloud Functions", "MCP Servers", "Azure DevOps", "Zapier",
    "Copilot Studio", "Bedrock Agents", "OpenAI Agents SDK",
  ];
  const OPT_HEADERS = [
    { name:"X-Agent-Name",        desc:"Override auto-detected agent name",    example:"soc-investigation-agent" },
    { name:"X-Agent-Team",        desc:"Team or department",                   example:"Security" },
    { name:"X-Agent-Owner",       desc:"Owner email or name",                  example:"alice@acme.com" },
    { name:"X-Agent-Environment", desc:"prod / staging / dev",                 example:"prod" },
    { name:"X-Agent-Version",     desc:"Version tag",                          example:"v1.2.0" },
    { name:"X-Agent-Source",      desc:"Set by SDK automatically (sdk-python)",example:"sdk-python" },
  ];

  const snippets = {
    sdk_openai:
`pip install ai-agent-inventory-sdk

from ai_agent_inventory import OpenAI

# Option A: explicit params
client = OpenAI(
    api_key="org_gateway_key",
    gateway_url="GATEWAY_URL/v1",
    agent_name="soc-investigation-agent",
    team="Security",
    environment="prod",
    debug=True,
)

# Option B: zero-code env-var setup
client = OpenAI(api_key="org_gateway_key", gateway_url="GATEWAY_URL/v1")

response = client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[{"role": "user", "content": "Analyze this alert"}],
)`,

    sdk_anthropic:
`pip install ai-agent-inventory-sdk anthropic

from ai_agent_inventory import Anthropic

client = Anthropic(
    api_key="org_gateway_key",
    gateway_url="GATEWAY_URL",
    agent_name="document-summariser",
    team="Legal",
    environment="prod",
)

response = client.messages.create(
    model="claude-haiku-4-5-20251001",
    max_tokens=1024,
    messages=[{"role": "user", "content": "Summarise this contract"}],
)`,

    sdk_env:
`# Zero-code setup: set these env vars before starting your service.
SERVICE_NAME=soc-investigation-agent
TEAM=Security
ENVIRONMENT=prod
APP_VERSION=1.2.0

pip install ai-agent-inventory-sdk
from ai_agent_inventory import OpenAI
client = OpenAI(api_key="org_gateway_key", gateway_url="GATEWAY_URL/v1")`,

    manual_openai:
`import openai

client = openai.OpenAI(base_url="GATEWAY_URL/v1", api_key="gk-...")

client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[{"role": "user", "content": "Hello"}],
    extra_headers={
        "X-Agent-Name":        "soc-investigation-agent",
        "X-Agent-Team":        "Security",
        "X-Agent-Environment": "prod",
    },
)`,

    manual_curl:
`curl GATEWAY_URL/v1/chat/completions \\
  -H "Authorization: Bearer gk-..." \\
  -H "X-Agent-Name: soc-investigation-agent" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"Hello"}]}'`,
  };

  const resolvedSnippets = Object.fromEntries(
    Object.entries(snippets).map(([k, v]) => [k, v.replace(/GATEWAY_URL/g, gatewayUrl)])
  );

  const FlowColumn = ({ steps }) => (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-start", gap:0 }}>
      {steps.map((s, i) => (
        <div key={i} style={{ display:"flex", flexDirection:"column", alignItems:"flex-start" }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <div style={{ width:8, height:8, borderRadius:"50%", background:s.color, flexShrink:0 }} />
            <span style={{ fontSize:12, color:T.text }}>{s.label}</span>
          </div>
          {i < steps.length - 1 && (
            <div style={{ width:1, height:16, background:T.border, marginLeft:3 }} />
          )}
        </div>
      ))}
    </div>
  );

  const CodeBlock = ({ id, label, snippet, accentColor }) => (
    <div style={{ border:`1px solid ${open[id] ? (accentColor || T.accent)+"44" : T.border}`, borderRadius:8, overflow:"hidden" }}>
      <button onClick={() => toggle(id)}
        style={{ width:"100%", background:open[id] ? T.panelHi : T.panel, border:"none",
          padding:"11px 16px", display:"flex", alignItems:"center", gap:12, cursor:"pointer", textAlign:"left" }}>
        <span style={{ width:7, height:7, borderRadius:"50%", background:accentColor || T.accent, flexShrink:0 }} />
        <span style={{ fontSize:12, fontFamily:FONT_MONO, color:open[id] ? T.text : T.textDim, flex:1 }}>{label}</span>
        <span style={{ fontSize:11, fontFamily:FONT_MONO, color:T.textMute }}>{open[id] ? "▲ close" : "▼ open"}</span>
      </button>
      {open[id] && (
        <div style={{ position:"relative", borderTop:`1px solid ${T.border}` }}>
          <pre style={{ margin:0, padding:"16px", fontSize:12, fontFamily:FONT_MONO, color:T.text, lineHeight:1.7, overflow:"auto", background:T.bg, maxHeight:380 }}>{snippet}</pre>
          <button onClick={() => copy(id, snippet)}
            style={{ position:"absolute", top:8, right:8, background:"transparent", border:`1px solid ${T.border}`,
              color:copied===id?"#34d399":T.textMute, borderRadius:4, padding:"3px 10px", fontSize:10, fontFamily:FONT_MONO, cursor:"pointer" }}>
            {copied===id?"copied":"copy"}
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div style={{ maxWidth:900, margin:"0 auto", padding:"32px 24px", fontFamily:FONT_UI }}>

      <div style={{ marginBottom:24 }}>
        <div style={{ fontSize:11, fontFamily:FONT_MONO, color:T.textMute, letterSpacing:"0.12em", textTransform:"uppercase", marginBottom:6 }}>Administration · Setup</div>
        <div style={{ fontSize:24, fontWeight:700, color:T.text, lineHeight:1.2 }}>Connect your AI traffic</div>
      </div>

      {/* Setup progress */}
      <div style={{ marginBottom:28, padding:"16px 24px", background:T.panel, border:`1px solid ${T.border}`, borderRadius:10 }}>
        <div style={{ fontSize:10, fontFamily:FONT_MONO, color:T.textMute, textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:14 }}>Setup progress</div>
        <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
          {PROGRESS_STEPS.map((s, i) => {
            const done = progress[s.key];
            return (
              <div key={s.key} style={{ display:"flex", alignItems:"center", gap:8, flex:"1 1 180px" }}>
                <span style={{ width:20, height:20, borderRadius:"50%", flexShrink:0,
                  border:`1px solid ${done ? T.accent : T.border}`, background: done ? `${T.accent}22` : "transparent",
                  color: done ? T.accent : T.textMute, display:"flex", alignItems:"center", justifyContent:"center",
                  fontSize:11, fontFamily:FONT_MONO }}>{done ? "✓" : i + 1}</span>
                <span style={{ fontSize:12, color: done ? T.text : T.textDim }}>{s.label}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ marginBottom:28, padding:"20px 24px",
        background:`${T.info}0a`, border:`1px solid ${T.info}33`, borderRadius:10,
        display:"flex", alignItems:"flex-start", gap:16 }}>
        <div style={{ width:8, height:8, borderRadius:"50%", background:T.info, flexShrink:0, marginTop:5 }} />
        <div style={{ flex:1 }}>
          <div style={{ fontSize:13, fontWeight:600, color:T.text, marginBottom:6 }}>
            Recommended path: start by routing AI traffic.
          </div>
          <div style={{ fontSize:12, color:T.textDim, lineHeight:1.7, maxWidth:620 }}>
            One configuration change gives you immediate visibility. Agents, models, costs, and dependencies
            start appearing automatically from runtime activity — no manual registration required.
          </div>
        </div>
        <button
          onClick={() => setSection(s => s === "gateway" ? null : "gateway")}
          style={{ background:T.info, color:"#fff", border:"none", borderRadius:6,
            padding:"9px 20px", fontSize:12, fontWeight:600, fontFamily:FONT_UI,
            cursor:"pointer", flexShrink:0, whiteSpace:"nowrap" }}>
          Route AI Traffic →
        </button>
      </div>

      <div style={{ background:T.panel, border:`1px solid ${T.border}`, borderRadius:10, padding:"16px 24px", marginBottom:28 }}>
        <div style={{ fontSize:10, fontFamily:FONT_MONO, color:T.textMute, textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:12 }}>Currently discovered</div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:0 }}>
          {[
            { label:"AI Assets",        value:fmtMetric(metrics.agents),       color:T.accent },
            { label:"Dependencies",      value:fmtMetric(metrics.dependencies), color:"#5BD9C5" },
            { label:"Workflows",         value:fmtMetric(metrics.workflows),    color:T.warn },
            { label:"Discovery Sources", value:fmtMetric(metrics.platforms),    color:T.info },
          ].map((m, i) => (
            <div key={m.label} style={{ padding:"0 20px 0 0", borderRight: i < 3 ? `1px solid ${T.border}` : "none", marginRight: i < 3 ? 20 : 0 }}>
              <div style={{ fontSize:26, fontWeight:700, color:m.color, fontFamily:FONT_MONO, letterSpacing:"-0.02em", lineHeight:1 }}>{m.value}</div>
              <div style={{ fontSize:11, color:T.textMute, marginTop:5 }}>{m.label}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ fontSize:10, fontFamily:FONT_MONO, color:T.textMute, letterSpacing:"0.12em", textTransform:"uppercase", marginBottom:14 }}>Setup options</div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:14, marginBottom: section ? 20 : 0 }}>
        {OPTIONS.map(opt => (
          <div key={opt.id}
            style={{ background:T.panel,
              border:`1px solid ${section === opt.id ? opt.color+"66" : T.border}`,
              borderRadius:10, padding:"22px 20px", display:"flex", flexDirection:"column", gap:14,
              transition:"border-color 0.15s" }}>
            <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:8 }}>
              <div style={{ fontSize:14, fontWeight:700, color:T.text, lineHeight:1.3 }}>{opt.title}</div>
              {opt.badge && (
                <span style={{ background:`${opt.color}18`, color:opt.color, border:`1px solid ${opt.color}44`,
                  fontSize:9, fontFamily:FONT_MONO, padding:"2px 8px", borderRadius:3,
                  textTransform:"uppercase", letterSpacing:"0.1em", flexShrink:0 }}>{opt.badge}</span>
              )}
            </div>
            <div style={{ fontSize:12, color:T.textDim, lineHeight:1.65 }}>{opt.desc}</div>
            <ul style={{ margin:0, padding:"0 0 0 14px", display:"flex", flexDirection:"column", gap:5 }}>
              {opt.benefits.map(b => (
                <li key={b} style={{ fontSize:11, color:T.textDim, lineHeight:1.5 }}>{b}</li>
              ))}
            </ul>
            <button
              onClick={() => setSection(s => s === opt.id ? null : opt.id)}
              style={{ marginTop:"auto", background:`${opt.color}14`, border:`1px solid ${opt.color}44`,
                color:opt.color, borderRadius:6, padding:"9px 14px", fontSize:12,
                fontFamily:FONT_MONO, cursor:"pointer", fontWeight:600, textAlign:"center" }}>
              {section === opt.id ? "▲ Collapse" : opt.cta}
            </button>
          </div>
        ))}
      </div>

      {section === "gateway" && (
        <div style={{ border:`1px solid ${T.info}44`, borderRadius:10, padding:"24px 28px", marginBottom:16 }}>
          <div style={{ fontSize:13, fontWeight:600, color:T.text, marginBottom:16 }}>Route AI Traffic — Integration Guide</div>
          <div style={{ fontSize:12, color:T.textDim, lineHeight:1.7, marginBottom:14 }}>
            <strong style={{ color:T.text }}>No proprietary SDK required — use your existing AI stack.</strong> Change your AI client's{" "}
            <code style={{ fontFamily:FONT_MONO, color:T.info, fontSize:11 }}>base_url</code> to{" "}
            <code style={{ fontFamily:FONT_MONO, color:T.accent, fontSize:11 }}>{gatewayUrl}/v1</code>, replace your{" "}
            <code style={{ fontFamily:FONT_MONO, color:T.info, fontSize:11 }}>api_key</code> with a Gateway API Key, and send traffic. No instrumentation, no code rewrite.
          </div>
          <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginBottom:20 }}>
            <span style={{ fontSize:10, fontFamily:FONT_MONO, color:T.textMute, alignSelf:"center", marginRight:4 }}>WORKS WITH</span>
            {["OpenAI SDK","LangChain","CrewAI","LiteLLM","OpenAI Agents SDK","MCP Clients","Vercel AI SDK","Agno","PydanticAI"].map(s => (
              <span key={s} style={{ fontSize:11, fontFamily:FONT_MONO, color:T.accent, background:`${T.accent}12`, border:`1px solid ${T.accent}33`, borderRadius:4, padding:"2px 8px" }}>✓ {s}</span>
            ))}
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:24, marginBottom:20 }}>
            <div>
              <div style={{ fontSize:10, fontFamily:FONT_MONO, color:T.textMute, textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:10 }}>Setup flow</div>
              <FlowColumn steps={GW_FLOW} />
            </div>
            <div>
              <div style={{ fontSize:10, fontFamily:FONT_MONO, color:T.textMute, textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:10 }}>Identity signals (priority order)</div>
              {GW_SIGNALS.map((s, i) => (
                <div key={i} style={{ display:"flex", gap:8, padding:"6px 0", borderBottom:`1px solid ${T.border}`, fontSize:12 }}>
                  <span style={{ color:T.textMute, fontFamily:FONT_MONO, fontSize:11, minWidth:16, flexShrink:0 }}>{i+1}.</span>
                  <div>
                    <span style={{ color:T.text, fontWeight:600 }}>{s.label}</span>
                    <span style={{ color:T.textDim, marginLeft:8 }}>{s.desc}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div style={{ background:`${T.info}0d`, border:`1px solid ${T.info}33`, borderRadius:8, padding:"12px 16px" }}>
            <div style={{ fontSize:12, color:T.textDim, lineHeight:1.65 }}>
              <strong style={{ color:T.text }}>Minimum setup:</strong> change <code style={{ fontFamily:FONT_MONO, color:T.info, fontSize:11 }}>base_url</code> to{" "}
              <code style={{ fontFamily:FONT_MONO, color:T.accent, fontSize:11 }}>{gatewayUrl}/v1</code> and use your org API key.
            </div>
          </div>
        </div>
      )}

      {section === "sdk" && (
        <div style={{ border:`1px solid ${"#34d399"}44`, borderRadius:10, padding:"24px 28px", marginBottom:16 }}>
          <div style={{ fontSize:13, fontWeight:600, color:T.text, marginBottom:16 }}>Connect AI Applications — Integration Guide</div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:24, marginBottom:20 }}>
            <div>
              <div style={{ fontSize:12, color:T.textDim, lineHeight:1.7, marginBottom:16 }}>
                The SDK automatically collects runtime context and attaches it to every request.
              </div>
              <FlowColumn steps={SDK_FLOW} />
            </div>
            <div>
              <div style={{ fontSize:10, fontFamily:FONT_MONO, color:T.textMute, textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:10 }}>What the SDK collects</div>
              {[
                ["SERVICE_NAME / APP_NAME", "Agent identity"],
                ["ENVIRONMENT / ENV",        "prod / staging / dev"],
                ["TEAM",                     "Owning team"],
                ["APP_VERSION",              "Version tag"],
              ].map(([k, v]) => (
                <div key={k} style={{ display:"flex", gap:8, padding:"5px 0", borderBottom:`1px solid ${T.border}`, fontSize:12 }}>
                  <code style={{ fontFamily:FONT_MONO, color:"#34d399", fontSize:11, minWidth:180, flexShrink:0 }}>{k}</code>
                  <span style={{ color:T.textDim }}>{v}</span>
                </div>
              ))}
            </div>
          </div>
          <div style={{ fontSize:10, fontFamily:FONT_MONO, color:T.textMute, textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:10 }}>SDK Examples</div>
          <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:20 }}>
            <CodeBlock id="sdk_openai"    label="Python · OpenAI SDK"    snippet={resolvedSnippets.sdk_openai}    accentColor="#34d399" />
            <CodeBlock id="sdk_anthropic" label="Python · Anthropic SDK" snippet={resolvedSnippets.sdk_anthropic} accentColor="#34d399" />
            <CodeBlock id="sdk_env"       label="Env-var · httpx"        snippet={resolvedSnippets.sdk_env}       accentColor="#34d399" />
          </div>
          <div style={{ background:`${T.warn}08`, border:`1px solid ${T.warn}22`, borderRadius:8, padding:"14px 18px" }}>
            <div style={{ fontSize:11, fontFamily:FONT_MONO, color:T.warn, textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:8 }}>Advanced — Manual Headers</div>
            <div style={{ display:"flex", flexDirection:"column", gap:6, marginBottom:14 }}>
              <CodeBlock id="manual_openai" label="Manual headers · OpenAI" snippet={resolvedSnippets.manual_openai} accentColor={T.warn} />
              <CodeBlock id="manual_curl"   label="Manual headers · cURL"   snippet={resolvedSnippets.manual_curl}   accentColor={T.warn} />
            </div>
            <div style={{ background:T.panel, border:`1px solid ${T.border}`, borderRadius:6, overflow:"hidden" }}>
              <table style={{ width:"100%", borderCollapse:"collapse" }}>
                <thead>
                  <tr style={{ background:T.panelHi }}>
                    {["Header","Description","Example"].map(h => (
                      <th key={h} style={{ padding:"7px 12px", textAlign:"left", fontSize:10, fontFamily:FONT_MONO, color:T.textMute, letterSpacing:"0.1em", textTransform:"uppercase", borderBottom:`1px solid ${T.border}` }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {OPT_HEADERS.map((row, i) => (
                    <tr key={row.name} style={{ background: i % 2 === 0 ? T.panel : T.bg }}>
                      <td style={{ padding:"7px 12px", borderBottom:`1px solid ${T.border}` }}>
                        <code style={{ fontSize:11, fontFamily:FONT_MONO, color:T.textDim }}>{row.name}</code>
                      </td>
                      <td style={{ padding:"7px 12px", borderBottom:`1px solid ${T.border}`, fontSize:11, color:T.textDim }}>{row.desc}</td>
                      <td style={{ padding:"7px 12px", borderBottom:`1px solid ${T.border}` }}>
                        <code style={{ fontSize:11, fontFamily:FONT_MONO, color:T.textMute }}>{row.example}</code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {section === "platform" && (
        <div style={{ border:`1px solid ${T.purple}44`, borderRadius:10, padding:"24px 28px", marginBottom:16 }}>
          <div style={{ fontSize:13, fontWeight:600, color:T.text, marginBottom:16 }}>Connect AI Ecosystem — Integration Guide</div>
          <div style={{ fontSize:12, color:T.textDim, lineHeight:1.7, marginBottom:20 }}>
            Platform discovery identifies AI-related signals outside the gateway — across GitHub, Slack, Jira, ServiceNow, and MCP servers.
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:24, marginBottom:20 }}>
            <div>
              <div style={{ fontSize:10, fontFamily:FONT_MONO, color:T.textMute, textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:10 }}>Discovery flow</div>
              <FlowColumn steps={PLATFORM_FLOW} />
            </div>
            <div>
              <div style={{ fontSize:10, fontFamily:FONT_MONO, color:T.textMute, textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:10 }}>Supported platforms</div>
              <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginBottom:14 }}>
                {PLATFORMS.map(p => (
                  <span key={p} style={{ background:T.panelHi, border:`1px solid ${T.border}`, color:T.textDim, fontSize:11, fontFamily:FONT_MONO, padding:"3px 10px", borderRadius:4 }}>{p}</span>
                ))}
              </div>
            </div>
          </div>
          <button onClick={() => onNavigate("ecosystem")}
            style={{ background:`${T.purple}14`, border:`1px solid ${T.purple}44`, color:T.purple,
              borderRadius:6, padding:"9px 18px", fontSize:12, fontFamily:FONT_MONO, cursor:"pointer", fontWeight:600 }}>
            View Connected Platforms →
          </button>
        </div>
      )}

    </div>
  );
}
