"""Staff sign-in for the municipal dashboard.

Three roles, one shared password (set SENTINEL_STAFF_PASSWORD; if unset a random one is
printed at start-up). Every protected endpoint checks the role on the server; hiding a
button in the browser is never the only protection.

  officer   acknowledge, reject, assign teams, set priority, add notes
  repair    start work and upload the after-repair photo
  verifier  accept or reject finished repairs, reopen, delete, see the audit trail
            (also has the officer powers; cannot complete a repair, so it cannot verify its own work)
"""

import base64
import hashlib
import hmac
import json
import logging
import secrets
import time
from typing import Optional

from fastapi import Header, HTTPException, Request

from . import config

log = logging.getLogger("sentinel.auth")

USERS = {"officer": "officer", "repairteam": "repair", "verifier": "verifier"}
TOKEN_HOURS = 12
_password = None
_fails = {}  # ip -> [timestamps]


def staff_password():
    global _password
    if _password is None:
        _password = config.STAFF_PASSWORD or secrets.token_urlsafe(9)
        if not config.STAFF_PASSWORD:
            log.warning("SENTINEL_STAFF_PASSWORD is not set. Generated staff password for this run: %s", _password)
    return _password


def _sign(payload):
    return hmac.new(config.SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()


def issue(username):
    body = json.dumps({"u": username, "r": USERS[username], "exp": int(time.time()) + TOKEN_HOURS * 3600}, separators=(",", ":"))
    payload = base64.urlsafe_b64encode(body.encode()).decode().rstrip("=")
    return f"{payload}.{_sign(payload)}"


def verify(token):
    try:
        payload, sig = token.split(".", 1)
        if not hmac.compare_digest(sig, _sign(payload)):
            return None
        data = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
        if data["exp"] < time.time() or data["u"] not in USERS:
            return None
        return {"name": data["u"], "role": data["r"]}
    except Exception:
        return None


def login(username, password, ip="?"):
    now = time.time()
    recent = [t for t in _fails.get(ip, []) if now - t < 600]
    if len(recent) >= 10:
        raise HTTPException(429, "Too many failed sign-ins. Wait a few minutes and try again.")
    ok = username in USERS and hmac.compare_digest(password.encode(), staff_password().encode())
    if not ok:
        _fails[ip] = recent + [now]
        raise HTTPException(401, "Wrong username or password.")
    _fails.pop(ip, None)
    return {"token": issue(username), "user": {"name": username, "role": USERS[username]}}


def current_user(authorization: Optional[str] = Header(None)):
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Sign in to the municipal dashboard first.")
    user = verify(authorization[7:].strip())
    if not user:
        raise HTTPException(401, "Your session has expired. Sign in again.")
    return user


def require(*roles):
    """FastAPI dependency: the signed-in user must have one of these roles."""

    def dep(authorization: Optional[str] = Header(None)):
        user = current_user(authorization)
        if user["role"] not in roles:
            raise HTTPException(403, f"This action needs the {' or '.join(roles)} role.")
        return user

    return dep


def client_ip(request: Request):
    return request.client.host if request.client else "?"
