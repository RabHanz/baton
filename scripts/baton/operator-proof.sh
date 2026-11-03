#!/usr/bin/env bash
# Old path of scripts/tessaya/operator-proof.sh; kept so existing callers keep working.
exec "$(dirname "$(readlink -f "$0")")/../tessaya/operator-proof.sh" "$@"
