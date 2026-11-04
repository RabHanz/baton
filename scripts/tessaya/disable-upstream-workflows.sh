#!/usr/bin/env bash
# Disable every inherited upstream workflow except Tessaya's own and a short allowlist, through the
# GitHub API so the files stay byte-identical to upstream. Upstream's workflows either run on
# Blacksmith runners this repository does not have (they queue forever, D77) or deploy and publish
# with upstream's secrets. An allowlist rather than a denylist, so a workflow upstream adds later is
# off by default. Tessaya's own (baton*.yml) are always kept, and switched back on if found off.
# Idempotent; upstream-sync.sh and auto-sync.sh run it after every sync.
set -euo pipefail
. "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/lib/tessaya-env.sh" 2> /dev/null || true

repo="${TESSAYA_REPO:-${BATON_REPO:-RabHanz/baton}}"
keep=(
  pr-size.yml    # labels PR size, GitHub-hosted, no secrets
  issue-labels.yml
)

gh api "repos/$repo/actions/workflows" --paginate --jq '.workflows[] | "\(.state) \(.path)"' |
  while read -r state path; do
    file="$(basename "$path")"
    case "$file" in
      baton*.yml)
        if [ "$state" != active ]; then
          gh workflow enable "$file" -R "$repo" > /dev/null && echo "enabled  $file (was $state)"
        else echo "keep     $file"; fi
        continue ;;
    esac
    if printf '%s\n' "${keep[@]}" | grep -qxF "$file"; then
      echo "keep     $file ($state)"
    elif [ "$state" = active ]; then
      gh workflow disable "$file" -R "$repo" > /dev/null && echo "disabled $file"
    fi
  done
