// The id a report is filed under: the citizen's sign-in id, or for guests a random id kept in this browser.
// Either way "My reports" and the unique-citizen count work.
import { citizenReporterId } from './citizen'

let memory = null
export function getReporterId() {
  const account = citizenReporterId()
  if (account) return account
  try {
    let id = localStorage.getItem('sentinel.reporter')
    if (!id) {
      id = 'r-' + (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36))
      localStorage.setItem('sentinel.reporter', id)
    }
    return id
  } catch {
    if (!memory) memory = 'r-' + Math.random().toString(36).slice(2) + Date.now().toString(36)
    return memory
  }
}
