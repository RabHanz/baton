#!/usr/bin/env bash
#
# Boot a release archive on a copy of a box's userdata, on a spare port, and report what its
# first boot did to the data. The live install is not touched.
#
#   scripts/baton/rehearse.sh <archive> <backup-dir> [port]
#
# <backup-dir> is what deploy-beside.sh writes before a switch: state.sqlite (VACUUM INTO copy)
# and userdata-rest.tar.gz. The copy loses its T3 Connect secrets (so it cannot claim the live
# environment's tunnel) and has thread continuation and limit auto-resume off (so no agent
# resumes work in a real checkout). Leaves the server running; stop it with the printed pid.
set -euo pipefail
archive="${1:?usage: rehearse.sh <archive> <backup-dir> [port]}"
backup="${2:?usage: rehearse.sh <archive> <backup-dir> [port]}"
port="${3:-3790}"
root="${BATON_REHEARSAL_DIR:-/mnt/HC_Volume_106652742/tmp/lanes/rehearsal}/run-$(basename "$backup")"

rm -rf "$root"
mkdir -p "$root/home" "$root/runtime"
tar -xzf "$backup/userdata-rest.tar.gz" -C "$root/home"
cp "$backup/"*.sqlite "$root/home/userdata/"
rm -f "$root/home/userdata/secrets/"cloud-*
node -e '
  const fs = require("node:fs"); const p = process.argv[1];
  const s = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : {};
  s.continueThreadsAfterServerUpdate = false; s.autoResumeLimitedThreads = false;
  fs.writeFileSync(p, JSON.stringify(s, null, 2));
' "$root/home/userdata/settings.json"
tar -xzf "$archive" --strip-components=1 -C "$root/runtime"
"$root/runtime/t3" --version

legacy_sha="$(sha256sum "$root/home/userdata/state.sqlite" | cut -d' ' -f1)"
nohup "$root/runtime/t3" serve --base-dir "$root/home" --port "$port" --host 127.0.0.1 --no-browser \
  > "$root/serve.log" 2>&1 &
pid=$!
for _ in $(seq 1 90); do
  [ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/" || true)" = 200 ] && break
  sleep 2
done

echo "pid $pid  port $port  http $(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/" || true)"
echo "state.sqlite unchanged: $([ "$(sha256sum "$root/home/userdata/state.sqlite" | cut -d' ' -f1)" = "$legacy_sha" ] && echo yes || echo NO)"
ls -la "$root/home/userdata/"*.sqlite
grep -E "Baton database seeded|statev2|LegacyV1|error|Error" "$root/serve.log" "$root/home/userdata/logs/"*.log 2>/dev/null | cut -c1-240 | head -20 || true
echo "home: $root/home"
