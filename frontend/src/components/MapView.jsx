import { useEffect, useRef } from 'react'
import L from 'leaflet'
import { place } from '../lib/format'
import { useI18n } from '../lib/i18n'

const SEV_COLOR = { high: '#b3261e', medium: '#9a5a00', low: '#3b6e3b' }
const INDIA = [21.5, 79]

// Pothole sites (and optionally crash locations) on an OpenStreetMap base map.
// `pickMode` turns a click into onPick({lat, lng}) for setting a location.
// Municipal colours: red = critical/high and unresolved, orange = being worked on,
// green = verified, yellow = waiting to be acknowledged or assigned, grey = not a pothole.
export function staffColor(s) {
  if (s.status === 'verified') return '#3b8a4a'
  if (s.status === 'rejected') return '#8a938f'
  if (['critical', 'high'].includes(s.priority_info?.category)) return '#b3261e'
  if (['assigned', 'in_progress', 'completed'].includes(s.status)) return '#d9730d'
  return '#c9a400'
}

export default function MapView({ sites = [], crashes = [], selectedId, onSelect, pickMode = false, onPick, className = '', emptyText, colorBy = 'severity' }) {
  const { t, lang } = useI18n()
  const el = useRef(null)
  const map = useRef(null)
  const layer = useRef(null)
  const fitted = useRef(false)
  const cb = useRef({})
  cb.current = { onSelect, onPick, pickMode }

  useEffect(() => {
    const m = L.map(el.current, { zoomControl: true, attributionControl: true }).setView(INDIA, 5)
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(m)
    layer.current = L.layerGroup().addTo(m)
    m.on('click', (e) => {
      if (cb.current.pickMode) cb.current.onPick?.({ lat: e.latlng.lat, lng: e.latlng.lng })
    })
    map.current = m
    const ro = new ResizeObserver(() => m.invalidateSize())
    ro.observe(el.current)
    return () => {
      ro.disconnect()
      m.remove()
    }
  }, [])

  useEffect(() => {
    const m = map.current
    if (!m) return
    m.getContainer().style.cursor = pickMode ? 'crosshair' : ''
  }, [pickMode])

  useEffect(() => {
    const m = map.current
    const g = layer.current
    if (!m || !g) return
    g.clearLayers()
    const pts = []
    for (const s of sites) {
      if (s.lat == null) continue
      const sel = s.id === selectedId
      const radius = 6 + Math.min(10, Math.sqrt(s.count || 1) * 3)
      const mk = L.circleMarker([s.lat, s.lng], {
        radius: sel ? radius + 3 : radius,
        color: sel ? '#1c2124' : '#ffffff',
        weight: sel ? 3 : 2,
        fillColor: colorBy === 'staff' ? staffColor(s) : ['verified', 'rejected'].includes(s.status) ? '#8a938f' : SEV_COLOR[s.severity] || '#687175',
        fillOpacity: ['verified', 'rejected'].includes(s.status) ? 0.6 : 0.92,
      })
      mk.bindTooltip(`<strong>${s.id}</strong><br>${place(s)}<br>${t('map.tip', { count: t('count.pothole', { n: s.count }), sev: t(`sev.${s.severity}`).toLowerCase() })}${colorBy === 'staff' ? `<br>${s.citizens} citizens · ${s.priority_info?.category} · ${s.status.replace('_', ' ')}` : ''}`, { direction: 'top', offset: [0, -6] })
      mk.on('click', (e) => {
        L.DomEvent.stopPropagation(e)
        cb.current.onSelect?.(s.id)
      })
      mk.addTo(g)
      pts.push([s.lat, s.lng])
    }
    for (const c of crashes) {
      if (c.lat == null) continue
      const icon = L.divIcon({
        className: '',
        html: `<div style="width:16px;height:16px;transform:rotate(45deg);background:${c.verified ? '#1c2124' : '#9aa3a0'};border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.3)"></div>`,
        iconSize: [16, 16],
        iconAnchor: [8, 8],
      })
      L.marker([c.lat, c.lng], { icon })
        .bindTooltip(`<strong>${c.verified ? t('map.crash') : t('map.impact')}</strong><br>${c.reason}`, { direction: 'top' })
        .addTo(g)
      pts.push([c.lat, c.lng])
    }
    if (pts.length && !fitted.current) {
      fitted.current = true
      if (pts.length === 1) m.setView(pts[0], 16)
      else m.fitBounds(pts, { padding: [40, 40], maxZoom: 16 })
    }
  }, [sites, crashes, selectedId, lang, colorBy]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const s = sites.find((x) => x.id === selectedId)
    if (s?.lat != null && map.current) map.current.panTo([s.lat, s.lng], { animate: true })
  }, [selectedId]) // eslint-disable-line react-hooks/exhaustive-deps

  const located = sites.some((s) => s.lat != null) || crashes.some((c) => c.lat != null)
  return (
    <div className={`map ${className}`}>
      <div ref={el} style={{ position: 'absolute', inset: 0 }} />
      {pickMode && <div className="map-hint">{t('map.pick')}</div>}
      {!located && !pickMode && emptyText && (
        <div className="map-empty">
          <div>{emptyText}</div>
        </div>
      )}
      {located && colorBy !== 'staff' && (
        <div className="map-legend" aria-label={t('map.legend')}>
          <span className="sev high"><i />{t('sev.high')}</span>
          <span className="sev medium"><i />{t('sev.medium')}</span>
          <span className="sev low"><i />{t('sev.low')}</span>
          <span className="sev" style={{ color: '#687175' }}><i style={{ background: '#8a938f' }} />{t('status.verified')}</span>
        </div>
      )}
    </div>
  )
}
