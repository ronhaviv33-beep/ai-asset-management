const BASE = '/api'

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
  const resp = await fetch(url, {
    ...options,
    headers: { ...authHeaders(), ...(options.headers || {}) },
  })
  if (resp.status === 401) {
    setToken(null)
    window.location.reload()
    return
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
