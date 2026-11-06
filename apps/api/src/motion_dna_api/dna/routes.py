"""Small local job dispatcher; no Redis or simulated analysis."""

import asyncio
import logging
from datetime import UTC, datetime
from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse, Response

from motion_dna_api.auth.security import CurrentUser, check_rate_limit, verify_origin

from .models import AnalyzeInput, DNAResult, Job
from .repository import Repository
from .runner import run_analysis
from .security import AnalysisError, resolve_public

logger = logging.getLogger("motion_dna_api.dna")
router = APIRouter(prefix="/api/dna", tags=["dna"])


def repository(request):
    return getattr(request.app.state, "dna_repository", None) or Repository(
        request.app.state.settings.database_url.get_secret_value()
    )


def failure(request, status, code, message):
    return JSONResponse(
        status_code=status,
        content={
            "error": {
                "code": code,
                "message": message,
                "request_id": request.state.request_id,
            }
        },
    )


async def process(job, url, repo, image, owner_id, project_id):
    try:
        job.status = "running"
        await asyncio.to_thread(repo.save, job, owner_id, project_id)
        result, screenshot = await run_analysis(url, job.job_id, image)
        job.status, job.analysis_id = "completed", job.job_id
        await asyncio.to_thread(repo.save, job, owner_id, project_id, result, screenshot)
    except BaseException as exc:
        job.status = "failed"
        job.error_code = exc.code if isinstance(exc, AnalysisError) else "analysis_failed"
        job.error = (
            exc.message
            if isinstance(exc, AnalysisError)
            else "Analysis was interrupted or unavailable. Please retry."
        )
        logger.warning(
            "analysis_failed", extra={"job_id": str(job.job_id), "error_type": type(exc).__name__}
        )
        try:
            await asyncio.to_thread(repo.save, job, owner_id, project_id)
        except Exception:
            logger.error("analysis_persistence_failed", extra={"job_id": str(job.job_id)})
        if isinstance(exc, asyncio.CancelledError):
            raise


@router.post("/analyze", response_model=Job, status_code=202)
async def analyze(payload: AnalyzeInput, request: Request, user: CurrentUser):
    verify_origin(request)
    check_rate_limit(request, "dna-analyze", 12)
    tasks = request.app.state.dna_tasks
    # Reserve before DNS/database awaits to avoid concurrent admission races.
    if request.app.state.dna_admitted >= 2:
        return failure(
            request, 429, "analyzer_busy", "Two captures are already active. Try again shortly."
        )
    request.app.state.dna_admitted += 1
    dispatched = False
    try:
        await resolve_public(payload.url)
        repo = repository(request)
        job = Job(job_id=uuid4(), status="queued", created_at=datetime.now(UTC))
        created = await asyncio.to_thread(repo.create, job, user["id"], payload.project_id)
        if not created:
            raise HTTPException(404, "Project not found.")
        task = asyncio.create_task(
            process(
                job.model_copy(),
                payload.url,
                repo,
                request.app.state.settings.dna_browser_image,
                user["id"],
                payload.project_id,
            )
        )
        tasks.add(task)

        def finished(completed):
            tasks.discard(completed)
            request.app.state.dna_admitted -= 1

        task.add_done_callback(finished)
        dispatched = True
        return job
    except AnalysisError as exc:
        return failure(request, 422, exc.code, exc.message)
    except HTTPException:
        raise
    except Exception:
        return failure(
            request,
            503,
            "storage_unavailable",
            "PostgreSQL is unavailable. Start the local database and retry.",
        )
    finally:
        if not dispatched:
            request.app.state.dna_admitted -= 1


@router.get("/jobs/{job_id}", response_model=Job)
async def get_job(job_id: UUID, request: Request, user: CurrentUser):
    try:
        job = await asyncio.to_thread(repository(request).get, job_id, user["id"])
    except Exception:
        return failure(request, 503, "storage_unavailable", "Analysis storage is unavailable.")
    if not job:
        raise HTTPException(404)
    return job


@router.get("/results/{analysis_id}", response_model=DNAResult)
async def get_result(analysis_id: UUID, request: Request, user: CurrentUser):
    try:
        result = await asyncio.to_thread(repository(request).result, analysis_id, user["id"])
    except Exception:
        return failure(request, 503, "storage_unavailable", "Analysis storage is unavailable.")
    if not result:
        raise HTTPException(404)
    return result


@router.get("/results/{analysis_id}/screenshots/viewport")
async def screenshot(analysis_id: UUID, request: Request, user: CurrentUser):
    try:
        content = await asyncio.to_thread(repository(request).screenshot, analysis_id, user["id"])
    except Exception:
        return failure(request, 503, "storage_unavailable", "Analysis storage is unavailable.")
    if not content:
        raise HTTPException(404)
    return Response(
        content,
        media_type="image/png",
        headers={
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "default-src 'none'; sandbox",
        },
    )
