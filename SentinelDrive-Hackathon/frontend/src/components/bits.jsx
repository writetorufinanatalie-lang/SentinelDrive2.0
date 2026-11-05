import { useEffect, useState } from 'react'
import { severityLabel, statusLabel } from '../lib/format'
import { useI18n } from '../lib/i18n'

export function Severity({ level }) {
  useI18n() // re-render when the language changes
  if (!level) return null
  return (
    <span className={`sev ${level}`}>
      <i aria-hidden="true" />
      {severityLabel(level)}
    </span>
  )
}

export function Status({ status }) {
  useI18n()
  return <span className={`status ${status}`}>{statusLabel(status)}</span>
}

export function Empty({ title, children, action }) {
  return (
    <div className="empty">
      {title && <h3>{title}</h3>}
      {children && <p>{children}</p>}
      {action}
    </div>
  )
}

let toastSet = null
export function toast(msg) {
  toastSet?.(msg)
}
export function Toaster() {
  const [msg, setMsg] = useState(null)
  useEffect(() => {
    toastSet = setMsg
    return () => {
      toastSet = null
    }
  }, [])
  useEffect(() => {
    if (!msg) return
    const t = setTimeout(() => setMsg(null), 3200)
    return () => clearTimeout(t)
  }, [msg])
  return msg ? (
    <div className="toast" role="status">
      {msg}
    </div>
  ) : null
}

// Re-render every `ms` so relative times ("3 min ago") stay current.
export function useTick(ms = 30_000) {
  const [, set] = useState(0)
  useEffect(() => {
    const t = setInterval(() => set((x) => x + 1), ms)
    return () => clearInterval(t)
  }, [ms])
}
