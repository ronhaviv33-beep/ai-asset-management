// In dev, Vite proxy rewrites /api/* → http://localhost:8000/*.
// In production (combined server), frontend and backend share the same origin so BASE is ''.
// VITE_API_BASE / VITE_API_URL can still override to an explicit URL for separate-service setups.
function resolveBase() {
  let raw = import.meta.env.VITE_API_BASE || import.meta.env.VITE_API_URL || ''
  raw = raw.trim().replace(/\/+$/, '')                        // strip trailing slashes
  if (!raw) return import.meta.env.PROD ? '' : '/api'         // prod: same-origin; dev: Vite proxy
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`     // bare host → add scheme
  return raw
}

export const BASE = resolveBase()

export function getToken() {
  return localStorage.getItem('token')
}

export function setToken(token) {
  if (token) localStorage.setItem('token', token)
  else localStorage.removeItem('token')
}

// Platform admin org switching — stored in sessionStorage so it resets on tab close.
export function getViewOrg() {
  return sessionStorage.getItem('view_org_id') || null
}

export function setViewOrg(orgId) {
  if (orgId) sessionStorage.setItem('view_org_id', String(orgId))
  else sessionStorage.removeItem('view_org_id')
}

function authHeaders(extra = {}) {
  const token = getToken()
  const viewOrg = getViewOrg()
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(viewOrg ? { 'X-View-Org': viewOrg } : {}),
    ...extra,
  }
}

export async function authFetch(url, options = {}) {
  if (!getToken()) return null   // no token — caller treats as unauthenticated
  const resp = await fetch(url, {
    ...options,
    headers: { ...authHeaders(), ...(options.headers || {}) },
  })
  if (resp.status === 401) {
    setToken(null)
    // Signal the app to return to login without a full page reload
    window.dispatchEvent(new CustomEvent('auth:expired'))
    return null
  }
  return resp
}

export async function login(email, password) {
  const r = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!r.ok) {
    const err = await r.json().catch(() => ({}))
    throw new Error(err.detail || 'Login failed')
  }
  return r.json()
}

export async function fetchMe() {
  const r = await authFetch(`${BASE}/auth/me`)
  if (!r || !r.ok) return null
  return r.json()
}

export async function fetchOrganizations() {
  const r = await authFetch(`${BASE}/admin/organizations`)
  if (!r || !r.ok) return []
  return r.json()
}

export async function createOrganization(data) {
  const r = await authFetch(`${BASE}/admin/organizations`, {
    method: 'POST',
    body: JSON.stringify(data),
  })
  if (!r || !r.ok) {
    const err = await r.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to create organization')
  }
  return r.json()
}

export async function fetchUsers() {
  const r = await authFetch(`${BASE}/auth/users`)
  if (!r || !r.ok) throw new Error('Failed to fetch users')
  return r.json()
}

export async function createUser(data) {
  const r = await authFetch(`${BASE}/auth/users`, {
    method: 'POST',
    body: JSON.stringify(data),
  })
  if (!r || !r.ok) {
    const err = await r.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to create user')
  }
  return r.json()
}

export async function updateUser(id, data) {
  const r = await authFetch(`${BASE}/auth/users/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
  if (!r || !r.ok) throw new Error('Failed to update user')
  return r.json()
}

export async function deleteUser(id) {
  const r = await authFetch(`${BASE}/auth/users/${id}`, { method: 'DELETE' })
  if (!r || !r.ok) throw new Error('Failed to delete user')
}

export async function fetchSummary() {
  const r = await authFetch(`${BASE}/telemetry/summary`)
  if (!r || !r.ok) throw new Error('Failed to fetch summary')
  return r.json()
}

export async function fetchTelemetry(limit = 200) {
  const r = await authFetch(`${BASE}/telemetry?limit=${limit}`)
  if (!r || !r.ok) throw new Error('Failed to fetch telemetry')
  return r.json()
}

export async function fetchSecurityAlerts() {
  const r = await authFetch(`${BASE}/security/alerts`)
  if (!r || !r.ok) throw new Error('Failed to fetch security alerts')
  return r.json()
}

