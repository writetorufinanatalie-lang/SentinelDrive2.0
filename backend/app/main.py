"""SentinelDrive API.

Run:  uvicorn app.main:app --reload --port 8000
"""

import asyncio
import json
import logging
import re
import secrets
import time
from collections import Counter
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import db
from .config import CORS_ORIGINS, GEOCODER, MEDIA_DIR
from .engine import LiveEngine, engine, get_prefs, set_prefs
from .hub import hub
from . import auth, ratelimit
from .potholes import OPEN_STATUSES, detector, migrate, router as potholes_router
from .staff import router as staff_router
from .citizens import router as citizens_router

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


# One LiveEngine per vehicle code. A phone in the car and a dashboard that watches it use the same code.
VEHICLES = {}
WS_VEHICLE = {}
PRIVATE = {"driver", "talkback", "talkback_retry", "talkback_done", "siren"}  # only that vehicle's screens


def vehicle_engine(code):
    if code not in VEHICLES:
        VEHICLES[code] = LiveEngine()
    return VEHICLES[code]


def clean_code(raw):
    code = re.sub(r"[^A-Za-z0-9]", "", raw or "").upper()[:24]
    return code if len(code) >= 4 else None


async def send_for(code, events):
    """Driver, alertness and siren events go only to screens using this vehicle code; the rest go to everyone."""
    for ev in events:
        if ev["type"] in PRIVATE:
            for ws, c in list(WS_VEHICLE.items()):
                if c == code:
                    try:
                        await ws.send_json(ev)
                    except Exception:
                        pass
        else:
            await hub.broadcast(ev)


async def _tick_loop():
    while True:
        try:
            for code, eng in list(VEHICLES.items()):
                await send_for(code, eng.tick())
                if eng.idle() and code not in WS_VEHICLE.values():
                    VEHICLES.pop(code, None)
            await hub.broadcast_many(engine.tick_crashes())
        except Exception:  # never let the loop die
            logging.getLogger("sentinel").exception("tick failed")
        await asyncio.sleep(0.5)


@asynccontextmanager
async def lifespan(_app):
    hub.attach_loop()
    auth.seed()
    migrate()
    task = asyncio.create_task(_tick_loop())
    yield
    task.cancel()


app = FastAPI(title="SentinelDrive API", version="2.0", lifespan=lifespan)
if CORS_ORIGINS:  # by default only this site may call the API from a browser
    app.add_middleware(CORSMiddleware, allow_origins=CORS_ORIGINS, allow_methods=["GET", "POST", "PUT", "DELETE"], allow_headers=["Authorization", "Content-Type", "X-API-Key"])

