"""Road defect reports: upload -> detect -> measure -> locate -> estimate ->
work order.

One upload (photo or short clip) taken at one place becomes one *site*. A site
holds every pothole visible in that capture. A later upload within a few metres
of an open site is added to it as another report instead of creating a
duplicate.
"""

import asyncio
import copy
import csv
import io
import json
import re
import time
import uuid
from typing import List, Optional

import cv2
import numpy as np
from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel

from . import auth, db, geocode, rates
from .config import API_KEY, DEDUP_RADIUS_M, DUP_AUTO_SIMILARITY, MEDIA_DIR, OVERDUE_DAYS
from .gps import gps_from_exif
from .hub import hub
from .reports import verification_pdf, work_order_pdf
from .similarity import similarity
from .vision.depth import DepthEngine
from .vision.detector import PotholeDetector
from .vision.geometry import compute_measurements, horizon_row

router = APIRouter(tags=["potholes"])

VIDEO_EXTS = {"mp4", "mov", "avi", "mkv", "webm", "m4v", "3gp"}
# reported -> acknowledged -> assigned -> in_progress -> completed (photo) -> verified.
# reopened sends a case back to be assigned again; rejected means "not a pothole".
STATUSES = ["reported", "acknowledged", "assigned", "in_progress", "completed", "verified", "reopened", "rejected"]
OPEN_STATUSES = ["reported", "acknowledged", "assigned", "in_progress", "completed", "reopened"]
CLOSED_STATUSES = ("verified", "rejected")
LEGACY_STATUS = {"verified": "acknowledged", "scheduled": "assigned", "repaired": "completed"}  # schema 1 -> 2
MAX_UPLOAD_BYTES = 80 * 1024 * 1024

detector = PotholeDetector()
depth_engine = DepthEngine()


def _ts():
    return int(time.time() * 1000)


# ---------------------------------------------------------------------------
# Image processing (runs in a worker thread)
# ---------------------------------------------------------------------------

AMBER = (0, 170, 245)  # BGR


def _annotate(bgr, defects):
    out = bgr.copy()
    h = out.shape[0]
    thick = max(2, h // 300)
    font_scale = max(0.5, h / 1100)
    for i, d in enumerate(defects, 1):
        b = d["bbox"]
        x, y, w, hh = b["x"], b["y"], b["w"], b["h"]
        cv2.rectangle(out, (x, y), (x + w, y + hh), AMBER, thick, cv2.LINE_AA)
        label = f"{i}  {int(round(d['confidence'] * 100))}%"
        (tw, th), base = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, font_scale, thick)
        ty = max(th + 8, y)
        cv2.rectangle(out, (x, ty - th - 8), (x + tw + 10, ty), AMBER, -1)
        cv2.putText(out, label, (x + 5, ty - 5), cv2.FONT_HERSHEY_SIMPLEX, font_scale, (20, 20, 20), thick, cv2.LINE_AA)
    return out


def _measure(bgr, dets):
    depth_map = depth_engine.estimate(bgr) if depth_engine.tier != "camera-model" else None
    horizon = horizon_row(bgr)
    defects = []
    for d in dets:
        m = compute_measurements(bgr, d["bbox"], depth_map, horizon)
        defects.append(
            {
                "bbox": m["bbox"],
                "confidence": d["confidence"],
                "area_m2": m["area"],
                "depth_m": m["depth"],
                "volume_m3": m["volume"],
                "distance_m": m["distance_m"],
                "scale_reference": m["accuracy"]["reference"],
                "depth_signal": m["accuracy"]["depth_signal"],
            }
        )
    return defects


def _decode_image(data):
    bgr = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if bgr is None:
        raise ValueError("This file could not be read as an image. Use JPG, PNG or WebP.")
    return bgr


def _video_frames(data, suffix):
    import os
    import tempfile

    with tempfile.NamedTemporaryFile(suffix="." + suffix, delete=False) as tmp:
        tmp.write(data)
        path = tmp.name
    frames = []
    try:
        cap = cv2.VideoCapture(path)
        fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
        total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        step = max(1, int(round(fps * 1.0)))
        idx = 0
        while len(frames) < 20:
            if total:
                cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
            ok, frame = cap.read()
            if not ok:
                break
            frames.append((idx, frame))
            idx += step
            if not total:
                for _ in range(step - 1):
                    if not cap.grab():
                        break
        cap.release()
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass
    if not frames:
        raise ValueError("This video could not be decoded. Try MP4 (H.264) or upload a photo.")
    return frames


