// In dev, VITE_API_BASE is empty and Vite proxy rewrites /api/* → http://localhost:8000/*.
// In production, VITE_API_BASE is the full backend origin — no /api prefix needed.
// Accept either VITE_API_BASE (preferred) or VITE_API_URL (Render fromService host),
// and normalize a bare hostname like "aifinops-backend.onrender.com" to a full https URL.
function resolveBase() {
  let raw = import.meta.env.VITE_API_BASE || import.meta.env.VITE_API_URL || ''
  raw = raw.trim().replace(/\/+$/, '')                    // strip trailing slashes
  if (!raw) return '/api'                                 // dev: Vite proxy handles /api/*
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`  // bare host → add scheme
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

function authHeaders(extra = {}) {
  const token = getToken()
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
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
    throw new Error(err.detail || 'Failed to save credential')
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
