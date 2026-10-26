#!/usr/bin/env bash
#
# The gates a Baton tree passes before it merges or deploys. Local on purpose: upstream's CI runs
# on Blacksmith runners this repository does not have, so its jobs queue forever here.
#
#   scripts/baton/gates.sh [--install] [--build] [--skip-tests]
#
#   --install     pnpm install --frozen-lockfile first (after a sync or a fresh clone)
#   --build       also build the server bundle and web client the release is cut from
#
# Order: patch series (cheapest, catches an unrecorded upstream edit) → typecheck → lint → tests of
# every package Baton adds to or patches → build. Stops at the first failure.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

install=0 build=0 tests=1
for a in "$@"; do
  case "$a" in
    --install) install=1 ;;
    --build) build=1 ;;
    --skip-tests) tests=0 ;;
    *) echo "gates: unknown argument $a" >&2; exit 1 ;;
  esac
done

export TMPDIR="${TMPDIR:-/mnt/HC_Volume_106652742/tmp/lanes}"
[ -d "$TMPDIR" ] || export TMPDIR="$HOME/tmp" && mkdir -p "$TMPDIR"
# shellcheck source=toolchain.sh
source scripts/baton/toolchain.sh

step() { printf '\n==> %s\n' "$*"; }
started="$(date +%s)"

step "patch series"
bash scripts/baton/patches.sh verify
bash scripts/baton/patches.test.sh

if [ "$install" -eq 1 ]; then
  step "install"
  nice -n 10 pnpm install --frozen-lockfile
fi

step "typecheck"
nice -n 10 pnpm -s typecheck

step "lint"
nice -n 10 pnpm -s lint

if [ "$tests" -eq 1 ]; then
  # Every package the series patches or Baton adds code to. Not the whole monorepo: marketing,
  # mobile's native checks and the reference repos are upstream's and untouched.
  for pkg in packages/baton-contracts packages/baton-shared packages/client-runtime packages/baton-voice \
    apps/web apps/desktop apps/server; do
    step "test $pkg"
    extra=()
    # Upstream's libsecret helper test compiles native code; a box without pkg-config cannot run it.
    if [ "$pkg" = apps/desktop ] && ! command -v pkg-config > /dev/null; then
      extra=(--exclude scripts/browser-secret-native.test.mjs)
      echo "(no pkg-config: skipping scripts/browser-secret-native.test.mjs)"
    fi
    (cd "$pkg" && nice -n 10 pnpm -s test "${extra[@]}")
  done
fi

if [ "$build" -eq 1 ]; then
  step "build"
  nice -n 10 pnpm exec vp run --filter t3 build
fi

printf '\ngates: passed in %ss\n' "$(($(date +%s) - started))"
