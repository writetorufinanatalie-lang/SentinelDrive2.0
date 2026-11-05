import { useCallback, useEffect, useState } from 'react'
import { api } from '../../api'
import { useLive } from '../../hooks/useLive'
import { Severity, Status } from '../../components/bits'
import { dateTime, money, place } from '../../lib/format'
import CaseDrawer from './CaseDrawer'
import { PRIORITIES, cap } from './shared'

const PAGE = 20
const STATUS_OPTIONS = [['open', 'Open (not closed)'], ['', 'All'], ['reported', 'Reported'], ['acknowledged', 'Acknowledged'], ['assigned', 'Assigned'], ['in_progress', 'In progress'], ['completed', 'Awaiting verification'], ['verified', 'Verified'], ['reopened', 'Reopened'], ['rejected', 'Not a pothole']]
const OPEN = 'reported,acknowledged,assigned,in_progress,completed,reopened'

export default function Cases({ user, initial = {} }) {
  const { potholes } = useLive()
  const [f, setF] = useState({ status: 'open', priority: '', team: '', min: '0', q: '', sort: 'priority', overdue: false, review: false, ...initial })
  const [page, setPage] = useState(0)
  const [data, setData] = useState({ total: 0, items: [] })
  const [teams, setTeams] = useState([])
  const [openId, setOpenId] = useState(null)
  const [err, setErr] = useState('')

  const set = (k) => (e) => {
    setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
    setPage(0)
  }

  const load = useCallback(() => {
    const p = { sort: f.sort, limit: PAGE, offset: page * PAGE }
    if (f.status) p.status = f.status === 'open' ? OPEN : f.status
    if (f.priority) p.priority = f.priority
    if (f.team) p.team = f.team
    if (Number(f.min) > 0) p.min_citizens = f.min
    if (f.q.trim()) p.q = f.q.trim()
    if (f.overdue) p.overdue = true
    if (f.review) p.needs_review = true
    api.cases(p).then((d) => { setData(d); setErr('') }).catch((e) => setErr(e.message))
  }, [f, page])

  useEffect(() => {
    const t = setTimeout(load, f.q ? 250 : 0)
    return () => clearTimeout(t)
  }, [load, potholes])
  useEffect(() => {
    api.teams().then(setTeams).catch(() => {})
  }, [])

  const pages = Math.max(1, Math.ceil(data.total / PAGE))
  return (
    <div className="stack">
      <div className="toolbar filters">
        <select value={f.status} onChange={set('status')} aria-label="Status">{STATUS_OPTIONS.map(([v, l]) => <option key={l} value={v}>{l}</option>)}</select>
        <select value={f.priority} onChange={set('priority')} aria-label="Priority"><option value="">Any priority</option>{PRIORITIES.map((p) => <option key={p} value={p}>{cap(p)}</option>)}</select>
        <select value={f.team} onChange={set('team')} aria-label="Team"><option value="">Any team</option>{teams.map((t) => <option key={t.id}>{t.name}</option>)}</select>
        <select value={f.min} onChange={set('min')} aria-label="Citizens affected"><option value="0">Any citizens</option><option value="2">2+ citizens</option><option value="5">5+ citizens</option><option value="10">10+ citizens</option></select>
        <select value={f.sort} onChange={set('sort')} aria-label="Sort"><option value="priority">Highest priority</option><option value="citizens">Most citizens affected</option><option value="oldest">Oldest unresolved</option><option value="newest">Most recently reported</option><option value="cost">Highest estimated cost</option></select>
        <input type="search" value={f.q} onChange={set('q')} placeholder="Case ID or location" aria-label="Search" />
        <label className="small"><input type="checkbox" checked={f.overdue} onChange={set('overdue')} /> Overdue</label>
        <label className="small"><input type="checkbox" checked={f.review} onChange={set('review')} /> Needs review</label>
      </div>
      {err && <div className="note error">{err}</div>}
      <div className="panel">
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr><th>Case</th><th>Location</th><th>Priority</th><th className="r">Citizens</th><th>Status</th><th>Team</th><th className="r">Estimate</th><th>Updated</th></tr>
            </thead>
            <tbody>
              {data.items.map((s) => (
                <tr key={s.id} onClick={() => setOpenId(s.id)} className="clickable" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setOpenId(s.id)}>
                  <td><strong>{s.id}</strong><div className="muted small">{dateTime(s.created_at)}</div></td>
                  <td>{place(s)}{s.needs_review && <div className="small" style={{ color: 'var(--medium)' }}>Needs review</div>}</td>
                  <td><span className={`prio ${s.priority_info.category === 'critical' ? 'high' : s.priority_info.category}`}>{s.priority}</span> {cap(s.priority_info.category)}{s.priority_info.overridden ? ' *' : ''}</td>
                  <td className="r">{s.citizens}<div className="muted small">{s.reports} reports</div></td>
                  <td><Status status={s.status} />{s.overdue && <div className="small" style={{ color: 'var(--high)' }}>Overdue</div>}</td>
                  <td>{s.assignment?.team || <span className="muted">—</span>}</td>
                  <td className="r">{money(s.estimate?.total)}</td>
                  <td className="muted small">{dateTime(s.history[s.history.length - 1]?.ts)}</td>
                </tr>
              ))}
              {data.items.length === 0 && <tr><td colSpan={8} className="muted" style={{ padding: 20 }}>No cases match these filters.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="pager">
          <span className="muted small">{data.total} cases · page {page + 1} of {pages}</span>
          <button className="btn btn-sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
          <button className="btn btn-sm" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      </div>
      {openId && <CaseDrawer id={openId} user={user} onClose={() => setOpenId(null)} onChanged={load} />}
    </div>
  )
}
