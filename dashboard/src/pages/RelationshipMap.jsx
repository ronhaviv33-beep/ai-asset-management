import { useState, useEffect, useMemo } from 'react'
import { fetchRelationships } from '../api.js'
import { relationshipEvidenceLabel } from '../discoveryStatus.js'

// ── Design tokens ──────────────────────────────────────────────────────────────
const T = {
  bg:       '#0F1117',
  panel:    '#171B26',
  panelHi:  '#1E2330',
  border:   '#2A2F3E',
  borderHi: '#3A4055',
  text:     '#E8EAF0',
  textDim:  '#8B91A8',
  textMute: '#555D78',
  accent:   '#6FA8FF',
  success:  '#4CAF82',
  warn:     '#FFB547',
  crit:     '#FF5C7A',
  purple:   '#B47AFF',
  teal:     '#5BD9C5',
  info:     '#5BA3FF',
}
const FONT_MONO = "'JetBrains Mono', 'Fira Code', monospace"
const FONT_SANS = "'Inter', system-ui, sans-serif"

// ── Type colours & icons ──────────────────────────────────────────────────────
const TYPE_META = {
  agent:      { color: T.accent,   icon: '🤖', label: 'Agent' },
  mcp_tool:   { color: T.teal,     icon: '🔧', label: 'MCP Tool' },
  mcp_server: { color: T.purple,   icon: '🖧',  label: 'MCP Server' },
  workflow:   { color: T.warn,     icon: '⚡', label: 'Workflow' },
  api:        { color: T.info,     icon: '🌐', label: 'API' },
  database:   { color: T.success,  icon: '🗄',  label: 'Database' },
  crm:        { color: '#FF8C69',  icon: '📋', label: 'CRM' },
  spreadsheet:{ color: '#69FF8C',  icon: '📊', label: 'Spreadsheet' },
  provider:   { color: T.accent,   icon: '◈',  label: 'Provider' },
  model:      { color: T.purple,   icon: '⊞',  label: 'Model' },
  gateway:    { color: T.success,  icon: '⊕',  label: 'Gateway' },
  unknown:    { color: T.textMute, icon: '?',  label: 'Unknown' },
}

const REL_META = {
  calls:            { color: T.info,    label: 'calls' },
  uses_tool:        { color: T.teal,    label: 'uses tool' },
  invokes_workflow: { color: T.warn,    label: 'triggers workflow' },
  triggers:         { color: T.warn,    label: 'triggers' },
  writes_to:        { color: T.crit,    label: 'writes to' },
  reads_from:       { color: T.success, label: 'reads from' },
  sends_event_to:   { color: T.purple,  label: 'sends event to' },
  uses_provider:    { color: T.accent,  label: 'uses provider' },
  uses_model:       { color: T.purple,  label: 'uses model' },
  routes_via:       { color: T.success, label: 'routes via' },
}

const TARGET_TYPE_OPTIONS = [
  { value: '',           label: 'All types' },
  { value: 'provider',  label: 'Provider' },
  { value: 'model',     label: 'Model' },
  { value: 'gateway',   label: 'Gateway' },
  { value: 'mcp_tool',  label: 'MCP Tool' },
  { value: 'mcp_server',label: 'MCP Server' },
  { value: 'workflow',  label: 'Workflow' },
  { value: 'api',       label: 'API' },
  { value: 'database',  label: 'Database' },
  { value: 'crm',       label: 'CRM' },
  { value: 'spreadsheet', label: 'Spreadsheet' },
  { value: 'unknown',   label: 'Unknown' },
]

const REL_TYPE_OPTIONS = [
  { value: '',                label: 'All relationships' },
  { value: 'uses_provider',   label: 'uses provider' },
  { value: 'uses_model',      label: 'uses model' },
  { value: 'routes_via',      label: 'routes via' },
  { value: 'calls',           label: 'calls' },
  { value: 'uses_tool',       label: 'uses tool' },
  { value: 'invokes_workflow',label: 'invokes workflow' },
  { value: 'triggers',        label: 'triggers' },
  { value: 'writes_to',       label: 'writes to' },
  { value: 'reads_from',      label: 'reads from' },
  { value: 'sends_event_to',  label: 'sends event to' },
]

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtDate(iso) {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    const now = Date.now()
    const diff = now - d.getTime()
    if (diff < 60000)  return 'just now'
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
    return d.toLocaleDateString()
  } catch { return iso }
}

