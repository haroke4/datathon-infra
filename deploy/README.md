# baklashka.toilap.com — backend and inference deployment

The Compose stack connects the real backend to branch `kadys_model_deploy`. The backend
owns the database queue and dispatches one video at a time. No mock inference is used.
The existing site remains a public shared demo with no login.

The frontend uses anonymous `/api/ui/*` routes. The jury uses `POST /api/v1/analyze`
and `GET /api/v1/jobs/{job_id}`, both requiring `X-API-Key` matching `PUBLIC_API_KEY`.
Missing, wrong, empty or duplicate keys return `401 UNAUTHORIZED`. The installer
creates and preserves a separate `baklashka-ne-prolivay-...` key in `.env`; do not put
it in frontend variables. All routes share the existing queue and stored results.

When updating an existing deployment, configure `PUBLIC_API_KEY` and rebuild `api` and
`web` together. Reload web nginx after recreating the API container. Also add the new
`/api/ui/analyze` rate-limit location from `nginx-host.conf` to the existing host config,
preserving Certbot's TLS settings. Existing `/api/v1` browser bundles require a reload.

## Current server connection

The deployed VM is `datathon-eu`, in project `project-4cdf6fc1-d81c-4044-855`,
zone `europe-west3-b`. The existing Google Cloud SSH-in-browser session uses
`hadismuktar06`; application sources are in `/opt/datathon` and
`/opt/dathaton_engine_deploy`. Open the VM's SSH button in Google Cloud Console
using the account that owns this project. No new SSH keys are required.

## Prepare the engine source

Place the engine deployment checkout next to the datathon directory:

```bash
git clone --single-branch --branch kadys_model_deploy \
  https://github.com/kadysmuktaruly/dathaton_engine.git ../dathaton_engine_deploy
```

For another location, set `ENGINE_SOURCE_DIR` in datathon's `.env`. This must point to the
checkout containing the deployment branch's Dockerfile and `api/service.py`.

## Install or update the Ubuntu 24.04 ARM server

From the datathon directory, run:

```bash
sudo bash deploy/install-web.sh
```

The installer preserves existing database credentials, generates a private engine key
when missing, builds all services, downloads CPU Qwen/detector/pose weights into persistent
volumes, and waits up to 900 seconds for model startup. It preserves existing TLS setup.
The ARM image and full inference were verified on the N4A VM on October 18, 2026;
repeat the checks below after future releases.

If deploying without the installer, set a strong `ENGINE_API_KEY` and database password
in `.env`, then run:

```bash
docker compose build
docker compose run --rm --no-deps -e HF_HUB_OFFLINE=0 engine python -m tools.download_weights
docker compose up -d --wait --wait-timeout 900
```

The shared key is injected into both containers. The engine runs offline after weight
preparation. The backend uses `http://engine:8001` on the same private Compose network;
localhost inside its container would point to the wrong service. The earlier standalone
engine Compose override is unnecessary with this combined stack.

For best detection coverage, install the fine-tuned `detector_ft` checkpoint from the
engine repository's `detector-ft-v1` release. Follow its SHA-256 verification instructions,
unpack to `weights/detector_ft`, then copy it into this stack's engine volume:

```bash
docker compose run --rm --no-deps -v "$PWD/weights/detector_ft:/checkpoint:ro" engine \
  python -c "import shutil; shutil.copytree('/checkpoint','/app/weights/detector_ft',dirs_exist_ok=True)"
```

Set `ENGINE_DETECTOR_PATH=/app/weights/detector_ft` in datathon's `.env` and recreate the
engine. An invalid configured path fails startup; it does not silently use stock weights.
Without that setting the engine uses the stock detector, whose cash-room coverage is lower.

## Runtime and performance

- `api`: one Uvicorn process, one APScheduler queue drain, one active analysis slot.
- `engine`: one warm inference process; PyTorch CPU Qwen on Linux ARM with full VLM enabled.
- CPU starting point: 8 PyTorch threads, 2 ONNX threads, at most 2 ffmpeg threads.
- `web`: production React/nginx on host loopback `127.0.0.1:8080`.
- `db`: Postgres 18; no public database or API ports.
- Host nginx: public ports 80/443 and Certbot-managed TLS.

