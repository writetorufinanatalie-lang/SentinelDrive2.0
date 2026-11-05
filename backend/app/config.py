"""Runtime configuration. Everything can be overridden with environment variables
(see backend/.env.example)."""

import os
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent

DATA_DIR = Path(os.getenv("SENTINEL_DATA_DIR", BACKEND_DIR / "data"))
MEDIA_DIR = DATA_DIR / "media"
DB_PATH = Path(os.getenv("SENTINEL_DB", DATA_DIR / "sentinel.db"))
MODELS_DIR = Path(os.getenv("SENTINEL_MODELS_DIR", BACKEND_DIR / "models"))

# Reverse geocoding via OpenStreetMap Nominatim. Set to "off" to disable
# (e.g. no internet at a venue); addresses then show as coordinates only.
GEOCODER = os.getenv("SENTINEL_GEOCODER", "nominatim")
GEOCODER_URL = os.getenv("SENTINEL_GEOCODER_URL", "https://nominatim.openstreetmap.org/reverse")
GEOCODER_USER_AGENT = os.getenv("SENTINEL_GEOCODER_UA", "SentinelDrive/1.0 (road-safety MVP)")

# API key for the municipal (B2G) integration endpoint.
API_KEY = os.getenv("SENTINEL_API_KEY", "change-me")

# Optional: POST verified crash alerts to this URL (n8n, Zapier, Slack
# incoming webhook, a Telegram bot relay...).
ALERT_WEBHOOK = os.getenv("SENTINEL_ALERT_WEBHOOK", "")

# Two potholes closer than this are treated as the same defect.
DEDUP_RADIUS_M = float(os.getenv("SENTINEL_DEDUP_RADIUS_M", "8"))

# Minimum detector confidence kept.
MIN_CONFIDENCE = float(os.getenv("SENTINEL_MIN_CONFIDENCE", "0.50"))

# Staff sign-in (municipal dashboard). One shared password for the three demo roles
# (officer, repairteam, verifier). If unset, a random one is generated and printed at start-up.
STAFF_PASSWORD = os.getenv("SENTINEL_STAFF_PASSWORD", "")
SECRET = os.getenv("SENTINEL_SECRET", "") or API_KEY
# A case with no target date counts as overdue after this many days.
OVERDUE_DAYS = float(os.getenv("SENTINEL_OVERDUE_DAYS", "7"))
# Photo similarity at or above this merges a nearby report automatically; below it the citizen is asked.
DUP_AUTO_SIMILARITY = float(os.getenv("SENTINEL_DUP_SIMILARITY", "0.30"))

for _d in (DATA_DIR, MEDIA_DIR, MODELS_DIR):
    _d.mkdir(parents=True, exist_ok=True)
