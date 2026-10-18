#!/usr/bin/env bash
# Run after the reviewed changes have been merged on GitHub.
set -euo pipefail
[[ $(uname -s) == Linux && $EUID == 0 ]] || { echo 'Run with sudo on the VPS.' >&2; exit 1; }
task_mode=${1:-check}
case $task_mode in check|web|all) ;; *) echo 'Usage: update-from-github.sh [check|web|all]' >&2; exit 1;; esac
exec 9>/run/lock/datathon-github-deploy.lock
flock -n 9 || { echo 'Another GitHub deployment is running.' >&2; exit 1; }
cd "${DATATHON_SOURCE_DIR:-/opt/datathon}"
task_infra=$PWD
task_engine=$(docker compose config --format json | python3 -c \
    'import json,sys; print(json.load(sys.stdin)["services"]["engine"]["build"]["context"])')
task_dirs=("$task_infra")
task_repos=(haroke4/datathon-infra)
task_branches=(main)
if [[ $task_mode != web ]]; then
    task_dirs+=("$task_engine")
    task_repos+=(kadysmuktaruly/dathaton_engine)
    task_branches+=(kadys_model_deploy)
fi

# Preflight every selected checkout before advancing either branch.
for i in "${!task_dirs[@]}"; do
    task_dir=${task_dirs[$i]}
    task_branch=${task_branches[$i]}
    [[ $(git -C "$task_dir" remote get-url origin) == "https://github.com/${task_repos[$i]}.git" ]]
    [[ $(git -C "$task_dir" symbolic-ref --short HEAD) == "$task_branch" ]]
    if [[ -n $(git -C "$task_dir" status --porcelain) ]]; then
        echo "Uncommitted files in $task_dir; review and commit them before updating." >&2
        git -C "$task_dir" status --short
        exit 1
    fi
    GIT_TERMINAL_PROMPT=0 git -C "$task_dir" fetch origin "$task_branch"
    git -C "$task_dir" merge-base --is-ancestor HEAD "origin/$task_branch" || {
        echo "Branch in $task_dir has diverged; reconcile it before updating." >&2; exit 1;
    }
    git -C "$task_dir" log --oneline "HEAD..origin/$task_branch"
done
[[ $task_mode != check ]] || { echo 'GitHub checks passed; no source or containers changed.'; exit 0; }
for i in "${!task_dirs[@]}"; do
    git -C "${task_dirs[$i]}" merge --ff-only "origin/${task_branches[$i]}"
done
docker compose config --quiet
if [[ $task_mode == web ]]; then
    docker compose build web
    docker compose up -d --no-deps --wait --wait-timeout 120 web
else
    docker compose build
    docker compose up -d --wait --wait-timeout 900
fi
docker compose exec -T web nginx -s reload
docker compose ps
curl --fail --silent --show-error --retry 10 --retry-all-errors --retry-delay 1 \
    -H 'Host: baklashka.toilap.com' http://127.0.0.1/health
printf '\nGitHub deployment complete.\n'
