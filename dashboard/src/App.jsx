import React, { useState, useMemo, useEffect, useCallback, useRef, Component } from "react";

class PageErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(e) { return { error: e }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, fontFamily: "monospace", fontSize: 13, color: "#FF5C7A", background: "#1a1a1a", borderRadius: 8, border: "1px solid #FF5C7A44" }}>
          <strong>Page error:</strong> {String(this.state.error.message || this.state.error)}
          <br /><br />
          <button onClick={() => this.setState({ error: null })} style={{ background: "transparent", border: "1px solid #FF5C7A", color: "#FF5C7A", padding: "4px 12px", borderRadius: 4, cursor: "pointer", fontFamily: "monospace" }}>Retry</button>
        </div>
      );
    }
    return this.props.children;
  }
}
import { login as apiLogin, fetchMe, fetchUsers, createUser, updateUser, deleteUser, getToken, setToken, authFetch, fetchKeyStatuses, updateKey, BASE, fetchApiKeys, createApiKey, revokeApiKey, deleteApiKey, fetchGuardModes, setGuardMode, fetchHealth, fetchProviderCredentials, upsertProviderCredential, deleteProviderCredential, fetchRoles, createRole, updateRole, deleteRole, fetchTeams, fetchAssets, fetchAssetsSummary, fetchAssetTelemetry, fetchUnassignedAssets, claimAsset, updateAssetRegistry, fetchOrgConfig, updateOrgConfig, getDemoMode, setDemoMode, fetchOrganizations, createOrganization, setViewOrg, getViewOrg, fetchAgentsSummary, fetchRelationships, populateOrganization, clearOrganizationDemoData, demoLogin } from "./api.js";
import { isDemoMode, isDevelopment } from "./config.js";
import AgentInventory from "./pages/AgentInventory.jsx";
import CostIntelligence from "./pages/CostIntelligence.jsx";
import PricingRegistry from "./pages/PricingRegistry.jsx";
import ExecutiveDashboard from "./pages/ExecutiveDashboard.jsx";
import DemoDashboard from "./pages/DemoDashboard.jsx";
import DiscoveryCenter from "./pages/DiscoveryCenter.jsx";
import GovernanceCenter from "./pages/GovernanceCenter.jsx";
import SecurityIntelligence from "./pages/SecurityIntelligence.jsx";
import EcosystemDiscovery from "./pages/EcosystemDiscovery.jsx";
import RelationshipMap from "./pages/RelationshipMap.jsx";
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  PieChart, Pie, Cell,
} from "recharts";

import { T, FONT_UI, FONT_MONO } from "./theme.js";
import { BRAND, gatewayBaseUrl, DEMO_GATEWAY_KEY } from "./config.js";
import { Card, Stat, Pill, SortableTh, SearchBox, sevColor, fmt$, fmtK, fmtTime, useSortable, useSearch } from "./components/ui.jsx";
import LoginPage from "./components/LoginPage.jsx";
import Home from "./components/Home.jsx";
import OnboardingPage from "./components/OnboardingPage.jsx";
import BudgetsPage from "./components/BudgetsPage.jsx";
import ApiKeysPage from "./components/ApiKeysPage.jsx";
import OrganizationsPage from "./components/OrganizationsPage.jsx";
import SecurityPage from "./components/SecurityPage.jsx";
import UsersPage from "./components/UsersPage.jsx";
import ChatPage from "./components/ChatPage.jsx";
import AssetsPage from "./components/AssetsPage.jsx";
import ModelUsage from "./components/ModelUsage.jsx";
import WorkflowHealth from "./components/WorkflowHealth.jsx";
import AgentActivity from "./components/AgentActivity.jsx";
import { ORGS, TEAMS, AGENTS, MODELS, providerFromModel, tierFromModel, approvedModel, parseUTC, apiRecordToEvent, buildLiveMetadata, genDemoEvents } from "./data/demoData.js";
import { ALERT_META, applyFilters, runDetections, agg, estimateSavings, computeRiskScore, execSummary } from "./data/alertMeta.js";
import { useLiveData } from "./hooks/useLiveData.js";
import { UserContext, useUser, RolesContext, useRoles, ROLES, canSeePage, userCan, canAccess } from "./auth.jsx";
import CustomerWelcomePage from "./pages/PlatformGuide.jsx";
import SimpleIntegrationsPage from "./pages/Setup.jsx";
import SettingsPage, { GUARD_MODE_META } from "./pages/Settings.jsx";
import { useBreakpoint } from "./hooks/useBreakpoint.js";



function RuntimeChain({ events, allAgents, allTeams, selectedAgentId, onSelectAgent }) {
  const ag = allAgents.find((a)=>a.id===selectedAgentId) || allAgents[0];
  if (!ag) return null;
  const agEvents   = events.filter((e)=>e.agent===ag.id);
  const totalCost  = agEvents.reduce((s,e)=>s+e.cost,0);
  const totalCalls = agEvents.length;
  const modelMix   = {};
  agEvents.forEach((e)=>{ modelMix[e.model]=(modelMix[e.model]||0)+1; });
  const topModel   = Object.entries(modelMix).sort((a,b)=>b[1]-a[1])[0]?.[0]||"—";
  const fails      = agEvents.filter((e)=>e.status==="failed").length;
  const sensitive  = agEvents.filter((e)=>e.sensitive).length;
  const unapproved = agEvents.filter((e)=>!approvedModel(e.model)).length;
  const riskLevel  = (fails/Math.max(totalCalls,1)>0.1||sensitive>0||unapproved>0)?"high":totalCost>50?"medium":"low";
  const riskColor  = riskLevel==="high"?T.crit:riskLevel==="medium"?T.warn:T.accent;
  const modelApproved = approvedModel(topModel);

  const Node = ({ label, value, sub, color }) => (
    <div style={{ background:T.panelHi, border:`1px solid ${T.border}`, borderRadius:6, padding:"14px 16px", minWidth:140, flex:1 }}>
      <div style={{ fontFamily:FONT_MONO, fontSize:9, letterSpacing:"0.14em", textTransform:"uppercase", color:T.textMute, marginBottom:6 }}>{label}</div>
      <div style={{ fontFamily:FONT_MONO, fontSize:15, color:color||T.text, marginBottom:4 }}>{value}</div>
      <div style={{ fontFamily:FONT_MONO, fontSize:11, color:T.textDim }}>{sub}</div>
    </div>
  );
  const Arrow = () => (
    <div style={{ display:"flex", alignItems:"center", padding:"0 6px" }}>
      <svg width="28" height="14" viewBox="0 0 28 14">
        <line x1="0" y1="7" x2="22" y2="7" stroke={T.borderHi} strokeWidth="1" strokeDasharray="3,3"/>
        <polygon points="22,3 28,7 22,11" fill={T.borderHi}/>
      </svg>
    </div>
  );

  return (
    <Card title="Runtime Chain" subtitle="Trace a single agent end-to-end: who, what tool, which model, what it cost, what risk">
      <div style={{ display:"flex", gap:6, marginBottom:18, flexWrap:"wrap" }}>
        {allAgents.map((a)=>(
          <button key={a.id} onClick={()=>onSelectAgent(a.id)}
            style={{ background:a.id===selectedAgentId?T.accent:"transparent", color:a.id===selectedAgentId?T.bg:T.textDim, border:`1px solid ${a.id===selectedAgentId?T.accent:T.border}`, padding:"5px 10px", borderRadius:3, fontSize:11, fontFamily:FONT_MONO, cursor:"pointer" }}>
            {a.name}
          </button>
        ))}
      </div>
      <div style={{ display:"flex", alignItems:"stretch", overflowX:"auto", paddingBottom:4 }}>
        <Node label="Agent"  value={ag.name}    sub={allTeams.find((t)=>t.id===ag.team)?.name||ag.team} />
        <Arrow />
        <Node label="Tool"   value={ag.tool}    sub={`${totalCalls.toLocaleString()} invocations`} />
        <Arrow />
        <Node label="Model"  value={topModel}   sub={providerFromModel(topModel)} color={!modelApproved?T.warn:T.text} />
        <Arrow />
        <Node label="Cost"   value={fmt$(totalCost)} sub={`avg $${(totalCost/Math.max(totalCalls,1)).toFixed(4)}/call`} />
        <Arrow />
        <Node label="Risk"   value={riskLevel.toUpperCase()} sub={`${fails} fail · ${sensitive} sens · ${unapproved} unapp`} color={riskColor} />
      </div>
    </Card>
  );
}

