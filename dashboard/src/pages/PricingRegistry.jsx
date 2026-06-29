import { useState, useEffect, useCallback } from 'react'
import {
  fetchPricingRegistry,
  fetchPricingModelHistory,
  fetchPricingStatus,
  overridePricing,
  triggerPricingSync,
  fetchPricingSyncStatus,
} from '../api.js'

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
}
const FONT_MONO = "'JetBrains Mono', 'Fira Code', monospace"
const FONT_SANS = "'Inter', system-ui, sans-serif"

const PROVIDER_COLORS = {
  openai:    T.accent,
  anthropic: T.purple,
  google:    T.teal,
  local:     T.textDim,
  bedrock:   T.warn,
  azure:     '#00BFFF',
  custom:    T.success,
  unknown:   T.textMute,
  fallback:  T.textMute,
}

const SOURCE_LABELS = {
  builtin:       { label: 'Built-in',  color: T.textDim  },
  sync:          { label: 'Synced',    color: T.success   },
  admin_override:{ label: 'Override',  color: T.warn      },
  fallback:      { label: 'Fallback',  color: T.crit      },
}

// ── Formatters ─────────────────────────────────────────────────────────────────
const fmtCPM = (v) => v == null ? '—' : `$${(+v).toFixed(2)}`
const fmtAge = (h) => {
  if (h == null) return '—'
  if (h < 1)    return `${Math.round(h * 60)}m`
  if (h < 24)   return `${h.toFixed(0)}h`
  return `${(h / 24).toFixed(1)}d`
}
const fmtDatetime = (iso) => {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
         ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
}

// ── Small components ───────────────────────────────────────────────────────────
function Card({ title, subtitle, action, children, style = {} }) {
  return (
    <div style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 8, padding: 16, ...style }}>
      {(title || action) && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: subtitle ? 2 : 12 }}>
          {title && <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: T.textDim, fontFamily: FONT_MONO }}>{title}</div>}
          {action}
        </div>
      )}
      {subtitle && <div style={{ fontSize: 11, color: T.textMute, marginBottom: 12 }}>{subtitle}</div>}
      {children}
    </div>
  )
}

function Chip({ label, color = T.textDim }) {
  return (
    <span style={{ padding: '2px 8px', borderRadius: 3, background: `${color}22`, border: `1px solid ${color}55`, color, fontSize: 10, fontFamily: FONT_MONO, letterSpacing: '0.05em' }}>
      {label}
    </span>
  )
}

function StatusDot({ ok, size = 8 }) {
  return <span style={{ display: 'inline-block', width: size, height: size, borderRadius: '50%', background: ok ? T.success : T.crit, flexShrink: 0 }} />
}

// ── Warning banner ─────────────────────────────────────────────────────────────
function WarningBanner({ warnings }) {
  if (!warnings || warnings.length === 0) return null
  const levelColor = { critical: T.crit, warning: T.warn, info: T.accent }
  const levelIcon  = { critical: '●', warning: '◆', info: '○' }
  return (
    <div style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 8, padding: 14, marginBottom: 12 }}>
      <div style={{ fontSize: 11, fontFamily: FONT_MONO, color: T.textDim, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>Pricing Status</div>
      {warnings.map((w, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
          <span style={{ color: levelColor[w.level] || T.textDim, fontSize: 10, marginTop: 1 }}>{levelIcon[w.level] || '○'}</span>
          <span style={{ fontSize: 12, color: T.textDim }}>{w.message}</span>
        </div>
      ))}
    </div>
  )
}

