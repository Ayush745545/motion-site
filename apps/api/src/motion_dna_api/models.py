from typing import Literal

from pydantic import BaseModel, ConfigDict


class HealthResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["ok"] = "ok"
    service: Literal["motion-dna-ai-api"] = "motion-dna-ai-api"
    version: Literal["0.1.0"] = "0.1.0"
    environment: Literal["development", "test", "production"]


class ReadyResponse(BaseModel):
    status: Literal["ok"] = "ok"
    database: Literal["connected"] = "connected"


class ValidationIssue(BaseModel):
    location: list[str | int]
    code: str


class ErrorDetail(BaseModel):
    code: str
    message: str
    request_id: str
    details: list[ValidationIssue] | None = None


class ErrorResponse(BaseModel):
    error: ErrorDetail