def analyse_capture(data, ext, extra_frames=()):
    """Return (best_frame_bgr, detections, frames_checked).

    `extra_frames` are additional stills from the same capture (the browser
    sends a redacted clip as a handful of frames)."""
    if ext in VIDEO_EXTS or extra_frames:
        if ext in VIDEO_EXTS:
            frames = _video_frames(data, ext)
        else:
            frames = [(i, _decode_image(b)) for i, b in enumerate([data, *extra_frames])]
        best = None
        for _, frame in frames:
            dets = detector.detect(frame)
            key = (len(dets), sum(d["confidence"] for d in dets))
            if best is None or key > best[0]:
                best = (key, frame, dets)
        return best[1], best[2], len(frames)
    bgr = _decode_image(data)
    return bgr, detector.detect(bgr), 1


# ---------------------------------------------------------------------------
# Record helpers
# ---------------------------------------------------------------------------


def _summarise(defects):
    area = sum(d["area_m2"] for d in defects)
    volume = sum(d["volume_m3"] for d in defects)
    depth = max((d["depth_m"] for d in defects), default=0.0)
    severity = max(
        (rates.grade_severity(d["area_m2"], d["depth_m"]) for d in defects),
        key=lambda s: rates.SEVERITY_WEIGHT[s],
        default="low",
    )
    return {
        "count": len(defects),
        "area_m2": round(area, 4),
        "volume_m3": round(volume, 5),
        "depth_max_m": round(depth, 4),
        "severity": severity,
        "confidence": max((d["confidence"] for d in defects), default=0.0),
    }


def _estimate(defects):
    """Sum per-pothole bills of quantities into one site estimate."""
    card = rates.get_rate_card()
    per = [rates.estimate_cost(d["area_m2"], d["depth_m"], d["volume_m3"], card) for d in defects]
    if not per:
        return None
    merged = {}
    for est in per:
        for ln in est["lines"]:
            m = merged.setdefault(ln["item"], {**ln, "qty": 0.0, "amount": 0.0})
            m["qty"] = round(m["qty"] + ln["qty"], 4)
            m["amount"] = round(m["amount"] + ln["amount"], 2)
    lines = list(merged.values())
    subtotal = round(sum(ln["amount"] for ln in lines), 2)
    gst = round(subtotal * card["gst_pct"] / 100.0, 2)
    return {
        "currency": card["currency"],
        "lines": lines,
        "subtotal": subtotal,
        "gst_pct": card["gst_pct"],
        "gst": gst,
        "total": round(subtotal + gst, 2),
        "rate_card_note": card["source_note"],
        "computed_at": _ts(),
    }


def _overdue(rec):
    if rec["status"] not in OPEN_STATUSES or rec["status"] == "completed":
        return False
    target = (rec.get("assignment") or {}).get("target_date")
    now = _ts()
    if target:
        return now > target
    return (now - rec["created_at"]) > OVERDUE_DAYS * 86_400_000


BAND_SCORE = {"critical": 85, "high": 60, "medium": 40, "low": 15}


def _derive(rec):
    """Add priority, citizen count and overdue flag. Works on a copy, never stored."""
    end = rec.get("closed_at") or _ts()
    age_days = (end - rec["created_at"]) / 86_400_000
    citizens = len(rec.get("reporters") or []) or 1
    info = rates.priority_info(rec.get("severity", "low"), citizens, age_days, rec.get("count", 1), rec.get("area_m2", 0.0))
    info["calculated_score"], info["calculated_category"] = info["score"], info["category"]
    ov = rec.get("priority_override")
    if ov:
        info["score"], info["category"], info["overridden"] = BAND_SCORE[ov["category"]], ov["category"], True
    rec["priority"] = info["score"]
    rec["priority_info"] = info
    rec["citizens"] = citizens
    rec["overdue"] = _overdue(rec)
    return rec


def _role_label(h):
    return {"officer": "Municipal officer", "repair": "Repair team", "verifier": "Verifier"}.get(h.get("role"), "Citizen" if not h.get("role") else h["role"])


