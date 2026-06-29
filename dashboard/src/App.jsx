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
import { BRAND, gatewayBaseUrl } from "./config.js";
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
import { ORGS, TEAMS, AGENTS, MODELS, providerFromModel, tierFromModel, approvedModel, parseUTC, apiRecordToEvent, buildLiveMetadata, genDemoEvents } from "./data/demoData.js";
import { ALERT_META, applyFilters, runDetections, agg, estimateSavings, computeRiskScore, execSummary } from "./data/alertMeta.js";
import { useLiveData } from "./hooks/useLiveData.js";
import { UserContext, useUser, RolesContext, useRoles, ROLES, canSeePage, userCan, canAccess } from "./auth.jsx";
import CustomerWelcomePage from "./pages/PlatformGuide.jsx";
import SimpleIntegrationsPage from "./pages/Setup.jsx";
import SettingsPage, { GUARD_MODE_META } from "./pages/Settings.jsx";



// ─── Page components ──────────────────────────────────────────────────────────

function RiskScoreCard({ risk }) {
  const color = risk.score>60?T.crit:risk.score>35?T.warn:T.accent;
  const label = risk.score>60?"ELEVATED":risk.score>35?"MODERATE":"HEALTHY";
  return (
    <Card title="AI Runtime Risk Score" subtitle="Composite of 7 factors, 0–100">
      <div style={{ display:"flex", gap:20, alignItems:"center" }}>
        <div style={{ position:"relative", width:110, height:110, flexShrink:0 }}>
          <svg width="110" height="110" viewBox="0 0 110 110">
            <circle cx="55" cy="55" r="46" fill="none" stroke={T.border}  strokeWidth="6" />
            <circle cx="55" cy="55" r="46" fill="none" stroke={color} strokeWidth="6" strokeLinecap="round" strokeDasharray={`${(risk.score/100)*289} 289`} transform="rotate(-90 55 55)" />
          </svg>
          <div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center" }}>
            <div style={{ fontSize:32, fontFamily:FONT_MONO, color, fontWeight:500, lineHeight:1 }}>{risk.score}</div>
            <div style={{ fontSize:9, color:T.textMute, fontFamily:FONT_MONO, letterSpacing:"0.12em", marginTop:2 }}>/ 100</div>
          </div>
        </div>
        <div style={{ flex:1, minWidth:0 }}>
          <Pill color={color}>{label}</Pill>
          <div style={{ display:"flex", flexDirection:"column", gap:4, marginTop:10 }}>
            {risk.factors.map((f) => (
              <div key={f.label} style={{ display:"flex", alignItems:"center", gap:8, fontSize:11 }}>
                <div style={{ flex:1, fontFamily:FONT_MONO, color:T.textDim }}>{f.label}</div>
                <div style={{ width:56, height:3, background:T.border, borderRadius:2, overflow:"hidden" }}>
                  <div style={{ width:`${(f.value/f.max)*100}%`, height:"100%", background:f.value>0?color:T.border }} />
                </div>
                <div style={{ width:30, textAlign:"right", fontFamily:FONT_MONO, color:T.text }}>{f.value}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}

function SavingsCard({ savings }) {
  const items = [
    { label:"Right-sizing premium models",  val:savings.premium, note:"Route short prompts to mid-tier" },
    { label:"Stopping agent loops",         val:savings.loops,   note:"Cap retries / add termination" },
    { label:"Reducing failed workflows",    val:savings.failed,  note:"Fix upstream tool errors" },
    { label:"Optimizing slow workflows",    val:savings.latency, note:"Reduce p95 latency penalty" },
  ];
  return (
    <Card title="Potential Monthly Savings" subtitle="Estimated based on current runtime patterns">
      <div style={{ display:"flex", alignItems:"baseline", gap:12, marginBottom:14 }}>
        <div style={{ fontSize:38, fontFamily:FONT_MONO, color:T.accent, fontWeight:500, letterSpacing:"-0.02em", lineHeight:1 }}>${savings.total.toFixed(0)}</div>
        <div style={{ fontSize:12, color:T.textDim, fontFamily:FONT_MONO }}>/ month recoverable</div>
      </div>
      <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
        {items.map((it) => (
          <div key={it.label} style={{ display:"flex", alignItems:"center", gap:10, fontSize:12 }}>
            <div style={{ flex:1 }}>
              <div style={{ color:T.text }}>{it.label}</div>
              <div style={{ color:T.textMute, fontSize:11, marginTop:2 }}>{it.note}</div>
            </div>
            <div style={{ fontFamily:FONT_MONO, color:T.accent, fontWeight:500 }}>${it.val.toFixed(2)}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function ExecSummaryCard({ A, savings, risk, alerts }) {
  const s = execSummary(A, savings, risk, alerts);
  return (
    <Card title="Executive Summary" subtitle="Plain-English digest of current runtime state" style={{ background:`linear-gradient(180deg,${T.panel} 0%,${T.panelHi} 100%)` }}>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:24 }}>
        {[
          { label:"What happened",   text:s.what, color:T.info },
          { label:"Why it matters",  text:s.why,  color:T.warn },
          { label:"What to do next", text:s.next, color:T.accent },
        ].map((b) => (
          <div key={b.label}>
            <div style={{ fontFamily:FONT_MONO, fontSize:10, letterSpacing:"0.12em", textTransform:"uppercase", color:b.color, marginBottom:10, paddingBottom:8, borderBottom:`1px solid ${b.color}33` }}>{b.label}</div>
            <div style={{ fontSize:13, color:T.text, lineHeight:1.6 }}>{b.text}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

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

function CostIntel({ A, events, allTeams }) {
  const { sortKey, sortDir, toggle, sort } = useSortable("cost");
  const teamData  = Object.entries(A.costByTeam).map(([id,cost])=>({ name:allTeams.find((t)=>t.id===id)?.name||id, cost }));
  const modelData = Object.entries(A.costByModel).map(([name,cost])=>({ name, cost }));
  const COLORS    = [T.accent, T.info, T.warn, T.crit, T.purple, "#5BD9C5"];
  const wfCost    = {};
  events.forEach((e)=>{ wfCost[e.workflow]=(wfCost[e.workflow]||0)+e.cost; });
  const wfBaseRows = Object.entries(wfCost).map(([wf, cost]) => ({ wf, cost, calls: A.callsByWorkflow[wf]||0, avgCost: cost/Math.max(A.callsByWorkflow[wf]||0,1) }));
  const colKey = { "Workflow":"wf","Calls":"calls","Total cost":"cost","Avg cost/call":"avgCost" };
  const wfSorted = sort(wfBaseRows, (r, k) => r[k]);
  const { query: wfQuery, setQuery: setWfQuery, filtered: topWf } = useSearch(wfSorted, r => r.wf);
  return (
    <div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14, marginBottom:14 }}>
        <Card title="Cost by team" subtitle="Window cumulative">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={teamData} layout="vertical">
              <CartesianGrid stroke={T.border} horizontal={false}/>
              <XAxis type="number" stroke={T.textMute} style={{ fontFamily:FONT_MONO, fontSize:10 }} tickFormatter={(v)=>`$${v.toFixed(0)}`}/>
              <YAxis type="category" dataKey="name" stroke={T.textDim} style={{ fontFamily:FONT_MONO, fontSize:10 }} width={130}/>
              <Tooltip contentStyle={{ background:T.panelHi, border:`1px solid ${T.borderHi}`, borderRadius:4, fontFamily:FONT_MONO, fontSize:11 }} formatter={(v)=>[fmt$(v),"cost"]}/>
              <Bar dataKey="cost" fill={T.accent}/>
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Card title="Cost by model" subtitle="Provider mix">
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={modelData} dataKey="cost" nameKey="name" cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={2}>
                {modelData.map((_,i)=><Cell key={i} fill={COLORS[i%COLORS.length]} stroke={T.bg} strokeWidth={2}/>)}
              </Pie>
              <Tooltip contentStyle={{ background:T.panelHi, border:`1px solid ${T.borderHi}`, borderRadius:4, fontFamily:FONT_MONO, fontSize:11 }} formatter={(v)=>[fmt$(v),"cost"]}/>
            </PieChart>
          </ResponsiveContainer>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginTop:8 }}>
            {modelData.map((m,i)=>(
              <div key={m.name} style={{ fontSize:11, fontFamily:FONT_MONO, display:"flex", alignItems:"center", gap:6, color:T.textDim }}>
                <span style={{ width:8, height:8, background:COLORS[i%COLORS.length], borderRadius:1, flexShrink:0 }}/>{m.name}
              </div>
            ))}
          </div>
        </Card>
      </div>
      <Card title="Most expensive workflows" subtitle="Click a column header to sort">
        <SearchBox query={wfQuery} onChange={setWfQuery} placeholder="Search workflows…" count={topWf.length} total={wfBaseRows.length} />
        <table style={{ width:"100%", borderCollapse:"collapse" }}>
          <thead>
            <tr style={{ borderBottom:`1px solid ${T.border}` }}>
              {["Workflow","Calls","Total cost","Avg cost/call"].map((h)=>(
                <SortableTh key={h} label={h} sortKey={colKey[h]} active={sortKey===colKey[h]} dir={sortDir} onToggle={toggle} />
              ))}
            </tr>
          </thead>
          <tbody>
            {topWf.map((r)=>(
              <tr key={r.wf} style={{ borderBottom:`1px solid ${T.border}` }}>
                <td style={{ padding:"12px 8px", fontFamily:FONT_MONO, fontSize:12, color:T.text }}>{r.wf}</td>
                <td style={{ padding:"12px 8px", fontFamily:FONT_MONO, fontSize:12, color:T.textDim }}>{r.calls.toLocaleString()}</td>
                <td style={{ padding:"12px 8px", fontFamily:FONT_MONO, fontSize:12, color:T.text }}>{fmt$(r.cost)}</td>
                <td style={{ padding:"12px 8px", fontFamily:FONT_MONO, fontSize:12, color:T.textDim }}>${r.avgCost.toFixed(4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function AgentActivity({ events, allAgents, allTeams }) {
  const { sortKey, sortDir, toggle, sort } = useSortable("cost");
  const baseRows = allAgents.map((a)=>{
    const aev = events.filter((e)=>e.agent===a.id);
    const requests = aev.length;
    const cost     = aev.reduce((s,e)=>s+e.cost,0);
    const avgLat   = requests>0 ? aev.reduce((s,e)=>s+e.latency,0)/requests : 0;
    const errors   = aev.filter((e)=>e.status==="failed").length;
    const last     = aev[0]?.ts||0;
    const teamName = allTeams.find((t)=>t.id===a.team)?.name||a.team;
    return { ...a, requests, cost, avgLat, errors, last, teamName };
  });
  const colKey = { "Agent":"name","Team":"teamName","Requests":"requests","Cost":"cost","Avg latency":"avgLat","Errors":"errors","Last activity":"last" };
  const sorted = sort(baseRows, (r, k) => r[k]);
  const { query, setQuery, filtered: rows } = useSearch(sorted, r => `${r.name} ${r.teamName} ${r.id}`);
  return (
    <Card title="Agents" subtitle="Live runtime activity">
      <SearchBox query={query} onChange={setQuery} placeholder="Search agents or teams…" count={rows.length} total={baseRows.length} />
      <table style={{ width:"100%", borderCollapse:"collapse" }}>
        <thead>
          <tr style={{ borderBottom:`1px solid ${T.border}` }}>
            {["Agent","Team","Requests","Cost","Avg latency","Errors","Last activity"].map((h)=>(
              <SortableTh key={h} label={h} sortKey={colKey[h]} active={sortKey===colKey[h]} dir={sortDir} onToggle={toggle} />
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r)=>(
            <tr key={r.id} style={{ borderBottom:`1px solid ${T.border}` }}>
              <td style={{ padding:"12px 8px" }}>
                <div style={{ fontFamily:FONT_MONO, fontSize:12, color:T.text }}>{r.name}</div>
                <div style={{ fontFamily:FONT_MONO, fontSize:10, color:T.textMute, marginTop:2 }}>{r.id}</div>
              </td>
              <td style={{ padding:"12px 8px", fontSize:12, color:T.textDim }}>{r.teamName}</td>
              <td style={{ padding:"12px 8px", fontFamily:FONT_MONO, fontSize:12, color:T.text }}>{r.requests.toLocaleString()}</td>
              <td style={{ padding:"12px 8px", fontFamily:FONT_MONO, fontSize:12, color:T.text }}>{fmt$(r.cost)}</td>
              <td style={{ padding:"12px 8px", fontFamily:FONT_MONO, fontSize:12, color:r.avgLat>2000?T.warn:T.textDim }}>{Math.round(r.avgLat)}ms</td>
              <td style={{ padding:"12px 8px" }}>{r.errors>10?<Pill color={T.crit}>{r.errors}</Pill>:r.errors>0?<Pill color={T.warn}>{r.errors}</Pill>:<span style={{ fontFamily:FONT_MONO, fontSize:12, color:T.textMute }}>0</span>}</td>
              <td style={{ padding:"12px 8px", fontFamily:FONT_MONO, fontSize:12, color:T.textDim }}>{fmtTime(r.last)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function ModelUsage({ A }) {
  const { sortKey, sortDir, toggle, sort } = useSortable("cost");
  const allModelNames = [...new Set([...MODELS.map((m)=>m.name), ...Object.keys(A.costByModel)])];
  const baseRows = allModelNames.map((name)=>{
    const meta = MODELS.find((m)=>m.name===name);
    const cost  = A.costByModel[name]||0;
    const tokens= A.tokensByModel[name]||0;
    const lats  = A.latencyByModel[name]||[];
    const avgLat= lats.length>0 ? lats.reduce((s,x)=>s+x,0)/lats.length : 0;
    const p95   = lats.length>0 ? [...lats].sort((a,b)=>a-b)[Math.floor(lats.length*0.95)] : 0;
    return { name, provider:meta?.provider||providerFromModel(name), tier:meta?.tier||tierFromModel(name), approved:meta?.approved??approvedModel(name), cost, tokens, avgLat, p95, calls:lats.length };
  });
  const colKey = { "Model":"name","Provider":"provider","Tier":"tier","Approved":"approved","Calls":"calls","Tokens":"tokens","Cost":"cost","Avg latency":"avgLat","p95":"p95" };
  const sorted = sort(baseRows, (r, k) => r[k]);
  const { query, setQuery, filtered: modelRows } = useSearch(sorted, r => `${r.name} ${r.provider} ${r.tier}`);
  return (
    <Card title="Models" subtitle="Performance, spend, and governance posture">
      <SearchBox query={query} onChange={setQuery} placeholder="Search models or providers…" count={modelRows.length} total={baseRows.length} />
      <table style={{ width:"100%", borderCollapse:"collapse" }}>
        <thead>
          <tr style={{ borderBottom:`1px solid ${T.border}` }}>
            {["Model","Provider","Tier","Approved","Calls","Tokens","Cost","Avg latency","p95"].map((h)=>(
              <SortableTh key={h} label={h} sortKey={colKey[h]} active={sortKey===colKey[h]} dir={sortDir} onToggle={toggle} />
            ))}
          </tr>
        </thead>
        <tbody>
          {modelRows.map((m)=>(
            <tr key={m.name} style={{ borderBottom:`1px solid ${T.border}` }}>
              <td style={{ padding:"12px 8px", fontFamily:FONT_MONO, fontSize:12, color:T.text }}>{m.name}</td>
              <td style={{ padding:"12px 8px", fontSize:12, color:T.textDim }}>{m.provider}</td>
              <td style={{ padding:"12px 8px" }}><Pill color={m.tier==="premium"?T.warn:m.tier==="mid"?T.info:T.accent}>{m.tier}</Pill></td>
              <td style={{ padding:"12px 8px" }}>{m.approved?<Pill color={T.accent}>yes</Pill>:<Pill color={T.crit}>no</Pill>}</td>
              <td style={{ padding:"12px 8px", fontFamily:FONT_MONO, fontSize:12, color:T.text }}>{m.calls.toLocaleString()}</td>
              <td style={{ padding:"12px 8px", fontFamily:FONT_MONO, fontSize:12, color:T.text }}>{fmtK(m.tokens)}</td>
              <td style={{ padding:"12px 8px", fontFamily:FONT_MONO, fontSize:12, color:T.text }}>{fmt$(m.cost)}</td>
              <td style={{ padding:"12px 8px", fontFamily:FONT_MONO, fontSize:12, color:T.textDim }}>{Math.round(m.avgLat)}ms</td>
              <td style={{ padding:"12px 8px", fontFamily:FONT_MONO, fontSize:12, color:m.p95>3000?T.warn:T.textDim }}>{Math.round(m.p95)}ms</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function WorkflowHealth({ A, events }) {
  const { sortKey, sortDir, toggle, sort } = useSortable("rate");
  const baseRows = Object.keys(A.callsByWorkflow).map((wf)=>{
    const calls = A.callsByWorkflow[wf];
    const fails = A.failsByWorkflow[wf]||0;
    const cost  = events.filter((e)=>e.workflow===wf).reduce((s,e)=>s+e.cost,0);
    return { wf, calls, fails, rate:fails/calls, cost };
  });
  const colKey = { "Workflow":"wf","Calls":"calls","Failures":"fails","Rate":"rate","Cost":"cost","Status":"rate" };
  const sorted = sort(baseRows, (r, k) => r[k]);
  const { query, setQuery, filtered: rows } = useSearch(sorted, r => r.wf);
  return (
    <Card title="Workflow health" subtitle="Failure rate & spend per workflow">
      <SearchBox query={query} onChange={setQuery} placeholder="Search workflows…" count={rows.length} total={baseRows.length} />
      <table style={{ width:"100%", borderCollapse:"collapse" }}>
        <thead>
          <tr style={{ borderBottom:`1px solid ${T.border}` }}>
            {["Workflow","Calls","Failures","Rate","Cost","Status"].map((h)=>(
              <SortableTh key={h} label={h} sortKey={colKey[h]} active={sortKey===colKey[h]} dir={sortDir} onToggle={toggle} />
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r)=>(
            <tr key={r.wf} style={{ borderBottom:`1px solid ${T.border}` }}>
              <td style={{ padding:"12px 8px", fontFamily:FONT_MONO, fontSize:12, color:T.text }}>{r.wf}</td>
              <td style={{ padding:"12px 8px", fontFamily:FONT_MONO, fontSize:12, color:T.text }}>{r.calls.toLocaleString()}</td>
              <td style={{ padding:"12px 8px", fontFamily:FONT_MONO, fontSize:12, color:r.fails>0?T.warn:T.textDim }}>{r.fails}</td>
              <td style={{ padding:"12px 8px", fontFamily:FONT_MONO, fontSize:12, color:r.rate>0.2?T.crit:r.rate>0.05?T.warn:T.textDim }}>{(r.rate*100).toFixed(1)}%</td>
              <td style={{ padding:"12px 8px", fontFamily:FONT_MONO, fontSize:12, color:T.text }}>{fmt$(r.cost)}</td>
              <td style={{ padding:"12px 8px" }}>{r.rate>0.2?<Pill color={T.crit}>degraded</Pill>:r.rate>0.05?<Pill color={T.warn}>warning</Pill>:<Pill color={T.accent}>healthy</Pill>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
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


// ─── Assets Page ─────────────────────────────────────────────────────────────
function AssetsPage() {
  const T2 = T;
  const [assets,   setAssets]   = useState(null);
  const [summary,  setSummary]  = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [telRows,  setTelRows]  = useState({});
  const [telLoading, setTelLoading] = useState({});
  const [lastRefresh, setLastRefresh] = useState(null);

  // Filters
  const [search,    setSearch]   = useState("");
  const [fTeam,     setFTeam]    = useState("");
  const [fStatus,   setFStatus]  = useState("");
  const [fRisk,     setFRisk]    = useState("");
  const [sortBy,    setSortBy]   = useState("monthly_cost_usd");
  const [sortOrder, setSortOrder] = useState("desc");
  const [days,      setDays]     = useState(90);

  // New lifecycle / governance filters
  const [fLifecycle,    setFLifecycle]    = useState("");
  const [fEnvironment,  setFEnvironment]  = useState("");
  const [includeRetired, setIncludeRetired] = useState(false);

  // Tab state
  const [activeTab,   setActiveTab]   = useState("inventory");
  const [unassigned,  setUnassigned]  = useState([]);

  // Claim modal state
  const [claimTarget, setClaimTarget] = useState(null);
  const [claimForm,   setClaimForm]   = useState({ owner: "", team: "", environment: "prod", criticality: "medium", business_purpose: "", agent_name: "" });
  const [claimSaving, setClaimSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const params = { sort_by: sortBy, order: sortOrder, days };
      if (search)  params.search  = search;
      if (fTeam)   params.team    = fTeam;
      if (fStatus) params.status  = fStatus;
      if (fRisk)   params.risk    = fRisk;
      if (fLifecycle)    params.lifecycle_status = fLifecycle;
      if (fEnvironment)  params.environment      = fEnvironment;
      if (includeRetired) params.include_retired = true;
      const [a, s] = await Promise.all([
        fetchAssets(params),
        fetchAssetsSummary(days),
      ]);
      setAssets(Array.isArray(a) ? a : []);
      setSummary(s);
      setLastRefresh(new Date());
    } catch(e) {
      setError(e.message);
      setAssets([]);
    } finally {
      setLoading(false);
    }
  }, [search, fTeam, fStatus, fRisk, fLifecycle, fEnvironment, includeRetired, sortBy, sortOrder, days]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [load]);

  const loadUnassigned = useCallback(async () => {
    try {
      const data = await fetchUnassignedAssets();
      setUnassigned(Array.isArray(data) ? data : []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (activeTab === "unassigned") {
      loadUnassigned();
    }
  }, [activeTab, loadUnassigned]);

  const loadTelemetry = async (agentName) => {
    if (telRows[agentName]) return;
    setTelLoading(l => ({ ...l, [agentName]: true }));
    try {
      const data = await fetchAssetTelemetry(agentName, { limit: 20, days });
      setTelRows(r => ({ ...r, [agentName]: data }));
    } catch { /* ignore */ } finally {
      setTelLoading(l => ({ ...l, [agentName]: false }));
    }
  };

  const toggleRow = (name) => {
    if (expanded === name) {
      setExpanded(null);
    } else {
      setExpanded(name);
      loadTelemetry(name);
    }
  };

  const handleSort = (field) => {
    if (sortBy === field) {
      setSortOrder(o => o === "desc" ? "asc" : "desc");
    } else {
      setSortBy(field);
      setSortOrder("desc");
    }
  };

  const riskColor = (r) => r === "high" ? T2.crit : r === "medium" ? T2.warn : T2.accent;
  const statusColor = (s) => s === "active" ? T2.accent : s === "dormant" ? T2.warn : T2.textMute;

  const lifecycleBadge = (ls) => {
    const cfg = {
      managed:    { color: T2.accent,   label: "Managed" },
      unassigned: { color: T2.warn,     label: "Unassigned" },
      retired:    { color: T2.textMute, label: "Retired" },
    }[ls || "unassigned"] || { color: T2.textMute, label: ls || "—" };
    return <span style={{ fontSize: 10, fontWeight: 600, color: cfg.color, background: `${cfg.color}18`, padding: "2px 8px", borderRadius: 10 }}>{cfg.label}</span>;
  };

  const cell = { padding: "10px 12px", fontSize: 12, fontFamily: FONT_MONO, borderBottom: `1px solid ${T2.border}` };
  const hdr  = { ...cell, fontSize: 11, color: T2.textDim, cursor: "pointer", userSelect: "none", textTransform: "uppercase", letterSpacing: "0.08em" };

  const sortArrow = (field) => sortBy === field ? (sortOrder === "desc" ? " ↓" : " ↑") : "";

  const uniqueTeams = [...new Set((assets || []).map(a => a.team).filter(Boolean))].sort();

  const unassignedCount = (assets || []).filter(a => a.lifecycle_status === "unassigned").length;
  const managedCount    = (assets || []).filter(a => a.lifecycle_status === "managed").length;

  const openClaimModal = (a) => {
    setClaimForm({
      owner:            a.owner            || "",
      team:             a.team             || "",
      environment:      a.environment      || "prod",
      criticality:      a.criticality      || "medium",
      business_purpose: a.business_purpose || "",
      agent_name:       a.agent_name       || a.agent_id_raw || "",
    });
    setClaimTarget(a.agent_name || a.agent_id_raw);
  };

  const handleClaim = async () => {
    setClaimSaving(true);
    try {
      await claimAsset(claimTarget, claimForm);
      setClaimTarget(null);
      await load();
      if (activeTab === "unassigned") await loadUnassigned();
    } catch(e) {
      alert(`Failed to claim asset: ${e.message}`);
    } finally {
      setClaimSaving(false);
    }
  };

  return (
    <div style={{ padding: 24, fontFamily: FONT_UI }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.02em" }}>AI Agent Inventory</div>
          <div style={{ fontSize: 12, color: T2.textDim, marginTop: 2, fontFamily: FONT_MONO }}>
            Which agents exist · who owns them · what they cost · how they're governed
            {lastRefresh && <span style={{ marginLeft: 12, color: T2.textMute }}>· refreshed {lastRefresh.toLocaleTimeString()}</span>}
          </div>
        </div>
        <button onClick={load} disabled={loading}
          style={{ background: `${T2.accent}15`, border: `1px solid ${T2.accent}55`, color: T2.accent,
            padding: "7px 14px", borderRadius: 5, fontSize: 11, fontFamily: FONT_MONO,
            cursor: loading ? "default" : "pointer", opacity: loading ? 0.5 : 1, letterSpacing: "0.06em" }}>
          {loading ? "Loading…" : "↺ Refresh"}
        </button>
      </div>

      {/* Tab Bar */}
      <div style={{ display: "flex", gap: 4, marginBottom: 20, borderBottom: `1px solid ${T2.border}`, paddingBottom: 0 }}>
        {[
          { key: "inventory",  label: `Inventory (${(assets || []).length})` },
          { key: "unassigned", label: `Unassigned (${unassignedCount})` },
        ].map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            style={{
              background: activeTab === tab.key ? T2.panel : "transparent",
              border: `1px solid ${activeTab === tab.key ? T2.border : "transparent"}`,
              borderBottom: activeTab === tab.key ? `1px solid ${T2.panel}` : `1px solid ${T2.border}`,
              color: activeTab === tab.key ? T2.text : T2.textDim,
              padding: "8px 16px", fontSize: 12, fontFamily: FONT_MONO,
              cursor: "pointer", borderRadius: "5px 5px 0 0", marginBottom: -1,
              fontWeight: activeTab === tab.key ? 600 : 400,
            }}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* KPI Cards */}
      {summary && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginBottom: 24 }}>
          {[
            { label: "Total Agents",   value: summary.total_agents,       color: T2.text },
            { label: "Active",         value: summary.active_agents,      color: T2.accent },
            { label: "Dormant",        value: summary.dormant_agents,     color: T2.warn },
            { label: "Inactive",       value: summary.inactive_agents,    color: T2.textMute },
            { label: "High Risk",      value: summary.high_risk_agents,   color: T2.crit },
            { label: "Monthly Cost",   value: `$${(summary.monthly_cost_usd || 0).toFixed(2)}`, color: T2.purple },
            { label: "Total Cost",     value: `$${(summary.total_cost_usd || 0).toFixed(2)}`,   color: T2.textDim },
            { label: "Unassigned",     value: unassignedCount,            color: T2.warn },
            { label: "Managed",        value: managedCount,               color: T2.accent },
          ].map(({ label, value, color }) => (
            <div key={label} style={{ background: T2.panel, border: `1px solid ${T2.border}`, borderRadius: 8, padding: "14px 16px" }}>
              <div style={{ fontSize: 10, color: T2.textMute, fontFamily: FONT_MONO, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>{label}</div>
              <div style={{ fontSize: 22, fontWeight: 600, color, fontFamily: FONT_MONO }}>{value}</div>
            </div>
          ))}
        </div>
      )}

      {activeTab === "inventory" && (
        <>
          {/* Filters */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
            <input
              placeholder="Search agents or teams…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ background: T2.panel, border: `1px solid ${T2.border}`, color: T2.text, borderRadius: 5, padding: "7px 10px", fontSize: 12, fontFamily: FONT_MONO, minWidth: 200, outline: "none" }}
            />
            <select value={fTeam} onChange={e => setFTeam(e.target.value)}
              style={{ background: T2.panel, border: `1px solid ${T2.border}`, color: fTeam ? T2.text : T2.textDim, borderRadius: 5, padding: "7px 10px", fontSize: 12, fontFamily: FONT_MONO }}>
              <option value="">All teams</option>
              {uniqueTeams.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <select value={fStatus} onChange={e => setFStatus(e.target.value)}
              style={{ background: T2.panel, border: `1px solid ${T2.border}`, color: fStatus ? T2.text : T2.textDim, borderRadius: 5, padding: "7px 10px", fontSize: 12, fontFamily: FONT_MONO }}>
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="dormant">Dormant</option>
              <option value="inactive">Inactive</option>
            </select>
            <select value={fRisk} onChange={e => setFRisk(e.target.value)}
              style={{ background: T2.panel, border: `1px solid ${T2.border}`, color: fRisk ? T2.text : T2.textDim, borderRadius: 5, padding: "7px 10px", fontSize: 12, fontFamily: FONT_MONO }}>
              <option value="">All risk levels</option>
              <option value="high">High risk</option>
              <option value="medium">Medium risk</option>
              <option value="low">Low risk</option>
            </select>
            <select value={fLifecycle} onChange={e => setFLifecycle(e.target.value)}
              style={{ background: T2.panel, border: `1px solid ${T2.border}`, color: fLifecycle ? T2.text : T2.textDim, borderRadius: 5, padding: "7px 10px", fontSize: 12, fontFamily: FONT_MONO }}>
              <option value="">All lifecycle</option>
              <option value="unassigned">Unassigned</option>
              <option value="managed">Managed</option>
              <option value="retired">Retired</option>
            </select>
            <select value={fEnvironment} onChange={e => setFEnvironment(e.target.value)}
              style={{ background: T2.panel, border: `1px solid ${T2.border}`, color: fEnvironment ? T2.text : T2.textDim, borderRadius: 5, padding: "7px 10px", fontSize: 12, fontFamily: FONT_MONO }}>
              <option value="">All environments</option>
              <option value="prod">prod</option>
              <option value="staging">staging</option>
              <option value="dev">dev</option>
            </select>
            <select value={days} onChange={e => setDays(Number(e.target.value))}
              style={{ background: T2.panel, border: `1px solid ${T2.border}`, color: T2.text, borderRadius: 5, padding: "7px 10px", fontSize: 12, fontFamily: FONT_MONO }}>
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
            </select>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontFamily: FONT_MONO, color: T2.textDim, cursor: "pointer" }}>
              <input type="checkbox" checked={includeRetired} onChange={e => setIncludeRetired(e.target.checked)}
                style={{ accentColor: T2.accent }} />
              Include retired
            </label>
            {(search || fTeam || fStatus || fRisk || fLifecycle || fEnvironment || includeRetired) && (
              <button onClick={() => { setSearch(""); setFTeam(""); setFStatus(""); setFRisk(""); setFLifecycle(""); setFEnvironment(""); setIncludeRetired(false); }}
                style={{ background: "transparent", border: `1px solid ${T2.border}`, color: T2.textDim, borderRadius: 5, padding: "7px 12px", fontSize: 12, fontFamily: FONT_MONO, cursor: "pointer" }}>
                Clear filters
              </button>
            )}
          </div>

          {/* Error */}
          {error && (
            <div style={{ background: `${T2.crit}15`, border: `1px solid ${T2.crit}44`, borderRadius: 6, padding: "10px 14px", marginBottom: 16, color: T2.crit, fontSize: 12, fontFamily: FONT_MONO }}>
              Error loading assets: {error}
            </div>
          )}

          {/* Table */}
          <div style={{ background: T2.panel, border: `1px solid ${T2.border}`, borderRadius: 8, overflow: "hidden" }}>
            {loading && !assets ? (
              <div style={{ padding: 40, textAlign: "center", color: T2.textMute, fontFamily: FONT_MONO }}>Loading agents…</div>
            ) : !assets || assets.length === 0 ? (
              <div style={{ padding: 40, textAlign: "center", color: T2.textMute, fontFamily: FONT_MONO, lineHeight: 1.7 }}>
                No agents discovered yet.<br/>
                Send your first request through the gateway and we'll discover agents automatically.
              </div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${T2.borderHi}` }}>
                    <th style={hdr} onClick={() => handleSort("agent_name")}>Agent{sortArrow("agent_name")}</th>
                    <th style={hdr}>Lifecycle</th>
                    <th style={hdr}>Team</th>
                    <th style={hdr} onClick={() => handleSort("status")}>Status{sortArrow("status")}</th>
                    <th style={hdr} onClick={() => handleSort("risk")}>Risk{sortArrow("risk")}</th>
                    <th style={{ ...hdr, textAlign: "right" }} onClick={() => handleSort("monthly_cost_usd")}>30d Cost{sortArrow("monthly_cost_usd")}</th>
                    <th style={{ ...hdr, textAlign: "right" }} onClick={() => handleSort("total_calls")}>Calls{sortArrow("total_calls")}</th>
                    <th style={hdr} onClick={() => handleSort("last_seen")}>Last Seen{sortArrow("last_seen")}</th>
                    <th style={hdr}>Signals</th>
                    <th style={{ ...hdr, cursor: "default" }}></th>
                  </tr>
                </thead>
                <tbody>
                  {assets.map((a) => {
                    const isExpanded = expanded === a.agent_name;
                    const lastSeen = new Date(a.last_seen);
                    const daysAgo = Math.floor((Date.now() - lastSeen.getTime()) / 86400000);
                    const lastSeenStr = daysAgo === 0 ? "today" : daysAgo === 1 ? "yesterday" : `${daysAgo}d ago`;
                    const sig = a.signals || {};
                    return (
                      <React.Fragment key={a.agent_name}>
                        <tr
                          onClick={() => toggleRow(a.agent_name)}
                          style={{ cursor: "pointer", background: isExpanded ? T2.panelHi : "transparent",
                            transition: "background 0.1s" }}
                          onMouseEnter={e => { if (!isExpanded) e.currentTarget.style.background = `${T2.panelHi}88`; }}
                          onMouseLeave={e => { if (!isExpanded) e.currentTarget.style.background = "transparent"; }}
                        >
                          <td style={cell}>
                            <span style={{ color: T2.text, fontWeight: 500 }}>{a.agent_name}</span>
                          </td>
                          <td style={cell}>{lifecycleBadge(a.lifecycle_status)}</td>
                          <td style={{ ...cell, color: T2.textDim }}>{a.team || "—"}</td>
                          <td style={cell}>
                            <span style={{ color: statusColor(a.status), fontSize: 11, fontWeight: 600,
                              background: `${statusColor(a.status)}18`, padding: "2px 8px", borderRadius: 10 }}>
                              {a.status}
                            </span>
                          </td>
                          <td style={cell}>
                            <span style={{ color: riskColor(a.risk), fontSize: 11, fontWeight: 600,
                              background: `${riskColor(a.risk)}18`, padding: "2px 8px", borderRadius: 10 }}>
                              {a.risk}
                            </span>
                          </td>
                          <td style={{ ...cell, textAlign: "right", color: a.monthly_cost_usd > 1 ? T2.warn : T2.text }}>
                            ${(a.monthly_cost_usd || 0).toFixed(4)}
                          </td>
                          <td style={{ ...cell, textAlign: "right", color: T2.textDim }}>
                            {(a.total_calls || 0).toLocaleString()}
                          </td>
                          <td style={{ ...cell, color: T2.textDim }}>{lastSeenStr}</td>
                          <td style={cell}>
                            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                              {sig.has_blocked && <span style={{ fontSize: 10, background: `${T2.warn}22`, color: T2.warn, padding: "1px 6px", borderRadius: 8, fontFamily: FONT_MONO }}>blocked</span>}
                              {sig.has_loop && <span style={{ fontSize: 10, background: `${T2.crit}22`, color: T2.crit, padding: "1px 6px", borderRadius: 8, fontFamily: FONT_MONO }}>loop</span>}
                              {sig.after_hours_calls > 5 && <span style={{ fontSize: 10, background: `${T2.info}22`, color: T2.info, padding: "1px 6px", borderRadius: 8, fontFamily: FONT_MONO }}>after-hours</span>}
                            </div>
                          </td>
                          <td style={{ ...cell, color: T2.textDim, fontSize: 14 }}>
                            {isExpanded ? "▲" : "▼"}
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr>
                            <td colSpan={10} style={{ background: `${T2.panelHi}`, borderBottom: `1px solid ${T2.border}`, padding: 0 }}>
                              <div style={{ padding: "16px 20px" }}>
                                {/* Details grid — 8 cells */}
                                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 16 }}>
                                  {[
                                    { label: "First Seen",       value: new Date(a.first_seen).toLocaleDateString() },
                                    { label: "Total Cost",       value: `$${(a.total_cost_usd || 0).toFixed(4)}` },
                                    { label: "Total Tokens",     value: (a.total_tokens || 0).toLocaleString() },
                                    { label: "Models Used",      value: (a.models_used || []).join(", ") || "—" },
                                    { label: "Owner",            value: a.owner || "Unassigned" },
                                    { label: "Environment",      value: a.environment || "Unknown" },
                                    { label: "Criticality",      value: a.criticality || "—" },
                                    { label: "Business Purpose", value: a.business_purpose || "—" },
                                  ].map(({ label, value }) => (
                                    <div key={label} style={{ background: T2.panel, border: `1px solid ${T2.border}`, borderRadius: 6, padding: "10px 12px" }}>
                                      <div style={{ fontSize: 10, color: T2.textMute, fontFamily: FONT_MONO, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>{label}</div>
                                      <div style={{ fontSize: 12, color: T2.text, fontFamily: FONT_MONO, wordBreak: "break-all" }}>{value}</div>
                                    </div>
                                  ))}
                                </div>

                                {/* Runtime Hints */}
                                <div style={{ marginBottom: 12 }}>
                                  <div style={{ fontSize: 10, color: T2.textMute, fontFamily: FONT_MONO, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>
                                    Runtime Hints · from telemetry headers, not canonical
                                  </div>
                                  <div style={{ display: "flex", gap: 16, fontSize: 11, fontFamily: FONT_MONO, color: T2.textMute }}>
                                    <span>team_raw: <span style={{ color: T2.textDim }}>{a.signals?.team_raw || "—"}</span></span>
                                    <span>environment_raw: <span style={{ color: T2.textDim }}>{a.signals?.environment_raw || "—"}</span></span>
                                    <span>asset_key: <span style={{ color: T2.textDim, fontFamily: FONT_MONO, fontSize: 10 }}>{(a.asset_key || "").slice(0, 16)}…</span></span>
                                  </div>
                                </div>

                                {/* Claim button */}
                                {a.lifecycle_status !== "managed" && (
                                  <div style={{ marginBottom: 16 }}>
                                    <button
                                      onClick={e => { e.stopPropagation(); openClaimModal(a); }}
                                      style={{ background: `${T2.accent}18`, border: `1px solid ${T2.accent}55`, color: T2.accent,
                                        padding: "6px 14px", borderRadius: 5, fontSize: 11, fontFamily: FONT_MONO,
                                        cursor: "pointer", letterSpacing: "0.06em" }}>
                                      Claim This Asset
                                    </button>
                                  </div>
                                )}

                                {/* Risk signals detail */}
                                <div style={{ marginBottom: 16 }}>
                                  <div style={{ fontSize: 11, color: T2.textMute, fontFamily: FONT_MONO, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>Risk Signals</div>
                                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                                    {sig.has_blocked && (
                                      <div style={{ background: `${T2.warn}15`, border: `1px solid ${T2.warn}44`, borderRadius: 6, padding: "6px 12px", fontSize: 12, color: T2.warn, fontFamily: FONT_MONO }}>
                                        {sig.blocked_count} blocked requests
                                      </div>
                                    )}
                                    {sig.has_loop && (
                                      <div style={{ background: `${T2.crit}15`, border: `1px solid ${T2.crit}44`, borderRadius: 6, padding: "6px 12px", fontSize: 12, color: T2.crit, fontFamily: FONT_MONO }}>
                                        Loop: {sig.loop_max_window} calls in 5-min window
                                      </div>
                                    )}
                                    {sig.after_hours_calls > 0 && (
                                      <div style={{ background: `${T2.info}15`, border: `1px solid ${T2.info}44`, borderRadius: 6, padding: "6px 12px", fontSize: 12, color: T2.info, fontFamily: FONT_MONO }}>
                                        {sig.after_hours_calls} after-hours calls
                                      </div>
                                    )}
                                    {!sig.has_blocked && !sig.has_loop && sig.after_hours_calls <= 0 && (
                                      <div style={{ color: T2.textMute, fontSize: 12, fontFamily: FONT_MONO }}>No risk signals detected</div>
                                    )}
                                  </div>
                                </div>

                                {/* Recent telemetry */}
                                <div>
                                  <div style={{ fontSize: 11, color: T2.textMute, fontFamily: FONT_MONO, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>Recent Calls</div>
                                  {telLoading[a.agent_name] ? (
                                    <div style={{ color: T2.textMute, fontSize: 12, fontFamily: FONT_MONO }}>Loading…</div>
                                  ) : telRows[a.agent_name] ? (
                                    <div style={{ overflowX: "auto" }}>
                                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, fontFamily: FONT_MONO }}>
                                        <thead>
                                          <tr>
                                            {["Timestamp", "Model", "Tokens", "Cost", "Latency", "Flags"].map(h => (
                                              <th key={h} style={{ textAlign: "left", padding: "4px 10px", color: T2.textMute, borderBottom: `1px solid ${T2.border}`, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em" }}>{h}</th>
                                            ))}
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {(telRows[a.agent_name].items || []).map(r => (
                                            <tr key={r.id}>
                                              <td style={{ padding: "4px 10px", color: T2.textDim }}>{new Date(r.timestamp).toLocaleString()}</td>
                                              <td style={{ padding: "4px 10px", color: T2.text }}>{r.model}</td>
                                              <td style={{ padding: "4px 10px", color: T2.textDim }}>{(r.total_tokens || 0).toLocaleString()}</td>
                                              <td style={{ padding: "4px 10px", color: T2.textDim }}>${(r.cost_usd || 0).toFixed(5)}</td>
                                              <td style={{ padding: "4px 10px", color: T2.textDim }}>{Math.round(r.latency_ms)}ms</td>
                                              <td style={{ padding: "4px 10px" }}>
                                                {r.blocked   && <span style={{ color: T2.warn, marginRight: 4, fontSize: 10, background: `${T2.warn}22`, padding: "1px 6px", borderRadius: 8, fontFamily: FONT_MONO }}>blocked</span>}
                                                {(() => { const h = new Date(r.timestamp).getHours(); return (h < 7 || h >= 20); })() && <span style={{ color: T2.info, fontSize: 10, background: `${T2.info}22`, padding: "1px 6px", borderRadius: 8, fontFamily: FONT_MONO }}>after-hrs</span>}
                                              </td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                      {telRows[a.agent_name].total > 20 && (
                                        <div style={{ color: T2.textMute, fontSize: 11, padding: "6px 10px" }}>
                                          Showing 20 of {telRows[a.agent_name].total} calls
                                        </div>
                                      )}
                                    </div>
                                  ) : null}
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
          </div>

          {assets && assets.length > 0 && (
            <div style={{ marginTop: 8, fontSize: 11, color: T2.textMute, fontFamily: FONT_MONO }}>
              {assets.length} agent{assets.length !== 1 ? "s" : ""} · auto-refreshes every 30s
            </div>
          )}
        </>
      )}

      {activeTab === "unassigned" && (
        <div style={{ background: T2.panel, border: `1px solid ${T2.border}`, borderRadius: 8, overflow: "hidden" }}>
          {unassigned.length === 0 ? (
            <div style={{ padding: 40, textAlign: "center", color: T2.textMute, fontFamily: FONT_MONO }}>
              No unassigned assets in the discovery queue.
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${T2.borderHi}` }}>
                  <th style={hdr}>Agent ID</th>
                  <th style={hdr}>First Seen</th>
                  <th style={{ ...hdr, cursor: "default" }}></th>
                </tr>
              </thead>
              <tbody>
                {unassigned.map((u, idx) => (
                  <tr key={u.agent_id_raw || idx}
                    style={{ borderBottom: `1px solid ${T2.border}` }}
                    onMouseEnter={e => { e.currentTarget.style.background = `${T2.panelHi}88`; }}
                    onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}>
                    <td style={{ ...cell, color: T2.text, fontWeight: 500 }}>{u.agent_id_raw}</td>
                    <td style={{ ...cell, color: T2.textDim }}>{u.first_seen_at ? new Date(u.first_seen_at).toLocaleDateString() : "—"}</td>
                    <td style={cell}>
                      <button
                        onClick={() => openClaimModal({ agent_name: u.agent_id_raw, agent_id_raw: u.agent_id_raw })}
                        style={{ background: `${T2.accent}18`, border: `1px solid ${T2.accent}55`, color: T2.accent,
                          padding: "4px 12px", borderRadius: 5, fontSize: 11, fontFamily: FONT_MONO, cursor: "pointer" }}>
                        Claim
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Claim Modal */}
      {claimTarget !== null && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={e => { if (e.target === e.currentTarget) setClaimTarget(null); }}>
          <div style={{ background: T2.panel, border: `1px solid ${T2.border}`, borderRadius: 10, padding: 32, width: "100%", maxWidth: 800, fontFamily: FONT_UI, maxHeight: "90vh", overflowY: "auto" }}>
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 20, letterSpacing: "-0.01em" }}>
              Claim Agent: <span style={{ color: T2.accent, fontFamily: FONT_MONO }}>{claimTarget}</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
              <div>
                <label style={{ display: "block", fontSize: 10, color: T2.textMute, fontFamily: FONT_MONO, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>Display Name (agent_name)</label>
                <input value={claimForm.agent_name} onChange={e => setClaimForm(f => ({ ...f, agent_name: e.target.value }))}
                  style={{ width: "100%", background: T2.bg, border: `1px solid ${T2.border}`, color: T2.text, borderRadius: 5, padding: "8px 10px", fontSize: 12, fontFamily: FONT_MONO, outline: "none", boxSizing: "border-box" }} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 10, color: T2.textMute, fontFamily: FONT_MONO, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>Owner <span style={{ color: T2.crit }}>*</span></label>
                <input value={claimForm.owner} onChange={e => setClaimForm(f => ({ ...f, owner: e.target.value }))}
                  placeholder="e.g. platform-team"
                  style={{ width: "100%", background: T2.bg, border: `1px solid ${T2.border}`, color: T2.text, borderRadius: 5, padding: "8px 10px", fontSize: 12, fontFamily: FONT_MONO, outline: "none", boxSizing: "border-box" }} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 10, color: T2.textMute, fontFamily: FONT_MONO, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>Team</label>
                <input value={claimForm.team} onChange={e => setClaimForm(f => ({ ...f, team: e.target.value }))}
                  placeholder="e.g. engineering"
                  style={{ width: "100%", background: T2.bg, border: `1px solid ${T2.border}`, color: T2.text, borderRadius: 5, padding: "8px 10px", fontSize: 12, fontFamily: FONT_MONO, outline: "none", boxSizing: "border-box" }} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 10, color: T2.textMute, fontFamily: FONT_MONO, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>Environment</label>
                <select value={claimForm.environment} onChange={e => setClaimForm(f => ({ ...f, environment: e.target.value }))}
                  style={{ width: "100%", background: T2.bg, border: `1px solid ${T2.border}`, color: T2.text, borderRadius: 5, padding: "8px 10px", fontSize: 12, fontFamily: FONT_MONO, outline: "none", boxSizing: "border-box" }}>
                  <option value="prod">prod</option>
                  <option value="staging">staging</option>
                  <option value="dev">dev</option>
                  <option value="unknown">unknown</option>
                </select>
              </div>
              <div>
                <label style={{ display: "block", fontSize: 10, color: T2.textMute, fontFamily: FONT_MONO, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>Criticality</label>
                <select value={claimForm.criticality} onChange={e => setClaimForm(f => ({ ...f, criticality: e.target.value }))}
                  style={{ width: "100%", background: T2.bg, border: `1px solid ${T2.border}`, color: T2.text, borderRadius: 5, padding: "8px 10px", fontSize: 12, fontFamily: FONT_MONO, outline: "none", boxSizing: "border-box" }}>
                  <option value="critical">critical</option>
                  <option value="high">high</option>
                  <option value="medium">medium</option>
                  <option value="low">low</option>
                </select>
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <label style={{ display: "block", fontSize: 10, color: T2.textMute, fontFamily: FONT_MONO, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>Business Purpose</label>
                <textarea value={claimForm.business_purpose} onChange={e => setClaimForm(f => ({ ...f, business_purpose: e.target.value }))}
                  rows={3} placeholder="Describe the purpose of this agent…"
                  style={{ width: "100%", background: T2.bg, border: `1px solid ${T2.border}`, color: T2.text, borderRadius: 5, padding: "8px 10px", fontSize: 12, fontFamily: FONT_MONO, outline: "none", resize: "vertical", boxSizing: "border-box" }} />
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button onClick={() => setClaimTarget(null)}
                style={{ background: "transparent", border: `1px solid ${T2.border}`, color: T2.textDim,
                  padding: "8px 18px", borderRadius: 5, fontSize: 12, fontFamily: FONT_MONO, cursor: "pointer" }}>
                Cancel
              </button>
              <button onClick={handleClaim} disabled={claimSaving || !claimForm.owner}
                style={{ background: `${T2.accent}22`, border: `1px solid ${T2.accent}66`, color: T2.accent,
                  padding: "8px 18px", borderRadius: 5, fontSize: 12, fontFamily: FONT_MONO,
                  cursor: claimSaving || !claimForm.owner ? "default" : "pointer",
                  opacity: claimSaving || !claimForm.owner ? 0.5 : 1 }}>
                {claimSaving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Customer Welcome / Platform Guide ───────────────────────────────────────
// ─── Nav ──────────────────────────────────────────────────────────────────────
// PAGES: flat list for canAccess checks + header label lookup (includes legacy)
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
  const [discoveryInitialTab, setDiscoveryInitialTab] = useState("verified");
  const [filters, setFilters] = useState({ team:"all", model:"all", agent:"all", sev:"all", range:30 });

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
      case "dashboard":      return <ExecutiveDashboard onNavigate={setPage} />;
      case "welcome":        return <CustomerWelcomePage onNavigate={setPage} />;
      case "agent_inventory":return <AgentInventory isAdmin={user?.role === "admin"} onNavigate={(pg, opts={}) => { if (opts.discoveryTab) setDiscoveryInitialTab(opts.discoveryTab); setPage(pg); }} />;
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
      case "apikeys":   return <ApiKeysPage />;
      case "settings":      return <SettingsPage />;
      // ── Legacy pages (still routable, removed from primary nav) ────────
      case "home":           return <Home onNavigate={setPage} />;
      case "chat":           return <ChatPage />;
      case "assets":    return <AssetsPage />;
      case "overview":  return <Overview  {...pageProps} />;
      case "agents":    return <AgentActivity {...pageProps} />;
      case "models":    return <ModelUsage A={A} />;
      case "workflows": return <WorkflowHealth {...pageProps} />;
      case "alerts":    return <AlertsPage alerts={alerts} sevFilter={filters.sev} />;
      case "integrations":  return <SimpleIntegrationsPage onNavigate={setPage} />;
      case "onboarding":    return <OnboardingPage onNavigate={setPage} />;
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
    <div style={{ minHeight:"100vh", background:T.bg, color:T.text, fontFamily:FONT_UI, fontSize:14, display:"flex" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');
        * { box-sizing:border-box; }
        ::-webkit-scrollbar { width:8px; height:8px; }
        ::-webkit-scrollbar-track { background:${T.bg}; }
        ::-webkit-scrollbar-thumb { background:${T.border}; border-radius:4px; }
        ::-webkit-scrollbar-thumb:hover { background:${T.borderHi}; }
        select { appearance:none; background-image:url("data:image/svg+xml;utf8,<svg fill='%237A8499' xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24'><polygon points='6,9 18,9 12,16'/></svg>"); background-repeat:no-repeat; background-position:right 8px center; padding-right:22px !important; }
        button:focus { outline:none; }
      `}</style>

      {/* Sidebar */}
      <aside style={{ width:230, background:T.panel, borderRight:`1px solid ${T.border}`, padding:"22px 16px", display:"flex", flexDirection:"column", flexShrink:0 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:32, padding:"0 6px" }}>
          <div style={{ width:22, height:22, background:T.accent, borderRadius:4, display:"flex", alignItems:"center", justifyContent:"center", fontFamily:FONT_MONO, fontWeight:600, fontSize:12, color:T.bg }}>◆</div>
          <div>
            <div style={{ fontSize:13, fontWeight:600, letterSpacing:"-0.01em" }}>{BRAND.name}</div>
            <div style={{ fontSize:9, color:T.textMute, fontFamily:FONT_MONO, letterSpacing:"0.08em", textTransform:"uppercase", marginTop:1 }}>{BRAND.subtitle}</div>
          </div>
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
                  <button key={item.id} onClick={()=>setPage(item.id)}
                    style={{ background:page===item.id?T.panelHi:"transparent", border:"none", color:page===item.id?T.text:T.textDim, textAlign:"left", padding:"8px 10px", fontSize:12, borderRadius:4, cursor:"pointer", fontFamily:FONT_UI, display:"flex", alignItems:"center", gap:10, borderLeft:page===item.id?`2px solid ${T.accent}`:"2px solid transparent", transition:"all 0.1s", width:"100%" }}>
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
      <main style={{ flex:1, padding:"20px 28px", overflow:"auto" }}>
        <header style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:18 }}>
          <div>
            <div style={{ fontSize:11, color:T.textMute, fontFamily:FONT_MONO, letterSpacing:"0.12em", textTransform:"uppercase" }}>{page}</div>
            <h1 style={{ fontSize:22, fontWeight:500, margin:"4px 0 0", letterSpacing:"-0.015em" }}>{PAGES.find((p)=>p.id===page)?.label}</h1>
          </div>
          <div style={{ display:"flex", gap:10, alignItems:"center", fontFamily:FONT_MONO, fontSize:11, color:T.textDim }}>
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
