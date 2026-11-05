"""Municipal dashboard API. Everything here needs a staff sign-in; roles are checked on the server."""

import shutil
import statistics
import time
import uuid
from typing import Optional

import cv2
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from pydantic import BaseModel

from . import accounts, auth, db, ratelimit
from .config import MEDIA_DIR
from .hub import hub
from .potholes import (
    BAND_SCORE, MAX_UPLOAD_BYTES, OPEN_STATUSES, _decode_image, _derive, _geocode_site_async, _ts,
    notify, notify_citizens, public, staff_view,
)

router = APIRouter(tags=["municipal"])
DAY = 86_400_000
OFFICER = ("officer", "verifier")

CITIZEN_CODE = {  # status reached -> notification code for the people who reported it
    "acknowledged": "acknowledged", "assigned": "assigned", "in_progress": "in_progress",
    "completed": "completed", "verified": "verified", "reopened": "reopened", "rejected": "rejected",
}


class LoginBody(BaseModel):
    username: str
    password: str


def _audit(by, text):
    """Account and sign-in events, kept apart from case history (last 500)."""
    log = db.kv_get("security_audit", []) or []
    log.append({"ts": _ts(), "by": by, "note": text})
    db.kv_set("security_audit", log[-500:])


@router.post("/api/auth/login")
def login(body: LoginBody, request: Request):
    ip = auth.client_ip(request)
    u = body.username.strip().lower()
    try:
        out = auth.login(u, body.password, ip)
    except HTTPException as e:
        _audit(u[:32] or "?", f"failed sign-in ({e.status_code}) from {ip}")
        raise
    _audit(u, f"signed in from {ip}")
    return out


@router.get("/api/auth/me")
def me(user=Depends(auth.current_user)):
    return user


class PasswordBody(BaseModel):
    current: str
    new: str


@router.post("/api/auth/password")
def change_password(body: PasswordBody, request: Request, user=Depends(auth.current_user)):
    ratelimit.hit(f"pw:{user['name']}", 8, 600)
    rec = db.get("staff", user["name"])
    if not accounts.check(body.current, rec):
        raise HTTPException(403, "Your current password is wrong.")
    accounts.set_staff_password(user["name"], body.new)
    _audit(user["name"], "changed their own password")
    return auth.login(user["name"], body.new, auth.client_ip(request))  # fresh token; the old one is now invalid


# -- staff accounts (verifier / administrator only) ----------------------------


class NewStaff(BaseModel):
    username: str
    role: str
    password: str


class PasswordReset(BaseModel):
    password: str


class ActiveBody(BaseModel):
    active: bool


@router.get("/api/municipal/staff")
def list_staff(user=Depends(auth.require("verifier"))):
    rows = db.query("staff", limit=500)
    return [accounts.staff_public(r) for r in sorted(rows, key=lambda r: r["id"])]


@router.post("/api/municipal/staff")
def add_staff(body: NewStaff, user=Depends(auth.require("verifier"))):
    rec = accounts.create_staff(body.username, body.role, body.password, by=user["name"])
    _audit(user["name"], f"created staff account {rec['id']} ({rec['role']})")
    return accounts.staff_public(rec)


@router.post("/api/municipal/staff/{username}/password")
def reset_staff_password(username: str, body: PasswordReset, user=Depends(auth.require("verifier"))):
    accounts.set_staff_password(username.lower(), body.password)
    _audit(user["name"], f"reset the password of {username.lower()}")
    return {"ok": True}


@router.post("/api/municipal/staff/{username}/active")
def set_staff_active(username: str, body: ActiveBody, user=Depends(auth.require("verifier"))):
    username = username.lower()
    rec = db.get("staff", username)
    if not rec:
        raise HTTPException(404, "No such staff account.")
    if username == user["name"]:
        raise HTTPException(409, "You cannot disable your own account.")
    if not body.active and rec["role"] == "verifier":
        left = [r for r in db.query("staff", limit=500) if r["role"] == "verifier" and r["status"] == "active" and r["id"] != username]
        if not left:
            raise HTTPException(409, "At least one active verifier must remain.")
    rec["status"] = "active" if body.active else "disabled"
    db.put("staff", rec)
    _audit(user["name"], f"{'enabled' if body.active else 'disabled'} staff account {username}")
    return accounts.staff_public(rec)


# -- helpers -----------------------------------------------------------------


def _case(site_id):
    rec = db.get("potholes", site_id)
    if not rec:
        raise HTTPException(404, "No pothole case with that ID.")
    return rec


