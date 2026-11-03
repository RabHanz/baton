#!/usr/bin/env bash
# Old path of scripts/tessaya/cloud-logins.sh; kept so existing callers keep working.
exec "$(dirname "$(readlink -f "$0")")/../tessaya/cloud-logins.sh" "$@"
