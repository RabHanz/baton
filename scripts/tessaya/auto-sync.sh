#!/usr/bin/env bash
#
# The daily upstream sync (Phase D of the v2 port). Run by baton-auto-sync.timer on signzart.
#
#   scripts/tessaya/auto-sync.sh [--dry-run]
#
# In its own worktree ($BATON_AUTOSYNC_DIR, never the clone people work in):
#   1. fetch; if upstream has nothing new, check the alarm and stop
#   2. upstream-sync.sh: pin -> series (--3way) -> lockfile -> one squashed import commit -> gates -> PR
#   3. green: open the PR and stop. Its checks run; a person reviews and merges it. Nothing here
#      merges, tags a release or deploys: unreviewed upstream code never reaches a user by itself
#   4. red (a patch that no longer applies, or a gate): open an issue with the report and start a
#      Claude fix session in Herdr, so it is in Baton's sidebar on every device
#   5. alarm: when the pin is more than 3 days behind upstream main, open (or comment on) an issue
#
# Exit codes: 0 PR opened or nothing to do, 2 a patch needs a human, 3 gates failed, 5 the volume is
# below its free-space floor.
set -euo pipefail
# Runs from a copy in ~/.t3, so the shared lib/tessaya-env.sh is not beside it: same rule inlined.
for k in $(compgen -e); do case "$k" in TESSAYA_ENV_NOTED) ;; TESSAYA_*) export "BATON_${k#TESSAYA_}=${!k}" ;; esac; done

# The clone the worktree hangs off. The timer runs a copy of this script taken from origin/main
# (systemd/baton-auto-sync.service), so an edit that lands mid-run cannot change it under bash.
repo_dir="${BATON_REPO_DIR:-/mnt/HC_Volume_106652742/dev/t3code}"
work="${BATON_AUTOSYNC_DIR:-/mnt/HC_Volume_106652742/dev/baton-autosync}"
repo="${TESSAYA_REPO:-${BATON_REPO:-RabHanz/tessaya}}"
alarm_days="${BATON_ALARM_DAYS:-3}"
dry=0
for a in "$@"; do
  case "$a" in
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
[ "$behind" -gt 0 ] && oldest_unsynced="$(git log --reverse --format=%ct "$pin..upstream/main" | sed -n 1p)"  # sed reads to the end: no SIGPIPE under pipefail
age_days=0
[ -n "$oldest_unsynced" ] && age_days=$(( ($(date +%s) - oldest_unsynced) / 86400 ))
echo "pin $(git rev-parse --short "$pin"); upstream is $behind commits ahead; oldest unsynced is $age_days days old"

# The box's disk guard (VentureOS scripts/ops/disk-guard.sh) when present, else 8 GB free on the
# volume: a build that starts into less can fail mid-write, which is worse than not starting.
disk_ok() {
  local guard=/home/onnyx/VentureOS/scripts/ops/disk-guard.sh
  if [ -f "$guard" ]; then bash "$guard" --quiet; return; fi
  [ "$(df -BG --output=avail "$work" | tail -1 | tr -dc 0-9)" -ge 8 ]
}

issue() { # issue <title> <body-file>: one open issue per title, commented on after that
  local title="$1" body="$2" number
  number="$(gh issue list -R "$repo" --state open --search "\"$title\" in:title" --json number --jq '.[0].number' 2> /dev/null || true)"
  if [ -n "$number" ]; then gh issue comment "$number" -R "$repo" --body-file "$body" > /dev/null
  else gh issue create -R "$repo" --title "$title" --body-file "$body" > /dev/null; fi
}

# The one status file: what the last run did and, when it stopped, exactly where. Kept on the baton/status branch
# (never main) next to the nightly's, and read by the Now page. Best effort: a failure here never fails the run.
publish_status() { # publish_status <result> [extra sync-status.mjs arguments...]
  local result="$1"; shift
  local file; file="$(mktemp)"
  node scripts/tessaya/sync-status.mjs --result "$result" --pin "$pin" --to "$(git rev-parse upstream/main)" \
    --behind "$behind" --days "$age_days" --log "$log" "$@" > "$file" || return 0
  cp "$file" "$log_dir/last-status.json"
  [ "$dry" -eq 1 ] && return 0
  local sha; sha="$(gh api "repos/$repo/contents/upstream-sync.json?ref=baton/status" --jq .sha 2> /dev/null || true)"
  gh api -X PUT "repos/$repo/contents/upstream-sync.json" -f message="upstream sync: $result" -f branch=baton/status \
    -f content="$(base64 -w0 "$file")" ${sha:+-f sha="$sha"} > /dev/null 2>&1 || echo "could not publish the status file"
}

# Older sync PRs that a newer run replaced are closed with a comment, and their branches deleted.
supersede() { # supersede <keeper-url>
  local keeper="$1" n
  for n in $(gh pr list -R "$repo" --state open --json number,headRefName --jq '.[] | select(.headRefName | startswith("baton/auto-sync-")) | .number' 2> /dev/null); do
    case "$keeper" in */"$n") continue ;; esac
    gh pr close "$n" -R "$repo" --delete-branch \
      --comment "Superseded by $keeper: the sync reruns from main every night, so this branch's pin is out of date." > /dev/null 2>&1 || true
  done
}

