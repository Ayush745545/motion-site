"""Versioned, bounded source-code DNA output contract."""

from typing import Annotated, Literal

from pydantic import Field

from motion_dna_api.dna.models import StrictModel

Text = Annotated[str, Field(min_length=1, max_length=240)]
Confidence = Annotated[float, Field(ge=0, le=1)]


class Evidence(StrictModel):
    path: str = Field(min_length=1, max_length=240)
    claim: Text
    confidence: Confidence


class Technology(StrictModel):
    name: Text
    version: str = Field(max_length=80)
    evidence: str = Field(min_length=1, max_length=240)
    confidence: Confidence


class Dependency(StrictModel):
    name: str = Field(min_length=1, max_length=120)
    version: str = Field(max_length=80)
    group: Literal["runtime", "development"]


class ThemeToken(StrictModel):
    name: str = Field(min_length=1, max_length=120)
    value: str = Field(min_length=1, max_length=120)
    kind: Literal["color", "font", "spacing", "radius"]
    evidence: str = Field(min_length=1, max_length=240)


class Component(StrictModel):
    path: str = Field(min_length=1, max_length=240)
    exports: list[str] = Field(max_length=16)


class Route(StrictModel):
    path: str = Field(min_length=1, max_length=180)
    kind: Literal["page", "api"]
    evidence: str = Field(min_length=1, max_length=240)


class StaticAsset(StrictModel):
    path: str = Field(min_length=1, max_length=240)
    kind: Literal["logo_candidate", "image"]
    available_for_render: Literal[False] = False
    reason: str = Field(max_length=180)


class MotionOpportunity(StrictModel):
    suggestion: Text
    evidence: list[str] = Field(max_length=8)
    confidence: Confidence


class StoryScene(StrictModel):
    id: Literal["intro", "reveal", "features", "cta"]
    headline: Text
    description: Text
    motion_preset: Literal["fade", "slide", "spring", "parallax"]
    evidence: list[str] = Field(max_length=8)
    visual_assets: list[str] = Field(max_length=8)
    visual_assets_available: Literal[False] = False


class SourceStoryboard(StrictModel):
    creative_concept: Text
    opening_hook: Text
    scenes: list[StoryScene] = Field(min_length=4, max_length=4)
    cta: Text
    confidence: Confidence
    fallback_used: Literal[True] = True
    model: Literal["static-rules-v1"] = "static-rules-v1"


class SourceDNA(StrictModel):
    schema_version: Literal["1.0"] = "1.0"
    source_type: Literal["zip", "github", "local_directory", "source_file"]
    source_name: str = Field(min_length=1, max_length=180)
    analyzed_at: str = Field(min_length=1, max_length=40)
    technology_fingerprint: list[Technology] = Field(max_length=24)
    dependencies: list[Dependency] = Field(max_length=120)
    styling_systems: list[Technology] = Field(max_length=16)
    theme_tokens: list[ThemeToken] = Field(max_length=100)
    ui_components: list[Component] = Field(max_length=80)
    animation_libraries: list[Technology] = Field(max_length=20)
    routes: list[Route] = Field(max_length=120)
    readme_summary: str = Field(max_length=600)
    product_summary: str = Field(max_length=600)
    summary_evidence: list[Evidence] = Field(max_length=12)
    product_category: Literal["saas", "ecommerce", "portfolio", "agency", "mobile", "technology"]
    category_confidence: Confidence
    motion_opportunities: list[MotionOpportunity] = Field(max_length=12)
    assets: list[StaticAsset] = Field(max_length=80)
    storyboard: SourceStoryboard
    confidence: Confidence
    warnings: list[str] = Field(max_length=16)
