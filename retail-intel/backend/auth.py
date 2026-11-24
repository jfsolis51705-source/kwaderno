"""Authentication, authorization and signed media links.

- Passwords: scrypt (stdlib) with a per-user salt; constant-time comparison.
- Sessions: random bearer tokens; only their SHA-256 is stored; they expire (SESSION_DAYS, default 30).
- Roles: platform role "merchant" or "ops" (KELSON operations); store membership role "owner" or "staff".
- Media: photos are not public; the API hands out URLs signed with HMAC that expire (MEDIA_URL_TTL seconds).
"""
from __future__ import annotations

import hashlib
import hmac
import os
import secrets
import threading
import time
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from db import AuthToken, StoreMember, User, utcnow

SESSION_DAYS = int(os.environ.get("SESSION_DAYS", "30"))
MEDIA_URL_TTL = int(os.environ.get("MEDIA_URL_TTL", "3600"))
_SCRYPT = dict(n=2 ** 14, r=8, p=1, dklen=32)


class AuthError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status, self.message = status, message


# ---------- passwords ----------
def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.scrypt(password.encode(), salt=salt, **_SCRYPT)
    return f"scrypt${salt.hex()}${dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, salt_hex, dk_hex = stored.split("$")
    except ValueError:
        return False
    if algo != "scrypt":
        return False
    dk = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt_hex), **_SCRYPT)
    return hmac.compare_digest(dk.hex(), dk_hex)


# ---------- sessions ----------
def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def issue_token(s: Session, user: User) -> str:
    token = secrets.token_urlsafe(32)
    s.add(AuthToken(token_hash=_token_hash(token), user_id=user.id, expires_at=utcnow() + timedelta(days=SESSION_DAYS)))
    return token


def revoke_token(s: Session, token: str) -> None:
    t = s.get(AuthToken, _token_hash(token))
    if t:
        s.delete(t)


def user_for_token(s: Session, token: str | None) -> User:
    if not token:
        raise AuthError(401, "Please log in")
    t = s.get(AuthToken, _token_hash(token))
    exp = t.expires_at if t else None
    if exp is not None and exp.tzinfo is None:  # SQLite returns naive datetimes
        exp = exp.replace(tzinfo=timezone.utc)
    if not t or exp < utcnow():
        raise AuthError(401, "Your session has expired — please log in again")
    u = s.get(User, t.user_id)
    if not u or not u.active:
        raise AuthError(401, "Account is not active")
    return u


# ---------- authorization ----------
def store_role(s: Session, user: User, store_id: int) -> str | None:
    if user.role == "ops":
        return "ops"
    m = s.scalar(select(StoreMember).where(StoreMember.user_id == user.id, StoreMember.store_id == store_id))
    return m.role if m else None


def require_store(s: Session, user: User, store_id: int, owner_only: bool = False) -> str:
    """Raises 404 for stores the user does not belong to (so store ids can't be probed)."""
    role = store_role(s, user, store_id)
    if role is None:
        raise AuthError(404, "Store not found")
    if owner_only and role not in ("owner", "ops"):
        raise AuthError(403, "Only the store owner can do this")
    return role


def require_ops(user: User) -> None:
    if user.role != "ops":
        raise AuthError(403, "Operations portal access only")


def store_ids(s: Session, user: User) -> list[int] | None:
    """None means all stores (operations)."""
    if user.role == "ops":
        return None
    return list(s.scalars(select(StoreMember.store_id).where(StoreMember.user_id == user.id)))


# ---------- login rate limit (per email + client, in memory; use Redis when running several instances) ----------
class RateLimiter:
    def __init__(self, limit: int = 8, window: float = 300):
        self.limit, self.window, self.hits, self.lock = limit, window, {}, threading.Lock()

    def check(self, key: str) -> None:
        now = time.monotonic()
        with self.lock:
            xs = [t for t in self.hits.get(key, []) if now - t < self.window]
            if len(xs) >= self.limit:
                self.hits[key] = xs
                raise AuthError(429, "Too many attempts — wait a few minutes and try again")
            xs.append(now)
            self.hits[key] = xs

    def reset(self, key: str) -> None:
        with self.lock:
            self.hits.pop(key, None)


# ---------- signed media URLs ----------
def _media_secret() -> bytes:
    return (os.environ.get("MEDIA_SECRET") or _FALLBACK_SECRET).encode()


_FALLBACK_SECRET = secrets.token_hex(32)  # per-process when MEDIA_SECRET isn't set (links expire on restart)


def sign_media(path: str, ttl: int | None = None) -> str:
    exp = int(time.time()) + (ttl or MEDIA_URL_TTL)
    sig = hmac.new(_media_secret(), f"{path}|{exp}".encode(), hashlib.sha256).hexdigest()[:32]
    return f"/api/media/{path}?exp={exp}&sig={sig}"


def verify_media(path: str, exp: int, sig: str) -> bool:
    if exp < time.time():
        return False
    good = hmac.new(_media_secret(), f"{path}|{exp}".encode(), hashlib.sha256).hexdigest()[:32]
    return hmac.compare_digest(good, sig)


def now() -> datetime:
    return utcnow()
