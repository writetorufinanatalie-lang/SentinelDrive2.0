// Translation checks: complete, consistent, and every key the code asks for exists.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { STRINGS } from '../src/lib/strings.js'
import { tr, setLang, getLang, initialLang, serverText, boqItem, boqUnit, LANGS } from '../src/lib/i18n-core.js'

const langs = LANGS.map((l) => l.code)
assert.deepEqual(langs, ['en', 'ta', 'hi'])

const vars = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',')
const forms = (v) => (typeof v === 'object' ? [v.one, v.other] : [v])
// letters in the English text once {placeholders} are removed; 0 means the line is only placeholders
const wordsOf = (entry) => forms(entry.en).join(' ').replace(/\{\w+\}/g, '').replace(/[^A-Za-z]/g, '')

// 1. every entry has all three languages, non-empty, same placeholders, same shape (plural or not)
for (const [key, entry] of Object.entries(STRINGS)) {
  for (const l of langs) assert.ok(entry[l] !== undefined && forms(entry[l]).every((x) => typeof x === 'string' && x.trim()), `${key}: missing or empty ${l}`)
  const plural = typeof entry.en === 'object'
  for (const l of langs) assert.equal(typeof entry[l] === 'object', plural, `${key}: ${l} plural shape differs from English`)
  const want = forms(entry.en).map(vars)
  for (const l of ['ta', 'hi']) assert.deepEqual(forms(entry[l]).map(vars), want, `${key}: ${l} placeholders differ from English`)
  // the translation must not just be a copy of the English (except short symbols/units)
  for (const l of ['ta', 'hi']) {
    if (wordsOf(entry).length > 10) assert.notEqual(JSON.stringify(entry[l]), JSON.stringify(entry.en), `${key}: ${l} is still English`)
  }
}

// 2. Tamil and Hindi entries really are in their scripts (catches a swapped or pasted-English row)
const TAMIL = /[஀-௿]/
const DEVANAGARI = /[ऀ-ॿ]/
for (const [key, entry] of Object.entries(STRINGS)) {
  if (wordsOf(entry).length < 4) continue
  assert.ok(forms(entry.ta).some((s) => TAMIL.test(s)), `${key}: Tamil text has no Tamil letters`)
  assert.ok(forms(entry.hi).some((s) => DEVANAGARI.test(s)), `${key}: Hindi text has no Devanagari letters`)
}

// 3. every literal key used in the source exists
function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    statSync(p).isDirectory() ? walk(p, out) : /\.(jsx?|mjs)$/.test(f) && out.push(p)
  }
  return out
}
const used = new Set()
for (const file of walk(new URL('../src', import.meta.url).pathname)) {
  if (file.endsWith('strings.js')) continue
  const src = readFileSync(file, 'utf8')
  for (const m of src.matchAll(/\b(?:t|tr|speakT)\(\s*'([\w.\-]+)'/g)) used.add(m[1])
}
for (const k of used) assert.ok(STRINGS[k], `code uses missing key: ${k}`)
// dynamic keys built from a prefix must have every variant
const dynamic = {
  'status.': ['reported', 'verified', 'scheduled', 'repaired', 'rejected'],
  'sev.': ['high', 'medium', 'low'],
  'tier.': ['normal', 'elevated', 'critical'],
  'outcome.': ['answered', 'recovered'],
  'crash.st.': ['awaiting_driver', 'escalated', 'driver_ok', 'resolved', 'suppressed'],
  'state.': ['off', 'starting', 'loading', 'live', 'waiting', 'blocked', 'missing', 'unsupported', 'error'],
  'src.': ['device', 'photo-exif', 'set-on-map', 'none'],
  'side.': ['left', 'right'],
  'cam.': ['off', 'starting', 'loading', 'blocked', 'missing', 'error'],
}
for (const [p, ks] of Object.entries(dynamic)) for (const k of ks) assert.ok(STRINGS[p + k], `missing dynamic key ${p}${k}`)

// 4. plurals and variables
setLang('en')
assert.equal(tr('count.pothole', { n: 1 }), '1 pothole')
assert.equal(tr('count.pothole', { n: 3 }), '3 potholes')
assert.equal(tr('count.pothole', { n: 0 }), '0 potholes')
assert.equal(tr('time.min', { n: 5 }), '5 min ago')
setLang('ta')
assert.equal(getLang(), 'ta')
assert.equal(tr('count.pothole', { n: 1 }), '1 குழி')
assert.equal(tr('count.pothole', { n: 4 }), '4 குழிகள்')
assert.equal(tr('kpi.open'), 'திறந்த இடங்கள்')
setLang('hi')
assert.equal(tr('count.pothole', { n: 2 }), '2 गड्ढे')
assert.equal(tr('kpi.open'), 'खुली साइटें')
assert.equal(tr('nope.missing'), 'nope.missing') // unknown key shows the key, never crashes
assert.equal(tr('kpi.open', null, 'en'), 'Open sites') // explicit language wins
setLang('xx') // ignored
assert.equal(getLang(), 'hi')

// 5. starting language
assert.equal(initialLang('ta', 'en-US'), 'ta')
assert.equal(initialLang(null, 'hi-IN'), 'hi')
assert.equal(initialLang(null, 'ta'), 'ta')
assert.equal(initialLang(null, 'fr-FR'), 'en')
assert.equal(initialLang('zz', ''), 'en')

// 6. known server sentences are translated, everything else passes through
const g = 'Emergency vehicle nearby. Check your mirrors, slow down and move to the left to let it pass. Do not stop in a junction.'
setLang('en')
assert.equal(serverText(g), g)
setLang('hi')
assert.match(serverText(g), /बाईं/)
assert.equal(serverText('Some street name'), 'Some street name')
assert.equal(boqItem('Labour (patch crew)'), tr('boq.labour'))
assert.equal(boqItem('Hot-mix asphalt'), 'Hot-mix asphalt')
assert.equal(boqUnit('job'), 'कार्य')
assert.equal(boqUnit('m²'), 'm²')

console.log(`i18n ok: ${Object.keys(STRINGS).length} strings x ${langs.length} languages, ${used.size} keys used in code`)
