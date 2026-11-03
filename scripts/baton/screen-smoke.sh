#!/usr/bin/env bash
# Old path of scripts/tessaya/screen-smoke.sh; kept so existing callers keep working.
exec "$(dirname "$(readlink -f "$0")")/../tessaya/screen-smoke.sh" "$@"
