import { useEffect, useState } from 'react'
import { api } from '../../api'
import { useLive } from '../../hooks/useLive'
import { DailyBars } from '../../components/Charts'
import { compactMoney } from '../../lib/format'
import { cap } from './shared'

function HBars({ data, color = 'var(--series-1)', label = (k) => k }) {
  const max = Math.max(1, ...Object.values(data))
  return (
    <div className="hbars">
      {Object.entries(data).map(([k, v]) => (
        <div key={k} className="hbar">
          <span className="small">{label(k)}</span>
          <span className="hbar-track"><i style={{ width: `${(v / max) * 100}%`, background: color }} /></span>
          <span className="num small">{v}</span>
        </div>
      ))}
    </div>
  )
}

const Num = ({ label, value, sub }) => (
  <div className="kpi"><div className="label">{label}</div><div className="value">{value}</div><div className="sub">{sub || ' '}</div></div>
)

export default function Analytics() {
  const { potholes } = useLive()
  const [s, setS] = useState(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    api.summary().then(setS).catch((e) => setErr(e.message))
  }, [potholes])
  if (err) return <div className="note error">{err}</div>
  if (!s) return <p className="muted">Loading…</p>
  const a = s.analytics, c = s.cards
  const hrs = (h) => (h == null ? '—' : h < 48 ? `${h} h` : `${(h / 24).toFixed(1)} days`)
  return (
    <div className="stack">
      <section className="kpis municipal-kpis">
        <Num label="Unique cases" value={c.unique_cases} />
        <Num label="Citizen submissions" value={c.citizen_reports} />
        <Num label="Unique citizens affected" value={c.citizens_affected} />
        <Num label="Repairs completed" value={c.awaiting_verification + c.verified} sub="done, including awaiting check" />
        <Num label="Repairs verified" value={c.verified} />
        <Num label="Cases verified" value={`${a.pct_verified}%`} sub="of all real cases" />
        <Num label="Avg time to acknowledge" value={hrs(a.avg_ack_hours)} />
        <Num label="Median time to completion" value={hrs(a.median_completion_hours)} />
        <Num label="Overdue" value={c.overdue} />
        <Num label="Reopened" value={c.reopened} />
        <Num label="Estimated expenditure" value={compactMoney(a.estimated_total)} sub="all cases, estimate" />
        <Num label="Actual expenditure" value={compactMoney(a.actual_total)} sub={`entered for ${a.with_actual} case(s)`} />
      </section>

      <section className="panel">
        <div className="panel-head"><h2>Estimated vs actual cost</h2><span className="aside">only cases where an actual cost was entered</span></div>
        <div className="panel-body">
          {a.with_actual === 0 ? <p className="muted">No actual costs entered yet.</p> : (
            <HBars data={{ Estimated: Math.round(a.estimated_for_actual), Actual: Math.round(a.actual_total) }} label={(k) => `${k} (₹)`} />
          )}
        </div>
      </section>

      <div className="two-col">
        <section className="panel">
          <div className="panel-head"><h2>Reports and repairs, last 14 days</h2></div>
          <div className="panel-body"><DailyBars data={a.daily.map((d) => ({ day: d.day, reported: d.reported, repaired: d.completed }))} /></div>
        </section>
        <section className="panel">
          <div className="panel-head"><h2>Cases by status</h2></div>
          <div className="panel-body"><HBars data={a.by_status} label={(k) => cap(k.replace('_', ' '))} /></div>
        </section>
        <section className="panel">
          <div className="panel-head"><h2>Open cases by priority</h2></div>
          <div className="panel-body"><HBars data={a.by_priority} color="var(--high)" label={cap} /></div>
        </section>
        <section className="panel">
          <div className="panel-head"><h2>Citizen reports per case</h2><span className="aside">unique citizens</span></div>
          <div className="panel-body"><HBars data={a.citizens_per_case} color="var(--series-2)" label={(k) => `${k} citizen${k === '1' ? '' : 's'}`} /></div>
        </section>
        <section className="panel">
          <div className="panel-head"><h2>Where cases are</h2><span className="aside">by ward or authority</span></div>
          <div className="panel-body"><HBars data={a.by_area} /></div>
        </section>
      </div>
      <p className="muted small">All figures are calculated from the stored cases. Costs are estimates unless marked actual.</p>
    </div>
  )
}