export async function fetchAudit(params = {}) {
  const q = new URLSearchParams(params).toString()
  const r = await authFetch(`${BASE}/audit?${q}`)
  if (!r || !r.ok) throw new Error('Failed to fetch audit log')
  return r.json()
}

export async function fetchKeyStatuses() {
  const r = await authFetch(`${BASE}/settings/keys`)
  if (!r || !r.ok) throw new Error('Failed to fetch key statuses')
  return r.json()
}

export async function updateKey(key, value) {
  const r = await authFetch(`${BASE}/settings/keys`, {
    method: 'PATCH',
    body: JSON.stringify({ key, value }),
  })
  if (!r || !r.ok) {
    const err = await r.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to update key')
  }
  return r.json()
}

export async function getDemoMode() {
  const r = await authFetch(`${BASE}/settings/demo-mode`)
  if (!r || !r.ok) return true  // safe default: show demo when unknown
  const data = await r.json()
  return data.demo_mode
}

export async function setDemoMode(enabled) {
  const r = await authFetch(`${BASE}/settings/demo-mode`, {
    method: 'PATCH',
    body: JSON.stringify({ demo_mode: enabled }),
  })
  if (!r || !r.ok) throw new Error('Failed to update demo mode')
  return r.json()
}

// ── Provider credentials (BYOK) ──────────────────────────────────────────────

export async function fetchProviderCredentials() {
  const r = await authFetch(`${BASE}/provider-credentials`)
  if (!r || !r.ok) throw new Error('Failed to fetch provider credentials')
  return r.json()
}

export async function upsertProviderCredential(provider, key, base_url) {
  const body = { provider, key }
  if (base_url) body.base_url = base_url
  const r = await authFetch(`${BASE}/provider-credentials`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
  if (!r || !r.ok) {
    const err = await r.json().catch(() => ({}))
    const msg =
      (typeof err.detail === 'string' ? err.detail : null) ||
      err.detail?.error?.message ||
      err.detail?.message ||
      err.error?.message ||
      null
    if (!msg) console.error('provider credential save error', r.status, err)
    throw new Error(msg || 'Failed to save credential — check console for details')
  }
  return r.json()
}

export async function deleteProviderCredential(provider) {
  const r = await authFetch(`${BASE}/provider-credentials/${provider}`, { method: 'DELETE' })
  if (!r || !r.ok) {
    const err = await r.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to delete credential')
  }
}

// ── API Key management ────────────────────────────────────────────────────────

export async function fetchApiKeys() {
  const r = await authFetch(`${BASE}/api-keys`)
  if (!r || !r.ok) throw new Error('Failed to fetch API keys')
  return r.json()
}

export async function createApiKey(data) {
  const r = await authFetch(`${BASE}/api-keys`, {
    method: 'POST',
    body: JSON.stringify(data),
  })
  if (!r || !r.ok) {
    const err = await r.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to create API key')
  }
  return r.json()
}

export async function revokeApiKey(id) {
  const r = await authFetch(`${BASE}/api-keys/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ is_active: false }),
  })
  if (!r || !r.ok) throw new Error('Failed to revoke API key')
  return r.json()
}

export async function deleteApiKey(id) {
  const r = await authFetch(`${BASE}/api-keys/${id}`, { method: 'DELETE' })
  if (!r || !r.ok) throw new Error('Failed to delete API key')
}

// ── Guard modes ───────────────────────────────────────────────────────────────

export async function fetchGuardModes() {
  const r = await authFetch(`${BASE}/guard-modes`)
  if (!r || !r.ok) throw new Error('Failed to fetch guard modes')
  return r.json()
}

export async function setGuardMode(team, mode) {
  const r = await authFetch(`${BASE}/guard-modes/${encodeURIComponent(team)}`, {
    method: 'PUT',
    body: JSON.stringify({ mode }),
  })
  if (!r || !r.ok) {
    const err = await r.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to set guard mode')
  }
  return r.json()
}

export async function fetchHealth() {
  // Health is public — no auth needed
  const r = await fetch(`${BASE}/health`)
  if (!r.ok) throw new Error('Health check failed')
  return r.json()
}

// ── Role management ───────────────────────────────────────────────────────────

export async function fetchRoles() {
  const r = await authFetch(`${BASE}/roles`)
  if (!r || !r.ok) throw new Error('Failed to fetch roles')
  return r.json()
}

export async function createRole(data) {
  const r = await authFetch(`${BASE}/roles`, {
    method: 'POST',
    body: JSON.stringify(data),
  })
  if (!r || !r.ok) {
    const err = r ? await r.json().catch(() => ({})) : {}
    throw new Error(err.detail || `Failed to create role (HTTP ${r?.status ?? 'network error'})`)
  }
  return r.json()
}

export async function updateRole(name, data) {
  const r = await authFetch(`${BASE}/roles/${encodeURIComponent(name)}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
  if (!r || !r.ok) {
    const err = await r.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to update role')
  }
  return r.json()
}

export async function deleteRole(name) {
  const r = await authFetch(`${BASE}/roles/${encodeURIComponent(name)}`, { method: 'DELETE' })
  if (!r || !r.ok) {
    const err = await r.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to delete role')
  }
}

export async function fetchTeams() {
  const r = await authFetch(`${BASE}/teams`)
  if (!r || !r.ok) throw new Error('Failed to fetch teams')
  return r.json()
}

// ── Asset Management ──────────────────────────────────────────────────────────

export async function fetchAssets(params = {}) {
  const q = new URLSearchParams(
    Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''))
  ).toString()
  const r = await authFetch(`${BASE}/assets${q ? `?${q}` : ''}`)
  if (!r || !r.ok) throw new Error('Failed to fetch assets')
  return r.json()
}

