#!/usr/bin/env bash
# Old path of scripts/tessaya/release-build.sh; kept so existing callers keep working.
exec "$(dirname "$(readlink -f "$0")")/../tessaya/release-build.sh" "$@"
