#!/usr/bin/env bash
# Old path of scripts/tessaya/snapshot-userdata.sh; kept so existing callers keep working.
exec "$(dirname "$(readlink -f "$0")")/../tessaya/snapshot-userdata.sh" "$@"
