import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Cell,
} from 'recharts'
import {
  fetchCostIntelligence,
  importProviderBilling,
  fetchBillingPeriods,
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
  gemini:    T.teal,
  bedrock:   T.warn,
  azure:     '#00BFFF',
  local:     T.textDim,
  unknown:   T.textMute,
}

const RECON_COLOR = { healthy: T.success, warning: T.warn, investigate: T.crit }
const RECON_ICON  = { healthy: '✓', warning: '⚠', investigate: '!' }

// ── Formatters ─────────────────────────────────────────────────────────────────
const fmt$ = (v) =>
  v == null ? '—' :
  v >= 1000  ? `$${(v / 1000).toFixed(1)}k` :
  v >= 1     ? `$${v.toFixed(2)}` :
               `$${v.toFixed(4)}`

const fmtFull$ = (v) =>
  v == null ? '—' : `$${(+v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const fmtPct = (v) =>
  v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`

const fmtDate = (iso) => {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const fmtShortDate = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// ── Tiny components ────────────────────────────────────────────────────────────
function Card({ title, subtitle, action, children, style = {} }) {
  return (
    <div style={{
      background: T.panel, border: `1px solid ${T.border}`, borderRadius: 8,
      padding: 16, ...style,
    }}>
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

function KpiCard({ label, value, sub, trend, trendDir, note, accent = T.accent }) {
  const trendColor = trendDir === 'up' ? T.crit : trendDir === 'down' ? T.success : T.textDim
  return (
    <div style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 8, padding: 16 }}>
      <div style={{ fontSize: 11, color: T.textDim, fontFamily: FONT_MONO, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 600, color: accent, fontFamily: FONT_MONO, letterSpacing: '-0.02em' }}>{value ?? '—'}</div>
      {trend != null && (
        <div style={{ fontSize: 12, color: trendColor, marginTop: 4, fontFamily: FONT_MONO }}>
          {trendDir === 'up' ? '↑' : trendDir === 'down' ? '↓' : '→'} {fmtPct(trend)} vs prev period
        </div>
      )}
      {sub && <div style={{ fontSize: 11, color: T.textMute, marginTop: 4 }}>{sub}</div>}
      {note && <div style={{ fontSize: 10, color: T.textMute, marginTop: 4, fontStyle: 'italic' }}>{note}</div>}
    </div>
  )
}

function ReconciliationKpi({ data }) {
  if (!data || Object.keys(data).length === 0) {
    return (
      <div style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 8, padding: 16 }}>
        <div style={{ fontSize: 11, color: T.textDim, fontFamily: FONT_MONO, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>Reconciliation</div>
        <div style={{ fontSize: 13, color: T.textMute, marginTop: 8 }}>No billing data imported yet</div>
        <div style={{ fontSize: 11, color: T.textMute, marginTop: 4 }}>Import a provider invoice to run variance analysis</div>
      </div>
    )
  }
  const color = RECON_COLOR[data.status] || T.textDim
  const icon  = RECON_ICON[data.status] || '?'
  return (
    <div style={{ background: T.panel, border: `1px solid ${color}40`, borderRadius: 8, padding: 16 }}>
      <div style={{ fontSize: 11, color: T.textDim, fontFamily: FONT_MONO, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>Reconciliation</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ width: 28, height: 28, borderRadius: '50%', background: `${color}20`, border: `1px solid ${color}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color, flexShrink: 0 }}>{icon}</div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color, textTransform: 'capitalize' }}>{data.status}</div>
          <div style={{ fontSize: 11, color: T.textMute }}>{fmtPct(data.variance_percent)} variance ({fmtFull$(Math.abs(data.variance_absolute_usd))})</div>
        </div>
      </div>
      {data.provider && <div style={{ fontSize: 11, color: T.textMute, marginTop: 8 }}>Provider: {data.provider}</div>}
    </div>
  )
}

// ── Tab bar ────────────────────────────────────────────────────────────────────
function TabBar({ tabs, active, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 2, marginBottom: 12 }}>
      {tabs.map(t => (
        <button key={t.id} onClick={() => onChange(t.id)} style={{
          padding: '6px 12px', fontSize: 11, fontFamily: FONT_MONO, cursor: 'pointer', borderRadius: 4,
          border: `1px solid ${active === t.id ? T.accent : T.border}`,
          background: active === t.id ? `${T.accent}18` : 'transparent',
          color: active === t.id ? T.accent : T.textDim,
        }}>{t.label}</button>
      ))}
    </div>
  )
}

// ── Breakdown list ─────────────────────────────────────────────────────────────
function BreakdownList({ items, breakdownBy }) {
  if (!items || items.length === 0) {
    return <div style={{ color: T.textMute, fontSize: 13, padding: '24px 0', textAlign: 'center' }}>No data for this period</div>
  }
  const top10    = items.slice(0, 10)
  const otherCost = items.slice(10).reduce((s, x) => s + (x.cost_usd || 0), 0)
  const maxCost   = top10[0]?.cost_usd || 1

  return (
    <div>
      {top10.map((item, i) => (
        <div key={item.name} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <div style={{ width: 18, fontSize: 10, color: T.textMute, fontFamily: FONT_MONO, textAlign: 'right', flexShrink: 0 }}>{i + 1}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
              <div title={item.name} style={{ fontSize: 12, fontFamily: FONT_MONO, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</div>
              <div style={{ fontSize: 12, fontFamily: FONT_MONO, color: T.accent, flexShrink: 0, marginLeft: 8 }}>{fmtFull$(item.cost_usd)}</div>
            </div>
            <div style={{ height: 4, background: T.border, borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${(item.cost_usd / maxCost) * 100}%`, background: T.accent, borderRadius: 2 }} />
            </div>
            <div style={{ fontSize: 10, color: T.textMute, marginTop: 2, fontFamily: FONT_MONO }}>
              {item.percent_of_total.toFixed(1)}% · {item.calls.toLocaleString()} calls
            </div>
          </div>
        </div>
      ))}
      {otherCost > 0 && (
        <div style={{ borderTop: `1px solid ${T.border}`, paddingTop: 8, marginTop: 4, fontSize: 12, color: T.textMute, display: 'flex', justifyContent: 'space-between' }}>
          <span>Others ({items.length - 10} more)</span>
          <span style={{ fontFamily: FONT_MONO }}>{fmtFull$(otherCost)}</span>
        </div>
      )}
    </div>
  )
}

