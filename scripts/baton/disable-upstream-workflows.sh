#!/usr/bin/env bash
# Disable the inherited upstream workflows that deploy or publish with upstream's
# secrets. Done through the GitHub API, not by editing the workflow files, so the
# files stay byte-identical to upstream and never conflict on a sync. Idempotent;
# upstream-sync.sh runs it after every merge. CI and the checks stay enabled.
set -euo pipefail

repo="${BATON_REPO:-RabHanz/baton}"
disable=(
  cursor-hygiene-webhook.yml        # forwards events to Cursor with upstream's token
  deploy-relay.yml                  # deploys the T3 Connect relay
  desktop-macos-preview-publish.yml # signs and publishes macOS previews
  mobile-eas-preview.yml            # EAS builds on upstream's Expo account
  mobile-eas-production.yml         # EAS production submit
  publish-aur.yml                   # pushes the AUR package
  release.yml                       # nightly/latest release, Discord, Cloudflare
  release-desktop.yml               # called by release.yml; signing secrets
  web-preview.yml                   # Vercel previews
  pr-vouch.yml                      # upstream's contributor vouching bot
)

for wf in "${disable[@]}"; do
  state="$(gh api "repos/$repo/actions/workflows/$wf" -q .state 2>/dev/null || echo missing)"
  case "$state" in
    active) gh workflow disable "$wf" -R "$repo" && echo "disabled $wf" ;;
    missing) echo "absent   $wf" ;;
    *) echo "already  $wf ($state)" ;;
  esac
done
