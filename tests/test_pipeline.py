import asyncio
import uuid

import httpx
import pytest
from pydantic import ValidationError

from app import pipeline
from app.config import Settings, settings


@pytest.fixture
def engine_transport(monkeypatch, tmp_path):
    original = httpx.AsyncClient
    monkeypatch.setattr(settings, "engine_poll_interval_sec", 0.001)
    path = tmp_path / "clip.mp4"
    path.write_bytes(b"video")

    def install(handler):
        monkeypatch.setattr(
            pipeline.httpx,
            "AsyncClient",
            lambda **kwargs: original(**kwargs, transport=httpx.MockTransport(handler)),
        )
        return path

    return install


async def test_lost_post_response_recovers_same_job_without_duplicate_upload(engine_transport):
    job_id = uuid.uuid4().hex
    submitted, recovered = False, False
    posts, cancels = [], []

    async def handler(request):
        nonlocal submitted, recovered
        assert request.headers["X-API-Key"] == settings.engine_api_key
        if request.method == "POST":
            posts.append(await request.aread())
            assert job_id.encode() in posts[-1]
            submitted = True
            raise httpx.ReadTimeout("response was lost", request=request)
        if request.method == "DELETE":
            cancels.append(True)
        if request.url.path.endswith("/analysis"):
            return httpx.Response(200, json={"duration_sec": 3, "violations": [], "events": []})
        if request.url.path == "/health":
            return httpx.Response(200, json={"accepting": True})
        if not submitted:
            return httpx.Response(404)
        recovered = True
        return httpx.Response(200, json={"job_id": job_id, "status": "done"})

    path = engine_transport(handler)
    result = await pipeline.analyze_video(path, "kadys-model", job_id=job_id)
    assert result.duration_sec == 3 and recovered and len(posts) == 1 and not cancels


async def test_existing_processing_job_resumes_even_while_engine_is_busy(engine_transport):
    calls = []

    async def handler(request):
        calls.append((request.method, request.url.path))
        if request.url.path.endswith("/analysis"):
            return httpx.Response(200, json={"duration_sec": 3, "violations": [], "events": []})
        return httpx.Response(200, json={"status": "processing" if len(calls) == 1 else "done"})

    await pipeline.analyze_video(
        engine_transport(handler), "local-default", job_id=uuid.uuid4().hex
    )
    assert all(method == "GET" for method, _ in calls)
    assert all(path != "/health" for _, path in calls)


@pytest.mark.parametrize("failure", ["invalid_result", "failed", "unauthorized", "timeout"])
async def test_failures_cancel_remote_work_before_return(engine_transport, monkeypatch, failure):
    cancelled = asyncio.Event()
    if failure == "timeout":
        monkeypatch.setattr(settings, "engine_timeout_sec", 0.05)

    async def handler(request):
        if request.method == "DELETE":
            await asyncio.sleep(0.01)
            cancelled.set()
            return httpx.Response(200, json={"status": "failed"})
        if failure == "unauthorized":
            return httpx.Response(401)
        if request.url.path.endswith("/analysis"):
            return httpx.Response(200, json={"invalid": True})
        return httpx.Response(
            200,
            json={
                "status": {"invalid_result": "done", "failed": "failed", "timeout": "processing"}[
                    failure
                ],
                "error": {"code": "ANALYSIS_FAILED"},
            },
        )

    expected = {
        "invalid_result": ValidationError,
        "failed": pipeline.EngineAnalysisError,
        "unauthorized": httpx.HTTPStatusError,
        "timeout": TimeoutError,
    }[failure]
    with pytest.raises(expected):
        await pipeline.analyze_video(engine_transport(handler), "kadys-model")
    assert cancelled.is_set()


def test_sequential_concurrency_and_timeout_margin_are_enforced():
    assert Settings(worker_concurrency="1").worker_concurrency == 1
    with pytest.raises(ValidationError):
        Settings(worker_concurrency=2)
    with pytest.raises(ValidationError, match="cancellation time"):
        Settings(engine_timeout_sec=239, job_timeout_sec=240)


async def test_caller_cancellation_waits_for_engine_ack(engine_transport):
    started, cancelled = asyncio.Event(), asyncio.Event()

    async def handler(request):
        if request.method == "DELETE":
            await asyncio.sleep(0.02)
            cancelled.set()
            return httpx.Response(200, json={"status": "failed"})
        started.set()
        return httpx.Response(200, json={"status": "processing"})

    task = asyncio.create_task(pipeline.analyze_video(engine_transport(handler), "kadys-model"))
    await started.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert cancelled.is_set()
