#!/usr/bin/env bash
# Attach the existing VPS sources to GitHub without overwriting deployed files.
set -euo pipefail
[[ $(uname -s) == Linux && $EUID == 0 ]] || { echo 'Run with sudo on the VPS.' >&2; exit 1; }
command -v git >/dev/null

install -d -m 0700 /root/.config/datathon
install -d -m 0755 /usr/local/libexec
if [[ ! -s /root/.config/datathon/github-token ]]; then
    read -rsp 'GitHub token for haroke4: ' task_token
    printf '\n'
    [[ -n $task_token ]] || exit 1
    (umask 077; printf '%s' "$task_token" > /root/.config/datathon/github-token)
    unset task_token
fi
chmod 0600 /root/.config/datathon/github-token

cat > /usr/local/libexec/datathon-github-credential <<'HELPER'
#!/usr/bin/env bash
set -euo pipefail
[[ ${1:-} == get ]] || exit 0
protocol= host= path=
while IFS='=' read -r name value; do
    [[ -n $name ]] || break
    case $name in protocol) protocol=$value;; host) host=$value;; path) path=$value;; esac
done
[[ $protocol == https && $host == github.com ]] || exit 0
case ${path%.git} in
    haroke4/datathon-infra|kadysmuktaruly/dathaton_engine) ;;
    *) exit 0;;
esac
printf 'username=haroke4\npassword='
cat /root/.config/datathon/github-token
printf '\n'
HELPER
chmod 0700 /usr/local/libexec/datathon-github-credential

task_helper=/usr/local/libexec/datathon-github-credential
task_dirs=(/opt/datathon /opt/dathaton_engine_deploy)
task_repos=(haroke4/datathon-infra kadysmuktaruly/dathaton_engine)
task_branches=(main kadys_model_deploy)

# Verify access to both repositories before changing any source metadata.
for i in 0 1; do
    [[ -d ${task_dirs[$i]} ]] || { echo "Missing ${task_dirs[$i]}" >&2; exit 1; }
    GIT_TERMINAL_PROMPT=0 git -c credential.helper= -c credential.helper="$task_helper" \
        -c credential.useHttpPath=true ls-remote --exit-code \
        "https://github.com/${task_repos[$i]}.git" "refs/heads/${task_branches[$i]}"
done

for i in 0 1; do
    task_dir=${task_dirs[$i]}
    task_url="https://github.com/${task_repos[$i]}.git"
    task_branch=${task_branches[$i]}
    task_new=0
    if [[ ! -e $task_dir/.git ]]; then
        git -C "$task_dir" init -b "$task_branch"
        task_new=1
    fi
    # Never silently rewire a different existing repository or branch.
    task_origin=$(git -C "$task_dir" remote get-url origin 2>/dev/null || true)
    [[ -z $task_origin || $task_origin == "$task_url" ]] || { echo "Unexpected origin in $task_dir" >&2; exit 1; }
    [[ $(git -C "$task_dir" symbolic-ref --short HEAD) == "$task_branch" ]] || { echo "Unexpected branch in $task_dir" >&2; exit 1; }
    [[ -n $task_origin ]] || git -C "$task_dir" remote add origin "$task_url"
    git -C "$task_dir" config --local --replace-all credential.helper ''
    git -C "$task_dir" config --local --add credential.helper "$task_helper"
    git -C "$task_dir" config --local credential.useHttpPath true
    git -C "$task_dir" config --local pull.ff only
    GIT_TERMINAL_PROMPT=0 git -C "$task_dir" fetch origin "$task_branch"
    if (( task_new )) || ! git -C "$task_dir" rev-parse --verify HEAD >/dev/null 2>&1; then
        git -C "$task_dir" update-ref "refs/heads/$task_branch" "refs/remotes/origin/$task_branch"
        # Populate the index only. Every existing working file stays intact.
        git -C "$task_dir" read-tree HEAD
    fi
    git -C "$task_dir" branch --set-upstream-to="origin/$task_branch" "$task_branch"
    git -C "$task_dir" status --short
done
echo 'Both VPS source directories are connected. Review any differences before pulling.'
