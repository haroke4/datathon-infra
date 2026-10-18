from pathlib import Path
from typing import Literal

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy import URL

ROOT_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ROOT_DIR / ".env", extra="ignore")

    # local -> SQLite in data/app.db, production -> Postgres from POSTGRES_*
    app_env: Literal["local", "production"] = "local"

    postgres_host: str = "localhost"
    postgres_port: int = 5432
    postgres_user: str = "app"
    postgres_password: str = ""
    postgres_db: str = "app"

    data_dir: Path = ROOT_DIR / "data"  # SQLite file + uploaded videos (gitignored)
    max_upload_mb: int = 100  # same limit as the frontend
    # Required on jury /api/v1 routes; the shared browser uses anonymous /api/ui routes.
    public_api_key: str = Field(default="", repr=False)
    job_timeout_sec: float = Field(default=240, gt=0)
    # The engine owns one warm model process. Keep queueing here, not in the engine.
    worker_concurrency: int = Field(default=1, ge=1, le=1)
    engine_url: str = "http://127.0.0.1:8001"
    engine_api_key: str = Field(default="", repr=False)
    engine_timeout_sec: float = Field(default=220, gt=0)
    engine_poll_interval_sec: float = Field(default=1, gt=0)
    engine_cancel_timeout_sec: float = Field(default=5, gt=0, le=10)
    playback_threads: int = Field(default=2, ge=1, le=12)
    playback_timeout_sec: float = Field(default=240, gt=0)

    @model_validator(mode="after")
    def engine_timeout_margin(self):
        if self.engine_timeout_sec + self.engine_cancel_timeout_sec + 5 > self.job_timeout_sec:
            raise ValueError(
                "JOB_TIMEOUT_SEC must exceed ENGINE_TIMEOUT_SEC by cancellation time + 5s"
            )
        return self

    @property
    def database_url(self) -> str:
        if self.app_env == "production":
            return URL.create(
                "postgresql+asyncpg",
                username=self.postgres_user,
                password=self.postgres_password,
                host=self.postgres_host,
                port=self.postgres_port,
                database=self.postgres_db,
            ).render_as_string(hide_password=False)
        return f"sqlite+aiosqlite:///{self.data_dir / 'app.db'}"

    @property
    def upload_dir(self) -> Path:
        return self.data_dir / "uploads"


settings = Settings()
