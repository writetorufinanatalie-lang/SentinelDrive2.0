import { useEffect, useRef, useState } from 'react'
import { Camera, Check, LocateFixed, MapPin, Upload, X } from 'lucide-react'
import { api } from '../api'
import { redactImageBlob, redactVideoFrames } from '../lib/redact'
import { coords, money } from '../lib/format'
import { useSensors } from '../hooks/useSensors'
import { Severity } from './bits'
import { useI18n } from '../lib/i18n'
import { getReporterId } from '../lib/reporter'

const VIDEO = /\.(mp4|mov|m4v|webm|mkv|avi|3gp)$/i
const STEPS = ['rep.step.blur', 'rep.step.upload', 'rep.step.find', 'rep.step.cost']

export default function ReportDialog({ onClose, onOpenSite }) {
  const { t } = useI18n()
  const sensors = useSensors()
  const input = useRef(null)
  const camInput = useRef(null)
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [over, setOver] = useState(false)
  const [loc, setLoc] = useState(() => {
    const p = sensors.getPosition()
    return p ? { lat: p.lat, lng: p.lng, accuracy: p.accuracy, source: 'device' } : null
  })
  const [locBusy, setLocBusy] = useState(false)
  const [note, setNote] = useState('')
  const [step, setStep] = useState(-1)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)

  const pick = (f) => {
    if (!f) return
    setFile(f)
    setResult(null)
    setError(null)
    setPreview(f.type.startsWith('image/') ? URL.createObjectURL(f) : null)
  }

  const locate = () => {
    if (!('geolocation' in navigator)) return setError(t('rep.geo.unsupported'))
    setLocBusy(true)
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLoc({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, source: 'device' })
        setLocBusy(false)
      },
      (e) => {
        setLocBusy(false)
        setError(e.code === 1 ? t('rep.geo.denied') : t('rep.geo.fail'))
      },
      { enableHighAccuracy: true, timeout: 15000 },
    )
  }

  // Fill in the location straight away when the browser already allows it.
  useEffect(() => {
    if (loc || !navigator.permissions?.query) return
    navigator.permissions
      .query({ name: 'geolocation' })
      .then((p) => p.state === 'granted' && locate())
      .catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async () => {
    setError(null)
    setResult(null)
    try {
      setStep(0)
      const isVideo = file.type.startsWith('video/') || VIDEO.test(file.name)
      const fd = new FormData()
      let report
      if (isVideo) {
        const r = await redactVideoFrames(file)
        report = r.report
        r.frames.forEach((b, i) => fd.append(i === 0 ? 'file' : 'frames', new File([b], `frame-${i}.jpg`, { type: 'image/jpeg' })))
      } else {
        const r = await redactImageBlob(file)
        report = r.report
        fd.append('file', new File([r.blob], 'photo.jpg', { type: 'image/jpeg' }))
      }
      fd.append('redaction', JSON.stringify(report))
      fd.append('reporter', getReporterId())
      if (loc) {
        fd.append('lat', String(loc.lat))
        fd.append('lng', String(loc.lng))
        if (loc.accuracy) fd.append('accuracy_m', String(Math.round(loc.accuracy)))
        fd.append('gps_source', loc.source)
      }
      if (note.trim()) fd.append('note', note.trim())
      setStep(1)
      const t = setTimeout(() => setStep(2), 500)
      const t2 = setTimeout(() => setStep(3), 1400)
      const res = await api.upload(fd)
      clearTimeout(t)
      clearTimeout(t2)
      setStep(4)
      setResult({ ...res, privacy: report })
    } catch (e) {
      setStep(-1)
      setError(e.message || String(e))
    }
  }

  const busy = step >= 0 && step < 4
  const site = result?.site

  useEffect(() => {
    const k = (e) => e.key === 'Escape' && !busy && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [busy, onClose])

  return (
    <>
      <div className="scrim" onClick={busy ? undefined : onClose} />
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="report-title">
        <div className="dialog-head">
          <h2 id="report-title">{t('action.report')}</h2>
          <button className="btn btn-ghost btn-sm x" onClick={onClose} disabled={busy} aria-label={t('common.close')}>
            <X size={18} />
          </button>
        </div>
        <div className="dialog-body">
          {!result && (
            <>
              <div
                className={`drop ${over ? 'over' : ''}`}
                onClick={() => input.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault()
                  setOver(true)
                }}
                onDragLeave={() => setOver(false)}
                onDrop={(e) => {
                  e.preventDefault()
                  setOver(false)
                  pick(e.dataTransfer.files?.[0])
                }}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && input.current?.click()}
              >
                {preview ? (
                  <img src={preview} alt="" style={{ maxHeight: 220, maxWidth: '100%', borderRadius: 6 }} />
                ) : file ? (
                  <strong>{file.name}</strong>
                ) : (
                  <>
                    <Upload size={24} color="var(--muted)" />
                    <strong>{t('rep.drop')}</strong>
                    <span className="muted small">{t('rep.drop.sub')}</span>
                    <span style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                      <button type="button" className="btn btn-sm" onClick={(e) => { e.stopPropagation(); camInput.current?.click() }}>
                        <Camera size={15} /> {t('rep.takephoto')}
                      </button>
                      <button type="button" className="btn btn-sm" onClick={(e) => { e.stopPropagation(); input.current?.click() }}>
                        {t('rep.choose')}
                      </button>
                    </span>
                  </>
                )}
              </div>
              <input
                ref={input}
                type="file"
                accept="image/*,video/*"
                hidden
                onChange={(e) => pick(e.target.files?.[0])}
              />
              <input ref={camInput} type="file" accept="image/*" capture="environment" hidden onChange={(e) => pick(e.target.files?.[0])} />

              <div className="field">
                <label>{t('rep.loc')}</label>
                {loc ? (
                  <div className="note" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <MapPin size={16} />
                    <span>
                      {coords(loc.lat, loc.lng)}
                      {loc.accuracy ? <span className="muted"> (±{Math.round(loc.accuracy)} m)</span> : null}
                    </span>
                    <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setLoc(null)}>
                      {t('rep.loc.remove')}
                    </button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    <button className="btn" onClick={locate} disabled={locBusy}>
                      <LocateFixed size={16} /> {locBusy ? t('rep.loc.getting') : t('rep.loc.use')}
                    </button>
                    <span className="hint muted small">{t('rep.loc.hint')}</span>
                  </div>
                )}
              </div>

              <div className="field">
                <label htmlFor="note">{t('rep.note')}</label>
                <input id="note" type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('rep.note.ph')} maxLength={200} />
              </div>

              {busy && (
                <div className="progress" aria-live="polite">
                  <ol>
                    {STEPS.map((s, i) => (
                      <li key={s} className={i < step ? 'done' : i === step ? 'now' : ''}>
                        {t(s)}
                      </li>
                    ))}
                  </ol>
                </div>
              )}
              {error && <div className="note error">{error}</div>}

              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button className="btn" onClick={onClose} disabled={busy}>
                  {t('rep.cancel')}
                </button>
                <button className="btn btn-primary" onClick={submit} disabled={!file || busy}>
                  <Upload size={16} /> {busy ? t('rep.analysing') : t('rep.analyse')}
                </button>
              </div>
              <p className="muted small">{t('rep.privacy')}</p>
            </>
          )}

          {result && !site && (
            <>
              <div className="note warn">
                <strong>{t('rep.none')}</strong> {result.frames_checked > 1 ? `${t('rep.none.frames', { n: result.frames_checked })} ` : ''}
                {t('rep.none.hint')}
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button className="btn" onClick={() => { setResult(null); setStep(-1) }}>{t('rep.tryanother')}</button>
                <button className="btn btn-primary" onClick={onClose}>{t('rep.done')}</button>
              </div>
            </>
          )}

          {site && (
            <>
              <div className="photo">
                <img src={site.evidence[site.evidence.length - 1].annotated} alt={t('rep.alt', { id: site.id })} />
              </div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <Check size={20} color="var(--ok)" />
                <div>
                  <strong>
                    {result.action === 'merged'
                      ? t('rep.merged', { id: site.id, m: result.merged_distance_m })
                      : t('rep.new', { n: site.count, id: site.id })}
                  </strong>
                  <div className="muted small">
                    {t('rep.est', { amount: money(site.estimate.total) })}{' '}
                    {result.privacy.regions > 0 ? t('rep.blurred', { f: result.privacy.faces, p: result.privacy.plates }) : t('rep.noblur')}
                  </div>
                </div>
                <span style={{ marginLeft: 'auto' }}>
                  <Severity level={site.severity} />
                </span>
              </div>
              {site.lat == null && <div className="note warn">{t('rep.noloc')}</div>}
              {result.detector.tier === 'classical' && (
                <div className="note warn">{t('rep.classical')}</div>
              )}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button className="btn" onClick={() => { setFile(null); setPreview(null); setResult(null); setStep(-1); setNote('') }}>
                  {t('rep.another')}
                </button>
                <button className="btn btn-primary" onClick={() => onOpenSite(site.id)}>
                  {t('rep.opensite')}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  )
}
