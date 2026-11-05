import { useEffect, useState } from 'react'
import { Activity, Bell, ChartColumn, ClipboardList, LayoutDashboard, LogOut, Map as MapIcon, Users } from 'lucide-react'
import { api } from '../../api'
import { setSession, useStaff } from '../../lib/auth'
import { useLive } from '../../hooks/useLive'
import { Toaster } from '../../components/bits'
import { when as whenTs } from '../../lib/format'
import Admin from './Admin'
import Analytics from './Analytics'
import Cases from './Cases'
import Dashboard from './Dashboard'
import Login from './Login'
import MapPage from './MapPage'
import { ROLE_LABEL, STAFF_NOTIF } from './shared'

const PAGES = {
  '': { title: 'Command centre', sub: 'Live case counts and the priority queue', icon: LayoutDashboard, el: Dashboard },
  cases: { title: 'All cases', sub: 'Search, filter and work every pothole case', icon: ClipboardList, el: Cases },
  map: { title: 'Map', sub: 'Cases by priority and progress', icon: MapIcon, el: MapPage },
  analytics: { title: 'Analytics', sub: 'Response times, spend and trends from real records', icon: ChartColumn, el: Analytics },
  admin: { title: 'Teams and audit', sub: 'Repair teams and the change history', icon: Users, el: Admin },
}

function useSub() {
  const read = () => (location.hash.replace(/^#\/municipality\/?/, '').split('/')[0] || '')
  const [sub, setSub] = useState(read)
  useEffect(() => {
    const on = () => setSub(read())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return PAGES[sub] ? sub : ''
}

function Bell_({ unread, items, onOpen, onRead }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="bell">
      <button className="btn btn-ghost" onClick={() => { setOpen(!open); if (!open) onOpen() }} aria-label={`Notifications, ${unread} unread`}>
        <Bell size={18} />{unread > 0 && <span className="count-badge">{unread}</span>}
      </button>
      {open && (
        <div className="bell-pop panel">
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
            <strong>Notifications</strong>
            <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={onRead}>Mark all read</button>
          </div>
          {items.length === 0 ? <p className="muted small">Nothing yet.</p> : (
            <ul className="notif">
              {items.slice(0, 12).map((n) => (
                <li key={n.id} className={n.status === 'unread' ? 'unread' : ''}>
                  {(STAFF_NOTIF[n.code] || (() => n.code))(n.vars)} <span className="muted small">{whenTs(n.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

export default function Municipal() {
  const staff = useStaff()
  const sub = useSub()
  const { potholes, connected } = useLive()
  const [notes, setNotes] = useState([])

  const loadNotes = () => api.staffNotifications().then(setNotes).catch(() => {})
  useEffect(() => {
    if (staff) loadNotes()
  }, [staff, potholes])
  useEffect(() => {
    document.title = `${staff ? PAGES[sub].title : 'Sign in'} – SentinelDrive municipal`
  }, [sub, staff])

  if (!staff) return <div className="shell login-shell"><Login /><Toaster /></div>
  const user = staff.user
  const Page = PAGES[sub].el
  const unread = notes.filter((n) => n.status === 'unread').length
  return (
    <div className="shell">
      <nav className="side" aria-label="Municipal">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true"><Activity size={18} /></div>
          <div>
            <div className="brand-name">SentinelDrive</div>
            <div className="brand-sub">Municipal dashboard</div>
          </div>
        </div>
        <div className="nav">
          {Object.entries(PAGES).map(([k, p]) => {
            const Icon = p.icon
            return (
              <a key={k} href={`#/municipality${k ? '/' + k : ''}`} className={sub === k ? 'active' : ''} aria-current={sub === k ? 'page' : undefined}>
                <Icon size={18} /> {p.title}
              </a>
            )
          })}
        </div>
        <div className="vehicle">
          <h3>{user.name}</h3>
          <p>{ROLE_LABEL[user.role]}</p>
          <button className="btn btn-block" onClick={() => setSession(null)}><LogOut size={15} /> Sign out</button>
          <a href="#/overview" className="conn" style={{ marginTop: 12, color: '#9aa3a0' }}>Citizen app</a>
          <div className="conn"><span className={`dot ${connected ? 'live' : 'bad'}`} />{connected ? 'Live' : 'Reconnecting…'}</div>
        </div>
      </nav>
      <div className="main">
        <header className="topbar">
          <div className="titles">
            <h1>{PAGES[sub].title}</h1>
            <p>{PAGES[sub].sub}</p>
          </div>
          <div className="actions">
            <Bell_ unread={unread} items={notes} onOpen={loadNotes} onRead={() => api.readStaffNotifications().then(loadNotes)} />
          </div>
        </header>
        <main className="content">
          <Page user={user} />
        </main>
      </div>
      <Toaster />
    </div>
  )
}
