"""Staff and citizen accounts. Passwords are stored only as salted PBKDF2-SHA256 hashes."""

import hashlib
import hmac
import re
import secrets

from fastapi import HTTPException

from . import db

ITERATIONS = 150_000
STAFF_ROLES = ("officer", "repair", "verifier")
DEFAULT_STAFF = {"officer": "officer", "repairteam": "repair", "verifier": "verifier"}
_DUMMY = None


def _hash(password, salt_hex):
    return hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt_hex), ITERATIONS).hex()


def make_secret(password):
    salt = secrets.token_hex(16)
    return {"salt": salt, "hash": _hash(password, salt)}


def check(password, rec):
    """Constant-time password check. Also burns the same time when the account does not exist."""
    global _DUMMY
    if rec is None:
        if _DUMMY is None:
            _DUMMY = make_secret("dummy-password-for-timing")
        _hash(password, _DUMMY["salt"])
        return False
    return hmac.compare_digest(_hash(password, rec["salt"]), rec["hash"])


def check_policy(password, *names):
    if len(password) < 8:
        raise HTTPException(422, "Use a password of at least 8 characters.")
    if len(password) > 128:
        raise HTTPException(422, "That password is too long (128 characters at most).")
    if password.lower() in {n.lower() for n in names if n} or password.isdigit():
        raise HTTPException(422, "Choose a password that is not just numbers or your own name.")


# ---- staff ------------------------------------------------------------------

def clean_username(u):
    u = (u or "").strip().lower()
    if not re.fullmatch(r"[a-z0-9._-]{3,32}", u):
        raise HTTPException(422, "Usernames use 3 to 32 letters, numbers, dots, dashes or underscores.")
    return u


def create_staff(username, role, password, by="system"):
    if role not in STAFF_ROLES:
        raise HTTPException(422, "Role must be officer, repair or verifier.")
    username = clean_username(username)
    if db.get("staff", username):
        raise HTTPException(409, "That username already exists.")
    check_policy(password, username)
    rec = {"id": username, "kind": role, "status": "active", "role": role, "tv": 0, "created_by": by, **make_secret(password)}
    return db.put("staff", rec)


def seed_staff(password):
    """First start only: create the three demo accounts with the deployment password."""
    for u, role in DEFAULT_STAFF.items():
        if not db.get("staff", u):
            db.put("staff", {"id": u, "kind": role, "status": "active", "role": role, "tv": 0, "created_by": "system", **make_secret(password)})


def staff_public(rec):
    return {"username": rec["id"], "role": rec["role"], "active": rec["status"] == "active", "created_at": rec["created_at"], "created_by": rec.get("created_by")}


def set_staff_password(username, password):
    rec = db.get("staff", username)
    if not rec:
        raise HTTPException(404, "No such staff account.")
    check_policy(password, username)
    rec.update(make_secret(password))
    rec["tv"] = rec.get("tv", 0) + 1  # signs out every session of this account
    db.put("staff", rec)


# ---- citizens ---------------------------------------------------------------

def normalise_contact(c):
    return re.sub(r"[\s\-()]", "", (c or "").strip().lower())


def valid_contact(c):
    return bool(re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", c) or re.fullmatch(r"\+?\d{8,15}", c))


def create_citizen(name, contact, password):
    name = (name or "").strip()
    contact = normalise_contact(contact)
    if len(name) < 2 or len(name) > 60:
        raise HTTPException(422, "Enter your name (2 to 60 characters).")
    if not valid_contact(contact):
        raise HTTPException(422, "Enter a valid email address or phone number (8 to 15 digits).")
    check_policy(password, name, contact)
    if db.kv_get(f"citizen:{contact}"):
        raise HTTPException(409, "An account with those details already exists. Sign in instead.")
    cid = "c-" + secrets.token_hex(8)
    rec = {"id": cid, "kind": "citizen", "status": "active", "name": name, "contact": contact, "tv": 0, **make_secret(password)}
    rec = db.put("citizens", rec)
    db.kv_set(f"citizen:{contact}", cid)
    return rec


def find_citizen(contact):
    cid = db.kv_get(f"citizen:{normalise_contact(contact)}")
    return db.get("citizens", cid) if cid else None


def citizen_public(rec):
    return {"id": rec["id"], "name": rec["name"], "contact": rec["contact"]}


def set_citizen_password(rec, password):
    check_policy(password, rec["name"], rec["contact"])
    rec.update(make_secret(password))
    rec["tv"] = rec.get("tv", 0) + 1
    db.put("citizens", rec)
