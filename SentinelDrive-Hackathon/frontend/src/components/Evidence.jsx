import { dateTime, money } from '../lib/format'
import { useI18n } from '../lib/i18n'

const W = { community: 0.3, safety: 0.3, size: 0.15, time: 0.1 }

// Why a site has the priority it has: each factor's share of the 0-100 score.
export function PriorityWhy({ site }) {
  const { t } = useI18n()
  const p = site.priority_info
  if (!p) return null
  const total = Object.values(W).reduce((a, b) => a + b, 0)
  return (
    <section>
      <h3 style={{ marginBottom: 6 }}>{t('prio.title')}</h3>
      <p style={{ marginBottom: 8 }}>
        {t('prio.summary', { cat: t(`prio.${p.category}`), n: p.citizens, sev: t(`sev.${site.severity}`).toLowerCase(), days: Math.max(0, Math.round(p.days_open)) })}
      </p>
      <div className="why">
        {Object.keys(W).map((k) => {
          const pts = Math.round((100 * W[k] * p.parts[k]) / total)
          const max = Math.round((100 * W[k]) / total)
          return (
            <div key={k} className="why-row">
              <span>{t(`prio.${k}`)}</span>
              <span className="why-bar" aria-hidden="true"><i style={{ width: `${Math.round(p.parts[k] * 100)}%` }} /></span>
              <span className="num">{pts} / {max}</span>
            </div>
          )
        })}
      </div>
      <p className="muted small" style={{ marginTop: 6 }}>{t('prio.note')}</p>
    </section>
  )
}

// The citizen's original photo next to the repair crew's photo. The original is never replaced.
export function BeforeAfter({ site }) {
  const { t } = useI18n()
  const r = site.repair
  if (!r) return null
  const before = site.evidence[0]
  const est = site.estimate?.total
  return (
    <section>
      <h3 style={{ marginBottom: 8 }}>{t('repair.title')}</h3>
      <div className="ba">
        <figure>
          <img src={before.photo} alt={t('repair.before')} />
          <figcaption>{t('repair.before')} · {dateTime(before.ts)}</figcaption>
        </figure>
        <figure>
          <img src={r.photo} alt={t('repair.after')} />
          <figcaption>{t('repair.after')} · {dateTime(r.ts)}</figcaption>
        </figure>
      </div>
      {r.note ? <p className="small" style={{ marginTop: 6 }}>“{r.note}”</p> : null}
      {r.actual_cost != null && (
        <p className="small muted" style={{ marginTop: 4 }}>{t('repair.actual', { amount: money(r.actual_cost), est: money(est) })}</p>
      )}
      <p className="muted small" style={{ marginTop: 4 }}>{t('repair.note')}</p>
    </section>
  )
}
