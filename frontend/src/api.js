import { getToken, setSession } from './lib/auth'
import { getCitizenToken, signOut as citizenSignOut } from './lib/citizen'

// Staff pages send the staff token; everything else sends the citizen token if there is one.
const isStaffPath = (p) => /^\/api\/(municipal|auth)\b/.test(p) || /^\/api\/settings\/rate-card/.test(p) || p.startsWith('/api/potholes/recalculate')

async function req(path, opts = {}) {
  const staffCall = isStaffPath(path)
  const token = staffCall ? getToken() : getCitizenToken()
  if (token) opts = { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}` } }
  const res = await fetch(path, opts)
  const isJson = (res.headers.get('content-type') || '').includes('json')
  const body = isJson ? await res.json() : await res.text()
  if (res.status === 401 && token && !path.includes('/login') && !path.includes('/register')) {
    // expired, revoked or invalid: back to the matching sign-in page
    staffCall ? setSession(null) : citizenSignOut()
  }
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
  // citizen accounts
  citizenRegister: (name, contact, password) => req('/api/citizen/register', json('POST', { name, contact, password })),
  citizenLogin: (contact, password) => req('/api/citizen/login', json('POST', { contact, password })),
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
  changePassword: (current, next) => req('/api/auth/password', json('POST', { current, new: next })),
  staffList: () => req('/api/municipal/staff'),
  addStaff: (username, role, password) => req('/api/municipal/staff', json('POST', { username, role, password })),
  resetStaffPassword: (u, password) => req(`/api/municipal/staff/${encodeURIComponent(u)}/password`, json('POST', { password })),
  setStaffActive: (u, active) => req(`/api/municipal/staff/${encodeURIComponent(u)}/active`, json('POST', { active })),
  alerts: () => req('/api/municipal/alerts'),
  saveRoutes: (routes) => req('/api/municipal/alerts/routes', json('PUT', { routes })),
  testAlert: (email) => req('/api/municipal/alerts/test', json('POST', { email })),
  prefs: () => req('/api/settings/preferences'),
  savePrefs: (v) => req('/api/settings/preferences', json('PUT', v)),
}

export const workOrderUrl = (id) => `/api/potholes/${id}/work-order.pdf`
export const verificationUrl = (id) => `/api/potholes/${id}/verification.pdf`