export async function fetchAssetsSummary(days = 90) {
  const r = await authFetch(`${BASE}/assets/summary?days=${days}`)
  if (!r || !r.ok) throw new Error('Failed to fetch assets summary')
  return r.json()
}

export async function fetchAsset(agentName, days = 90) {
  const r = await authFetch(`${BASE}/assets/${encodeURIComponent(agentName)}?days=${days}`)
  if (!r || !r.ok) throw new Error(`Failed to fetch asset: ${agentName}`)
  return r.json()
}

export async function fetchAssetTelemetry(agentName, params = {}) {
  const q = new URLSearchParams(params).toString()
  const r = await authFetch(`${BASE}/assets/${encodeURIComponent(agentName)}/telemetry${q ? `?${q}` : ''}`)
  if (!r || !r.ok) throw new Error(`Failed to fetch telemetry for: ${agentName}`)
  return r.json()
}

export async function fetchUnassignedAssets() {
  const r = await authFetch(`${BASE}/assets/registry/unassigned`)
  if (!r || !r.ok) throw new Error('Failed to fetch unassigned assets')
  return r.json()
}

export async function claimAsset(agentName, body) {
  const r = await authFetch(`${BASE}/assets/${encodeURIComponent(agentName)}/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!r || !r.ok) throw new Error('Failed to claim asset')
  return r.json()
}

export async function updateAssetRegistry(agentName, body) {
  const r = await authFetch(`${BASE}/assets/${encodeURIComponent(agentName)}/registry`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!r || !r.ok) throw new Error('Failed to update asset')
  return r.json()
}

// ── Agent Inventory API ───────────────────────────────────────────────────────

export async function fetchAgents(params = {}) {
  const q = new URLSearchParams(
    Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''))
  ).toString()
  const r = await authFetch(`${BASE}/agents${q ? `?${q}` : ''}`)
  if (!r || !r.ok) throw new Error('Failed to fetch agents')
  return r.json()
}

export async function fetchAgentsSummary(days = 90) {
  const r = await authFetch(`${BASE}/agents/summary?days=${days}`)
  if (!r || !r.ok) throw new Error('Failed to fetch agents summary')
  return r.json()
}

export async function fetchAgentDetail(agentId, days = 90) {
  const r = await authFetch(`${BASE}/agents/${encodeURIComponent(agentId)}?days=${days}`)
  if (!r || !r.ok) throw new Error(`Failed to fetch agent: ${agentId}`)
  return r.json()
}

export async function updateInventoryAgent(agentId, data) {
  const r = await authFetch(`${BASE}/agents/${encodeURIComponent(agentId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!r || !r.ok) throw await apiError(r, 'Failed to update agent')
  return r.json()
}

// Normalize any backend error payload into a readable string. Handles FastAPI
// detail-as-string, this app's 500 shape ({detail:{error:{message,trace_id}}}),
// 422 validation arrays ([{msg}]), {message}, and generic objects. Never returns
// an object, so callers can safely render the resulting Error.message.
export function parseApiError(payload, fallback = 'Something went wrong') {
  const d = payload?.detail
  if (typeof d === 'string' && d) return d
  if (d?.error?.message) return d.error.message + (d.error.trace_id ? ` (trace: ${d.error.trace_id})` : '')
  if (Array.isArray(d)) {
    const msgs = d.map(e => e?.msg).filter(Boolean)
    if (msgs.length) return msgs.join('; ')
  }
  if (typeof payload?.message === 'string' && payload.message) return payload.message
  if (d && typeof d === 'object' && typeof d.message === 'string') return d.message
  return fallback
}

// Build a clean Error from a non-ok (or null) response. authFetch returns null
// on 401/no-token — surface a readable session message instead of null.json().
async function apiError(resp, fallback) {
  if (!resp) return new Error('Your session has expired — please sign in again.')
  const payload = await resp.json().catch(() => ({}))
  return new Error(parseApiError(payload, fallback))
}

export async function claimInventoryAgent(agentId, body) {
  const r = await authFetch(`${BASE}/agents/${encodeURIComponent(agentId)}/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!r || !r.ok) throw await apiError(r, 'Failed to claim agent')
  return r.json()
}

export async function validateInventoryAgent(agentId, body) {
  const r = await authFetch(`${BASE}/agents/${encodeURIComponent(agentId)}/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!r || !r.ok) throw await apiError(r, 'Failed to validate agent')
  return r.json()
}

export async function rejectInventoryAgent(agentId, rejectionReason) {
  const r = await authFetch(`${BASE}/agents/${encodeURIComponent(agentId)}/reject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rejection_reason: rejectionReason }),
  })
  if (!r || !r.ok) throw await apiError(r, 'Failed to reject agent')
  return r.json()
}

// Approve the system's suggested owner/team/environment and mark the agent managed.
// Body may override any suggestion; an empty body accepts all server-derived suggestions.
export async function approveSuggestions(agentId, body = {}) {
  const r = await authFetch(`${BASE}/agents/${encodeURIComponent(agentId)}/approve-suggestions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!r || !r.ok) throw await apiError(r, 'Failed to approve suggestions')
  return r.json()
}

// Dismiss an agent from the urgent review queue without retiring or deleting it.
export async function ignoreInventoryAgent(agentId, reason = '') {
  const r = await authFetch(`${BASE}/agents/${encodeURIComponent(agentId)}/ignore`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason }),
  })
  if (!r || !r.ok) throw await apiError(r, 'Failed to ignore agent')
  return r.json()
}

