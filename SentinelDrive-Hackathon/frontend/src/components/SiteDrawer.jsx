import { useEffect, useState } from 'react'
import { ExternalLink, FileText, MapPin, Trash2, X } from 'lucide-react'
import { api, workOrderUrl } from '../api'
import { useLive } from '../hooks/useLive'
import { coords, dateTime, money, place, statusLabel } from '../lib/format'
import { boqItem, boqUnit, serverText } from '../lib/i18n-core'
import { useI18n } from '../lib/i18n'
import { BeforeAfter, PriorityWhy } from './Evidence'
import MapView from './MapView'
import { Severity, Status, toast } from './bits'

// next status -> label key for the button that moves a site there
const NEXT = {
  reported: [['verified', 'act.verify'], ['rejected', 'status.rejected']],
  verified: [['scheduled', 'act.schedule'], ['rejected', 'status.rejected']],
  scheduled: [['repaired', 'act.repaired']],
  repaired: [['reported', 'act.reopen']],
  rejected: [['reported', 'act.reopen']],
}

const SOURCES = ['device', 'photo-exif', 'set-on-map', 'none']

export default function SiteDrawer({ id, onClose }) {
  const { t } = useI18n()
  const { potholes, upsertPothole, health } = useLive()
  const site = potholes.find((p) => p.id === id)
  const [photo, setPhoto] = useState(0)
  const [picking, setPicking] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [repairing, setRepairing] = useState(false)
  const [afterFile, setAfterFile] = useState(null)
  const [cost, setCost] = useState('')

  useEffect(() => {
    setPhoto(site ? site.evidence.length - 1 : 0)
    setPicking(false)
    setRepairing(false)
    setAfterFile(null)
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])

  if (!site) return null
  const ev = site.evidence[Math.min(photo, site.evidence.length - 1)]
  const est = site.estimate

  const submitRepair = async () => {
    setBusy(true)
    try {
      const fd = new FormData()
      fd.append('file', afterFile)
      if (note) fd.append('note', note)
      if (cost !== '') fd.append('actual_cost', cost)
      upsertPothole(await api.completeRepair(site.id, fd))
      toast(t('repair.toast', { id: site.id }))
      setRepairing(false)
      setAfterFile(null)
      setCost('')
    } catch (e) {
      toast(e.message)
    } finally {
      setBusy(false)
    }
  }

  const update = async (body, msg) => {
    setBusy(true)
    try {
      const rec = await api.updatePothole(site.id, body)
      upsertPothole(rec)
      if (msg) toast(msg)
      setNote('')
    } catch (e) {
      toast(e.message)
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!window.confirm(t('site.confirm', { id: site.id }))) return
    await api.deletePothole(site.id)
    toast(t('site.deleted', { id: site.id }))
    onClose()
  }

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="site-title">
        <div className="drawer-head">
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 4 }}>
              <h2 id="site-title">{site.id}</h2>
              <Status status={site.status} />
            </div>
            <p className="muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{place(site)}</p>
          </div>
          <button className="btn btn-ghost btn-sm x" onClick={onClose} aria-label={t('common.close')}>
            <X size={18} />
          </button>
        </div>

        <div className="drawer-body">
          <div>
            <div className="photo">
              <img src={ev.annotated} alt={t('site.alt', { id: site.id })} />
            </div>
            {site.evidence.length > 1 && (
              <div className="photo-strip" aria-label={t('site.reports')}>
                {site.evidence.map((e, i) => (
                  <button key={e.ts} className={i === photo ? 'on' : ''} onClick={() => setPhoto(i)} aria-label={t('site.reportn', { n: i + 1 })}>
                    <img src={e.annotated} alt="" />
                  </button>
                ))}
              </div>
            )}
            <p className="muted small" style={{ marginTop: 6 }}>
              {t('site.reportof', { a: Math.min(photo, site.evidence.length - 1) + 1, b: site.evidence.length, date: dateTime(ev.ts) })}
              {ev.note ? `. "${ev.note}"` : ''}
            </p>
          </div>

          <div className="facts">
            <div><div className="k">{t('fact.severity')}</div><div className="v"><Severity level={site.severity} /></div></div>
            <div><div className="k">{t('fact.priority')}</div><div className="v">{site.priority} / 100 · {t(`prio.${site.priority_info?.category || 'low'}`)}</div></div>
            <div><div className="k">{t('fact.citizens')}</div><div className="v">{site.citizens ?? 1}</div></div>
            <div><div className="k">{t('fact.potholes')}</div><div className="v">{site.count}</div></div>
            <div><div className="k">{t('fact.area')}</div><div className="v">{site.area_m2.toFixed(2)} m²</div></div>
            <div><div className="k">{t('fact.deepest')}</div><div className="v">{Math.round(site.depth_max_m * 1000)} mm</div></div>
            <div><div className="k">{t('fact.volume')}</div><div className="v">{(site.volume_m3 * 1000).toFixed(0)} L</div></div>
          </div>

          <PriorityWhy site={site} />
          <BeforeAfter site={site} />

          <section>
            <h3 style={{ marginBottom: 8 }}>{t('site.location')}</h3>
            {site.lat == null || picking ? (
              <>
                {!picking && <div className="note warn" style={{ marginBottom: 8 }}>{t('site.noloc')}</div>}
                <MapView
                  sites={site.lat != null ? [site] : []}
                  selectedId={site.id}
                  pickMode
                  onPick={async (p) => {
                    await update(p, t('site.locsaved'))
                    setPicking(false)
                  }}
                />
                {picking && <button className="btn btn-sm" style={{ marginTop: 8 }} onClick={() => setPicking(false)}>{t('site.cancel')}</button>}
              </>
            ) : (
              <dl className="dl">
                <dt>{t('dl.address')}</dt>
                <dd>{site.address?.display_name || <span className="muted">{health?.geocoder === 'off' ? t('dl.geo.off') : t('dl.geo.wait')}</span>}</dd>
                {site.jurisdiction?.authority && (
                  <>
                    <dt>{t('dl.civic')}</dt>
                    <dd>{site.jurisdiction.authority}{site.jurisdiction.ward ? `, ${site.jurisdiction.ward}` : ''}</dd>
                  </>
                )}
                <dt>{t('dl.coords')}</dt>
                <dd>
                  {coords(site.lat, site.lng)}{' '}
                  <a href={`https://www.google.com/maps?q=${site.lat},${site.lng}`} target="_blank" rel="noreferrer">
                    {t('dl.maps')} <ExternalLink size={12} />
                  </a>
                </dd>
                <dt>{t('dl.source')}</dt>
                <dd>
                  {SOURCES.includes(site.gps_source) ? t(`src.${site.gps_source}`) : site.gps_source}
                  {site.gps_accuracy_m ? `, ±${Math.round(site.gps_accuracy_m)} m` : ''}{' '}
                  <button className="btn btn-ghost btn-sm" onClick={() => setPicking(true)}>
                    <MapPin size={14} /> {t('dl.move')}
                  </button>
                </dd>
              </dl>
            )}
          </section>

          {est && (
            <section>
              <h3 style={{ marginBottom: 6 }}>{t('est.title')}</h3>
              <table className="boq">
                <tbody>
                  {est.lines.map((l) => (
                    <tr key={l.item}>
                      <td>
                        {boqItem(l.item)}
                        <div className="q">{l.qty} {boqUnit(l.unit)} × {money(l.rate)}</div>
                      </td>
                      <td className="r">{money(l.amount)}</td>
                    </tr>
                  ))}
                  <tr>
                    <td>GST {est.gst_pct}%</td>
                    <td className="r">{money(est.gst)}</td>
                  </tr>
                  <tr className="total">
                    <td>{t('est.total')}</td>
                    <td className="r">{money(est.total)}</td>
                  </tr>
                </tbody>
              </table>
              <p className="muted small" style={{ marginTop: 6 }}>{t('est.note', { note: est.rate_card_note })}</p>
            </section>
          )}

          <section>
            <h3 style={{ marginBottom: 10 }}>{t('site.history')}</h3>
            <ul className="timeline">
              {site.history.map((h, i) => (
                <li key={i}>
                  <strong>{statusLabel(h.status)}</strong> <span className="muted small">{dateTime(h.ts)}</span>
                  {h.note && <div className="muted">{h.note}</div>}
                </li>
              ))}
            </ul>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('site.note.ph')} style={{ flex: 1 }} />
              <button className="btn" disabled={!note.trim() || busy} onClick={() => update({ note }, t('site.note.done'))}>{t('site.note.add')}</button>
            </div>
          </section>

          <p className="muted small">
            {t('site.detected', { label: site.detector?.label?.toLowerCase(), n: Math.round(site.confidence * 100) })}{' '}
            {serverText(site.measurement_method)}
          </p>
        </div>

        {repairing && (
          <div className="repair-form">
            <label className="small" htmlFor="after-photo">{t('repair.need')}</label>
            <input id="after-photo" type="file" accept="image/*" capture="environment" onChange={(e) => setAfterFile(e.target.files?.[0] || null)} />
            <input type="number" min="0" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} placeholder={t('repair.cost.ph')} />
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-primary" disabled={!afterFile || busy} onClick={submitRepair}>{t('repair.upload')}</button>
              <button className="btn" onClick={() => setRepairing(false)}>{t('site.cancel')}</button>
            </div>
          </div>
        )}

        <div className="drawer-foot">
          {NEXT[site.status].map(([s, labelKey], i) => (
            <button
              key={s}
              className={`btn ${i === 0 && s !== 'reported' ? 'btn-primary' : ''}`}
              disabled={busy}
              onClick={() => (s === 'repaired' ? setRepairing(true) : update({ status: s, note: note || undefined }, t('site.status.toast', { id: site.id, status: statusLabel(s) })))}
            >
              {t(labelKey)}
            </button>
          ))}
          <a className="btn" href={workOrderUrl(site.id)} target="_blank" rel="noreferrer">
            <FileText size={16} /> {t('site.workorder')}
          </a>
          <button className="btn btn-ghost btn-danger" style={{ marginLeft: 'auto' }} onClick={remove} aria-label={t('site.delete')}>
            <Trash2 size={16} />
          </button>
        </div>
      </aside>
    </>
  )
}