def public(rec):
    """What citizens and the public map may see: no reporter ids, no internal notes, no staff names."""
    r = _derive(copy.deepcopy(rec))
    r.pop("reporters", None)
    r.pop("needs_review", None)
    r.pop("overdue_notified", None)
    for ev in r.get("evidence", []):
        ev.pop("reporter", None)
        ev.pop("match", None)
    if r.get("assignment"):
        r["assignment"] = {k: v for k, v in r["assignment"].items() if k in ("team", "assigned_at", "target_date")}
    if r.get("priority_override"):
        r["priority_override"] = {"category": r["priority_override"]["category"]}
    r["history"] = [
        {"ts": h["ts"], "status": h["status"], "note": h.get("note", ""), "by": _role_label(h) if h.get("role") else None}
        for h in r.get("history", [])
        if not h.get("internal")
    ]
    for key in ("repair", "verification"):
        if r.get(key):
            r[key] = {k: v for k, v in r[key].items() if k != "by"}
    r["past_repairs"] = [{k: v for k, v in x.items() if k != "by"} for x in r.get("past_repairs", [])]
    return r


def staff_view(rec):
    """Full case for signed-in staff. Citizen ids are still never shown, only the count."""
    r = _derive(copy.deepcopy(rec))
    r["reporters_count"] = len(r.pop("reporters", []) or [])
    for ev in r.get("evidence", []):
        ev.pop("reporter", None)
    return r


def notify(to, code, case_id, **vars):
    """Queue an in-app notification. to = 'staff' or 'citizen:<reporter id>'."""
    db.put("notifications", {"id": "N-" + uuid.uuid4().hex[:10], "created_at": _ts(), "kind": to, "status": "unread", "code": code, "case": case_id, "vars": vars})


def notify_citizens(rec, code, **vars):
    for rid in rec.get("reporters") or []:
        notify(f"citizen:{rid}", code, rec["id"], id=rec["id"], **vars)


def migrate():
    """One-time upgrade of records saved with the old status names."""
    for rec in db.query("potholes", limit=100000):
        if rec.get("schema") == 2:
            continue
        rec["status"] = LEGACY_STATUS.get(rec["status"], rec["status"])
        for h in rec.get("history", []):
            h["status"] = LEGACY_STATUS.get(h["status"], h["status"])
        rec["schema"] = 2
        db.put("potholes", rec)


def _clean_reporter(value):
    v = re.sub(r"[^A-Za-z0-9_-]", "", value or "")[:64]
    return v or None


def _save_media(site_id, n, photo_bgr, annotated_bgr):
    folder = MEDIA_DIR / site_id
    folder.mkdir(parents=True, exist_ok=True)
    photo = folder / f"{n}_photo.jpg"
    ann = folder / f"{n}_annotated.jpg"
    # Keep files reasonably small: max 1600 px on the long side.
    def shrink(img):
        h, w = img.shape[:2]
        s = 1600.0 / max(h, w)
        return cv2.resize(img, None, fx=s, fy=s, interpolation=cv2.INTER_AREA) if s < 1 else img

    cv2.imwrite(str(photo), shrink(photo_bgr), [cv2.IMWRITE_JPEG_QUALITY, 85])
    cv2.imwrite(str(ann), shrink(annotated_bgr), [cv2.IMWRITE_JPEG_QUALITY, 85])
    return f"/media/{site_id}/{photo.name}", f"/media/{site_id}/{ann.name}"


def _geocode_site_async(site_id):
    import threading

    def run():
        rec = db.get("potholes", site_id)
        if not rec or rec.get("lat") is None:
            return
        addr = geocode.reverse(rec["lat"], rec["lng"])
        if not addr:
            return
        rec = db.get("potholes", site_id)  # re-read, it may have changed meanwhile
        if not rec:
            return
        rec["address"] = addr
        rec["jurisdiction"] = geocode.jurisdiction(addr)
        db.put("potholes", rec)
        hub.broadcast_threadsafe({"type": "pothole", "action": "updated", "pothole": public(rec)})

    threading.Thread(target=run, daemon=True).start()


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.get("/api/detector")
def detector_info():
    return {**detector.describe(), "depth": depth_engine.tier}


