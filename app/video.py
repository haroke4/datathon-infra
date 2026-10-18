"""ffmpeg helpers (ffmpeg/ffprobe must be on PATH)."""

import asyncio
import base64
import subprocess
from pathlib import Path

from app.config import settings


class VideoDecodeError(Exception):
    """The file is not a readable video."""


def _run(args: list[str]) -> bytes:
    result = subprocess.run(args, capture_output=True, check=False)
    if result.returncode != 0:
        raise VideoDecodeError(result.stderr.decode(errors="replace")[-500:])
    return result.stdout


def _probe(path: Path, entries: str) -> str:
    out = _run(
        [
            "ffprobe",
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            entries,
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(path),
        ]
    )
    return out.decode().strip()


def duration_sec(path: Path) -> float:
    value = _probe(path, "format=duration")
    try:
        return float(value)
    except ValueError:
        raise VideoDecodeError(f"no duration in {path.name}") from None


def frame_base64(path: Path, timestamp_sec: float, width: int = 640) -> str:
    """One frame as base64 JPEG, scaled down so the JSON response stays small."""
    jpeg = _run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-ss",
            f"{timestamp_sec:.3f}",
            "-i",
            str(path),
            "-frames:v",
            "1",
            "-vf",
            f"scale='min({width},iw)':-2",
            "-q:v",
            "4",
            "-f",
            "image2",
            "-c:v",
            "mjpeg",
            "pipe:1",
        ]
    )
    return base64.b64encode(jpeg).decode("ascii")


async def _async_run(args: list[str]) -> bytes:
    process = await asyncio.create_subprocess_exec(
        *args, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
    )
    try:
        async with asyncio.timeout(settings.playback_timeout_sec):
            stdout, stderr = await process.communicate()
    except BaseException:
        if process.returncode is None:
            process.kill()
        await process.wait()
        raise
    if process.returncode:
        raise VideoDecodeError(stderr.decode(errors="replace")[-500:])
    return stdout


async def make_browser_mp4(src: Path, dst: Path) -> None:
    """H.264 MP4 that every browser plays and can seek. Copies H.264 as is (fast),
    re-encodes anything else (e.g. HEVC from phones). Audio is dropped: the analysis is visual."""
    source_codec = await _async_run(
        [
            "ffprobe",
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=codec_name",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(src),
        ]
    )
    codec = (
        ["-c:v", "copy"]
        if source_codec.decode().strip() == "h264"
        else [
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "23",
            "-pix_fmt",
            "yuv420p",
            "-threads",
            str(settings.playback_threads),
        ]
    )
    tmp = dst.with_suffix(".tmp.mp4")
    try:
        await _async_run(
            [
                "ffmpeg",
                "-v",
                "error",
                "-y",
                "-threads",
                str(settings.playback_threads),
                "-filter_threads",
                "1",
                "-i",
                str(src),
                "-map",
                "0:v:0",
                *codec,
                "-an",
                "-movflags",
                "+faststart",
                str(tmp),
            ]
        )
        tmp.replace(dst)
    finally:
        tmp.unlink(missing_ok=True)
