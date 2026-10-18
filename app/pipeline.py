"""Async adapter for kadys_model_deploy; the backend database owns the job queue."""

import asyncio
import logging
import uuid
from pathlib import Path

import httpx

from app import video
from app.config import settings
from app.schemas import Analysis

logger = logging.getLogger(__name__)
MODELS = {"kadys-model": "Kadys model"}


class EngineAnalysisError(Exception):
    """The engine finished a job unsuccessfully."""


async def _cancel(client: httpx.AsyncClient, job_id: str) -> None:
    try:
        async with asyncio.timeout(settings.engine_cancel_timeout_sec):
            response = await client.delete(f"/api/v1/jobs/{job_id}")
            # 404 is normal when submission never reached the engine.
            if response.status_code != 404:
                response.raise_for_status()
    except (httpx.HTTPError, TimeoutError):
        logger.warning(
            "Engine cancellation was not acknowledged for %s; its hard deadline still applies",
            job_id,
        )


async def analyze_video(video_path: Path, model_id: str, *, job_id: str | None = None) -> Analysis:
    """Submit/poll one video and cancel unfinished inference before releasing the slot.

    A stable backend UUID recovers an engine job after a backend restart or lost POST
    response. Engine restart returns 404, allowing the same saved video to be submitted.
    """
    # Recover queued jobs created before the mock model was replaced.
    if model_id == "local-default":
        model_id = "kadys-model"
    if model_id not in MODELS:
        raise ValueError(f"Unknown model: {model_id}")
    if not settings.engine_api_key:
        raise ValueError("Set ENGINE_API_KEY before analysing videos")
    job_id = job_id or uuid.uuid4().hex
    completed = False

    async with httpx.AsyncClient(
        base_url=settings.engine_url.rstrip("/"),
        headers={"X-API-Key": settings.engine_api_key},
        timeout=10,
        trust_env=False,
    ) as client:
        try:
            async with asyncio.timeout(settings.engine_timeout_sec):
                result = None
                while result is None:
                    try:
                        # Lookup comes first: an existing job may be running while the
                        # engine reports busy, or done while it reloads another worker.
                        response = await client.get(f"/api/v1/jobs/{job_id}/metadata")
                        if response.status_code != 404:
                            response.raise_for_status()
                            result = response.json()
                            break
                        response = await client.get("/health")
                        response.raise_for_status()
                        health = response.json()
                        if health.get("startup_error"):
                            raise EngineAnalysisError(
                                "Engine models failed to load; inspect engine logs"
                            )
                        if not health.get("accepting"):
                            await asyncio.sleep(settings.engine_poll_interval_sec)
                            continue
                        with video_path.open("rb") as file:
                            response = await client.post(
                                "/api/v1/analyze",
                                data={"model_id": model_id, "client_job_id": job_id},
                                files={"file": (video_path.name, file, "application/octet-stream")},
                            )
                        if response.status_code in {409, 503}:
                            await asyncio.sleep(settings.engine_poll_interval_sec)
                            continue
                        response.raise_for_status()
                        if response.json()["job_id"] != job_id:
                            raise EngineAnalysisError("Engine returned an unexpected job ID")
                        result = {"status": "processing"}
                    except httpx.TransportError:
                        # On a lost POST response, look up the same UUID before retrying.
                        await asyncio.sleep(settings.engine_poll_interval_sec)

                while True:
                    try:
                        status = result["status"]
                        if status == "done":
                            response = await client.get(f"/api/v1/jobs/{job_id}/analysis")
                            response.raise_for_status()
                            analysis = Analysis.model_validate(response.json())
                            completed = True
                            return analysis
                        if status == "failed":
                            response = await client.get(f"/api/v1/jobs/{job_id}")
                            response.raise_for_status()
                            error = response.json().get("error", {})
                            code = error.get("code", "ANALYSIS_FAILED")
                            if code == "ANALYSIS_TIMEOUT":
                                raise TimeoutError("Engine analysis timed out")
                            if code == "DECODE_FAILED":
                                raise video.VideoDecodeError("Engine could not decode the video")
                            raise EngineAnalysisError(f"Engine job {job_id} failed: {code}")
                        if status != "processing":
                            raise EngineAnalysisError(f"Unexpected engine job status: {status}")
                        await asyncio.sleep(settings.engine_poll_interval_sec)
                        # Poll only tiny status metadata; fetch base64 evidence once.
                        response = await client.get(f"/api/v1/jobs/{job_id}/metadata")
                        response.raise_for_status()
                        result = response.json()
                    except httpx.TransportError:
                        await asyncio.sleep(settings.engine_poll_interval_sec)
        finally:
            if not completed:
                # Cancellation must finish before the scheduler starts its next job.
                # Shield the handshake when the outer worker deadline or shutdown fires.
                cleanup = asyncio.create_task(_cancel(client, job_id))
                try:
                    await asyncio.shield(cleanup)
                except asyncio.CancelledError:
                    await cleanup
                    raise
