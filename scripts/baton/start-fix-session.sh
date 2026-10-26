#!/usr/bin/env bash
# Start a Claude Code session in its own Herdr space, so it shows in Baton on every device and
# can be steered from there. Used by auto-sync.sh when a sync goes red.
#   scripts/baton/start-fix-session.sh <dir> <prompt-file>
# Replaces any previous session of the same name, waits for the pane's shell before typing (a
# login shell started from systemd can take seconds to draw its prompt), and answers the
# first-run "trust this folder" question for this directory.
set -euo pipefail
dir="${1:?usage: start-fix-session.sh <dir> <prompt-file>}"
prompt_file="${2:?usage: start-fix-session.sh <dir> <prompt-file>}"
name="fab-$(basename "$dir" | tr -c 'A-Za-z0-9_\n-' '-')"
claude_bin="$(command -v claude || echo "$HOME/.nvm/versions/node/v24.19.0/bin/claude")"
h() { herdr --session "$name" "$@"; }

herdr session stop "$name" > /dev/null 2>&1 || true
herdr session delete "$name" > /dev/null 2>&1 || true
(cd "$dir" && setsid herdr --session "$name" server < /dev/null > /dev/null 2>&1 &)
for _ in $(seq 1 50); do
  herdr session list 2> /dev/null | awk -v n="$name" '$1 == n && $2 == "running" { f = 1 } END { exit !f }' && break
  sleep 0.2
done
h workspace create --cwd "$dir" --label "$(basename "$dir")" --focus > /dev/null
pane="$(h pane list | grep -o '"pane_id":"[^"]*"' | tail -1 | cut -d'"' -f4)"

# Any prompt glyph at the end of the screen means the shell is ready for input.
h pane wait-output "$pane" --regex '[$#%>❯] *$' --timeout 30000 > /dev/null 2>&1 || true
h pane send-text "$pane" "$claude_bin --permission-mode bypassPermissions \"\$(cat $(printf '%q' "$prompt_file"))\"" > /dev/null
h pane send-keys "$pane" Enter > /dev/null

if h pane wait-output "$pane" --match "Enter to confirm" --timeout 30000 > /dev/null 2>&1; then
  h pane wait-output "$pane" --match zzz-never --timeout 2000 > /dev/null 2>&1 || true
  h pane send-keys "$pane" Down > /dev/null
  h pane wait-output "$pane" --match zzz-never --timeout 1500 > /dev/null 2>&1 || true
  h pane send-keys "$pane" Enter > /dev/null
fi
echo "$name $pane"
