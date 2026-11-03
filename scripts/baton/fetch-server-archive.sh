#!/usr/bin/env bash
# Old path of scripts/tessaya/fetch-server-archive.sh; kept so existing callers keep working.
exec "$(dirname "$(readlink -f "$0")")/../tessaya/fetch-server-archive.sh" "$@"
