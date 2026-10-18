"""Period statistics use upload dates in the viewer's timezone, without the history limit."""

from datetime import UTC, datetime, timedelta
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import Job, JobStatus, ViolationReview
from app.errors import ApiError
from app.reviews import violation_key
from app.schemas import (
    AnalyticsBucket,
    AnalyticsCategory,
    AnalyticsComparison,
    AnalyticsEvent,
    AnalyticsHour,
    AnalyticsResponse,
    AnalyticsSummary,
    ReviewCounts,
)

Period = Literal["today", "week", "month"]


async def collect_analytics(
    session: AsyncSession, period: Period, timezone: str, now: datetime | None = None
) -> AnalyticsResponse:
    try:
        zone = ZoneInfo(timezone)
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise ApiError(400, "INVALID_TIMEZONE", "Неизвестный часовой пояс.") from exc
    end = (now or datetime.now(UTC)).astimezone(zone)
    today = end.replace(hour=0, minute=0, second=0, microsecond=0)
    days = {"today": 1, "week": 7, "month": 30}[period]
    start = today - timedelta(days=days - 1)
    previous_start = start - timedelta(days=days)
    previous_end = end - timedelta(days=days)
    previous = AnalyticsSummary()
    hours = [AnalyticsHour(hour=hour) for hour in range(24)]
    # Hour buckets represent real instants, including DST transitions.
    if period == "today":
        cursor = start.astimezone(UTC)
        stop = (today + timedelta(days=1)).astimezone(UTC)
        starts = []
        while cursor < stop:
            starts.append(cursor.astimezone(zone))
            cursor += timedelta(hours=1)
    else:
        starts = [start + timedelta(days=index) for index in range(days)]
    buckets = [AnalyticsBucket(start=value) for value in starts]
    bucket_map = {value.start.isoformat(): value for value in buckets}
    summary = AnalyticsSummary()
    categories: dict[str, AnalyticsCategory] = {}
    recent: list[AnalyticsEvent] = []
    review_counts = ReviewCounts()
    saved_reviews = {
        (row.job_id, row.violation_index): row
        for row in (
            await session.scalars(
                select(ViolationReview)
                .join(Job, Job.id == ViolationReview.job_id)
                .where(
                    Job.created_at >= start.astimezone(UTC),
                    Job.created_at <= end.astimezone(UTC),
                    Job.status == JobStatus.DONE,
                )
            )
        )
    }
    rows = await session.execute(
        select(Job.id, Job.filename, Job.created_at, Job.status, Job.duration_sec, Job.violations)
        .where(
            Job.created_at >= previous_start.astimezone(UTC),
            Job.created_at <= end.astimezone(UTC),
        )
        .order_by(Job.created_at.desc(), Job.id)
    )
    for row in rows:
        created = row.created_at
        if created.tzinfo is None:
            created = created.replace(tzinfo=UTC)
        local = created.astimezone(zone)
        if created < start.astimezone(UTC):
            if created <= previous_end.astimezone(UTC):
                _add_summary(previous, row.status, row.duration_sec, row.violations or [])
            continue
        bucket_start = local.replace(minute=0, second=0, microsecond=0)
        if period != "today":
            bucket_start = bucket_start.replace(hour=0)
        bucket = bucket_map[bucket_start.isoformat()]
        _add_summary(summary, row.status, row.duration_sec, row.violations or [])
        bucket.checks += 1
        hour = hours[local.hour]
        hour.checks += 1
        if row.status != JobStatus.DONE:
            continue
        hour.completed += 1
        violations = row.violations or []
        hour.violations += len(violations)
        bucket.violations += len(violations)
        if violations:
            hour.with_violations += 1
        seen = set()
        for index, violation in enumerate(violations):
            saved = saved_reviews.get((row.id, index))
            decision = (
                saved.decision
                if saved is not None and saved.violation_key == violation_key(violation)
                else "pending"
            )
            setattr(review_counts, decision, getattr(review_counts, decision) + 1)
            title = violation.get("type") or "Без названия"
            code = violation.get("code") or None
            key = code or " ".join(title.casefold().split())
            category = categories.setdefault(
                key, AnalyticsCategory(key=key, code=code, title=title)
            )
            category.count += 1
            setattr(category.reviews, decision, getattr(category.reviews, decision) + 1)
            if key not in seen:
                category.checks += 1
                seen.add(key)
            # The table is a bounded sample; all aggregates above remain complete.
            if len(recent) < 100:
                recent.append(
                    AnalyticsEvent(
                        job_id=row.id,
                        filename=row.filename,
                        created_at=created,
                        violation_index=index,
                        category_key=key,
                        title=title,
                        timecode_sec=violation.get("timecode_sec", 0),
                        decision=decision,
                    )
                )
    return AnalyticsResponse(
        period=period,
        timezone=timezone,
        start=start,
        end=end,
        summary=summary,
        timeline=buckets,
        categories=sorted(categories.values(), key=lambda item: (-item.count, item.title)),
        recent=recent,
        comparison=AnalyticsComparison(start=previous_start, end=previous_end, summary=previous),
        hours=hours,
        reviews=review_counts,
    )


def _add_summary(summary: AnalyticsSummary, status: str, duration: float | None, violations: list):
    summary.checks += 1
    if status == JobStatus.FAILED:
        summary.failed += 1
    elif status != JobStatus.DONE:
        summary.processing += 1
    else:
        summary.completed += 1
        summary.duration_sec += duration or 0
        summary.violations += len(violations)
        if violations:
            summary.with_violations += 1
        else:
            summary.clean += 1