// ── Sync status card ───────────────────────────────────────────────────────────
function SyncStatusCard({ syncStatus, onSync, syncing }) {
  const ss = syncStatus || {}
  return (
    <Card
      title="Sync Status"
      action={
        <button onClick={onSync} disabled={syncing || ss.is_running} style={{
          padding: '5px 12px', fontSize: 11, fontFamily: FONT_MONO, cursor: 'pointer',
          background: 'none', border: `1px solid ${T.accent}`, borderRadius: 4, color: T.accent,
        }}>
          {(syncing || ss.is_running) ? 'Syncing…' : 'Sync Now'}
        </button>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div>
          <div style={{ fontSize: 10, color: T.textMute, fontFamily: FONT_MONO, marginBottom: 2 }}>LAST SYNC</div>
          <div style={{ fontSize: 12, color: T.text }}>{ss.last_sync_at ? fmtDatetime(ss.last_sync_at) : 'Never'}</div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: T.textMute, fontFamily: FONT_MONO, marginBottom: 2 }}>NEXT SYNC</div>
          <div style={{ fontSize: 12, color: T.text }}>{ss.next_sync_at ? fmtDatetime(ss.next_sync_at) : '—'}</div>
        </div>
      </div>
      {ss.results && Object.entries(ss.results).length > 0 && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${T.border}` }}>
          <div style={{ fontSize: 10, color: T.textMute, fontFamily: FONT_MONO, marginBottom: 6 }}>LAST RESULTS</div>
          {Object.entries(ss.results).map(([provider, r]) => (
            <div key={provider} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <StatusDot ok={r.status === 'ok'} size={6} />
              <span style={{ fontSize: 11, color: PROVIDER_COLORS[provider] || T.text, fontFamily: FONT_MONO, minWidth: 80 }}>{provider}</span>
              <span style={{ fontSize: 11, color: T.textDim }}>{r.models_updated} checked · {r.prices_changed} changed</span>
              {r.error && <span style={{ fontSize: 10, color: T.crit }}>{r.error}</span>}
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

// ── Price history drawer ───────────────────────────────────────────────────────
function HistoryDrawer({ provider, model, onClose }) {
  const [history, setHistory] = useState(null)
  const [err, setErr] = useState(null)

  useEffect(() => {
    fetchPricingModelHistory(provider, model)
      .then(d => setHistory(d.history))
      .catch(e => setErr(e.message))
  }, [provider, model])

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
      <div style={{ background: T.panel, border: `1px solid ${T.borderHi}`, borderRadius: 8, padding: 24, width: 'min(560px, calc(100vw - 32px))', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: T.text }}>{model}</div>
            <div style={{ fontSize: 12, color: T.textMute }}>{provider}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: T.textMute, cursor: 'pointer', fontSize: 18 }}>✕</button>
        </div>
        {err  && <div style={{ color: T.crit, fontSize: 12 }}>{err}</div>}
        {!history && !err && <div style={{ color: T.textMute, fontSize: 12 }}>Loading…</div>}
        {history && (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${T.border}` }}>
                {['Ver', 'Input /M', 'Output /M', 'From', 'To', 'Source', 'Status'].map(h => (
                  <th key={h} style={{ padding: '6px 8px', textAlign: 'left', fontSize: 10, fontFamily: FONT_MONO, color: T.textMute, textTransform: 'uppercase' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {history.map(h => (
                <tr key={h.version} style={{ borderBottom: `1px solid ${T.border}`, opacity: h.is_active ? 1 : 0.55 }}>
                  <td style={{ padding: '8px', fontFamily: FONT_MONO, fontSize: 12, color: h.is_active ? T.accent : T.textDim }}>v{h.version}</td>
                  <td style={{ padding: '8px', fontFamily: FONT_MONO, fontSize: 12, color: T.text }}>{fmtCPM(h.input_cost_per_million)}</td>
                  <td style={{ padding: '8px', fontFamily: FONT_MONO, fontSize: 12, color: T.text }}>{fmtCPM(h.output_cost_per_million)}</td>
                  <td style={{ padding: '8px', fontSize: 11, color: T.textDim }}>{h.effective_from ? new Date(h.effective_from).toLocaleDateString() : '—'}</td>
                  <td style={{ padding: '8px', fontSize: 11, color: T.textMute }}>{h.effective_to ? new Date(h.effective_to).toLocaleDateString() : '—'}</td>
                  <td style={{ padding: '8px' }}><Chip label={SOURCE_LABELS[h.source]?.label || h.source} color={SOURCE_LABELS[h.source]?.color || T.textDim} /></td>
                  <td style={{ padding: '8px' }}>{h.is_active ? <Chip label="active" color={T.success} /> : <Chip label="superseded" color={T.textMute} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {history?.[0]?.override_reason && (
          <div style={{ marginTop: 12, fontSize: 12, color: T.textMute }}>Override reason: {history[0].override_reason}</div>
        )}
      </div>
    </div>
  )
}

// ── Override modal ─────────────────────────────────────────────────────────────
const PROVIDERS = ['openai', 'anthropic', 'google', 'bedrock', 'azure', 'local', 'custom']

function OverrideModal({ prefill, onClose, onSubmit, saving }) {
  const [form, setForm] = useState({
    provider:         prefill?.provider || 'openai',
    model:            prefill?.model_name || '',
    input_cost:       prefill?.input_cost_per_million?.toString() || '',
    output_cost:      prefill?.output_cost_per_million?.toString() || '',
    cache_read_cost:  '',
    cache_write_cost: '',
    reason:           '',
  })
  const [err, setErr] = useState(null)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  async function handleSubmit(e) {
    e.preventDefault()
    setErr(null)
    const inp = parseFloat(form.input_cost)
    const out = parseFloat(form.output_cost)
    if (!form.model.trim()) { setErr('Model name is required.'); return }
    if (isNaN(inp) || inp < 0) { setErr('Invalid input cost.'); return }
    if (isNaN(out) || out < 0) { setErr('Invalid output cost.'); return }
    if (!form.reason.trim()) { setErr('Reason is required for audit trail.'); return }
    try {
      await onSubmit({
        provider:         form.provider,
        model:            form.model.trim(),
        input_cost:       inp,
        output_cost:      out,
        cache_read_cost:  form.cache_read_cost ? parseFloat(form.cache_read_cost) : undefined,
        cache_write_cost: form.cache_write_cost ? parseFloat(form.cache_write_cost) : undefined,
        reason:           form.reason.trim(),
      })
    } catch (e) {
      setErr(e.message)
    }
  }

  const inputStyle = {
    width: '100%', padding: '7px 10px', background: T.bg, border: `1px solid ${T.border}`,
    borderRadius: 4, color: T.text, fontSize: 12, fontFamily: FONT_MONO, boxSizing: 'border-box',
  }
  const labelStyle = { fontSize: 11, color: T.textDim, marginBottom: 4, display: 'block', fontFamily: FONT_MONO }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
      <div style={{ background: T.panel, border: `1px solid ${T.borderHi}`, borderRadius: 8, padding: 24, width: 'min(440px, calc(100vw - 32px))', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: T.text }}>Pricing Override</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: T.textMute, cursor: 'pointer', fontSize: 18 }}>✕</button>
        </div>
        <div style={{ fontSize: 12, color: T.textMute, marginBottom: 14 }}>
          Creates an immutable new version. The previous active version is archived. Applies to your org only.
        </div>
        {err && <div style={{ background: `${T.crit}18`, border: `1px solid ${T.crit}`, borderRadius: 4, padding: '8px 12px', marginBottom: 12, fontSize: 12, color: T.crit }}>{err}</div>}
        <form onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={labelStyle}>Provider</label>
              <select value={form.provider} onChange={e => set('provider', e.target.value)} style={{ ...inputStyle, textTransform: 'capitalize' }}>
                {PROVIDERS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Model Name</label>
              <input value={form.model} onChange={e => set('model', e.target.value)} placeholder="gpt-4o" style={inputStyle} required />
            </div>
            <div>
              <label style={labelStyle}>Input Cost (per 1M tokens)</label>
              <input type="number" step="0.001" min="0" value={form.input_cost} onChange={e => set('input_cost', e.target.value)} placeholder="5.00" style={inputStyle} required />
            </div>
            <div>
              <label style={labelStyle}>Output Cost (per 1M tokens)</label>
              <input type="number" step="0.001" min="0" value={form.output_cost} onChange={e => set('output_cost', e.target.value)} placeholder="15.00" style={inputStyle} required />
            </div>
            <div>
              <label style={labelStyle}>Cache Read (optional)</label>
              <input type="number" step="0.001" min="0" value={form.cache_read_cost} onChange={e => set('cache_read_cost', e.target.value)} placeholder="1.25" style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Cache Write (optional)</label>
              <input type="number" step="0.001" min="0" value={form.cache_write_cost} onChange={e => set('cache_write_cost', e.target.value)} placeholder="5.00" style={inputStyle} />
            </div>
            <div style={{ gridColumn: '1/-1' }}>
              <label style={labelStyle}>Reason (required for audit) *</label>
              <input value={form.reason} onChange={e => set('reason', e.target.value)} placeholder="e.g. Enterprise contract — 10% discount" style={inputStyle} required />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose} disabled={saving} style={{ padding: '7px 16px', background: 'none', border: `1px solid ${T.border}`, borderRadius: 4, color: T.textDim, cursor: 'pointer', fontSize: 12 }}>Cancel</button>
            <button type="submit" disabled={saving} style={{ padding: '7px 16px', background: T.warn, border: 'none', borderRadius: 4, color: T.bg, fontWeight: 600, cursor: 'pointer', fontSize: 12 }}>
              {saving ? 'Applying…' : 'Apply Override'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Main pricing table ─────────────────────────────────────────────────────────
function PricingTable({ rows, onHistory, onOverride, filterProvider, search }) {
  const filtered = rows.filter(r => {
    if (filterProvider && filterProvider !== 'all' && r.provider !== filterProvider) return false
    if (search) {
      const q = search.toLowerCase()
      if (!r.model_name.toLowerCase().includes(q) && !r.provider.toLowerCase().includes(q)) return false
    }
    return true
  })

  if (filtered.length === 0) {
    return <div style={{ padding: '32px 0', textAlign: 'center', color: T.textMute, fontSize: 13 }}>No pricing records found.</div>
  }

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr style={{ borderBottom: `1px solid ${T.border}` }}>
          {['Provider', 'Model', 'Input /M', 'Output /M', 'Cache Read', 'Age', 'Ver', 'Source', 'Actions'].map(h => (
            <th key={h} style={{ padding: '6px 8px', textAlign: 'left', fontSize: 10, fontFamily: FONT_MONO, color: T.textMute, letterSpacing: '0.06em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {filtered.map(r => {
          const sl = SOURCE_LABELS[r.source] || { label: r.source, color: T.textDim }
          const ageH = r.age_hours
          const ageColor = ageH == null ? T.textMute : ageH >= 48 ? T.crit : ageH >= 24 ? T.warn : T.success
          return (
            <tr key={r.id} style={{ borderBottom: `1px solid ${T.border}` }}>
              <td style={{ padding: '9px 8px' }}>
                <span style={{ fontSize: 11, fontFamily: FONT_MONO, color: PROVIDER_COLORS[r.provider] || T.text, textTransform: 'capitalize' }}>{r.provider}</span>
              </td>
              <td style={{ padding: '9px 8px' }}>
                <div style={{ fontSize: 12, fontFamily: FONT_MONO, color: T.text }}>{r.model_name}</div>
                {r.is_override && <div style={{ fontSize: 10, color: T.warn }}>org override</div>}
              </td>
              <td style={{ padding: '9px 8px', fontFamily: FONT_MONO, fontSize: 12, color: T.text }}>{fmtCPM(r.input_cost_per_million)}</td>
              <td style={{ padding: '9px 8px', fontFamily: FONT_MONO, fontSize: 12, color: T.text }}>{fmtCPM(r.output_cost_per_million)}</td>
              <td style={{ padding: '9px 8px', fontFamily: FONT_MONO, fontSize: 12, color: T.textDim }}>{r.cache_read_cost_per_million ? fmtCPM(r.cache_read_cost_per_million) : '—'}</td>
              <td style={{ padding: '9px 8px' }}>
                <span style={{ fontSize: 11, fontFamily: FONT_MONO, color: ageColor }}>{fmtAge(ageH)}</span>
              </td>
              <td style={{ padding: '9px 8px', fontFamily: FONT_MONO, fontSize: 11, color: T.textMute }}>v{r.version}</td>
              <td style={{ padding: '9px 8px' }}><Chip label={sl.label} color={sl.color} /></td>
              <td style={{ padding: '9px 8px' }}>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => onHistory(r)} style={{ padding: '3px 8px', fontSize: 10, fontFamily: FONT_MONO, cursor: 'pointer', background: 'none', border: `1px solid ${T.border}`, borderRadius: 3, color: T.textDim }}>History</button>
                  <button onClick={() => onOverride(r)} style={{ padding: '3px 8px', fontSize: 10, fontFamily: FONT_MONO, cursor: 'pointer', background: 'none', border: `1px solid ${T.warn}55`, borderRadius: 3, color: T.warn }}>Override</button>
                </div>
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

// ── KPI row ────────────────────────────────────────────────────────────────────
function KpiChip({ label, value, color = T.text }) {
  return (
    <div style={{ background: T.panelHi, border: `1px solid ${T.border}`, borderRadius: 6, padding: '10px 14px', textAlign: 'center' }}>
      <div style={{ fontSize: 20, fontWeight: 600, color, fontFamily: FONT_MONO }}>{value}</div>
      <div style={{ fontSize: 10, color: T.textMute, marginTop: 2, letterSpacing: '0.05em' }}>{label}</div>
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function PricingRegistry() {
  const [pricing, setPricing]       = useState([])
  const [status, setStatus]         = useState(null)
  const [syncStatus, setSyncStatus] = useState(null)
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState(null)
  const [filterProvider, setFilter] = useState('all')
  const [search, setSearch]         = useState('')
  const [historyTarget, setHistory] = useState(null)
  const [overrideTarget, setOverride] = useState(null)
  const [saving, setSaving]         = useState(false)
  const [syncing, setSyncing]       = useState(false)
  const [showOverrides, setShowOvr] = useState(false)

  const loadAll = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [pr, st, ss] = await Promise.all([
        fetchPricingRegistry({ include_history: false }),
        fetchPricingStatus(),
        fetchPricingSyncStatus(),
      ])
      setPricing(pr.pricing || [])
      setStatus(st)
      setSyncStatus(ss)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadAll() }, [loadAll])

  async function handleSync() {
    setSyncing(true)
    try {
      await triggerPricingSync()
      // Poll for completion
      setTimeout(async () => {
        try { const ss = await fetchPricingSyncStatus(); setSyncStatus(ss) } catch (_) {}
        setSyncing(false)
        loadAll()
      }, 4000)
    } catch (e) {
      setError(e.message)
      setSyncing(false)
    }
  }

  async function handleOverride(data) {
    setSaving(true)
    try {
      await overridePricing(data)
      setOverride(null)
      await loadAll()
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div style={{ padding: 40, color: T.textMute, fontFamily: FONT_MONO, fontSize: 12 }}>Loading pricing registry…</div>
  if (error)   return <div style={{ padding: 40, color: T.crit,    fontFamily: FONT_MONO, fontSize: 12 }}>Error: {error}</div>

  const providers  = [...new Set(pricing.map(r => r.provider))].sort()
  const overrides  = pricing.filter(r => r.is_override)
  const criticalWarnings = (status?.warnings || []).filter(w => w.level === 'critical')

  return (
    <div style={{ fontFamily: FONT_SANS, color: T.text }}>
      {/* Warnings */}
      {status?.warnings?.length > 0 && <WarningBanner warnings={status.warnings} />}

      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10, marginBottom: 16 }}>
        <KpiChip label="Total Models"   value={pricing.length} color={T.accent} />
        <KpiChip label="Providers"      value={providers.length} color={T.teal} />
        <KpiChip label="Org Overrides"  value={overrides.length} color={overrides.length > 0 ? T.warn : T.textMute} />
        <KpiChip label="Critical Alerts" value={criticalWarnings.length} color={criticalWarnings.length > 0 ? T.crit : T.success} />
        <KpiChip label="Last Updated"   value={status?.last_sync_at ? new Date(status.last_sync_at).toLocaleDateString() : (status?.pricing_updated || '—')} color={T.textDim} />
      </div>

      {/* Main grid: table + sync status */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 12, alignItems: 'start' }}>
        {/* Pricing table */}
        <Card
          title="Model Pricing"
          subtitle={`${pricing.length} models · global + org overrides`}
          action={
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button onClick={() => setOverride({})} style={{
                padding: '5px 12px', fontSize: 11, fontFamily: FONT_MONO, cursor: 'pointer',
                background: T.warn, border: 'none', borderRadius: 4, color: T.bg, fontWeight: 600,
              }}>+ Override</button>
            </div>
          }
        >
          {/* Filters */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            <select
              value={filterProvider}
              onChange={e => setFilter(e.target.value)}
              style={{ padding: '5px 8px', background: T.bg, border: `1px solid ${T.border}`, borderRadius: 4, color: T.textDim, fontSize: 11, fontFamily: FONT_MONO }}
            >
              <option value="all">All Providers</option>
              {providers.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search models…"
              style={{ padding: '5px 10px', background: T.bg, border: `1px solid ${T.border}`, borderRadius: 4, color: T.text, fontSize: 11, fontFamily: FONT_MONO, width: 180 }}
            />
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: T.textDim, cursor: 'pointer' }}>
              <input type="checkbox" checked={showOverrides} onChange={e => setShowOvr(e.target.checked)} />
              Only overrides
            </label>
          </div>
          <PricingTable
            rows={showOverrides ? pricing.filter(r => r.is_override) : pricing}
            filterProvider={filterProvider}
            search={search}
            onHistory={r => setHistory(r)}
            onOverride={r => setOverride(r)}
          />
        </Card>

        {/* Right panel: sync + by-provider status */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <SyncStatusCard syncStatus={syncStatus} onSync={handleSync} syncing={syncing} />

          {/* Per-provider breakdown */}
          {status?.by_provider && (
            <Card title="By Provider" subtitle="Model count and freshness">
              {Object.entries(status.by_provider).map(([prov, info]) => (
                <div key={prov} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, paddingBottom: 8, borderBottom: `1px solid ${T.border}` }}>
                  <div>
                    <div style={{ fontSize: 12, color: PROVIDER_COLORS[prov] || T.text, fontFamily: FONT_MONO, textTransform: 'capitalize' }}>{prov}</div>
                    <div style={{ fontSize: 10, color: T.textMute }}>{info.model_count} models</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 11, fontFamily: FONT_MONO, color: info.max_age_hours >= 48 ? T.crit : info.max_age_hours >= 24 ? T.warn : T.success }}>
                      {fmtAge(info.max_age_hours)} old
                    </div>
                    {info.has_override && <div style={{ fontSize: 10, color: T.warn }}>override active</div>}
                  </div>
                </div>
              ))}
            </Card>
          )}

          {/* Fallback notice */}
          <div style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 8, padding: 12 }}>
            <div style={{ fontSize: 10, color: T.textMute, fontFamily: FONT_MONO, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>Fallback Pricing</div>
            <div style={{ fontSize: 12, color: T.textDim }}>Unknown models: $2.50 in / $10.00 out per 1M tokens</div>
            <div style={{ fontSize: 11, color: T.textMute, marginTop: 4 }}>Costs marked as <em>estimated</em> in telemetry.</div>
          </div>
        </div>
      </div>

      {/* Modals */}
      {historyTarget && (
        <HistoryDrawer
          provider={historyTarget.provider}
          model={historyTarget.model_name}
          onClose={() => setHistory(null)}
        />
      )}
      {overrideTarget && (
        <OverrideModal
          prefill={overrideTarget}
          onClose={() => setOverride(null)}
          onSubmit={handleOverride}
          saving={saving}
        />
      )}
    </div>
  )
}
