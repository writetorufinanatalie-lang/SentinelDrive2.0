import { useEffect, useState } from 'react'
import { api } from '../../api'
import { useLive } from '../../hooks/useLive'
import { Status } from '../../components/bits'
import { compactMoney, place, when } from '../../lib/format'
import CaseDrawer from './CaseDrawer'
import { cap } from './shared'

const CARDS = [
  ['unique_cases', 'Unique pothole cases', 'one case can have many reports'],
  ['citizen_reports', 'Citizen reports received', 'every submission, including repeats'],
  ['citizens_affected', 'Citizens affected', 'unique reporters, summed over cases'],
  ['awaiting_ack', 'Awaiting acknowledgement', 'new, nobody has responded'],
  ['awaiting_assignment', 'Awaiting assignment', 'acknowledged or reopened'],
  ['assigned', 'Assigned', 'team chosen, work not started'],
  ['in_progress', 'Repairs in progress', ''],
  ['awaiting_verification', 'Awaiting verification', 'repair done, photo to check'],
  ['verified', 'Verified repairs', ''],
  ['reopened', 'Reopened', 'rejected repair or problem returned'],
  ['overdue', 'Overdue', 'past target date, or open too long'],
  ['needs_review', 'Duplicate matches to review', 'citizen said same, photos unsure'],
]

export default function Dashboard({ user, go }) {
  const { potholes } = useLive()
  const [sum, setSum] = useState(null)
  const [queue, setQueue] = useState([])
  const [openId, setOpenId] = useState(null)
  const [err, setErr] = useState('')

  const load = () => {
    api.summary().then(setSum).catch((e) => setErr(e.message))
    api.cases({ status: 'reported,acknowledged,assigned,in_progress,reopened', sort: 'priority', limit: 8 }).then((d) => setQueue(d.items)).catch(() => {})
  }
  useEffect(load, [potholes])

  if (err) return <div className="note error">{err}</div>
  if (!sum) return <p className="muted">Loading…</p>
  const c = sum.cards
  return (
    <div className="stack">
      <section className="kpis municipal-kpis" aria-label="Case counts">
        {CARDS.map(([k, label, sub]) => (
          <div className="kpi" key={k}>
            <div className="label">{label}</div>
            <div className="value" style={{ color: (k === 'overdue' || k === 'needs_review') && c[k] ? 'var(--high)' : undefined }}>{c[k]}</div>
            <div className="sub">{sub || ' '}</div>
          </div>
        ))}
        <div className="kpi">
          <div className="label">Estimated repair expenditure</div>
          <div className="value">{compactMoney(c.estimated_open)}</div>
          <div className="sub">open cases, incl. GST (estimate)</div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head"><h2>Priority queue</h2><span className="aside">Highest priority first · <a href="#/municipality/cases">all cases</a></span></div>
        <div className="panel-body">
          {queue.length === 0 ? (
            <p className="muted">No open cases.</p>
          ) : (
            <ul className="queue">
              {queue.map((s) => (
                <li key={s.id}>
                  <button className="queue-item" onClick={() => setOpenId(s.id)}>
                    <img src={s.evidence[0].annotated} alt="" />
                    <span className="q-main">
                      <strong>{s.id}</strong> <Status status={s.status} />
                      <span className="muted small">{place(s)}</span>
                      <span className="small">{s.priority_info.reasons_text || `${s.citizens} citizens · ${s.severity} severity · open ${Math.round(s.priority_info.days_open)} days`}</span>
                    </span>
                    <span className={`prio ${s.priority_info.category === 'critical' ? 'high' : s.priority_info.category}`}>{s.priority}</span>
                    <span className="small muted">{cap(s.priority_info.category)} · {when(s.created_at)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
      {openId && <CaseDrawer id={openId} user={user} onClose={() => setOpenId(null)} onChanged={load} />}
    </div>
  )
}
