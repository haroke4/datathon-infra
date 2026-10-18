from datetime import UTC, datetime, timedelta

import pytest

from app.analytics import collect_analytics
from app.db import Job, SessionLocal

NOW = datetime(2026, 10, 18, 9, 0, tzinfo=UTC)
START = datetime(2026, 10, 17, 19, 0, tzinfo=UTC)  # midnight in Almaty


def job(id, created=START, status="done", violations=None, duration=65):
    return Job(
        id=id,
        filename=f"{id}.mov",
        model_id="kadys-model",
        video_path=f"/tmp/{id}.mov",
        created_at=created,
        status=status,
        violations=violations,
        duration_sec=duration,
    )


def violation(code="B1", title="Деньги на столе"):
    return {
        "code": code,
        "type": title,
        "timecode_sec": 12.5,
        "description": "Описание",
        "evidence_frames": [{"timestamp_sec": 12.5, "image_base64": "PRIVATE_FRAME"}],
    }


async def test_analytics_counts_occurrences_and_distinct_checks_in_local_day():
    async with SessionLocal() as session:
        session.add_all(
            [
                job(
                    "repeated",
                    violations=[violation(), violation(title="Другое название"), violation("A4")],
                ),
                job("clean"),
                job("pending", status="queued", violations=[violation()]),
                job("processing", status="processing"),
                job("failed", status="failed", violations=[violation()]),
                job("too-old", created=START - timedelta(microseconds=1), violations=[violation()]),
                job("future", created=NOW + timedelta(seconds=1), violations=[violation()]),
            ]
        )
        await session.commit()
        data = await collect_analytics(session, "today", "Asia/Almaty", NOW)
    assert data.summary.model_dump() == {
        "checks": 5,
        "completed": 2,
        "processing": 2,
        "failed": 1,
        "clean": 1,
        "with_violations": 1,
        "violations": 3,
        "duration_sec": 130,
    }
    assert len(data.timeline) == 24
    assert data.timeline[0].checks == 5
    assert data.timeline[0].violations == 3
    assert [(item.key, item.count, item.checks) for item in data.categories] == [
        ("B1", 2, 1),
        ("A4", 1, 1),
    ]
    assert [event.violation_index for event in data.recent] == [0, 1, 2]
    assert data.recent[0].timecode_sec == 12.5
    assert "PRIVATE_FRAME" not in data.model_dump_json()


@pytest.mark.parametrize(("period", "days"), [("week", 7), ("month", 30)])
async def test_analytics_period_boundaries_and_uncoded_categories(period, days):
    start = START - timedelta(days=days - 1)
    async with SessionLocal() as session:
        session.add_all(
            [
                job("boundary", created=start, violations=[violation(None, " Без  кода ")]),
                job("same-type", created=START, violations=[violation(None, "без кода")]),
                job("outside", created=start - timedelta(microseconds=1)),
            ]
        )
        await session.commit()
        data = await collect_analytics(session, period, "Asia/Almaty", NOW)
    assert len(data.timeline) == days
    assert data.summary.checks == 2
    assert len(data.categories) == 1
    assert data.categories[0].count == data.categories[0].checks == 2
    assert sum(bucket.violations for bucket in data.timeline) == 2
    assert data.recent[0].job_id == "same-type"


async def test_analytics_is_not_capped_by_history_and_bounds_event_payload():
    async with SessionLocal() as session:
        session.add_all([job(f"record-{i}", violations=[violation()]) for i in range(205)])
        await session.commit()
        data = await collect_analytics(session, "today", "Asia/Almaty", NOW)
    assert data.summary.checks == data.summary.violations == 205
    assert data.categories[0].count == 205
    assert len(data.recent) == 100


@pytest.mark.parametrize(
    ("day", "hours"), [("2026-03-08T18:00:00+00:00", 23), ("2026-11-01T18:00:00+00:00", 25)]
)
async def test_daylight_saving_hours_have_distinct_buckets(day, hours):
    async with SessionLocal() as session:
        # Both instants fall into 01:00 local on the fall-back day, in different offsets.
        if hours == 25:
            session.add_all(
                [
                    job("first-hour", created=datetime(2026, 11, 1, 5, 30, tzinfo=UTC)),
                    job("second-hour", created=datetime(2026, 11, 1, 6, 30, tzinfo=UTC)),
                ]
            )
            await session.commit()
        data = await collect_analytics(
            session, "today", "America/New_York", datetime.fromisoformat(day)
        )
    assert len(data.timeline) == hours
    if hours == 25:
        assert [bucket.checks for bucket in data.timeline if bucket.start.hour == 1] == [1, 1]
        assert data.hours[1].checks == 2


async def test_analytics_endpoint_empty_and_validation(client):
    response = await client.get("/api/ui/analytics?period=month&timezone=Asia%2FAlmaty")
    assert response.status_code == 200
    data = response.json()
    assert data["summary"]["checks"] == 0
    assert data["categories"] == data["recent"] == []
    assert len(data["timeline"]) == 30
    assert (await client.get("/api/ui/analytics?period=year")).status_code == 422
    invalid = await client.get("/api/ui/analytics?timezone=Not/AZone")
    assert invalid.status_code == 400
    assert invalid.json()["error"]["code"] == "INVALID_TIMEZONE"


@pytest.mark.parametrize(("period", "days"), [("today", 1), ("week", 7), ("month", 30)])
async def test_comparison_matches_local_cutoff_and_keeps_current_aggregates(period, days):
    start = START - timedelta(days=days - 1)
    previous_start = start - timedelta(days=days)
    previous_end = NOW - timedelta(days=days)
    async with SessionLocal() as session:
        session.add_all(
            [
                job("current", created=START, violations=[violation(), violation()]),
                job("previous", created=previous_start, violations=[violation()]),
                job("previous-cutoff", created=previous_end),
                job(
                    "after-cutoff",
                    created=previous_end + timedelta(seconds=1),
                    violations=[violation()] * 10,
                ),
                job("too-old", created=previous_start - timedelta(seconds=1)),
            ]
        )
        await session.commit()
        data = await collect_analytics(session, period, "Asia/Almaty", NOW)
    assert data.summary.checks == 1
    assert data.summary.violations == 2
    assert data.comparison.summary.checks == 2
    assert data.comparison.summary.violations == 1
    assert data.comparison.summary.clean == 1
    assert data.comparison.start.astimezone(UTC) == previous_start
    assert data.comparison.end.astimezone(UTC) == previous_end
    assert len(data.hours) == 24
    assert sum(hour.checks for hour in data.hours) == data.summary.checks
    assert sum(hour.violations for hour in data.hours) == data.summary.violations
    assert data.hours[0].violations == 2
    assert len(data.recent) == 2


async def test_analytics_read_does_not_change_queue_results_or_annotations(client):
    created = datetime.now(UTC) - timedelta(seconds=1)
    async with SessionLocal() as session:
        done = job("completed", created=created, violations=[violation()])
        done.verdict = "violation"
        done.events = []
        session.add_all([done, job("queued", created=created, status="queued")])
        await session.commit()
    paths = ["/jobs", "/jobs/queued", "/jobs/completed", "/jobs/completed/annotations"]
    before = [(await client.get(f"/api/ui{path}")).json() for path in paths]
    for period in ("today", "week", "month"):
        result = await client.get(f"/api/ui/analytics?period={period}")
        assert result.status_code == 200
    after = [(await client.get(f"/api/ui{path}")).json() for path in paths]
    assert before == after
    async with SessionLocal() as session:
        assert (await session.get(Job, "queued")).status == "queued"
        assert (await session.get(Job, "completed")).violations == [violation()]