def _teams():
    teams = db.kv_get("teams")
    if teams is None:
        teams = [{"id": "T-1", "name": "Zone A repair crew"}, {"id": "T-2", "name": "Zone B repair crew"}]
        db.kv_set("teams", teams)
    return teams


def _move(rec, to, user, note="", internal=False):
    prev = rec["status"]
    rec["status"] = to
    rec["history"].append({"ts": _ts(), "status": to, "prev": prev, "by": user["name"], "role": user["role"], "note": note[:500], **({"internal": True} if internal else {})})
    if to in ("verified", "rejected"):
        rec["closed_at"] = _ts()
    else:
        rec.pop("closed_at", None)
    code = CITIZEN_CODE.get(to)
    if code:
        notify_citizens(rec, code, reason=note[:200] if to in ("reopened", "rejected") else "")


async def _save(rec, user_view=True):
    db.put("potholes", rec)
    await hub.broadcast({"type": "pothole", "action": "updated", "pothole": public(rec)})
    return staff_view(rec)


def _need(cond, msg):
    if not cond:
        raise HTTPException(400, msg)


# -- cases -------------------------------------------------------------------

SORTS = {
    "priority": lambda r: -r["priority"],
    "citizens": lambda r: -r["citizens"],
    "oldest": lambda r: (0 if r["status"] in OPEN_STATUSES else 1, r["created_at"]),
    "newest": lambda r: -r["created_at"],
    "cost": lambda r: -((r.get("estimate") or {}).get("total") or 0),
}


@router.get("/api/municipal/cases")
def cases(
    status: Optional[str] = None,
    priority: Optional[str] = None,
    q: Optional[str] = None,
    team: Optional[str] = None,
    min_citizens: int = 0,
    overdue: bool = False,
    needs_review: bool = False,
    sort: str = "priority",
    limit: int = Query(25, ge=1, le=200),
    offset: int = Query(0, ge=0),
    _user=Depends(auth.current_user),
):
    rows = [_derive(r) for r in db.query("potholes", limit=100000)]
    if status:
        want = set(status.split(","))
        rows = [r for r in rows if r["status"] in want]
    if priority:
        want = set(priority.split(","))
        rows = [r for r in rows if r["priority_info"]["category"] in want]
    if team:
        rows = [r for r in rows if (r.get("assignment") or {}).get("team") == team]
    if min_citizens:
        rows = [r for r in rows if r["citizens"] >= min_citizens]
    if overdue:
        rows = [r for r in rows if r["overdue"]]
    if needs_review:
        rows = [r for r in rows if r.get("needs_review")]
    if q:
        n = q.strip().lower()
        rows = [r for r in rows if n in r["id"].lower() or n in ((r.get("address") or {}).get("label") or "").lower() or (r.get("lat") is not None and n in f"{r['lat']:.5f}, {r['lng']:.5f}")]
    rows.sort(key=SORTS.get(sort, SORTS["priority"]))
    return {"total": len(rows), "items": [staff_view(r) for r in rows[offset : offset + limit]]}


@router.get("/api/municipal/cases/{site_id}")
def case_detail(site_id: str, _user=Depends(auth.current_user)):
    return staff_view(_case(site_id))


class Action(BaseModel):
    action: str
    note: Optional[str] = None
    reason: Optional[str] = None
    team: Optional[str] = None
    officer: Optional[str] = None
    target_date: Optional[int] = None  # ms since epoch
    internal_note: Optional[str] = None
    category: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None


# action -> (roles allowed, statuses it may start from)
RULES = {
    "acknowledge": (OFFICER, ("reported",)),
    "reject": (OFFICER, ("reported", "acknowledged")),
    "restore": (OFFICER, ("rejected",)),
    "assign": (OFFICER, ("acknowledged", "reopened", "assigned")),
    "start": (("repair",), ("assigned",)),
    "verify": (("verifier",), ("completed",)),
    "reject_repair": (("verifier",), ("completed",)),
    "reopen": (("verifier",), ("verified",)),
    "note": (("officer", "repair", "verifier"), None),
    "override_priority": (OFFICER, None),
    "set_location": (OFFICER, None),
    "clear_review": (OFFICER, None),
}


