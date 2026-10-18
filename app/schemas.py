"""Response models. See API_CONTRACT.md (frontend) and section 10 of the case (jury)."""

from datetime import datetime
from typing import Literal, Self

from pydantic import BaseModel, Field, model_validator

from app.violation_sources import source_entry

Status = Literal["processing", "done", "failed"]


class ErrorInfo(BaseModel):
    code: str
    message: str  # shown to the user as is, in Russian


# --- What the pipeline returns -------------------------------------------------------


class EvidenceFrame(BaseModel):
    timestamp_sec: float
    image_base64: str  # JPEG, no "data:" prefix, ~50-150 KB


class SourceReference(BaseModel):
    label: str
    url: str


class Violation(BaseModel):
    code: str | None = None  # catalog code ("B1"), see frontend/src/lib/violation-catalog.ts
    type: str
    timecode_sec: float
    description: str
    evidence_frames: list[EvidenceFrame] = []
    sources: list[SourceReference] = Field(default_factory=list)
    source_note: str = ""

    @model_validator(mode="after")
    def map_catalog_sources(self) -> Self:
        entry = source_entry(self.code, self.type)
        if entry is not None:
            self.code, metadata = entry
            self.sources = [SourceReference(**source) for source in metadata["sources"]]
            self.source_note = metadata["source_note"]
        return self


class Box(BaseModel):
    # Normalized 0-1, origin top-left
    x: float
    y: float
    width: float
    height: float


class Rule(BaseModel):
    title: str
    section: str
    url: str


class AnnotationEvent(BaseModel):
    violation_index: int  # index into Analysis.violations
    start_sec: float
    end_sec: float
    box: Box
    rule: Rule | None = None
    rule_note: str = ""  # shown when rule is None


class Analysis(BaseModel):
    duration_sec: float
    violations: list[Violation] = []
    events: list[AnnotationEvent] = []


# --- API responses ---------------------------------------------------------------------


class Model(BaseModel):
    id: str
    name: str


class ModelsResponse(BaseModel):
    models: list[Model]


class JobSummary(BaseModel):
    job_id: str
    filename: str
    created_at: datetime
    model_id: str
    status: Status
    queue_position: int


class JobsResponse(BaseModel):
    jobs: list[JobSummary]


class AnalyzeResponse(BaseModel):
    job_id: str
    status: Literal["processing"] = "processing"


class JobResponse(BaseModel):
    """Serialized with exclude_none: only the fields that apply to the status are sent."""

    job_id: str
    status: Status
    queue_position: int
    verdict: Literal["violation", "no_violation"] | None = None
    violations: list[Violation] | None = None
    error: ErrorInfo | None = None


class AnnotationsResponse(BaseModel):
    duration_sec: float
    events: list[AnnotationEvent]
