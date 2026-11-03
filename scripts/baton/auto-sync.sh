#!/usr/bin/env bash
# Old path of scripts/tessaya/auto-sync.sh. The systemd unit copies this file out of origin/main into
# ~/.t3 and runs the copy, so the real script is fetched the same way (a run never sees a mid-run edit).
repo="${BATON_REPO_DIR:-${TESSAYA_REPO_DIR:-/mnt/HC_Volume_106652742/dev/t3code}}"
t="$(mktemp)"
git -C "$repo" fetch --quiet origin main || true
git -C "$repo" show origin/main:scripts/tessaya/auto-sync.sh > "$t" || { echo "auto-sync: cannot read scripts/tessaya/auto-sync.sh from origin/main" >&2; exit 1; }
exec bash "$t" "$@"
