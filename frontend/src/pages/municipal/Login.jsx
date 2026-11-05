import { useState } from 'react'
import { api } from '../../api'
import { setSession } from '../../lib/auth'

export default function Login() {
  const [username, setUsername] = useState('officer')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      setSession(await api.login(username, password))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-wrap">
      <form className="panel login" onSubmit={submit}>
        <h2>Municipal sign-in</h2>
        <p className="muted small">For municipal officers, repair teams and verifiers. Citizens do not need to sign in.</p>
        <div className="field">
          <label htmlFor="u">Role</label>
          <select id="u" value={username} onChange={(e) => setUsername(e.target.value)}>
            <option value="officer">Municipal officer</option>
            <option value="repairteam">Repair team</option>
            <option value="verifier">Verifier / administrator</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="p">Password</label>
          <input id="p" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
          <span className="hint muted small">The password is set by whoever deployed the app (SENTINEL_STAFF_PASSWORD).</span>
        </div>
        {error && <div className="note error">{error}</div>}
        <button className="btn btn-primary" disabled={busy || !password}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <a href="#/overview" className="muted small">Back to the citizen app</a>
      </form>
    </div>
  )
}
