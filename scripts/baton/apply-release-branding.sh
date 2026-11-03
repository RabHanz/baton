#!/usr/bin/env bash
# Old path of scripts/tessaya/apply-release-branding.sh; kept so existing callers keep working.
exec "$(dirname "$(readlink -f "$0")")/../tessaya/apply-release-branding.sh" "$@"
