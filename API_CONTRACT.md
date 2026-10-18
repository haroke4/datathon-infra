# Backend API contract

What the frontend (`frontend/src/lib/api.ts`, types in `frontend/src/lib/types.ts`) sends and expects.
The in-browser mock (`frontend/src/lib/mock-api.ts`) implements this contract for local demos.
The frontend calls the real backend by default. Mock mode requires both Vite development mode
and `VITE_USE_MOCK_API=true`; production builds always call the real backend.

## General

| | |
|---|---|
| Base URL | `/api/ui` (frontend `VITE_API_BASE_URL`) |
| Auth | None on `/api/ui`: shared browser access. In development the Vite proxy forwards `/api/ui` to `BACKEND_URL`. Jury routes under `/api/v1` require `X-API-Key` matching server-side `PUBLIC_API_KEY`. |
| Content type | JSON responses, `Content-Type: application/json`, UTF-8 |
| Timestamps | ISO 8601 with timezone, e.g. `"2026-10-18T09:15:00Z"` |
| Video times | seconds from the start of the video, float (`32.4`) |
| Client timeouts | 20 s for GET, 120 s for `POST /analyze` |

### Jury API

The jury uses the case's original paths, separate from anonymous browser routes:

- `POST /api/v1/analyze`: multipart `file`, optional `model_id`; returns `job_id` and `status`.
- `GET /api/v1/jobs/{job_id}`: status and result, with the same response fields as the UI.

Both require `X-API-Key` matching `PUBLIC_API_KEY`. Missing, wrong, empty or duplicate
key headers return `401 UNAUTHORIZED`. An unset server key rejects all jury requests.
The jury key stays server-side, separate from `ENGINE_API_KEY`; never put it in `VITE_*`.
The UI and jury use the same queue, model, stored jobs and result logic.

### Errors

Any non-2xx response must have this body:

```json
{ "error": { "code": "JOB_NOT_FOUND", "message": "Проверка не найдена." } }
```

