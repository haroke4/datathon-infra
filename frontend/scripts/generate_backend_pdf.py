from pathlib import Path
from reportlab.platypus import (
    SimpleDocTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
    Preformatted,
    PageBreak,
    KeepTogether,
)
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "output/pdf/forte-backend-contract.pdf"
styles = getSampleStyleSheet()
styles.add(
    ParagraphStyle(
        name="TitleCustom",
        fontName="Helvetica",
        fontSize=27,
        leading=32,
        textColor=colors.HexColor("#302343"),
        spaceAfter=18,
    )
)
styles.add(
    ParagraphStyle(
        name="Sub",
        fontName="Helvetica-Bold",
        fontSize=14,
        leading=18,
        spaceBefore=10,
        spaceAfter=8,
        textColor=colors.HexColor("#563095"),
    )
)
styles.add(
    ParagraphStyle(name="Copy", fontName="Helvetica", fontSize=9, leading=12.5, spaceAfter=7)
)
styles.add(
    ParagraphStyle(name="SmallCustom", fontName="Helvetica", fontSize=8, leading=11, spaceAfter=5)
)
styles.add(
    ParagraphStyle(
        name="CodeCustom",
        fontName="Courier",
        fontSize=8,
        leading=11,
        leftIndent=10,
        rightIndent=8,
        backColor=colors.HexColor("#f3f0f6"),
        borderPadding=10,
        spaceBefore=5,
        spaceAfter=13,
    )
)
story = []


def p(text):
    story.append(Paragraph(text, styles["Copy"]))


def h(text):
    story.append(Paragraph(text, styles["Sub"]))


def code(text):
    story.append(Preformatted(text, styles["CodeCustom"]))


def title(kicker, text):
    story.append(Paragraph(kicker.upper(), styles["SmallCustom"]))
    story.append(Paragraph(text, styles["TitleCustom"]))


def table(rows, widths):
    data = [[Paragraph(str(x), styles["SmallCustom"]) for x in row] for row in rows]
    t = Table(data, colWidths=widths, hAlign="LEFT", repeatRows=1)
    t.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#eee8f5")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 9),
                ("RIGHTPADDING", (0, 0), (-1, -1), 9),
                ("TOPPADDING", (0, 0), (-1, -1), 8),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
                ("LINEBELOW", (0, 0), (-1, -1), 0.4, colors.HexColor("#ded9e4")),
            ]
        )
    )
    story.append(t)
    story.append(Spacer(1, 9))


def page():
    story.append(PageBreak())


title("ForteBank / frontend handoff / 17 October 2026", "Backend API contract")
p(
    "React + shadcn/ui frontend with preset <b>b4N1aI2yW</b>. This is the proposed backend contract for the supplied wireframes. The implementation currently uses an asynchronous, in-memory browser mock. It does not run a backend or perform AI analysis."
)
h("Six routes, one base path")
p(
    "Base path: <b>/api/v1</b>. JSON uses snake_case. Times are seconds from video start; created_at is an ISO 8601 UTC timestamp. The UI displays dates in the viewer's local timezone."
)
table(
    [
        ["Method + path", "Purpose / requirement"],
        ["POST /analyze", "MANDATORY JURY: accept a video and create a job."],
        ["GET /jobs/{job_id}", "MANDATORY JURY: status and final verdict."],
        ["GET /models", "UI: model dropdown options."],
        ["GET /jobs", "UI: history with current job status."],
        [
            "GET /jobs/{job_id}/annotations",
            "UI: event intervals, bounding boxes and rule references.",
        ],
        ["GET /jobs/{job_id}/video", "UI: original video for playback and seeking."],
    ],
    [240, 275],
)
h("Jury compatibility")
p(
    "Preserve the two mandatory routes and their field names. Jury uploads supply only <b>file</b>; model_id is an optional UI extension. The jury-visible status remains <b>processing | done | failed</b>. A queued job is processing with queue_position &gt; 0. Do not introduce a fourth mandatory status."
)
h("Authentication and local processing")
p(
    "Jury requests must send <b>X-API-Key</b>; reject a missing or invalid key with HTTP 401. Do not place a jury key in VITE_* variables or the JavaScript bundle. The browser calls a trusted, same-origin adapter that supplies the key. A development proxy is included; production must supply an equivalent server-side adapter. No login UI is included."
)
p(
    "Actual analysis, model weights and evidence generation must run on your own local service. No uploaded video or evidence is sent to a cloud AI service by this mock frontend."
)