function Overview({ A, events, allAgents, allTeams }) {
  const [selectedAgent, setSelectedAgent] = useState(allAgents[0]?.id || "");
  return (
    <div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:14, marginBottom:14 }}>
        <Stat label="Cost today"    value={fmt$(A.today.cost)}         delta="+47%" />
        <Stat label="Tokens today"  value={fmtK(A.today.tokens)}       delta="+38%" />
        <Stat label="Active agents" value={A.today.activeAgents}       suffix={`/ ${allAgents.length}`} />
        <Stat label="Avg latency"   value={Math.round(A.today.avgLatency)} suffix="ms" delta="+12%" />
        <Stat label="Failed reqs"   value={A.today.failed}             accent={A.today.failed>5?T.crit:T.text} />
      </div>
      <div style={{ marginBottom:14 }}>
        <RuntimeChain events={events} allAgents={allAgents} allTeams={allTeams} selectedAgentId={selectedAgent} onSelectAgent={setSelectedAgent} />
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"2fr 1fr", gap:14 }}>
        <Card title="Cost trend" subtitle="Daily spend across the selected window">
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={A.series}>
              <defs><linearGradient id="g1" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={T.accent} stopOpacity={0.35}/><stop offset="100%" stopColor={T.accent} stopOpacity={0}/></linearGradient></defs>
              <CartesianGrid stroke={T.border} vertical={false}/>
              <XAxis dataKey="date" tickFormatter={(d)=>new Date(d).toLocaleDateString(undefined,{month:"short",day:"numeric"})} stroke={T.textMute} style={{ fontFamily:FONT_MONO, fontSize:10 }}/>
              <YAxis stroke={T.textMute} style={{ fontFamily:FONT_MONO, fontSize:10 }} tickFormatter={(v)=>`$${v.toFixed(0)}`}/>
              <Tooltip contentStyle={{ background:T.panelHi, border:`1px solid ${T.borderHi}`, borderRadius:4, fontFamily:FONT_MONO, fontSize:11 }} labelFormatter={(d)=>new Date(d).toLocaleDateString()} formatter={(v)=>[`$${v.toFixed(2)}`,"cost"]}/>
              <Area type="monotone" dataKey="cost" stroke={T.accent} strokeWidth={1.5} fill="url(#g1)"/>
            </AreaChart>
          </ResponsiveContainer>
        </Card>
        <Card title="Top agents by cost" subtitle="Window total">
          <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
            {Object.entries(A.costByAgent).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([id,cost])=>{
              const agent = allAgents.find((x)=>x.id===id);
              const max   = Math.max(...Object.values(A.costByAgent));
              return (
                <div key={id} style={{ fontSize:12 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
                    <span style={{ fontFamily:FONT_MONO, color:T.text }}>{agent?.name||id}</span>
                    <span style={{ fontFamily:FONT_MONO, color:T.textDim }}>{fmt$(cost)}</span>
                  </div>
                  <div style={{ height:4, background:T.border, borderRadius:2, overflow:"hidden" }}>
                    <div style={{ width:`${(cost/max)*100}%`, height:"100%", background:T.accent, opacity:0.85 }}/>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>
    </div>
  );
}


function AlertCard({ a }) {
  const [open, setOpen] = useState(false);
  const meta = ALERT_META[a.type]||{};
  const c    = sevColor(a.sev);
  return (
    <div style={{ background:T.panelHi, border:`1px solid ${T.border}`, borderLeft:`2px solid ${c}`, borderRadius:5, overflow:"hidden" }}>
      <div style={{ padding:"16px 18px" }}>
        <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:16 }}>
          <div style={{ display:"flex", gap:14, alignItems:"flex-start" }}>
            <div style={{ width:34, height:34, borderRadius:7, background:`${c}1A`, border:`1px solid ${c}33`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, marginTop:2 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            </div>
            <div>
              <div style={{ fontSize:15, color:T.text, fontWeight:500, marginBottom:3 }}>{meta.title||a.type}</div>
              <div style={{ fontSize:12, color:T.textDim, fontFamily:FONT_MONO }}>{meta.category||"Alert"}<span style={{ color:T.textMute }}> · {a.entity}</span></div>
            </div>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:10, flexShrink:0 }}>
            <Pill color={c}>{a.sev}</Pill>
            <span style={{ fontFamily:FONT_MONO, fontSize:11, color:T.textMute }}>{fmtTime(a.ts)}</span>
          </div>
        </div>
        <div style={{ display:"flex", gap:8, marginTop:14, flexWrap:"wrap" }}>
          <button style={{ display:"inline-flex", alignItems:"center", gap:7, background:`${c}1A`, color:c, border:`1px solid ${c}44`, padding:"6px 12px", borderRadius:4, fontSize:12, fontFamily:FONT_UI, cursor:"pointer" }}>▶ Run an action</button>
          <button style={{ display:"inline-flex", alignItems:"center", gap:7, background:"transparent", color:T.textDim, border:`1px solid ${T.border}`, padding:"6px 12px", borderRadius:4, fontSize:12, fontFamily:FONT_UI, cursor:"pointer" }}>Ignore</button>
          <button style={{ display:"inline-flex", alignItems:"center", gap:7, background:"transparent", color:T.textDim, border:`1px solid ${T.border}`, padding:"6px 12px", borderRadius:4, fontSize:12, fontFamily:FONT_UI, cursor:"pointer" }}>Support</button>
          <button onClick={()=>setOpen((o)=>!o)} style={{ display:"inline-flex", alignItems:"center", gap:7, background:"transparent", color:T.textDim, border:`1px solid ${T.border}`, padding:"6px 12px", borderRadius:4, fontSize:12, fontFamily:FONT_UI, cursor:"pointer", marginLeft:"auto" }}>
            {open?"Hide explanation":"Why this fired"} {open?"▲":"▼"}
          </button>
        </div>
      </div>
      {open && (
        <div style={{ borderTop:`1px solid ${T.border}`, background:T.panel, padding:"18px 18px 18px 64px" }}>
          <div style={{ marginBottom:16 }}>
            <div style={{ fontSize:13, color:T.text, lineHeight:1.6 }}>{meta.detail?meta.detail(a):a.msg}</div>
          </div>
          {meta.checks && <ExplBlock label="What this rule checks" color={T.info}   text={meta.checks}  />}
          {meta.matters && <ExplBlock label="Why it matters"        color={T.warn}   text={meta.matters} />}
          {meta.causes && (
            <div style={{ marginBottom:16 }}>
              <div style={{ fontFamily:FONT_MONO, fontSize:10, letterSpacing:"0.12em", textTransform:"uppercase", color:T.purple, marginBottom:8 }}>Common causes</div>
              <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                {meta.causes.map((cz,i)=>(
                  <div key={i} style={{ display:"flex", gap:8, fontSize:13, color:T.textDim, lineHeight:1.5 }}>
                    <span style={{ color:T.purple, flexShrink:0 }}>—</span>{cz}
                  </div>
                ))}
              </div>
            </div>
          )}
          <div style={{ background:T.panelHi, border:`1px solid ${T.border}`, borderRadius:4, padding:"12px 14px", display:"flex", gap:10, alignItems:"flex-start" }}>
            <span style={{ color:T.accent, fontFamily:FONT_MONO, fontSize:13, flexShrink:0 }}>→</span>
            <div>
              <div style={{ fontFamily:FONT_MONO, fontSize:10, letterSpacing:"0.12em", textTransform:"uppercase", color:T.accent, marginBottom:4 }}>Recommended action</div>
              <div style={{ fontSize:13, color:T.text, lineHeight:1.5 }}>{a.action}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ExplBlock({ label, color, text }) {
  return (
    <div style={{ marginBottom:16 }}>
      <div style={{ fontFamily:FONT_MONO, fontSize:10, letterSpacing:"0.12em", textTransform:"uppercase", color, marginBottom:6 }}>{label}</div>
      <div style={{ fontSize:13, color:T.textDim, lineHeight:1.6 }}>{text}</div>
    </div>
  );
}

function AlertsPage({ alerts, sevFilter }) {
  const filtered = sevFilter==="all"?alerts:alerts.filter((a)=>a.sev===sevFilter);
  return (
    <Card title="Alerts" subtitle={`${filtered.length} of ${alerts.length} matching current filter · click any alert for the full explanation`}>
      <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
        {filtered.length===0 ? (
          <div style={{ color:T.textMute, fontFamily:FONT_MONO, fontSize:13, padding:"24px 0", textAlign:"center" }}>No alerts matching current filter</div>
        ) : filtered.map((a,i)=><AlertCard key={i} a={a}/>)}
      </div>
    </Card>
  );
}

function FilterBar({ filters, setFilters, allTeams, allAgents, user, rolesMap }) {
  const isTeamScoped = !!(rolesMap?.[user?.role]?.team_scoped);
  const lockedTeam   = user?.team || "";

  const Select = ({ label, value, onChange, options }) => (
    <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
      <label style={{ fontSize:9, fontFamily:FONT_MONO, letterSpacing:"0.12em", textTransform:"uppercase", color:T.textMute }}>{label}</label>
      <select value={value} onChange={(e)=>onChange(e.target.value)} style={{ background:T.panelHi, color:T.text, border:`1px solid ${T.border}`, padding:"5px 8px", borderRadius:3, fontSize:12, fontFamily:FONT_MONO, cursor:"pointer", minWidth:100 }}>
        {options.map((o)=><option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );

  const TeamField = isTeamScoped ? (
    <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
      <label style={{ fontSize:9, fontFamily:FONT_MONO, letterSpacing:"0.12em", textTransform:"uppercase", color:T.textMute }}>Team</label>
      <div style={{ display:"flex", alignItems:"center", gap:6, background:T.panelHi, border:`1px solid ${T.border}`, padding:"5px 10px", borderRadius:3, fontSize:12, fontFamily:FONT_MONO, color:T.accent, minWidth:100 }}>
        <span style={{ fontSize:9, color:T.accentDim }}>⬤</span>
        {lockedTeam || "—"}
      </div>
    </div>
  ) : (
    <Select label="Team" value={filters.team} onChange={(v)=>setFilters({...filters,team:v})}
      options={[{value:"all",label:"All teams"}, ...allTeams.map((t)=>({value:t.id,label:t.name}))]}/>
  );

  const handleReset = () => setFilters({
    team:  isTeamScoped ? filters.team : "all",
    model: "all", agent: "all", sev: "all", range: 30,
  });

  return (
    <div style={{ display:"flex", gap:16, padding:"12px 18px", background:T.panel, border:`1px solid ${T.border}`, borderRadius:6, marginBottom:14, alignItems:"flex-end", flexWrap:"wrap" }}>
      {TeamField}
      <Select label="Model"    value={filters.model} onChange={(v)=>setFilters({...filters,model:v})} options={[{value:"all",label:"All models"}, ...MODELS.map((m)=>({value:m.name,label:m.name}))]}/>
      <Select label="Agent"    value={filters.agent} onChange={(v)=>setFilters({...filters,agent:v})} options={[{value:"all",label:"All agents"}, ...allAgents.map((a)=>({value:a.id,label:a.name}))]}/>
      <Select label="Severity" value={filters.sev}   onChange={(v)=>setFilters({...filters,sev:v})}   options={[{value:"all",label:"All"},{value:"critical",label:"Critical"},{value:"warning",label:"Warning"},{value:"info",label:"Info"}]}/>
      <Select label="Range"    value={String(filters.range)} onChange={(v)=>setFilters({...filters,range:parseInt(v)})} options={[{value:"1",label:"Last 24h"},{value:"7",label:"Last 7d"},{value:"30",label:"Last 30d"}]}/>
      <button onClick={handleReset} style={{ background:"transparent", color:T.textDim, border:`1px solid ${T.border}`, padding:"6px 12px", borderRadius:3, fontSize:11, fontFamily:FONT_MONO, cursor:"pointer", marginLeft:"auto" }}>Reset</button>
    </div>
  );
}


const PAGES = [
  { id:"dashboard",      label:"Dashboard" },
  { id:"welcome",        label:"Platform Guide" },
  { id:"agent_inventory",label:"AI Agent Inventory" },
  { id:"discovery",      label:"Discovery Center" },
  { id:"governance",     label:"Governance Center" },
  { id:"cost",           label:"Cost Intelligence" },
  { id:"security_intel", label:"Security Intelligence" },
  { id:"ecosystem",        label:"Ecosystem Discovery" },
  { id:"relationship_map", label:"Runtime Dependency Map" },
  { id:"budgets",          label:"Budgets" },
  { id:"pricing",        label:"Pricing Registry" },
  { id:"security",       label:"Security & Audit" },
  { id:"users",          label:"Users" },
  { id:"apikeys",        label:"API Keys" },
  { id:"settings",       label:"Settings" },
  // Legacy pages (not in primary nav but still routable)
  { id:"home",           label:"Home" },
  { id:"overview",       label:"Overview" },
  { id:"agents",         label:"Agent Activity" },
  { id:"models",         label:"Model Usage" },
  { id:"workflows",      label:"Workflow Health" },
  { id:"alerts",         label:"Alerts" },
  { id:"assets",         label:"Asset Inventory" },
  { id:"chat",           label:"Chat" },
  { id:"integrations",   label:"Setup" },
  { id:"onboarding",     label:"Setup Guide" },
];

// NAV_GROUPS: sidebar rendering — only primary navigation, grouped by section
const NAV_GROUPS = [
  {
    label: null,
    items: [
      { id: "dashboard", label: "Dashboard" },
      { id: "welcome",   label: "Platform Guide" },
    ],
  },
  {
    label: "INVENTORY",
    items: [
      { id: "agent_inventory",  label: "Agents" },
      { id: "discovery",        label: "Discovery Center" },
      { id: "governance",       label: "Governance Center" },
      { id: "relationship_map", label: "Dependency Map" },
    ],
  },
  {
    label: "INTELLIGENCE",
    items: [
      { id: "cost",          label: "Cost Intelligence" },
      { id: "security_intel",label: "Security Intelligence" },
      { id: "ecosystem",     label: "Ecosystem Discovery" },
    ],
  },
  {
    label: "ADMINISTRATION",
    items: [
      { id: "budgets",       label: "Budgets" },
      { id: "pricing",       label: "Pricing Registry" },
      { id: "security",      label: "Security & Audit" },
      { id: "users",         label: "Users" },
      { id: "apikeys",       label: "API Keys" },
      { id: "integrations",  label: "Setup" },
      { id: "settings",      label: "Settings" },
      { id: "organizations", label: "Organizations", platformAdminOnly: true },
    ],
  },
];

// ─── Root ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [page, setPage]       = useState("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const bp = useBreakpoint();
  const [discoveryInitialTab, setDiscoveryInitialTab] = useState("verified");

  // Navigate to a page and push a browser history entry so back/forward works.
  const navigate = useCallback((id) => {
    setPage(id);
    window.history.pushState({ page: id }, '', '#' + id);
  }, []);

  // On first load, restore page from URL hash if valid.
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    const valid = PAGES.find(p => p.id === hash);
    if (valid) {
      setPage(hash);
      window.history.replaceState({ page: hash }, '', '#' + hash);
    } else {
      window.history.replaceState({ page: 'dashboard' }, '', '#dashboard');
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync React page state when the user presses back or forward.
  useEffect(() => {
    const onPop = (e) => {
      const p = e.state?.page || window.location.hash.slice(1) || 'dashboard';
      setPage(PAGES.find(pg => pg.id === p) ? p : 'dashboard');
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const [filters, setFilters] = useState({ team:"all", model:"all", agent:"all", sev:"all", range:30 });

  // Auto-close drawer when rotating to a wider breakpoint (e.g. landscape tablet → desktop)
  useEffect(() => { if (bp.isDesktop) setSidebarOpen(false); }, [bp.isDesktop]);

  // Prevent body scroll when drawer is open so the page doesn't scroll behind the overlay
  useEffect(() => {
    if (!bp.isDesktop && sidebarOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [sidebarOpen, bp.isDesktop]);

  // ── Real JWT auth ──
  const [user,         setUser]         = useState(null);
  const [authChecked,  setAuthChecked]  = useState(false);
  // rolesMap: null until server roles are fetched — gates rendering so the
  // init window never falls back to stale hardcoded permissions.
  const [rolesMap,     setRolesMap]     = useState(null);

  // ── Platform admin org switching ──
  const [viewOrgId,  setViewOrgId]  = useState(() => getViewOrg());
  const [allOrgs,    setAllOrgs]    = useState([]);

  // When the logged-in user has a team-scoped role, lock the team filter to their team.
  // Runs whenever user or rolesMap changes (e.g. after login).
  useEffect(() => {
    if (!user || !rolesMap) return;
    const isTeamScoped = !!(rolesMap[user.role]?.team_scoped);
    if (isTeamScoped && user.team) {
      const teamId = `live_team_${user.team.replace(/\s+/g, "_").toLowerCase()}`;
      setFilters(f => f.team === teamId ? f : { ...f, team: teamId });
    }
  }, [user, rolesMap]);

  // Fetch all orgs when logged in as platform admin; retry up to 3× if empty
  useEffect(() => {
    if (!user?.is_platform_admin) return;
    let cancelled = false;
    const load = (attempt = 0) => {
      fetchOrganizations().then(orgs => {
        if (cancelled) return;
        if (orgs.length > 0) { setAllOrgs(orgs); return; }
        if (attempt < 3) setTimeout(() => load(attempt + 1), 1500);
      }).catch(() => {
        if (!cancelled && attempt < 3) setTimeout(() => load(attempt + 1), 1500);
      });
    };
    load();
    return () => { cancelled = true; };
  }, [user]);

  // On mount, validate stored token; also listen for mid-session expiry
  useEffect(() => {
    const check = async () => {
      // Public demo service: no login required — silently mint a demo token.
      if (!getToken() && isDemoMode()) {
        const t = await demoLogin();
        if (t) setToken(t);
      }
      const token = getToken();
      if (token) {
        try {
          // Both arms raced against 5s timeouts — a server that accepts the TCP
          // connection but never responds can't hold the spinner open forever.
          // Both race arms always resolve (never reject), so Promise.all can only
          // fail if something else throws, which the outer catch covers.
          const withTimeout = (p, ms) => Promise.race([p, new Promise(r => setTimeout(() => r(null), ms))]);
          const [me, serverRoles] = await Promise.all([
            withTimeout(fetchMe().catch(() => null), 5000),
            withTimeout(fetchRoles().catch(() => null), 5000),
          ]);
          if (me) {
            setUser(me);
            const map = serverRoles?.length
              ? Object.fromEntries(serverRoles.map(r => [r.name, r]))
              : Object.fromEntries(Object.entries(ROLES).map(([k,v]) => [k, {name:k, ...v, pages: v.pages ?? [], can: v.can ?? []}]));
            setRolesMap(map);  // always set (even empty) so the init gate clears
          } else {
            setToken(null);
            setRolesMap({});  // no user → empty roles map, show login page
          }
        } catch {
          setToken(null);
          setRolesMap({});
        }
      } else {
        setRolesMap({});  // no token → set empty roles, unblock the login screen
      }
      setAuthChecked(true);
    };
    check();

    const onExpired = () => { setToken(null); setUser(null); };
    window.addEventListener('auth:expired', onExpired);
    return () => window.removeEventListener('auth:expired', onExpired);
  }, []);

  const handleLogin = async (u) => {
    setUser(u);
    window.history.replaceState({ page: 'dashboard' }, '', '#dashboard');
    setPage('dashboard');
    try {
      const serverRoles = await fetchRoles();
      const map = serverRoles?.length
        ? Object.fromEntries(serverRoles.map(r => [r.name, r]))
        : Object.fromEntries(Object.entries(ROLES).map(([k,v]) => [k, {name:k, ...v, pages: v.pages ?? [], can: v.can ?? []}]));
      setRolesMap(map);
    } catch {
      setRolesMap(Object.fromEntries(Object.entries(ROLES).map(([k,v]) => [k, {name:k, ...v, pages: v.pages ?? [], can: v.can ?? []}])));
    }
  };

  const handleLogout = () => {
    setToken(null);
    setUser(null);
    window.history.replaceState(null, '', window.location.pathname);
  };

  const { apiRecords, serverTeams, serverAlerts, lastRefresh, isLive, demoMode, setDemoModeState, refresh } = useLiveData(30_000);

  // ── Populate / clear sidebar actions (declared AFTER useLiveData so refresh is initialized) ──
  const [sidebarPopping,   setSidebarPopping]   = useState(false);
  const [sidebarClearing,  setSidebarClearing]  = useState(false);
  const [sidebarPopResult, setSidebarPopResult] = useState(null);

  const handleSidebarPopulate = useCallback(async () => {
    if (!viewOrgId) return;
    setSidebarPopping(true); setSidebarPopResult(null);
    try {
      const res = await populateOrganization(viewOrgId);
      setSidebarPopResult({ ok: true, msg: `${res.assets_upserted} agents · ${res.telemetry_rows_added} rows · ${res.relationships_created} rels` });
      refresh();
    } catch (e) {
      setSidebarPopResult({ ok: false, msg: e.message });
    } finally { setSidebarPopping(false); }
  }, [viewOrgId, refresh]);

  const handleSidebarClear = useCallback(async () => {
    const org = allOrgs.find(o => String(o.id) === String(viewOrgId));
    const name = org?.name ?? `org ${viewOrgId}`;
    if (!window.confirm(`Clear all demo data from "${name}"?\n\nThis will delete demo telemetry, agents, relationships, and governance rules. Real customer data is not affected.`)) return;
    setSidebarClearing(true); setSidebarPopResult(null);
    try {
      const res = await clearOrganizationDemoData(viewOrgId);
      setSidebarPopResult({ ok: true, msg: `Cleared ${res.telemetry_deleted} rows · ${res.assets_deleted} agents · ${res.relationships_deleted} rels` });
      refresh();
    } catch (e) {
      setSidebarPopResult({ ok: false, msg: e.message });
    } finally { setSidebarClearing(false); }
  }, [viewOrgId, allOrgs, refresh]);

  const handleToggleDemoMode = useCallback(async () => {
    const next = !demoMode;
    try {
      await setDemoMode(next);
      setDemoModeState(next);
      refresh();
    } catch (e) {
      console.error("Failed to toggle demo mode", e);
    }
  }, [demoMode, setDemoModeState, refresh]);

  // Platform guard mode badge (best-effort — silent if unauthenticated)
  const [platformMode,       setPlatformMode]       = useState(null);
  const [pricingLastUpdated, setPricingLastUpdated] = useState(null);
  const [secretWarnings,     setSecretWarnings]     = useState([]);
  useEffect(() => {
    if (!user) return;
    fetchHealth().then(h => {
      setPlatformMode(h?.platform_mode);
      setPricingLastUpdated(h?.pricing_last_updated || null);
      setSecretWarnings(h?.secret_warnings || []);
    }).catch(() => {});
  }, [user]);

  // Build event list and metadata from live data or demo fallback.
  // serverTeams (from /teams) always includes every registered team even if it
  // has no telemetry yet, so new teams appear in the filter dropdown immediately.
  const { allEvents, allTeams, allAgents } = useMemo(() => {
    // Synthetic fallback data is ONLY used in the demo/dev environment. Production
    // never fabricates data — empty API → empty arrays → real empty states.
    const allowSynthetic = isDemoMode() || isDevelopment();
    if (apiRecords === null) {
      // still loading
      return allowSynthetic
        ? { allEvents: [], allTeams: TEAMS, allAgents: AGENTS }
        : { allEvents: [], allTeams: [], allAgents: [] };
    }
    if (apiRecords.length === 0) {
      // No live data: in demo/dev fall back to synthetic; in production stay empty.
      const extraTeams = serverTeams.map(t => ({ id: `live_team_${t.name.replace(/\s+/g,"_").toLowerCase()}`, org: "org_live", name: t.name }));
      if (!allowSynthetic) {
        return { allEvents: [], allTeams: extraTeams, allAgents: [] };
      }
      const merged = extraTeams.length > 0 ? extraTeams : TEAMS;
      return { allEvents: genDemoEvents(), allTeams: merged, allAgents: AGENTS };
    }
    const { liveTeams, liveAgents } = buildLiveMetadata(apiRecords);
    // Merge server-registered teams (no telemetry yet) into the dropdown list
    const liveTeamNames = new Set(liveTeams.map(t => t.name));
    const extraTeams = serverTeams
      .filter(t => !liveTeamNames.has(t.name))
      .map(t => ({ id: `live_team_${t.name.replace(/\s+/g,"_").toLowerCase()}`, org: "org_live", name: t.name }));
    return {
      allEvents:  apiRecords.map(apiRecordToEvent),
      allTeams:   [...liveTeams, ...extraTeams],
      allAgents:  liveAgents,
    };
  }, [apiRecords, serverTeams]);

  const filteredEvents = useMemo(() => applyFilters(allEvents, filters), [allEvents, filters]);
  const A       = useMemo(() => agg(filteredEvents),               [filteredEvents]);
  const alerts  = useMemo(() => {
    const detected = runDetections(filteredEvents);
    // Patch timestamps from server-stored security alerts (which have the exact
    // time the backend first persisted each alert) so "X ago" reflects reality.
    if (serverAlerts.length === 0) return detected;
    const serverTsByType = {};
    serverAlerts.forEach(sa => {
      const t = parseUTC(sa.ts).getTime();
      if (!serverTsByType[sa.type] || t > serverTsByType[sa.type]) {
        serverTsByType[sa.type] = t;
      }
    });
    return detected.map(a => serverTsByType[a.type] ? { ...a, ts: serverTsByType[a.type] } : a);
  }, [filteredEvents, serverAlerts]);
  const savings = useMemo(() => estimateSavings(filteredEvents),   [filteredEvents]);
  const risk    = useMemo(() => computeRiskScore(filteredEvents, alerts), [filteredEvents, alerts]);
  const critCount = alerts.filter((a)=>a.sev==="critical").length;

  // Props passed down so page components use the right metadata
  const pageProps = { events: filteredEvents, allTeams, allAgents, A, alerts, savings, risk };

  const renderPage = () => {
    if (!user?.is_platform_admin && !canAccess(user?.role, page, rolesMap)) {
      return (
        <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", height:300, gap:12, color:T.textMute, fontFamily:FONT_MONO }}>
          <div style={{ fontSize:24, color:T.crit }}>⊘</div>
          <div style={{ fontSize:14 }}>Access denied — <strong style={{ color:T.warn }}>{rolesMap[user?.role]?.label}</strong> role cannot view this page</div>
        </div>
      );
    }
    switch (page) {
      // ── New primary pages ───────────────────────────────────────────────
      case "dashboard":      return isDemoMode() ? <DemoDashboard onNavigate={navigate} /> : <ExecutiveDashboard onNavigate={navigate} />;
      case "welcome":        return <CustomerWelcomePage onNavigate={navigate} />;
      case "agent_inventory":return <AgentInventory isAdmin={user?.role === "admin"} onNavigate={(pg, opts={}) => { if (opts.discoveryTab) setDiscoveryInitialTab(opts.discoveryTab); navigate(pg); }} />;
      case "discovery":      return <DiscoveryCenter initialTab={discoveryInitialTab} />;
      case "governance":     return <GovernanceCenter />;
      case "security_intel": return <SecurityIntelligence />;
      case "ecosystem":        return <EcosystemDiscovery />;
      case "relationship_map": return <RelationshipMap />;
      // ── Existing pages (unchanged) ──────────────────────────────────────
      case "cost":      return <CostIntelligence />;
      case "pricing":   return <PricingRegistry />;
      case "budgets":   return <BudgetsPage />;
      case "security":  return <SecurityPage />;
      case "users":     return <UsersPage />;
      case "apikeys":   return <ApiKeysPage demoMode={demoMode} />;
      case "settings":      return <SettingsPage />;
      // ── Legacy pages (still routable, removed from primary nav) ────────
      case "home":           return <Home onNavigate={navigate} />;
      case "chat":           return <ChatPage demoMode={demoMode} />;
      case "assets":    return <AssetsPage />;
      case "overview":  return <Overview  {...pageProps} />;
      case "agents":    return <AgentActivity {...pageProps} />;
      case "models":    return <ModelUsage A={A} />;
      case "workflows": return <WorkflowHealth {...pageProps} />;
      case "alerts":    return <AlertsPage alerts={alerts} sevFilter={filters.sev} />;
      case "integrations":  return <SimpleIntegrationsPage onNavigate={navigate} demoMode={demoMode} />;
      case "onboarding":    return <OnboardingPage onNavigate={navigate} demoMode={demoMode} />;
      case "organizations": return user?.is_platform_admin ? <OrganizationsPage /> : null;
      default:              return null;
    }
  };

  if (!authChecked || apiRecords === null || rolesMap === null) {
    return <div style={{ minHeight:"100vh", background:T.bg, display:"flex", alignItems:"center", justifyContent:"center", color:T.textDim, fontFamily:FONT_MONO }}>Connecting to AI Asset Management…</div>;
  }

  if (!user) {
    return <LoginPage onLogin={handleLogin} />;
  }

  return (
    <UserContext.Provider value={user}>
    <RolesContext.Provider value={rolesMap}>
    <div style={{ minHeight:"100vh", background:T.bg, color:T.text, fontFamily:FONT_UI, fontSize:14, display:"flex", overflowX:"hidden", position:"relative" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');
        * { box-sizing:border-box; }
        html, body { overflow-x:hidden; max-width:100vw; }
        ::-webkit-scrollbar { width:8px; height:8px; }
        ::-webkit-scrollbar-track { background:${T.bg}; }
        ::-webkit-scrollbar-thumb { background:${T.border}; border-radius:4px; }
        ::-webkit-scrollbar-thumb:hover { background:${T.borderHi}; }
        select { appearance:none; background-image:url("data:image/svg+xml;utf8,<svg fill='%237A8499' xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24'><polygon points='6,9 18,9 12,16'/></svg>"); background-repeat:no-repeat; background-position:right 8px center; padding-right:22px !important; }
        button:focus { outline:none; }
        @media (max-width:639px) {
          ::-webkit-scrollbar { width:4px; height:4px; }
        }
      `}</style>

      {/* Mobile/Tablet: fixed top bar */}
      {!bp.isDesktop && (
        <div style={{ position:"fixed", top:0, left:0, right:0, height:52, background:T.panel, borderBottom:`1px solid ${T.border}`, display:"flex", alignItems:"center", padding:"0 16px", gap:12, zIndex:150, flexShrink:0 }}>
          <button
            onClick={() => setSidebarOpen(o => !o)}
            aria-label="Toggle navigation"
            style={{ background:"none", border:"none", color:T.text, cursor:"pointer", padding:0, display:"flex", flexDirection:"column", gap:4, minWidth:44, minHeight:44, justifyContent:"center", alignItems:"center" }}>
            <span style={{ display:"block", width:18, height:2, background:T.text, borderRadius:1 }}/>
            <span style={{ display:"block", width:18, height:2, background:T.text, borderRadius:1 }}/>
            <span style={{ display:"block", width:18, height:2, background:T.text, borderRadius:1 }}/>
          </button>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <div style={{ width:20, height:20, background:T.accent, borderRadius:3, display:"flex", alignItems:"center", justifyContent:"center", fontFamily:FONT_MONO, fontWeight:600, fontSize:11, color:T.bg }}>◆</div>
            <div style={{ fontSize:13, fontWeight:600, letterSpacing:"-0.01em" }}>{BRAND.name}</div>
          </div>
          <div style={{ marginLeft:"auto", fontSize:10, color:T.textDim, fontFamily:FONT_MONO, textTransform:"uppercase", letterSpacing:"0.1em", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", maxWidth:160 }}>
            {PAGES.find(p => p.id === page)?.label}
          </div>
        </div>
      )}

      {/* Mobile/Tablet: sidebar backdrop — starts at 52px so top bar + hamburger stay tappable */}
      {!bp.isDesktop && sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          style={{ position:"fixed", top:52, left:0, right:0, bottom:0, background:"rgba(0,0,0,0.55)", zIndex:190, touchAction:"none" }}
        />
      )}

      {/* Sidebar */}
      <aside style={
        bp.isDesktop
          ? { width:230, background:T.panel, borderRight:`1px solid ${T.border}`, padding:"22px 16px", display:"flex", flexDirection:"column", flexShrink:0 }
          : { position:"fixed", top:52, left:0, bottom:0, width:"min(320px, 85vw)", background:T.panel, borderRight:`1px solid ${T.border}`, padding:"16px", display:"flex", flexDirection:"column", zIndex:200, transition:"transform 0.25s ease", overflowY:"auto", transform: sidebarOpen ? "translateX(0)" : "translateX(-100%)" }
      }>
        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:bp.isDesktop ? 32 : 20, padding:"0 6px" }}>
          <div style={{ width:22, height:22, background:T.accent, borderRadius:4, display:"flex", alignItems:"center", justifyContent:"center", fontFamily:FONT_MONO, fontWeight:600, fontSize:12, color:T.bg }}>◆</div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:13, fontWeight:600, letterSpacing:"-0.01em" }}>{BRAND.name}</div>
            <div style={{ fontSize:9, color:T.textMute, fontFamily:FONT_MONO, letterSpacing:"0.08em", textTransform:"uppercase", marginTop:1 }}>{BRAND.subtitle}</div>
          </div>
          {!bp.isDesktop && (
            <button
              onClick={() => setSidebarOpen(false)}
              aria-label="Close navigation"
              style={{ background:"none", border:"none", color:T.textMute, cursor:"pointer", fontSize:18, lineHeight:1, padding:0, minWidth:36, minHeight:36, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
              ✕
            </button>
          )}
        </div>

        <nav style={{ display:"flex", flexDirection:"column", gap:0, flex:1, overflowY:"auto" }}>
          {NAV_GROUPS.map((group, gi) => {
            const visibleItems = group.items.filter(item =>
              item.platformAdminOnly ? user?.is_platform_admin : canAccess(user?.role, item.id, rolesMap)
            );
            if (visibleItems.length === 0) return null;
            return (
              <div key={gi} style={{ marginBottom: group.label ? 6 : 8 }}>
                {group.label && (
                  <div style={{ fontSize:8, letterSpacing:"0.18em", textTransform:"uppercase", color:T.textMute, fontFamily:FONT_MONO, padding:"10px 10px 5px", fontWeight:500 }}>
                    {group.label}
                  </div>
                )}
                {visibleItems.map(item => (
                  <button key={item.id} onClick={()=>{ navigate(item.id); if(!bp.isDesktop) setSidebarOpen(false); }}
                    style={{ background:page===item.id?T.panelHi:"transparent", border:"none", color:page===item.id?T.text:T.textDim, textAlign:"left", padding:"8px 10px", fontSize:12, borderRadius:4, cursor:"pointer", fontFamily:FONT_UI, display:"flex", alignItems:"center", gap:10, borderLeft:page===item.id?`2px solid ${T.accent}`:"2px solid transparent", transition:"all 0.1s", width:"100%", minHeight:44 }}>
                    {item.label}
                    {item.id==="alerts" && critCount>0 && (
                      <span style={{ marginLeft:"auto", background:T.crit, color:T.bg, fontSize:10, fontFamily:FONT_MONO, padding:"1px 6px", borderRadius:8, fontWeight:600 }}>{critCount}</span>
                    )}
                  </button>
                ))}
              </div>
            );
          })}
        </nav>

        <div style={{ marginTop:"auto", padding:"12px 8px", display:"flex", flexDirection:"column", gap:10 }}>
          {/* Platform admin org switcher */}
          {user?.is_platform_admin && (
            <div style={{ background:T.panelHi, border:`1px solid ${T.purple ?? "#a78bfa"}`, borderRadius:6, padding:"8px 10px" }}>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:5 }}>
                <div style={{ fontSize:8, fontFamily:FONT_MONO, color:T.purple ?? "#a78bfa", textTransform:"uppercase", letterSpacing:"0.12em", fontWeight:600 }}>
                  ◆ Platform View
                </div>
                {allOrgs.filter(o => !o.is_internal).length === 0 && (
                  <button
                    onClick={() => fetchOrganizations().then(orgs => { if (orgs.length) setAllOrgs(orgs); })}
                    title="Reload organizations"
                    style={{ background:"transparent", border:"none", color:T.purple ?? "#a78bfa", fontSize:11, cursor:"pointer", padding:"0 2px", lineHeight:1 }}
                  >↻</button>
                )}
              </div>
              <select
                value={viewOrgId || ""}
                onChange={e => {
                  const v = e.target.value || null;
                  setViewOrgId(v);
                  setViewOrg(v);
                  setSidebarPopResult(null);
                  refresh();
                }}
                style={{ width:"100%", background:T.panel, border:`1px solid ${T.border}`, color:T.text, padding:"4px 6px", borderRadius:3, fontSize:11, fontFamily:FONT_MONO, cursor:"pointer" }}
              >
                <option value="">All / Platform</option>
                {allOrgs.filter(o => !o.is_internal).length === 0
                  ? <option disabled value="">loading orgs…</option>
                  : allOrgs.filter(o => !o.is_internal).map(o => (
                      <option key={o.id} value={String(o.id)}>{o.name}</option>
                    ))
                }
              </select>
              {viewOrgId && (isDemoMode() || isDevelopment()) && (
                <div style={{ marginTop:6, display:"flex", flexDirection:"column", gap:4 }}>
                  <button
                    onClick={handleSidebarPopulate}
                    disabled={sidebarPopping || sidebarClearing}
                    title="Seed realistic enterprise data: 5 teams, 5 agents, 30 days of telemetry, 10 MCP relationships, budgets"
                    style={{ width:"100%", background:T.accent, color:T.bg, border:"none", padding:"5px 8px", borderRadius:3, fontSize:10, fontFamily:FONT_MONO, fontWeight:600, cursor:"pointer", opacity:(sidebarPopping||sidebarClearing)?0.5:1, letterSpacing:"0.06em" }}>
                    {sidebarPopping ? "Populating…" : "Populate Organization"}
                  </button>
                  <button
                    onClick={handleSidebarClear}
                    disabled={sidebarPopping || sidebarClearing}
                    title="Delete all demo data (is_demo=true). Real customer data is not affected."
                    style={{ width:"100%", background:"transparent", color:T.crit, border:`1px solid ${T.crit}44`, padding:"5px 8px", borderRadius:3, fontSize:10, fontFamily:FONT_MONO, cursor:"pointer", opacity:(sidebarPopping||sidebarClearing)?0.5:1, letterSpacing:"0.06em" }}>
                    {sidebarClearing ? "Clearing…" : "Clear Demo Data"}
                  </button>
                  {sidebarPopResult && (
                    <div style={{ fontSize:9, fontFamily:FONT_MONO, color: sidebarPopResult.ok ? T.accent : T.crit, lineHeight:1.4 }}>
                      {sidebarPopResult.ok ? "✓ " : "✗ "}{sidebarPopResult.msg}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          {/* User badge */}
          {user && (
            <div style={{ background:T.panelHi, border:`1px solid ${T.border}`, borderRadius:6, padding:"8px 10px", display:"flex", alignItems:"center", gap:8 }}>
              <div style={{ width:8, height:8, borderRadius:"50%", background: rolesMap[user.role]?.color ?? T.textDim, flexShrink:0 }}/>
              <div style={{ flex:1, overflow:"hidden" }}>
                <div style={{ fontSize:12, fontWeight:500, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{user.name}</div>
                <div style={{ fontSize:9, fontFamily:FONT_MONO, color: user.is_platform_admin ? (T.purple ?? "#a78bfa") : (rolesMap[user.role]?.color ?? T.textDim), textTransform:"uppercase", letterSpacing:"0.1em" }}>
                  {user.is_platform_admin ? "platform admin" : `${user.role} · ${user.team}`}
                </div>
              </div>
              <button title="Sign out" onClick={handleLogout}
                style={{ background:"transparent", border:"none", color:T.textMute, fontSize:12, cursor:"pointer", padding:"2px 4px", lineHeight:1, fontFamily:FONT_MONO }}>⏻</button>
            </div>
          )}
          <div style={{ fontSize:10, color:T.textMute, fontFamily:FONT_MONO, letterSpacing:"0.08em", lineHeight:1.8 }}>
            {/* Demo-only status indicator — never shown in production */}
            {isDemoMode() && <div style={{ color:T.warn }}>● demo mode</div>}
            <span style={{ color:T.textMute }}>{filteredEvents.length.toLocaleString()} events / {filters.range}d</span>
            {lastRefresh && <div style={{ color:T.textMute, marginTop:2 }}>updated {lastRefresh.toLocaleTimeString()}</div>}
          </div>
          {/* Demo/live toggle is a demo control — only available in demo/dev */}
          {(isDemoMode() || isDevelopment()) && (
            <button onClick={handleToggleDemoMode} title={demoMode?"Switch to live data":"Switch to demo mode"} style={{ width:"100%", background:"transparent", border:`1px solid ${demoMode?T.warn:T.accentDim}`, color:demoMode?T.warn:T.accent, padding:"6px 10px", borderRadius:3, fontSize:10, fontFamily:FONT_MONO, cursor:"pointer", letterSpacing:"0.08em", textTransform:"uppercase" }}>{demoMode?"⇄ show live":"⇄ show demo"}</button>
          )}
          <button onClick={refresh} style={{ width:"100%", background:"transparent", border:`1px solid ${T.border}`, color:T.textDim, padding:"6px 10px", borderRadius:3, fontSize:10, fontFamily:FONT_MONO, cursor:"pointer", letterSpacing:"0.08em", textTransform:"uppercase" }}>↻ Refresh</button>
        </div>
      </aside>

      {/* Main */}
      <main style={{ flex:1, padding: bp.isMobile ? "68px 16px 24px" : bp.isTablet ? "72px 20px 24px" : "20px 28px", overflow:"auto", minWidth:0 }}>
        <header style={{ display: bp.isMobile ? "none" : "flex", alignItems:"center", justifyContent:"space-between", marginBottom:18, flexWrap:"wrap", gap:8 }}>
          <div>
            <div style={{ fontSize:11, color:T.textMute, fontFamily:FONT_MONO, letterSpacing:"0.12em", textTransform:"uppercase" }}>{page}</div>
            <h1 style={{ fontSize: bp.isTablet ? 18 : 22, fontWeight:500, margin:"4px 0 0", letterSpacing:"-0.015em" }}>{PAGES.find((p)=>p.id===page)?.label}</h1>
          </div>
          <div style={{ display:"flex", gap:10, alignItems:"center", fontFamily:FONT_MONO, fontSize:11, color:T.textDim, flexWrap:"wrap" }}>
            {user?.is_platform_admin && viewOrgId && (() => {
              const org = allOrgs.find(o => String(o.id) === String(viewOrgId));
              return org ? (
                <span style={{ display:"inline-flex", alignItems:"center", gap:5, background:"rgba(167,139,250,0.12)", border:"1px solid rgba(167,139,250,0.3)", color:T.purple ?? "#a78bfa", padding:"3px 9px", borderRadius:4, fontSize:10 }}>
                  ◆ Viewing: {org.name}
                </span>
              ) : null;
            })()}
            {platformMode && (
              <>
                <span title={GUARD_MODE_META[platformMode]?.desc}
                  style={{ display:"inline-flex", alignItems:"center", gap:5, color:GUARD_MODE_META[platformMode]?.color }}>
                  ● {(GUARD_MODE_META[platformMode]?.label || platformMode).toLowerCase()}
                </span>
                <span style={{ color:T.textMute }}>|</span>
              </>
            )}
            <span>{filters.team==="all"?"all teams":allTeams.find((t)=>t.id===filters.team)?.name}</span>
            <span style={{ color:T.textMute }}>|</span>
            <span>last {filters.range}d</span>
            {isDemoMode() && (
              <>
                <span style={{ color:T.textMute }}>|</span>
                <span style={{ color:T.warn }}>● demo</span>
              </>
            )}
            {pricingLastUpdated && (
              <>
                <span style={{ color:T.textMute }}>|</span>
                <span title="Date pricing table was last audited against provider rates" style={{ color:T.textMute }}>pricing as of {pricingLastUpdated}</span>
              </>
            )}
          </div>
        </header>

        {!["dashboard","home","agent_inventory","discovery","governance","relationship_map","security_intel","ecosystem","cost","pricing","budgets","security","chat","users","apikeys","settings","integrations","onboarding","welcome"].includes(page) && <FilterBar filters={filters} setFilters={setFilters} allTeams={allTeams} allAgents={allAgents} user={user} rolesMap={rolesMap}/>}

        {/* Admin-only: surface missing/invalid secrets detected at startup */}
        {user?.role === "admin" && secretWarnings.length > 0 && (
          <div style={{ marginBottom:16 }}>
            {secretWarnings.map((w, i) => (
              <div key={i} style={{ display:"flex", alignItems:"flex-start", gap:10, background:"rgba(239,68,68,0.08)", border:`1px solid ${T.crit}`, borderRadius:6, padding:"10px 14px", marginBottom:8 }}>
                <span style={{ color:T.crit, fontFamily:FONT_MONO, fontSize:13, flexShrink:0 }}>⚠</span>
                <div>
                  <div style={{ color:T.crit, fontFamily:FONT_MONO, fontSize:11, fontWeight:600, letterSpacing:"0.05em", textTransform:"uppercase", marginBottom:3 }}>Configuration Warning</div>
                  <div style={{ color:T.text, fontSize:12, fontFamily:FONT_MONO, lineHeight:1.5 }}>{w}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        <PageErrorBoundary key={`${page}-${demoMode}`}>{renderPage()}</PageErrorBoundary>
      </main>
    </div>
    </RolesContext.Provider>
    </UserContext.Provider>
  );
}
