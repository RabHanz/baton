#!/usr/bin/env bash
# Old path of scripts/tessaya/upstream-sync.sh; kept so existing callers keep working.
exec "$(dirname "$(readlink -f "$0")")/../tessaya/upstream-sync.sh" "$@"