@router.post("/api/potholes/upload")
async def upload(
    file: UploadFile = File(...),
    frames: List[UploadFile] = File(default=[]),
    lat: Optional[float] = Form(None),
    lng: Optional[float] = Form(None),
    accuracy_m: Optional[float] = Form(None),
    gps_source: str = Form("device"),
    redaction: Optional[str] = Form(None),
    note: Optional[str] = Form(None),
    reporter: Optional[str] = Form(None),
    same_as: Optional[str] = Form(None),
):
    reporter = _clean_reporter(reporter)
    data = await file.read()
    if not data:
        raise HTTPException(400, "The uploaded file is empty.")
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "File is larger than 80 MB. Trim the clip or upload a photo.")
    name = (file.filename or "").lower()
    ext = name.rsplit(".", 1)[-1] if "." in name else ""
    if not ext and (file.content_type or "").startswith("video/"):
        ext = (file.content_type or "video/webm").split("/")[-1]

    if lat is None or lng is None:
        exif = gps_from_exif(data) if ext not in VIDEO_EXTS else None
        if exif:
            lat, lng, gps_source, accuracy_m = exif["lat"], exif["lng"], "photo-exif", None
        else:
            lat = lng = None
            gps_source = "none"
    if lat is not None and not (-90 <= lat <= 90 and -180 <= lng <= 180):
        raise HTTPException(400, "Location is out of range.")

    extra = [await f.read() for f in frames[:24]]
    loop = asyncio.get_running_loop()
    try:
        frame, dets, frames_checked = await loop.run_in_executor(None, analyse_capture, data, ext, extra)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc

    info = detector.describe()
    result = {
        "detector": info,
        "frames_checked": frames_checked,
        "detections": len(dets),
        "location": {"lat": lat, "lng": lng, "source": gps_source, "accuracy_m": accuracy_m},
    }
    if not dets:
        result["site"] = None
        result["message"] = "No potholes found in this capture."
        return result

    # Is this the same pothole as a nearby open case? Decide before the expensive measurement.
    existing, dist, sim, match = None, None, None, None
    if lat is not None:
        existing, dist = db.nearest("potholes", lat, lng, DEDUP_RADIUS_M, exclude_status=CLOSED_STATUSES)
    if existing:
        sim = await loop.run_in_executor(None, _similarity_to_site, frame, existing)
        if same_as == "new":
            existing = None
        elif same_as == existing["id"]:
            match = "citizen"
        elif sim is not None and sim >= DUP_AUTO_SIMILARITY:
            match = "auto"
        else:
            ev = existing["evidence"][-1]
            result.update({
                "site": None,
                "needs_confirmation": True,
                "candidate": {
                    "id": existing["id"], "distance_m": round(dist, 1), "similarity": sim,
                    "photo": ev.get("annotated") or ev.get("photo"),
                    "citizens": len(existing.get("reporters") or []) or 1, "status": existing["status"],
                },
            })
            return result

    defects = await loop.run_in_executor(None, _measure, frame, dets)
    annotated = _annotate(frame, defects)
    summary = _summarise(defects)
    privacy = None
    if redaction:
        try:
            privacy = json.loads(redaction)
        except ValueError:
            privacy = None

    now = _ts()
    ev_extra = {"reporter": reporter}
    if existing:
        rec = existing
        before_cat = _derive(copy.deepcopy(rec))["priority_info"]["category"]
        n = len(rec.get("evidence", [])) + 1
        photo_url, ann_url = await loop.run_in_executor(None, _save_media, rec["id"], n, frame, annotated)
        rec["reports"] = rec.get("reports", 1) + 1
        rec["evidence"].append({
            "ts": now, "photo": photo_url, "annotated": ann_url, "privacy": privacy, "count": len(defects), "note": note,
            "reporter": reporter, "match": {"method": match, "similarity": sim, "distance_m": round(dist, 1)},
        })
        if reporter and reporter not in rec.setdefault("reporters", []):
            rec["reporters"].append(reporter)
        if match == "citizen" and (sim is None or sim < DUP_AUTO_SIMILARITY):
            rec["needs_review"] = True  # the citizen says it is the same, the photos do not clearly agree
        # Keep the measurement set from the clearest capture.
        if summary["count"] >= rec["count"] and summary["confidence"] >= rec["confidence"] - 0.05:
            rec["defects"] = defects
            rec.update(summary)
            rec["estimate"] = _estimate(defects)
        rec["history"].append({"ts": now, "status": rec["status"], "note": f"New report added ({dist:.0f} m away)."})
        action = "merged"
    else:
        before_cat = None
        site_id = "PH-" + uuid.uuid4().hex[:6].upper()
        photo_url, ann_url = await loop.run_in_executor(None, _save_media, site_id, 1, frame, annotated)
        rec = {
            "id": site_id,
            "schema": 2,
            "kind": "pothole",
            "created_at": now,
            "status": "reported",
            "lat": lat,
            "lng": lng,
            "gps_source": gps_source,
            "gps_accuracy_m": accuracy_m,
            "address": None,
            "jurisdiction": None,
            "defects": defects,
            **summary,
            "detector": info,
            "measurement_method": "Monocular estimate from a single camera (no stereo or LiDAR).",
            "estimate": _estimate(defects),
            "reports": 1,
            "evidence": [
                {"ts": now, "photo": photo_url, "annotated": ann_url, "privacy": privacy, "count": len(defects), "note": note, "reporter": reporter}
            ],
            "reporters": [reporter] if reporter else [],
            "history": [{"ts": now, "status": "reported", "note": note or "Reported from camera upload."}],
        }
        action = "created"

    db.put("potholes", rec)
    view = public(rec)
    if action == "created":
        notify("staff", "new_case", rec["id"], id=rec["id"])
    else:
        notify("staff", "new_report", rec["id"], id=rec["id"], n=view["citizens"])
        if before_cat and view["priority_info"]["category"] != before_cat and rates_rank(view["priority_info"]["category"]) > rates_rank(before_cat):
            notify("staff", "priority_up", rec["id"], id=rec["id"], cat=view["priority_info"]["category"])
    await hub.broadcast({"type": "pothole", "action": action, "pothole": view})
    if rec.get("lat") is not None and not rec.get("address"):
        _geocode_site_async(rec["id"])
    result.update({"site": view, "action": action, "merged_distance_m": None if dist is None else round(dist, 1)})
    return result


