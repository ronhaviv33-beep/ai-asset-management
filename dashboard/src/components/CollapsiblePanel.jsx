import React, { useState, useEffect, useCallback, useId } from "react";

// ── Shared ObserveAgents dark palette (matches the per-page T tokens) ──────────
const C = {
  panel: "#0F1117", panelHi: "#141823",
  border: "#1E2230",
  text: "#E8ECF4", textDim: "#7A8499", textMute: "#4B5468",
  accent: "#7CFFB2",
};
const MONO = "'JetBrains Mono','IBM Plex Mono',ui-monospace,monospace";
const FONT = "'Geist','Söhne',-apple-system,BlinkMacSystemFont,sans-serif";

// Collapse-all / expand-all coordination. Panels opt into a `group`; a page can
// broadcast collapse/expand to every panel in that group with one event — no
// duplicated logic, no prop threading.
const _EVT = "oa-panel-bulk";
export function setGroupCollapsed(group, collapsed) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(_EVT, { detail: { group, collapsed } }));
}
export const collapseAll = (group) => setGroupCollapsed(group, true);
export const expandAll   = (group) => setGroupCollapsed(group, false);

function readStored(key, fallback) {
  if (!key || typeof window === "undefined") return fallback;
  try {
    const v = window.localStorage.getItem(key);
    if (v === "1") return true;
    if (v === "0") return false;
  } catch { /* ignore */ }
  return fallback;
}

/**
 * Reusable collapse/expand panel — the same interaction as Live Security Alerts.
 * Header always visible (title + badge + actions); content animates open/closed.
 *
 * Props: title, subtitle, badge, defaultExpanded=true, persistState=true,
 *        storageKey, actions, group, headerRight, style, bodyStyle, children.
 */
export default function CollapsiblePanel({
  title,
  subtitle,
  badge,
  defaultExpanded = true,
  persistState = true,
  storageKey,
  actions,
  group,
  style,
  bodyStyle,
  children,
}) {
  const persistKey = persistState ? storageKey : null;
  const [expanded, setExpanded] = useState(() => readStored(persistKey, defaultExpanded));
  const regionId = useId();

  const persist = useCallback((next) => {
    if (!persistKey || typeof window === "undefined") return;
    try { window.localStorage.setItem(persistKey, next ? "1" : "0"); } catch { /* ignore */ }
  }, [persistKey]);

  const toggle = useCallback(() => {
    setExpanded((e) => { const n = !e; persist(n); return n; });
  }, [persist]);

  // Respond to page-level Collapse All / Expand All for our group.
  useEffect(() => {
    if (!group || typeof window === "undefined") return;
    const onBulk = (ev) => {
      if (ev.detail?.group !== group) return;
      const next = !ev.detail.collapsed;
      setExpanded(next);
      persist(next);
    };
    window.addEventListener(_EVT, onBulk);
    return () => window.removeEventListener(_EVT, onBulk);
  }, [group, persist]);

  return (
    <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 8, overflow: "hidden", fontFamily: FONT, ...style }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px" }}>
        <button
          type="button"
          onClick={toggle}
          aria-expanded={expanded}
          aria-controls={regionId}
          style={{
            display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0,
            background: "transparent", border: "none", padding: 0, margin: 0,
            cursor: "pointer", textAlign: "left", color: C.text, font: "inherit",
          }}
        >
          <span aria-hidden="true" style={{
            display: "inline-block", color: C.textDim, fontSize: 11, lineHeight: 1, flexShrink: 0,
            transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
            transition: "transform 220ms ease",
          }}>▶</span>
          <span style={{ minWidth: 0 }}>
            <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: C.text, letterSpacing: "0.02em" }}>{title}</span>
              {badge != null && badge !== "" && (
                <span style={{ fontSize: 10, fontFamily: MONO, color: C.accent, background: `${C.accent}18`, border: `1px solid ${C.accent}33`, borderRadius: 4, padding: "1px 7px" }}>{badge}</span>
              )}
            </span>
            {subtitle && <span style={{ display: "block", fontSize: 11, color: C.textMute, marginTop: 2 }}>{subtitle}</span>}
          </span>
        </button>
        {actions && <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 8 }}>{actions}</div>}
      </div>

      {/* Body — grid-rows trick animates dynamic content height smoothly. */}
      <div
        id={regionId}
        role="region"
        style={{
          display: "grid",
          gridTemplateRows: expanded ? "1fr" : "0fr",
          transition: "grid-template-rows 250ms ease",
        }}
      >
        <div style={{ overflow: "hidden" }} aria-hidden={!expanded}>
          <div style={{ padding: "0 16px 16px", borderTop: `1px solid ${C.border}`, paddingTop: 14, ...bodyStyle }}>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

// Small, consistent "Expand all / Collapse all" control for a page's panel group.
export function PanelGroupControls({ group, style }) {
  const btn = {
    background: "transparent", border: `1px solid ${C.border}`, color: C.textDim,
    padding: "5px 12px", borderRadius: 4, fontSize: 10, fontFamily: MONO,
    cursor: "pointer", letterSpacing: "0.08em", textTransform: "uppercase",
  };
  return (
    <div style={{ display: "flex", gap: 8, ...style }}>
      <button type="button" style={btn} onClick={() => expandAll(group)}>Expand all</button>
      <button type="button" style={btn} onClick={() => collapseAll(group)}>Collapse all</button>
    </div>
  );
}
