"""Grounded Director input, provider plans and complete storyboards."""

from typing import Annotated, Literal

from pydantic import Field, model_validator

from motion_dna_api.dna.models import DNAResult, StrictModel

Category = Literal["saas", "ecommerce", "portfolio", "agency", "mobile", "technology"]
Style = Literal["cinematic", "saas", "typography", "technology", "walkthrough"]
Kind = Literal["intro", "reveal", "features", "cta"]
Preset = Literal["fade", "slide", "spring", "parallax"]
Transition = Literal["fade", "slide", "cut"]
Text = Annotated[str, Field(min_length=1, max_length=240)]


class Brief(StrictModel):
    content_summary: str = Field(default="", max_length=6000)
    product_category: Literal[
        "auto", "saas", "ecommerce", "portfolio", "agency", "mobile", "technology"
    ] = "auto"
    target_audience: str = Field(default="Website visitors", min_length=1, max_length=160)
    duration_seconds: int = Field(default=15, ge=8, le=60)
    motion_style: Style = "cinematic"
    aspect_ratio: Literal["landscape", "portrait"] = "landscape"
    variant: int = Field(default=0, ge=0, le=9999)


class DirectorInput(Brief):
    dna: DNAResult


class Fact(StrictModel):
    id: str = Field(pattern=r"^fact-[0-9]+$")
    text: Text
    source: Literal["website", "provided_summary"]


class PlanScene(StrictModel):
    kind: Kind
    fact_ids: list[str] = Field(max_length=3)
    duration_frames: int = Field(ge=30, le=1500)
    motion_preset: Preset
    transition: Transition


class Plan(StrictModel):
    opening_fact_id: str | None = None
    scenes: list[PlanScene] = Field(min_length=4, max_length=4)

    @model_validator(mode="after")
    def four_kinds(self):
        if {scene.kind for scene in self.scenes} != {"intro", "reveal", "features", "cta"}:
            raise ValueError("Exactly one of each scene kind is required")
        return self


class Scene(PlanScene):
    id: Kind
    description: Text
    headline: str = Field(min_length=1, max_length=100)
    visual_asset_refs: list[str] = Field(max_length=8)
    supporting_copy: list[Text] = Field(max_length=3)


class Generation(StrictModel):
    provider: Literal["deterministic", "local", "api"]
    model: Text
    requested_provider: Literal["deterministic", "local", "api"]
    requested_model: str = Field(max_length=240)
    fallback_used: bool
    fallback_reason: str | None = Field(default=None, max_length=240)
    confidence: float = Field(ge=0, le=1)
    warnings: list[Text] = Field(max_length=12)


class Storyboard(StrictModel):
    schema_version: Literal["1.0"] = "1.0"
    brief: Brief
    analysis_id: str = Field(pattern=r"^[0-9a-f-]{36}$")
    category: Category
    category_confidence: float = Field(ge=0, le=1)
    creative_concept: Text
    opening_hook: str = Field(min_length=1, max_length=100)
    scenes: list[Scene] = Field(min_length=4, max_length=4)
    cta: str = Field(min_length=1, max_length=72)
    evidence: list[Fact] = Field(max_length=24)
    generation: Generation
    fps: Literal[30] = 30
    total_frames: int = Field(ge=240, le=1800)
    edited: bool = False

    @model_validator(mode="after")
    def timeline(self):
        if {scene.kind for scene in self.scenes} != {"intro", "reveal", "features", "cta"}:
            raise ValueError("Four distinct scene kinds required")
        if any(scene.id != scene.kind for scene in self.scenes):
            raise ValueError("Stable scene IDs must match kind")
        if sum(scene.duration_frames for scene in self.scenes) != self.total_frames:
            raise ValueError("Scene frames must sum to duration")
        if self.total_frames != self.brief.duration_seconds * self.fps:
            raise ValueError("Duration mismatch")
        known = {fact.id for fact in self.evidence}
        if any(not set(scene.fact_ids) <= known for scene in self.scenes):
            raise ValueError("Unknown evidence reference")
        return self
