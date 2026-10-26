#!/usr/bin/env bash
# Revoke the browser sessions a live proof paired (their client label matches the pattern), so a
# proof leaves no full-scope session behind.
#   scripts/baton/revoke-proof-sessions.sh [label-regex]   default: baton[0-9]+-|rehearsal|proof
set -euo pipefail
pattern="${1:-baton[0-9]+-|rehearsal|proof}"
t3="$HOME/.t3/runtime/versions/$(node -p 'require(process.env.HOME + "/.t3/runtime/service-state.json").activeVersion')/t3"
ids="$("$t3" auth session list --base-dir "$HOME/.t3" 2>/dev/null |
  awk -v pat="$pattern" '/^[0-9a-f-]{36}$/ { id = $1 } /^  client: / { if ($0 ~ pat) print id }')"
for id in $ids; do "$t3" auth session revoke "$id" --base-dir "$HOME/.t3" > /dev/null && echo "revoked $id"; done
"$t3" auth pairing list --base-dir "$HOME/.t3" 2>/dev/null | awk -v pat="$pattern" '$2 ~ pat { print $1 }' |
  while read -r link; do "$t3" auth pairing revoke "$link" --base-dir "$HOME/.t3" > /dev/null && echo "revoked link $link"; done
