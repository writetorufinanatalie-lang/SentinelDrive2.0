import { useMemo, useState } from 'react'
import { Car, Check, Siren, TriangleAlert } from 'lucide-react'
import { useLive } from '../hooks/useLive'
import MapView from '../components/MapView'
import { DailyBars } from '../components/Charts'
import { Empty, Severity, useTick } from '../components/bits'
import { compactMoney, money, place, statusLabel, when } from '../lib/format'
import { serverText } from '../lib/i18n-core'
import { useI18n } from '../lib/i18n'

const OPEN = ['reported', 'verified', 'scheduled']

export default function Overview({ openSite, openReport }) {
  useTick()
  const { t, lang } = useI18n()
  const { potholes, incidents, stats } = useLive()
  const [selected, setSelected] = useState(null)
  const open = useMemo(
    () => potholes.filter((p) => OPEN.includes(p.status)).sort((a, b) => b.priority - a.priority),
    [potholes],
  )
  const crashes = incidents.filter((i) => i.kind === 'crash')
  const p = stats?.potholes
  const inc = stats?.incidents_30d

  const activity = useMemo(() => {
    const items = []
    for (const s of potholes) {
      for (const h of s.history) items.push({ ts: h.ts, icon: h.status === 'repaired' ? Check : TriangleAlert, text: `${s.id}: ${statusLabel(h.status)}`, sub: place(s), id: s.id })
    }
    for (const i of incidents) {
      if (i.kind === 'crash') items.push({ ts: i.created_at, icon: Car, text: i.verified ? t('activity.crash') : t('activity.impact'), sub: i.reason })
      if (i.kind === 'siren') items.push({ ts: i.created_at, icon: Siren, text: t('activity.siren'), sub: serverText(i.guidance) })
    }
    return items.sort((a, b) => b.ts - a.ts).slice(0, 8)
  }, [potholes, incidents, lang]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <section className="kpis" aria-label={t('kpi.aria')}>
        <div className="kpi">
          <div className="label">{t('kpi.open')}</div>
          <div className="value">{p?.open ?? '—'}</div>
          <div className="sub">{p ? t('kpi.open.sub', { n: p.open_potholes }) : ' '}</div>
        </div>
        <div className="kpi">
          <div className="label">{t('kpi.high')}</div>
          <div className="value" style={{ color: p?.open_by_severity.high ? 'var(--high)' : undefined }}>{p?.open_by_severity.high ?? '—'}</div>
          <div className="sub">{p ? t('kpi.high.sub', { m: p.open_by_severity.medium, l: p.open_by_severity.low }) : ' '}</div>
        </div>
        <div className="kpi">
          <div className="label">{t('kpi.cost')}</div>
          <div className="value">{p ? compactMoney(p.open_estimate) : '—'}</div>
          <div className="sub">{t('kpi.cost.sub')}</div>
        </div>
        <div className="kpi">
          <div className="label">{t('kpi.repaired')}</div>
          <div className="value">{p?.by_status.repaired ?? '—'}</div>
          <div className="sub">{p ? t('kpi.repaired.sub', { n: p.by_status.scheduled }) : ' '}</div>
        </div>
        <div className="kpi">
          <div className="label">{t('kpi.crashes')}</div>
          <div className="value">{inc?.crashes_verified ?? '—'}</div>
          <div className="sub">{inc ? t('kpi.crashes.sub', { n: inc.crashes_suppressed }) : ' '}</div>
        </div>
      </section>

      <div className="grid-2">
        <div className="stack">
          <MapView
            sites={potholes}
            crashes={crashes}
            selectedId={selected}
            onSelect={(id) => {
              setSelected(id)
              openSite(id)
            }}
            emptyText={
              <>
                <strong>{t('map.empty.title')}</strong>
                <p className="muted small">{t('map.empty.sub')}</p>
              </>
            }
          />
          <section className="panel">
            <div className="panel-head">
              <h2>{t('chart.reported')}</h2>
              <div className="aside legend">
                <span><i style={{ background: 'var(--series-1)' }} />{t('status.reported')}</span>
                <span><i style={{ background: 'var(--series-2)' }} />{t('status.repaired')}</span>
              </div>
            </div>
            <div className="panel-body">{stats ? <DailyBars data={stats.daily} /> : <div style={{ height: 170 }} />}</div>
          </section>
        </div>

        <div className="stack">
          <section className="panel">
            <div className="panel-head">
              <h2>{t('queue.title')}</h2>
              <span className="aside">{t('queue.aside')}</span>
            </div>
            {open.length === 0 ? (
              <Empty title={t('queue.empty')} action={<button className="btn btn-primary" onClick={openReport}>{t('action.report')}</button>}>
                {t('queue.empty.body')}
              </Empty>
            ) : (
              <ul className="queue">
                {open.slice(0, 7).map((s) => (
                  <li key={s.id}>
                    <button onClick={() => openSite(s.id)} onMouseEnter={() => setSelected(s.id)}>
                      <span className={`prio ${s.severity}`} title={t('queue.prio')}>{s.priority}</span>
                      <span style={{ minWidth: 0 }}>
                        <div className="where">{place(s)}</div>
                        <div className="meta">
                          {t('queue.meta', { id: s.id, count: t('count.pothole', { n: s.count }), when: when(s.created_at) })}
                        </div>
                      </span>
                      <span>
                        <div className="amount">{money(s.estimate?.total)}</div>
                        <div style={{ textAlign: 'right' }}><Severity level={s.severity} /></div>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {open.length > 7 && (
              <div style={{ padding: '10px 18px', borderTop: '1px solid var(--line)' }}>
                <a href="#/defects">{t('queue.all', { n: open.length })}</a>
              </div>
            )}
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>{t('activity.title')}</h2>
            </div>
            {activity.length === 0 ? (
              <Empty>{t('activity.empty')}</Empty>
            ) : (
              <ul className="feed">
                {activity.map((a, i) => {
                  const Icon = a.icon
                  return (
                    <li key={i}>
                      <Icon size={16} />
                      <div style={{ minWidth: 0 }}>
                        <div>{a.id ? <a href="#/defects" onClick={(e) => { e.preventDefault(); openSite(a.id) }}>{a.text}</a> : a.text}</div>
                        <div className="muted small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.sub}</div>
                      </div>
                      <time>{when(a.ts)}</time>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </div>
      </div>
    </>
  )
}