if [ "$age_days" -gt "$alarm_days" ]; then
  body="$(mktemp)"
  printf 'Tessaya is %s upstream commits behind; the oldest has waited %s days (alarm at %s).\n\nLog: `%s` on signzart.\n' \
    "$behind" "$age_days" "$alarm_days" "$log" > "$body"
  [ "$dry" -eq 1 ] || issue "Tessaya is more than $alarm_days days behind upstream" "$body"
  echo "ALARM: $age_days days behind"
fi

if [ "$behind" -eq 0 ]; then
  echo "nothing to sync"
  publish_status nothing
  cd "$repo_dir" && rm -rf "$work" && git worktree prune
  exit 0
fi
if [ "$dry" -eq 1 ]; then bash scripts/tessaya/upstream-sync.sh --report-only; exit 0; fi

if ! disk_ok; then
  body="$(mktemp)"
  printf 'The daily sync did not start: the volume is below its free-space floor.\n\nLog: `%s`\n' "$log" > "$body"
  issue "Upstream sync skipped: disk" "$body"
  publish_status disk
  exit 5
fi
bash scripts/tessaya/toolchain-install.sh > /dev/null
source scripts/tessaya/toolchain.sh
pnpm install --frozen-lockfile --silent > /dev/null 2>&1 || pnpm install --silent > /dev/null

branch="baton/auto-sync-$stamp"
report="$log_dir/$stamp.report.md"
set +e
BATON_SYNC_REPORT="$report" bash scripts/tessaya/upstream-sync.sh --branch "$branch" --no-pr
rc=$?
set -e

if [ "$rc" -ne 0 ]; then
  what=$([ "$rc" -eq 2 ] && echo "a patch no longer applies" || echo "the gates failed")
  body="$(mktemp)"
  { printf 'The daily sync stopped: %s (exit %s).\n\n' "$what" "$rc"
    cat "$report" 2> /dev/null || true
    printf '\n<details><summary>Log tail</summary>\n\n```\n'; tail -80 "$log"; printf '```\n</details>\n'
    printf '\nA Claude fix session was started in Herdr session `fab-baton-autosync` on signzart; it shows in Tessaya.\n'
  } > "$body"
  issue "Upstream sync blocked: $what" "$body"
  # Which patches and which files, so a human (or the fix session) starts from the answer.
  conflict_patches="$(sed -n 's/^  CONFLICT  \([^ ]*\) .*/\1/p' "$log" | sort -u | tr '\n' ' ')"
  conflict_files="$(git diff --name-only --diff-filter=U | tr '\n' ' ')"
  touching="$(for f in $conflict_files; do printf '%s\t' "$f"; git log --no-merges --format='%h %s' "$pin..upstream/main" -- "$f" 2> /dev/null | head -3 | tr '\n' '|'; printf '\n'; done |
    node -e 'const o={};for(const l of require("fs").readFileSync(0,"utf8").split("\n")){const[f,c]=l.split("\t");if(f)o[f]=(c||"").split("|").filter(Boolean)}console.log(JSON.stringify(o))' 2> /dev/null || echo '{}')"
  publish_status "$([ "$rc" -eq 2 ] && echo conflict || echo gates)" --patches "$conflict_patches" --files "$conflict_files" --touching "$touching"
  # Gates failed (the sync commit exists): push it and open a draft PR so the work is visible and mergeable.
  if [ "$rc" -eq 3 ] && git push --quiet -u origin "$branch" 2> /dev/null; then
    gh pr create -R "$repo" --draft --base main --head "$branch" --title "sync: upstream to $(git rev-parse --short upstream/main) (gates failed)" --body-file "$report" > /dev/null 2>&1 || true
  fi
  prompt="$log_dir/$stamp.fix-prompt.md"
  { printf 'You are fixing the daily Tessaya upstream sync, which stopped because %s.\n' "$what"
    printf 'Worktree: %s, branch %s. Read docs/baton/UPSTREAM.md (the sync) and vendor-patches/t3code/README.md.\n' "$work" "$branch"
    printf 'Upstream wins where it overlaps Tessaya: adopt its version and keep Tessaya to its patches and its own files.\n'
    printf 'Fix the conflict markers or the failing gate, then: scripts/tessaya/patches.sh refresh && scripts/tessaya/patches.sh verify && scripts/tessaya/gates.sh --install --build.\n'
    printf 'Commit on %s, push it, open the PR, and stop. Report and log: %s, %s.\n' "$branch" "$report" "$log"
  } > "$prompt"
  # The worktree is kept for the fix session; the next run starts it fresh.
  bash scripts/tessaya/start-fix-session.sh "$work" "$prompt" || echo "could not start the fix session"
  exit "$rc"
fi

git push --quiet -u origin "$branch"
bash scripts/tessaya/disable-upstream-workflows.sh > /dev/null || true
# Opened, never merged here: its checks (guard-private, check-notices, CI) run and a person merges.
url="$(gh pr create -R "$repo" --base main --head "$branch" --title "sync: upstream to $(git rev-parse --short upstream/main) (daily)" --body-file "$report")"
echo "opened $url"
supersede "$url"
publish_status opened --pr "$url"
# Nothing of a green run stays on the volume: the worktree (about 5 GB with its build) is rebuilt
# from origin/main next time. A red run keeps it for the fix session.
cd "$repo_dir"
rm -rf "$work" && git worktree prune
