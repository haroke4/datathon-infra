"""Source-column mapping from the supplied violation summary dated 18 October 2026.

Keep this in the backend so new engine results and historical jobs use the same
references, independently of whether an event has any annotation boxes.
"""

import json
from pathlib import Path

VIOLATION_SOURCES = json.loads(Path(__file__).with_suffix(".json").read_text(encoding="utf-8"))
_CODE_BY_TYPE = {
    title.strip().casefold(): code
    for code, entry in VIOLATION_SOURCES.items()
    for title in (entry["type"], *entry["aliases"])
}


def source_entry(code: str | None, violation_type: str) -> tuple[str, dict] | None:
    # An explicit unknown code must not inherit references from an unrelated title.
    resolved = (
        code.strip().upper() if code else _CODE_BY_TYPE.get(violation_type.strip().casefold())
    )
    if resolved not in VIOLATION_SOURCES:
        return None
    return resolved, VIOLATION_SOURCES[resolved]
