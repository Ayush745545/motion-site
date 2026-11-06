"""Validate both rendering compositions before admitting them to the queue."""

import base64
import math
import re
from datetime import datetime
from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from motion_dna_api.director.models import Storyboard


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


Identifier = Annotated[str, Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$")]
Color = Annotated[str, Field(pattern=r"^#[0-9a-fA-F]{6}$")]
Frame = Annotated[int, Field(ge=0, le=21600, strict=True)]


def validate_raster(source: str) -> str:
    match = re.fullmatch(r"data:image/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})", source)
    if not match or len(source) > 2_800_000:
        raise ValueError("Use bounded inline PNG, JPEG or WebP assets.")
    try:
        data = base64.b64decode(match[2], validate=True)
    except ValueError:
        raise ValueError("Invalid raster encoding.") from None
    if len(data) > 2 * 1024 * 1024:
        raise ValueError("Images must be 2 MB or smaller.")
    width, height = 0, 0
    if match[1] == "png" and len(data) >= 33 and data[:8] == b"\x89PNG\r\n\x1a\n":
        if data[12:16] == b"IHDR":
            width, height = int.from_bytes(data[16:20]), int.from_bytes(data[20:24])
    elif match[1] == "jpeg" and data[:2] == b"\xff\xd8":
        offset = 2
        while offset + 3 < len(data):
            if data[offset] != 255:
                break
            offset += 1
            while offset < len(data) and data[offset] == 255:
                offset += 1
            if offset >= len(data):
                break
            marker, offset = data[offset], offset + 1
            if marker in {0xDA, 0xD9} or offset + 2 > len(data):
                break
            size = int.from_bytes(data[offset : offset + 2])
            if size < 2 or offset + size > len(data):
                break
            if (
                marker
                in {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF}
                and size >= 8
            ):
                height = int.from_bytes(data[offset + 3 : offset + 5])
                width = int.from_bytes(data[offset + 5 : offset + 7])
                break
            offset += size
    elif match[1] == "webp" and len(data) >= 30 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        kind = data[12:16]
        if kind == b"VP8X":
            width = int.from_bytes(data[24:27], "little") + 1
            height = int.from_bytes(data[27:30], "little") + 1
        elif kind == b"VP8L" and data[20] == 0x2F:
            bits = int.from_bytes(data[21:25], "little")
            width, height = (bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1
        elif kind == b"VP8 " and data[23:26] == b"\x9d\x01\x2a":
            width = int.from_bytes(data[26:28], "little") & 0x3FFF
            height = int.from_bytes(data[28:30], "little") & 0x3FFF
    if not 0 < width <= 4096 or not 0 < height <= 4096:
        raise ValueError("Use valid raster images up to 4096 pixels per side.")
    return source


class Composition(StrictModel):
    width: Annotated[int, Field(ge=320, le=1920, multiple_of=2, strict=True)]
    height: Annotated[int, Field(ge=320, le=1920, multiple_of=2, strict=True)]
    fps: Literal[24, 30, 60]


class Transition(StrictModel):
    preset: Literal["cut", "fade", "slide"]
    durationInFrames: Annotated[int, Field(ge=0, le=120, strict=True)]


class Scene(StrictModel):
    id: Identifier
    name: Annotated[str, Field(min_length=1, max_length=100)]
    durationInFrames: Annotated[int, Field(ge=1, le=1800, strict=True)]
    background: Color
    transition: Transition

    @model_validator(mode="after")
    def transition_fits(self):
        if self.transition.durationInFrames > self.durationInFrames // 2:
            raise ValueError("Transitions must fit within half a scene.")
        return self


BOUNDS = {
    "x": (-7680, 7680),
    "y": (-7680, 7680),
    "scale": (0.05, 8),
    "rotation": (-3600, 3600),
    "opacity": (0, 1),
}


class Keyframe(StrictModel):
    id: Identifier
    property: Literal["x", "y", "scale", "rotation", "opacity"]
    frame: Frame
    value: float
    easing: Literal["linear", "ease-in-out"]

    @model_validator(mode="after")
    def value_bounds(self):
        low, high = BOUNDS[self.property]
        if not low <= self.value <= high:
            raise ValueError("Keyframe value exceeds property bounds.")
        return self


class Animation(StrictModel):
    preset: Literal["none", "fade", "slide", "scale"]
    durationInFrames: Annotated[int, Field(ge=0, le=120, strict=True)]


class Layer(StrictModel):
    id: Identifier
    sceneId: Identifier
    name: Annotated[str, Field(min_length=1, max_length=100)]
    from_: Frame = Field(alias="from")
    durationInFrames: Annotated[int, Field(ge=1, le=1800, strict=True)]
    x: Annotated[float, Field(ge=-7680, le=7680)]
    y: Annotated[float, Field(ge=-7680, le=7680)]
    width: Annotated[float, Field(ge=8, le=3840)]
    height: Annotated[float, Field(ge=8, le=3840)]
    scale: Annotated[float, Field(ge=0.05, le=8)]
    rotation: Annotated[float, Field(ge=-3600, le=3600)]
    opacity: Annotated[float, Field(ge=0, le=1)]
    animation: Animation
    keyframes: Annotated[list[Keyframe], Field(max_length=200)]


class TextLayer(Layer):
    type: Literal["text"]
    text: Annotated[str, Field(max_length=2000)]
    fontFamily: Literal["sans", "serif", "mono"]
    fontSize: Annotated[float, Field(ge=8, le=300)]
    fontWeight: Literal[400, 700]
    color: Color
    align: Literal["left", "center", "right"]


class ImageLayer(Layer):
    type: Literal["image"]
    assetId: Identifier
    fit: Literal["contain", "cover"]


class Asset(StrictModel):
    id: Identifier
    name: Annotated[str, Field(min_length=1, max_length=255)]
    src: Annotated[str, Field(max_length=2_800_000)]
    storageAssetId: UUID | None = None

    @field_validator("src")
    @classmethod
    def raster(cls, value):
        return validate_raster(value)


class Export(StrictModel):
    codec: Literal["h264"]
    crf: Literal[18]
    pixelFormat: Literal["yuv420p"]


class ProjectDocument(StrictModel):
    schemaVersion: Literal["1.0"]
    composition: Composition
    scenes: Annotated[list[Scene], Field(min_length=1, max_length=12)]
    layers: Annotated[
        list[Annotated[TextLayer | ImageLayer, Field(discriminator="type")]], Field(max_length=100)
    ]
    assets: Annotated[list[Asset], Field(max_length=20)]
    export: Export

    @model_validator(mode="after")
    def references_and_timing(self):
        ids = [scene.id for scene in self.scenes] + [asset.id for asset in self.assets]
        scenes = {scene.id: scene for scene in self.scenes}
        assets = {asset.id for asset in self.assets}
        for layer in self.layers:
            ids.append(layer.id)
            scene = scenes.get(layer.sceneId)
            if not scene or layer.from_ + layer.durationInFrames > scene.durationInFrames:
                raise ValueError("Layer timing and scene references must be valid.")
            if layer.animation.durationInFrames > layer.durationInFrames:
                raise ValueError("Animation exceeds layer duration.")
            if isinstance(layer, ImageLayer) and layer.assetId not in assets:
                raise ValueError("Unknown asset reference.")
            positions = set()
            for key in layer.keyframes:
                ids.append(key.id)
                position = (key.property, key.frame)
                if key.frame >= layer.durationInFrames or position in positions:
                    raise ValueError("Invalid or repeated keyframe timing.")
                positions.add(position)
        if len(ids) != len(set(ids)):
            raise ValueError("Project IDs must be unique.")
        if sum(scene.durationInFrames for scene in self.scenes) > 21600:
            raise ValueError("Project frame limit exceeded.")
        if sum(len(asset.src) for asset in self.assets) > 2_800_000:
            raise ValueError("Project asset budget exceeded.")
        return self


class Brand(StrictModel):
    background: Color
    foreground: Color
    accent: Color
    font: Literal["sans", "serif", "mono"]
    fontWeight: Literal[400, 700]
    entranceFrames: Annotated[int, Field(ge=8, le=36, strict=True)]
    travel: Annotated[float, Field(ge=12, le=100)]
    damping: Annotated[float, Field(ge=14, le=30)]


class Feature(StrictModel):
    title: Annotated[str, Field(min_length=1, max_length=40)]
    description: Annotated[str, Field(min_length=1, max_length=96)]


class MotionInput(StrictModel):
    brandName: Annotated[str, Field(min_length=1, max_length=32)]
    tagline: Annotated[str, Field(min_length=1, max_length=100)]
    features: Annotated[list[Feature], Field(min_length=3, max_length=3)]
    cta: Annotated[str, Field(min_length=1, max_length=72)]
    website: Annotated[str, Field(min_length=1, max_length=90)]
    template: Literal["cinematic", "saas", "typography", "technology", "walkthrough"]
    format: Literal["landscape", "portrait"]
    brand: Brand
    screenshot: Annotated[str, Field(max_length=2_800_000)]
    provenance: Literal["sample", "analysis"]
    storyboard: Storyboard | None = None

    @field_validator("screenshot")
    @classmethod
    def screenshot_safe(cls, value):
        if value != "sample":
            if not value.startswith("data:image/png;"):
                raise ValueError("Use a PNG capture.")
            validate_raster(value)
        return value


class TimelineInput(StrictModel):
    document: ProjectDocument


class OutputSettings(StrictModel):
    quality: Literal["720p", "1080p"]
    aspect_ratio: Literal["16:9", "9:16"]
    fps: Literal[24, 30, 60]

    @property
    def dimensions(self):
        wide, short = (1280, 720) if self.quality == "720p" else (1920, 1080)
        return (wide, short) if self.aspect_ratio == "16:9" else (short, wide)


class RenderRequest(StrictModel):
    project_id: UUID
    project_name: Annotated[str, Field(min_length=1, max_length=200)]
    idempotency_key: Annotated[str, Field(pattern=r"^[A-Za-z0-9_-]{8,100}$")]
    input: dict[str, Any]
    output: OutputSettings

    @field_validator("input")
    @classmethod
    def validated_input(cls, value):
        model = (
            TimelineInput.model_validate(value)
            if "document" in value
            else MotionInput.model_validate(value)
        )
        return model.model_dump(mode="json", by_alias=True, exclude_none=True)

    @property
    def duration_seconds(self):
        if "document" in self.input:
            document = self.input["document"]
            return (
                sum(scene["durationInFrames"] for scene in document["scenes"])
                / document["composition"]["fps"]
            )
        return self.input.get("storyboard", {}).get("total_frames", 450) / 30

    @property
    def expected_frames(self):
        return max(1, math.floor(self.duration_seconds * self.output.fps + 0.5))

    @model_validator(mode="after")
    def output_budget(self):
        if self.expected_frames > 21600:
            raise ValueError("Export exceeds the 21,600 frame limit.")
        return self


class OutputMetadata(StrictModel):
    width: Annotated[int, Field(gt=0, le=1920)]
    height: Annotated[int, Field(gt=0, le=1920)]
    fps: Literal[24, 30, 60]
    duration: Annotated[float, Field(gt=0, le=900)]
    frames: Annotated[int, Field(gt=0, le=21600)]
    codec: Literal["h264"] = "h264"
    bytes: Annotated[int, Field(gt=0)] | None = None


class RenderJob(StrictModel):
    id: UUID
    project_id: UUID
    project_name: str
    status: Literal[
        "queued", "running", "retrying", "cancelling", "cancelled", "completed", "failed"
    ]
    progress: Annotated[float, Field(ge=0, le=100)] = 0
    stage: str
    created_at: datetime
    updated_at: datetime
    attempt: int = 0
    max_attempts: Literal[2] = 2
    error: str | None = None
    error_code: str | None = None
    exit_code: int | None = None
    output: OutputMetadata | None = None
    download_url: str | None = None
    export_available: bool = False


class ProjectAction(StrictModel):
    project_id: UUID
