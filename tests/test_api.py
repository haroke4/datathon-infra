import asyncio
from unittest.mock import AsyncMock

import pytest

from app import video, worker
from app.config import Settings, settings
from app.schemas import Analysis, AnnotationEvent, Box, EvidenceFrame, Violation

VIOLATION = Violation(
    code="B1",
    type="Лишние деньги открыто на столе, ящик или сейф открыт",
    timecode_sec=1.5,
    description="d",
    evidence_frames=[EvidenceFrame(timestamp_sec=1.5, image_base64="AAAA")],
)
EVENT = AnnotationEvent(
    violation_index=0, start_sec=1.5, end_sec=2.5, box=Box(x=0.1, y=0.2, width=0.3, height=0.4)
)


async def upload(client, data=b"fake video", name="video_017.mov", **form) -> str:
    response = await client.post("/api/v1/analyze", files={"file": (name, data)}, data=form)
    assert response.status_code == 200, response.text
    return response.json()["job_id"]


async def get(client, path: str):
    return (await client.get(f"/api/v1{path}")).json()


def error_of(response):
    return response.status_code, response.json()["error"]["code"]


async def test_models(client):
    assert await get(client, "/models") == {
        "models": [{"id": "kadys-model", "name": "Kadys model"}]
    }


async def test_errors_use_contract_format(client):
    missing = await client.get("/api/v1/jobs/missing")
    assert error_of(missing) == (404, "JOB_NOT_FOUND")
    assert missing.json()["error"]["message"] == "Проверка не найдена."
    assert error_of(await client.get("/api/v1/jobs/missing/video")) == (404, "JOB_NOT_FOUND")
    assert error_of(await client.get("/api/v1/nope")) == (404, "NOT_FOUND")


@pytest.mark.parametrize(
    ("files", "form", "expected"),
    [
        (None, {"model_id": "kadys-model"}, (400, "FILE_REQUIRED")),
        ({"file": ("a.txt", b"x")}, {}, (415, "UNSUPPORTED_FORMAT")),
        ({"file": ("a.mov", b"")}, {}, (400, "EMPTY_FILE")),
        ({"file": ("a.webm", b"x")}, {"model_id": "gpt"}, (400, "UNKNOWN_MODEL")),
    ],
)
async def test_analyze_validation(client, files, form, expected):
    response = await client.post("/api/v1/analyze", files=files, data=form)
    assert error_of(response) == expected


async def test_analyze_size_limit(client, monkeypatch):
    monkeypatch.setattr(settings, "max_upload_mb", 0)
    response = await client.post("/api/v1/analyze", files={"file": ("a.mov", b"x")})
    assert error_of(response) == (413, "FILE_TOO_LARGE")
    assert response.json()["error"]["message"] == "Максимальный размер файла — 0 МБ."


async def test_queue_positions_and_history(client):
    first = await upload(client, name="1.mov")  # jury-style: no model_id
    second = await upload(client, name="2.mp4", model_id="kadys-model")
    third = await upload(client, name="3.webm")

    assert await get(client, f"/jobs/{third}") == {
        "job_id": third,
        "status": "processing",
        "queue_position": 2,
    }
    jobs = (await get(client, "/jobs"))["jobs"]
    assert [(j["job_id"], j["queue_position"]) for j in jobs] == [
        (third, 2),
        (second, 1),
        (first, 0),
    ]
    assert jobs[0]["filename"] == "3.webm"
    assert jobs[0]["model_id"] == "kadys-model"
    assert jobs[0]["status"] == "processing"
    assert jobs[0]["created_at"].endswith("Z")


async def test_done_job(client, clip, monkeypatch):
    monkeypatch.setattr(
        worker,
        "analyze_video",
        AsyncMock(return_value=Analysis(duration_sec=3.0, violations=[VIOLATION], events=[EVENT])),
    )
    job_id = await upload(client, clip)
    assert error_of(await client.get(f"/api/v1/jobs/{job_id}/annotations")) == (
        409,
        "JOB_NOT_READY",
    )

    await worker.process_job(job_id)

    assert await get(client, f"/jobs/{job_id}") == {
        "job_id": job_id,
        "status": "done",
        "queue_position": 0,
        "verdict": "violation",
        "violations": [VIOLATION.model_dump()],
    }
    assert await get(client, f"/jobs/{job_id}/annotations") == {
        "duration_sec": 3.0,
        "events": [EVENT.model_dump()],
    }

    # The worker made a browser MP4 copy; it is served with Range support.
    full = await client.get(f"/api/v1/jobs/{job_id}/video")
    assert full.status_code == 200
    assert full.headers["content-type"] == "video/mp4"
    part = await client.get(f"/api/v1/jobs/{job_id}/video", headers={"Range": "bytes=0-99"})
    assert part.status_code == 206
    assert part.headers["accept-ranges"] == "bytes"
    assert part.headers["content-range"].startswith("bytes 0-99/")
    assert len(part.content) == 100


async def test_no_violation_job(client, monkeypatch):
    monkeypatch.setattr(worker, "analyze_video", AsyncMock(return_value=Analysis(duration_sec=3)))
    job_id = await upload(client)
    await worker.process_job(job_id)

    assert await get(client, f"/jobs/{job_id}") == {
        "job_id": job_id,
        "status": "done",
        "queue_position": 0,
        "verdict": "no_violation",
        "violations": [],
    }
    assert await get(client, f"/jobs/{job_id}/annotations") == {"duration_sec": 3.0, "events": []}
    # No browser copy (not a real video): the original is served.
    response = await client.get(f"/api/v1/jobs/{job_id}/video")
    assert response.headers["content-type"] == "video/quicktime"


@pytest.mark.parametrize("code", ["ANALYSIS_TIMEOUT", "DECODE_FAILED", "ANALYSIS_FAILED"])
async def test_failed_job(client, monkeypatch, code):
    async def analyze(path, model_id, **kwargs):
        if code == "ANALYSIS_TIMEOUT":
            await asyncio.sleep(0.5)
        elif code == "DECODE_FAILED":
            video.duration_sec(path)
        else:
            raise RuntimeError("inference failed")

    monkeypatch.setattr(worker, "analyze_video", analyze)
    monkeypatch.setattr(settings, "job_timeout_sec", 0.2)
    job_id = await upload(client)
    await worker.process_job(job_id)

    body = await get(client, f"/jobs/{job_id}")
    assert body.keys() == {"job_id", "status", "queue_position", "error"}
    assert body["status"] == "failed"
    assert body["error"]["code"] == code
    assert body["error"]["message"]
    assert error_of(await client.get(f"/api/v1/jobs/{job_id}/annotations")) == (409, "JOB_FAILED")


def test_database_choice():
    assert Settings(app_env="local").database_url.startswith("sqlite+aiosqlite:///")
    prod = Settings(app_env="production", postgres_host="db", postgres_password="p@ss")
    assert prod.database_url == "postgresql+asyncpg://app:p%40ss@db:5432/app"