page()
title("01 / mandatory jury endpoint", "Upload and start analysis")
h("POST /api/v1/analyze")
p(
    "<b>Content-Type:</b> multipart/form-data. <b>Authentication:</b> X-API-Key. Return <b>202 Accepted</b> after accepting the upload; do not wait for model inference."
)
table(
    [
        ["Field", "Expected data"],
        [
            "file (required)",
            "Binary video file. MOV is mandatory for jury compatibility. The current UI also accepts MP4 and WebM. Reject empty or undecodable files server-side.",
        ],
        [
            "model_id (optional)",
            "String ID returned by GET /models. Omission must select the default local model. Demo model IDs are frontend mock fixtures only.",
        ],
    ],
    [140, 375],
)
code(
    'POST /api/v1/analyze\nX-API-Key: <jury-key>\nContent-Type: multipart/form-data; boundary=...\n\nfile: <binary video>\nmodel_id: local-default  # optional\n\nHTTP/1.1 202 Accepted\n{ "job_id": "3f2a9c1e" }'
)
p(
    "<b>job_id:</b> opaque non-empty string, stable for this job. The frontend does not parse its format. Queue state is read through GET /jobs/{job_id} immediately after upload."
)
h("Video expectations")
p(
    "The case describes MOV clips of about 29 MB, 10-145 seconds, with no audio required for analysis. The UI mock uses a <b>100 MiB</b> upload cap as a proposed project limit, not a case requirement. Backend and gateway limits must agree with it or the UI validation must be changed."
)
p(
    "MOV is a container, not a guarantee of browser playback. Accept the original MOV for inference; if its codec is unsupported by browsers, provide a playable H.264 MP4 rendition through the video endpoint. Keep its timebase and frame geometry aligned with the original."
)
h("Example jury request")
code(
    'curl -X POST https://team.example.kz/api/v1/analyze \\\n  -H "X-API-Key: <jury-key>" \\\n  -F "file=@video_017.mov"'
)
h("Upload errors")
p(
    "400: missing/empty file or unknown model. 401: missing/invalid key. 413: file exceeds configured limit. 415: unsupported format or codec. 503: backend cannot accept work. Return the shared error envelope described on page 6."
)

page()
title("02 / mandatory jury endpoint", "Status and final result")
h("GET /api/v1/jobs/{job_id}")
p(
    "Return <b>200 OK</b> for an existing job. Poll at 1.5-second intervals while processing. Backend processing must complete within the case's 5-minute window. queue_position is an optional UI extension: 0 = currently running, 1 = next waiting job. It is not an estimated wait time."
)
code('{\n  "job_id": "3f2a9c1e",\n  "status": "processing",\n  "queue_position": 0\n}')
p(
    "Completed violation response below uses illustrative English text. Supply user-facing type and description strings in the interface language (Russian in this frontend). The JPEG string is abbreviated here; the backend must return real JPEG bytes encoded as base64, without a data-URL prefix."
)
code(
    '{\n  "job_id": "3f2a9c1e",\n  "status": "done",\n  "verdict": "violation",\n  "violations": [\n    {\n      "type": "Cash left on the work surface",\n      "timecode_sec": 32.0,\n      "description": "Observed action and why review is needed.",\n      "evidence_frames": [\n        { "timestamp_sec": 32.0,\n          "image_base64": "<complete JPEG base64>" }\n      ]\n    }\n  ]\n}'
)
table(
    [
        ["Field", "Contract"],
        ["status", "processing | done | failed."],
        ["verdict", "Required for done: violation | no_violation."],
        [
            "violations",
            "Required for done: array, empty for no_violation; one or more events for violation.",
        ],
        [
            "type / description",
            "Non-empty strings: event category and visually supported explanation.",
        ],
        ["timecode_sec", "Finite number, 0 through video duration."],
        ["evidence_frames", "1-3 JPEG frames per real violation; timestamp_sec plus image_base64."],
    ],
    [140, 375],
)
code(
    '{ "job_id": "clean-id", "status": "done",\n  "verdict": "no_violation", "violations": [] }\n\n{ "job_id": "failed-id", "status": "failed",\n  "error": { "code": "ANALYSIS_FAILED",\n             "message": "Human-readable explanation" } }'
)

