import { useEffect, useRef, useState } from 'react'
import { Siren } from 'lucide-react'
import { useLive } from '../hooks/useLive'
import useVoiceCheck from '../hooks/useVoiceCheck'
import { api } from '../api'
import { speakT, tone } from '../lib/speech'
import { serverText } from '../lib/i18n-core'
import { useI18n } from '../lib/i18n'
import { useSensors } from '../hooks/useSensors'

export const CONTACT_KEY = 'sentinel.emergencyContact'
export function readContact() {
  try {
    return JSON.parse(localStorage.getItem(CONTACT_KEY) || 'null')
  } catch {
    return null
  }
}

// ---------- spoken alertness check ----------
export function AlertnessOverlay() {
  const { t } = useI18n()
  const { talkback, talkbackEvent, send } = useLive()
  const voice = useVoiceCheck({ talkback, talkbackEvent, send })
  const [typed, setTyped] = useState('')
  const [now, setNow] = useState(Date.now())
  const [result, setResult] = useState(null)

  useEffect(() => {
    if (!talkback) return
    const t = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(t)
  }, [talkback])

  useEffect(() => {
    if (talkbackEvent?.kind === 'done') {
      setResult(talkbackEvent.result)
      const t = setTimeout(() => setResult(null), 3500)
      return () => clearTimeout(t)
    }
  }, [talkbackEvent])

  const startedRef = useRef({ id: null, at: 0 })
  if (talkback && startedRef.current.id !== talkback.id) startedRef.current = { id: talkback.id, at: Date.now(), remaining: talkback.remaining_s }
  if (talkbackEvent?.kind === 'retry' && talkback && startedRef.current.retryAt !== talkbackEvent.at) {
    startedRef.current = { id: talkback.id, at: Date.now(), remaining: talkback.remaining_s, retryAt: talkbackEvent.at }
  }

  if (!talkback) {
    if (!result) return null
    return (
      <div className="alert-screen" role="alertdialog" aria-live="assertive">
        <div className="alert-inner">
          <div className="alert-q">{result.correct ? t('alert.correct') : t('alert.stopped')}</div>
          <p className="alert-sub">
            {result.correct ? t('alert.correct.sub') : t('alert.stopped.sub')}
          </p>
        </div>
      </div>
    )
  }

  const alarm = talkback.phase === 'alarm'
  const left = Math.max(0, startedRef.current.remaining - (now - startedRef.current.at) / 1000)
  const pct = alarm ? 0 : (left / talkback.window_s) * 100
  const heard = talkbackEvent?.kind === 'retry' ? talkbackEvent.heard : null

  return (
    <div className={`alert-screen ${alarm ? 'alarm' : ''}`} role="alertdialog" aria-live="assertive" aria-labelledby="check-q">
      <div className="alert-inner">
        <div className="alert-kicker">{alarm ? t('alert.kicker.alarm') : t('alert.kicker')}</div>
        <div className="alert-q" id="check-q">{talkback.question}</div>
        {!alarm && (
          <div className="alert-timer" aria-hidden="true">
            <span style={{ width: `${pct}%` }} />
          </div>
        )}
        <div className="alert-heard">
          {voice.speaking
            ? t('heard.asking')
            : voice.transcript
              ? t('heard.said', { x: voice.transcript })
              : heard
                ? t('heard.wrong', { x: heard })
                : voice.voiceSupported
                  ? voice.listening ? t('heard.listening') : t('heard.starting')
                  : t('heard.novoice')}
        </div>
        <form
          className="alert-input"
          onSubmit={(e) => {
            e.preventDefault()
            if (voice.submitTyped(typed)) setTyped('')
          }}
        >
          <input inputMode="numeric" value={typed} onChange={(e) => setTyped(e.target.value)} aria-label={t('alert.type')} placeholder={t('alert.answer')} />
          <button className="btn btn-primary">{t('alert.submit')}</button>
          <button type="button" className="btn" onClick={voice.repeat}>{t('alert.repeat')}</button>
        </form>
        <p className="alert-sub">{t('alert.foot')}</p>
      </div>
    </div>
  )
}

