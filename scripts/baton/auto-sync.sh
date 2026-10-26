#!/usr/bin/env bash
#
# The daily upstream sync (Phase D of the v2 port). Run by baton-auto-sync.timer on signzart.
#
#   scripts/baton/auto-sync.sh [--no-deploy] [--dry-run]
#
# In its own worktree ($BATON_AUTOSYNC_DIR, never the clone people work in):
#   1. fetch; if upstream has nothing new, check the alarm and stop
#   2. upstream-sync.sh: pin -> series (--3way) -> lockfile -> two-parent commit -> gates -> PR
#   3. green: merge the PR, build `<upstream version>-baton.<N+1>`, rehearse it on a snapshot of
#      live userdata, deploy beside on signzart then onnyx; a box that does not come up is rolled
#      back with the rollback.sh its deploy wrote, and the run stops there
#   4. red (a patch that no longer applies, or a gate): open an issue with the report and start a
#      Claude fix session in Herdr, so it is in Baton's sidebar on every device
#   5. alarm: when the pin is more than 3 days behind upstream main, open (or comment on) an issue
#
# Exit codes: 0 synced or nothing to do, 2 a patch needs a human, 3 gates failed, 4 deploy failed.
set -euo pipefail

# The clone the worktree hangs off. The timer runs a copy of this script taken from origin/main
# (systemd/baton-auto-sync.service), so an edit that lands mid-run cannot change it under bash.
repo_dir="${BATON_REPO_DIR:-/mnt/HC_Volume_106652742/dev/t3code}"
work="${BATON_AUTOSYNC_DIR:-/mnt/HC_Volume_106652742/dev/baton-autosync}"
repo="${BATON_REPO:-RabHanz/baton}"
onnyx="${BATON_SECOND_BOX:-onnyx@onnyx}"
alarm_days="${BATON_ALARM_DAYS:-3}"
deploy=1 dry=0
for a in "$@"; do
  case "$a" in
    --no-deploy) deploy=0 ;;
    --dry-run) dry=1 ;;
    *) echo "auto-sync: unknown argument $a" >&2; exit 1 ;;
  esac
done

export TMPDIR="${TMPDIR:-/mnt/HC_Volume_106652742/tmp/lanes}"
export PATH="$HOME/.local/bin:$HOME/bin:$PATH"
log_dir="$HOME/.t3/baton-autosync"
mkdir -p "$log_dir" "$TMPDIR"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
log="$log_dir/$stamp.log"
exec > >(tee -a "$log") 2>&1
echo "== baton auto-sync $stamp"

if [ ! -d "$work/.git" ] && [ ! -f "$work/.git" ]; then
  git -C "$repo_dir" worktree add --detach "$work" origin/main
fi
cd "$work"
git fetch --quiet origin main
git fetch --quiet upstream main
git checkout --quiet --detach origin/main
git reset --quiet --hard origin/main

pin="$(tr -d '[:space:]' < vendor-patches/t3code/PIN)"
behind="$(git rev-list --count "$pin..upstream/main")"
oldest_unsynced=""
[ "$behind" -gt 0 ] && oldest_unsynced="$(git log --reverse --format=%ct "$pin..upstream/main" | head -1)"
age_days=0
[ -n "$oldest_unsynced" ] && age_days=$(( ($(date +%s) - oldest_unsynced) / 86400 ))
echo "pin $(git rev-parse --short "$pin"); upstream is $behind commits ahead; oldest unsynced is $age_days days old"

issue() { # issue <title> <body-file>: one open issue per title, commented on after that
  local title="$1" body="$2" number
  number="$(gh issue list -R "$repo" --state open --search "\"$title\" in:title" --json number --jq '.[0].number' 2> /dev/null || true)"
  if [ -n "$number" ]; then gh issue comment "$number" -R "$repo" --body-file "$body" > /dev/null
  else gh issue create -R "$repo" --title "$title" --body-file "$body" > /dev/null; fi
}

if [ "$age_days" -gt "$alarm_days" ]; then
  body="$(mktemp)"
  printf 'Baton is %s upstream commits behind; the oldest has waited %s days (alarm at %s).\n\nLog: `%s` on signzart.\n' \
    "$behind" "$age_days" "$alarm_days" "$log" > "$body"
  [ "$dry" -eq 1 ] || issue "Baton is more than $alarm_days days behind upstream" "$body"
  echo "ALARM: $age_days days behind"
fi

if [ "$behind" -eq 0 ]; then echo "nothing to sync"; exit 0; fi
if [ "$dry" -eq 1 ]; then bash scripts/baton/upstream-sync.sh --report-only; exit 0; fi

bash scripts/baton/toolchain-install.sh > /dev/null
source scripts/baton/toolchain.sh
pnpm install --frozen-lockfile --silent > /dev/null 2>&1 || pnpm install --silent > /dev/null

branch="baton/auto-sync-$stamp"
report="$log_dir/$stamp.report.md"
set +e
BATON_SYNC_REPORT="$report" bash scripts/baton/upstream-sync.sh --branch "$branch" --no-pr
rc=$?
set -e

