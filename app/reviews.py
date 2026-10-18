"""Human decisions live separately from immutable model output and the inference queue."""

import hashlib
import json
from datetime import UTC

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import Job, JobStatus, ViolationReview
from app.errors import ApiError
from app.schemas import ReviewsResponse, ViolationReviewResponse


def violation_key(violation: dict) -> str:
    identity = [
        violation.get("code") or "",
        violation.get("type") or "",
        float(violation.get("timecode_sec", 0)),
    ]
    return hashlib.sha256(json.dumps(identity, ensure_ascii=False).encode()).hexdigest()


def require_completed(job: Job) -> None:
    if job.status != JobStatus.DONE:
        raise ApiError(409, "JOB_NOT_READY", "Решения доступны после завершения анализа.")


async def job_reviews(session: AsyncSession, job: Job) -> ReviewsResponse:
    require_completed(job)
    saved = {
        row.violation_index: row
        for row in (
            await session.scalars(select(ViolationReview).where(ViolationReview.job_id == job.id))
        )
    }
    reviews = []
    for index, violation in enumerate(job.violations or []):
        key = violation_key(violation)
        row = saved.get(index)
        valid = row is not None and row.violation_key == key
        updated = row.updated_at if valid else None
        if updated is not None and updated.tzinfo is None:
            updated = updated.replace(tzinfo=UTC)
        reviews.append(
            ViolationReviewResponse(
                violation_index=index,
                violation_key=key,
                decision=row.decision if valid else "pending",
                updated_at=updated,
            )
        )
    return ReviewsResponse(job_id=job.id, reviews=reviews)
