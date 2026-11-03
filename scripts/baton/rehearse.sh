#!/usr/bin/env bash
# Old path of scripts/tessaya/rehearse.sh; kept so existing callers keep working.
exec "$(dirname "$(readlink -f "$0")")/../tessaya/rehearse.sh" "$@"
