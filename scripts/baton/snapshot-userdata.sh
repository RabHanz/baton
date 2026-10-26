#!/usr/bin/env bash
# Snapshot ~/.t3/userdata into <dir> the way deploy-beside.sh backs it up (each *.sqlite as a
# VACUUM INTO copy, the rest as userdata-rest.tar.gz), for rehearse.sh. Reads only.
#   scripts/baton/snapshot-userdata.sh <dir>
set -euo pipefail
dir="${1:?usage: snapshot-userdata.sh <dir>}"
mkdir -p "$dir"
for db in "$HOME"/.t3/userdata/*.sqlite; do
  [ -s "$db" ] || continue
  node -e "const {DatabaseSync}=require('node:sqlite');new DatabaseSync(process.argv[1],{readOnly:true}).exec(\"VACUUM INTO '\"+process.argv[2]+\"'\")" \
    "$db" "$dir/$(basename "$db")"
done
tar -czf "$dir/userdata-rest.tar.gz" -C "$HOME/.t3" --exclude='userdata/*.sqlite*' --exclude='userdata/logs' userdata
du -sh "$dir"
