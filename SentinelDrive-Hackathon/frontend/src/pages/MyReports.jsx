import { useEffect, useState } from 'react'
import { api } from '../api'
import { useLive } from '../hooks/useLive'
import { BeforeAfter } from '../components/Evidence'
import { Empty, Severity, Status, useTick } from '../components/bits'
import { dateTime, money, place, statusLabel, when } from '../lib/format'
import { getReporterId } from '../lib/reporter'
import { useI18n } from '../lib/i18n'

const STEPS = ['reported', 'verified', 'scheduled', 'repaired']

// Read-only: citizens can follow a report but cannot change its repair status.
function Progress({ site }) {
  const { t } = useI18n()
  const at = (s) => site.history.find((h) => h.status === s)?.ts
  const now = STEPS.indexOf(site.status)
  return (
    <ol className="track" aria-label={t('reports.progress')}>
      {STEPS.map((s, i) => (
        <li key={s} className={i < now ? 'done' : i === now ? 'now' : ''}>
          <span className="dotm" />
          <strong>{statusLabel(s)}</strong>
          <span className="muted small">{at(s) ? dateTime(at(s)) : ''}</span>
        </li>
      ))}
    </ol>
  )
}

export default function MyReports() {
  useTick()
  const { t } = useI18n()
  const { potholes } = useLive()
  const [rows, setRows] = useState(null)
  const [open, setOpen] = useState(null)
  const [err, setErr] = useState('')

  // Reload on mount and whenever the live feed changes, so status updates show up by themselves.
  useEffect(() => {
    let alive = true
    api
      .myPotholes(getReporterId())
      .then((r) => alive && (setRows(r.sort((a, b) => b.created_at - a.created_at)), setErr('')))
      .catch((e) => alive && setErr(e.message))
    return () => {
      alive = false
    }
  }, [potholes])

  if (err) return <div className="note warn">{err}</div>
  if (!rows) return <p className="muted">…</p>
  return (
    <div className="stack">
      <p className="muted small">{t('reports.privacy')}</p>
      {rows.length === 0 ? (
        <div className="panel"><Empty title={t('reports.empty.title')}>{t('reports.empty.sub')}</Empty></div>
      ) : (
        rows.map((s) => {
          const first = s.evidence[0]
          const isOpen = open === s.id
          return (
            <article key={s.id} className="panel report-card">
              <div className="rc-head">
                <img src={first.annotated || first.photo} alt="" className="rc-img" />
                <div className="rc-main">
                  <div className="rc-title"><strong>{s.id}</strong> <Status status={s.status} /> <Severity level={s.severity} /></div>
                  <div className="muted small">{place(s)}</div>
                  <div className="small">{dateTime(s.created_at)} · {when(s.history[s.history.length - 1]?.ts)}</div>
                  <div className="small">{t('reports.same', { n: s.citizens })} · {money(s.estimate?.total)}</div>
                </div>
                <button className="btn btn-sm" onClick={() => setOpen(isOpen ? null : s.id)} aria-expanded={isOpen}>
                  {isOpen ? t('reports.hide') : t('reports.details')}
                </button>
              </div>
              {isOpen && (
                <div className="rc-body">
                  {s.status === 'rejected' ? <div className="note warn">{t('reports.rejected')}</div> : <Progress site={s} />}
                  <BeforeAfter site={s} />
                </div>
              )}
            </article>
          )
        })
      )}
    </div>
  )
}
