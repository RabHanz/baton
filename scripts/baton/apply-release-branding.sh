#!/usr/bin/env bash
# Build-time-only branding override for the Baton desktop release pipeline
# (.github/workflows/baton-desktop-release.yml). Run ONLY inside that
# workflow's ephemeral checkout, right before the build. It is never run
# against, and never commits to, the working tree that gets pushed anywhere.
#
# Why this exists instead of a normal source edit: scripts/build-desktop-artifact.ts,
# apps/desktop/package.json and apps/desktop/src/app/DesktopEnvironment.ts carry
# upstream T3 Code's own desktop identity (appId com.t3tools.t3code, productName
# "T3 Code (Beta)", app name "T3 Code"). Installing an unpatched Baton build
# would collide with a Director machine's real T3 Code install: same NSIS
# registry key (from appId+productName) overwrites it, and the app would share
# its userData folder. Patching those constants here, at release-build time
# only, keeps the three files byte-identical to upstream in every other build
# (dev, CI, auto-sync) and avoids a permanent merge-conflict magnet. See
# docs/baton/UPSTREAM.md "Release build overrides (not a source edit)".
set -euo pipefail

cd "$(dirname "$0")/../.."

# macOS ships BSD sed, where -i takes a (possibly empty) backup-suffix
# argument; GNU sed (Linux, and Windows' Git Bash) takes none. Passing the
# wrong form either corrupts the pattern or leaves a stray *.bak file.
if [[ "$(uname)" == "Darwin" ]]; then
  sedi() { sed -i '' "$@"; }
else
  sedi() { sed -i "$@"; }
fi

sedi 's/^const DESKTOP_APP_ID = "com\.t3tools\.t3code";$/const DESKTOP_APP_ID = "dev.rabee.baton";/' \
  scripts/build-desktop-artifact.ts
sedi 's/artifactName: "T3-Code-\${version}-\${arch}\.\${ext}",/artifactName: "Baton-${version}-${arch}.${ext}",/' \
  scripts/build-desktop-artifact.ts

sedi 's/"productName": "T3 Code (Beta)"/"productName": "Baton"/' \
  apps/desktop/package.json

# The staged package name picks the per-user NSIS folder (%LOCALAPPDATA%\Programs\<name>).
# Left as "t3code", 0.1.4 installed over stock T3 Code's folder and broke it (D86).
sedi 's/^    name: "t3code",$/    name: "baton",/' scripts/build-desktop-artifact.ts
# Own taskbar identity (matches the installer's shortcut AUMI) and own Electron profile:
# a shared userData dir means a shared single-instance lock, so only one app could run.
sedi 's/isDevelopment ? "com\.t3tools\.t3code\.dev" : "com\.t3tools\.t3code",/isDevelopment ? "dev.rabee.baton.dev" : "dev.rabee.baton",/' \
  apps/desktop/src/app/DesktopEnvironment.ts
sedi 's/{ current: "t3code-v2", legacy: "T3 Code (Alpha)" }/{ current: "baton", legacy: "T3 Code (Alpha)" }/' \
  apps/desktop/src/app/DesktopUserData.ts

sedi 's/^const APP_BASE_NAME = "T3 Code";$/const APP_BASE_NAME = "Baton";/' \
  apps/desktop/src/app/DesktopEnvironment.ts

grep -q 'DESKTOP_APP_ID = "dev.rabee.baton"' scripts/build-desktop-artifact.ts
grep -q 'artifactName: "Baton-${version}-${arch}.${ext}"' scripts/build-desktop-artifact.ts
grep -q '"productName": "Baton"' apps/desktop/package.json
grep -q 'APP_BASE_NAME = "Baton"' apps/desktop/src/app/DesktopEnvironment.ts
grep -q '^    name: "baton",$' scripts/build-desktop-artifact.ts
grep -q '"dev.rabee.baton",' apps/desktop/src/app/DesktopEnvironment.ts
grep -q 'current: "baton"' apps/desktop/src/app/DesktopUserData.ts
echo "Baton release branding applied (appId dev.rabee.baton, productName Baton, artifact Baton-<ver>-<arch>.<ext>, app name Baton, install dir Programs\\baton, AUMI dev.rabee.baton, userData %APPDATA%\\baton)."
