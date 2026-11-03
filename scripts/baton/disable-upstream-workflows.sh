#!/usr/bin/env bash
# Old path of scripts/tessaya/disable-upstream-workflows.sh; kept so existing callers keep working.
exec "$(dirname "$(readlink -f "$0")")/../tessaya/disable-upstream-workflows.sh" "$@"
