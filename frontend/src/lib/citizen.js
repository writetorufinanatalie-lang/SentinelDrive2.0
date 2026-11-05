// Citizen sign-in state. A signed-in citizen has a server account (password checked on the server) and a
// token; a guest has neither and is identified only by a random id kept in this browser.
import { useEffect, useState } from 'react'

const KEY = 'sentinel.citizen'
const EVENT = 'sentinel-citizen'
let memory = null

export function getCitizen() {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? JSON.parse(raw) : memory
  } catch {
    return memory
  }
}

function save(c) {
  memory = c
  try {
    if (c) localStorage.setItem(KEY, JSON.stringify(c))
    else localStorage.removeItem(KEY)
  } catch {
    /* storage blocked: kept in memory for this tab */
  }
  window.dispatchEvent(new Event(EVENT))
}

// session = { token, user: { id, name, contact } } as returned by the server
export const setCitizen = (session) => save({ guest: false, token: session.token, id: session.user.id, name: session.user.name, contact: session.user.contact })
export const continueAsGuest = () => save({ guest: true, token: null, id: null, name: '', contact: '' })
export const signOut = () => save(null)
export const getCitizenToken = () => getCitizen()?.token || null
export const citizenReporterId = () => getCitizen()?.id || null

export function useCitizen() {
  const [c, setC] = useState(getCitizen)
  useEffect(() => {
    const on = () => setC(getCitizen())
    window.addEventListener(EVENT, on)
    window.addEventListener('storage', on)
    return () => {
      window.removeEventListener(EVENT, on)
      window.removeEventListener('storage', on)
    }
  }, [])
  return c
}