// ── Cost Intelligence ─────────────────────────────────────────────────────────

export async function fetchCostIntelligence(params = {}) {
  const q = new URLSearchParams(
    Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''))
  ).toString()
  const r = await authFetch(`${BASE}/cost-intelligence${q ? `?${q}` : ''}`)
  if (!r || !r.ok) throw new Error('Failed to fetch cost intelligence')
  return r.json()
}

export async function importProviderBilling(provider, data) {
  const r = await authFetch(`${BASE}/billing/${encodeURIComponent(provider)}/import`, {
    method: 'POST',
    body: JSON.stringify(data),
  })
  if (!r || !r.ok) {
    const err = await r.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to import billing data')
  }
  return r.json()
}

export async function fetchBillingPeriods() {
  const r = await authFetch(`${BASE}/billing/periods`)
  if (!r || !r.ok) throw new Error('Failed to fetch billing periods')
  return r.json()
}

export async function fetchBillingPeriod(periodId) {
  const r = await authFetch(`${BASE}/billing/periods/${periodId}`)
  if (!r || !r.ok) throw new Error('Failed to fetch billing period')
  return r.json()
}

export async function updateBillingPeriod(periodId, data) {
  const r = await authFetch(`${BASE}/billing/periods/${periodId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  })
  if (!r || !r.ok) {
    const err = await r.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to update billing record')
  }
  return r.json()
}

export async function fetchAgentCostDetail(agentId, days = 90) {
  const r = await authFetch(`${BASE}/agents/${encodeURIComponent(agentId)}/cost?days=${days}`)
  if (!r || !r.ok) throw new Error(`Failed to fetch cost data for agent: ${agentId}`)
  return r.json()
}

// ── Pricing Registry ──────────────────────────────────────────────────────────

export async function fetchPricingRegistry(params = {}) {
  const q = new URLSearchParams(
    Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''))
  ).toString()
  const r = await authFetch(`${BASE}/pricing-registry${q ? `?${q}` : ''}`)
  if (!r || !r.ok) throw new Error('Failed to fetch pricing registry')
  return r.json()
}

export async function fetchPricingModelHistory(provider, model) {
  const r = await authFetch(`${BASE}/pricing-registry/${encodeURIComponent(provider)}/${encodeURIComponent(model)}/history`)
  if (!r || !r.ok) throw new Error(`Failed to fetch pricing history for ${provider}/${model}`)
  return r.json()
}

export async function fetchPricingStatus() {
  const r = await authFetch(`${BASE}/pricing-registry/status`)
  if (!r || !r.ok) throw new Error('Failed to fetch pricing status')
  return r.json()
}

export async function overridePricing(data) {
  const r = await authFetch(`${BASE}/pricing-registry/override`, {
    method: 'POST',
    body: JSON.stringify(data),
  })
  if (!r || !r.ok) {
    const err = await r.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to apply pricing override')
  }
  return r.json()
}

export async function triggerPricingSync() {
  const r = await authFetch(`${BASE}/pricing-registry/sync`, { method: 'POST' })
  if (!r || !r.ok) throw new Error('Failed to trigger pricing sync')
  return r.json()
}

export async function fetchOrgConfig() {
  const r = await authFetch(`${BASE}/settings/config`)
  if (!r || !r.ok) throw new Error('Failed to fetch org config')
  return r.json()
}

export async function updateOrgConfig(key, value) {
  const r = await authFetch(`${BASE}/settings/config/${key}`, {
    method: 'PUT',
    body: JSON.stringify({ value }),
  })
  if (!r || !r.ok) throw new Error('Failed to update org config')
  return r.json()
}

export async function fetchPricingSyncStatus() {
  const r = await authFetch(`${BASE}/pricing-registry/sync-status`)
  if (!r || !r.ok) throw new Error('Failed to fetch sync status')
  return r.json()
}

export async function fetchRelationships(params = {}) {
  const q = new URLSearchParams()
  if (params.source_agent_name) q.set('source_agent_name', params.source_agent_name)
  if (params.target_type)        q.set('target_type',        params.target_type)
  if (params.relationship_type)  q.set('relationship_type',  params.relationship_type)
  const r = await authFetch(`${BASE}/relationships?${q}`)
  if (!r || !r.ok) throw new Error('Failed to fetch relationships')
  return r.json()
}

export async function fetchRelationshipsGraph() {
  const r = await authFetch(`${BASE}/relationships/graph`)
  if (!r || !r.ok) throw new Error('Failed to fetch relationship graph')
  return r.json()
}

export async function populateOrganization(orgId) {
  const r = await authFetch(`${BASE}/admin/organizations/${orgId}/populate`, { method: 'POST' })
  if (!r) throw new Error('Not authenticated')
  if (!r.ok) {
    const err = await r.json().catch(() => ({}))
    throw new Error(err.detail || `Populate failed (HTTP ${r.status})`)
  }
  return r.json()
}

export async function clearOrganizationDemoData(orgId) {
  const r = await authFetch(`${BASE}/admin/organizations/${orgId}/demo-data`, { method: 'DELETE' })
  if (!r) throw new Error('Not authenticated')
  if (!r.ok) {
    const err = await r.json().catch(() => ({}))
    throw new Error(err.detail || `Clear failed (HTTP ${r.status})`)
  }
  return r.json()
}