- `message` is shown to the user **as is**, so write it in Russian, as one short user-facing sentence.
- `code` is a stable machine-readable string (`UPPER_SNAKE_CASE`).
- If the body has no `error.message` (FastAPI's default `{"detail": ...}`, for example), the user sees
  only a generic `Ошибка запроса (404). Попробуйте ещё раз.`
- A 2xx response whose body is not valid JSON shows `Сервер вернул некорректный ответ`.

### Polling

The frontend polls, so these endpoints must be cheap:

- `GET /jobs`: every **2 s**, one request at a time, paused while the tab is hidden.
- `GET /jobs/{job_id}`: every **1.5 s** while the open job is `processing`.

---

## `GET /models`

Models the user can pick on the upload screen.

**200**

```json
{
  "models": [
    { "id": "local-default", "name": "Локальная модель" },
    { "id": "yolo-v8-cash", "name": "YOLOv8 · кассы" }
  ]
}
```

| Field | Type | Notes |
|---|---|---|
| `id` | string | Sent back as `model_id` in `POST /analyze` |
| `name` | string | Shown in the model picker |

- The first model is the default, unless the user picked another model earlier (remembered in the browser).
- An empty list disables uploading and shows "Нет доступных моделей".

---

## `GET /jobs`

History for the sidebar.

**200**

```json
{
  "jobs": [
    {
      "job_id": "8f1c2e7a9b3d4c5e",
      "filename": "cash_desk_01.mov",
      "created_at": "2026-10-18T09:15:00Z",
      "model_id": "local-default",
      "status": "processing",
      "queue_position": 0
    }
  ]
}
```

| Field | Type | Notes |
|---|---|---|
| `job_id` | string | Used in every `/jobs/{job_id}` URL (URL-encoded) |
| `filename` | string | Original upload name |
| `created_at` | ISO 8601 string | The sidebar groups by date and shows `HH:MM` in the user's timezone |
| `model_id` | string | |
| `status` | `"processing"` \| `"done"` \| `"failed"` | A queued job is `"processing"` too |
| `queue_position` | integer ≥ 0 | Number of videos **ahead** of this one. `0` = being analyzed now (or finished) |

- **Sort newest first.** The frontend does not re-sort.
- Sidebar labels: `done` → "Готово", `failed` → "Ошибка", `processing` with `queue_position > 0` →
  "В очереди", otherwise "Обработка".

---

## `POST /analyze`

Upload a video for analysis.

**Request:** `multipart/form-data`

| Part | Type | Rules |
|---|---|---|
| `file` | file | `.mov`, `.mp4` or `.webm`, not empty, ≤ 100 MB |
| `model_id` | string | One of the `id`s from `GET /models` |

**202** (any 2xx is accepted)

```json
{ "job_id": "8f1c2e7a9b3d4c5e" }
```

Extra fields such as `"status": "processing"` are ignored.

Right after this call the frontend calls `GET /jobs/{job_id}`, so the job must already exist by
then: never answer 404 for a job you just accepted. If `queue_position > 0`, the user sees a
"queued" dialog; otherwise the processing screen opens.

**Errors**

| Status | `code` | Example `message` |
|---|---|---|
| 400 | `FILE_REQUIRED` | Выберите видеофайл. |
| 400 | `EMPTY_FILE` | Файл пуст. Выберите другое видео. |
| 400 | `UNKNOWN_MODEL` | Выберите доступную модель. |
| 413 | `FILE_TOO_LARGE` | Максимальный размер файла — 100 МБ. |
| 415 | `UNSUPPORTED_FORMAT` | Поддерживаются MOV, MP4 и WebM. |

---

## `GET /jobs/{job_id}`

Job status and, when done, the verdict.

**200: processing** (queued or running)

```json
{ "job_id": "8f1c2e7a9b3d4c5e", "status": "processing", "queue_position": 2 }
```

- `queue_position > 0` shows "Видео в очереди · Перед вами N видео".
- `queue_position = 0` shows "Анализируем видеозапись".

**200: done, possible violations found**

```json
{
  "job_id": "8f1c2e7a9b3d4c5e",
  "status": "done",
  "queue_position": 0,
  "verdict": "violation",
  "violations": [
    {
      "code": "B1",
      "type": "Деньги оставлены на рабочей поверхности",
      "timecode_sec": 32.0,
      "description": "На столе остаются купюры после завершения обслуживания клиента. Возможный признак нарушения; требуется проверка.",
      "evidence_frames": [
        { "timestamp_sec": 32.4, "image_base64": "/9j/4AAQSkZJRgABAQ..." }
      ]
    }
  ]
}
```

**200: done, no violations**

```json
{ "job_id": "8f1c2e7a9b3d4c5e", "status": "done", "queue_position": 0, "verdict": "no_violation", "violations": [] }
```

**200: failed**

```json
{
  "job_id": "8f1c2e7a9b3d4c5e",
  "status": "failed",
  "error": { "code": "DECODE_FAILED", "message": "Не удалось прочитать видео. Попробуйте другой файл." }
}
```

| Field | Type | Notes |
|---|---|---|
| `status` | `"processing"` \| `"done"` \| `"failed"` | |
| `queue_position` | integer ≥ 0 | Required while `processing` |
| `verdict` | `"violation"` \| `"no_violation"` | Required when `done`. `no_violation` shows "Нарушений не обнаружено" |
| `violations` | array | Required when `done`, `[]` for `no_violation`. **Order matters**: annotations refer to violations by index |
| `violations[].code` | string, optional | Catalog code (`A1`…`E1`). If omitted, the frontend looks the code up by exact `type` text |
| `violations[].type` | string | Card title and label on the box over the video |
| `violations[].timecode_sec` | float | Shown on the card. Clicking the card seeks here |
| `violations[].description` | string | Card body. Phrase it as a *possible* violation: the UI never says it is confirmed |
| `violations[].sources` | array of `{ label, url }` | Backend catalog mapping from the supplied summary table. All sources appear as clickable text on the card, including the three separate B9 anchors. Available for historical jobs and violations without annotation boxes |
| `violations[].source_note` | string | Context or applicability note from the table; empty when unnecessary |
| `violations[].evidence_frames` | array, **always present** (may be `[]`) | Retained in the API; screenshots are not displayed in the cards |
| `evidence_frames[].timestamp_sec` | float | Timestamp of the retained evidence frame |
| `evidence_frames[].image_base64` | string | **JPEG**, plain base64 **without** a `data:` prefix. All frames arrive in the one `done` response, so keep each one small (~50–150 KB) |
| `error` | `{ code, message }` | Required when `failed`. `message` is shown on the error screen |

**Errors:** 404 `JOB_NOT_FOUND` (Проверка не найдена.)

---

## `GET /jobs/{job_id}/annotations`

Where and when to draw detection boxes. Called once, when the job is `done`.

**200**

```json
{
  "duration_sec": 65.0,
  "events": [
    {
      "violation_index": 0,
      "start_sec": 32.0,
      "end_sec": 36.0,
      "box": { "x": 0.12, "y": 0.24, "width": 0.19, "height": 0.36 },
      "rule": {
        "title": "Правила ведения кассовых операций",
        "section": "п. 4.2",
        "url": "https://example.org/rules#4.2"
      },
      "rule_note": ""
    }
  ]
}
```

| Field | Type | Notes |
|---|---|---|
| `duration_sec` | float | Video length. Used for the timeline until the video's own metadata loads |
| `events[].violation_index` | integer | Index into `violations` from `GET /jobs/{job_id}` |
| `events[].start_sec`, `end_sec` | float | When the box is visible. See below |
| `events[].box` | `{ x, y, width, height }` | **Normalized 0–1** relative to the video frame, origin top-left. The label goes to the left of the box when `x > 0.5` |
| `events[].rule` | `{ title, section, url }` \| `null` | Shown on the card as "title · section". `url` is not displayed yet |
| `events[].rule_note` | string | Shown instead when `rule` is `null`, e.g. "Нормативный источник не подключён. Требуется проверка специалистом." |

How the frontend uses the times:

- Each violation is drawn on the timeline as a rectangle from the **earliest `start_sec` to the latest
  `end_sec`** among its events. You can send several events per violation, for example when the box
  moves.
- The box is shown while `start_sec ≤ current time ≤ end_sec`.
- When a review opens at 00:00, the player fast-forwards to the earliest `start_sec` of all
  violations.
- A violation with no events still appears in the list, but has no box and only a thin mark at
  `timecode_sec` on the timeline.
- The card's source links come from `violations[].sources`, mapped in the backend by
  code (or a recognized legacy title when the code is missing). The first annotation's
  `rule`/`rule_note` is a fallback for responses without catalog sources.
- `B9` sources are `№53, п.71 пп.9` → `https://adilet.zan.kz/rus/docs/V2600038336#z239`,
  `№53, п.53` → `https://adilet.zan.kz/rus/docs/V2600038336#z182`, and
  `№53, п.72` → `https://adilet.zan.kz/rus/docs/V2600038336#z240`.
- Catalog links and notes are maintained in `app/violation_sources.json`. This covers
  all 27 table rows; the reference-only D5 entry does not enable D5 detection.
- `events: []` for `no_violation`.

**Errors:** 404 `JOB_NOT_FOUND`, 409 `JOB_NOT_READY` (Анализ ещё не завершён.)

---

## `GET /jobs/{job_id}/video`

The original (or transcoded) video, loaded directly by `<video src="/api/ui/jobs/{job_id}/video">`.

- **No custom headers.** A `<video>` element cannot send custom headers; this URL needs none (no auth).
- **Range requests are required.** Answer `Range: bytes=…` with `206 Partial Content` and send
  `Accept-Ranges: bytes`. Without them, Safari won't play the video at all, and other browsers can't
  reliably seek (timeline clicks, card clicks, fast-forward). FastAPI/Starlette's `FileResponse`
  supports ranges.
- **Content-Type** must match the file: `video/mp4`, `video/quicktime` or `video/webm`.
- **Codec:** every browser plays H.264 + AAC in MP4. HEVC, common in `.mov` files from phones and
  cameras, doesn't play in every browser, and the UI then shows "Этот кодек не поддерживается
  браузером". Transcode to H.264 MP4 (`-movflags +faststart`) if you can't guarantee the input.
- **404** if the video is gone. The player can't tell this apart from a codec problem, so it shows
  the same codec message.

---

## Backend status (`app/`)

Gaps 1–11 from the previous review are implemented and covered by `tests/test_api.py`.

| What | Backend behaviour |
|---|---|
| `POST /analyze` status | Answers **200**, not 202 (the frontend accepts any 2xx; 200 is safest for the jury's script) |
| `POST /analyze` without `model_id` | Uses the first model from `GET /models` (the jury sends only `file`) |
| Size limit | 100 MB (`MAX_UPLOAD_MB`), same as the frontend |
| `GET /jobs` | The 200 newest jobs |
| `GET /jobs/{id}` | Fields that don't apply to the status are omitted, not `null` |
| `GET /jobs/{id}/annotations` on a failed job | 409 `JOB_FAILED` (Анализ завершился с ошибкой.) |
| `GET /jobs/{id}/video` | Serves an H.264 MP4 copy made by the worker (H.264 is copied as is, HEVC etc. re-encoded); the original file until the copy exists |
| Failed job `error.code` | `ANALYSIS_TIMEOUT`, `DECODE_FAILED`, `ANALYSIS_FAILED` |
| Other error codes | `NOT_FOUND` (unknown route), `VIDEO_NOT_FOUND` (404), `VALIDATION_ERROR` (422), `INTERNAL_ERROR` (500) |