@router.post("/api/municipal/cases/{site_id}/action")
async def act(site_id: str, body: Action, user=Depends(auth.current_user)):
    rule = RULES.get(body.action)
    _need(rule, "Unknown action.")
    roles, from_status = rule
    if user["role"] not in roles:
        raise HTTPException(403, f"Your role ({user['role']}) cannot do '{body.action}'.")
    rec = _case(site_id)
    if from_status and rec["status"] not in from_status:
        raise HTTPException(409, f"'{body.action}' is not possible while the case is {rec['status'].replace('_', ' ')}.")
    note = (body.note or "").strip()
    reason = (body.reason or "").strip()
    a = body.action

    if a == "acknowledge":
        _move(rec, "acknowledged", user, note or "Received by the municipality.")
    elif a == "reject":
        _need(reason, "Give a reason for marking this as not a pothole.")
        _move(rec, "rejected", user, reason)
    elif a == "restore":
        _move(rec, "reported", user, note or "Restored for review.")
    elif a == "assign":
        team = next((t for t in _teams() if t["name"] == body.team or t["id"] == body.team), None)
        _need(team, "Pick a repair team from the list.")
        if body.target_date is not None:
            _need(body.target_date > _ts() - DAY, "The target date is in the past.")
        rec["assignment"] = {
            "team": team["name"], "officer": (body.officer or user["name"])[:60], "assigned_at": _ts(),
            "target_date": body.target_date, "internal_note": (body.internal_note or "")[:500],
        }
        _move(rec, "assigned", user, note or f"Assigned to {team['name']}.")
    elif a == "start":
        _move(rec, "in_progress", user, note or "Repair work has started.")
    elif a == "verify":
        _need(rec.get("repair"), "There is no after-repair photo to verify.")
        rec["verification"] = {"result": "accepted", "by": user["name"], "ts": _ts(), "note": note[:500]}
        _move(rec, "verified", user, note or "Repair checked and accepted.")
    elif a in ("reject_repair", "reopen"):
        _need(reason, "Give a reason. The citizen will see it.")
        rec["verification"] = {"result": "rejected", "by": user["name"], "ts": _ts(), "reason": reason[:500]}
        if rec.get("repair"):
            rec.setdefault("past_repairs", []).append(rec.pop("repair"))
        _move(rec, "reopened", user, reason)
        if a == "reject_repair":
            notify("staff", "repair_rejected", rec["id"], id=rec["id"])
    elif a == "note":
        _need(note, "Write a note first.")
        rec["history"].append({"ts": _ts(), "status": rec["status"], "by": user["name"], "role": user["role"], "note": note[:500], "internal": True})
    elif a == "override_priority":
        if body.category == "clear":
            rec.pop("priority_override", None)
            rec["history"].append({"ts": _ts(), "status": rec["status"], "by": user["name"], "role": user["role"], "note": "Priority override removed.", "internal": True})
        else:
            _need(body.category in BAND_SCORE, "Priority must be critical, high, medium or low.")
            _need(reason, "Give a reason for changing the priority.")
            calc = _derive(dict(rec))["priority_info"]["calculated_category"]
            rec["priority_override"] = {"category": body.category, "reason": reason[:300], "by": user["name"], "ts": _ts(), "calculated": calc}
            rec["history"].append({"ts": _ts(), "status": rec["status"], "by": user["name"], "role": user["role"], "note": f"Priority set to {body.category} (calculated {calc}): {reason}", "internal": True})
    elif a == "clear_review":
        rec.pop("needs_review", None)
        rec["history"].append({"ts": _ts(), "status": rec["status"], "by": user["name"], "role": user["role"], "note": "Duplicate match reviewed and kept.", "internal": True})
    elif a == "set_location":
        _need(body.lat is not None and body.lng is not None and -90 <= body.lat <= 90 and -180 <= body.lng <= 180, "Location is out of range.")
        rec["lat"], rec["lng"], rec["gps_source"], rec["address"] = body.lat, body.lng, "set-on-map", None
        rec["history"].append({"ts": _ts(), "status": rec["status"], "by": user["name"], "role": user["role"], "note": "Location set on map by staff."})
        out = await _save(rec)
        _geocode_site_async(rec["id"])
        return out
    return await _save(rec)