// ── 30-day trend chart ─────────────────────────────────────────────────────────
const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: T.panelHi, border: `1px solid ${T.borderHi}`, borderRadius: 4, padding: '8px 12px', fontFamily: FONT_MONO, fontSize: 11 }}>
      <div style={{ color: T.textDim, marginBottom: 4 }}>{label}</div>
      <div style={{ color: T.accent }}>{fmtFull$(payload[0].value)}</div>
      {payload[1] && <div style={{ color: T.textMute }}>{payload[1].value.toLocaleString()} calls</div>}
    </div>
  )
}

function TrendChart({ data }) {
  if (!data || data.length === 0) {
    return <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.textMute, fontSize: 13 }}>No trend data</div>
  }
  const withLabels = data.map(d => ({ ...d, label: fmtShortDate(d.date) }))
  const step = Math.max(1, Math.floor(withLabels.length / 7))
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={withLabels} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={T.border} vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fontFamily: FONT_MONO, fontSize: 9, fill: T.textMute }}
          tickLine={false}
          axisLine={false}
          interval={step - 1}
        />
        <YAxis
          tick={{ fontFamily: FONT_MONO, fontSize: 9, fill: T.textMute }}
          tickLine={false}
          axisLine={false}
          tickFormatter={v => `$${v.toFixed(0)}`}
          width={45}
        />
        <Tooltip content={<CustomTooltip />} />
        <Line
          type="monotone"
          dataKey="cost_usd"
          stroke={T.accent}
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, fill: T.accent }}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}

