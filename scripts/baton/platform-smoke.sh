#!/usr/bin/env bash
# Old path of scripts/tessaya/platform-smoke.sh; kept so existing callers keep working.
exec "$(dirname "$(readlink -f "$0")")/../tessaya/platform-smoke.sh" "$@"
