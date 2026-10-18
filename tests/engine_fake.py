"""Spawned inference double; real engine HTTP routes and supervisor remain in use."""

import json
import time
from pathlib import Path


def inference_worker(connection, settings):
    connection.send(("ready", None))
    while True:
        request = connection.recv()
        job_id = request["job_id"]
        path = Path(request["path"])
        with (settings.root / "trace.log").open("a") as trace:
            trace.write(json.dumps({"event": "start", "job_id": job_id}) + "\n")
        if path.read_bytes() == b"hang":
            time.sleep(60)
        time.sleep(0.3)
        evidence = {
            "timestamp_sec": 1.5,
            "image_base64": (settings.root / "evidence.txt").read_text(),
        }
        violation = {
            "type": "Сейф или хранилище открыты",
            "timecode_sec": 1.5,
            "description": "Признаки возможного нарушения: сейф открыт.",
            "evidence_frames": [evidence],
        }
        analysis = {
            "duration_sec": 3,
            "violations": [{**violation, "code": "B5"}],
            "events": [
                {
                    "violation_index": 0,
                    "start_sec": 1.3,
                    "end_sec": 1.7,
                    "box": {"x": 0.1, "y": 0.2, "width": 0.3, "height": 0.4},
                    "rule": None,
                    "rule_note": "test",
                }
            ],
        }
        with (settings.root / "trace.log").open("a") as trace:
            trace.write(json.dumps({"event": "end", "job_id": job_id}) + "\n")
        connection.send(
            (
                "done",
                {
                    "result": {
                        "job_id": job_id,
                        "status": "done",
                        "verdict": "violation",
                        "violations": [violation],
                    },
                    "analysis": analysis,
                },
            )
        )
