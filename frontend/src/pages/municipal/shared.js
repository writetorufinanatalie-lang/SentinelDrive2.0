// The municipal dashboard is English only for now (officers); the citizen side is translated.
export const STAFF_NOTIF = {
  new_case: (v) => `New pothole case ${v.id} was reported.`,
  new_report: (v) => `${v.id} received another report (${v.n} citizens now).`,
  priority_up: (v) => `${v.id} priority rose to ${v.cat}.`,
  overdue: (v) => `${v.id} is overdue.`,
  repair_rejected: (v) => `${v.id}: the repair was rejected and the case reopened.`,
  completed_awaiting: (v) => `${v.id}: repair finished and waiting for verification.`,
}

export const ROLE_LABEL = { officer: 'Municipal officer', repair: 'Repair team', verifier: 'Verifier / administrator' }
export const can = (user, ...roles) => !!user && roles.includes(user.role)
export const isOfficer = (user) => can(user, 'officer', 'verifier')

export const PRIORITIES = ['critical', 'high', 'medium', 'low']
export const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s)
