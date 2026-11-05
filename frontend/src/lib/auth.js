import { useSyncExternalStore } from 'react'

// Staff sign-in lives in this browser tab's storage. The server checks the token on every request,
// so removing or editing it here gives no extra access.
const KEY = 'sentinel.staff'
let session = null
try {
  session = JSON.parse(sessionStorage.getItem(KEY) || 'null')
} catch {
  /* storage blocked */
}
const listeners = new Set()

export const getSession = () => session
export const getToken = () => session?.token || null

export function setSession(s) {
  session = s
  try {
    s ? sessionStorage.setItem(KEY, JSON.stringify(s)) : sessionStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
  listeners.forEach((f) => f())
}

export function useStaff() {
  return useSyncExternalStore(
    (f) => {
      listeners.add(f)
      return () => listeners.delete(f)
    },
    () => session,
  )
}
