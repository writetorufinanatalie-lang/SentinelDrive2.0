import { useState } from 'react'
import { api } from '../../api'
import { setSession } from '../../lib/auth'

export default function Login() {
  const [username, setUsername] = useState('')
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
          <label htmlFor="u">Username</label>
          <input id="u" type="text" autoComplete="username" autoCapitalize="none" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
        </div>
        <div className="field">
          <label htmlFor="p">Password</label>
          <input id="p" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <span className="hint muted small">Each staff member has their own account. Ask your administrator (verifier) if you do not have one.</span>
        </div>
        {error && <div className="note error">{error}</div>}
        <button className="btn btn-primary" disabled={busy || !password || !username.trim()}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <a href="#/" className="muted small">Back to the home page</a>
      </form>
    </div>
  )
}
