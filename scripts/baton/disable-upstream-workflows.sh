#!/usr/bin/env bash
# Disable every inherited upstream workflow except a short allowlist, through the GitHub API so
# the files stay byte-identical to upstream. Upstream's workflows either run on Blacksmith runners
# this repository does not have (they queue forever, D77) or deploy and publish with upstream's
# secrets. An allowlist rather than a denylist, so a workflow upstream adds later is off by default.
# Idempotent; upstream-sync.sh runs it after every sync.
set -euo pipefail

repo="${BATON_REPO:-RabHanz/baton}"
keep=(
  baton.yml      # Baton's patch-series check, GitHub-hosted
  pr-size.yml    # labels PR size, GitHub-hosted, no secrets
  issue-labels.yml
)

gh api "repos/$repo/actions/workflows" --paginate --jq '.workflows[] | "\(.state) \(.path)"' |
  while read -r state path; do
    file="$(basename "$path")"
    if printf '%s\n' "${keep[@]}" | grep -qxF "$file"; then
      echo "keep     $file ($state)"
    elif [ "$state" = active ]; then
      gh workflow disable "$file" -R "$repo" > /dev/null && echo "disabled $file"
    fi
  done
