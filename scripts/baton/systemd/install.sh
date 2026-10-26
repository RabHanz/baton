#!/usr/bin/env bash
# Install the daily sync timer for this user (signzart). Re-run after editing the units.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$HOME/.config/systemd/user" "$HOME/.t3"
cp "$here/baton-auto-sync.service" "$here/baton-auto-sync.timer" "$HOME/.config/systemd/user/"
systemctl --user daemon-reload
systemctl --user enable --now baton-auto-sync.timer
systemctl --user list-timers baton-auto-sync.timer --no-pager
