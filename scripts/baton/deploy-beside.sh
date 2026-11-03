#!/usr/bin/env bash
# Old path of scripts/tessaya/deploy-beside.sh; kept so existing callers keep working.
exec "$(dirname "$(readlink -f "$0")")/../tessaya/deploy-beside.sh" "$@"
