import { useEffect, useRef, useState } from 'react'
import { Camera, RefreshCw } from 'lucide-react'
import { api } from '../api'
import { useLive } from '../hooks/useLive'
import { useSensors } from '../hooks/useSensors'
import { EYES } from '../lib/fatigue'
import { ScoreLine } from '../components/Charts'
import { Empty } from '../components/bits'
import { dateTime } from '../lib/format'
import { useI18n } from '../lib/i18n'

const TIERS = ['normal', 'elevated', 'critical']

function CameraView() {
  const { t } = useI18n()
  const s = useSensors()
  const video = useRef(null)
  const canvas = useRef(null)

  useEffect(() => {
    if (video.current && s.stream && video.current.srcObject !== s.stream) video.current.srcObject = s.stream
  }, [s.stream])

  // Draw the tracked eye outline and nose-chin line so the driver can see
  // what the system is measuring.
  useEffect(() => {
    let raf
    const draw = () => {
      raf = requestAnimationFrame(draw)
      const c = canvas.current
      const lm = s.landmarksRef.current
      if (!c) return
      const w = c.clientWidth
      const h = c.clientHeight
      if (c.width !== w) c.width = w
      if (c.height !== h) c.height = h
      const ctx = c.getContext('2d')
      ctx.clearRect(0, 0, w, h)
      if (!lm) return
      // object-fit: cover mapping from 4:3 video
      const vw = video.current?.videoWidth || 640
      const vh = video.current?.videoHeight || 480
      const scale = Math.max(w / vw, h / vh)
      const ox = (w - vw * scale) / 2
      const oy = (h - vh * scale) / 2
      const P = (i) => [lm[i].x * vw * scale + ox, lm[i].y * vh * scale + oy]
      const closed = s.summary?.ear != null && s.summary.ear < s.summary.earThreshold
      ctx.lineWidth = 2
      ctx.strokeStyle = closed ? '#e5534b' : '#f2c230'
      for (const eye of [EYES.left, EYES.right]) {
        const [p1, p2, p3, p4, p5, p6] = eye.map(P)
        ctx.beginPath()
        ctx.moveTo(...p1)
        ctx.lineTo(...p2)
        ctx.lineTo(...p3)
        ctx.lineTo(...p4)
        ctx.lineTo(...p5)
        ctx.lineTo(...p6)
        ctx.closePath()
        ctx.stroke()
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.6)'
      ctx.setLineDash([4, 4])
      ctx.beginPath()
      ctx.moveTo(...P(168))
      ctx.lineTo(...P(1))
      ctx.lineTo(...P(152))
      ctx.stroke()
      ctx.setLineDash([])
    }
    draw()
    return () => cancelAnimationFrame(raf)
  }, [s.landmarksRef, s.summary])

  const msg = {
    off: (
      <>
        <Camera size={28} />
        <strong>{t('cam.off')}</strong>
        <span>{t('cam.off.body')}</span>
        <button className="btn btn-primary" onClick={s.start}>{t('action.start')}</button>
      </>
    ),
    starting: t('cam.starting'),
    loading: t('cam.loading'),
    blocked: t('cam.blocked'),
    missing: t('cam.missing'),
    error: t('cam.error'),
  }[s.camera]

  const sum = s.summary
  return (
    <div className="cam">
      {s.stream && <video ref={video} autoPlay muted playsInline />}
      {s.stream && <canvas ref={canvas} />}
      {s.camera !== 'live' && (
        <div className="cam-msg">
          <div>{msg}</div>
        </div>
      )}
      {s.camera === 'live' && (
        <div className="badge">
          <span className={`dot ${sum?.face ? 'live' : 'warn'}`} />
          {sum?.face ? t('cam.face') : t('cam.noface')}
        </div>
      )}
      {s.camera === 'live' && sum && !sum.calibrated && sum.face && (
        <div className="calib" role="status">
          {t('cam.calib')}
          <div className="bar"><span style={{ width: `${Math.round(sum.progress * 100)}%` }} /></div>
        </div>
      )}
    </div>
  )
}

