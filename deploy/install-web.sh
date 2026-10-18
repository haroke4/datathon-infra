#!/usr/bin/env bash
# Run as root from a release extracted on the Ubuntu VM.
set -euo pipefail

if [[ $(uname -s) != Linux || $EUID != 0 ]]; then
    printf 'Run this script as root on the Ubuntu deployment VM.\n' >&2
    exit 1
fi
. /etc/os-release
[[ $ID == ubuntu && $VERSION_ID == 24.04 ]]
cd "$(dirname "$0")/.."

apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y nginx certbot python3-certbot-nginx curl openssl

# Keep the existing database password on every update. Never print it.
if [[ ! -e .env ]]; then
    umask 077
    task_db_password=$(openssl rand -hex 32)
    printf '%s\n' \
        'APP_ENV=production' \
        'POSTGRES_USER=app' \
        "POSTGRES_PASSWORD=$task_db_password" \
        'POSTGRES_DB=app' \
        'POSTGRES_HOST=db' \
        'MAX_UPLOAD_MB=100' \
        'JOB_TIMEOUT_SEC=240' \
        'WORKER_CONCURRENCY=1' > .env
    unset task_db_password
fi

# The same private API key is injected into both containers. Preserve it on updates.
if ! grep -qE '^ENGINE_API_KEY=.+$' .env; then
    umask 077
    task_engine_key=$(openssl rand -hex 32)
    printf '\nENGINE_API_KEY=%s\n' "$task_engine_key" >> .env
    unset task_engine_key
fi

# Jury routes require this separate secret; the shared browser uses anonymous UI routes.
if ! grep -qE '^PUBLIC_API_KEY=.+$' .env; then
    umask 077
    task_public_key="baklashka-ne-prolivay-$(openssl rand -hex 16)"
    printf '\nPUBLIC_API_KEY=%s\n' "$task_public_key" >> .env
    unset task_public_key
fi

docker compose config --quiet
task_engine_source=$(docker compose config --format json | python3 -c \
    'import json,sys; print(json.load(sys.stdin)["services"]["engine"]["build"]["context"])')
if [[ ! -f "$task_engine_source/api/service.py" || ! -f "$task_engine_source/Dockerfile" ]]; then
    printf 'Clone kadys_model_deploy into %s before installing (see deploy/README.md).\n' \
        "$task_engine_source" >&2
    exit 1
fi
unset task_engine_source
docker compose build
# Pre-fetch all CPU model/pose weights to persistent volumes before offline startup.
docker compose run --rm --no-deps -e HF_HUB_OFFLINE=0 engine python -m tools.download_weights
if [[ -f weights/detector_ft/config.json && -f weights/detector_ft/model.safetensors ]]; then
    docker compose run --rm --no-deps -v "$PWD/weights/detector_ft:/checkpoint:ro" engine \
        python -c "import shutil; shutil.copytree('/checkpoint','/app/weights/detector_ft',dirs_exist_ok=True)"
    if ! grep -qE '^ENGINE_DETECTOR_PATH=.+$' .env; then
        printf '\nENGINE_DETECTOR_PATH=/app/weights/detector_ft\n' >> .env
    fi
fi
docker compose up -d --wait --wait-timeout 900
# Resolve the current API container address after an image update/recreation.
docker compose exec -T web nginx -s reload

# Preserve any previous TLS configuration on updates; Certbot manages this file.
install -m 0644 deploy/nginx-proxy.conf /etc/nginx/snippets/datathon-proxy.conf
if [[ ! -e /etc/nginx/sites-available/baklashka.toilap.com ]]; then
    install -m 0644 deploy/nginx-host.conf /etc/nginx/sites-available/baklashka.toilap.com
fi
ln -sfn /etc/nginx/sites-available/baklashka.toilap.com /etc/nginx/sites-enabled/baklashka.toilap.com
nginx -t
systemctl enable --now nginx
systemctl reload nginx
curl --fail --silent --show-error --retry 10 --retry-all-errors --retry-delay 1 \
    -H 'Host: baklashka.toilap.com' http://127.0.0.1/health
printf '\nBackend, sequential inference worker, and web stack are ready.\n'
