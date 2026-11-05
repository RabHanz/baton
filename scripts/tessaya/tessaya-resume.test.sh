#!/usr/bin/env bash
# Self-check: `tessaya --resume` never starts a second copy of a conversation.
# Run: bash scripts/tessaya/tessaya-resume.test.sh
set -euo pipefail

script="$(cd "$(dirname "$0")" && pwd)/tessaya"
work="$(mktemp -d)"
ok() { echo "ok   $*"; }
fail() { echo "FAIL $*" >&2; exit 1; }

# A fake herdr: records every call; "server" marks the space running.
mkdir -p "$work/bin" "$work/home/.claude/sessions" "$work/proj"
cat > "$work/bin/herdr" <<'H'
#!/usr/bin/env bash
echo "$*" >> "$HERDR_LOG"
case "$*" in
  *" server") touch "$HERDR_UP" ;;
  "session list") [[ -f "$HERDR_UP" ]] && echo "fab-proj running" ;;
  *"workspace list") echo '"workspace_id":"w1"' ;;
  *"pane list") echo '"pane_id":"w1:p1"' ;;
esac
exit 0
H
chmod +x "$work/bin/herdr"
export TESSAYA_NO_SYSTEMD=1 PATH="$work/bin:$PATH" HOME="$work/home" HERDR_LOG="$work/log" HERDR_UP="$work/up" XDG_RUNTIME_DIR="$work"
run() { : > "$HERDR_LOG"; bash "$script" --resume "$1" "$work/proj" > "$work/out" < /dev/null; }
# A stand-in for a Claude process inside Herdr pane w1:p9 of fab-proj.
HERDR_SESSION=fab-proj HERDR_PANE_ID=w1:p9 sleep 120 &
holder=$!
trap 'kill "$holder" 2> /dev/null; rm -rf "$work"' EXIT

# 1. Not running anywhere: resumed in a new pane.
touch "$HERDR_UP"
run aaaa-1
grep -q "pane run w1:p1 claude --resume aaaa-1" "$HERDR_LOG" || fail "a stopped session is resumed"
ok "a stopped session is resumed in a pane"

# 2. A live process holds it: no pane is run.
printf '{"pid":%s,"sessionId":"bbbb-2","kind":"interactive"}' "$holder" > "$HOME/.claude/sessions/$holder.json"
run bbbb-2
grep -q "pane run" "$HERDR_LOG" && fail "a running session got a second copy"
grep -q "running in fab-proj pane w1:p9" "$work/out" || fail "a running session is reported where it runs: $(cat "$work/out")"
ok "a running session is not started twice, and says where it runs"

# 3. The space is down and its saved layout resumes it: the server's restore is the only copy.
rm -f "$HERDR_UP"
mkdir -p "$HOME/.config/herdr/sessions/fab-proj"
echo '{"agent_session": {"kind": "id", "value": "cccc-3"}}' > "$HOME/.config/herdr/sessions/fab-proj/session.json"
rm -f "$HOME/.claude/sessions/$holder.json"
printf '{"pid":%s,"sessionId":"cccc-3","kind":"interactive"}' "$holder" > "$work/later.json"
( sleep 1; mv "$work/later.json" "$HOME/.claude/sessions/$holder.json" ) &
run cccc-3
grep -q "proj server" "$HERDR_LOG" || fail "the space's server is started"
grep -q "pane run" "$HERDR_LOG" && fail "a restored session got a second copy"
grep -q "running in fab-proj pane w1:p9" "$work/out" || fail "a restored session is reported as running: $(cat "$work/out")"
ok "a session the restore brings back is not started twice, and is reported as running"