if [ "$rc" -ne 0 ]; then
  what=$([ "$rc" -eq 2 ] && echo "a patch no longer applies" || echo "the gates failed")
  body="$(mktemp)"
  { printf 'The daily sync stopped: %s (exit %s).\n\n' "$what" "$rc"
    cat "$report" 2> /dev/null || true
    printf '\n<details><summary>Log tail</summary>\n\n```\n'; tail -80 "$log"; printf '```\n</details>\n'
    printf '\nA Claude fix session was started in Herdr session `fab-baton-autosync` on signzart; it shows in Baton.\n'
  } > "$body"
  issue "Upstream sync blocked: $what" "$body"
  prompt="$log_dir/$stamp.fix-prompt.md"
  { printf 'You are fixing the daily Baton upstream sync, which stopped because %s.\n' "$what"
    printf 'Worktree: %s, branch %s. Read docs/baton/UPSTREAM.md (the sync) and vendor-patches/t3code/README.md.\n' "$work" "$branch"
    printf 'Upstream wins where it overlaps Baton: adopt its version and keep Baton to its patches and its own files.\n'
    printf 'Fix the conflict markers or the failing gate, then: scripts/baton/patches.sh refresh && scripts/baton/patches.sh verify && scripts/baton/gates.sh --install --build.\n'
    printf 'Commit on %s, push it, open the PR, and stop. Report and log: %s, %s.\n' "$branch" "$report" "$log"
  } > "$prompt"
  claude_bin="$(command -v claude || echo "$HOME/.nvm/versions/node/v24.19.0/bin/claude")"
  baton "$work" "$claude_bin" --permission-mode bypassPermissions "$(cat "$prompt")" < /dev/null > /dev/null 2>&1 || true
  # A first run in a folder asks whether to trust it; this worktree is ours.
  if herdr --session fab-baton-autosync pane wait-output w1:p1 --match "Enter to confirm" --timeout 20000 > /dev/null 2>&1; then
    herdr --session fab-baton-autosync pane wait-output w1:p1 --match zzz-never --timeout 2000 > /dev/null 2>&1 || true
    herdr --session fab-baton-autosync pane send-keys w1:p1 Down > /dev/null
    herdr --session fab-baton-autosync pane wait-output w1:p1 --match zzz-never --timeout 1500 > /dev/null 2>&1 || true
    herdr --session fab-baton-autosync pane send-keys w1:p1 Enter > /dev/null
  fi
  exit "$rc"
fi

git push --quiet -u origin "$branch"
bash scripts/baton/disable-upstream-workflows.sh > /dev/null || true
url="$(gh pr create -R "$repo" --base main --head "$branch" --title "sync: upstream to $(git rev-parse --short upstream/main) (daily)" --body-file "$report")"
gh pr merge "$url" -R "$repo" --merge --admin
echo "merged $url"
[ "$deploy" -eq 1 ] || exit 0

# The next version label: upstream's version, Baton's counter one past the highest installed.
upstream_version="$(node -p 'require("./apps/server/package.json").version')"
n="$(ls "$HOME/.t3/runtime/versions" | sed -n 's/.*-baton\.\([0-9]*\)$/\1/p' | sort -n | tail -1)"
version="$upstream_version-baton.$(( ${n:-0} + 1 ))"
NODE_ENV=production bash scripts/baton/release-build.sh "$version"
archive="release-cli/t3-$version-linux-x64.tar.gz"

snap="$TMPDIR/baton-autosync-snapshot"
rm -rf "$snap"
bash scripts/baton/snapshot-userdata.sh "$snap" > /dev/null
rehearsal="$(bash scripts/baton/rehearse.sh "$archive" "$snap" 3792)"
echo "$rehearsal"
rehearsal_pid="$(echo "$rehearsal" | sed -n 's/^pid \([0-9]*\) .*/\1/p')"
[ -n "$rehearsal_pid" ] && kill "$rehearsal_pid" 2> /dev/null || true
echo "$rehearsal" | grep -q "http 200" || { echo "rehearsal did not come up; not deploying $version"; exit 4; }

healthy() { # healthy [ssh-target]: the service stays active and answers for a minute
  local check='for i in 1 2 3 4 5 6; do sleep 10; [ "$(systemctl --user is-active t3code.service)" = active ] || exit 1; done; [ "$(curl -s -o /dev/null -w %{http_code} http://127.0.0.1:3773/)" = 200 ]'
  if [ -z "${1:-}" ]; then bash -c "$check"
  else ssh -i "$HOME/.config/venture-ssh/onnyx_ed25519" -o IdentitiesOnly=yes -o BatchMode=yes "$1" "$check"; fi
}

for box in local "$onnyx"; do
  if [ "$box" = local ]; then
    bash scripts/baton/deploy-beside.sh "$archive" "$version" && healthy && continue
    latest="$(ls -d "${BATON_BACKUP_ROOT:-/mnt/HC_Volume_106652742/dev/backups/baton}"/before-"$version"-* | tail -1)"
    bash "$latest/rollback.sh"
  else
    bash scripts/baton/deploy-beside.sh "$archive" "$version" --host "$box" && healthy "$box" && continue
    ssh -i "$HOME/.config/venture-ssh/onnyx_ed25519" -o IdentitiesOnly=yes -o BatchMode=yes "$box" \
      "bash \$(ls -d ~/backups/baton/before-$version-* | tail -1)/rollback.sh"
  fi
  body="$(mktemp)"
  printf '%s did not stay up on %s and was rolled back.\n\nLog: `%s`\n' "$version" "$box" "$log" > "$body"
  issue "Deploy rolled back: $version" "$body"
  exit 4
done
rm -f release-cli/*.tar.gz
rm -rf apps/server/dist apps/web/dist "$snap" "$TMPDIR/rehearsal/run-baton-autosync-snapshot"
echo "deployed $version to both boxes"
