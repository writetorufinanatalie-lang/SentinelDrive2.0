import { useEffect, useState } from 'react'
import { api } from '../../api'
import { useLive } from '../../hooks/useLive'
import MapView from '../../components/MapView'
import { Status } from '../../components/bits'
import { money, place } from '../../lib/format'
import CaseDrawer from './CaseDrawer'
import { PRIORITIES, cap } from './shared'

const LEGEND = [['#b3261e', 'Critical or high priority, unresolved'], ['#d9730d', 'Assigned, in progress or completed'], ['#3b8a4a', 'Verified'], ['#c9a400', 'Waiting to be acknowledged or assigned']]

export default function MapPage({ user }) {
  const { potholes } = useLive()
  const [items, setItems] = useState([])
  const [status, setStatus] = useState('')
  const [priority, setPriority] = useState('')
  const [pick, setPick] = useState(null)
  const [openId, setOpenId] = useState(null)

  useEffect(() => {
    const p = { limit: 200, sort: 'priority' }
    if (status) p.status = status
    if (priority) p.priority = priority
    api.cases(p).then((d) => setItems(d.items)).catch(() => {})
  }, [status, priority, potholes])

  const chosen = items.find((s) => s.id === pick)
  return (
    <div className="stack">
      <div className="toolbar">
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">All statuses</option>
          {['reported', 'acknowledged', 'assigned', 'in_progress', 'completed', 'verified', 'reopened', 'rejected'].map((s) => <option key={s} value={s}>{cap(s.replace('_', ' '))}</option>)}
        </select>
        <select value={priority} onChange={(e) => setPriority(e.target.value)} aria-label="Priority">
          <option value="">Any priority</option>
          {PRIORITIES.map((p) => <option key={p} value={p}>{cap(p)}</option>)}
        </select>
        <span className="legend-inline">{LEGEND.map(([c, l]) => <span key={l}><i style={{ background: c }} />{l}</span>)}</span>
      </div>
      <div className="map-split">
        <MapView sites={items} colorBy="staff" selectedId={pick} onSelect={setPick} className="tall" emptyText="No cases with a location match these filters." />
        <aside className="panel map-card">
          {chosen ? (
            <>
              <img src={chosen.evidence[0].annotated} alt="" />
              <h3>{chosen.id} <Status status={chosen.status} /></h3>
              <p className="small">{place(chosen)}</p>
              <p className="small">{chosen.citizens} citizens affected · {cap(chosen.priority_info.category)} priority · {money(chosen.estimate?.total)}</p>
              <button className="btn btn-primary btn-sm" onClick={() => setOpenId(chosen.id)}>Open case</button>
            </>
          ) : (
            <p className="muted small">Click a marker to see the case.</p>
          )}
        </aside>
      </div>
      {openId && <CaseDrawer id={openId} user={user} onClose={() => setOpenId(null)} onChanged={() => setStatus((s) => s)} />}
    </div>
  )
}
