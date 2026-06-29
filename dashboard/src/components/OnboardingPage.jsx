import React, { useState } from "react";
import { useUser } from "../auth.jsx";
import { gatewayBaseUrl } from "../config.js";
import { T, FONT_UI, FONT_MONO } from "../theme.js";
import { Card } from "./ui.jsx";

export default function OnboardingPage({ onNavigate }) {
  const currentUser = useUser();
  const gatewayUrl  = gatewayBaseUrl();
  const [copied, setCopied] = useState(null);

  const copy = (id, text) => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  const CopyBtn = ({ id, text }) => (
    <button onClick={() => copy(id, text)}
      style={{ background: copied === id ? `${T.accent}20` : "transparent",
        border: `1px solid ${copied === id ? T.accent + "55" : T.border}`,
        color: copied === id ? T.accent : T.textMute,
        padding: "3px 10px", borderRadius: 3, fontSize: 10,
        fontFamily: FONT_MONO, cursor: "pointer", flexShrink: 0 }}>
      {copied === id ? "✓ copied" : "copy"}
    </button>
  );

  const CodeBlock = ({ id, code, lang }) => (
    <div style={{ position: "relative" }}>
      {lang && (
        <div style={{ position: "absolute", top: 8, left: 12, fontFamily: FONT_MONO,
          fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase",
          color: T.textMute, pointerEvents: "none" }}>{lang}</div>
      )}
      <pre style={{ background: T.bg, border: `1px solid ${T.border}`, borderRadius: 6,
        padding: lang ? "28px 16px 14px" : "14px 16px",
        fontSize: 12, fontFamily: FONT_MONO, color: T.text,
        lineHeight: 1.7, overflow: "auto", margin: 0, whiteSpace: "pre" }}>{code}</pre>
      <div style={{ position: "absolute", top: 8, right: 8 }}>
        <CopyBtn id={id} text={code} />
      </div>
    </div>
  );

  const InlineNav = ({ label, target }) => (
    <button onClick={() => onNavigate(target)}
      style={{ background: "transparent", border: "none", color: T.accent,
        fontFamily: FONT_UI, fontSize: "inherit", cursor: "pointer",
        padding: 0, textDecoration: "underline", textDecorationColor: `${T.accent}55` }}>
      {label}
    </button>
  );

  const openaiSnippet =
`import openai

client = openai.OpenAI(
    base_url="${gatewayUrl}/v1",   # ← only change needed
    api_key="gk-…",                # ← your gateway key, NOT your OpenAI key
)

response = client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[{"role": "user", "content": "Hello"}],
)`;

  const anthropicSnippet =
`import anthropic

client = anthropic.Anthropic(
    base_url="${gatewayUrl}",      # ← only change needed
    api_key="gk-…",                # ← your gateway key, NOT your Anthropic key
)

message = client.messages.create(
    model="claude-haiku-4-5",
    max_tokens=1024,
    messages=[{"role": "user", "content": "Hello"}],
)`;

  const GUARD_MODES = [
    {
      mode: "observe",
      color: T.accent,
      label: "Observe",
      tagline: "Start here.",
      desc: "Every request is logged and visible in your dashboard. Nothing is blocked or flagged to users. Zero impact on your application.",
      when: "Default for all new teams. Stay here until you've seen what your traffic looks like.",
    },
    {
      mode: "alert",
      color: T.warn,
      label: "Alert",
      tagline: "Verify before enforcing.",
      desc: "Policy violations surface as dashboard alerts. Requests still pass through. You see what enforcement would block before you turn it on.",
      when: "Move here after a week or two in observe. Confirm the alerts match real issues, not false positives.",
    },
    {
      mode: "enforce",
      color: T.crit,
      label: "Enforce",
      tagline: "Block in production.",
      desc: "Requests that violate policy are blocked before they reach the provider. Your rules are active.",
      when: "Move here once you've verified alerts in production and are confident in your policies.",
    },
  ];

  const steps = [
    {
      n: "1",
      color: T.warn,
      label: "Add your provider key",
      required: true,
      content: (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 12, color: T.textDim, lineHeight: 1.65 }}>
            Go to <InlineNav label="Settings → Organization AI Providers" target="settings" /> and paste your
            OpenAI, Anthropic, or Google API key.{" "}
            <strong style={{ color: T.warn }}>Until this is done, every request fails with a 402
            "no credential configured" error.</strong> This is the step that stops most setups cold.
          </div>
          <div style={{ background: T.bg, border: `1px solid ${T.border}`, borderRadius: 5,
            padding: "10px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
            {[
              { label: "Your key", example: "sk-…  /  sk-ant-…  /  AIza…", note: "Goes in Settings — never in your app code" },
              { label: "After saving", example: "…k3f9 (last 4 chars)", note: "Full key is never displayed again" },
              { label: "Validation", example: "Checked before storing", note: "Invalid keys are rejected immediately" },
            ].map(r => (
              <div key={r.label} style={{ display: "flex", gap: 10, alignItems: "baseline", fontSize: 12 }}>
                <div style={{ width: 90, fontFamily: FONT_MONO, fontSize: 10, color: T.textMute,
                  letterSpacing: "0.08em", textTransform: "uppercase", flexShrink: 0 }}>{r.label}</div>
                <code style={{ fontFamily: FONT_MONO, fontSize: 11, color: T.accent, flex: 1 }}>{r.example}</code>
                <div style={{ color: T.textMute, fontSize: 11 }}>{r.note}</div>
              </div>
            ))}
          </div>
          <button onClick={() => onNavigate("settings")}
            style={{ alignSelf: "flex-start", background: `${T.warn}15`, border: `1px solid ${T.warn}55`,
              color: T.warn, padding: "6px 14px", borderRadius: 4, fontSize: 11,
              fontFamily: FONT_MONO, cursor: "pointer", letterSpacing: "0.08em", textTransform: "uppercase" }}>
            Open Settings →
          </button>
        </div>
      ),
    },
    {
      n: "2",
      color: T.info,
      label: "Point your app at the gateway",
      content: (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 12, color: T.textDim, lineHeight: 1.65 }}>
            Change <code style={{ fontFamily: FONT_MONO, fontSize: 11, color: T.info }}>base_url</code> in
            your SDK client to point here. That's the only code change — every model, every provider,
            routes through the gateway automatically.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <div style={{ fontFamily: FONT_MONO, fontSize: 9, color: T.textMute, letterSpacing: "0.12em",
                textTransform: "uppercase", marginBottom: 6 }}>OpenAI SDK → /v1/chat/completions</div>
              <CodeBlock id="openai-snippet" code={openaiSnippet} />
            </div>
            <div>
              <div style={{ fontFamily: FONT_MONO, fontSize: 9, color: T.textMute, letterSpacing: "0.12em",
                textTransform: "uppercase", marginBottom: 6 }}>Anthropic SDK → /v1/messages</div>
              <CodeBlock id="anthropic-snippet" code={anthropicSnippet} />
            </div>
          </div>
          <div style={{ background: T.bg, border: `1px solid ${T.border}`, borderRadius: 5,
            padding: "10px 14px", display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ fontFamily: FONT_MONO, fontSize: 10, color: T.textMute,
              letterSpacing: "0.08em", textTransform: "uppercase", flexShrink: 0 }}>Gateway URL</div>
            <code style={{ fontFamily: FONT_MONO, fontSize: 12, color: T.accent, flex: 1 }}>{gatewayUrl}</code>
            <CopyBtn id="gateway-url" text={gatewayUrl} />
          </div>
        </div>
      ),
    },
    {
      n: "3",
      color: T.accent,
      label: "Authenticate with your gateway key",
      content: (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 12, color: T.textDim, lineHeight: 1.65 }}>
            Requests authenticate using a <strong style={{ color: T.accent }}>gateway key</strong> (
            <code style={{ fontFamily: FONT_MONO, fontSize: 11, color: T.accent }}>gk-…</code>),
            issued from the <InlineNav label="API Keys" target="apikeys" /> page.
            This is <strong style={{ color: T.warn }}>not</strong> your provider key — those go in Settings (Step 1).
          </div>
          <div style={{ background: T.bg, border: `1px solid ${T.border}`, borderRadius: 5,
            padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
            {[
              {
                label: "Provider key",
                example: "sk-…  /  sk-ant-…",
                color: T.textMute,
                note: "Stored in Settings → Organization AI Providers. Never in your app.",
              },
              {
                label: "Gateway key",
                example: "gk-…",
                color: T.accent,
                note: 'Used as api_key= in your SDK client. Issued in API Keys.',
              },
            ].map(r => (
              <div key={r.label} style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 12,
                paddingBottom: 8, borderBottom: `1px solid ${T.border}:last-child:border-0` }}>
                <div style={{ width: 110, fontFamily: FONT_MONO, fontSize: 10, color: T.textMute,
                  letterSpacing: "0.08em", textTransform: "uppercase", flexShrink: 0 }}>{r.label}</div>
                <code style={{ fontFamily: FONT_MONO, fontSize: 12, color: r.color, flex: 1 }}>{r.example}</code>
                <div style={{ color: T.textMute, fontSize: 11, maxWidth: 260, textAlign: "right" }}>{r.note}</div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 12, color: T.textDim, lineHeight: 1.65 }}>
            The <code style={{ fontFamily: FONT_MONO, fontSize: 11, color: T.accent }}>gk-…</code> key
            is shown <strong style={{ color: T.warn }}>once</strong> when created — copy it immediately.
            If you lose it, revoke it and generate a new one.
          </div>
          <button onClick={() => onNavigate("apikeys")}
            style={{ alignSelf: "flex-start", background: `${T.accent}12`, border: `1px solid ${T.accent}44`,
              color: T.accent, padding: "6px 14px", borderRadius: 4, fontSize: 11,
              fontFamily: FONT_MONO, cursor: "pointer", letterSpacing: "0.08em", textTransform: "uppercase" }}>
            Create API Key →
          </button>
        </div>
      ),
    },
    {
      n: "4",
      color: T.purple,
      label: "Organise by team",
      content: (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 12, color: T.textDim, lineHeight: 1.65 }}>
            Each API key carries a <strong style={{ color: T.purple }}>team</strong> name, set when you
            create the key. Team is how activity is attributed in telemetry and how guard modes and
            budgets are scoped. An engineering team and a support team can have different rules.
          </div>
          <div style={{ background: T.bg, border: `1px solid ${T.border}`, borderRadius: 5,
            padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontFamily: FONT_MONO, fontSize: 10, color: T.textMute, letterSpacing: "0.1em",
              textTransform: "uppercase", marginBottom: 4 }}>What team controls</div>
            {[
              { label: "Telemetry", desc: "Calls grouped and attributed by team in cost and usage views" },
              { label: "Guard modes", desc: "observe / alert / enforce set independently per team" },
              { label: "Budgets", desc: "Spend limits and alerts scoped per team" },
            ].map(r => (
              <div key={r.label} style={{ display: "flex", gap: 10, fontSize: 12 }}>
                <code style={{ fontFamily: FONT_MONO, fontSize: 11, color: T.purple, width: 100, flexShrink: 0 }}>{r.label}</code>
                <div style={{ color: T.textDim }}>{r.desc}</div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 12, color: T.textMute, lineHeight: 1.5, fontStyle: "italic" }}>
            Tip: one key per team is a good starting point. You can always create more keys for the same team later.
          </div>
        </div>
      ),
    },
    {
      n: "5",
      color: T.warn,
      label: "Choose your guard mode",
      content: (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 12, color: T.textDim, lineHeight: 1.65 }}>
            Guard modes are set per team in <InlineNav label="Settings → Guard Modes" target="settings" />.
            The product philosophy: you see what enforcement would do <em>before</em> you turn it on.
            Start in observe. Move forward only when you're confident.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            {GUARD_MODES.map((gm, i) => (
              <div key={gm.mode} style={{ background: T.bg, border: `1px solid ${gm.color}33`,
                borderRadius: 6, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8,
                position: "relative", overflow: "hidden" }}>
                {i === 0 && (
                  <div style={{ position: "absolute", top: 8, right: 8, background: `${T.accent}18`,
                    border: `1px solid ${T.accent}44`, borderRadius: 3, padding: "2px 7px",
                    fontFamily: FONT_MONO, fontSize: 9, color: T.accent, letterSpacing: "0.1em",
                    textTransform: "uppercase" }}>recommended</div>
                )}
                <div>
                  <code style={{ fontFamily: FONT_MONO, fontSize: 13, color: gm.color, fontWeight: 600 }}>{gm.mode}</code>
                  <div style={{ fontFamily: FONT_MONO, fontSize: 9, color: gm.color, opacity: 0.7,
                    textTransform: "uppercase", letterSpacing: "0.1em", marginTop: 2 }}>{gm.tagline}</div>
                </div>
                <div style={{ fontSize: 12, color: T.textDim, lineHeight: 1.55 }}>{gm.desc}</div>
                <div style={{ fontSize: 11, color: T.textMute, lineHeight: 1.5, borderTop: `1px solid ${T.border}`,
                  paddingTop: 8, marginTop: "auto" }}>{gm.when}</div>
              </div>
            ))}
          </div>
        </div>
      ),
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 960 }}>

      {/* Hero */}
      <div style={{ background: `linear-gradient(135deg, ${T.panel} 0%, ${T.panelHi} 100%)`,
        border: `1px solid ${T.border}`, borderRadius: 8, padding: "32px 36px",
        position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", top: 0, right: 0, width: 260, height: 260,
          background: `radial-gradient(circle, ${T.accent}0C 0%, transparent 70%)`,
          pointerEvents: "none" }} />
        <div style={{ fontFamily: FONT_MONO, fontSize: 10, letterSpacing: "0.18em",
          textTransform: "uppercase", color: T.accent, marginBottom: 10 }}>◆ Setup guide</div>
        <h2 style={{ fontSize: 26, fontWeight: 400, letterSpacing: "-0.02em", margin: "0 0 10px",
          color: T.text, lineHeight: 1.25 }}>
          Get from zero to traffic in five steps
        </h2>
        <p style={{ fontSize: 14, color: T.textDim, margin: 0, maxWidth: 620, lineHeight: 1.65 }}>
          Your organisation is already provisioned — this guide takes you from first login to requests
          flowing through the gateway and visible in your dashboard.
          Follow each step in order; Step 1 is a hard prerequisite.
        </p>
        {currentUser && (
          <div style={{ marginTop: 14, display: "inline-flex", alignItems: "center", gap: 8,
            background: T.panel, border: `1px solid ${T.border}`, borderRadius: 5,
            padding: "7px 12px", fontSize: 12, fontFamily: FONT_MONO }}>
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: T.accent }} />
            <span style={{ color: T.textDim }}>Logged in as</span>
            <span style={{ color: T.text }}>{currentUser.name}</span>
            <span style={{ color: T.textMute }}>·</span>
            <span style={{ color: T.textMute }}>{currentUser.role}</span>
          </div>
        )}
      </div>

      {/* Steps */}
      <Card style={{ padding: "24px 28px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
          {steps.map((s, i) => (
            <div key={s.n} style={{ display: "flex", gap: 20 }}>
              {/* Step indicator column */}
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
                <div style={{ width: 34, height: 34, borderRadius: "50%",
                  background: `${s.color}15`, border: `1px solid ${s.color}55`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontFamily: FONT_MONO, fontSize: 13, color: s.color, fontWeight: 700,
                  flexShrink: 0 }}>
                  {s.n}
                </div>
                {i < steps.length - 1 && (
                  <div style={{ width: 1, flex: 1, background: T.border, minHeight: 20, margin: "6px 0" }} />
                )}
              </div>

              {/* Step body */}
              <div style={{ paddingBottom: i < steps.length - 1 ? 28 : 0, flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                  <div style={{ fontSize: 15, fontWeight: 600, color: T.text }}>{s.label}</div>
                  {s.required && (
                    <span style={{ background: `${T.warn}15`, border: `1px solid ${T.warn}44`,
                      borderRadius: 3, padding: "1px 7px", fontFamily: FONT_MONO, fontSize: 9,
                      color: T.warn, letterSpacing: "0.1em", textTransform: "uppercase" }}>required first</span>
                  )}
                </div>
                {s.content}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Done banner */}
      <div style={{ background: `linear-gradient(135deg, ${T.panel} 0%, ${T.panelHi} 100%)`,
        border: `1px solid ${T.accent}33`, borderRadius: 8, padding: "24px 28px",
        display: "flex", alignItems: "center", gap: 20 }}>
        <div style={{ width: 44, height: 44, borderRadius: "50%", background: `${T.accent}15`,
          border: `1px solid ${T.accent}44`, display: "flex", alignItems: "center",
          justifyContent: "center", fontSize: 20, flexShrink: 0 }}>✓</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: T.accent, marginBottom: 6 }}>
            You're set up — traffic is flowing
          </div>
          <div style={{ fontSize: 13, color: T.textDim, lineHeight: 1.6 }}>
            Once your app is pointed at the gateway and requests are coming through, everything
            is visible in your dashboard. Start with the{" "}
            <InlineNav label="Overview" target="overview" /> to confirm data is landing, then
            check <InlineNav label="Cost Intelligence" target="cost" /> to see spend by team.
            Use <InlineNav label="Alerts" target="alerts" /> to catch issues early.
          </div>
        </div>
        <button onClick={() => onNavigate("overview")}
          style={{ background: `${T.accent}15`, border: `1px solid ${T.accent}55`, color: T.accent,
            padding: "10px 20px", borderRadius: 5, fontSize: 12, fontFamily: FONT_MONO,
            cursor: "pointer", letterSpacing: "0.08em", textTransform: "uppercase", flexShrink: 0 }}>
          Go to Overview →
        </button>
      </div>

    </div>
  );
}
