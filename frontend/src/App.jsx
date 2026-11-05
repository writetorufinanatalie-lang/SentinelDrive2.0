import { useCallback, useEffect, useState } from 'react'
import { Activity, ClipboardList, Gauge, LayoutDashboard, Plus, Settings as SettingsIcon, TriangleAlert } from 'lucide-react'
import { LiveProvider, useLive } from './hooks/useLive'
import { SensorsProvider, useSensors } from './hooks/useSensors'
import { I18nProvider, LanguageSwitch, useI18n } from './lib/i18n'
import { AlertnessOverlay, CrashOverlay, SirenBanner } from './components/Overlays'
import ReportDialog from './components/ReportDialog'
import SiteDrawer from './components/SiteDrawer'
import { Toaster } from './components/bits'
import Overview from './pages/Overview'
import Defects from './pages/Defects'
import Driver from './pages/Driver'
import Incidents from './pages/Incidents'
import Settings from './pages/Settings'
import MyReports from './pages/MyReports'

// title / sub are translation keys (nav.<page> and sub.<page>)
const PAGES = {
  overview: { icon: LayoutDashboard, el: Overview },
  defects: { icon: TriangleAlert, el: Defects },
  driver: { icon: Gauge, el: Driver },
  reports: { icon: ClipboardList, el: MyReports },
  incidents: { icon: Activity, el: Incidents },
  settings: { icon: SettingsIcon, el: Settings },
}

function useRoute() {
  const read = () => {
    const k = location.hash.replace(/^#\/?/, '').split('/')[0]
    return PAGES[k] ? k : 'overview'
  }
  const [route, setRoute] = useState(read)
  useEffect(() => {
    const on = () => setRoute(read())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return route
}

const KNOWN_STATES = ['off', 'starting', 'loading', 'live', 'waiting', 'blocked', 'missing', 'unsupported', 'error']
const dotClass = (s) => (s === 'live' ? 'live' : ['blocked', 'error', 'missing'].includes(s) ? 'bad' : ['off', 'unsupported'].includes(s) ? '' : 'warn')

function VehiclePanel() {
  const s = useSensors()
  const { connected } = useLive()
  const { t } = useI18n()
  const rows = [
    [t('sensor.camera'), s.camera],
    [t('sensor.mic'), s.mic],
    [t('sensor.motion'), s.motion],
    [t('sensor.location'), s.gps.state, s.gps.state === 'live' && s.gps.accuracy ? `±${Math.round(s.gps.accuracy)} m` : null],
  ]
  return (
    <div className="vehicle">
      <h3>{t('device.title')}</h3>
      <p>{s.running ? t('device.running') : t('device.idle')}</p>
      {s.running && (
        <ul className="sensor-list">
          {rows.map(([k, v, extra]) => (
            <li key={k}>
              <span className={`dot ${dotClass(v)}`} />
              {k}
              <span className="state">{extra || (KNOWN_STATES.includes(v) ? t(`state.${v}`) : v)}</span>
            </li>
          ))}
        </ul>
      )}
      {s.running ? (
        <button className="btn btn-block" onClick={s.stop}>{t('action.stop')}</button>
      ) : (
        <button className="btn btn-primary btn-block" onClick={s.start}>{t('action.start')}</button>
      )}
      {s.error && <p style={{ color: '#f0a29c', marginTop: 8 }}>{s.error}</p>}
      <div className="conn">
        <span className={`dot ${connected ? 'live' : 'bad'}`} />
        {connected ? t('conn.ok') : t('conn.retry')}
      </div>
    </div>
  )
}

function Shell() {
  const { t } = useI18n()
  const route = useRoute()
  const { potholes, incidents, connected, loaded } = useLive()
  const sensors = useSensors()
  const [reporting, setReporting] = useState(false)
  const [siteId, setSiteId] = useState(null)
  const Page = PAGES[route].el
  const openSite = useCallback((id) => {
    setReporting(false)
    setSiteId(id)
  }, [])

  const openCount = potholes.filter((p) => ['reported', 'verified', 'scheduled'].includes(p.status)).length
  const activeIncidents = incidents.filter((i) => ['awaiting_driver', 'escalated'].includes(i.status)).length

  useEffect(() => {
    document.title = `${t(`nav.${route}`)} – SentinelDrive`
  }, [route, t])

  useEffect(() => {
    setSiteId(null)
  }, [route])

  return (
    <div className="shell">
      <nav className="side" aria-label="Main">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true"><span /></div>
          <div>
            <div className="brand-name">SentinelDrive</div>
            <div className="brand-sub">{t('brand.sub')}</div>
          </div>
        </div>
        <div className="nav">
          {Object.entries(PAGES).map(([k, p]) => {
            const Icon = p.icon
            const count = k === 'defects' ? openCount : k === 'incidents' ? activeIncidents : null
            return (
              <a key={k} href={`#/${k}`} className={route === k ? 'active' : ''} aria-current={route === k ? 'page' : undefined}>
                <Icon size={18} />
                {t(`nav.${k}`)}
                {count ? <span className="count">{count}</span> : null}
              </a>
            )
          })}
        </div>
        <VehiclePanel />
      </nav>

      <div className="main">
        <header className="topbar">
          <div className="titles">
            <h1>{t(`nav.${route}`)}</h1>
            <p>{t(`sub.${route}`)}</p>
          </div>
          <div className="actions">
            <LanguageSwitch />
            <button className="btn btn-primary" onClick={() => setReporting(true)}>
              <Plus size={17} /> {t('action.report')}
            </button>
          </div>
        </header>
        <main className="content">
          {!connected && loaded && (
            <div className="note error" style={{ marginBottom: 16 }}>
              {t('server.down')}
            </div>
          )}
          <Page openSite={openSite} openReport={() => setReporting(true)} />
        </main>
      </div>

      {reporting && <ReportDialog onClose={() => setReporting(false)} onOpenSite={openSite} />}
      {siteId && <SiteDrawer id={siteId} onClose={() => setSiteId(null)} />}
      {sensors.running && (
        <>
          <SirenBanner />
          <CrashOverlay />
          <AlertnessOverlay />
        </>
      )}
      <Toaster />
    </div>
  )
}

export default function App() {
  return (
    <I18nProvider>
      <LiveProvider>
        <SensorsProvider>
          <Shell />
        </SensorsProvider>
      </LiveProvider>
    </I18nProvider>
  )
}
