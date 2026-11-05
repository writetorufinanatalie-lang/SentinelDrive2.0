import { useEffect, useState } from 'react'
import { api } from '../../api'
import { toast } from '../../components/bits'
import { dateTime } from '../../lib/format'
import { can, isOfficer } from './shared'

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
          <p className="muted small" style={{ marginTop: 10 }}>Staff accounts are fixed to three roles and share one password set at deployment (SENTINEL_STAFF_PASSWORD). Individual accounts are not built yet.</p>
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
