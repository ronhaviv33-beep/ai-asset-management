import React, { useState } from "react";
import { T, FONT_UI, FONT_MONO } from "../theme.js";

export const Card = ({ children, style, title, subtitle, right }) => (
  <div style={{ background:T.panel, border:`1px solid ${T.border}`, borderRadius:6, padding:18, ...style }}>
    {(title||right) && (
      <div style={{ display:"flex", alignItems:"baseline", justifyContent:"space-between", marginBottom:14 }}>
        <div>
          {title    && <div style={{ fontSize:11, letterSpacing:"0.12em", textTransform:"uppercase", color:T.textDim, fontFamily:FONT_MONO, fontWeight:500 }}>{title}</div>}
          {subtitle && <div style={{ fontSize:13, color:T.textMute, marginTop:4 }}>{subtitle}</div>}
        </div>
        {right}
      </div>
    )}
    {children}
  </div>
);

export const Stat = ({ label, value, delta, suffix, accent }) => (
  <Card>
    <div style={{ fontSize:10, letterSpacing:"0.14em", textTransform:"uppercase", color:T.textDim, fontFamily:FONT_MONO }}>{label}</div>
    <div style={{ fontSize:28, fontFamily:FONT_MONO, fontWeight:500, color:accent||T.text, marginTop:10, letterSpacing:"-0.02em", lineHeight:1 }}>
      {value}{suffix && <span style={{ fontSize:13, color:T.textDim, marginLeft:4, fontWeight:400 }}>{suffix}</span>}
    </div>
    {delta && <div style={{ fontSize:12, marginTop:8, fontFamily:FONT_MONO, color:delta.startsWith("+")?T.crit:T.accent }}>{delta} vs yesterday</div>}
  </Card>
);

export const Pill = ({ children, color }) => (
  <span style={{ display:"inline-flex", alignItems:"center", padding:"2px 8px", borderRadius:3, fontSize:10, fontFamily:FONT_MONO, letterSpacing:"0.08em", textTransform:"uppercase", background:`${color}18`, color, border:`1px solid ${color}33` }}>{children}</span>
);

export const sevColor = (s) => s==="critical"?T.crit:s==="warning"?T.warn:T.info;
export const fmt$  = (n) => n>=1000?`$${(n/1000).toFixed(2)}k`:`$${n.toFixed(2)}`;
export const fmtK  = (n) => n>=1_000_000?`${(n/1_000_000).toFixed(2)}M`:n>=1000?`${(n/1000).toFixed(1)}k`:n.toString();
export const fmtTime=(ts)=>{ const d=Date.now()-ts; if(d<60_000)return"just now"; if(d<3_600_000)return`${Math.floor(d/60_000)}m ago`; if(d<86_400_000)return`${Math.floor(d/3_600_000)}h ago`; return new Date(ts).toLocaleDateString(); };

export function useSortable(defaultKey, defaultDir = "desc") {
  const [sortKey, setSortKey] = useState(defaultKey);
  const [sortDir, setSortDir] = useState(defaultDir);
  const toggle = (key) => {
    if (key === sortKey) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("desc"); }
  };
  const sort = (rows, getValue) => [...rows].sort((a, b) => {
    const va = getValue(a, sortKey), vb = getValue(b, sortKey);
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    const cmp = typeof va === "string" ? va.localeCompare(vb) : va - vb;
    return sortDir === "asc" ? cmp : -cmp;
  });
  return { sortKey, sortDir, toggle, sort };
}

export const SortableTh = ({ label, sortKey, active, dir, onToggle, style: extraStyle = {} }) => (
  <th onClick={() => onToggle(sortKey)}
    style={{ textAlign:"left", padding:"10px 8px", fontFamily:FONT_MONO, fontSize:10, letterSpacing:"0.1em",
      textTransform:"uppercase", color: active ? T.text : T.textDim, fontWeight:500,
      cursor:"pointer", userSelect:"none", whiteSpace:"nowrap", ...extraStyle }}
    title={`Sort by ${label}`}>
    {label}
    <span style={{ marginLeft:4, opacity: active ? 1 : 0.3, fontSize:9 }}>
      {active ? (dir === "asc" ? "▲" : "▼") : "⇅"}
    </span>
  </th>
);

export function useSearch(rows, getSearchString) {
  const [query, setQuery] = useState("");
  const filtered = query.trim()
    ? rows.filter(r => getSearchString(r).toLowerCase().includes(query.toLowerCase().trim()))
    : rows;
  return { query, setQuery, filtered };
}

export const SearchBox = ({ query, onChange, placeholder = "Search…", count, total }) => (
  <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10 }}>
    <div style={{ position:"relative", flex:1, maxWidth:320 }}>
      <span style={{ position:"absolute", left:9, top:"50%", transform:"translateY(-50%)", color:T.textMute, fontSize:12, pointerEvents:"none" }}>⌕</span>
      <input
        value={query}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={{ width:"100%", boxSizing:"border-box", background:T.panelHi, color:T.text, border:`1px solid ${query ? T.accent+"55" : T.border}`,
          padding:"6px 10px 6px 28px", borderRadius:4, fontSize:12, fontFamily:FONT_MONO, outline:"none" }}
      />
      {query && (
        <button onClick={() => onChange("")}
          style={{ position:"absolute", right:6, top:"50%", transform:"translateY(-50%)", background:"none", border:"none", color:T.textMute, cursor:"pointer", fontSize:14, lineHeight:1, padding:0 }}>
          ×
        </button>
      )}
    </div>
    {query && (
      <span style={{ fontFamily:FONT_MONO, fontSize:11, color:T.textMute }}>
        {count} / {total}
      </span>
    )}
  </div>
);
