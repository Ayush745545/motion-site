"""Password/session primitives shared by protected API routes."""

import hashlib
import hmac
import secrets
import threading
import time
from typing import Annotated, Any

import psycopg
from fastapi import Depends, HTTPException, Request

from motion_dna_api.config import Settings

SESSION_COOKIE = "motion_dna_session"
SESSION_DAYS = 14
_rate_lock = threading.Lock()
_rate_windows: dict[str, list[float]] = {}


def _dsn(settings: Settings) -> str:
    return settings.database_url.get_secret_value()


def password_hash(password: str, salt: bytes | None = None) -> str:
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 310_000)
    return f"pbkdf2_sha256$310000${salt.hex()}${digest.hex()}"


def verify_password(password: str, encoded: str) -> bool:
    try:
        algorithm, rounds, salt_hex, expected = encoded.split("$", 3)
        if algorithm != "pbkdf2_sha256" or int(rounds) != 310_000:
            return False
        actual = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt_hex), 310_000)
        return hmac.compare_digest(actual.hex(), expected)
    except (ValueError, TypeError):
        return False


def token_digest(token: str) -> str:
    return hashlib.sha256(token.encode("ascii")).hexdigest()


def check_rate_limit(request: Request, bucket: str, limit: int, seconds: int = 60) -> None:
    address = request.client.host if request.client else "unknown"
    key = f"{bucket}:{address}"
    now = time.monotonic()
    with _rate_lock:
        recent = [stamp for stamp in _rate_windows.get(key, []) if now - stamp < seconds]
        if len(recent) >= limit:
            raise HTTPException(429, "Too many requests. Wait a moment and try again.")
        recent.append(now)
        _rate_windows[key] = recent
        if len(_rate_windows) > 2048:
            for expired in [
                name
                for name, stamps in _rate_windows.items()
                if not stamps or now - stamps[-1] > seconds * 2
            ]:
                _rate_windows.pop(expired, None)


def verify_origin(request: Request) -> None:
    origin = request.headers.get("origin")
    if origin and origin not in request.app.state.settings.allowed_origins:
        raise HTTPException(403, "This origin is not allowed.")


def authenticated_user(request: Request) -> dict[str, Any]:
    if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
        verify_origin(request)
    return current_user(request)


CurrentUser = Annotated[dict[str, Any], Depends(authenticated_user)]


def current_user(request: Request) -> dict[str, Any]:
    token = request.cookies.get(SESSION_COOKIE)
    if not token or len(token) > 256:
        raise HTTPException(401, "Sign in to access this workspace.")
    with psycopg.connect(_dsn(request.app.state.settings), connect_timeout=3) as connection:
        row = connection.execute(
            """SELECT u.id, u.email FROM sessions s JOIN users u ON u.id=s.user_id
               WHERE s.token_hash=%s AND s.expires_at>now()""",
            (token_digest(token),),
        ).fetchone()
        if row:
            connection.execute(
                "UPDATE sessions SET last_seen_at=now() WHERE token_hash=%s", (token_digest(token),)
            )
    if not row:
        raise HTTPException(401, "Your local session has expired. Sign in again.")
    return {"id": row[0], "email": row[1]}
