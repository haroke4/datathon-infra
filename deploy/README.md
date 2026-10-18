# baklashka.toilap.com — backend and inference deployment

The Compose stack connects the real backend to branch `kadys_model_deploy`. The backend
owns the database queue and dispatches one video at a time. No mock inference is used.
The existing site remains a public shared demo with no login.

## GitHub deployment workflow

The VPS sources track these repositories:

| VPS directory | Repository | Branch |
| --- | --- | --- |
| `/opt/datathon` | `https://github.com/haroke4/datathon-infra.git` | `main` |
| `/opt/dathaton_engine_deploy` | `https://github.com/kadysmuktaruly/dathaton_engine.git` | `kadys_model_deploy` |

For a server originally deployed from copied source files, run once:

```bash
sudo bash /opt/datathon/deploy/connect-github.sh
```

Enter the GitHub token at the hidden prompt. The token is stored with root-only access
under `/root/.config/datathon/`; repository URLs and source files contain no credentials.
The credential helper answers only for these two GitHub repositories. Run subsequent
Git commands with `sudo` so they use this credential. The bootstrap attaches Git metadata
without replacing existing files, `.env`, uploads, weights, or Docker volumes. Its final
status lists any differences between deployed files and GitHub. Review and commit those
differences before updating; never discard them blindly.

Push changes to a branch and open a pull request against the corresponding branch above.
After review and merge, use the VPS shell:

```bash
sudo bash /opt/datathon/deploy/update-from-github.sh check # fetch and inspect both repos
sudo bash /opt/datathon/deploy/update-from-github.sh web   # pull infra and rebuild frontend
sudo bash /opt/datathon/deploy/update-from-github.sh all   # pull both and rebuild the stack
```

The default is `check`. Updates require clean checkouts and fast-forward history;
concurrent invocations are rejected. Deployment runs only when invoked, after changes
are accepted on GitHub. Existing model weights and database volumes are retained.
If a release needs new model weights, prepare them using the installation steps below
before deploying it. A failed build leaves Git at the new revision; inspect the error
and rerun after fixing it. An `all` update can interrupt active inference.

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
An engine image or inference benchmark was not run on the local development machine;
verify full inference and timing on the actual N4A VM after rollout.

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
curl --fail https://baklashka.toilap.com/api/v1/models
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

The earlier October 18 web/TLS smoke checks used mock inference. This connection has
separate local integration tests; rerun the live checks above after installing this release.
