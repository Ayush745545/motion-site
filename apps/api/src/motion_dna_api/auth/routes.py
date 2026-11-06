"""Cookie-based local registration and session management."""

import re
import secrets
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import psycopg
from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator

from .security import (
    SESSION_COOKIE,
    SESSION_DAYS,
    CurrentUser,
    check_rate_limit,
    password_hash,
    token_digest,
    verify_origin,
    verify_password,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])
EMAIL = re.compile(r"^[^\s@]{1,64}@[^\s@.]+(?:\.[^\s@.]+)+$")


class Credentials(BaseModel):
    model_config = ConfigDict(extra="forbid")
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=12, max_length=128)

    @field_validator("email")
    @classmethod
    def email_format(cls, value: str) -> str:
        normalized = value.strip().lower()
        if not EMAIL.fullmatch(normalized):
            raise ValueError("Enter a valid email address.")
        return normalized


def _issue_session(request: Request, response: Response, user_id, email: str):
    token = secrets.token_urlsafe(48)
    dsn = request.app.state.settings.database_url.get_secret_value()
    expires = datetime.now(UTC) + timedelta(days=SESSION_DAYS)
    with psycopg.connect(dsn, connect_timeout=3) as connection:
        connection.execute("DELETE FROM sessions WHERE expires_at <= now()")
        connection.execute(
            "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES (%s,%s,%s)",
            (token_digest(token), user_id, expires),
        )
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=SESSION_DAYS * 24 * 60 * 60,
        httponly=True,
        secure=request.app.state.settings.app_env == "production",
        samesite="lax",
        path="/",
    )
    response.headers["Cache-Control"] = "no-store"
    return {"user": {"id": str(user_id), "email": email}}


@router.post("/register", status_code=201)
def register(payload: Credentials, request: Request, response: Response):
    verify_origin(request)
    check_rate_limit(request, "auth", 8)
    user_id = uuid4()
    try:
        with psycopg.connect(
            request.app.state.settings.database_url.get_secret_value(), connect_timeout=3
        ) as connection:
            connection.execute(
                "INSERT INTO users(id,email,password_hash) VALUES (%s,%s,%s)",
                (user_id, payload.email, password_hash(payload.password)),
            )
    except psycopg.errors.UniqueViolation:
        raise HTTPException(409, "An account with this email already exists.") from None
    return _issue_session(request, response, user_id, payload.email)


@router.post("/login")
def login(payload: Credentials, request: Request, response: Response):
    verify_origin(request)
    check_rate_limit(request, "auth", 12)
    with psycopg.connect(
        request.app.state.settings.database_url.get_secret_value(), connect_timeout=3
    ) as connection:
        row = connection.execute(
            "SELECT id,email,password_hash FROM users WHERE email=%s", (payload.email,)
        ).fetchone()
    if not row or not verify_password(payload.password, row[2]):
        raise HTTPException(401, "Email or password is incorrect.")
    return _issue_session(request, response, row[0], row[1])


@router.get("/session")
def session(user: CurrentUser):
    return {"user": {"id": str(user["id"]), "email": user["email"]}}


@router.post("/logout", status_code=204)
def logout(request: Request, response: Response):
    verify_origin(request)
    token = request.cookies.get(SESSION_COOKIE)
    if token and len(token) <= 256:
        with psycopg.connect(
            request.app.state.settings.database_url.get_secret_value(), connect_timeout=3
        ) as connection:
            connection.execute("DELETE FROM sessions WHERE token_hash=%s", (token_digest(token),))
    response.delete_cookie(SESSION_COOKIE, path="/", httponly=True, samesite="lax")
    response.headers["Cache-Control"] = "no-store"
    return response