def rates_rank(cat):
    return ["low", "medium", "high", "critical"].index(cat)


def _similarity_to_site(frame, site):
    """Best photo similarity between this capture and the site's latest photos."""
    best = None
    for ev in site.get("evidence", [])[-3:]:
        path = MEDIA_DIR / site["id"] / ev["photo"].rsplit("/", 1)[-1]
        img = cv2.imread(str(path)) if path.exists() else None
        if img is None:
            continue
        v = similarity(frame, img)
        if v is not None and (best is None or v > best):
            best = v
    return best


@router.get("/api/potholes")
def list_potholes(status: Optional[str] = None, limit: int = 500, reporter: Optional[str] = None):
    st = status.split(",") if status else None
    rows = db.query("potholes", status=st, limit=limit)
    if reporter is not None:
        # "My reports": only sites this device reported. Other citizens' ids are never returned.
        rid = _clean_reporter(reporter)
        rows = [r for r in rows if rid and rid in (r.get("reporters") or [])]
    return [public(r) for r in rows]


@router.get("/api/potholes/export.csv")
def export_csv():
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(
        ["id", "reported_at", "status", "severity", "priority", "potholes", "area_m2", "max_depth_mm",
         "volume_m3", "estimate_total", "currency", "lat", "lng", "address", "authority", "ward", "reports", "citizens"]
    )
    for r in db.query("potholes", limit=10000):
        r = public(r)
        est = r.get("estimate") or {}
        addr = r.get("address") or {}
        jur = r.get("jurisdiction") or {}
        w.writerow([
            r["id"], time.strftime("%Y-%m-%d %H:%M", time.localtime(r["created_at"] / 1000)), r["status"],
            r["severity"], r["priority"], r["count"], r["area_m2"], round(r["depth_max_m"] * 1000),
            r["volume_m3"], est.get("total"), est.get("currency"), r.get("lat"), r.get("lng"),
            addr.get("label"), jur.get("authority"), jur.get("ward"), r.get("reports", 1), r["citizens"],
        ])
    return Response(
        buf.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="sentineldrive-potholes.csv"'},
    )


@router.get("/api/potholes/{site_id}")
def get_pothole(site_id: str):
    rec = db.get("potholes", site_id)
    if not rec:
        raise HTTPException(404, "No pothole site with that ID.")
    return public(rec)


class LocationBody(BaseModel):
    reporter: str
    lat: float
    lng: float