// ── Billing history table ──────────────────────────────────────────────────────
function BillingTable({ records }) {
  if (!records || records.length === 0) {
    return (
      <div style={{ padding: '24px 0', textAlign: 'center', color: T.textMute, fontSize: 13 }}>
        No billing records yet. Import your first invoice to enable reconciliation.
      </div>
    )
  }
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr style={{ borderBottom: `1px solid ${T.border}` }}>
          {['Provider', 'Period', 'Billed (Actual)', 'Source', 'Reconciliation', 'Imported'].map(h => (
            <th key={h} style={{ padding: '6px 8px', textAlign: 'left', fontSize: 10, fontFamily: FONT_MONO, color: T.textMute, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {records.map(r => {
          const recon = r.reconciliation
          const recon_color = recon ? (RECON_COLOR[recon.status] || T.textDim) : T.textMute
          return (
            <tr key={r.id} style={{ borderBottom: `1px solid ${T.border}` }}>
              <td style={{ padding: '10px 8px' }}>
                <span style={{ fontSize: 12, fontFamily: FONT_MONO, color: PROVIDER_COLORS[r.provider] || T.text, textTransform: 'capitalize' }}>{r.provider}</span>
              </td>
              <td style={{ padding: '10px 8px', fontSize: 11, fontFamily: FONT_MONO, color: T.textDim }}>
                {fmtDate(r.billing_period_start)} — {fmtDate(r.billing_period_end)}
              </td>
              <td style={{ padding: '10px 8px', fontSize: 12, fontFamily: FONT_MONO, color: T.text }}>
                {fmtFull$(r.actual_billed_cost_usd)} <span style={{ fontSize: 10, color: T.textMute }}>{r.currency}</span>
              </td>
              <td style={{ padding: '10px 8px', fontSize: 11, color: T.textMute, textTransform: 'capitalize' }}>{r.source?.replace('_', ' ')}</td>
              <td style={{ padding: '10px 8px' }}>
                {recon ? (
                  <span style={{ fontSize: 11, fontFamily: FONT_MONO, color: recon_color }}>
                    {RECON_ICON[recon.status]} {recon.status} ({fmtPct(recon.variance_percent)})
                  </span>
                ) : <span style={{ color: T.textMute, fontSize: 11 }}>—</span>}
              </td>
              <td style={{ padding: '10px 8px', fontSize: 11, color: T.textMute }}>
                {fmtDate(r.created_at)}{r.imported_by ? ` · ${r.imported_by}` : ''}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

// ── Import billing modal ───────────────────────────────────────────────────────
const PROVIDERS = ['openai', 'anthropic', 'google', 'gemini', 'bedrock', 'azure']

function ImportModal({ onClose, onSubmit, saving }) {
  const [form, setForm] = useState({
    provider: 'openai',
    billing_period_start: '',
    billing_period_end: '',
    actual_billed_cost_usd: '',
    currency: 'USD',
    source: 'manual_upload',
    notes: '',
  })
  const [err, setErr] = useState(null)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  async function handleSubmit(e) {
    e.preventDefault()
    setErr(null)
    if (!form.billing_period_start || !form.billing_period_end || !form.actual_billed_cost_usd) {
      setErr('Period start, period end, and billed amount are required.')
      return
    }
    const amount = parseFloat(form.actual_billed_cost_usd)
    if (isNaN(amount) || amount < 0) { setErr('Invalid amount.'); return }
    try {
      await onSubmit(form.provider, {
        billing_period_start: form.billing_period_start,
        billing_period_end:   form.billing_period_end,
        actual_billed_cost_usd: amount,
        currency: form.currency,
        source:   form.source,
        notes:    form.notes || undefined,
      })
    } catch (e) {
      setErr(e.message)
    }
  }

  const inputStyle = {
    width: '100%', padding: '8px 10px', background: T.bg, border: `1px solid ${T.border}`,
    borderRadius: 4, color: T.text, fontSize: 12, fontFamily: FONT_MONO, boxSizing: 'border-box',
  }
  const labelStyle = { fontSize: 11, color: T.textDim, marginBottom: 4, display: 'block', fontFamily: FONT_MONO }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: T.panel, border: `1px solid ${T.borderHi}`, borderRadius: 8, padding: 24, width: 460, maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: T.text }}>Import Provider Billing</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: T.textMute, cursor: 'pointer', fontSize: 16 }}>✕</button>
        </div>
        <div style={{ fontSize: 12, color: T.textMute, marginBottom: 16 }}>
          Import an actual provider invoice to enable cost reconciliation and variance analysis.
        </div>
        {err && <div style={{ background: `${T.crit}18`, border: `1px solid ${T.crit}`, borderRadius: 4, padding: '8px 12px', marginBottom: 12, fontSize: 12, color: T.crit }}>{err}</div>}
        <form onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={{ gridColumn: '1/-1' }}>
              <label style={labelStyle}>Provider</label>
              <select value={form.provider} onChange={e => set('provider', e.target.value)} style={{ ...inputStyle, textTransform: 'capitalize' }}>
                {PROVIDERS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Billing Period Start *</label>
              <input type="date" value={form.billing_period_start} onChange={e => set('billing_period_start', e.target.value)} style={inputStyle} required />
            </div>
            <div>
              <label style={labelStyle}>Billing Period End *</label>
              <input type="date" value={form.billing_period_end} onChange={e => set('billing_period_end', e.target.value)} style={inputStyle} required />
            </div>
            <div>
              <label style={labelStyle}>Actual Billed Amount (USD) *</label>
              <input type="number" step="0.01" min="0" value={form.actual_billed_cost_usd} onChange={e => set('actual_billed_cost_usd', e.target.value)} placeholder="12875.50" style={inputStyle} required />
            </div>
            <div>
              <label style={labelStyle}>Currency</label>
              <input value={form.currency} onChange={e => set('currency', e.target.value)} style={inputStyle} />
            </div>
            <div style={{ gridColumn: '1/-1' }}>
              <label style={labelStyle}>Source</label>
              <select value={form.source} onChange={e => set('source', e.target.value)} style={inputStyle}>
                <option value="manual_upload">Manual Upload</option>
                <option value="csv_import">CSV Import</option>
                <option value="api">API</option>
                <option value="webhook">Webhook</option>
              </select>
            </div>
            <div style={{ gridColumn: '1/-1' }}>
              <label style={labelStyle}>Notes (optional)</label>
              <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2} placeholder="e.g. Downloaded from OpenAI dashboard" style={{ ...inputStyle, resize: 'vertical' }} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose} disabled={saving} style={{ padding: '8px 16px', background: 'none', border: `1px solid ${T.border}`, borderRadius: 4, color: T.textDim, cursor: 'pointer', fontSize: 12 }}>Cancel</button>
            <button type="submit" disabled={saving} style={{ padding: '8px 16px', background: T.accent, border: 'none', borderRadius: 4, color: T.bg, fontWeight: 600, cursor: 'pointer', fontSize: 12 }}>
              {saving ? 'Importing…' : 'Import & Reconcile'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Reconciliation detail ──────────────────────────────────────────────────────
function ReconciliationDetail({ data }) {
  if (!data || Object.keys(data).length === 0) return null
  const color   = RECON_COLOR[data.status] || T.textDim
  const causes  = {
    healthy:     ['Pricing accuracy is within tolerance', 'Telemetry coverage is complete'],
    warning:     ['Pricing updated mid-period', 'Volume discounts may apply', 'Minor rounding differences'],
    investigate: ['Significant pricing discrepancy detected', 'Possible traffic bypassing gateway', 'Check for missing telemetry', 'Verify model pricing table is current'],
  }

  return (
    <div style={{ background: `${color}0A`, border: `1px solid ${color}30`, borderRadius: 6, padding: 14 }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
        <div style={{ flex: 1, minWidth: 140 }}>
          <div style={{ fontSize: 10, color: T.textMute, fontFamily: FONT_MONO, marginBottom: 2 }}>RUNTIME ESTIMATE</div>
          <div style={{ fontSize: 14, fontFamily: FONT_MONO, color: T.text }}>{fmtFull$(data.runtime_estimate_usd)}</div>
          <div style={{ fontSize: 10, color: T.textMute }}>from telemetry</div>
        </div>
        <div style={{ flex: 1, minWidth: 140 }}>
          <div style={{ fontSize: 10, color: T.textMute, fontFamily: FONT_MONO, marginBottom: 2 }}>PROVIDER BILLED</div>
          <div style={{ fontSize: 14, fontFamily: FONT_MONO, color: T.text }}>{fmtFull$(data.provider_billed_usd)}</div>
          <div style={{ fontSize: 10, color: T.textMute }}>actual invoice</div>
        </div>
        <div style={{ flex: 1, minWidth: 140 }}>
          <div style={{ fontSize: 10, color: T.textMute, fontFamily: FONT_MONO, marginBottom: 2 }}>VARIANCE</div>
          <div style={{ fontSize: 14, fontFamily: FONT_MONO, color }}>
            {data.variance_absolute_usd >= 0 ? '+' : ''}{fmtFull$(data.variance_absolute_usd)}
          </div>
          <div style={{ fontSize: 10, color }}>{fmtPct(data.variance_percent)} · {data.status}</div>
        </div>
      </div>
      {causes[data.status] && (
        <div>
          <div style={{ fontSize: 10, color: T.textMute, marginBottom: 4, fontFamily: FONT_MONO }}>LIKELY CAUSES</div>
          {causes[data.status].map(c => (
            <div key={c} style={{ fontSize: 11, color: T.textDim, marginBottom: 2 }}>• {c}</div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────
const BREAKDOWN_TABS = [
  { id: 'agent',       label: 'By Agent' },
  { id: 'team',        label: 'By Team' },
  { id: 'model',       label: 'By Model' },
  { id: 'environment', label: 'By Environment' },
  { id: 'provider',    label: 'By Provider' },
]

export default function CostIntelligence() {
  const [data, setData]               = useState(null)
  const [billingPeriods, setBilling]  = useState([])
  const [loading, setLoading]         = useState(true)
  const [error, setError]             = useState(null)
  const [breakdownBy, setBreakdownBy] = useState('agent')
  const [showImport, setShowImport]   = useState(false)
  const [saving, setSaving]           = useState(false)

  const loadData = useCallback(async (bBy = breakdownBy) => {
    setLoading(true)
    setError(null)
    try {
      const [ci, billing] = await Promise.all([
        fetchCostIntelligence({ breakdown_by: bBy, days: 30 }),
        fetchBillingPeriods(),
      ])
      setData(ci)
      setBilling(billing)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadData(breakdownBy) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleBreakdownChange(tab) {
    setBreakdownBy(tab)
    try {
      const ci = await fetchCostIntelligence({ breakdown_by: tab, days: 30 })
      setData(ci)
    } catch (e) {
      setError(e.message)
    }
  }

  async function handleImport(provider, formData) {
    setSaving(true)
    try {
      await importProviderBilling(provider, formData)
      setShowImport(false)
      await loadData(breakdownBy)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div style={{ padding: 40, color: T.textMute, fontFamily: FONT_MONO, fontSize: 12 }}>Loading cost intelligence…</div>
  if (error)   return <div style={{ padding: 40, color: T.crit, fontFamily: FONT_MONO, fontSize: 12 }}>Error: {error}</div>

  const rc         = data?.runtime_cost  || {}
  const pb         = data?.provider_billing || {}
  const recon      = data?.reconciliation || {}
  const breakdown  = data?.breakdown?.items || []
  const trends     = data?.trends || []
  const totalBilled = data?.total_billed_usd || 0
  const prLabel    = Object.keys(pb).join(', ') || 'No data'

  return (
    <div style={{ fontFamily: FONT_SANS, color: T.text }}>
      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 16 }}>
        <KpiCard
          label="Runtime Cost (Estimated)"
          value={fmtFull$(rc.total_usd)}
          trend={rc.trend_percent}
          trendDir={rc.trend_direction}
          note="Calculated from telemetry × model pricing"
        />
        <KpiCard
          label="Provider Billed (Actual)"
          value={totalBilled > 0 ? fmtFull$(totalBilled) : '—'}
          sub={totalBilled > 0 ? `Providers: ${prLabel}` : 'No invoices imported yet'}
          accent={T.teal}
          note="From imported provider invoices"
        />
        <ReconciliationKpi data={recon} />
      </div>

      {/* Main content: breakdown + trend */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
        <Card title="Cost Breakdown" subtitle={`Period: last 30 days · ${breakdown.length} entries`}>
          <TabBar tabs={BREAKDOWN_TABS} active={breakdownBy} onChange={handleBreakdownChange} />
          <BreakdownList items={breakdown} breakdownBy={breakdownBy} />
        </Card>

        <Card title="30-Day Cost Trend" subtitle="Daily runtime cost estimate">
          <TrendChart data={trends} />
          <div style={{ display: 'flex', gap: 16, marginTop: 12, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 11, color: T.textMute }}>
              Avg daily: <span style={{ color: T.text, fontFamily: FONT_MONO }}>{fmtFull$(trends.reduce((s, d) => s + d.cost_usd, 0) / Math.max(trends.filter(d => d.cost_usd > 0).length, 1))}</span>
            </div>
            <div style={{ fontSize: 11, color: T.textMute }}>
              Peak: <span style={{ color: T.text, fontFamily: FONT_MONO }}>{fmtFull$(Math.max(...trends.map(d => d.cost_usd), 0))}</span>
            </div>
          </div>
        </Card>
      </div>

      {/* Reconciliation detail */}
      {Object.keys(recon).length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <Card title="Reconciliation Detail" subtitle="Runtime estimate vs provider invoice">
            <ReconciliationDetail data={recon} />
          </Card>
        </div>
      )}

      {/* Billing history */}
      <Card
        title="Billing History"
        subtitle="Provider invoices and reconciliation results"
        action={
          <button onClick={() => setShowImport(true)} style={{
            padding: '6px 12px', fontSize: 11, fontFamily: FONT_MONO, cursor: 'pointer',
            background: T.accent, border: 'none', borderRadius: 4, color: T.bg, fontWeight: 600,
          }}>
            + Import Billing Data
          </button>
        }
      >
        <BillingTable records={billingPeriods} />
      </Card>

      {/* Import modal */}
      {showImport && (
        <ImportModal
          onClose={() => setShowImport(false)}
          onSubmit={handleImport}
          saving={saving}
        />
      )}
    </div>
  )
}
