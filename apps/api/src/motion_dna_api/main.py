"""Application assembly, request logging and transport error handling."""

import asyncio
import logging
import re
import time
from contextlib import asynccontextmanager
from typing import Annotated
from uuid import uuid4

from fastapi import Depends, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException

from motion_dna_api import __version__
from motion_dna_api.auth.routes import router as auth_router
from motion_dna_api.config import Settings
from motion_dna_api.database import DatabaseProbe, apply_migrations, get_database_probe
from motion_dna_api.director.routes import router as director_router
from motion_dna_api.dna.routes import router as dna_router
from motion_dna_api.logging import configure_logging
from motion_dna_api.models import (
    ErrorDetail,
    ErrorResponse,
    HealthResponse,
    ReadyResponse,
    ValidationIssue,
)
from motion_dna_api.projects.routes import router as projects_router
from motion_dna_api.renders.routes import router as render_router
from motion_dna_api.source.routes import router as source_router

logger = logging.getLogger("motion_dna_api.requests")
REQUEST_ID_PATTERN = re.compile(r"^[a-zA-Z0-9_.-]{1,64}$")


def error_response(
    request: Request,
    status_code: int,
    code: str,
    message: str,
    details: list[ValidationIssue] | None = None,
) -> JSONResponse:
    payload = ErrorResponse(
        error=ErrorDetail(
            code=code,
            message=message,
            request_id=request.state.request_id,
            details=details,
        )
    )
    return JSONResponse(status_code=status_code, content=payload.model_dump(exclude_none=True))


def create_app(settings: Settings | None = None) -> FastAPI:
    config = settings if settings is not None else Settings()
    configure_logging(config.log_level)

    @asynccontextmanager
    async def lifespan(application):
        if config.app_env != "test":
            await asyncio.to_thread(apply_migrations, config)
        yield
        for task in list(application.state.dna_tasks):
            task.cancel()
        await asyncio.gather(*application.state.dna_tasks, return_exceptions=True)

    application = FastAPI(title="Motion DNA AI API", version=__version__, lifespan=lifespan)
    application.state.dna_tasks = set()
    application.state.director_active = 0
    application.state.source_active = 0
    application.include_router(director_router)
    application.include_router(auth_router)
    application.include_router(projects_router)
    application.state.dna_admitted = 0
    application.include_router(dna_router)
    application.include_router(render_router)
    application.include_router(source_router)
    application.state.settings = config

    @application.middleware("http")
    async def request_context(request: Request, call_next):
        candidate = request.headers.get("x-request-id", "")
        request.state.request_id = (
            candidate if REQUEST_ID_PATTERN.fullmatch(candidate) else uuid4().hex
        )
        started = time.perf_counter()
        if request.method in {"POST", "PUT", "DELETE"} and (
            request.url.path
            in {
                "/api/dna/analyze",
                "/api/director/storyboard",
                "/api/source/analyze",
            }
            or request.url.path.startswith("/api/render/jobs")
            or request.url.path.startswith("/api/projects")
            or request.url.path.startswith("/api/auth")
        ):
            if request.url.path == "/api/source/analyze":
                limit = 20 * 1024 * 1024
            elif request.url.path == "/api/render/jobs":
                limit = 2_950_000
            elif "/assets" in request.url.path:
                limit = 10 * 1024 * 1024
            elif request.url.path.startswith("/api/projects"):
                limit = 4 * 1024 * 1024
            elif request.url.path.startswith("/api/auth"):
                limit = 4_096
            elif request.url.path.startswith("/api/director/"):
                limit = 131_072
            else:
                limit = 4_096
            chunks, size = [], 0
            async for chunk in request.stream():
                size += len(chunk)
                if size > limit:
                    response = error_response(
                        request,
                        413,
                        "request_too_large",
                        "The request exceeds the endpoint body limit.",
                    )
                    response.headers["X-Request-ID"] = request.state.request_id
                    logger.warning(
                        "request_too_large", extra={"request_id": request.state.request_id}
                    )
                    return response
                chunks.append(chunk)
            # Starlette's cached request replays this bounded body to the route parser.
            request._body = b"".join(chunks)
        try:
            response = await call_next(request)
        except Exception as exc:
            logger.error(
                "request_failed",
                extra={"request_id": request.state.request_id, "error_type": type(exc).__name__},
            )
            response = error_response(
                request, 500, "internal_error", "An unexpected error occurred."
            )
        response.headers["X-Request-ID"] = request.state.request_id
        logger.info(
            "request_completed",
            extra={
                "request_id": request.state.request_id,
                "method": request.method,
                "path": request.url.path,
                "status_code": response.status_code,
                "duration_ms": round((time.perf_counter() - started) * 1000, 2),
            },
        )
        return response

    # Outermost CORS also decorates sanitized error responses from the middleware.
    application.add_middleware(
        CORSMiddleware,
        allow_origins=config.allowed_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "DELETE"],
        allow_headers=["Content-Type", "X-Request-ID"],
        expose_headers=["X-Request-ID"],
    )

    @application.exception_handler(HTTPException)
    async def http_error(request: Request, exc: HTTPException) -> JSONResponse:
        code, message = {
            401: ("authentication_required", "Sign in to access this workspace."),
            403: ("forbidden", "This request is not allowed."),
            404: ("not_found", "The requested resource was not found."),
            409: (
                "conflict",
                "This project changed in another session. Reload it before saving again.",
            ),
            405: ("method_not_allowed", "This method is not allowed."),
            413: ("request_too_large", "The request exceeds the endpoint body limit."),
            415: ("unsupported_media_type", "The file format is not supported."),
            422: ("invalid_input", "The request input is invalid."),
            429: ("rate_limited", "Too many requests. Wait a moment and try again."),
            503: ("storage_unavailable", "The local service is unavailable."),
        }.get(exc.status_code, ("http_error", "The request could not be completed."))
        if isinstance(exc.detail, str) and len(exc.detail) <= 500:
            message = exc.detail
        response = error_response(request, exc.status_code, code, message)
        if exc.headers:
            response.headers.update(exc.headers)
        return response

    @application.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
        issues = [
            ValidationIssue(location=list(error["loc"]), code=error["type"])
            for error in exc.errors()
        ]
        return error_response(request, 422, "validation_error", "Invalid request input.", issues)

    @application.get("/api/health", response_model=HealthResponse, tags=["system"])
    def health() -> HealthResponse:
        return HealthResponse(environment=config.app_env)

    @application.get(
        "/api/ready",
        response_model=ReadyResponse,
        responses={503: {"model": ErrorResponse}},
        tags=["system"],
    )
    def ready(
        request: Request, probe: Annotated[DatabaseProbe, Depends(get_database_probe)]
    ) -> ReadyResponse | JSONResponse:
        try:
            connected = probe()
        except Exception as exc:
            logger.warning(
                "database_unavailable",
                extra={"request_id": request.state.request_id, "error_type": type(exc).__name__},
            )
            connected = False
        if not connected:
            return error_response(
                request, 503, "database_unavailable", "PostgreSQL is unavailable."
            )
        return ReadyResponse()

    return application


app = create_app()
