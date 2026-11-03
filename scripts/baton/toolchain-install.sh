#!/usr/bin/env bash
# Old path of scripts/tessaya/toolchain-install.sh; kept so existing callers keep working.
exec "$(dirname "$(readlink -f "$0")")/../tessaya/toolchain-install.sh" "$@"