@router.post("/api/municipal/cases/{site_id}/complete")
async def complete(
    site_id: str,
    file: UploadFile = File(...),
    note: Optional[str] = Form(None),
    actual_cost: Optional[float] = Form(None),
    user=Depends(auth.require("repair")),
):
    """Repair team finishes the job. An after-repair photo is required; the citizens' photos are untouched."""
    rec = _case(site_id)
    if rec["status"] != "in_progress":
        raise HTTPException(409, "Start the repair first. Only cases in progress can be completed.")
    data = await file.read()
    _need(data, "The after-repair photo is empty.")
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "File is larger than 80 MB.")
    if actual_cost is not None and not (0 <= actual_cost <= 1e9):
        raise HTTPException(400, "Actual cost is out of range.")
    try:
        img = _decode_image(data)
    except ValueError as exc:
        raise HTTPException(422, "That file is not a readable image.") from exc
    folder = MEDIA_DIR / site_id
    folder.mkdir(parents=True, exist_ok=True)
    h, w = img.shape[:2]
    s = 1600.0 / max(h, w)
    if s < 1:
        img = cv2.resize(img, None, fx=s, fy=s, interpolation=cv2.INTER_AREA)
    n = len(rec.get("past_repairs", [])) + 1
    path = folder / f"after_{n}.jpg"
    cv2.imwrite(str(path), img, [cv2.IMWRITE_JPEG_QUALITY, 88])
    rec["repair"] = {
        "ts": _ts(), "photo": f"/media/{site_id}/{path.name}", "note": (note or "")[:500], "actual_cost": actual_cost,
        "team": (rec.get("assignment") or {}).get("team"), "by": user["name"],
    }
    _move(rec, "completed", user, (note or "After-repair photo uploaded.")[:500])
    notify("staff", "completed_awaiting", rec["id"], id=rec["id"])
    return await _save(rec)


@router.delete("/api/municipal/cases/{site_id}")
async def delete_case(site_id: str, _user=Depends(auth.require("verifier"))):
    if not db.delete("potholes", site_id):
        raise HTTPException(404, "No pothole case with that ID.")
    shutil.rmtree(MEDIA_DIR / site_id, ignore_errors=True)
    await hub.broadcast({"type": "pothole", "action": "deleted", "id": site_id})
    return {"deleted": site_id}


# -- teams, notifications, audit ---------------------------------------------


@router.get("/api/municipal/teams")
def list_teams(_user=Depends(auth.current_user)):
    return _teams()


class TeamBody(BaseModel):
    name: str


@router.post("/api/municipal/teams")
def add_team(body: TeamBody, _user=Depends(auth.require(*OFFICER))):
    name = body.name.strip()[:60]
    _need(name, "Give the team a name.")
    teams = _teams()
    _need(all(t["name"].lower() != name.lower() for t in teams), "A team with that name exists.")
    teams.append({"id": "T-" + uuid.uuid4().hex[:5].upper(), "name": name})
    db.kv_set("teams", teams)
    return teams


def _check_overdue():
    for rec in db.query("potholes", status=OPEN_STATUSES, limit=100000):
        if _derive(dict(rec))["overdue"] and not rec.get("overdue_notified"):
            rec["overdue_notified"] = True
            db.put("potholes", rec)
            notify("staff", "overdue", rec["id"], id=rec["id"])


@router.get("/api/municipal/notifications")
def staff_notifications(limit: int = 60, _user=Depends(auth.current_user)):
    _check_overdue()
    return db.query("notifications", kind="staff", limit=limit)


@router.post("/api/municipal/notifications/read")
def staff_notifications_read(_user=Depends(auth.current_user)):
    n = 0
    for x in db.query("notifications", kind="staff", status="unread", limit=1000):
        x["status"] = "read"
        db.put("notifications", x)
        n += 1
    return {"read": n}


@router.get("/api/municipal/audit")
def audit(limit: int = 300, _user=Depends(auth.require("verifier"))):
    out = []
    for r in db.query("potholes", limit=100000):
        for h in r.get("history", []):
            out.append({"ts": h["ts"], "case": r["id"], "from": h.get("prev"), "to": h["status"], "by": h.get("by") or "citizen", "role": h.get("role") or "citizen", "note": h.get("note", ""), "internal": bool(h.get("internal"))})
    for e in db.kv_get("security_audit", []) or []:
        out.append({"ts": e["ts"], "case": "account", "from": None, "to": "account", "by": e["by"], "role": "staff", "note": e["note"], "internal": True})
    out.sort(key=lambda x: -x["ts"])
    return out[:limit]


# -- numbers for the dashboard and analytics ---------------------------------


def _first(rec, status):
    return next((h["ts"] for h in rec.get("history", []) if h["status"] == status), None)


