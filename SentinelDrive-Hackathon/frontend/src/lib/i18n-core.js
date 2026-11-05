// Language lookup with no React in it, so plain scripts and tests can use it too.
import { STRINGS } from './strings.js'

export const LANGS = [
  { code: 'en', label: 'English', locale: 'en-IN', speech: 'en-IN' },
  { code: 'ta', label: 'தமிழ்', locale: 'ta-IN', speech: 'ta-IN' },
  { code: 'hi', label: 'हिन्दी', locale: 'hi-IN', speech: 'hi-IN' },
]
const CODES = LANGS.map((l) => l.code)
const STORE_KEY = 'sentinel.lang'

let current = 'en'
const listeners = new Set()

export const getLang = () => current
export const locale = (lang = current) => (LANGS.find((l) => l.code === lang) || LANGS[0]).locale

export function setLang(lang) {
  if (!CODES.includes(lang) || lang === current) return
  current = lang
  listeners.forEach((fn) => fn(lang))
}
export const onLangChange = (fn) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

// What language to start in: the saved choice, else the browser's language, else English.
export function initialLang(saved, browser) {
  if (CODES.includes(saved)) return saved
  const b = String(browser || '').toLowerCase().slice(0, 2)
  return CODES.includes(b) ? b : 'en'
}

export function loadLang() {
  let saved = null
  try {
    saved = localStorage.getItem(STORE_KEY)
  } catch {
    /* storage can be blocked; fall through */
  }
  return initialLang(saved, typeof navigator !== 'undefined' ? navigator.language : '')
}
export function saveLang(lang) {
  try {
    localStorage.setItem(STORE_KEY, lang)
  } catch {
    /* ignore */
  }
}

const fill = (s, vars) => (vars ? s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] === undefined || vars[k] === null ? m : String(vars[k]))) : s)

// tr('count.pothole', { n: 3 }) -> "3 potholes" / "3 குழிகள்" / "3 गड्ढे"
export function tr(key, vars, lang = current) {
  const entry = STRINGS[key]
  if (!entry) return key
  let v = entry[lang] ?? entry.en
  if (v && typeof v === 'object') v = vars && Number(vars.n) === 1 ? v.one : v.other
  return fill(v ?? key, vars)
}

// Sentences the server writes in English that we know how to say in the other languages.
// Anything else (street names, free-text notes, model names) is shown as it came.
export function serverText(text) {
  if (!text || current === 'en') return text
  const g = /^Emergency vehicle nearby\. Check your mirrors, slow down and move to the (left|right) to let it pass\. Do not stop in a junction\.$/.exec(text)
  if (g) return tr('siren.guidance', { side: tr(`side.${g[1]}`) })
  if (text === 'Monocular estimate from a single camera (no stereo or LiDAR).') return tr('method.mono')
  return text
}

// Bill-of-quantities line names come from the server; the fixed ones can be translated.
const BOQ = {
  'Tack coat (bitumen emulsion)': 'boq.tack',
  'Edge cutting and squaring': 'boq.edge',
  'Labour (patch crew)': 'boq.labour',
  'Traffic management and barricading': 'boq.traffic',
}
export const boqItem = (name) => (BOQ[name] ? tr(BOQ[name]) : name)
export const boqUnit = (unit) => (unit === 'job' ? tr('boq.job') : unit)