CSP = (
    "default-src 'self'; script-src 'self' 'wasm-unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; "
    "img-src 'self' data: blob: https://tile.openstreetmap.org https://*.tile.openstreetmap.org; "
    "media-src 'self' blob:; connect-src 'self' data: blob:; worker-src 'self' blob:; font-src 'self' data:; "
    "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    resp = await call_next(request)
    h = resp.headers
    h.setdefault("X-Content-Type-Options", "nosniff")
    h.setdefault("X-Frame-Options", "DENY")
    h.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    h.setdefault("Permissions-Policy", "camera=(self), microphone=(self), geolocation=(self), accelerometer=(self), payment=()")
    h.setdefault("Cross-Origin-Opener-Policy", "same-origin")
    if not request.url.path.startswith(("/api/", "/media/")):
        h.setdefault("Content-Security-Policy", CSP)
    if request.headers.get("x-forwarded-proto") == "https" or request.url.scheme == "https":
        h.setdefault("Strict-Transport-Security", "max-age=31536000")
    if request.url.path.startswith("/api/"):
        h.setdefault("Cache-Control", "no-store")  # account and case data must not be cached by browsers or proxies
    return resp


app.include_router(potholes_router)
app.include_router(staff_router)
app.include_router(citizens_router)
app.mount("/media", StaticFiles(directory=str(MEDIA_DIR)), name="media")


WS_MAX_BYTES = 32_768
WS_MAX_CLIENTS = 300


def _origin_ok(ws: WebSocket):
    origin = ws.headers.get("origin")
    if not origin:
        return True  # non-browser clients (tests, the Pi script) send no Origin
    host = ws.headers.get("host", "")
    return origin.split("://", 1)[-1] == host or origin in CORS_ORIGINS


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    if not _origin_ok(ws) or len(hub.clients) >= WS_MAX_CLIENTS:
        await ws.close(code=1008)
        return
    await ws.accept()
    code = clean_code(ws.query_params.get("vehicle")) or "P" + secrets.token_hex(5).upper()  # no code: a private one
    WS_VEHICLE[ws] = code
    hub.clients.add(ws)
    mine = vehicle_engine(code)
    await ws.send_json({"type": "hello", "vehicle": code, **mine.snapshot()})
    stamps = []
    try:
        while True:
            raw = await ws.receive_text()
            if len(raw) > WS_MAX_BYTES:
                await ws.close(code=1009)
                break
            now = time.time()
            stamps = [t for t in stamps if now - t < 5] + [now]
            if len(stamps) > 60:  # more than 12 messages a second from one connection: ignore the flood
                continue
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue
            if isinstance(msg, dict):
                await send_for(code, vehicle_engine(code).ingest(msg))
    except WebSocketDisconnect:
        pass
    finally:
        hub.clients.discard(ws)
        WS_VEHICLE.pop(ws, None)


@app.get("/api/health")
def health():
    return {
        "ok": True,
        "detector": detector.describe(),
        "geocoder": GEOCODER,
        "clients": len(hub.clients),
    }


@app.get("/api/incidents")
def list_incidents(kind: Optional[str] = None, limit: int = 200):
    return db.query("incidents", kind=kind, limit=limit)


@app.get("/api/incidents/{iid}")
def get_incident(iid: str):
    rec = db.get("incidents", iid)
    if not rec:
        raise HTTPException(404, "No incident with that ID.")
    return rec


@app.post("/api/incidents/{iid}/resolve")
async def resolve_incident(iid: str):
    events = engine.ingest({"type": "crash_response", "id": iid, "response": "resolved"})
    if not events:
        raise HTTPException(409, "This incident cannot be resolved from its current state.")
    await hub.broadcast_many(events)
    return events[0]["incident"]


@app.get("/api/alertness-checks")
def list_checks(limit: int = 100):
    return db.query("talkbacks", limit=limit)


@app.get("/api/settings/preferences")
def read_prefs():
    return get_prefs()


@app.put("/api/settings/preferences")
def write_prefs(values: dict, request: Request):
    ratelimit.hit(f"prefs:{auth.client_ip(request)}", 30, 600)
    return set_prefs(values)


@app.get("/api/stats")
def stats():
    now = int(time.time() * 1000)
    day = 86_400_000
    potholes = db.query("potholes", limit=100000)
    incidents = db.query("incidents", since=now - 30 * day, limit=100000)
    checks = db.query("talkbacks", since=now - 30 * day, limit=100000)
    open_sites = [p for p in potholes if p["status"] in OPEN_STATUSES]

    days = []
    for i in range(13, -1, -1):
        start = (now // day - i) * day
        days.append(
            {
                "day": time.strftime("%d %b", time.gmtime(start / 1000)),
                "reported": sum(1 for p in potholes if start <= p["created_at"] < start + day),
                "repaired": sum(1 for p in potholes if start <= next((h["ts"] for h in p.get("history", []) if h["status"] == "completed"), 0) < start + day),
            }
        )
    by_status = Counter(p["status"] for p in potholes)
    by_sev = Counter(p["severity"] for p in open_sites)
    return {
        "potholes": {
            "total": len(potholes),
            "open": len(open_sites),
            "open_potholes": sum(p.get("count", 1) for p in open_sites),
            "by_status": {s: by_status.get(s, 0) for s in ["reported", "acknowledged", "assigned", "in_progress", "completed", "verified", "reopened", "rejected"]},
            "open_by_severity": {s: by_sev.get(s, 0) for s in ["high", "medium", "low"]},
            "open_estimate": round(sum((p.get("estimate") or {}).get("total", 0) for p in open_sites), 2),
            "currency": next(((p.get("estimate") or {}).get("currency") for p in potholes if p.get("estimate")), "INR"),
            "missing_location": sum(1 for p in open_sites if p.get("lat") is None),
        },
        "incidents_30d": {
            "crashes_verified": sum(1 for i in incidents if i["kind"] == "crash" and i.get("verified")),
            "crashes_suppressed": sum(1 for i in incidents if i["kind"] == "crash" and not i.get("verified")),
            "sirens": sum(1 for i in incidents if i["kind"] == "siren"),
        },
        "alertness_30d": {
            "checks": len(checks),
            "passed": sum(1 for c in checks if c.get("correct")),
            "alarms": sum(1 for c in checks if c.get("alarm")),
        },
        "daily": days,
    }


# Serve the built frontend (npm run build) from the same port when present,
# so a single `uvicorn` process is enough for a demo.
DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"
if DIST.exists():
    app.mount("/assets", StaticFiles(directory=str(DIST / "assets")), name="assets")
    for sub in ("wasm", "models"):
        if (DIST / sub).exists():
            app.mount(f"/{sub}", StaticFiles(directory=str(DIST / sub)), name=sub)

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        if path.startswith(("api/", "media/")):
            raise HTTPException(404, "Not found.")
        f = (DIST / path).resolve()
        if path and f.is_file() and f.is_relative_to(DIST.resolve()):
            headers = None
            if path in ("sw.js", "index.html"):
                # Always revalidate so a new deploy reaches installed apps quickly.
                headers = {"Cache-Control": "no-cache"}
            media = "application/manifest+json" if path == "manifest.webmanifest" else None
            return FileResponse(f, headers=headers, media_type=media)
        return FileResponse(DIST / "index.html", headers={"Cache-Control": "no-cache"})
