"""HTTP admission and inspection only; the independent worker executes renders."""

import asyncio
import logging
from uuid import UUID

from fastapi import APIRouter, Request
from fastapi.responses import FileResponse, JSONResponse

from motion_dna_api.auth.security import CurrentUser, check_rate_limit, verify_origin

from .models import ProjectAction, RenderRequest
from .repository import RenderConflict, Repository

logger = logging.getLogger("motion_dna_api.renders")
router = APIRouter(prefix="/api/render/jobs", tags=["render"])


def repository(request):
    return getattr(request.app.state, "render_repository", None) or Repository(
        request.app.state.settings
    )


def failure(request, status, code, message):
    return JSONResponse(
        status_code=status,
        content={
            "error": {"code": code, "message": message, "request_id": request.state.request_id}
        },
        headers={"Cache-Control": "no-store"},
    )


def denied_origin(request):
    origin = request.headers.get("origin")
    return origin and origin not in request.app.state.settings.allowed_origins


def job_response(job, status=200, headers=None):
    return JSONResponse(
        status_code=status,
        content=job.model_dump(mode="json", exclude_none=True),
        headers={"Cache-Control": "no-store", **(headers or {})},
    )


@router.post("")
async def create(payload: RenderRequest, request: Request, user: CurrentUser):
    verify_origin(request)
    check_rate_limit(request, "render-create", 12)
    try:
        job, replayed = await asyncio.to_thread(repository(request).create, payload, user["id"])
        return job_response(job, 202, {"Idempotent-Replayed": str(replayed).lower()})
    except RenderConflict as exc:
        status = 404 if exc.code == "project_not_found" else 409
        return failure(request, status, exc.code, exc.message)
    except Exception as exc:
        logger.warning("render_admission_failed", extra={"error_type": type(exc).__name__})
        return failure(
            request,
            503,
            "storage_unavailable",
            "Render storage is unavailable. Start PostgreSQL and retry.",
        )


@router.get("")
async def jobs(request: Request, user: CurrentUser):
    try:
        result = await asyncio.to_thread(repository(request).list, user["id"])
        return JSONResponse(
            content={"jobs": [job.model_dump(mode="json", exclude_none=True) for job in result]},
            headers={"Cache-Control": "no-store"},
        )
    except Exception:
        return failure(request, 503, "storage_unavailable", "Render storage is unavailable.")


@router.get("/{identifier}")
async def get_job(identifier: UUID, request: Request, user: CurrentUser):
    try:
        job = await asyncio.to_thread(repository(request).get, identifier, user["id"])
        return (
            job_response(job)
            if job
            else failure(request, 404, "not_found", "Render job not found.")
        )
    except Exception:
        return failure(request, 503, "storage_unavailable", "Render storage is unavailable.")


@router.post("/{identifier}/cancel")
async def cancel(identifier: UUID, payload: ProjectAction, request: Request, user: CurrentUser):
    verify_origin(request)
    check_rate_limit(request, "render-control", 60)
    try:
        job = await asyncio.to_thread(
            repository(request).request_cancel, identifier, payload.project_id, user["id"]
        )
        return (
            job_response(job)
            if job
            else failure(request, 404, "not_found", "Render job not found for this project.")
        )
    except Exception:
        return failure(request, 503, "storage_unavailable", "Render storage is unavailable.")


@router.post("/{identifier}/retry")
async def retry(identifier: UUID, payload: ProjectAction, request: Request, user: CurrentUser):
    verify_origin(request)
    check_rate_limit(request, "render-control", 60)
    try:
        job = await asyncio.to_thread(
            repository(request).retry, identifier, payload.project_id, user["id"]
        )
        return (
            job_response(job, 202)
            if job
            else failure(request, 404, "not_found", "Render job not found for this project.")
        )
    except RenderConflict as exc:
        return failure(request, 409, exc.code, exc.message)
    except Exception:
        return failure(request, 503, "storage_unavailable", "Render storage is unavailable.")


@router.get("/{identifier}/download")
async def download(identifier: UUID, project_id: UUID, request: Request, user: CurrentUser):
    try:
        repo = repository(request)
        record = await asyncio.to_thread(repo.download_path, identifier, user["id"], project_id)
        if not record:
            return failure(
                request, 404, "not_ready", "A completed export was not found for this project."
            )
        job, file = record
        if job.status != "completed" or not job.output:
            return failure(
                request, 404, "not_ready", "A completed export was not found for this project."
            )
        return FileResponse(
            file,
            media_type="video/mp4",
            filename=f"motion-dna-{job.id}.mp4",
            headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"},
        )
    except Exception:
        return failure(request, 503, "storage_unavailable", "The completed export is unavailable.")


@router.delete("/{identifier}/export")
async def delete_export(identifier: UUID, project_id: UUID, request: Request, user: CurrentUser):
    verify_origin(request)
    check_rate_limit(request, "export-delete", 30)
    try:
        deleted = await asyncio.to_thread(
            repository(request).delete_export, identifier, project_id, user["id"]
        )
        return (
            {"deleted": True}
            if deleted
            else failure(request, 404, "not_found", "Export not found for this project.")
        )
    except Exception:
        return failure(request, 503, "storage_unavailable", "Export storage is unavailable.")
