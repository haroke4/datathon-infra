"""Backend + scheduler + actual kadys_model_deploy API/supervisor, without ML weights."""

import asyncio
import base64
import json
import os
from pathlib import Path

import httpx
import pytest

from app import pipeline, video, worker
from app.config import settings
from tests.engine_fake import inference_worker
from tests.test_api import get, upload


async def wait_for(predicate, timeout=10):
    async with asyncio.timeout(timeout):
        while True:
            value = await predicate()
            if value:
                return value
            await asyncio.sleep(0.02)


@pytest.fixture
async def engine_api(tmp_path, monkeypatch, clip):
    source = Path(
        os.environ.get(
            "KADYS_ENGINE_SOURCE", Path(__file__).resolve().parents[2] / "dathaton_engine_deploy"
        )
    )
    if not (source / "api" / "service.py").exists():
        pytest.skip("Set KADYS_ENGINE_SOURCE to the kadys_model_deploy checkout")
    monkeypatch.syspath_prepend(str(source))
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[1]))
    from api.main import create_app
    from api.service import EngineService, ServiceConfig

    root = tmp_path / "engine"
    root.mkdir()
    source_video = tmp_path / "source.mov"
    source_video.write_bytes(clip)
    (root / "evidence.txt").write_text(video.frame_base64(source_video, 1.5))
    service = EngineService(ServiceConfig(root, deadline_s=1.2), inference_worker)
    app = create_app(service, api_key=settings.engine_api_key)
    original = httpx.AsyncClient

    def factory(**kwargs):
        if kwargs.get("base_url") == settings.engine_url.rstrip("/"):
            kwargs["transport"] = httpx.ASGITransport(app=app)
        return original(**kwargs)

    monkeypatch.setattr(pipeline.httpx, "AsyncClient", factory)
    monkeypatch.setattr(settings, "engine_poll_interval_sec", 0.02)
    async with app.router.lifespan_context(app):

        async def ready():
            return service.health()["accepting"]

        await wait_for(ready)
        yield service
        await worker.stop()


async def test_scheduler_sends_three_videos_fifo_one_at_a_time(client, engine_api, clip):
    ids = [await upload(client, clip, name=f"clip-{i}.mov") for i in range(3)]
    await worker.start()

    async def first_started():
        return engine_api.active == ids[0]

    await wait_for(first_started)
    assert (await get(client, f"/jobs/{ids[1]}"))["queue_position"] == 1
    assert (await get(client, f"/jobs/{ids[2]}"))["queue_position"] == 2

    async def all_finished():
        jobs = (await get(client, "/jobs"))["jobs"]
        return len(jobs) == 3 and all(j["status"] == "done" for j in jobs)

    await wait_for(all_finished)
    await worker.stop()

    trace = [
        json.loads(line)
        for line in (engine_api.settings.root / "trace.log").read_text().splitlines()
    ]
    assert [(row["event"], row["job_id"]) for row in trace] == [
        (event, job_id) for job_id in ids for event in ["start", "end"]
    ]
    assert list(engine_api.jobs) == ids
    result = await get(client, f"/jobs/{ids[0]}")
    assert result["verdict"] == "violation"
    assert result["violations"][0]["code"] == "B5"
    jpeg = base64.b64decode(result["violations"][0]["evidence_frames"][0]["image_base64"])
    assert jpeg.startswith(b"\xff\xd8")
    annotations = await get(client, f"/jobs/{ids[0]}/annotations")
    assert annotations["duration_sec"] == 3
    assert annotations["events"][0]["violation_index"] == 0
    assert annotations["events"][0]["box"]["width"] == 0.3
    playback = await client.get(f"/api/ui/jobs/{ids[0]}/video", headers={"Range": "bytes=0-99"})
    assert playback.status_code == 206 and len(playback.content) == 100


async def test_timed_out_video_is_stopped_before_next_is_sent(client, engine_api, clip):
    old_process = engine_api.process
    first = await upload(client, b"hang")
    second = await upload(client, clip)
    await worker.start()

    async def finished():
        a, b = await get(client, f"/jobs/{first}"), await get(client, f"/jobs/{second}")
        return (a, b) if a["status"] == "failed" and b["status"] == "done" else None

    a, _b = await wait_for(finished)
    assert a["error"]["code"] == "ANALYSIS_TIMEOUT"
    with pytest.raises(ValueError, match="closed"):
        old_process.is_alive()
    assert engine_api.jobs[first]["status"] == "failed"


async def test_shutdown_cancels_engine_then_start_recovers_backend_job(client, engine_api, clip):
    first = await upload(client, b"hang")
    second = await upload(client, clip)
    await worker.start()

    async def started():
        return engine_api.active == first

    await wait_for(started)
    await worker.stop()
    assert engine_api.get(first)["error"]["code"] == "CANCELLED"
    assert worker._drain_task is None
    # Startup requeues an interrupted backend row. The engine's prior cancellation
    # is reported as a failure; the following saved video still runs successfully.
    await worker.start()

    async def finished():
        return (await get(client, f"/jobs/{first}"))["status"] == "failed" and (
            await get(client, f"/jobs/{second}")
        )["status"] == "done"

    await wait_for(finished)


async def test_backend_timeout_cancels_engine_before_releasing_slot(
    client, engine_api, clip, monkeypatch
):
    first = await upload(client, b"hang")
    second = await upload(client, clip)
    old_process = engine_api.process

    async def analyse(path, model_id, *, job_id):
        if job_id == first:
            async with asyncio.timeout(0.2):
                return await pipeline.analyze_video(path, model_id, job_id=job_id)
        return await pipeline.analyze_video(path, model_id, job_id=job_id)

    monkeypatch.setattr(worker, "analyze_video", analyse)
    await worker.start()

    async def finished():
        return (await get(client, f"/jobs/{first}"))["status"] == "failed" and (
            await get(client, f"/jobs/{second}")
        )["status"] == "done"

    await wait_for(finished)
    assert engine_api.get(first)["error"]["code"] == "CANCELLED"
    with pytest.raises(ValueError, match="closed"):
        old_process.is_alive()
