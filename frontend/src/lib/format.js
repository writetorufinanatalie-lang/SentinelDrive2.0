import { locale, tr } from './i18n-core.js'

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })

export function money(v, currency = 'INR') {
  if (v == null) return '—'
  if (currency === 'INR') return inr.format(v)
  return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 }).format(v)
}

export function compactMoney(v, currency = 'INR') {
  if (v == null) return '—'
  if (currency === 'INR') {
    if (v >= 1e7) return `₹${(v / 1e7).toFixed(2)} ${tr('money.cr')}`
    if (v >= 1e5) return `₹${(v / 1e5).toFixed(2)} ${tr('money.lakh')}`
  }
  return money(v, currency)
}

export function when(ts) {
  if (!ts) return '—'
  const d = new Date(ts)
  const diff = (Date.now() - ts) / 1000
  const loc = locale()
  if (diff < 45) return tr('time.now')
  if (diff < 3600) return tr('time.min', { n: Math.round(diff / 60) })
  if (diff < 86400 && new Date().getDate() === d.getDate()) return tr('time.today', { time: d.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' }) })
  return d.toLocaleString(loc, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export function dateTime(ts) {
  return ts ? new Date(ts).toLocaleString(locale(), { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'
}

export const coords = (lat, lng) => (lat == null ? null : `${lat.toFixed(5)}, ${lng.toFixed(5)}`)

export const place = (site) =>
  site?.address?.label || (site?.lat != null ? coords(site.lat, site.lng) : tr('place.none'))

export const capital = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '')

export const STATUSES = ['reported', 'acknowledged', 'assigned', 'in_progress', 'completed', 'verified', 'reopened', 'rejected']
export const OPEN_STATUSES = ['reported', 'acknowledged', 'assigned', 'in_progress', 'completed', 'reopened']
export const statusLabel = (s) => (STATUSES.includes(s) ? tr(`status.${s}`) : capital(s))
export const severityLabel = (s) => (['high', 'medium', 'low'].includes(s) ? tr(`sev.${s}`) : capital(s))
