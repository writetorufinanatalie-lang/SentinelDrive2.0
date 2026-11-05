// A random id for this browser, so "My reports" and the unique-citizen count work without a login.
let memory = null
export function getReporterId() {
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