export default function Driver() {
  const { t } = useI18n()
  const s = useSensors()
  const { talkbackEvent } = useLive()
  const [checks, setChecks] = useState([])
  useEffect(() => {
    api.checks().then(setChecks).catch(() => {})
  }, [talkbackEvent])

  const sum = s.summary
  const live = s.camera === 'live' && sum?.calibrated
  const tier = live && TIERS.includes(sum.tier) ? sum.tier : null
  const [cls, label] = tier ? [tier, t(`tier.${tier}`)] : ['', s.camera === 'live' ? t('drv.calibrating') : t('drv.notmonitoring')]

  return (
    <div className="driver-grid">
      <div className="stack">
        <CameraView />
        <section className="panel">
          <div className="panel-head">
            <h2>{t('drv.chart')}</h2>
            <span className="aside">{t('drv.chart.aside')}</span>
          </div>
          <div className="panel-body">
            {s.history.length > 1 ? <ScoreLine points={s.history} /> : <p className="muted">{t('drv.chart.empty')}</p>}
          </div>
        </section>
      </div>

      <div className="stack">
        <section className="panel">
          <div className="section readout">
            <div className="score-block">
              <div className="score-num">
                {live ? sum.score.toFixed(1) : '–'}
                <small> /10</small>
              </div>
              <div>
                <div className="score-scale" aria-hidden="true">
                  {live && <div className="needle" style={{ left: `${sum.score * 10}%` }} />}
                </div>
                <div className="score-ticks"><span>0</span><span>5</span><span>8</span><span>10</span></div>
                <div className={`state-line ${cls}`}>{label}</div>
              </div>
            </div>
            <div className="metrics">
              <div>
                <div className="k">{t('m.perclos')}</div>
                <div className="v">{live ? `${(sum.perclos * 100).toFixed(1)}%` : '–'}</div>
                <div className="d">{t('m.perclos.d')}</div>
              </div>
              <div>
                <div className="k">{t('m.blink')}</div>
                <div className="v">{live ? t('m.blink.v', { n: sum.blinkRate }) : '–'}</div>
                <div className="d">{t('m.blink.d')}</div>
              </div>
              <div>
                <div className="k">{t('m.micro')}</div>
                <div className="v">{live ? sum.microsleeps : '–'}</div>
                <div className="d">{t('m.micro.d')}</div>
              </div>
              <div>
                <div className="k">{t('m.head')}</div>
                <div className="v">{live ? (sum.droopMs > 0 ? t('unit.s', { n: (sum.droopMs / 1000).toFixed(1) }) : t('m.head.no')) : '–'}</div>
                <div className="d">{t('m.head.d')}</div>
              </div>
            </div>
            {live && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className="muted small">
                  {t('eye.open', { a: sum.ear?.toFixed(2), b: sum.earThreshold?.toFixed(2) })}
                </span>
                <button className="btn btn-sm" style={{ marginLeft: 'auto' }} onClick={s.recalibrate}>
                  <RefreshCw size={14} /> {t('eye.recal')}
                </button>
              </div>
            )}
          </div>
          <div className="section">
            <div className="section-head">
              <h3>{t('how.title')}</h3>
              <p className="small">{t('how.body')}</p>
            </div>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>{t('checks.title')}</h2>
          </div>
          {checks.length === 0 ? (
            <Empty>{t('checks.empty')}</Empty>
          ) : (
            <ul className="feed">
              {checks.slice(0, 8).map((c) => (
                <li key={c.id}>
                  <span className={`dot ${c.correct ? 'live' : 'bad'}`} style={{ marginTop: 7 }} />
                  <div>
                    <div>{c.question} <span className="muted">({['answered', 'recovered'].includes(c.outcome) ? t(`outcome.${c.outcome}`) : c.outcome})</span></div>
                    <div className="muted small">
                      {c.attempts.length ? t('checks.heard', { x: c.attempts.map((a) => `“${a.heard || a.parsed}”`).join(', ') }) : t('checks.nothing')}
                      {`, ${t('unit.s', { n: (c.response_ms / 1000).toFixed(1) })}`}
                    </div>
                  </div>
                  <time>{dateTime(c.created_at)}</time>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
