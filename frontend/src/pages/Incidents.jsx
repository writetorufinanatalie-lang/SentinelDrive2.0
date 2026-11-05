import { useState } from 'react'
import { Car, Siren } from 'lucide-react'
import { useLive } from '../hooks/useLive'
import { useSensors } from '../hooks/useSensors'
import MapView from '../components/MapView'
import { Empty, useTick } from '../components/bits'
import { coords, dateTime, when } from '../lib/format'
import { serverText } from '../lib/i18n-core'
import { useI18n } from '../lib/i18n'

const CRASH_STATUS = ['awaiting_driver', 'escalated', 'driver_ok', 'resolved', 'suppressed']

function Signal({ label, s, unit, fmt = (v) => v }) {
  const { t } = useI18n()
  return (
    <div className={`signal ${s.agree ? 'agree' : ''}`}>
      <div className="k">{label}</div>
      <div className="v">{s.available === false || s.value == null ? t('sig.na') : `${fmt(s.value)} ${unit}`}</div>
      <div className="k">{s.agree ? t('sig.confirms') : t('sig.needs', { n: s.threshold, unit })}</div>
    </div>
  )
}

function CrashRow({ c }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  return (
    <li style={{ display: 'block', padding: 0 }}>
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        style={{ display: 'grid', gridTemplateColumns: '22px minmax(0,1fr) auto', gap: 10, width: '100%', padding: '12px 18px', background: 'none', border: 0, textAlign: 'left', cursor: 'pointer' }}
      >
        <Car size={17} color={c.verified ? 'var(--high)' : 'var(--muted)'} />
        <div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <strong>{c.verified ? t('inc.crash') : t('inc.impact')}</strong>
            <span className={`status crash-${c.status}`}>{CRASH_STATUS.includes(c.status) ? t(`crash.st.${c.status}`) : c.status}</span>
          </div>
          <div className="muted small">{c.reason}</div>
        </div>
        <time className="muted small">{when(c.created_at)}</time>
      </button>
      {open && (
        <div style={{ padding: '0 18px 16px 50px', display: 'grid', gap: 12 }}>
          <div className="signals">
            <Signal label={t('sig.force')} s={c.signals.g_force} unit="g" />
            <Signal label={t('sig.speed')} s={c.signals.speed_drop} unit="km/h" />
            <Signal label={t('sig.sound')} s={c.signals.sound} unit={t('sig.db')} />
          </div>
          <dl className="dl">
            <dt>{t('dl.location')}</dt>
            <dd>{c.address?.label || (c.lat != null ? coords(c.lat, c.lng) : t('dl.nofix'))}</dd>
            {c.driver_state && (
              <>
                <dt>{t('dl.driverbefore')}</dt>
                <dd>{t('dl.score', { s: c.driver_state.score, tier: ['normal', 'elevated', 'critical'].includes(c.driver_state.tier) ? t(`tier.${c.driver_state.tier}`) : c.driver_state.tier })}</dd>
              </>
            )}
            <dt>{t('dl.timeline')}</dt>
            <dd>{c.timeline.map((e) => `${new Date(e.ts).toLocaleTimeString()} ${e.event}`).join('; ')}</dd>
          </dl>
        </div>
      )}
    </li>
  )
}

export default function Incidents() {
  useTick()
  const { t } = useI18n()
  const { incidents, loaded } = useLive()
  const sensors = useSensors()
  const [kind, setKind] = useState('all')
  const crashes = incidents.filter((i) => i.kind === 'crash')
  const sirens = incidents.filter((i) => i.kind === 'siren')
  const list = incidents.filter((i) => kind === 'all' || i.kind === kind)

  return (
    <div className="grid-2">
      <section className="panel">
        <div className="panel-head">
          <div className="seg">
            <button className={kind === 'all' ? 'on' : ''} onClick={() => setKind('all')}>{t('kind.all')}<span className="n">{incidents.length}</span></button>
            <button className={kind === 'crash' ? 'on' : ''} onClick={() => setKind('crash')}>{t('kind.crashes')}<span className="n">{crashes.length}</span></button>
            <button className={kind === 'siren' ? 'on' : ''} onClick={() => setKind('siren')}>{t('kind.siren')}<span className="n">{sirens.length}</span></button>
          </div>
        </div>
        {list.length === 0 ? (
          loaded && (
            <Empty title={t('inc.empty')}>
              {t('inc.empty.body')}
              {sensors.running && sensors.motion !== 'live' ? ` ${t('inc.empty.nomotion')}` : ''}
            </Empty>
          )
        ) : (
          <ul className="feed">
            {list.map((i) =>
              i.kind === 'crash' ? (
                <CrashRow key={i.id} c={i} />
              ) : (
                <li key={i.id}>
                  <Siren size={17} />
                  <div>
                    <strong>{i.status === 'active' ? t('siren.now') : t('siren.heard')}</strong>
                    <div className="muted small">
                      {t('siren.detail', { pattern: i.pattern || t('siren.unknown'), a: Math.round(i.freq_min || 0), b: Math.round(i.freq_max || 0), dur: i.duration_s ? `, ${t('unit.s', { n: i.duration_s })}` : '', g: serverText(i.guidance) })}
                    </div>
                  </div>
                  <time>{dateTime(i.created_at)}</time>
                </li>
              ),
            )}
          </ul>
        )}
      </section>
      <div className="stack">
        <MapView sites={[]} crashes={crashes} emptyText={t('map.crash.empty')} />
        <section className="panel">
          <div className="section">
            <div className="section-head">
              <h3>{t('how.crash.title')}</h3>
              <p className="small">{t('how.crash.body')}</p>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
