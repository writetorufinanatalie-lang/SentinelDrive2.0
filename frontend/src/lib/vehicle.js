// The vehicle code pairs screens. A phone in the car and a dashboard that watches it use the same code;
// every other device has its own code, so two vehicles never see each other's driver.
const KEY = 'sentinel.vehicle'
let memory = null

const fresh = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('')

export function getVehicleCode() {
  try {
    let v = localStorage.getItem(KEY)
    if (!v) {
      v = fresh()
      localStorage.setItem(KEY, v)
    }
    return v
  } catch {
    return (memory ||= fresh())
  }
}

export const cleanVehicleCode = (raw) => String(raw || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 24)

export function setVehicleCode(raw) {
  const v = cleanVehicleCode(raw)
  if (v.length < 4) return false
  memory = v
  try {
    localStorage.setItem(KEY, v)
  } catch {
    /* ignore */
  }
  return true
}