page()
title("03 / additional UI endpoints", "Models and history")
h("GET /api/v1/models")
p(
    "Return <b>200 OK</b>. Options must represent locally available models. The first option is the frontend's initial selection and should also be the backend default when model_id is omitted. Each id must be unique and stable; name is the visible dropdown label."
)
code('{\n  "models": [\n    { "id": "local-default", "name": "Local model" }\n  ]\n}')
p(
    "The mock also returns <b>demo-violations</b> and <b>demo-clean</b> so both result wireframes can be exercised. These IDs select fixed mock outcomes; no model is executed. Replace these options with actual models in the real backend. An empty model array disables upload."
)
h("GET /api/v1/jobs")
p(
    "Return <b>200 OK</b> with newest jobs first. The frontend groups by display date and shows the time and status in the left drawer. Polling every 2 seconds keeps the drawer current. This small prototype has no pagination, filters, deletion or search."
)
code(
    '{\n  "jobs": [\n    {\n      "job_id": "3f2a9c1e",\n      "filename": "cash_desk_01.mov",\n      "created_at": "2026-10-17T14:34:00Z",\n      "model_id": "local-default",\n      "status": "processing",\n      "queue_position": 0\n    }\n  ]\n}'
)
table(
    [
        ["Field", "Expected data"],
        ["job_id", "String; same ID used by result, annotations and video routes."],
        [
            "filename",
            "Original filename as a string. Shown on the player and as a history-row tooltip.",
        ],
        ["created_at", "ISO 8601 UTC datetime, including timezone."],
        ["model_id", "String ID matching the selected model."],
        ["status", "processing | done | failed."],
        ["queue_position", "Non-negative integer: 0 = running or terminal; positive = waiting."],
    ],
    [140, 375],
)
p(
    "Scope real history to the intended local installation or authorized viewer. The mock history is held in browser memory and resets on page reload, with four clearly labeled fixture checks. Uploaded files are not persisted by the mock."
)

page()
title("04 / additional UI endpoints", "Annotations and playback")
h("GET /api/v1/jobs/{job_id}/annotations")
p(
    "Return <b>200 OK</b> once the result is done, or <b>409 JOB_NOT_READY</b>. Return events: [] for a clean result. This separate response adds display metadata without altering the jury schema."
)
code(
    '{\n  "duration_sec": 65.0,\n  "events": [\n    {\n      "violation_index": 0,\n      "start_sec": 32.0,\n      "end_sec": 36.0,\n      "box": { "x": 0.12, "y": 0.24,\n               "width": 0.19, "height": 0.36 },\n      "rule": {\n        "title": "Verified official document title",\n        "section": "Exact clause or section",\n        "url": "https://<verified-official-source>"\n      },\n      "rule_note": "Short rule-to-observation explanation"\n    }\n  ]\n}'
)
p(
    "<b>violation_index:</b> zero-based index into the mandatory result's violations array. Keep that order stable. <b>start_sec/end_sec:</b> interval over which the overlay is visible; 0 &lt;= start_sec &lt;= end_sec &lt;= duration_sec. The event timecode should lie inside its interval."
)
p(
    "<b>box:</b> normalized top-left x/y and positive width/height relative to the displayed, orientation-corrected video frame. Each value is in [0,1], with x + width &lt;= 1 and y + height &lt;= 1. The UI accounts for letterboxing. This simple UI supports one box per event interval, without tracking/interpolation."
)
p(
    "<b>rule:</b> object with document title, section and verified source URL, or null when unavailable. Never fabricate a legal citation. The UI displays title + section; when null, it displays rule_note instead. Mock rules are null with an explicit demo notice. Replace them before real evaluation."
)
h("GET /api/v1/jobs/{job_id}/video")
p(
    "Return the original or time-aligned browser-playable rendition as a binary body. Use the appropriate Content-Type (e.g. video/mp4), Content-Length and <b>Accept-Ranges: bytes</b>. Implement Range requests with <b>206 Partial Content</b> and Content-Range; invalid ranges return 416. Seeking must not require downloading the whole video again."
)
p(
    "The frontend assigns this same-origin URL directly to the video element. The trusted adapter must therefore also support media requests and range forwarding. In mock mode, uploads play from browser-local blob URLs. Seeded history entries intentionally have no source video and show a labeled placeholder with a working demo timeline."
)

