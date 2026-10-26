#!/usr/bin/env bash
#
# Build the Linux CLI archive a box runs, the way upstream builds its release (docs/baton/DEPLOY.md §1).
#
#   scripts/baton/release-build.sh <version>      e.g. 0.0.45-baton.21
#
# Writes release-cli/t3-<version>-linux-x64.tar.gz and smoke-tests it. The package.json version
# bump is release-time only and is put back afterwards, so the tree stays PIN + series.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
version="${1:?usage: release-build.sh <version>}"
out="${BATON_RELEASE_DIR:-release-cli}"
export TMPDIR="${TMPDIR:-/mnt/HC_Volume_106652742/tmp/lanes}"
mkdir -p "$TMPDIR"
# shellcheck source=toolchain.sh
source scripts/baton/toolchain.sh
export PATH="$PWD/node_modules/.bin:$PATH" # build-exe spawns `vp pack` by name

# The SEA step needs Node >= 25.7; a tree still on Node 24 borrows the newest toolchain Node for it.
sea_node="node"
if [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 26 ]; then
  sea_node="$(ls -d "$baton_toolchain_dir"/node-v2[6-9]*-linux-x64/bin/node 2> /dev/null | sort -V | tail -1)"
  [ -x "$sea_node" ] || { echo "release-build: no Node >= 26 in $baton_toolchain_dir for the SEA step" >&2; exit 1; }
fi

# Reuse the installed release's Rust resource monitor rather than needing cargo here.
active="$(node -p 'require(process.env.HOME + "/.t3/runtime/service-state.json").activeVersion')"
monitor="$HOME/.t3/runtime/versions/$active/resource-monitor"
[ -d "$monitor" ] || { echo "release-build: no resource monitor at $monitor" >&2; exit 1; }

restore() { git diff --name-only -- '*package.json' | xargs -r git checkout -q --; }
trap restore EXIT

node scripts/update-release-package-versions.ts "$version"
nice -n 10 pnpm exec vp run --filter t3 build
PATH="$(dirname "$sea_node"):$PATH" nice -n 10 node apps/server/scripts/cli.ts build-exe
nice -n 10 node scripts/build-cli-archive.ts --platform linux --arch x64 --version "$version" \
  --resource-monitor-dir "$monitor" --output-dir "$out"
node scripts/smoke-cli-archive.ts --archive "$out/t3-$version-linux-x64.tar.gz" --expect-version "$version"
ls -la "$out/t3-$version-linux-x64.tar.gz"
