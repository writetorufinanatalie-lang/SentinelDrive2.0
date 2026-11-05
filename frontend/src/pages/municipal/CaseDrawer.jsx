import { useCallback, useEffect, useState } from 'react'
import { api } from '../../api'
import { useLive } from '../../hooks/useLive'
import SiteDrawer from '../../components/SiteDrawer'
import { toast } from '../../components/bits'
import { dateTime } from '../../lib/format'
import { PRIORITIES, can, cap, isOfficer } from './shared'

// A case as the municipality sees it: the normal case view plus the actions the signed-in role may take.
export default function CaseDrawer({ id, user, onClose, onChanged }) {
  const { potholes } = useLive()
  const [site, setSite] = useState(null)
  const [teams, setTeams] = useState([])

  const load = useCallback(() => api.caseDetail(id).then(setSite).catch((e) => toast(e.message)), [id])
  useEffect(() => {
    load()
  }, [load, potholes])
  useEffect(() => {
    api.teams().then(setTeams).catch(() => {})
  }, [])

  const run = async (body, msg) => {
    try {
      const next = await api.caseAction(id, body)
      setSite(next)
      toast(msg || 'Saved')
      onChanged?.()
      return true
    } catch (e) {
      toast(e.message)
      return false
    }
  }

  if (!site) return null
  return (
    <SiteDrawer
      id={id}
      site={site}
      onClose={onClose}
      onPickLocation={isOfficer(user) ? (p) => run({ action: 'set_location', ...p }, 'Location saved') : undefined}
      staffPanel={<StaffPanel site={site} user={user} teams={teams} run={run} onDeleted={() => { onChanged?.(); onClose() }} onCompleted={(s) => { setSite(s); onChanged?.() }} />}
    />
  )
}

function Box({ title, children }) {
  return (
    <section className="staff-box">
      <h3>{title}</h3>
      {children}
    </section>
  )
}

