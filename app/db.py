import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from enum import StrEnum
from pathlib import Path
from typing import Any

from sqlalchemy import JSON, DateTime, String, Text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from app.config import settings

settings.upload_dir.mkdir(parents=True, exist_ok=True)

engine = create_async_engine(settings.database_url)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)


async def get_session() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        yield session


def utcnow() -> datetime:
    return datetime.now(UTC)


class Base(DeclarativeBase):
    pass


class JobStatus(StrEnum):
    QUEUED = "queued"
    PROCESSING = "processing"
    DONE = "done"
    FAILED = "failed"


class Job(Base):
    __tablename__ = "jobs"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: uuid.uuid4().hex)
    status: Mapped[str] = mapped_column(String(16), default=JobStatus.QUEUED, index=True)
    filename: Mapped[str] = mapped_column(String(255))
    model_id: Mapped[str] = mapped_column(String(64))
    video_path: Mapped[str] = mapped_column(String(512))
    duration_sec: Mapped[float | None]
    verdict: Mapped[str | None] = mapped_column(String(16))
    violations: Mapped[list[dict[str, Any]] | None] = mapped_column(JSON)
    events: Mapped[list[dict[str, Any]] | None] = mapped_column(JSON)  # annotation boxes
    error_code: Mapped[str | None] = mapped_column(String(64))
    error: Mapped[str | None] = mapped_column(Text)  # user-facing message
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    @property
    def playback_path(self) -> Path:
        """Browser-friendly MP4 copy made by the worker; the original is used until it exists."""
        return Path(self.video_path).with_suffix(".play.mp4")