page()
title("05 / implementation handoff", "Data, errors and remaining work")
h("Minimum backend data")
table(
    [
        ["Record", "Store or derive"],
        ["Model", "id, visible name, local weights/configuration and default selection."],
        [
            "Job",
            "job_id, original filename, model_id, created_at, status, queue_position; original file path; playable rendition path; duration; failure details.",
        ],
        [
            "Result",
            "verdict plus ordered violations; each has type, timecode_sec, description and 1-3 evidence JPEGs.",
        ],
        [
            "Event metadata",
            "violation_index, interval, normalized box; verified rule title/section/URL, or a clear reason for an unavailable rule.",
        ],
        [
            "Queue",
            "Serial work order; a queued upload becomes active automatically after the preceding job finishes.",
        ],
    ],
    [105, 410],
)
h("Common error envelope")
code(
    'HTTP/1.1 404 Not Found\n{\n  "error": {\n    "code": "JOB_NOT_FOUND",\n    "message": "Human-readable message for the UI"\n  }\n}'
)
p(
    "Use 400 for invalid input, 401 for missing/invalid jury key, 404 for an unknown job or unavailable media, 409 for annotations requested too early, 413 for size limit, 415 for unsupported media, 416 for invalid byte range and 500/503 for server failures. A known job whose inference failed returns HTTP 200 with status: failed and an error object. The UI displays error.message and provides a retry/upload action."
)
h("Frontend integration")
p(
    "Default: VITE_USE_MOCK_API=true (or unset). To connect a backend, set VITE_USE_MOCK_API=false. Keep VITE_API_BASE_URL=/api/v1 and configure BACKEND_URL plus BACKEND_API_KEY in the development environment. Restart the development server after changing them. These BACKEND_* values stay in the development server; they are not bundled into the frontend."
)
p(
    "For production, serve dist from your local application server and forward /api/v1 through a trusted adapter that injects the jury key. The development proxy is not a production server. The browser client uses credentials: include; cross-origin deployment would require a separate explicit CORS/cookie setup."
)
h("Explicitly skipped")
p(
    "<b>No real inference/backend, model weights, durable storage, real evidence images, verified legal-source mapping, API-key issuance/enforcement, production adapter, transcoding or deployment.</b> The mock returns fixed outcomes after about 18 seconds per queued video; local-default behaves like the violations demo. Its evidence_frames arrays are empty, so mock responses are not jury-ready evidence."
)
p(
    "No authentication screens, dashboards, reporting/export, batch upload, analytics or reviewer actions were added. History and model selection are included because they appear in the supplied wireframes. Uploaded MOV playback depends on the browser codec; unsupported media gets a clear message."
)


def footer(canvas, doc):
    canvas.saveState()
    w, h = A4
    canvas.setStrokeColor(colors.HexColor("#ddd6e6"))
    canvas.line(40, 40, w - 40, 40)
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(colors.HexColor("#6d6375"))
    canvas.drawString(40, 27, "FORTEBANK / FRONTEND-BACKEND HANDOFF")
    canvas.drawRightString(w - 40, 27, str(doc.page))
    canvas.restoreState()


SimpleDocTemplate(
    str(OUT),
    pagesize=A4,
    rightMargin=40,
    leftMargin=40,
    topMargin=36,
    bottomMargin=54,
    title="ForteBank - Backend API contract",
    author="Frontend handoff",
).build(story, onFirstPage=footer, onLaterPages=footer)
print(OUT)
