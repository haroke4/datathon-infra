from collections import Counter
from datetime import date
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import select

from app.db import Job, SessionLocal
from app.seed_history import PREFIX, seed_history


async def test_seed_history_is_playable_daily_and_idempotent(tmp_path, client):
    video = tmp_path / "source.mp4"
    video.write_bytes(b"test video")
    async with SessionLocal() as session:
        source = Job(
            id="source",
            filename="source.mp4",
            model_id="kadys-model",
            video_path=str(video),
            status="done",
            duration_sec=60,
            verdict="no_violation",
            violations=[],
            events=[],
        )
        session.add(source)
        await session.commit()
        result = await seed_history(session, days=30, end_date=date(2026, 10, 17))
        assert result["added"] == 45
        repeated = await seed_history(session, days=30, end_date=date(2026, 10, 17))
        assert repeated["added"] == 0
        assert repeated["skipped"] == 45
        jobs = list(await session.scalars(select(Job).where(Job.filename.startswith(PREFIX))))
        counts = Counter(
            job.created_at.replace(tzinfo=ZoneInfo("UTC"))
            .astimezone(ZoneInfo("Asia/Almaty"))
            .date()
            for job in jobs
        )
        assert len(counts) == 30
        assert set(counts.values()) == {1, 2}
        assert all(job.status == "done" and job.video_path == str(video) for job in jobs)
        assert source.filename == "source.mp4"
    response = await client.get("/api/ui/jobs")
    assert len(response.json()["jobs"]) == 46
    sample = jobs[0]
    assert (await client.get(f"/api/ui/jobs/{sample.id}")).json()["status"] == "done"
    assert (await client.get(f"/api/ui/jobs/{sample.id}/video")).status_code == 200


async def test_seed_refuses_missing_video(tmp_path):
    async with SessionLocal() as session:
        session.add(
            Job(
                id="missing",
                filename="missing.mp4",
                model_id="kadys-model",
                video_path=str(tmp_path / "missing.mp4"),
                status="done",
                duration_sec=60,
                verdict="no_violation",
            )
        )
        await session.commit()
        with pytest.raises(ValueError, match="playable videos"):
            await seed_history(session, days=30, end_date=date(2026, 10, 17))