The backend polls asynchronously and reuses HTTP connections during each video. Models
are not reloaded for normal jobs. Cancellation or an engine deadline stops the inference
process and reloads it before another video is accepted. Network failures cannot force
the engine to accept concurrent jobs; its independent hard deadline remains in effect.

The 210-second engine / 220-second client / 240-second backend budgets apply to active
processing. Queue waiting is additional. The playback conversion runs beside inference
with bounded CPU use and is joined before another queued video starts. Benchmark the
full model on representative uncached videos before claiming maximum throughput.

## Verify the rollout

```bash
docker compose ps
docker compose logs --tail 100 engine api
docker compose exec -T engine python -c \
  "import json,urllib.request; print(json.load(urllib.request.urlopen('http://127.0.0.1:8001/health')))"
curl --fail https://baklashka.toilap.com/health
curl --fail https://baklashka.toilap.com/api/ui/models
```

Engine health must show `ready: true`; an idle engine also shows `accepting: true`.
The model picker should return `kadys-model`. Submit two test videos: the second should
show a queue position while the first is analysed. Confirm genuine evidence and boxes,
then exercise timeout/restart handling. Existing completed mock jobs are not rewritten.

After DNS/firewall setup, certificate issuance for a new server still uses the existing
Certbot procedure and the owner's acceptance of its Subscriber Agreement:

```bash
sudo certbot --nginx -d baklashka.toilap.com --non-interactive --agree-tos \
  --register-unsafely-without-email --redirect
sudo systemctl enable --now certbot.timer
sudo certbot renew --dry-run
```

Existing TLS deployments do not need to issue another certificate for this connection.

## Persistence

Compose volumes preserve Postgres, backend uploads and playback files, model weights,
Hugging Face files, and engine caches. Never run `docker compose down --volumes` on data
you need. Engine job IDs are ephemeral across engine restarts, while backend jobs remain
in Postgres. A backend restart resumes an existing engine job when available. An engine
restart can fail an in-flight job; submit a new check through the backend.

The VM's 72-hour automatic stop remains enabled. A stopped VM serves no requests; disk
and reserved-IP billing continue. The documented reserved address is `35.246.241.110`
(`datathon-baklashka-ip`), with Cloudflare DNS-only and host-managed TLS.

## Verified deployment — October 18, 2026

The public `/api/v1/models` endpoint returns `kadys-model`. Engine health reports
`ready: true`, Qwen3-VL-4B-Instruct with the Transformers backend, and full VLM enabled.
The fine-tuned detector is installed in the persistent weights volume. All four
Compose services are healthy; the existing frontend and database volumes were retained.

Two synthetic 3-second gray videos submitted together completed in FIFO order:
the first finished at 29.2 seconds and the second at 55.4 seconds from submission.
Both engine jobs finished with `partial: false`, and both playback Range requests
returned HTTP 206. These clips verify wiring and scheduling; they are not an accuracy
or throughput benchmark for real cash-room footage.

The engine runtime includes the container PID 1 startup fix from branch
`kadys_model_deploy` (commit `3b919163550a723418af96fa0a7b20405fe2bb8e`).
Local checks passed: 102 engine tests, 26 backend tests, and 8 frontend tests.
Server verification log: `/home/hadismuktar06/kadys-live-verification.log`.

### Source links and timecode hint rollout — October 18, 2026

Updated `api` and `web` together with `docker compose up -d --no-deps --wait`.
Both services and the unchanged database/inference services are healthy. Saved results
now receive source links from the backend catalog; B9 returns all three №53 anchors.
Violation cards show a seek hint beside the timecode and no checkmark or evidence images.
Clicking the deployed D6 card was verified to seek playback to 00:48.

Rollback sources: `/opt/datathon-before-sources-seek-20261018.tar.gz`.
Rollback images: `datathon-api:before-sources-seek-20261018` and
`datathon-web:before-sources-seek-20261018`. Build log:
`/home/hadismuktar06/sources-seek-build.log`.

Runtime version is recorded in `/opt/dathaton_engine_deploy/DEPLOY_REVISION`.
