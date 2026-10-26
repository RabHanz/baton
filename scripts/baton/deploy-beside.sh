#!/usr/bin/env bash
#
# Install a Baton build beside the running one and switch the service to it, with a rollback
# script written before anything changes (docs/baton/DEPLOY.md §2–6).
#
#   scripts/baton/deploy-beside.sh <archive> <version> [--host <ssh-target>]
#
# Locally: backs up userdata (state.sqlite via VACUUM INTO, the rest as a tarball), the drop-ins
# and service-state.json into $BATON_BACKUP_ROOT/<version>-<stamp>/, writes rollback.sh there,
# extracts the archive into ~/.t3/runtime/versions/<version>/, repoints fabric-runtime.conf,
# restarts, and waits for HTTP 200. With --host it copies the archive and itself to that box and
# runs there. Exit 1 if the new version does not come up; the rollback script is printed either way.
set -euo pipefail

archive="${1:?usage: deploy-beside.sh <archive> <version> [--host <target>]}"
version="${2:?usage: deploy-beside.sh <archive> <version> [--host <target>]}"
host=""
[ "${3:-}" = "--host" ] && host="${4:?--host needs a target}"

if [ -n "$host" ]; then
  key="${BATON_SSH_KEY:-$HOME/.config/venture-ssh/onnyx_ed25519}"
  ssh_opts=(-i "$key" -o IdentitiesOnly=yes -o BatchMode=yes)
  ssh "${ssh_opts[@]}" "$host" 'mkdir -p ~/dev/baton-deploy'
  scp "${ssh_opts[@]}" "$archive" "$0" "$host:dev/baton-deploy/"
  exec ssh "${ssh_opts[@]}" "$host" \
    "bash ~/dev/baton-deploy/deploy-beside.sh ~/dev/baton-deploy/$(basename "$archive") $version"
fi

# A non-interactive ssh shell has no nvm; the backups need node:sqlite (Node >= 22.5).
if ! command -v node > /dev/null; then
  nvm_node="$(ls -d "$HOME"/.nvm/versions/node/v2[2-9]*/bin 2> /dev/null | sort -V | tail -1)"
  [ -n "$nvm_node" ] && export PATH="$nvm_node:$PATH"
fi
command -v node > /dev/null || { echo "deploy-beside: no node on PATH for the backup" >&2; exit 1; }

t3home="$HOME/.t3"
dropins="$HOME/.config/systemd/user/t3code.service.d"
root="${BATON_BACKUP_ROOT:-}"
[ -n "$root" ] || { [ -d /mnt/HC_Volume_106652742/dev/backups ] && root=/mnt/HC_Volume_106652742/dev/backups/baton || root="$HOME/backups/baton"; }
backup="$root/before-$version-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$backup"

# Every SQLite file (upstream's state.sqlite and statev2.sqlite, Baton's baton.sqlite), each a
# consistent VACUUM INTO copy rather than a file copy of a live WAL database.
for db in "$t3home"/userdata/*.sqlite; do
  [ -s "$db" ] || continue
  node -e "const {DatabaseSync}=require('node:sqlite');new DatabaseSync(process.argv[1],{readOnly:true}).exec(\"VACUUM INTO '\"+process.argv[2]+\"'\")" \
    "$db" "$backup/$(basename "$db")"
done
tar -czf "$backup/userdata-rest.tar.gz" -C "$t3home" --exclude='userdata/*.sqlite*' --exclude='userdata/logs' userdata
cp "$t3home/runtime/service-state.json" "$backup/service-state.json"
cp -r "$dropins" "$backup/dropins"
previous="$(node -p 'require(process.argv[1]).activeVersion' "$backup/service-state.json")"

cat > "$backup/rollback.sh" << EOF
#!/usr/bin/env bash
# Roll $version back to $previous: restore the drop-ins and service-state, restart.
# Data written by $version stays; $previous reads only what it knew (D7).
set -euo pipefail
rm -f "$dropins"/*.conf
cp "$backup/dropins/"*.conf "$dropins/"
cp "$backup/service-state.json" "$t3home/runtime/service-state.json"
systemctl --user daemon-reload
systemctl --user restart t3code.service
echo "rolled back to $previous"
EOF
chmod +x "$backup/rollback.sh"
echo "backup $(du -sh "$backup" | cut -f1) in $backup; rollback: $backup/rollback.sh"

dest="$t3home/runtime/versions/$version"
mkdir -p "$dest"
tar -xzf "$archive" --strip-components=1 -C "$dest"
"$dest/t3" --version
printf '%s' "$version" > "$dest/.install-complete"

printf '[Service]\nExecStart=\nExecStart=%%h/.t3/runtime/versions/%s/t3 __service-launcher\n' "$version" > "$dropins/fabric-runtime.conf"
printf '{\n  "protocol": 3,\n  "activeVersion": "%s"\n}\n' "$version" > "$t3home/runtime/service-state.json"
systemctl --user daemon-reload
systemctl --user restart t3code.service

code=000
for _ in $(seq 1 60); do
  code="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3773/ || true)"
  [ "$code" = 200 ] && break
  sleep 2
done
echo "active: $(systemctl --user is-active t3code.service)  http: $code  $(systemctl --user show t3code.service -p ExecStart | grep -o 'versions/[^/]*/t3')"
[ "$code" = 200 ] || { echo "deploy-beside: $version did not come up; run $backup/rollback.sh" >&2; exit 1; }
