"""Sign-in for staff (municipal dashboard) and citizens.

Staff have individual accounts with salted password hashes (see accounts.py), three roles, and
every protected endpoint checks the role on the server. The first time the server starts it creates
three demo accounts (officer, repairteam, verifier) using SENTINEL_STAFF_PASSWORD (a random one is
printed in the log if unset). A verifier can then add real staff, disable accounts and reset passwords.

  officer   acknowledge, reject, assign teams, set priority, add notes
  repair    start work and upload the after-repair photo
  verifier  accept or reject finished repairs, reopen, delete, manage staff, see the audit trail
            (also has the officer powers; cannot complete a repair, so it cannot verify its own work)

Tokens are HMAC-signed, expire after 12 h, and stop working at once if the account is disabled
or its password changes.
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

from . import accounts, config, db, ratelimit

log = logging.getLogger("sentinel.auth")

TOKEN_HOURS = 12
_password = None
FAIL_LIMIT = 8
FAIL_WINDOW = 600


def staff_password():
    global _password
    if _password is None:
        _password = config.STAFF_PASSWORD or secrets.token_urlsafe(9)
        if not config.STAFF_PASSWORD:
            log.warning("SENTINEL_STAFF_PASSWORD is not set. Generated password for the demo staff accounts: %s", _password)
    return _password


def seed():
    accounts.seed_staff(staff_password())


def _sign(payload):
    return hmac.new(config.SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()


def issue(kind, rec):
    body = json.dumps({"k": kind, "u": rec["id"], "tv": rec.get("tv", 0), "exp": int(time.time()) + TOKEN_HOURS * 3600}, separators=(",", ":"))
    payload = base64.urlsafe_b64encode(body.encode()).decode().rstrip("=")
    return f"{payload}.{_sign(payload)}"


def verify(token, kind):
    """Return the live account record for a valid token of this kind, else None."""
    try:
        payload, sig = token.split(".", 1)
        if not hmac.compare_digest(sig, _sign(payload)):
            return None
        data = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
        if data["exp"] < time.time() or data["k"] != kind:
            return None
        rec = db.get("staff" if kind == "staff" else "citizens", data["u"])
        if not rec or rec["status"] != "active" or rec.get("tv", 0) != data["tv"]:
            return None
        return rec
    except Exception:
        return None


def _login(kind, table_get, identifier, password, ip):
    key = f"fail:{kind}:{ip}"
    if ratelimit.failures(key, FAIL_WINDOW) >= FAIL_LIMIT:
        raise HTTPException(429, "Too many failed sign-ins. Wait a few minutes and try again.")
    rec = table_get(identifier)
    if not (accounts.check(password, rec) and rec["status"] == "active"):
        ratelimit.hit(key, 10 ** 6, FAIL_WINDOW)  # record the failure
        raise HTTPException(401, "Wrong username or password." if kind == "staff" else "Wrong email/phone or password.")
    ratelimit.clear(key)
    return rec


def login(username, password, ip="?"):
    rec = _login("staff", lambda u: db.get("staff", u), username, password, ip)
    return {"token": issue("staff", rec), "user": {"name": rec["id"], "role": rec["role"]}}


def citizen_login(contact, password, ip="?"):
    rec = _login("citizen", accounts.find_citizen, contact, password, ip)
    return {"token": issue("citizen", rec), "user": accounts.citizen_public(rec)}


def _bearer(authorization):
    if authorization and authorization.lower().startswith("bearer "):
        return authorization[7:].strip()
    return None


def current_user(authorization: Optional[str] = Header(None)):
    token = _bearer(authorization)
    if not token:
        raise HTTPException(401, "Sign in to the municipal dashboard first.")
    rec = verify(token, "staff")
    if not rec:
        raise HTTPException(401, "Your session has expired. Sign in again.")
    return {"name": rec["id"], "role": rec["role"]}


def require(*roles):
    """FastAPI dependency: the signed-in user must have one of these roles."""

    def dep(authorization: Optional[str] = Header(None)):
        user = current_user(authorization)
        if user["role"] not in roles:
            raise HTTPException(403, f"This action needs the {' or '.join(roles)} role.")
        return user

    return dep


def citizen_record(authorization: Optional[str]):
    token = _bearer(authorization)
    return verify(token, "citizen") if token else None


def current_citizen(authorization: Optional[str] = Header(None)):
    rec = citizen_record(authorization)
    if not rec:
        raise HTTPException(401, "Sign in to your citizen account first.")
    return rec


def reporter_id(authorization, supplied):
    """Who is filing or reading. A signed-in citizen is always their account id; a guest uses a random
    browser id, which may never look like an account id, so nobody can pose as someone else."""
    rec = citizen_record(authorization)
    if rec:
        return rec["id"]
    v = "".join(ch for ch in (supplied or "") if ch.isalnum() or ch in "_-")[:64]
    if not v or v.startswith("c-"):
        return None
    return v


def client_ip(request: Request):
    # behind Render's proxy the real address is the first X-Forwarded-For entry
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "?"
