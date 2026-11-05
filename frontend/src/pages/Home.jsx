import { useState } from 'react'
import { Building2, ShieldCheck, Users } from 'lucide-react'
import { api } from '../api'
import { LanguageSwitch, useI18n } from '../lib/i18n'
import { continueAsGuest, setCitizen } from '../lib/citizen'

// The front door: two separate apps, one for citizens and one for municipal staff.
export default function Home() {
  const { t } = useI18n()
  const [mode, setMode] = useState('signin') // signin | register
  const [name, setName] = useState('')
  const [contact, setContact] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const enter = () => {
    location.hash = '#/overview'
  }
  const submit = async (e) => {
    e.preventDefault()
    setError('')
    const register = mode === 'register'
    if (register && name.trim().length < 2) return setError(t('home.err.name'))
    if (!contact.trim()) return setError(t('home.err.contact'))
    if (!password) return setError(t('home.err.password'))
    setBusy(true)
    try {
      setCitizen(register ? await api.citizenRegister(name.trim(), contact.trim(), password) : await api.citizenLogin(contact.trim(), password))
      enter()
    } catch (err) {
      setError(err.message) // the server's reason: wrong password, account exists, password too weak...
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="home">
      <header className="home-top">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true"><span /></div>
          <div className="brand-name">SentinelDrive</div>
        </div>
        <LanguageSwitch />
      </header>

      <section className="home-hero">
        <h1>{t('home.title')}</h1>
        <p>{t('home.tag')}</p>
      </section>

      <div className="home-cards">
        <section className="home-card" aria-labelledby="h-cit">
          <div className="home-ic"><Users size={22} /></div>
          <h2 id="h-cit">{t('home.cit.title')}</h2>
          <p className="muted">{t('home.cit.desc')}</p>
          <div className="seg" role="group" aria-label={t('home.cit.title')}>
            <button type="button" className={mode === 'signin' ? 'on' : ''} aria-pressed={mode === 'signin'} onClick={() => { setMode('signin'); setError('') }}>{t('home.tab.signin')}</button>
            <button type="button" className={mode === 'register' ? 'on' : ''} aria-pressed={mode === 'register'} onClick={() => { setMode('register'); setError('') }}>{t('home.tab.register')}</button>
          </div>
          <form onSubmit={submit} className="home-form">
            {mode === 'register' && (
              <>
                <label htmlFor="h-name">{t('home.name')}</label>
                <input id="h-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
              </>
            )}
            <label htmlFor="h-contact">{t('home.contact')}</label>
            <input id="h-contact" value={contact} onChange={(e) => setContact(e.target.value)} autoComplete="username" inputMode="email" />
            <label htmlFor="h-pw">{t('home.password')}</label>
            <input id="h-pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} />
            {error && <div className="note error" role="alert">{error}</div>}
            <button className="btn btn-primary btn-block" type="submit" disabled={busy}>{mode === 'register' ? t('home.register') : t('home.signin')}</button>
            <button className="btn btn-block" type="button" onClick={() => { continueAsGuest(); enter() }}>{t('home.guest')}</button>
          </form>
          <p className="muted small">{t('home.note')}</p>
        </section>

        <section className="home-card" aria-labelledby="h-mun">
          <div className="home-ic dark"><Building2 size={22} /></div>
          <h2 id="h-mun">{t('home.mun.title')}</h2>
          <p className="muted">{t('home.mun.desc')}</p>
          <ul className="home-points">
            <li><ShieldCheck size={15} /> {t('home.mun.p1')}</li>
            <li><ShieldCheck size={15} /> {t('home.mun.p2')}</li>
            <li><ShieldCheck size={15} /> {t('home.mun.p3')}</li>
          </ul>
          <a className="btn btn-primary btn-block" href="#/municipality">{t('home.mun.btn')}</a>
        </section>
      </div>
    </div>
  )
}
