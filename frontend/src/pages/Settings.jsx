import { useEffect, useState } from 'react'
import { api } from '../api'
import { useLive } from '../hooks/useLive'
import { CONTACT_KEY, readContact } from '../components/Overlays'
import { toast } from '../components/bits'
import { money } from '../lib/format'
import { estimatePreview } from '../lib/estimate'
import { Rich, useI18n } from '../lib/i18n'
import { useStaff } from '../lib/auth'

// [field, label key, input type, placeholder key]
const RATE_FIELDS = [
  ['authority', 'rate.authority', 'text', 'rate.authority.ph'],
  ['material_name', 'rate.material', 'text'],
  ['material_rate_per_tonne', 'rate.material_rate', 'number'],
  ['material_density_t_per_m3', 'rate.density', 'number'],
  ['wastage_pct', 'rate.wastage', 'number'],
  ['tack_coat_rate_per_m2', 'rate.tack', 'number'],
  ['edge_cutting_rate_per_m', 'rate.edge', 'number'],
  ['labour_per_patch', 'rate.labour', 'number'],
  ['traffic_management_per_patch', 'rate.barricade', 'number'],
  ['gst_pct', 'rate.gst', 'number'],
  ['source_note', 'rate.source', 'text', 'rate.source.ph'],
]

export default function Settings() {
  const { t } = useI18n()
  const { health } = useLive()
  const staff = useStaff()
  const canEditRates = ['officer', 'verifier'].includes(staff?.user?.role)
  const [card, setCard] = useState(null)
  const [saving, setSaving] = useState(false)
  const [prefs, setPrefs] = useState(null)
  const [contact, setContact] = useState(() => readContact() || { name: '', phone: '' })

  useEffect(() => {
    api.rateCard().then((r) => setCard(r.rate_card)).catch(() => {})
    api.prefs().then(setPrefs).catch(() => {})
  }, [])

  const saveCard = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      const r = await api.saveRateCard(card)
      setCard(r.rate_card)
      const { updated } = await api.recalculate()
      toast(t('toast.rates', { n: updated }))
    } catch (err) {
      toast(err.message)
    } finally {
      setSaving(false)
    }
  }

  const saveContact = (e) => {
    e.preventDefault()
    try {
      localStorage.setItem(CONTACT_KEY, JSON.stringify(contact))
      toast(t('toast.contact'))
    } catch {
      toast(t('toast.contactfail'))
    }
  }

  const savePrefs = async (patch) => {
    const next = await api.savePrefs({ ...prefs, ...patch })
    setPrefs(next)
    toast(t('toast.saved'))
  }

  return (
    <div className="stack" style={{ maxWidth: 920 }}>
      <form className="panel" onSubmit={saveCard}>
        {!canEditRates && <div className="note warn" style={{ margin: '12px 18px 0' }}>{t('sys.rates.staff')}</div>}
        <div className="section">
          <div className="section-head">
            <h2>{t('rate.title')}</h2>
            <p className="small">{t('rate.body')}</p>
          </div>
          {card ? (
            <>
              <div className="settings-grid">
                {RATE_FIELDS.map(([k, labelKey, type, phKey]) => (
                  <div className="field" key={k} style={type === 'text' ? { gridColumn: '1 / -1' } : undefined}>
                    <label htmlFor={k}>{t(labelKey)}</label>
                    <input
                      id={k}
                      type={type}
                      step="any"
                      min={type === 'number' ? 0 : undefined}
                      placeholder={phKey ? t(phKey) : undefined}
                      value={card[k] ?? ''}
                      disabled={!canEditRates}
                      onChange={(e) => setCard({ ...card, [k]: type === 'number' ? e.target.value : e.target.value })}
                    />
                  </div>
                ))}
              </div>
              <p className="muted small">
                {t('rate.example', { amount: money(estimatePreview(card)) })}
              </p>
              <div>
                <button className="btn btn-primary" disabled={saving || !canEditRates}>{saving ? t('rate.saving') : t('rate.save')}</button>
              </div>
            </>
          ) : (
            <p className="muted">{t('rate.loading')}</p>
          )}
        </div>
      </form>

      <section className="panel">
        <form className="section" onSubmit={saveContact}>
          <div className="section-head">
            <h2>{t('contact.title')}</h2>
            <p className="small">{t('contact.body')}</p>
          </div>
          <div className="settings-grid">
            <div className="field">
              <label htmlFor="cname">{t('contact.name')}</label>
              <input id="cname" type="text" value={contact.name} onChange={(e) => setContact({ ...contact, name: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="cphone">{t('contact.phone')}</label>
              <input id="cphone" type="tel" value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })} placeholder="+91 98xxxxxxxx" />
            </div>
          </div>
          <div>
            <button className="btn btn-primary">{t('contact.save')}</button>
          </div>
        </form>
        {prefs && (
          <div className="section">
            <div className="section-head">
              <h2>{t('side.title')}</h2>
              <p className="small">{t('side.body')}</p>
            </div>
            <div className="seg" style={{ width: 'fit-content' }}>
              <button className={prefs.traffic_side === 'left' ? 'on' : ''} onClick={() => savePrefs({ traffic_side: 'left' })}>{t('side.opt.left')}</button>
              <button className={prefs.traffic_side === 'right' ? 'on' : ''} onClick={() => savePrefs({ traffic_side: 'right' })}>{t('side.opt.right')}</button>
            </div>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="section">
          <div className="section-head">
            <h2>{t('sys.title')}</h2>
          </div>
          <dl className="dl">
            <dt>{t('sys.detect')}</dt>
            <dd>
              {health?.detector?.label || '—'}
              {health?.detector?.tier === 'classical' && (
                <div className="note warn" style={{ marginTop: 6 }}>
                  <Rich text={t('sys.classical')} />
                </div>
              )}
            </dd>
            <dt>{t('sys.addresses')}</dt>
            <dd>{health?.geocoder === 'off' ? t('sys.geo.off') : t('sys.geo.on')}</dd>
            <dt>{t('sys.api')}</dt>
            <dd><Rich text={t('sys.api.body')} /></dd>
            <dt>{t('sys.export')}</dt>
            <dd><a href="/api/potholes/export.csv">{t('sys.csv')}</a></dd>
          </dl>
        </div>
      </section>
    </div>
  )
}
