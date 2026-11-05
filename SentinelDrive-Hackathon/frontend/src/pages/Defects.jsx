import { useMemo, useState } from 'react'
import { Download, List, Map as MapIcon } from 'lucide-react'
import { useLive } from '../hooks/useLive'
import MapView from '../components/MapView'
import { Empty, Severity, Status, useTick } from '../components/bits'
import { money, place, when } from '../lib/format'
import { useI18n } from '../lib/i18n'

// [key, label key, test]
const FILTERS = [
  ['open', 'filter.open', (s) => ['reported', 'verified', 'scheduled'].includes(s)],
  ['reported', 'filter.new', (s) => s === 'reported'],
  ['scheduled', 'filter.scheduled', (s) => s === 'scheduled'],
  ['repaired', 'filter.repaired', (s) => s === 'repaired'],
  ['all', 'filter.all', () => true],
]
const SORTS = {
  priority: (a, b) => b.priority - a.priority,
  newest: (a, b) => b.created_at - a.created_at,
  cost: (a, b) => (b.estimate?.total || 0) - (a.estimate?.total || 0),
}

export default function Defects({ openSite, openReport }) {
  useTick()
  const { t } = useI18n()
  const { potholes, loaded } = useLive()
  const [filter, setFilter] = useState('open')
  const [sev, setSev] = useState('any')
  const [sort, setSort] = useState('priority')
  const [view, setView] = useState('list')
  const [q, setQ] = useState('')

  const rows = useMemo(() => {
    const f = FILTERS.find((x) => x[0] === filter)[2]
    const needle = q.trim().toLowerCase()
    return potholes
      .filter((p) => f(p.status) && (sev === 'any' || p.severity === sev))
      .filter((p) => !needle || `${p.id} ${place(p)} ${p.jurisdiction?.ward || ''}`.toLowerCase().includes(needle))
      .sort(SORTS[sort])
  }, [potholes, filter, sev, sort, q])

  const counts = Object.fromEntries(FILTERS.map(([k, , f]) => [k, potholes.filter((p) => f(p.status)).length]))
  const total = rows.reduce((s, r) => s + (r.estimate?.total || 0), 0)

  return (
    <>
      <div className="toolbar">
        <div className="seg" role="tablist" aria-label={t('filter.status')}>
          {FILTERS.map(([k, labelKey]) => (
            <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)} role="tab" aria-selected={filter === k}>
              {t(labelKey)}
              <span className="n">{counts[k]}</span>
            </button>
          ))}
        </div>
        <select value={sev} onChange={(e) => setSev(e.target.value)} aria-label={t('filter.sev')}>
          <option value="any">{t('filter.anysev')}</option>
          <option value="high">{t('sev.high')}</option>
          <option value="medium">{t('sev.medium')}</option>
          <option value="low">{t('sev.low')}</option>
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label={t('sort.label')}>
          <option value="priority">{t('sort.priority')}</option>
          <option value="newest">{t('sort.newest')}</option>
          <option value="cost">{t('sort.cost')}</option>
        </select>
        <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('search.ph')} style={{ width: 200 }} />
        <span className="spacer" />
        <div className="seg" aria-label={t('view.label')}>
          <button className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}><List size={15} /> {t('view.list')}</button>
          <button className={view === 'map' ? 'on' : ''} onClick={() => setView('map')}><MapIcon size={15} /> {t('view.map')}</button>
        </div>
      </div>

      {view === 'map' ? (
        <MapView sites={rows} onSelect={openSite} className="tall" emptyText={t('map.none')} />
      ) : (
        <section className="panel">
          {rows.length === 0 ? (
            loaded && (
              <Empty
                title={potholes.length ? t('empty.nomatch') : t('empty.none')}
                action={!potholes.length && <button className="btn btn-primary" onClick={openReport}>{t('action.report')}</button>}
              >
                {potholes.length ? t('empty.try') : t('empty.upload')}
              </Empty>
            )
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th className="hide-sm">{t('th.photo')}</th>
                    <th>{t('th.location')}</th>
                    <th>{t('th.severity')}</th>
                    <th className="r">{t('th.priority')}</th>
                    <th className="r hide-sm">{t('th.potholes')}</th>
                    <th className="r">{t('th.estimate')}</th>
                    <th>{t('th.status')}</th>
                    <th className="hide-sm">{t('th.reported')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((s) => (
                    <tr key={s.id} onClick={() => openSite(s.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && openSite(s.id)}>
                      <td className="hide-sm"><img className="thumb" src={s.evidence[s.evidence.length - 1].annotated} alt="" loading="lazy" /></td>
                      <td style={{ maxWidth: 320 }}>
                        <div className="cell-main" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{place(s)}</div>
                        <div className="cell-sub">
                          {s.id}
                          {s.jurisdiction?.ward ? `, ${s.jurisdiction.ward}` : ''}
                          {s.reports > 1 ? `, ${t('count.report', { n: s.reports })}` : ''}
                        </div>
                      </td>
                      <td><Severity level={s.severity} /></td>
                      <td className="r">{s.priority}</td>
                      <td className="r hide-sm">{s.count}</td>
                      <td className="r">{money(s.estimate?.total)}</td>
                      <td><Status status={s.status} /></td>
                      <td className="hide-sm cell-sub">{when(s.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {rows.length > 0 && (
            <div style={{ padding: '10px 14px', display: 'flex', fontSize: 13, color: 'var(--muted)' }}>
              {t('count.site', { n: rows.length })}
              <span style={{ marginLeft: 'auto' }}>{t('foot.total', { amount: money(total) })}</span>
              <a href="/api/potholes/export.csv" style={{ marginLeft: 16, display: 'inline-flex', gap: 5, alignItems: 'center' }}>
                <Download size={14} /> {t('foot.csv')}
              </a>
            </div>
          )}
        </section>
      )}
    </>
  )
}