// ---------- crash: are you OK? ----------
export function CrashOverlay() {
  const { t } = useI18n()
  const { incidents, send } = useLive()
  const { startedAt } = useSensors()
  const [dismissed, setDismissed] = useState(() => new Set())
  const [now, setNow] = useState(Date.now())
  const crash = incidents.find(
    (i) => i.kind === 'crash' && ['awaiting_driver', 'escalated'].includes(i.status) && !dismissed.has(i.id) && i.created_at >= startedAt,
  )

  const announced = useRef(null)
  useEffect(() => {
    if (!crash) return
    if (announced.current !== crash.id && crash.status === 'awaiting_driver') {
      announced.current = crash.id
      tone(988, 0.25, 0.4, 'square')
      tone(988, 0.25, 0.4, 'square', 0.35)
      setTimeout(() => speakT('spoken.crash'), 800)
    }
    const t = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(t)
  }, [crash])

  if (!crash) return null
  const contact = readContact()
  const mapsLink = crash.lat != null ? `https://maps.google.com/?q=${crash.lat.toFixed(6)},${crash.lng.toFixed(6)}` : null
  const smsBody = t('sms.body', {
    time: new Date(crash.created_at).toLocaleTimeString(),
    where: mapsLink ? t('sms.where', { link: mapsLink }) : t('sms.nowhere'),
  })
  const sms = contact?.phone ? `sms:${contact.phone}?&body=${encodeURIComponent(smsBody)}` : null
  const secs = Math.max(0, Math.ceil(((crash.response_deadline || 0) - now) / 1000))
  const escalated = crash.status === 'escalated'

  return (
    <div className={`crash-screen ${escalated ? 'escalated' : ''}`} role="alertdialog" aria-live="assertive" aria-labelledby="crash-title">
      <div className="crash-inner">
        <h1 id="crash-title">{escalated ? t('crash.head.esc') : t('crash.head')}</h1>
        {!escalated && <div className="crash-count" aria-label={t('crash.secs', { n: secs })}>{secs}</div>}
        <p>
          {escalated ? t('crash.body.esc') : t('crash.body', { n: secs })}
        </p>
        <p className="small" style={{ opacity: 0.8 }}>{crash.reason}</p>
        <div className="crash-actions">
          {!escalated && (
            <button className="btn btn-ok" onClick={() => send({ type: 'crash_response', id: crash.id, response: 'ok' })}>
              {t('crash.ok')}
            </button>
          )}
          <a className="btn btn-call" href="tel:112" onClick={() => send({ type: 'crash_response', id: crash.id, response: 'help' })}>
            {t('crash.call')}
          </a>
          {sms ? (
            <a className="btn btn-sms" href={sms}>{t('crash.sms', { name: contact.name || t('crash.sms.who') })}</a>
          ) : (
            <span className="small" style={{ opacity: 0.8 }}>{t('crash.addcontact')}</span>
          )}
          {escalated && (
            <button
              className="btn btn-sms"
              onClick={async () => {
                setDismissed((d) => new Set(d).add(crash.id))
                await api.resolveIncident(crash.id).catch(() => {})
              }}
            >
              {t('crash.close')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ---------- emergency vehicle ----------
export function SirenBanner() {
  const { t } = useI18n()
  const { siren } = useLive()
  const spoken = useRef(null)
  useEffect(() => {
    if (siren && spoken.current !== siren.id) {
      spoken.current = siren.id
      speakT('siren.guidance', { side: siren.guidance?.includes(' left ') ? t('side.left') : t('side.right') }, siren.guidance)
    }
  }, [siren])
  if (!siren) return null
  return (
    <div className="siren-banner" role="alert">
      <Siren size={28} color="var(--marking)" />
      <div>
        <strong>{t('siren.banner')}</strong>
        <p>{serverText(siren.guidance)}</p>
      </div>
    </div>
  )
}
