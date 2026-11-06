from fastapi import APIRouter, HTTPException, Request

from .models import DirectorInput, Storyboard
from .providers import configured_provider
from .service import direct

router = APIRouter(prefix="/api/director", tags=["director"])


@router.post("/storyboard", response_model=Storyboard)
async def storyboard(payload: DirectorInput, request: Request):
    origin = request.headers.get("origin")
    if origin and origin not in request.app.state.settings.allowed_origins:
        raise HTTPException(403)
    if request.app.state.director_active >= 2:
        raise HTTPException(429)
    request.app.state.director_active += 1
    try:
        provider = getattr(request.app.state, "director_provider", None)
        if provider is None:
            provider = configured_provider(request.app.state.settings)
        return await direct(payload, provider)
    finally:
        request.app.state.director_active -= 1
