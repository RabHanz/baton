#!/usr/bin/env bash
# Old path of scripts/tessaya/revoke-proof-sessions.sh; kept so existing callers keep working.
exec "$(dirname "$(readlink -f "$0")")/../tessaya/revoke-proof-sessions.sh" "$@"
