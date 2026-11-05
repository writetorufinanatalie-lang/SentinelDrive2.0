import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { LANGS, loadLang, saveLang, setLang as setCoreLang, tr, getLang, onLangChange } from './i18n-core.js'

const Ctx = createContext(null)

// Wrap the app once. Every component that calls useI18n() re-renders when the language changes.
export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(() => {
    const l = loadLang()
    setCoreLang(l)
    return l
  })

  useEffect(() => onLangChange(setLangState), [])
  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

  // Browsers load speech voices lazily; asking early means they are ready when we need to speak.
  useEffect(() => {
    try {
      window.speechSynthesis?.getVoices()
    } catch {
      /* no speech support */
    }
  }, [])

  const setLang = useCallback((l) => {
    setCoreLang(l)
    saveLang(l)
  }, [])

  const value = useMemo(() => ({ lang, setLang, t: (key, vars) => tr(key, vars, lang), langs: LANGS }), [lang, setLang])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useI18n() {
  const v = useContext(Ctx)
  if (!v) return { lang: getLang(), setLang: setCoreLang, t: (k, vars) => tr(k, vars), langs: LANGS }
  return v
}

// Text with `code` segments: "run `python x.py` now" -> run <code>python x.py</code> now
export function Rich({ text }) {
  return text.split('`').map((part, i) => (i % 2 ? <code key={i}>{part}</code> : part))
}

export function LanguageSwitch() {
  const { lang, setLang, langs, t } = useI18n()
  return (
    <div className="seg lang-switch" role="group" aria-label={t('lang.label')}>
      {langs.map((l) => (
        <button key={l.code} className={lang === l.code ? 'on' : ''} onClick={() => setLang(l.code)} aria-pressed={lang === l.code} lang={l.code}>
          {l.label}
        </button>
      ))}
    </div>
  )
}