function TypeBadge({ type }) {
  const m = TYPE_META[type] || TYPE_META.unknown
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 8px', borderRadius: 3,
      fontSize: 10, fontFamily: FONT_MONO, letterSpacing: '0.06em', textTransform: 'uppercase',
      background: `${m.color}18`, color: m.color, border: `1px solid ${m.color}33`,
    }}>
      {m.icon} {m.label}
    </span>
  )
}

function RelBadge({ type }) {
  const m = REL_META[type] || { color: T.textDim, label: type }
  return (
    <span style={{
      padding: '2px 7px', borderRadius: 3,
      fontSize: 10, fontFamily: FONT_MONO, letterSpacing: '0.06em',
      background: `${m.color}18`, color: m.color, border: `1px solid ${m.color}33`,
    }}>
      {m.label}
    </span>
  )
}

function StrengthBadge({ rel }) {
  const ev = relationshipEvidenceLabel(rel)
  return (
    <span title={ev.why}
      style={{ padding: '2px 8px', borderRadius: 3, fontSize: 10, fontFamily: FONT_MONO,
        background: `${ev.color}18`, color: ev.color, border: `1px solid ${ev.color}33`, whiteSpace: 'nowrap' }}>
      {ev.label}
    </span>
  )
}

function Select({ value, onChange, options }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      style={{
        background: T.panel, border: `1px solid ${T.border}`, color: T.text,
        padding: '6px 10px', borderRadius: 4, fontSize: 11, fontFamily: FONT_MONO,
        cursor: 'pointer', outline: 'none',
      }}
    >
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function RelationshipMap() {
  const [rows, setRows]           = useState([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState(null)
  const [targetType, setTargetType]       = useState('')
  const [relType, setRelType]             = useState('')
  const [sourceFilter, setSourceFilter]   = useState('')

  useEffect(() => {
    setLoading(true)
    setError(null)
    fetchRelationships()
      .then(data => { setRows(data); setLoading(false) })
      .catch(e  => { setError(e.message); setLoading(false) })
  }, [])

  const filtered = useMemo(() => {
    return rows.filter(r => {
      if (targetType && r.target_type !== targetType) return false
      if (relType    && r.relationship_type !== relType) return false
      if (sourceFilter) {
        const q = sourceFilter.toLowerCase()
        if (!r.source_agent_name.toLowerCase().includes(q)) return false
      }
      return true
    })
  }, [rows, targetType, relType, sourceFilter])

  const sourceAgents = useMemo(() => {
    const s = new Set(rows.map(r => r.source_agent_name))
    return Array.from(s).sort()
  }, [rows])

  return (
    <div style={{ background: T.bg, minHeight: '100vh', padding: 24, fontFamily: FONT_SANS }}>

      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 11, fontFamily: FONT_MONO, letterSpacing: '0.14em', textTransform: 'uppercase', color: T.textMute, marginBottom: 6 }}>
          System of Record · Runtime Dependency Map
        </div>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600, color: T.text }}>
          Runtime Dependency Map
        </h1>
        <p style={{ margin: '6px 0 0', fontSize: 13, color: T.textDim, maxWidth: 600 }}>
          We don't only discover AI agents. We map what they touch — every MCP server, tool, workflow, API, database, and CRM they interact with at runtime.
        </p>
      </div>

      {/* Field legend */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10,
        marginBottom: 20, padding: '14px 16px',
        background: T.panel, border: `1px solid ${T.border}`, borderRadius: 6,
      }}>
        {[
          { label: 'Source Agent',     desc: 'The AI agent that initiated the interaction' },
          { label: 'Target System',    desc: 'MCP tool, server, API, database, CRM, or workflow called' },
          { label: 'Relationship Type',desc: 'How the agent interacts — calls, uses_tool, writes_to…' },
          { label: 'Evidence Source',  desc: 'What signal proved this link — gateway, mcp_headers, sdk…' },
          { label: 'Strength',         desc: 'How strong the evidence is for this relationship — Strong, Likely, Observed, or Partial' },
          { label: 'Last Seen',        desc: 'When this interaction was last observed in live traffic' },
          { label: 'Request Count',    desc: 'Total times this agent-to-target link has been observed' },
        ].map(({ label, desc }) => (
          <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 10, fontFamily: FONT_MONO, letterSpacing: '0.08em', textTransform: 'uppercase', color: T.accent, fontWeight: 600 }}>{label}</span>
            <span style={{ fontSize: 11, color: T.textDim, lineHeight: 1.5 }}>{desc}</span>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{
        display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center',
        marginBottom: 20, padding: '14px 16px',
        background: T.panel, border: `1px solid ${T.border}`, borderRadius: 6,
      }}>
        <span style={{ fontSize: 10, fontFamily: FONT_MONO, letterSpacing: '0.1em', textTransform: 'uppercase', color: T.textMute }}>
          Filter
        </span>
        <input
          placeholder="Source agent…"
          value={sourceFilter}
          onChange={e => setSourceFilter(e.target.value)}
          style={{
            background: T.bg, border: `1px solid ${T.border}`, color: T.text,
            padding: '6px 10px', borderRadius: 4, fontSize: 11, fontFamily: FONT_MONO,
            outline: 'none', width: 180,
          }}
        />
        <Select value={targetType} onChange={setTargetType} options={TARGET_TYPE_OPTIONS} />
        <Select value={relType}    onChange={setRelType}    options={REL_TYPE_OPTIONS} />
        {(targetType || relType || sourceFilter) && (
          <button
            onClick={() => { setTargetType(''); setRelType(''); setSourceFilter('') }}
            style={{
              background: 'transparent', border: `1px solid ${T.border}`, color: T.textDim,
              padding: '5px 12px', borderRadius: 4, fontSize: 10, fontFamily: FONT_MONO,
              cursor: 'pointer', letterSpacing: '0.08em', textTransform: 'uppercase',
            }}
          >
            Clear
          </button>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 11, fontFamily: FONT_MONO, color: T.textMute }}>
          {filtered.length} of {rows.length} relationships
        </span>
      </div>

      {/* Content */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: T.textMute, fontFamily: FONT_MONO, fontSize: 12 }}>
          Loading relationships…
        </div>
      ) : error ? (
        <div style={{ textAlign: 'center', padding: 60, color: T.crit, fontFamily: FONT_MONO, fontSize: 12 }}>
          Error: {error}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState />
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: T.textMute, fontFamily: FONT_MONO, fontSize: 12 }}>
          No relationships match the current filters.
        </div>
      ) : (
        <RelationshipTable rows={filtered} />
      )}
    </div>
  )
}

