import asyncio
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import func, select

from app.db import Job, SessionLocal, ViolationReview
from app.reviews import violation_key


def event(code="B1", time=12.5):
    return {
        "code": code,
        "type": f"Нарушение {code}",
        "timecode_sec": time,
        "description": "Описание",
        "evidence_frames": [],
    }


async def seed(status="done", violations=None):
    async with SessionLocal() as session:
        row = Job(
            id="review-job",
            filename="cash.mov",
            model_id="kadys-model",
            video_path="/tmp/cash.mov",
            status=status,
            created_at=datetime.now(UTC) - timedelta(seconds=1),
            duration_sec=65,
            violations=violations if violations is not None else [event(), event("A4", 32)],
            verdict="violation",
            events=[],
        )
        session.add(row)
        await session.commit()
    return row.id


async def reviews(client, job_id="review-job"):
    result = await client.get(f"/api/ui/jobs/{job_id}/reviews")
    assert result.status_code == 200, result.text
    return result.json()["reviews"]


async def put(client, review, decision, job_id="review-job"):
    return await client.put(
        f"/api/ui/jobs/{job_id}/violations/{review['violation_index']}/review",
        json={"decision": decision, "violation_key": review["violation_key"]},
    )


async def test_review_persists_all_choices_and_updates_statistics_without_duplicate_votes(client):
    await seed()
    original = (await client.get("/api/ui/jobs/review-job")).json()
    first = (await reviews(client))[0]
    assert first["decision"] == "pending"
    assert first["updated_at"] is None
    for decision in ("confirmed", "insufficient_data", "rejected", "pending"):
        for _ in range(2):
            response = await put(client, first, decision)
            assert response.status_code == 200, response.text
        saved = (await reviews(client))[0]
        assert saved["decision"] == decision
        assert saved["updated_at"].endswith("Z")
        async with SessionLocal() as session:
            assert (await session.get(ViolationReview, ("review-job", 0))).decision == decision
            assert await session.scalar(select(func.count()).select_from(ViolationReview)) == 1
        data = (await client.get("/api/ui/analytics")).json()
        assert data["summary"]["violations"] == 2
        assert sum(data["reviews"].values()) == 2
        assert data["reviews"][decision] == (2 if decision == "pending" else 1)
        assert data["recent"][0]["decision"] == decision
        category = next(item for item in data["categories"] if item["code"] == "B1")
        assert category["reviews"][decision] == 1
        assert (await client.get("/api/ui/jobs/review-job")).json() == original


async def test_concurrent_decisions_do_not_overwrite_other_cards(client):
    await seed()
    first, second = await reviews(client)
    responses = await asyncio.gather(
        put(client, first, "confirmed"), put(client, second, "rejected")
    )
    assert [response.status_code for response in responses] == [200, 200]
    assert [item["decision"] for item in await reviews(client)] == ["confirmed", "rejected"]
    stats = (await client.get("/api/ui/analytics")).json()["reviews"]
    assert stats == {"pending": 0, "confirmed": 1, "insufficient_data": 0, "rejected": 1}


@pytest.mark.parametrize("status", ["queued", "processing", "failed"])
async def test_unfinished_or_failed_jobs_cannot_be_reviewed(client, status):
    await seed(status=status)
    get = await client.get("/api/ui/jobs/review-job/reviews")
    write = await put(client, {"violation_index": 0, "violation_key": "a" * 64}, "confirmed")
    assert get.status_code == write.status_code == 409
    async with SessionLocal() as session:
        assert (await session.get(Job, "review-job")).status == status
        assert await session.scalar(select(func.count()).select_from(ViolationReview)) == 0


async def test_review_validation_and_clean_results(client):
    missing = await client.get("/api/ui/jobs/missing/reviews")
    assert missing.status_code == 404
    await seed(violations=[])
    assert await reviews(client) == []
    stub = {"violation_index": 0, "violation_key": "a" * 64}
    assert (await put(client, stub, "confirmed")).status_code == 404
    assert (await put(client, stub, "unknown")).status_code == 422
    assert (await put(client, {**stub, "violation_index": -1}, "confirmed")).status_code == 422
    assert (await put(client, {**stub, "violation_key": "short"}, "confirmed")).status_code == 422


async def test_changed_result_rejects_stale_write_and_ignores_old_decision(client):
    await seed()
    first = (await reviews(client))[0]
    assert (await put(client, first, "confirmed")).status_code == 200
    async with SessionLocal() as session:
        row = await session.get(Job, "review-job")
        row.violations = [event("B9", 24)]
        await session.commit()
    response = await put(client, first, "rejected")
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "RESULT_CHANGED"
    current = (await reviews(client))[0]
    assert current["decision"] == "pending"
    assert current["violation_key"] != first["violation_key"]
    assert (await client.get("/api/ui/analytics")).json()["reviews"]["confirmed"] == 0
    assert (await put(client, current, "insufficient_data")).status_code == 200


async def test_review_aggregates_include_events_outside_the_recent_table(client):
    await seed(violations=[event()] * 205)
    async with SessionLocal() as session:
        for index, decision in [(0, "confirmed"), (120, "rejected"), (200, "insufficient_data")]:
            session.add(
                ViolationReview(
                    job_id="review-job",
                    violation_index=index,
                    violation_key=violation_key(event()),
                    decision=decision,
                )
            )
        await session.commit()
    for period in ("today", "week", "month"):
        data = (await client.get(f"/api/ui/analytics?period={period}")).json()
        assert len(data["recent"]) == 100
        assert data["reviews"] == {
            "pending": 202,
            "confirmed": 1,
            "insufficient_data": 1,
            "rejected": 1,
        }
        assert data["categories"][0]["reviews"] == data["reviews"]
