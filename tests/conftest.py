import os
import tempfile

# Settings are read at import time, so point the app at a throwaway SQLite before importing it.
os.environ.update(APP_ENV="local", DATA_DIR=tempfile.mkdtemp(), ENGINE_API_KEY="test-engine-key")

import subprocess  # noqa: E402

import pytest  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402
from sqlalchemy import delete  # noqa: E402

from app.db import Base, Job, SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture(scope="session", autouse=True)
async def _schema():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    await engine.dispose()


@pytest.fixture(autouse=True)
async def _empty_jobs():
    # Queue positions depend on every job in the table.
    async with SessionLocal() as session:
        await session.execute(delete(Job))
        await session.commit()


@pytest.fixture(scope="session")
def clip(tmp_path_factory) -> bytes:
    """A real 3 s H.264 .mov made by ffmpeg."""
    path = tmp_path_factory.mktemp("clip") / "clip.mov"
    subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "testsrc=duration=3:size=320x240:rate=10",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            str(path),
        ],
        check=True,
    )
    return path.read_bytes()


@pytest.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
