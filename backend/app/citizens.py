"""Citizen accounts: register, sign in, change password. Guests need no account."""

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel

from . import accounts, auth, db, ratelimit

router = APIRouter(tags=["citizen"])


class Register(BaseModel):
    name: str
    contact: str
    password: str


class Login(BaseModel):
    contact: str
    password: str


class ChangePassword(BaseModel):
    current: str
    new: str


@router.post("/api/citizen/register")
def register(body: Register, request: Request):
    ip = auth.client_ip(request)
    ratelimit.hit(f"reg:{ip}", 10, 3600, "Too many accounts created from this network. Try again later.")
    rec = accounts.create_citizen(body.name, body.contact, body.password)
    return {"token": auth.issue("citizen", rec), "user": accounts.citizen_public(rec)}


@router.post("/api/citizen/login")
def login(body: Login, request: Request):
    return auth.citizen_login(body.contact, body.password, auth.client_ip(request))


@router.get("/api/citizen/me")
def me(rec=Depends(auth.current_citizen)):
    return accounts.citizen_public(rec)


@router.post("/api/citizen/password")
def change_password(body: ChangePassword, request: Request, rec=Depends(auth.current_citizen)):
    ratelimit.hit(f"cpw:{rec['id']}", 8, 600)
    if not accounts.check(body.current, rec):
        from fastapi import HTTPException
        raise HTTPException(403, "Your current password is wrong.")
    accounts.set_citizen_password(rec, body.new)
    return auth.citizen_login(rec["contact"], body.new, auth.client_ip(request))
