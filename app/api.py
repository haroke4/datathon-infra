import shutil
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, Form, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from app.config import settings
from app.db import Job, JobStatus, get_session
from app.errors import ApiError
from app.pipeline import MODELS
from app.schemas import (
    AnalyzeResponse,
    AnnotationsResponse,
    ErrorInfo,
    JobResponse,
    JobsResponse,
    JobSummary,
    Model,
    ModelsResponse,
)
from app.worker import enqueue

VIDEO_TYPES = {".mov": "video/quicktime", ".mp4": "video/mp4", ".webm": "video/webm"}
ACTIVE = (JobStatus.QUEUED, JobStatus.PROCESSING)
HISTORY_LIMIT = 200

# No auth: the service has a single, shared user.
router = APIRouter(prefix="/api/v1")
SessionDep = Annotated[AsyncSession, Depends(get_session)]


def _api_status(status: str) -> str:
    return "processing" if status in ACTIVE else status


def _utc(dt: datetime) -> datetime:
    return dt.replace(tzinfo=UTC) if dt.tzinfo is None else dt  # SQLite drops the timezone


async def _get_job(session: AsyncSession, job_id: str) -> Job:
    job = await session.get(Job, job_id)
    if job is None:
        raise ApiError(404, "JOB_NOT_FOUND", "Проверка не найдена.")
    return job


@router.get("/models")
async def list_models() -> ModelsResponse:
    return ModelsResponse(models=[Model(id=id, name=name) for id, name in MODELS.items()])


@router.get("/jobs")
async def list_jobs(session: SessionDep) -> JobsResponse:
    # queue_position = active jobs ahead in FIFO order; the running one is 0.
    active = await session.execute(
        select(Job.id, Job.status).where(Job.status.in_(ACTIVE)).order_by(Job.created_at)
    )
    positions = {
        job_id: 0 if status == JobStatus.PROCESSING else ahead
        for ahead, (job_id, status) in enumerate(active)
    }
    # Only the light columns: this is polled every 2 s.
    rows = await session.execute(
        select(Job.id, Job.filename, Job.created_at, Job.model_id, Job.status)
        .order_by(Job.created_at.desc())
        .limit(HISTORY_LIMIT)
    )
    return JobsResponse(
        jobs=[
            JobSummary(
                job_id=row.id,
                filename=row.filename,
                created_at=_utc(row.created_at),
                model_id=row.model_id,
                status=_api_status(row.status),
                queue_position=positions.get(row.id, 0),
            )
            for row in rows
        ]
    )


@router.post("/analyze")
async def analyze(
    session: SessionDep,
    file: UploadFile | None = None,
    model_id: Annotated[str | None, Form()] = None,
) -> AnalyzeResponse:
    if file is None or not file.filename:
        raise ApiError(400, "FILE_REQUIRED", "Выберите видеофайл.")
    extension = Path(file.filename).suffix.lower()
    if extension not in VIDEO_TYPES:
        raise ApiError(415, "UNSUPPORTED_FORMAT", "Поддерживаются MOV, MP4 и WebM.")
    if not file.size:
        raise ApiError(400, "EMPTY_FILE", "Файл пуст. Выберите другое видео.")
    if file.size > settings.max_upload_mb * 1024 * 1024:
        raise ApiError(
            413, "FILE_TOO_LARGE", f"Максимальный размер файла — {settings.max_upload_mb} МБ."
        )
    # The jury's client sends only the file, so no model_id means the default model.
    model_id = model_id or next(iter(MODELS))
    if model_id not in MODELS:
        raise ApiError(400, "UNKNOWN_MODEL", "Выберите доступную модель.")

    job_id = uuid.uuid4().hex
    path = settings.upload_dir / f"{job_id}{extension}"
    with path.open("wb") as out:
        await run_in_threadpool(shutil.copyfileobj, file.file, out)

    session.add(Job(id=job_id, filename=file.filename, model_id=model_id, video_path=str(path)))
    await session.commit()
    enqueue(job_id)
    return AnalyzeResponse(job_id=job_id)


@router.get("/jobs/{job_id}", response_model_exclude_none=True)
async def get_job(job_id: str, session: SessionDep) -> JobResponse:
    job = await _get_job(session, job_id)
    fields = {"job_id": job.id, "status": _api_status(job.status), "queue_position": 0}
    if job.status == JobStatus.QUEUED:
        fields["queue_position"] = await session.scalar(
            select(func.count()).where(Job.status.in_(ACTIVE), Job.created_at < job.created_at)
        )
    elif job.status == JobStatus.DONE:
        fields.update(verdict=job.verdict, violations=job.violations or [])
    elif job.status == JobStatus.FAILED:
        fields["error"] = ErrorInfo(
            code=job.error_code or "ANALYSIS_FAILED", message=job.error or ""
        )
    return JobResponse(**fields)


@router.get("/jobs/{job_id}/annotations")
async def get_annotations(job_id: str, session: SessionDep) -> AnnotationsResponse:
    job = await _get_job(session, job_id)
    if job.status == JobStatus.FAILED:
        raise ApiError(409, "JOB_FAILED", "Анализ завершился с ошибкой.")
    if job.status != JobStatus.DONE:
        raise ApiError(409, "JOB_NOT_READY", "Анализ ещё не завершён.")
    return AnnotationsResponse(duration_sec=job.duration_sec or 0, events=job.events or [])


@router.get("/jobs/{job_id}/video")
async def get_video(job_id: str, session: SessionDep) -> FileResponse:
    # FileResponse answers Range requests with 206 + Accept-Ranges, which <video> needs to seek.
    job = await _get_job(session, job_id)
    for path in (job.playback_path, Path(job.video_path)):
        if path.is_file():
            return FileResponse(path, media_type=VIDEO_TYPES[path.suffix.lower()])
    raise ApiError(404, "VIDEO_NOT_FOUND", "Видео не найдено.")
