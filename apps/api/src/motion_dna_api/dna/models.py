"""Versioned, bounded output contract; all browser output is untrusted."""

from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .security import parse_url

Short = Annotated[str, Field(max_length=240)]
Confidence = Annotated[float, Field(ge=0, le=1)]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class AnalyzeInput(StrictModel):
    url: str = Field(min_length=1, max_length=2048)
    project_id: UUID

    @field_validator("url")
    @classmethod
    def valid_url(cls, value):
        try:
            return parse_url(value)
        except Exception:
            raise ValueError("Public HTTP(S) URL required") from None


class Color(StrictModel):
    value: str = Field(pattern=r"^#[0-9a-fA-F]{6}$")
    role: Literal["background", "text", "primary", "accent"]
    count: int = Field(ge=1, le=20000)
    frequency: Confidence
    confidence: Confidence


class Font(StrictModel):
    family: Short
    size: Short
    weight: Short
    count: int = Field(ge=1, le=5000)
    available: bool


class Heading(StrictModel):
    level: int = Field(ge=1, le=6)
    count: int = Field(ge=1, le=5000)
    sizes: list[Short] = Field(max_length=30)


class Typography(StrictModel):
    fonts: list[Font] = Field(max_length=60)
    headings: list[Heading] = Field(max_length=6)
    confidence: Confidence


class Region(StrictModel):
    kind: Literal["hero", "navigation", "card", "grid", "section", "button"]
    count: int = Field(ge=0, le=5000)
    confidence: Confidence


class Layout(StrictModel):
    features: list[Region] = Field(max_length=6)
    visual_density: Confidence
    sampled_elements: int = Field(ge=0, le=5000)
    confidence: Confidence


class Motion(StrictModel):
    transition: Short
    transition_duration: Short
    animation: Short
    animation_duration: Short
    timing: Short
    transform: Short
    count: int = Field(ge=1, le=5000)


class Asset(StrictModel):
    url: str = Field(max_length=2048)
    kind: Literal["logo_candidate", "hero_illustration", "visible_image"]
    width: int = Field(ge=0, le=100000)
    height: int = Field(ge=0, le=100000)
    confidence: Confidence

    @field_validator("url")
    @classmethod
    def safe_reference(cls, value):
        try:
            return parse_url(value)
        except Exception:
            raise ValueError("Invalid asset reference") from None


class Snapshot(StrictModel):
    kind: Literal["viewport", "hero"]
    path: str = Field(pattern=r"^/api/dna/results/[0-9a-f-]{36}/screenshots/(viewport|hero)$")
    width: int = Field(ge=1, le=1440)
    height: int = Field(ge=1, le=1200)


class WebsiteContent(StrictModel):
    title: str = Field(max_length=160)
    headings: list[Short] = Field(max_length=12)
    paragraphs: list[Short] = Field(max_length=12)
    ctas: list[Short] = Field(max_length=8)


class DNAResult(StrictModel):
    content: WebsiteContent | None = None
    schema_version: Literal["1.0"] = "1.0"
    analysis_id: UUID
    source_url: str = Field(max_length=2048)
    final_url: str = Field(max_length=2048)
    captured_at: datetime
    palette: list[Color] = Field(max_length=48)
    typography: Typography
    layout: Layout
    motion: list[Motion] = Field(max_length=60)
    motion_scope: Literal["computed-css-only"] = "computed-css-only"
    assets: list[Asset] = Field(max_length=60)
    screenshots: list[Snapshot] = Field(max_length=2)
    confidence: Confidence
    warnings: list[Short] = Field(max_length=20)


class Job(StrictModel):
    job_id: UUID
    status: Literal["queued", "running", "completed", "failed"]
    created_at: datetime
    analysis_id: UUID | None = None
    error: Short | None = None
    error_code: Short | None = None