@router.post("/api/potholes/{site_id}/location")
async def set_location(site_id: str, body: LocationBody):
    """A citizen can place their own report on the map, but only when it has no location yet."""
    rec = db.get("potholes", site_id)
    if not rec:
        raise HTTPException(404, "No pothole site with that ID.")
    rid = _clean_reporter(body.reporter)
    if not rid or rid not in (rec.get("reporters") or []):
        raise HTTPException(403, "Only the person who reported this pothole can set its location.")
    if rec.get("lat") is not None:
        raise HTTPException(409, "This site already has a location. Ask the municipality to move it.")
    if not (-90 <= body.lat <= 90 and -180 <= body.lng <= 180):
        raise HTTPException(400, "Location is out of range.")
    rec["lat"], rec["lng"], rec["gps_source"], rec["address"] = body.lat, body.lng, "set-on-map", None
    rec["history"].append({"ts": _ts(), "status": rec["status"], "note": "Location set on map by the reporter."})
    db.put("potholes", rec)
    await hub.broadcast({"type": "pothole", "action": "updated", "pothole": public(rec)})
    _geocode_site_async(rec["id"])
    return public(rec)


@router.get("/api/citizen/notifications")
def citizen_notifications(reporter: str, limit: int = 50):
    rid = _clean_reporter(reporter)
    if not rid:
        return []
    return db.query("notifications", kind=f"citizen:{rid}", limit=limit)


@router.post("/api/citizen/notifications/read")
def citizen_notifications_read(reporter: str):
    rid = _clean_reporter(reporter)
    n = 0
    for x in db.query("notifications", kind=f"citizen:{rid}", status="unread", limit=500) if rid else []:
        x["status"] = "read"
        db.put("notifications", x)
        n += 1
    return {"read": n}


@router.get("/api/potholes/{site_id}/verification.pdf")
def verification_report(site_id: str):
    rec = db.get("potholes", site_id)
    if not rec:
        raise HTTPException(404, "No pothole site with that ID.")
    return Response(
        verification_pdf(public(rec), rates.get_rate_card()),
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="RepairVerification-{site_id}.pdf"'},
    )


@router.get("/api/potholes/{site_id}/work-order.pdf")
def work_order(site_id: str):
    rec = db.get("potholes", site_id)
    if not rec:
        raise HTTPException(404, "No pothole site with that ID.")
    pdf = work_order_pdf(public(rec), rates.get_rate_card())
    return Response(
        pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="WorkOrder-{site_id}.pdf"'},
    )


@router.post("/api/potholes/recalculate")
async def recalculate(_user=Depends(auth.require("officer", "verifier"))):
    """Re-price every open site with the current rate card."""
    n = 0
    for rec in db.query("potholes", status=OPEN_STATUSES, limit=10000):
        rec["estimate"] = _estimate(rec["defects"])
        db.put("potholes", rec)
        n += 1
    await hub.broadcast({"type": "refresh"})
    return {"updated": n}


# -- settings ----------------------------------------------------------------


@router.get("/api/settings/rate-card")
def get_rate_card():
    return {"rate_card": rates.get_rate_card(), "defaults": rates.DEFAULT_RATE_CARD}


@router.put("/api/settings/rate-card")
def put_rate_card(values: dict, _user=Depends(auth.require("officer", "verifier"))):
    try:
        return {"rate_card": rates.set_rate_card(values)}
    except (TypeError, ValueError) as exc:
        raise HTTPException(400, str(exc)) from exc


# -- municipal integration ----------------------------------------------------


@router.get("/api/b2g/work-orders")
def b2g_work_orders(x_api_key: Optional[str] = Header(None), authority: Optional[str] = None):
    """Open work orders for a civic body's own systems. Requires X-API-Key."""
    if x_api_key != API_KEY:
        raise HTTPException(401, "Missing or invalid X-API-Key header.")
    out = []
    for r in db.query("potholes", status=OPEN_STATUSES, limit=10000):
        jur = r.get("jurisdiction") or {}
        if authority and (jur.get("authority") or "").lower() != authority.lower():
            continue
        r = public(r)
        out.append({
            "id": r["id"], "status": r["status"], "severity": r["severity"], "priority": r["priority"],
            "lat": r.get("lat"), "lng": r.get("lng"), "address": (r.get("address") or {}).get("label"),
            "authority": jur.get("authority"), "ward": jur.get("ward"), "potholes": r["count"],
            "estimate_total": (r.get("estimate") or {}).get("total"),
            "currency": (r.get("estimate") or {}).get("currency"),
            "reported_at": r["created_at"], "reports": r.get("reports", 1),
            "work_order_pdf": f"/api/potholes/{r['id']}/work-order.pdf",
        })
    out.sort(key=lambda x: x["priority"], reverse=True)
    return out
