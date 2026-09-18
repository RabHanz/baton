#!/usr/bin/env bash
#
# Bring upstream's work into the fork, and say what it will cost before it does.
#
# A fork that only diverges is a fork that eventually cannot take a fix. This
# does the three things that keep the distance visible and small:
#
#   1. reports what upstream did since the last sync — commits, and the files
#      they touched that this fork also touches;
#   2. calls out, by name, every hit against the conflicts table in
#      `docs/fabric/UPSTREAM.md`, because those are the files where a merge will
#      need a human decision rather than a resolution;
#   3. merges `upstream/main` into a branch off the fork's `main` and opens the
#      pull request, with the report as the body.
#
# Merge commits are fine here: this fork is not rebased onto upstream, it
# absorbs upstream. A rebase would rewrite every Fabric commit on every sync and
# make "what did we change" unanswerable.
#
# Usage:
#   scripts/fabric/upstream-sync.sh [--report-only] [--branch <name>]
#                                   [--base <ref>] [--no-pr]
#
# `--base` exists for the case where the fork's `main` is not yet where the sync
# should start from — a fix the merge depends on sitting in an open PR, say.
# It defaults to `origin/main`, which is the normal answer.
#
# Exit codes: 0 done (or nothing to do), 1 refused, 2 merged with conflicts left
# in the worktree for a human.

set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

report_only=0
open_pr=1
branch=""
base="origin/main"
while [ $# -gt 0 ]; do
  case "$1" in
    --report-only) report_only=1 ;;
    --no-pr) open_pr=0 ;;
    --branch) shift; branch="${1:-}" ;;
    --base) shift; base="${1:-}" ;;
    *) echo "upstream-sync: unknown argument '$1'" >&2; exit 1 ;;
  esac
  shift
done

if [ -n "$(git status --porcelain)" ]; then
  echo "upstream-sync: the working tree is dirty. Commit or stash first." >&2
  exit 1
fi

echo "==> Fetching"
git fetch --quiet origin main
git fetch --quiet upstream main

fork_point="$(git merge-base origin/main upstream/main)"
ahead="$(git rev-list --count origin/main..upstream/main)"

report="$(mktemp)"
trap 'rm -f "$report"' EXIT

{
  printf '## Upstream sync\n\n'
  printf '| | |\n| --- | --- |\n'
  printf '| Fork `main` | `%s` |\n' "$(git rev-parse --short origin/main)"
  printf '| Upstream `main` | `%s` |\n' "$(git rev-parse --short upstream/main)"
  printf '| Common ancestor | `%s` |\n' "$(git rev-parse --short "$fork_point")"
  printf '| Upstream commits to take | %s |\n\n' "$ahead"
} > "$report"

if [ "$ahead" -eq 0 ]; then
  echo "Nothing to sync: upstream/main is already an ancestor of origin/main."
  cat "$report"
  exit 0
fi

# Upstream vendors reference checkouts under .repos/, which are enormous and
# have nothing to do with the fork. They are counted, not listed.
upstream_files="$(git diff --name-only "$fork_point" upstream/main | grep -v '^\.repos/' || true)"
vendored_count="$(git diff --name-only "$fork_point" upstream/main | grep -c '^\.repos/' || true)"
fork_files="$(git diff --name-only "$fork_point" origin/main || true)"

overlap="$(comm -12 <(printf '%s\n' "$upstream_files" | sort -u) <(printf '%s\n' "$fork_files" | sort -u) || true)"

# Every path the conflicts table names, read out of its own backticks so the
# document stays the single source of that list.
conflict_paths="$(
  sed -n '/^### Conflicts carried/,/^## /p' docs/fabric/UPSTREAM.md |
    grep -oE '`[a-zA-Z0-9_./-]+\.(ts|tsx|json|sh|yaml|yml)`' |
    tr -d '`' | sort -u
)"

flagged="$(comm -12 <(printf '%s\n' "$overlap" | sort -u) <(printf '%s\n' "$conflict_paths") || true)"

{
  printf '### What upstream changed\n\n'
  git log --no-merges --pretty='- `%h` %s' "$fork_point".."upstream/main" | head -60
  printf '\n(%s files outside `.repos/`; %s vendored reference files ignored.)\n\n' \
    "$(printf '%s\n' "$upstream_files" | grep -c . || true)" "$vendored_count"

  printf '### Files both sides touched\n\n'
  if [ -z "$overlap" ]; then
    printf 'None. This sync cannot conflict.\n\n'
  else
    printf '%s\n' "$overlap" | sed 's/^/- `/; s/$/`/'
    printf '\n'
  fi

  printf '### Against the conflicts table\n\n'
  if [ -z "$flagged" ]; then
    printf 'No file named in `docs/fabric/UPSTREAM.md` was touched upstream.\n\n'
  else
    printf 'Upstream moved these, and `UPSTREAM.md` already says why the fork is in them:\n\n'
    printf '%s\n' "$flagged" | sed 's/^/- `/; s/$/`/'
    printf '\n'
  fi
} >> "$report"

cat "$report"

if [ "$report_only" -eq 1 ]; then
  exit 0
fi

if [ -z "$branch" ]; then
  branch="fabric/upstream-sync-$(date -u +%Y%m%d)"
fi

echo "==> Merging upstream/main into $branch (from $base)"
git checkout --quiet -B "$branch" "$base"

set +e
git merge --no-edit -m "sync: merge upstream/main into the fork

$ahead upstream commits. Conflicts, if any, are resolved keeping both sides:
upstream's behaviour and Fabric's additions. See docs/fabric/UPSTREAM.md." upstream/main
merge_status=$?
set -e

if [ "$merge_status" -ne 0 ]; then
  echo
  echo "==> Merge stopped with conflicts in:"
  git diff --name-only --diff-filter=U | sed 's/^/    /'
  echo
  echo "Resolve them, keeping both upstream's behaviour and Fabric's additions,"
  echo "then: git commit && git push -u origin $branch"
  exit 2
fi

git push --quiet -u origin "$branch"

if [ "$open_pr" -eq 1 ] && command -v gh > /dev/null 2>&1; then
  gh pr create --base main --head "$branch" \
    --title "sync: upstream/main into the fork ($ahead commits)" \
    --body-file "$report"
else
  echo "Pushed $branch. Open the pull request when ready."
fi
