"""APScheduler drains the durable database queue through one inference slot."""

import asyncio
import fcntl
import logging
from datetime import UTC
from pathlib import Path

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from sqlalchemy import select, update

from app import video
from app.config import settings
from app.db import Job, JobStatus, SessionLocal, utcnow
from app.pipeline import analyze_video

logger = logging.getLogger(__name__)
scheduler = AsyncIOScheduler(timezone=UTC, job_defaults={"misfire_grace_time": None})
_slots = asyncio.Semaphore(1)
_running_tasks: set[asyncio.Task] = set()
_instance_lock = None
_drain_task: asyncio.Task | None = None
_QUEUE_JOB = "analysis-queue"


def enqueue(_job_id: str) -> None:
    """Wake the single queue drain; the database defines FIFO order."""
    if scheduler.running:
        scheduler.modify_job(_QUEUE_JOB, next_run_time=utcnow())


async def process_queue() -> None:
    while True:
        async with SessionLocal() as session:
            job_id = await session.scalar(
                select(Job.id)
                .where(Job.status == JobStatus.QUEUED)
                .order_by(Job.created_at, Job.id)
                .limit(1)
            )
        if job_id is None:
            return
        await process_job(job_id)


async def _dispatch() -> None:
    """A short scheduler tick wakes one long-running drain, without overlapping it."""
    global _drain_task
    if _drain_task is None or _drain_task.done():
        if _drain_task is not None and not _drain_task.cancelled():
            error = _drain_task.exception()
            if error is not None:
                logger.error("Queue drain stopped unexpectedly", exc_info=error)
        _drain_task = asyncio.create_task(process_queue(), name="analysis-queue")


async def process_job(job_id: str) -> None:
    task = asyncio.current_task()
    _running_tasks.add(task)
    try:
        async with _slots, SessionLocal() as session:
            job = await session.get(Job, job_id)
            if job is None or job.status != JobStatus.QUEUED:
                return
            job.status = JobStatus.PROCESSING
            await session.commit()
            logger.info("job %s: started", job_id)

            # At most one bounded ffmpeg conversion runs beside inference.
            playback = asyncio.create_task(_make_playback(job))
            try:
                try:
                    async with asyncio.timeout(settings.job_timeout_sec):
                        analysis = await analyze_video(
                            Path(job.video_path), job.model_id, job_id=job.id
                        )
                except TimeoutError:
                    _fail(
                        job,
                        "ANALYSIS_TIMEOUT",
                        "Анализ занял слишком много времени. Попробуйте ещё раз.",
                    )
                except video.VideoDecodeError as exc:
                    logger.warning("job %s: unreadable video: %s", job_id, exc)
                    _fail(
                        job, "DECODE_FAILED", "Не удалось прочитать видео. Попробуйте другой файл."
                    )
                except Exception:
                    logger.exception("job %s: analysis failed", job_id)
                    _fail(
                        job, "ANALYSIS_FAILED", "Не удалось выполнить анализ. Попробуйте ещё раз."
                    )
                else:
                    job.status = JobStatus.DONE
                    job.duration_sec = analysis.duration_sec
                    job.verdict = "violation" if analysis.violations else "no_violation"
                    job.violations = [v.model_dump() for v in analysis.violations]
                    job.events = [e.model_dump() for e in analysis.events]
                job.finished_at = utcnow()
                await session.commit()
                logger.info("job %s: %s", job_id, job.status)
                await playback
            finally:
                if not playback.done():
                    playback.cancel()
                await asyncio.gather(playback, return_exceptions=True)
    finally:
        _running_tasks.discard(task)


def _fail(job: Job, code: str, message: str) -> None:
    job.status = JobStatus.FAILED
    job.error_code = code
    job.error = message


async def _make_playback(job: Job) -> None:
    try:
        await video.make_browser_mp4(Path(job.video_path), job.playback_path)
    except Exception as exc:
        logger.warning("job %s: no browser copy, serving the original: %s", job.id, exc)


async def start() -> None:
    global _instance_lock
    if scheduler.running:
        raise RuntimeError("The queue scheduler is already running")
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    _instance_lock = (settings.data_dir / ".worker.lock").open("a")
    try:
        fcntl.flock(_instance_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        _instance_lock.close()
        _instance_lock = None
        raise RuntimeError("The queue already has a worker; run one Uvicorn process") from None
    try:
        async with SessionLocal() as session:
            await session.execute(
                update(Job)
                .where(Job.status == JobStatus.PROCESSING)
                .values(status=JobStatus.QUEUED)
            )
            await session.commit()
        scheduler.add_job(
            _dispatch,
            "interval",
            seconds=1,
            id=_QUEUE_JOB,
            next_run_time=utcnow(),
            max_instances=1,
            coalesce=True,
            replace_existing=True,
        )
        scheduler.start()
    except BaseException:
        _instance_lock.close()
        _instance_lock = None
        raise


async def stop() -> None:
    global _instance_lock, _drain_task
    if scheduler.running:
        scheduler.shutdown(wait=False)
        # APScheduler schedules its shutdown on the event loop, cancelling active jobs.
        await asyncio.sleep(0)
    tasks = set(_running_tasks)
    if _drain_task is not None and not _drain_task.done():
        tasks.add(_drain_task)
    for task in tasks:
        if not task.cancelling():
            task.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)
    _drain_task = None
    if _instance_lock is not None:
        _instance_lock.close()
        _instance_lock = None
