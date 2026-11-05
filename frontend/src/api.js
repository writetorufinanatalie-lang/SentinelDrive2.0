import { getToken, setSession } from './lib/auth'

async function req(path, opts = {}) {
  const token = getToken()
  if (token) opts = { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}` } }
  const res = await fetch(path, opts)
  const isJson = (res.headers.get('content-type') || '').includes('json')
  const body = isJson ? await res.json() : await res.text()
  if (res.status === 401 && token) setSession(null) // expired or invalid: back to the sign-in page
  if (!res.ok) {
    const msg = (isJson && (body.detail || body.message)) || `Request failed (${res.status})`
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg))
  }
  return body
}

const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

export const api = {
  health: () => req('/api/health'),
  stats: () => req('/api/stats'),
  potholes: () => req('/api/potholes'),
  pothole: (id) => req(`/api/potholes/${id}`),
  myPotholes: (rid) => req(`/api/potholes?reporter=${encodeURIComponent(rid)}`),
  notifications: (rid) => req(`/api/citizen/notifications?reporter=${encodeURIComponent(rid)}`),
  readNotifications: (rid) => req(`/api/citizen/notifications/read?reporter=${encodeURIComponent(rid)}`, { method: 'POST' }),
  setLocation: (id, rid, p) => req(`/api/potholes/${id}/location`, json('POST', { reporter: rid, lat: p.lat, lng: p.lng })),
  upload: (form) => req('/api/potholes/upload', { method: 'POST', body: form }),
  incidents: () => req('/api/incidents'),
  resolveIncident: (id) => req(`/api/incidents/${id}/resolve`, { method: 'POST' }),
  checks: () => req('/api/alertness-checks'),
  rateCard: () => req('/api/settings/rate-card'),
  saveRateCard: (v) => req('/api/settings/rate-card', json('PUT', v)),
  recalculate: () => req('/api/potholes/recalculate', { method: 'POST' }),
  // municipal dashboard (every call needs a staff sign-in)
  login: (username, password) => req('/api/auth/login', json('POST', { username, password })),
  summary: () => req('/api/municipal/summary'),
  cases: (params) => req(`/api/municipal/cases?${new URLSearchParams(params)}`),
  caseDetail: (id) => req(`/api/municipal/cases/${id}`),
  caseAction: (id, body) => req(`/api/municipal/cases/${id}/action`, json('POST', body)),
  completeCase: (id, form) => req(`/api/municipal/cases/${id}/complete`, { method: 'POST', body: form }),
  deleteCase: (id) => req(`/api/municipal/cases/${id}`, { method: 'DELETE' }),
  teams: () => req('/api/municipal/teams'),
  addTeam: (name) => req('/api/municipal/teams', json('POST', { name })),
  staffNotifications: () => req('/api/municipal/notifications'),
  readStaffNotifications: () => req('/api/municipal/notifications/read', { method: 'POST' }),
  audit: () => req('/api/municipal/audit'),
  prefs: () => req('/api/settings/preferences'),
  savePrefs: (v) => req('/api/settings/preferences', json('PUT', v)),
}

export const workOrderUrl = (id) => `/api/potholes/${id}/work-order.pdf`
export const verificationUrl = (id) => `/api/potholes/${id}/verification.pdf`
