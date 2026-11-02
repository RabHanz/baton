#!/usr/bin/env bash
# macOS and Linux smoke (docs/baton/PLATFORMS.md): launch a released Tessaya build headless with the test hooks and
# see how far it got. Plain bash, no install:   platform-smoke.sh <linux|macos> <artifact> <out-dir>
# Passes when the app drew a window (a PNG in BATON_TEST_DIR) and logged the voice start steps. It prints what it
# found either way, because the point is an honest per-platform report.
set -uo pipefail
platform="${1:?linux|macos}"; artifact="${2:?path to the AppImage or dmg}"; out="${3:?output folder}"
mkdir -p "$out/shots" "$out/wav"
home="$(mktemp -d)"; export HOME="$home"            # a clean user: nothing of anyone's
userdata="$HOME/.t3/userdata"; mkdir -p "$userdata"
printf '%s' '{"enabled":true,"wakeWords":[{"word":"Sebastian","enabled":true,"threshold":0.9}]}' > "$userdata/fabric-voice.json"
phrase="Sebastian. What is the capital of Brazil?"
wav="$out/wav/wake.wav"
case "$platform" in
  linux)
    espeak-ng -w "$out/wav/raw.wav" "$phrase" && ffmpeg -loglevel error -y -i "$out/wav/raw.wav" -ar 16000 -ac 1 "$wav"
    # No sound card on a CI machine: ALSA's null device stands in, so the sidecar can list and open "a microphone".
    printf 'pcm.!default { type null }\nctl.!default { type null }\n' > "$HOME/.asoundrc"
    chmod +x "$artifact"
    run=(xvfb-run -a "$artifact" --appimage-extract-and-run --no-sandbox)
    ;;
  macos)
    say -o "$out/wav/raw.aiff" "$phrase" && afconvert -f WAVE -d LEI16@16000 -c 1 "$out/wav/raw.aiff" "$wav"
    mnt="$(mktemp -d)"; hdiutil attach "$artifact" -mountpoint "$mnt" -nobrowse -quiet
    cp -R "$mnt"/*.app "$HOME/Tessaya.app"; hdiutil detach "$mnt" -quiet || true
    xattr -cr "$HOME/Tessaya.app"
    run=("$HOME/Tessaya.app/Contents/MacOS/Tessaya" --no-sandbox)
    ;;
  *) echo "unknown platform $platform"; exit 2 ;;
esac
printf 'wake.wav 4000\n30000\n' > "$out/wav/list.txt"; cp "$wav" "$out/wav/wake.wav" 2>/dev/null || true
# The sidecar on its own first, so a crash in it is told apart from a crash in the app.
sidecar=""
case "$platform" in
  macos) sidecar="$HOME/Tessaya.app/Contents/Resources/baton-voice/baton-dictation" ;;
  linux) sidecar="$(find "$HOME" -name baton-dictation -type f 2>/dev/null | head -1)" ;;
esac
if [ -n "$sidecar" ] && [ -x "$sidecar" ]; then
  echo "--- sidecar alone: $sidecar ---"
  "$sidecar" devices 2>&1 | head -5; echo "devices exit=${PIPESTATUS[0]}"
  printf '{"cmd":"devices"}\n' | timeout 15 "$sidecar" serve 2>&1 | head -8; echo "serve exit=${PIPESTATUS[1]}"
fi
export BATON_TEST_WAV="$out/wav/list.txt" BATON_TEST_DIR="$out/shots"
"${run[@]}" > "$out/app.log" 2>&1 &
pid=$!
# Tessaya starts in the tray with no window; a second launch means "show me Tessaya", which opens it, and the app
# records the page it draws.
sleep 25
"${run[@]}" > "$out/app2.log" 2>&1 &
log="$userdata/logs/voice-turns.ndjson"
# The speech model downloads on first use (about 740 MB), so the voice start can take minutes. Wait for loop-started,
# then for the test audio to play out and for the phrase to be heard.
waitfor() { # <pattern> <max seconds>
  local n=0
  while [ "$n" -lt "$2" ]; do
    if [ -f "$log" ] && grep -Eq "$1" "$log"; then return 0; fi
    kill -0 "$pid" 2>/dev/null || return 1
    sleep 3; n=$((n + 3))
  done
  return 1
}
waitfor '"step":"loop-started"|"step":"error"' "${SMOKE_START_SECONDS:-900}" || true
waitfor 'wake_only|agent_turn|"type":"end"' "${SMOKE_HEAR_SECONDS:-180}" || true
sleep 3
kill "$pid" 2>/dev/null || true
mkdir -p "$out/logs"; cp -R "$userdata/logs/." "$out/logs/" 2>/dev/null || true
shots=$(find "$out/shots" -name '*.png' 2>/dev/null | wc -l | tr -d ' ')
opened=0
[ -f "$log" ] && grep -Eq '"kind":"open_main".*"visible":true' "$log" && opened=1
# macOS does not log open_main for a second launch, but the app says when it made its window.
grep -q 'main window created' "$out/app.log" 2>/dev/null && opened=1
steps=$( [ -f "$log" ] && grep -o '"step":"[a-z-]*"' "$log" | sed 's/"step":"//;s/"//' | tr '\n' ' ' )
if ! kill -0 "$pid" 2>/dev/null; then echo "NOTE the app process ($pid) had exited before the end"; fi
if [ "$platform" = macos ]; then
  # A native crash leaves no line in our logs, but macOS writes a report.
  mkdir -p "$out/crash"; cp /Users/runner/Library/Logs/DiagnosticReports/* "$out/crash/" 2>/dev/null || true
  ls "$out/crash" | head -5 | sed 's/^/crash report: /'
  head -c 3000 "$out/crash/"*Tessaya*.ips 2>/dev/null | head -60
  echo "--- app2.log (tail) ---"; tail -n 10 "$out/app2.log" 2>/dev/null || true
fi
echo "platform: $platform"
echo "window opened (logged): $opened; page captures: $shots"
echo "voice start steps: ${steps:-none}"
echo "--- app.log (tail) ---"; tail -n 25 "$out/app.log" 2>/dev/null || true
status=0
{ [ "$shots" -gt 0 ] || [ "$opened" = 1 ]; } || { echo "FAIL no window was drawn"; status=1; }
[ -n "$steps" ] || { echo "FAIL no voice start steps were logged"; status=1; }
echo "$steps" | grep -q 'loop-started' || { echo "FAIL the voice start never reached loop-started"; status=1; }
[ -f "$log" ] && grep -q '"kind":"test-audio"' "$log" || { echo "FAIL the test audio never reached the voice loop"; status=1; }
if [ "${REQUIRE_WAKE:-0}" = 1 ]; then [ -f "$log" ] && grep -Eq 'wake_only|agent_turn' "$log" || { echo "FAIL the wake phrase was not heard"; status=1; }; fi
[ -f "$log" ] && grep -q '"kind":"test-audio"' "$log" || { echo "NOTE the test audio never reached the voice start"; }
exit $status