function StaffPanel({ site, user, teams, run, onDeleted, onCompleted }) {
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [iNote, setINote] = useState('')
  const [team, setTeam] = useState(site.assignment?.team || teams[0]?.name || '')
  const [officer, setOfficer] = useState(site.assignment?.officer || '')
  const [target, setTarget] = useState('')
  const [internal, setInternal] = useState('')
  const [cat, setCat] = useState('high')
  const [ovReason, setOvReason] = useState('')
  const [file, setFile] = useState(null)
  const [cost, setCost] = useState('')
  const [busy, setBusy] = useState(false)
  const st = site.status
  const officerRole = isOfficer(user)
  const wrap = async (fn) => {
    setBusy(true)
    try {
      await fn()
    } finally {
      setBusy(false)
    }
  }

  const finish = () =>
    wrap(async () => {
      try {
        const fd = new FormData()
        fd.append('file', file)
        if (note) fd.append('note', note)
        if (cost !== '') fd.append('actual_cost', cost)
        onCompleted(await api.completeCase(site.id, fd))
        toast('Repair completed. Waiting for verification.')
        setFile(null)
        setNote('')
      } catch (e) {
        toast(e.message)
      }
    })

  return (
    <>
      {site.needs_review && (
        <div className="note warn">
          <strong>Flagged for review.</strong> A citizen said this is the same pothole as an existing report, but the photos did not clearly match. Check the submissions below.
          {officerRole && <> <button className="btn btn-sm" disabled={busy} onClick={() => run({ action: 'clear_review' }, 'Review cleared')}>Keep as one case</button></>}
        </div>
      )}
      {site.overdue && <div className="note error">This case is overdue.</div>}

      <Box title="Next step">
        {st === 'reported' && officerRole && (
          <div className="row">
            <button className="btn btn-primary" disabled={busy} onClick={() => wrap(() => run({ action: 'acknowledge' }, 'Acknowledged'))}>Acknowledge</button>
          </div>
        )}
        {['acknowledged', 'reopened', 'assigned'].includes(st) && officerRole && (
          <div className="stack-sm">
            <div className="row">
              <select value={team} onChange={(e) => setTeam(e.target.value)} aria-label="Repair team">
                {teams.map((t) => <option key={t.id}>{t.name}</option>)}
              </select>
              <input type="text" value={officer} onChange={(e) => setOfficer(e.target.value)} placeholder="Responsible officer" />
              <input type="date" value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Target completion date" />
            </div>
            <input type="text" value={internal} onChange={(e) => setInternal(e.target.value)} placeholder="Internal note for the team (not shown to citizens)" />
            <div className="row">
              <button className="btn btn-primary" disabled={busy || !team} onClick={() => wrap(() => run({ action: 'assign', team, officer: officer || undefined, internal_note: internal || undefined, target_date: target ? new Date(`${target}T23:59:00`).getTime() : undefined }, 'Assigned'))}>
                {st === 'assigned' ? 'Reassign' : 'Assign team'}
              </button>
            </div>
          </div>
        )}
        {st === 'assigned' && user.role === 'repair' && (
          <button className="btn btn-primary" disabled={busy} onClick={() => wrap(() => run({ action: 'start' }, 'Repair started'))}>Start repair</button>
        )}
        {st === 'in_progress' && user.role === 'repair' && (
          <div className="stack-sm">
            <label className="small" htmlFor="after">After-repair photo (required)</label>
            <input id="after" type="file" accept="image/*" capture="environment" onChange={(e) => setFile(e.target.files?.[0] || null)} />
            <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Repair notes" />
            <input type="number" min="0" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="Actual cost in rupees (optional)" />
            <button className="btn btn-primary" disabled={busy || !file} onClick={finish}>Mark repair completed</button>
          </div>
        )}
        {st === 'completed' && user.role === 'verifier' && (
          <div className="stack-sm">
            <p className="small muted">Compare the Before and After photos below. A photo alone does not prove the repair; a site visit may still be needed.</p>
            <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Note (accept) or reason (reject, required)" />
            <div className="row">
              <button className="btn btn-primary" disabled={busy} onClick={() => wrap(() => run({ action: 'verify', note: reason || undefined }, 'Repair verified'))}>Accept repair</button>
              <button className="btn" disabled={busy || !reason.trim()} onClick={() => wrap(() => run({ action: 'reject_repair', reason }, 'Repair rejected, case reopened'))}>Reject and reopen</button>
            </div>
          </div>
        )}
        {st === 'verified' && user.role === 'verifier' && (
          <div className="stack-sm">
            <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for reopening (required)" />
            <button className="btn" disabled={busy || !reason.trim()} onClick={() => wrap(() => run({ action: 'reopen', reason }, 'Case reopened'))}>Reopen case</button>
          </div>
        )}
        {st === 'rejected' && officerRole && (
          <button className="btn" disabled={busy} onClick={() => wrap(() => run({ action: 'restore' }, 'Restored'))}>Restore as reported</button>
        )}
        {['reported', 'acknowledged'].includes(st) && officerRole && (
          <div className="row" style={{ marginTop: 8 }}>
            <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (not a pothole)" />
            <button className="btn" disabled={busy || !reason.trim()} onClick={() => wrap(() => run({ action: 'reject', reason }, 'Marked as not a pothole'))}>Not a pothole</button>
          </div>
        )}
        {!(
          (st === 'reported' && officerRole) || (['acknowledged', 'reopened', 'assigned'].includes(st) && officerRole) ||
          (st === 'assigned' && user.role === 'repair') || (st === 'in_progress' && user.role === 'repair') ||
          (st === 'completed' && user.role === 'verifier') || (st === 'verified' && user.role === 'verifier') || (st === 'rejected' && officerRole)
        ) && <p className="muted small">Nothing for your role to do at this stage.</p>}
      </Box>

      {officerRole && (
        <Box title="Priority">
          <p className="small">
            Calculated: <strong>{cap(site.priority_info.calculated_category)}</strong> ({site.priority_info.calculated_score}/100)
            {site.priority_override && <> · Overridden to <strong>{cap(site.priority_override.category)}</strong>: “{site.priority_override.reason}” ({site.priority_override.by})</>}
          </p>
          <div className="row">
            <select value={cat} onChange={(e) => setCat(e.target.value)} aria-label="New priority">{PRIORITIES.map((p) => <option key={p} value={p}>{cap(p)}</option>)}</select>
            <input type="text" value={ovReason} onChange={(e) => setOvReason(e.target.value)} placeholder="Reason (required)" />
            <button className="btn" disabled={busy || !ovReason.trim()} onClick={() => wrap(async () => { if (await run({ action: 'override_priority', category: cat, reason: ovReason }, 'Priority changed')) setOvReason('') })}>Override</button>
            {site.priority_override && <button className="btn btn-ghost" disabled={busy} onClick={() => wrap(() => run({ action: 'override_priority', category: 'clear' }, 'Override removed'))}>Remove</button>}
          </div>
        </Box>
      )}

      <Box title={`Submissions (${site.reports}, ${site.reporters_count || site.citizens} unique citizens)`}>
        <ul className="subs">
          {site.evidence.map((e, i) => (
            <li key={i}>
              <img src={e.annotated} alt="" />
              <span className="small">{dateTime(e.ts)}{e.match ? ` · joined by ${e.match.method === 'auto' ? 'photo match' : 'citizen confirmation'}, ${Math.round(e.match.distance_m)} m away${e.match.similarity != null ? `, photo similarity ${Math.round(e.match.similarity * 100)}%` : ', photos too plain to compare'}` : ' · first report'}</span>
            </li>
          ))}
        </ul>
      </Box>

      <Box title="Internal note">
        <div className="row">
          <input type="text" value={iNote} onChange={(e) => setINote(e.target.value)} placeholder="Visible to staff only" />
          <button className="btn" disabled={busy || !iNote.trim()} onClick={() => wrap(async () => { if (await run({ action: 'note', note: iNote }, 'Note added')) setINote('') })}>Add</button>
        </div>
        {site.assignment?.internal_note && <p className="small muted" style={{ marginTop: 6 }}>Team note: {site.assignment.internal_note}</p>}
      </Box>

      {can(user, 'verifier') && (
        <button className="btn btn-ghost btn-danger" onClick={async () => { if (window.confirm(`Delete ${site.id} and its photos? This cannot be undone.`)) { try { await api.deleteCase(site.id); toast('Deleted'); onDeleted() } catch (e) { toast(e.message) } } }}>Delete case</button>
      )}
    </>
  )
}