// ── Empty state ───────────────────────────────────────────────────────────────
function EmptyState() {
  return (
    <div style={{
      background: T.panel, border: `1px solid ${T.border}`, borderRadius: 8,
      padding: '48px 32px', textAlign: 'center',
    }}>
      <div style={{ fontSize: 36, marginBottom: 16 }}>🔗</div>
      <div style={{ fontSize: 16, fontWeight: 600, color: T.text, marginBottom: 8 }}>
        No external tool dependencies detected yet
      </div>
      <div style={{ fontSize: 13, color: T.textDim, maxWidth: 560, margin: '0 auto 6px', lineHeight: 1.6 }}>
        Provider and model relationships appear automatically once traffic flows.
        MCP relationships appear when tool metadata is observed.
      </div>
      <div style={{ fontSize: 13, color: T.textMute, maxWidth: 560, margin: '0 auto 24px', lineHeight: 1.6 }}>
        To capture richer tool/workflow links, add relationship headers to your gateway requests.
      </div>
      <div style={{
        background: T.bg, border: `1px solid ${T.border}`, borderRadius: 6,
        padding: '16px 20px', textAlign: 'left', display: 'inline-block', maxWidth: 480,
      }}>
        <div style={{ fontSize: 10, fontFamily: FONT_MONO, letterSpacing: '0.1em', textTransform: 'uppercase', color: T.textMute, marginBottom: 10 }}>
          Example — MCP tool call
        </div>
        {[
          ['X-Agent-Name',     'sales-enrichment-agent'],
          ['X-MCP-Server',     'hubspot-mcp'],
          ['X-MCP-Tool',       'create_lead'],
          ['X-Agent-Relation', 'uses_tool'],
        ].map(([k, v]) => (
          <div key={k} style={{ display: 'flex', gap: 8, marginBottom: 4, fontFamily: FONT_MONO, fontSize: 11 }}>
            <span style={{ color: T.accent }}>{k}:</span>
            <span style={{ color: T.textDim }}>{v}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Table ─────────────────────────────────────────────────────────────────────
const HEADERS = [
  'Source Agent', 'Relationship Type', 'Target Type', 'Target System', 'Evidence Source', 'Strength', 'Request Count', 'Last Seen',
]

function RelationshipTable({ rows }) {
  const [expanded, setExpanded] = useState(null)

  return (
    <div style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 6, overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: `1px solid ${T.border}` }}>
            {HEADERS.map(h => (
              <th key={h} style={{
                padding: '10px 14px', textAlign: 'left',
                fontSize: 10, fontFamily: FONT_MONO, letterSpacing: '0.1em',
                textTransform: 'uppercase', color: T.textMute, fontWeight: 500,
                whiteSpace: 'nowrap',
              }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const isOpen = expanded === r.id
            return [
              <tr
                key={r.id}
                onClick={() => setExpanded(isOpen ? null : r.id)}
                style={{
                  borderBottom: `1px solid ${T.border}`,
                  background: isOpen ? T.panelHi : i % 2 === 0 ? 'transparent' : `${T.bg}66`,
                  cursor: 'pointer',
                  transition: 'background 0.12s',
                }}
              >
                <td style={{ padding: '12px 14px' }}>
                  <div style={{ fontFamily: FONT_MONO, fontSize: 12, color: T.text, fontWeight: 500 }}>
                    {r.source_agent_name}
                  </div>
                </td>
                <td style={{ padding: '12px 14px' }}>
                  <RelBadge type={r.relationship_type} />
                </td>
                <td style={{ padding: '12px 14px' }}>
                  <TypeBadge type={r.target_type} />
                </td>
                <td style={{ padding: '12px 14px' }}>
                  <div style={{ fontFamily: FONT_MONO, fontSize: 12, color: T.text }}>{r.target_name}</div>
                  {r.target_identifier && (
                    <div style={{ fontFamily: FONT_MONO, fontSize: 10, color: T.textMute, marginTop: 2 }}>
                      {r.target_identifier}
                    </div>
                  )}
                </td>
                <td style={{ padding: '12px 14px' }}>
                  <span style={{ fontFamily: FONT_MONO, fontSize: 10, color: T.textDim }}>
                    {r.evidence_source}
                  </span>
                </td>
                <td style={{ padding: '12px 14px' }}>
                  <StrengthBadge rel={r} />
                </td>
                <td style={{ padding: '12px 14px' }}>
                  <span style={{ fontFamily: FONT_MONO, fontSize: 12, color: T.text }}>
                    {r.request_count.toLocaleString()}
                  </span>
                </td>
                <td style={{ padding: '12px 14px' }}>
                  <span style={{ fontFamily: FONT_MONO, fontSize: 11, color: T.textDim }}>
                    {fmtDate(r.last_seen_at)}
                  </span>
                </td>
              </tr>,
              isOpen && r.metadata && Object.keys(r.metadata).length > 0 && (
                <tr key={`${r.id}-detail`} style={{ background: T.panelHi, borderBottom: `1px solid ${T.border}` }}>
                  <td colSpan={HEADERS.length} style={{ padding: '10px 14px 14px 14px' }}>
                    <div style={{ fontSize: 10, fontFamily: FONT_MONO, letterSpacing: '0.1em', textTransform: 'uppercase', color: T.textMute, marginBottom: 8 }}>
                      Metadata
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 20px' }}>
                      {Object.entries(r.metadata).map(([k, v]) => (
                        <div key={k} style={{ fontFamily: FONT_MONO, fontSize: 11 }}>
                          <span style={{ color: T.textMute }}>{k}: </span>
                          <span style={{ color: T.textDim }}>{String(v)}</span>
                        </div>
                      ))}
                    </div>
                    <div style={{ display: 'flex', gap: 20, marginTop: 10, fontSize: 11, fontFamily: FONT_MONO, color: T.textMute }}>
                      <span>First seen: {fmtDate(r.first_seen_at)}</span>
                    </div>
                  </td>
                </tr>
              ),
            ]
          })}
        </tbody>
      </table>
    </div>
  )
}
