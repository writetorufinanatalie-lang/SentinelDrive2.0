"""Alerts that leave the app: email and webhook to the municipality (routed by ward), and status
emails to citizens who registered with an email address. Everything is optional and does nothing
until configured (see config.py / README). Failures are logged and never block a citizen's report."""

import json
import logging
import smtplib
import threading
import urllib.request
from email.message import EmailMessage

from . import config, db

log = logging.getLogger("sentinel.outbound")

# staff event -> (subject, line). Only events worth interrupting someone for.
STAFF_EVENTS = {
    "new_case": ("New pothole case {id}", "A new pothole case was reported."),
    "priority_up": ("Case {id} is now {cat} priority", "More citizens have reported this pothole and its priority rose."),
    "overdue": ("Case {id} is overdue", "This case is past its target date or has been open too long."),
    "completed_awaiting": ("Case {id} repaired, needs verification", "The repair team finished the work. A verifier must check the after photo."),
    "repair_rejected": ("Repair on case {id} was rejected", "The finished repair did not pass verification and the case is open again."),
}
CITIZEN_EVENTS = {
    "acknowledged": "The municipality has seen your report.",
    "assigned": "A repair team has been assigned.",
    "in_progress": "Repair work has started.",
    "completed": "The repair is finished and waiting to be checked.",
    "verified": "The repair was checked and accepted. Thank you for reporting.",
    "reopened": "The problem is still there, so the case was reopened.",
    "rejected": "This report was closed as not a pothole or a duplicate.",
}


def _run(fn):
    threading.Thread(target=fn, daemon=True).start()


def smtp_ready():
    return bool(config.SMTP_HOST and config.SMTP_FROM)


def get_routes():
    return db.kv_get("alert_routes", []) or []


def set_routes(routes):
    clean = []
    for r in routes[:50]:
        match, email = str(r.get("match", "")).strip()[:80], str(r.get("email", "")).strip()[:120]
        if match and "@" in email:
            clean.append({"match": match, "email": email})
    db.kv_set("alert_routes", clean)
    return clean


def route_for(rec):
    """The email for the ward or authority this case falls in, else the default address."""
    text = " ".join(filter(None, [
        (rec.get("address") or {}).get("display_name"), (rec.get("jurisdiction") or {}).get("authority"),
        (rec.get("jurisdiction") or {}).get("ward"),
    ])).lower()
    for r in get_routes():
        if r["match"].lower() in text:
            return r["email"]
    return config.ALERT_EMAIL or None


def _log(channel, to, subject, ok, error=""):
    entries = db.kv_get("outbox_log", []) or []
    entries.append({"ts": db.now_ms(), "channel": channel, "to": to, "subject": subject, "ok": ok, "error": error[:200]})
    db.kv_set("outbox_log", entries[-60:])


def recent():
    return list(reversed(db.kv_get("outbox_log", []) or []))[:30]


def send_email(to, subject, body):
    """Send now and report back (used by the test button). Returns (ok, error text)."""
    if not smtp_ready():
        return False, "Email is not set up: SENTINEL_SMTP_HOST / SENTINEL_SMTP_USER / SENTINEL_SMTP_PASSWORD are missing."
    try:
        msg = EmailMessage()
        msg["From"], msg["To"], msg["Subject"] = config.SMTP_FROM, to, subject
        msg.set_content(body)
        with smtplib.SMTP(config.SMTP_HOST, config.SMTP_PORT, timeout=15) as s:
            s.starttls()
            if config.SMTP_USER:
                s.login(config.SMTP_USER, config.SMTP_PASSWORD)
            s.send_message(msg)
        return True, ""
    except Exception as exc:  # network, auth, refused recipient...
        return False, str(exc)


def send_webhook(text, payload=None):
    if not config.CASE_WEBHOOK:
        return False, "No webhook is set (SENTINEL_CASE_WEBHOOK)."
    try:
        req = urllib.request.Request(
            config.CASE_WEBHOOK, data=json.dumps({"text": text, **(payload or {})}).encode(),
            headers={"Content-Type": "application/json"}, method="POST",
        )
        urllib.request.urlopen(req, timeout=10).read()
        return True, ""
    except Exception as exc:
        return False, str(exc)


def _link(case_id):
    return f"{config.PUBLIC_URL}/#/municipality/cases" if config.PUBLIC_URL else "the municipal dashboard"


def _case_text(rec):
    est = (rec.get("estimate") or {}).get("total")
    where = (rec.get("address") or {}).get("display_name") or (f"{rec['lat']:.5f}, {rec['lng']:.5f}" if rec.get("lat") is not None else "location not set")
    return f"Case {rec['id']} - {rec.get('severity', '?')} severity, {rec.get('count', 1)} pothole(s)\nWhere: {where}" + (f"\nEstimate: {est}" if est else "")


def dispatch(to, code, case_id, vars):
    """Called for every in-app notification; sends the matching email or webhook if one is set up."""
    try:
        if to == "staff" and code in STAFF_EVENTS:
            if code == "priority_up" and vars.get("cat") not in ("high", "critical"):
                return
            rec = db.get("potholes", case_id)
            if not rec:
                return
            subject, line = STAFF_EVENTS[code]
            subject = subject.format(id=case_id, cat=vars.get("cat", ""))
            body = f"{line}\n\n{_case_text(rec)}\n\nOpen: {_link(case_id)}\n"
            target = route_for(rec)
            if target and smtp_ready():
                _run(lambda: _log("email", target, subject, *send_email(target, subject, body)))
            if config.CASE_WEBHOOK:
                _run(lambda: _log("webhook", "webhook", subject, *send_webhook(f"{subject}\n{body}", {"event": code, "case": case_id})))
        elif to.startswith("citizen:") and code in CITIZEN_EVENTS and smtp_ready():
            rec = db.get("citizens", to.split(":", 1)[1])
            if rec and "@" in rec.get("contact", ""):
                subject = f"Your pothole report {case_id}: update"
                body = f"Hello {rec['name']},\n\n{CITIZEN_EVENTS[code]}\n\nCase: {case_id}\nSee it in the SentinelDrive app{(' at ' + config.PUBLIC_URL) if config.PUBLIC_URL else ''}.\n"
                _run(lambda: _log("email", rec["contact"], subject, *send_email(rec["contact"], subject, body)))
    except Exception:
        log.exception("could not queue an outbound alert")
