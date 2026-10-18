"""Verify the source table and enrichment of pre-existing database results."""

import pytest

from app.db import Job, JobStatus, SessionLocal
from app.schemas import Violation
from app.violation_sources import VIOLATION_SOURCES

B9_SOURCES = [
    {"label": "№53, п.71 пп.9", "url": "https://adilet.zan.kz/rus/docs/V2600038336#z239"},
    {"label": "№53, п.53", "url": "https://adilet.zan.kz/rus/docs/V2600038336#z182"},
    {"label": "№53, п.72", "url": "https://adilet.zan.kz/rus/docs/V2600038336#z240"},
]


@pytest.mark.parametrize(
    ("code", "labels"),
    [
        ("A1", ["№231"]),
        ("A2", ["№231", "№230"]),
        ("A3", ["№231"]),
        ("A4", ["№231"]),
        ("A5", ["№231", "№230"]),
        ("A6", ["№231", "№49"]),
        ("A7", ["№231 (контекст)"]),
        ("B1", ["№231"]),
        ("B2", ["№231", "№49"]),
        ("B3", ["№231", "№49"]),
        ("B4", ["№231"]),
        ("B5", ["№231"]),
        ("B6", ["№231"]),
        ("B7", ["№231"]),
        ("B8", ["№231"]),
        ("B9", ["№53, п.71 пп.9", "№53, п.53", "№53, п.72"]),
        ("C1", ["№14", "№231", "№49", "КоАП"]),
        ("C2", ["№14"]),
        ("C3", ["№14"]),
        ("D1", ["№231"]),
        ("D2", ["№231"]),
        ("D3", ["№14"]),
        ("D4", ["№14", "№231"]),
        ("D5", ["№231"]),
        ("D6", ["№231"]),
        ("D7", ["№231 (контекст)"]),
        ("E1", ["№14", "№49"]),
    ],
)
def test_every_category_matches_pdf_source_column(code, labels):
    violation = Violation(code=code, type="engine title", timecode_sec=1, description="d")
    assert [s.label for s in violation.sources] == labels
    assert all(s.url.startswith("https://adilet.zan.kz/rus/docs/") for s in violation.sources)


def test_b9_uses_all_three_exact_pdf_links_and_preserves_evidence():
    violation = Violation(
        code="B9",
        type="Рабочее место",
        timecode_sec=17,
        description="Observed action",
        evidence_frames=[{"timestamp_sec": 17, "image_base64": "AAAA"}],
        sources=[{"label": "Outdated", "url": "https://example.com"}],
    )
    assert violation.model_dump()["sources"] == B9_SOURCES
    assert "30 минут" in violation.source_note
    assert violation.evidence_frames[0].image_base64 == "AAAA"
    assert violation.description == "Observed action"


def test_legacy_titles_resolve_but_unknown_explicit_codes_do_not_inherit_sources():
    legacy = Violation(
        type="Пересчёт денег не на глазах у клиента", timecode_sec=0, description="d"
    )
    assert legacy.code == "A1"
    assert legacy.sources[0].label == "№231"
    unknown = Violation(code="Z99", type=legacy.type, timecode_sec=0, description="d")
    assert unknown.sources == []
    assert unknown.source_note == ""
    assert len(VIOLATION_SOURCES) == 27


async def test_saved_job_without_boxes_gets_sources_without_reanalysis(client):
    # A historical JSON payload predating the sources fields, with no annotation rule.
    async with SessionLocal() as session:
        session.add(
            Job(
                id="historical",
                filename="clip.mov",
                model_id="kadys-model",
                video_path="clip.mov",
                status=JobStatus.DONE,
                verdict="violation",
                duration_sec=25,
                violations=[
                    {
                        "type": "Незаблокированное активное рабочее место",
                        "timecode_sec": 17,
                        "description": "Кассир ушёл.",
                        "evidence_frames": [],
                    }
                ],
                events=[],
            )
        )
        await session.commit()
    response = await client.get("/api/ui/jobs/historical")
    assert response.status_code == 200
    violation = response.json()["violations"][0]
    assert violation["code"] == "B9"
    assert violation["sources"] == B9_SOURCES
    assert (await client.get("/api/ui/jobs/historical/annotations")).json()["events"] == []
