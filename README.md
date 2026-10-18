# Cashier Compliance API — Datathon 26 / ForteBank

FastAPI backend connected to `dathaton_engine` branch `kadys_model_deploy`.
Upload a video, poll its job, and retrieve real engine violations, evidence and annotations.
The frontend continues to use the backend's existing `/api/v1` contract.

## Processing

1. `POST /api/v1/analyze` saves the video and a `queued` database row.
2. APScheduler wakes a single FIFO queue drain. Exactly one video holds the processing slot.
3. The async client in `app/pipeline.py` waits for engine readiness, uploads the video and
   polls its result. The backend job UUID is also the engine job UUID, so a lost POST response
   or a backend restart can recover an existing engine job without duplicate inference.
4. The backend stores duration, catalog codes, evidence and normalized player boxes from
   the engine's `/analysis` endpoint. Job history and video playback remain in this service.
5. Failed or timed-out requests cancel the engine before releasing the processing slot.
   Engine busy/loading responses keep the next video waiting. The engine independently
   enforces its own hard deadline.

`WORKER_CONCURRENCY=1` is enforced in settings. Run one Uvicorn process; an exclusive
lock in the shared data directory prevents duplicate scheduler instances. Unfinished
backend jobs are requeued on startup. If the recovered engine job was already cancelled
or failed, that failure is saved and the queue continues. Previously completed mock jobs
remain historical mock results; submit a new video to use the real model.

## Local development

Requires `uv`, Python 3.12–3.13, and `ffmpeg` on PATH. The engine uses its own Python 3.11
virtual environment. Keep both projects separate.

```bash
uv sync --locked
# On a fresh checkout only: copy .env.example to .env and configure it.
make dev
```

Configure these values in the backend `.env`:

```dotenv
ENGINE_URL=http://127.0.0.1:8001
ENGINE_API_KEY=your-shared-private-key
ENGINE_TIMEOUT_SEC=220
JOB_TIMEOUT_SEC=240
WORKER_CONCURRENCY=1
PLAYBACK_THREADS=2
```

Start the `kadys_model_deploy` engine on port 8001 with the same `ENGINE_API_KEY` and
its downloaded model weights. See that checkout's `docs/deployment.md` for native setup.
The engine model is `kadys-model`; interrupted jobs with the old `local-default` ID are
mapped to it. Missing engine credentials fail analysis rather than returning mock data.

```bash
cd frontend
VITE_USE_MOCK_API=false BACKEND_URL=http://127.0.0.1:8000 npm run dev
```

Native local `.env` files are configured for these addresses. Never expose the private
engine key in a `VITE_*` variable or commit environment files.

## Ubuntu ARM deployment

See [deploy/README.md](deploy/README.md). The main Compose stack now includes Postgres,
the backend, the engine from the sibling `kadys_model_deploy` checkout, and the frontend.
Both API services are private; host nginx provides HTTPS through `127.0.0.1:8080`.

The initial CPU allocation is 8 PyTorch threads, 2 ONNX threads and at most 2 playback
threads, with one video active. H.264 is remuxed rather than re-encoded. Other codecs use
bounded, cancellable ffmpeg processes. Models remain warm between successful videos.
These settings avoid competing video jobs; optimal throughput still needs measurement
on the actual N4A server. Full VLM inference is enabled; there is no mock fallback.

Engine deadline: 210 seconds. Backend engine-client deadline: 220 seconds, plus a bounded
5-second cancellation handshake. Outer backend analysis deadline: 240 seconds. Queue
waiting is additional; accepting many videos cannot guarantee five minutes from upload.

## Tests

```bash
uv run pytest -q
uv run ruff check app tests
```

Integration tests use the actual deployment engine API and process supervisor with a
spawned dummy inference worker. They verify FIFO ordering, one active video, timeout and
shutdown cancellation, result/evidence mapping, and Range playback without loading ML
weights. Set `KADYS_ENGINE_SOURCE` if the engine checkout is not at
`../dathaton_engine_deploy`; those tests skip when no deployment checkout is available.