@router.get("/api/municipal/summary")
def summary(_user=Depends(auth.current_user)):
    rows = [_derive(r) for r in db.query("potholes", limit=100000)]
    now = _ts()
    by = lambda s: sum(1 for r in rows if r["status"] == s)
    openr = [r for r in rows if r["status"] in OPEN_STATUSES]
    real = [r for r in rows if r["status"] != "rejected"]
    actual = [(r["repair"]["actual_cost"], (r.get("estimate") or {}).get("total")) for r in rows if (r.get("repair") or {}).get("actual_cost") is not None]
    ack = [(_first(r, "acknowledged") - r["created_at"]) for r in rows if _first(r, "acknowledged")]
    done = [(_first(r, "completed") - r["created_at"]) for r in rows if _first(r, "completed")]
    days = []
    for i in range(13, -1, -1):
        start = (now // DAY - i) * DAY
        days.append({
            "day": time.strftime("%d %b", time.gmtime(start / 1000)),
            "reported": sum(1 for r in rows if start <= r["created_at"] < start + DAY),
            "completed": sum(1 for r in rows if start <= (_first(r, "completed") or 0) < start + DAY),
        })

    def bucket(n):
        return "1" if n == 1 else "2" if n == 2 else "3-4" if n <= 4 else "5+"

    hist = {"1": 0, "2": 0, "3-4": 0, "5+": 0}
    areas = {}
    for r in rows:
        hist[bucket(r["citizens"])] += 1
        a = ((r.get("jurisdiction") or {}).get("ward") or (r.get("jurisdiction") or {}).get("authority") or "Location unknown")
        areas[a] = areas.get(a, 0) + 1
    hours = lambda ms: round(ms / 3_600_000, 1)
    return {
        "cards": {
            "unique_cases": len(rows),
            "citizen_reports": sum(r.get("reports", 1) for r in rows),
            "citizens_affected": sum(r["citizens"] for r in rows),
            "awaiting_ack": by("reported"),
            "awaiting_assignment": by("acknowledged") + by("reopened"),
            "assigned": by("assigned"),
            "in_progress": by("in_progress"),
            "awaiting_verification": by("completed"),
            "verified": by("verified"),
            "reopened": by("reopened"),
            "overdue": sum(1 for r in rows if r["overdue"]),
            "needs_review": sum(1 for r in rows if r.get("needs_review")),
            "estimated_open": round(sum((r.get("estimate") or {}).get("total", 0) for r in openr), 2),
        },
        "analytics": {
            "pct_verified": round(100 * by("verified") / len(real), 1) if real else 0,
            "avg_ack_hours": hours(statistics.mean(ack)) if ack else None,
            "median_completion_hours": hours(statistics.median(done)) if done else None,
            "estimated_total": round(sum((r.get("estimate") or {}).get("total", 0) for r in real), 2),
            "actual_total": round(sum(a for a, _ in actual), 2),
            "estimated_for_actual": round(sum(e or 0 for _, e in actual), 2),
            "with_actual": len(actual),
            "daily": days,
            "by_status": {s: by(s) for s in ("reported", "acknowledged", "assigned", "in_progress", "completed", "verified", "reopened", "rejected")},
            "by_priority": {c: sum(1 for r in openr if r["priority_info"]["category"] == c) for c in ("critical", "high", "medium", "low")},
            "citizens_per_case": hist,
            "by_area": dict(sorted(areas.items(), key=lambda kv: -kv[1])[:8]),
        },
    }


# -- alerts to the municipality ---------------------------------------------------


class RoutesBody(BaseModel):
    routes: list


@router.get("/api/municipal/alerts")
def alerts_config(_user=Depends(auth.require("verifier"))):
    from . import config, outbound
    return {
        "email_ready": outbound.smtp_ready(), "webhook_ready": bool(config.CASE_WEBHOOK),
        "default_email": config.ALERT_EMAIL or None, "routes": outbound.get_routes(), "recent": outbound.recent(),
    }


@router.put("/api/municipal/alerts/routes")
def alerts_routes(body: RoutesBody, user=Depends(auth.require("verifier"))):
    from . import outbound
    routes = outbound.set_routes([r for r in body.routes if isinstance(r, dict)])
    _audit(user["name"], f"updated ward alert routes ({len(routes)})")
    return routes


class TestBody(BaseModel):
    email: Optional[str] = None


@router.post("/api/municipal/alerts/test")
def alerts_test(body: TestBody, user=Depends(auth.require("verifier"))):
    from . import config, outbound
    ratelimit.hit(f"alerttest:{user['name']}", 6, 600)
    result = {}
    to = (body.email or config.ALERT_EMAIL or "").strip()
    if to and "@" in to:
        ok, err = outbound.send_email(to, "SentinelDrive test alert", "This is a test alert from the SentinelDrive municipal dashboard.")
        outbound._log("email", to, "Test alert", ok, err)
        result["email"] = {"ok": ok, "error": err}
    else:
        result["email"] = {"ok": False, "error": "Type an email address to send the test to."}
    if config.CASE_WEBHOOK:
        ok, err = outbound.send_webhook("SentinelDrive test alert")
        outbound._log("webhook", "webhook", "Test alert", ok, err)
        result["webhook"] = {"ok": ok, "error": err}
    return result
