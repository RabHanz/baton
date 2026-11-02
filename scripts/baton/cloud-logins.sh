#!/usr/bin/env bash
# Writes ~/.t3/baton/cloud-logins.json: per cloud account, whether its claude.ai login is alive and how
# many days its access token has left. Run daily by baton-cloud-logins.timer (scripts/baton/systemd).
#
# A cloud account is a folder under $BATON_CLOUD_DIR (default ~/.claude-cloud); its name is the
# account's name here and in the report, so no address is ever written. One call per account
# (`claude auth status`) is enough to refresh a token that needs it. These logins are cloud-only:
# Tessaya and T3 never use them as a provider, and this script only checks and reports.
#
# {"checkedAt": <epoch seconds>, "accounts": [{"account", "state": ok|renew-soon|expired|not-logged-in,
#   "accessTokenExpiresInDays"}]}
set -uo pipefail
root="${BATON_CLOUD_DIR:-$HOME/.claude-cloud}"
out="${BATON_CLOUD_LOGINS_FILE:-${BATON_STATE:-$HOME/.t3/baton}/cloud-logins.json}"
renew_days="${BATON_CLOUD_RENEW_DAYS:-3}"
mkdir -p "$(dirname "$out")"
now=$(date +%s)
rows=()
for dir in "$root"/*/; do
  [ -d "$dir" ] || continue
  acct=$(basename "$dir")
  if [ ! -f "$dir/.credentials.json" ]; then
    rows+=("{\"account\":\"$acct\",\"state\":\"not-logged-in\"}")
    continue
  fi
  status=$(env -u CLAUDE_CODE_OAUTH_TOKEN -u ANTHROPIC_API_KEY CLAUDE_CONFIG_DIR="$dir" timeout 60 claude auth status 2> /dev/null)
  logged_in=$(echo "$status" | python3 -c "import sys,json; print(json.load(sys.stdin).get('loggedIn',False))" 2> /dev/null || echo False)
  expires=$(python3 -c "import json,sys; d=json.load(open(sys.argv[1])); o=d.get('claudeAiOauth',d); print(int(o.get('expiresAt',0))//1000)" "$dir/.credentials.json" 2> /dev/null || echo 0)
  days=$(((expires - now) / 86400))
  state=ok
  [ "$logged_in" = "True" ] || state=expired
  [ "$state" = ok ] && [ "$days" -lt "$renew_days" ] && state=renew-soon
  rows+=("{\"account\":\"$acct\",\"state\":\"$state\",\"accessTokenExpiresInDays\":$days}")
done
printf '{"checkedAt":%s,"accounts":[%s]}\n' "$now" "$(
  IFS=,
  echo "${rows[*]}"
)" > "$out"
