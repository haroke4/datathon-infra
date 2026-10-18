import os
import sqlite3
import subprocess
import sys


def test_review_migration_preserves_existing_jobs_and_is_reversible(tmp_path):
    env = {**os.environ, "APP_ENV": "local", "DATA_DIR": str(tmp_path)}

    def migrate(revision):
        subprocess.run(
            [sys.executable, "-m", "alembic", "upgrade", revision],
            env=env,
            check=True,
            capture_output=True,
        )

    migrate("1bebe03a4446")
    path = tmp_path / "app.db"
    with sqlite3.connect(path) as db:
        db.execute(
            "INSERT INTO jobs (id, status, filename, video_path, created_at, model_id) "
            "VALUES ('existing', 'done', 'old.mov', '/tmp/old.mov', '2026-10-18', 'local')"
        )
    migrate("head")
    with sqlite3.connect(path) as db:
        assert db.execute("SELECT filename FROM jobs WHERE id='existing'").fetchone() == (
            "old.mov",
        )
        assert db.execute("SELECT COUNT(*) FROM violation_reviews").fetchone() == (0,)
    subprocess.run(
        [sys.executable, "-m", "alembic", "downgrade", "1bebe03a4446"],
        env=env,
        check=True,
        capture_output=True,
    )
    migrate("head")
    with sqlite3.connect(path) as db:
        assert db.execute("SELECT COUNT(*) FROM jobs").fetchone() == (1,)
