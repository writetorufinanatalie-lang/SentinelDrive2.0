import { useEffect, useState } from 'react'
import { api } from '../../api'
import { toast } from '../../components/bits'
import { dateTime } from '../../lib/format'
import { ROLE_LABEL, can, isOfficer } from './shared'

function StaffAccounts({ user }) {
  const [rows, setRows] = useState(null)
  const [f, setF] = useState({ username: '', role: 'officer', password: '' })
  const [reset, setReset] = useState({})
  const load = () => api.staffList().then(setRows).catch((e) => toast(e.message))
  useEffect(() => { load() }, [])
  const run = async (fn, ok) => {
    try {
      await fn()
      toast(ok)
      load()
    } catch (e) {
      toast(e.message)
    }
  }
  const add = (e) => {
    e.preventDefault()
    run(async () => { await api.addStaff(f.username, f.role, f.password); setF({ username: '', role: 'officer', password: '' }) }, 'Account created')
  }
  return (
    <section className="panel">
      <div className="panel-head"><h2>Staff accounts</h2><span className="aside">each person signs in with their own password</span></div>
      <div className="panel-body">
        {!rows ? <p className="muted">Loading…</p> : (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Username</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.username}>
                    <td>{r.username}{r.username === user.name ? ' (you)' : ''}</td>
                    <td className="small">{ROLE_LABEL[r.role]}</td>
                    <td className="small">{r.active ? 'Active' : 'Disabled'}</td>
                    <td>
                      <div className="acct-row">
                        {r.username !== user.name && (
                          <button className="btn btn-sm" onClick={() => run(() => api.setStaffActive(r.username, !r.active), r.active ? 'Account disabled' : 'Account enabled')}>{r.active ? 'Disable' : 'Enable'}</button>
                        )}
                        <input type="password" autoComplete="new-password" placeholder="New password" value={reset[r.username] || ''} onChange={(e) => setReset({ ...reset, [r.username]: e.target.value })} style={{ width: 150 }} />
                        <button className="btn btn-sm" disabled={(reset[r.username] || '').length < 8} onClick={() => run(async () => { await api.resetStaffPassword(r.username, reset[r.username]); setReset({ ...reset, [r.username]: '' }) }, 'Password reset')}>Reset password</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <form className="acct-form" onSubmit={add}>
          <div className="field"><label htmlFor="ns-u">New username</label><input id="ns-u" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} autoComplete="off" /></div>
          <div className="field"><label htmlFor="ns-r">Role</label>
            <select id="ns-r" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
              {Object.entries(ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div className="field"><label htmlFor="ns-p">Password (8+ characters)</label><input id="ns-p" type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></div>
          <button className="btn btn-primary" disabled={!f.username.trim() || f.password.length < 8}>Create account</button>
        </form>
        <p className="muted small" style={{ marginTop: 10 }}>Disabling an account or changing its password signs that person out immediately. Everything is recorded in the audit trail below.</p>
      </div>
    </section>
  )
}

function Alerts() {
  const [info, setInfo] = useState(null)
  const [routes, setRoutes] = useState([])
  const [email, setEmail] = useState('')
  const [result, setResult] = useState(null)
  const load = () => api.alerts().then((a) => { setInfo(a); setRoutes(a.routes) }).catch((e) => toast(e.message))
  useEffect(() => { load() }, [])
  const save = async () => {
    try {
      setRoutes(await api.saveRoutes(routes))
      toast('Ward routes saved')
    } catch (e) {
      toast(e.message)
    }
  }
  const test = async () => {
    try {
      setResult(await api.testAlert(email))
      load()
    } catch (e) {
      toast(e.message)
    }
  }
  if (!info) return <section className="panel"><div className="panel-head"><h2>Alerts to the municipality</h2></div><div className="panel-body"><p className="muted">Loading…</p></div></section>
  return (
    <section className="panel">
      <div className="panel-head"><h2>Alerts to the municipality</h2><span className="aside">email and webhook when a case needs attention</span></div>
      <div className="panel-body">
        <p className="small">
          Email: <strong>{info.email_ready ? 'set up' : 'not set up'}</strong> · Webhook (Slack, Discord, Teams): <strong>{info.webhook_ready ? 'set up' : 'not set up'}</strong> · Default address: <strong>{info.default_email || 'none'}</strong>
        </p>
        {!info.email_ready && !info.webhook_ready && <div className="note warn" style={{ margin: '8px 0' }}>Nothing is sent yet. Set SENTINEL_SMTP_HOST, SENTINEL_SMTP_USER and SENTINEL_SMTP_PASSWORD (email) or SENTINEL_CASE_WEBHOOK (Slack and similar) in the server settings. See the README.</div>}
        <p className="muted small">A new case, a rise to high priority, an overdue case, a finished repair and a rejected repair are sent to the ward address whose text appears in the case address. Otherwise they go to the default address.</p>
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>If the address contains</th><th>Send to</th><th /></tr></thead>
            <tbody>
              {routes.map((r, i) => (
                <tr key={i}>
                  <td><input value={r.match} onChange={(e) => setRoutes(routes.map((x, j) => (j === i ? { ...x, match: e.target.value } : x)))} placeholder="e.g. Adyar" /></td>
                  <td><input value={r.email} onChange={(e) => setRoutes(routes.map((x, j) => (j === i ? { ...x, email: e.target.value } : x)))} placeholder="ward-office@city.gov" /></td>
                  <td><button className="btn btn-sm" onClick={() => setRoutes(routes.filter((_, j) => j !== i))}>Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="acct-row" style={{ marginTop: 8 }}>
          <button className="btn" onClick={() => setRoutes([...routes, { match: '', email: '' }])}>Add ward</button>
          <button className="btn btn-primary" onClick={save}>Save ward routes</button>
        </div>
        <div className="acct-row" style={{ marginTop: 14 }}>
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Send a test to this email" style={{ minWidth: 240 }} />
          <button className="btn" onClick={test}>Send test alert</button>
        </div>
        {result && (
          <p className="small" style={{ marginTop: 8 }}>
            {Object.entries(result).map(([k, v]) => `${k}: ${v.ok ? 'sent' : 'failed (' + v.error + ')'}`).join(' · ')}
          </p>
        )}
        {info.recent.length > 0 && (
          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table className="data">
              <thead><tr><th>When</th><th>Via</th><th>To</th><th>Subject</th><th>Result</th></tr></thead>
              <tbody>{info.recent.map((r, i) => <tr key={i}><td className="small">{dateTime(r.ts)}</td><td className="small">{r.channel}</td><td className="small">{r.to}</td><td className="small">{r.subject}</td><td className="small">{r.ok ? 'Sent' : `Failed: ${r.error}`}</td></tr>)}</tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  )
}

export default function Admin({ user }) {
  const [teams, setTeams] = useState([])
  const [name, setName] = useState('')
  const [audit, setAudit] = useState(null)

  useEffect(() => {
    api.teams().then(setTeams).catch(() => {})
    if (can(user, 'verifier')) api.audit().then(setAudit).catch((e) => toast(e.message))
  }, [user])

  const add = async (e) => {
    e.preventDefault()
    try {
      setTeams(await api.addTeam(name))
      setName('')
      toast('Team added')
    } catch (err) {
      toast(err.message)
    }
  }

  return (
    <div className="stack">
      {can(user, 'verifier') && <StaffAccounts user={user} />}
      {can(user, 'verifier') && <Alerts />}
      <section className="panel">
        <div className="panel-head"><h2>Repair teams</h2></div>
        <div className="panel-body">
          <ul className="plain">{teams.map((t) => <li key={t.id}>{t.name}</li>)}</ul>
          {isOfficer(user) ? (
            <form className="row" onSubmit={add} style={{ marginTop: 10 }}>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="New team name" />
              <button className="btn" disabled={!name.trim()}>Add team</button>
            </form>
          ) : <p className="muted small">Only officers and verifiers can add teams.</p>}
        </div>
      </section>
      <section className="panel">
        <div className="panel-head"><h2>Audit trail</h2><span className="aside">who changed what, newest first</span></div>
        <div className="panel-body">
          {!can(user, 'verifier') ? <p className="muted">Only the verifier / administrator role can see the audit trail.</p> : !audit ? <p className="muted">Loading…</p> : (
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>When</th><th>Case</th><th>Change</th><th>By</th><th>Note</th></tr></thead>
                <tbody>
                  {audit.map((r, i) => (
                    <tr key={i}>
                      <td className="small">{dateTime(r.ts)}</td>
                      <td>{r.case}</td>
                      <td className="small">{r.from ? `${r.from} → ` : ''}{r.to}{r.internal ? ' (internal note)' : ''}</td>
                      <td className="small">{r.by} <span className="muted">({r.role})</span></td>
                      <td className="small">{r.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
