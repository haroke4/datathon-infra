"""Populate demo history explicitly: python -m app.seed_history --days 30.

Completed results and playable videos are reused; inference is never queued.
Stable IDs make repeated runs safe, and demo filenames identify generated rows.
"""

import argparse
import asyncio
import json
from copy import deepcopy
from datetime import UTC, date, datetime, time, timedelta
from pathlib import Path
from uuid import NAMESPACE_URL, uuid5
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import Job, JobStatus, SessionLocal, engine

PREFIX = "demo-history-"


async def seed_history(session: AsyncSession, *, days: int, end_date: date) -> dict:
    if not 1 <= days <= 90:
        raise ValueError("days must be between 1 and 90")
    rows = await session.scalars(
        select(Job)
        .where(Job.status == JobStatus.DONE, ~Job.filename.startswith(PREFIX))
        .order_by(Job.created_at.desc(), Job.id)
    )
    templates = [
        job
        for job in rows
        if job.duration_sec
        and job.verdict in ("violation", "no_violation")
        and (job.playback_path.is_file() or Path(job.video_path).is_file())
    ]
    if not templates:
        raise ValueError("No completed checks with playable videos available")
    zone = ZoneInfo("Asia/Almaty")
    added, skipped = 0, 0
    counts = {}
    for offset in range(days):
        day = end_date - timedelta(days=offset)
        count = 1 + day.toordinal() % 2
        counts[day.isoformat()] = count
        for slot in range(count):
            job_id = uuid5(NAMESPACE_URL, f"datathon:demo-history:{day}:{slot}").hex
            if await session.get(Job, job_id) is not None:
                skipped += 1
                continue
            template = templates[(day.toordinal() + slot) % len(templates)]
            created = datetime.combine(
                day, time(9 + slot * 5 + offset % 3, (26 + offset * 7) % 60), zone
            ).astimezone(UTC)
            session.add(
                Job(
                    id=job_id,
                    filename=f"{PREFIX}{day}-{slot + 1}{Path(template.filename).suffix}",
                    model_id=template.model_id,
                    video_path=template.video_path,
                    status=JobStatus.DONE,
                    duration_sec=template.duration_sec,
                    verdict=template.verdict,
                    violations=deepcopy(template.violations or []),
                    events=deepcopy(template.events or []),
                    created_at=created,
                    finished_at=created + timedelta(seconds=40 + offset % 80),
                )
            )
            added += 1
    await session.commit()
    return {"added": added, "skipped": skipped, "days": counts}


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--days", type=int, default=30)
    parser.add_argument(
        "--end-date",
        type=date.fromisoformat,
        default=datetime.now(ZoneInfo("Asia/Almaty")).date() - timedelta(days=1),
        help="Last demo date (YYYY-MM-DD); defaults to yesterday in Almaty",
    )
    args = parser.parse_args()
    try:
        async with SessionLocal() as session:
            print(
                json.dumps(
                    await seed_history(session, days=args.days, end_date=args.end_date),
                    ensure_ascii=False,
                )
            )
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
