"""HTTP boundary for ZIP, GitHub URL, and bounded single-file inspection."""

import asyncio
import json
import logging
from pathlib import PurePosixPath

from fastapi import APIRouter, HTTPException, Request
from pydantic import Field, ValidationError

from motion_dna_api.dna.models import StrictModel

from .archive import MAX_ARCHIVE_BYTES, SourceInputError
from .github import download_with_timeout, parse_github_url
from .models import SourceDNA
from .service import MAX_FILE_BYTES, analyze_files, analyze_zip

logger = logging.getLogger("motion_dna_api.source")
router = APIRouter(prefix="/api/source", tags=["source"])


class GitHubInput(StrictModel):
    github_url: str = Field(min_length=1, max_length=2048)


class SourceFileInput(StrictModel):
    source_name: str = Field(min_length=1, max_length=180)
    source: str = Field(min_length=1, max_length=MAX_FILE_BYTES)


def _origin_allowed(request: Request):
    origin = request.headers.get("origin")
    if origin and origin not in request.app.state.settings.allowed_origins:
        raise HTTPException(403, "This origin is not allowed.")


async def _reserve(request: Request):
    if request.app.state.source_active >= 2:
        raise HTTPException(429, "Two source analyses are already active. Try again shortly.")
    request.app.state.source_active += 1


@router.post("/analyze", response_model=SourceDNA)
async def analyze(request: Request):
    _origin_allowed(request)
    await _reserve(request)
    try:
        content_type = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
        body = await request.body()
        if content_type == "application/zip" or content_type == "application/x-zip-compressed":
            if len(body) > MAX_ARCHIVE_BYTES:
                raise HTTPException(413, "Choose a ZIP archive smaller than 20 MB.")
            filename = request.headers.get("x-source-filename", "Source project.zip")[:255]
            source_name = PurePosixPath(filename.replace("\\", "/")).name.removesuffix(".zip")[:180]
            return await asyncio.to_thread(
                analyze_zip, body, source_name or "Source project", "zip"
            )
        if content_type != "application/json":
            raise HTTPException(
                415, "Use an application/zip upload or a JSON GitHub/source-file request."
            )
        try:
            value = json.loads(body)
        except (ValueError, UnicodeDecodeError):
            raise HTTPException(422, "Invalid source analysis request.") from None
        if not isinstance(value, dict):
            raise HTTPException(422, "Invalid source analysis request.")
        if set(value) == {"github_url"}:
            payload = GitHubInput.model_validate(value)
            parse_github_url(payload.github_url)
            fetcher = getattr(request.app.state, "source_github_fetcher", download_with_timeout)
            archive, source_name = await fetcher(payload.github_url)
            return await asyncio.to_thread(analyze_zip, archive, source_name, "github")
        if set(value) == {"source_name", "source"}:
            payload = SourceFileInput.model_validate(value)
            encoded = payload.source.encode("utf-8")
            if len(encoded) > MAX_FILE_BYTES:
                raise HTTPException(413, "A source file must be no larger than 2 MB.")
            name = PurePosixPath(payload.source_name.replace("\\", "/")).name
            extension = PurePosixPath(name).suffix.casefold()
            from .service import SOURCE_EXTENSIONS, _source_path

            if extension not in SOURCE_EXTENSIONS or not _source_path(name):
                raise HTTPException(422, "Choose a supported, non-secret source file.")
            return await asyncio.to_thread(analyze_files, {name: encoded}, "source_file", name)
        raise HTTPException(422, "Provide a GitHub repository URL or one supported source file.")
    except SourceInputError as exc:
        raise HTTPException(422, str(exc)) from None
    except ValidationError as exc:
        raise HTTPException(422, "The source analysis request is invalid.") from exc
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("source_analysis_failed", extra={"error_type": type(exc).__name__})
        raise HTTPException(
            503, "Source analysis is unavailable. Retry with a ZIP archive."
        ) from None
    finally:
        request.app.state.source_active -= 1
