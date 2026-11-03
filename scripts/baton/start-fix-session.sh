#!/usr/bin/env bash
# Old path of scripts/tessaya/start-fix-session.sh; kept so existing callers keep working.
exec "$(dirname "$(readlink -f "$0")")/../tessaya/start-fix-session.sh" "$@"
