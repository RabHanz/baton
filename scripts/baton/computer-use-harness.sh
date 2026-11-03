#!/usr/bin/env bash
# Old path of scripts/tessaya/computer-use-harness.sh; kept so existing callers keep working.
exec "$(dirname "$(readlink -f "$0")")/../tessaya/computer-use-harness.sh" "$@"
