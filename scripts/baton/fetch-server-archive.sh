#!/usr/bin/env bash
#
# Download a server archive built by the "Baton server archive" workflow and check its sha256, so a
# deploy needs no local build.
#
#   scripts/baton/fetch-server-archive.sh <version> [dir]     e.g. 0.1.5-baton.49   (dir defaults to .)
#
# Prints the archive path. Feed it to deploy-beside.sh / rehearse.sh.
set -euo pipefail
version="${1:?usage: fetch-server-archive.sh <version> [dir]}"
dir="${2:-.}"
repo="${BATON_REPO:-RabHanz/baton}"
name="t3-$version-linux-x64.tar.gz"
mkdir -p "$dir"
gh release download "server-$version" -R "$repo" --dir "$dir" --clobber -p "$name" -p "$name.sha256"
(cd "$dir" && sha256sum -c "$name.sha256" >&2)
echo "$dir/$name"
