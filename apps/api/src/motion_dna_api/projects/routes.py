"""Authenticated project, asset, and storage-quota endpoints."""

import asyncio
import logging
from pathlib import Path
from uuid import UUID

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse

from motion_dna_api.auth.security import CurrentUser, check_rate_limit, verify_origin
from motion_dna_api.projects.models import ProjectCreate, ProjectUpdate
from motion_dna_api.projects.repository import DocumentError, ProjectRepository, RevisionConflict

logger = logging.getLogger("motion_dna_api.projects")
router = APIRouter(prefix="/api", tags=["projects"])


def repository(request: Request) -> ProjectRepository:
    return getattr(request.app.state, "project_repository", None) or ProjectRepository(
        request.app.state.settings
    )


def expose_document(record: dict | None):
    if not record:
        raise HTTPException(404, "Project not found.")
    return record


@router.get("/projects")
async def list_projects(request: Request, user: CurrentUser):
    projects = await asyncio.to_thread(repository(request).list, user["id"])
    return {"projects": projects}


@router.post("/projects", status_code=201)
async def create_project(payload: ProjectCreate, request: Request, user: CurrentUser):
    verify_origin(request)
    check_rate_limit(request, "project-create", 30)
    try:
        created = await asyncio.to_thread(repository(request).create, user["id"], payload.document)
        return {"project": created}
    except DocumentError as exc:
        raise HTTPException(422, str(exc)) from None
    except Exception as exc:
        logger.warning("project_create_failed", extra={"error_type": type(exc).__name__})
        raise HTTPException(
            503, "Project storage is unavailable. Start PostgreSQL and retry."
        ) from None


@router.get("/projects/{project_id}")
async def get_project(project_id: UUID, request: Request, user: CurrentUser):
    record = await asyncio.to_thread(repository(request).get, user["id"], project_id)
    return {"project": expose_document(record)}


@router.get("/projects/{project_id}/versions")
async def list_project_versions(project_id: UUID, request: Request, user: CurrentUser):
    versions = await asyncio.to_thread(repository(request).versions, user["id"], project_id)
    if versions is None:
        raise HTTPException(404, "Project not found.")
    return {"versions": versions}


@router.get("/projects/{project_id}/versions/{revision}")
async def get_project_version(project_id: UUID, revision: int, request: Request, user: CurrentUser):
    if not 1 <= revision <= 2_147_483_647:
        raise HTTPException(404, "Project version not found.")
    version = await asyncio.to_thread(repository(request).version, user["id"], project_id, revision)
    if not version:
        raise HTTPException(404, "Project version not found.")
    return {"version": version}


@router.put("/projects/{project_id}")
async def update_project(
    project_id: UUID, payload: ProjectUpdate, request: Request, user: CurrentUser
):
    verify_origin(request)
    check_rate_limit(request, "project-save", 120)
    try:
        record = await asyncio.to_thread(
            repository(request).update, user["id"], project_id, payload.revision, payload.document
        )
        return {"project": expose_document(record)}
    except RevisionConflict as exc:
        raise HTTPException(
            409, detail={"message": "This project has a newer saved version.", "latest": exc.latest}
        ) from None
    except DocumentError as exc:
        raise HTTPException(422, str(exc)) from None
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("project_save_failed", extra={"error_type": type(exc).__name__})
        raise HTTPException(
            503, "Project storage is unavailable. Your current edits are still in this tab."
        ) from None


@router.delete("/projects/{project_id}", status_code=202)
async def delete_project(project_id: UUID, request: Request, user: CurrentUser):
    verify_origin(request)
    check_rate_limit(request, "project-delete", 20)
    deleted = await asyncio.to_thread(repository(request).delete, user["id"], project_id)
    if not deleted:
        raise HTTPException(404, "Project not found.")
    return {"deleted": True, "purge_after_days": 30}


@router.get("/projects/{project_id}/assets")
async def list_project_assets(project_id: UUID, request: Request, user: CurrentUser):
    with repository(request).connect() as connection:
        owned = connection.execute(
            "SELECT 1 FROM projects WHERE id=%s AND owner_id=%s AND deleted_at IS NULL",
            (project_id, user["id"]),
        ).fetchone()
        if not owned:
            raise HTTPException(404, "Project not found.")
        rows = connection.execute(
            "SELECT id,filename,mime_type,byte_size,sha256,created_at FROM assets "
            "WHERE owner_id=%s AND project_id=%s ORDER BY created_at",
            (user["id"], project_id),
        ).fetchall()
    return {
        "assets": [
            {
                "id": str(row[0]),
                "filename": row[1],
                "mime_type": row[2],
                "byte_size": row[3],
                "sha256": row[4],
                "created_at": row[5].isoformat(),
            }
            for row in rows
        ]
    }


@router.post("/projects/{project_id}/assets", status_code=201)
async def upload_project_asset(project_id: UUID, request: Request, user: CurrentUser):
    verify_origin(request)
    check_rate_limit(request, "asset-upload", 30)
    content_type = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
    if content_type not in {"image/png", "image/jpeg", "image/webp"}:
        raise HTTPException(415, "Upload a PNG, JPEG, or WebP image.")
    filename = request.headers.get("x-file-name", "image")[:255]
    try:
        content = await request.body()
        asset = await asyncio.to_thread(
            repository(request).save_asset, user["id"], project_id, filename, content_type, content
        )
        if not asset:
            raise HTTPException(404, "Project not found.")
        return {"asset": asset}
    except DocumentError as exc:
        raise HTTPException(422, str(exc)) from None


@router.get("/projects/{project_id}/assets/{asset_id}")
async def get_project_asset(project_id: UUID, asset_id: UUID, request: Request, user: CurrentUser):
    result = await asyncio.to_thread(repository(request).asset, user["id"], project_id, asset_id)
    if not result:
        raise HTTPException(404, "Asset not found.")
    path, media_type, filename = result
    return FileResponse(
        path,
        media_type=media_type,
        filename=Path(filename).name,
        headers={
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "default-src 'none'; sandbox",
        },
    )


@router.delete("/projects/{project_id}/assets/{asset_id}", status_code=204)
async def delete_project_asset(
    project_id: UUID, asset_id: UUID, request: Request, user: CurrentUser
):
    verify_origin(request)
    deleted = await asyncio.to_thread(
        repository(request).delete_asset, user["id"], project_id, asset_id
    )
    if not deleted:
        raise HTTPException(404, "Asset not found.")


@router.get("/account/usage")
async def account_usage(request: Request, user: CurrentUser):
    return await asyncio.to_thread(repository(request).usage, user["id"])
