#!/usr/bin/env bash
# End-to-end proof that a title someone sets on a mirrored live-session thread sticks (D129).
# A scratch HOME holds one fake "live" Claude session (a sleeping process, its descriptor and a
# transcript); the real server mirrors it into a scratch T3 home; the proof renames and regenerates
# the title through the CLI (the same thread.metadata.update the web and phone clients send), lets
# the mirror run several full passes, restarts the server, and checks the title each time.
# Usage: scripts/baton/rename-proof.sh <work-dir> [transcript-file]. Never touches ~/.t3.
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="${1:?work dir}"
OUT="${2:-$WORK/transcript.txt}"
H="$WORK/t3home"; FAKE="$WORK/home"; PROJ="$WORK/proj"; SID="rename-proof-$(date +%s)"
mkdir -p "$H" "$FAKE/.claude/sessions" "$FAKE/.claude/projects/p" "$PROJ"
git -C "$PROJ" init -q 2>/dev/null
: >"$OUT"
say() { echo "$*" | tee -a "$OUT"; }
fail() { say "FAIL: $*"; cleanup; exit 1; }
SERVER=""; SLEEPER=""
cleanup() { [ -n "$SERVER" ] && kill "$SERVER" 2>/dev/null; [ -n "$SLEEPER" ] && kill "$SLEEPER" 2>/dev/null; wait 2>/dev/null; true; }
trap cleanup EXIT
t3() { (cd "$ROOT" && node apps/server/src/bin.ts "$@" --base-dir "$H"); }
BOX="$(hostname | cut -d. -f1)"

sleep 3000 & SLEEPER=$!
now=$(($(date +%s) * 1000))
cat >"$FAKE/.claude/sessions/$SLEEPER.json" <<J
{"pid":$SLEEPER,"sessionId":"$SID","cwd":"$PROJ","name":"auto name","nameSource":"auto","kind":"interactive","entrypoint":"cli","status":"idle","updatedAt":$now}
J
ts() { date -u +%Y-%m-%dT%H:%M:%S.000Z; }
{
  echo "{\"type\":\"user\",\"uuid\":\"u1\",\"timestamp\":\"$(ts)\",\"message\":{\"role\":\"user\",\"content\":\"hello from the proof\"}}"
  echo "{\"type\":\"assistant\",\"uuid\":\"a1\",\"timestamp\":\"$(ts)\",\"message\":{\"role\":\"assistant\",\"content\":[{\"type\":\"text\",\"text\":\"hello back\"}]}}"
} >"$FAKE/.claude/projects/p/$SID.jsonl"

PORT=$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1])')
start() {
  (cd "$ROOT" && HOME="$FAKE" BATON_CLAUDE_CONFIG_DIRS="" setsid node apps/server/src/bin.ts --base-dir "$H" --port "$PORT" --no-browser >>"$WORK/server.log" 2>&1 & echo $! >"$WORK/server.pid")
  SERVER=$(cat "$WORK/server.pid")
  for _ in $(seq 60); do curl -fs "http://127.0.0.1:$PORT/" >/dev/null 2>&1 && return 0; sleep 1; done
  fail "server did not start"
}
stop() { kill "$SERVER" 2>/dev/null; wait "$SERVER" 2>/dev/null; sleep 2; SERVER=""; }
title() { t3 thread list --project "$PROJ" --json 2>>"$OUT" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);const a=Array.isArray(j)?j:j.threads??[];console.log(JSON.stringify({id:a[0]?.threadId??a[0]?.id,title:a[0]?.title,n:a.length}))})'; }
field() { node -e "console.log(JSON.parse(process.argv[1]).$2)" "$1"; }
expect_title() { # label predicate-text actual
  say "  $1: \"$3\""
}

say "== rename proof $(date -u +%FT%TZ) box=$BOX session=$SID"
start
say "-- server up on :$PORT; waiting for the mirror to create the thread"
for _ in $(seq 40); do J=$(title); [ "$(field "$J" n)" != "0" ] && [ "$(field "$J" id)" != "undefined" ] && break; sleep 2; done
J=$(title); ID=$(field "$J" id); T0=$(field "$J" title)
[ "$ID" != "undefined" ] || fail "no mirrored thread appeared"
say "mirrored thread $ID titled \"$T0\""
case "$T0" in *" · $BOX") say "OK initial title is the mirror's own ('... · $BOX')";; *) fail "initial title not in mirror form: $T0";; esac

NEW="Renamed by the Director"
say "-- rename through the command clients use (thread.metadata.update)"
t3 thread rename "$ID" "$NEW" 2>&1 | tee -a "$OUT"
say "-- change the session's own name and add transcript lines, then let the mirror run full passes"
sed -i 's/"name":"auto name"/"name":"a different auto name"/' "$FAKE/.claude/sessions/$SLEEPER.json"
echo "{\"type\":\"assistant\",\"uuid\":\"a2\",\"timestamp\":\"$(ts)\",\"message\":{\"role\":\"assistant\",\"content\":[{\"type\":\"text\",\"text\":\"more\"}]}}" >>"$FAKE/.claude/projects/p/$SID.jsonl"
sleep 14
T1=$(field "$(title)" title); say "after mirror passes: \"$T1\""
[ "$T1" = "$NEW" ] || fail "mirror overwrote the renamed title: $T1"
say "OK rename survived the mirror"

say "-- regenerate title (thread.metadata.update regenerateTitle), then more passes"
t3 thread retitle "$ID" 2>&1 | tee -a "$OUT"
sleep 14
T2=$(field "$(title)" title); say "after regenerate + passes: \"$T2\""
case "$T2" in *" · $BOX") fail "mirror reverted the title after regenerate: $T2";; esac
say "OK title not reverted to the mirror form"

say "-- restart the server"
stop; start
sleep 14
T3=$(field "$(title)" title); say "after restart + passes: \"$T3\""
[ "$T3" = "$T2" ] || fail "title changed across restart: $T2 -> $T3"
say "OK title persisted across restart"
say "PASS"
