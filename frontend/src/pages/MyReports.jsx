import { useEffect, useMemo, useState } from 'react'
import { FileText } from 'lucide-react'
import { api, verificationUrl, workOrderUrl } from '../api'
import { useLive } from '../hooks/useLive'
import { BeforeAfter, PriorityWhy } from '../components/Evidence'
import MapView from '../components/MapView'
import { Empty, Severity, Status, toast, useTick } from '../components/bits'
import { STATUSES, dateTime, money, place, statusLabel, when } from '../lib/format'
import { getReporterId } from '../lib/reporter'
import { useI18n } from '../lib/i18n'

const STEPS = ['reported', 'acknowledged', 'assigned', 'in_progress', 'completed', 'verified']

// Read-only: citizens follow a report here but cannot change its repair status.
function Progress({ site }) {
  const { t } = useI18n()
  const at = (s) => site.history.find((h) => h.status === s)?.ts
  const now = site.status === 'reopened' ? STEPS.indexOf('assigned') - 1 : STEPS.indexOf(site.status)
  return (
    <>
      <ol className="track" aria-label={t('reports.progress')}>
        {STEPS.map((s, i) => (
          <li key={s} className={i < now ? 'done' : i === now ? 'now' : ''}>
            <strong>{statusLabel(s)}</strong>
            <span className="muted small">{at(s) ? dateTime(at(s)) : ''}</span>
          </li>
        ))}
      </ol>
      {site.status === 'reopened' && <div className="note warn" style={{ marginTop: 8 }}><strong>{statusLabel('reopened')}.</strong> {[...site.history].reverse().find((h) => h.status === 'reopened')?.note}</div>}
    </>
  )
}

function Notifications({ items, onRead }) {
  const { t } = useI18n()
  const unread = items.filter((n) => n.status === 'unread').length
  return (
    <section className="panel" style={{ padding: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <h3>{t('notif.title')}</h3>
        {unread > 0 && <span className="count-badge">{unread}</span>}
        {unread > 0 && <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={onRead}>{t('notif.read')}</button>}
      </div>
      {items.length === 0 ? (
        <p className="muted small">{t('notif.empty')}</p>
      ) : (
        <ul className="notif">
          {items.slice(0, 8).map((n) => (
            <li key={n.id} className={n.status === 'unread' ? 'unread' : ''}>
              {t(`notif.${n.code}`, n.vars)} <span className="muted small">{when(n.created_at)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export default function MyReports() {
  useTick()
  const { t } = useI18n()
  const { potholes } = useLive()
  const rid = getReporterId()
  const [rows, setRows] = useState(null)
  const [notes, setNotes] = useState([])
  const [open, setOpen] = useState(null)
  const [err, setErr] = useState('')
  const [filter, setFilter] = useState('all')
  const [q, setQ] = useState('')
  const [pickFor, setPickFor] = useState(null)

  // Reload on mount and whenever the live feed changes, so status updates show up by themselves.
  useEffect(() => {
    let alive = true
    Promise.all([api.myPotholes(rid), api.notifications(rid)])
      .then(([r, n]) => {
        if (!alive) return
        setRows(r.sort((a, b) => b.created_at - a.created_at))
        setNotes(n)
        setErr('')
      })
      .catch((e) => alive && setErr(e.message))
    return () => {
      alive = false
    }
  }, [potholes, rid])

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return (rows || []).filter((s) => (filter === 'all' || s.status === filter) && (!needle || s.id.toLowerCase().includes(needle) || place(s).toLowerCase().includes(needle)))
  }, [rows, filter, q])

  if (err) return <div className="note warn">{err}</div>
  if (!rows) return <p className="muted">…</p>
  const lastTs = (s) => s.history[s.history.length - 1]?.ts

  return (
    <div className="stack">
      <p className="muted small">{t('reports.privacy')}</p>
      <Notifications items={notes} onRead={() => api.readNotifications(rid).then(() => setNotes(notes.map((n) => ({ ...n, status: 'read' }))))} />
      {rows.length > 0 && (
        <div className="toolbar">
          <div className="seg" role="group">
            {['all', ...STATUSES.filter((s) => rows.some((r) => r.status === s))].map((f) => (
              <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>{f === 'all' ? t('filter.all') : statusLabel(f)}</button>
            ))}
          </div>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('mr.search')} aria-label={t('mr.search')} />
        </div>
      )}
      {rows.length === 0 ? (
        <div className="panel"><Empty title={t('reports.empty.title')}>{t('reports.empty.sub')}</Empty></div>
      ) : (
        shown.map((s) => {
          const first = s.evidence[0]
          const isOpen = open === s.id
          return (
            <article key={s.id} className="panel report-card">
              <div className="rc-head">
                <img src={first.annotated || first.photo} alt="" className="rc-img" />
                <div className="rc-main">
                  <div className="rc-title"><strong>{s.id}</strong> <Status status={s.status} /> <Severity level={s.severity} /></div>
                  <div className="muted small">{place(s)}</div>
                  <div className="small">{dateTime(s.created_at)} · {t('mr.last')}: {when(lastTs(s))}</div>
                  <div className="small">{t('reports.same', { n: s.citizens })} · {money(s.estimate?.total)}{s.assignment?.team ? ` · ${t('mr.team')}: ${s.assignment.team}` : ''}</div>
                </div>
                <button className="btn btn-sm" onClick={() => setOpen(isOpen ? null : s.id)} aria-expanded={isOpen}>
                  {isOpen ? t('reports.hide') : t('reports.details')}
                </button>
              </div>
              {isOpen && (
                <div className="rc-body">
                  {s.status === 'rejected' ? <div className="note warn">{t('reports.rejected')} {s.history[s.history.length - 1]?.note}</div> : <Progress site={s} />}
                  {s.lat == null && (
                    <div>
                      <div className="note warn" style={{ marginBottom: 8 }}>{t('mr.setloc.note')}</div>
                      {pickFor === s.id ? (
                        <MapView
                          pickMode
                          onPick={async (p) => {
                            try {
                              await api.setLocation(s.id, rid, p)
                              toast(t('mr.setloc.done'))
                              setPickFor(null)
                            } catch (e) {
                              toast(e.message)
                            }
                          }}
                        />
                      ) : (
                        <button className="btn btn-sm" onClick={() => setPickFor(s.id)}>{t('mr.setloc')}</button>
                      )}
                    </div>
                  )}
                  <BeforeAfter site={s} />
                  <PriorityWhy site={s} />
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <a className="btn btn-sm" href={workOrderUrl(s.id)} target="_blank" rel="noreferrer"><FileText size={14} /> {t('site.workorder')}</a>
                    <a className="btn btn-sm" href={verificationUrl(s.id)} target="_blank" rel="noreferrer"><FileText size={14} /> {t('site.verification')}</a>
                  </div>
                </div>
              )}
            </article>
          )
        })
      )}
    </div>
  )
}
