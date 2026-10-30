#!/usr/bin/env bash
#
# Print the T3 Connect public config (Clerk publishable key, Clerk JWT template, Clerk CLI OAuth
# client id, relay URL) as KEY=value lines, read out of the official hosted web client.
#
# Why (D89): a desktop build without these values cannot sign in to T3 Connect, so every
# environment saved as a relay connection stays "Waiting for the T3 Connect sign-in to load"
# forever. Baton 0.1.5 on Windows shipped that way and reached neither box. The values are public
# (they sit in plain text in app.t3.codes' bundle), but they are upstream's cloud, so they are read
# at build time rather than committed — same rule as cloud-public-config.sh for the server.
# The relay OTLP ingest token is deliberately NOT printed (a credential; see cloud-public-config.sh).
#
# Usage: scripts/baton/hosted-public-config.sh [https://app.t3.codes] >> "$GITHUB_ENV"
set -euo pipefail

base="${1:-https://app.t3.codes}"
index_html="$(curl -fsSL "$base/")"
entry="$(grep -oE '/assets/index-[A-Za-z0-9_-]+\.js' <<<"$index_html" | head -n1)"
[ -n "$entry" ] || { echo "hosted-public-config: no entry script in $base/" >&2; exit 1; }

# The config is inlined into a few chunks (publicConfig-*, utils-*); scan those first, then the rest.
chunks="$(curl -fsSL "$base$entry" | grep -oE 'assets/[A-Za-z0-9_.-]+\.js' | sort -u)"
ordered="$(grep -E 'publicConfig-|utils-' <<<"$chunks" || true; grep -vE 'publicConfig-|utils-' <<<"$chunks" || true)"

found=""
for chunk in $ordered; do
  body="$(curl -fsSL "$base/$chunk" || true)"
  if grep -q 'VITE_CLERK_PUBLISHABLE_KEY:`' <<<"$body"; then
    found="$body"
    break
  fi
done
[ -n "$found" ] || { echo "hosted-public-config: no chunk carries VITE_CLERK_PUBLISHABLE_KEY" >&2; exit 1; }

value() { grep -oE "$1:\`[^\`]*\`" <<<"$found" | head -n1 | sed -E "s/^$1:\`(.*)\`$/\1/"; }
publishable="$(value VITE_CLERK_PUBLISHABLE_KEY)"
template="$(value VITE_CLERK_JWT_TEMPLATE)"
client_id="$(value VITE_CLERK_CLI_OAUTH_CLIENT_ID)"
relay="$(value VITE_T3CODE_RELAY_URL)"

for pair in "T3CODE_CLERK_PUBLISHABLE_KEY=$publishable" "T3CODE_CLERK_JWT_TEMPLATE=$template" \
  "T3CODE_CLERK_CLI_OAUTH_CLIENT_ID=$client_id" "T3CODE_RELAY_URL=$relay"; do
  [ -n "${pair#*=}" ] || { echo "hosted-public-config: ${pair%%=*} is empty" >&2; exit 1; }
  echo "$pair"
done
[[ "$publishable" == pk_* ]] || { echo "hosted-public-config: publishable key is not pk_*" >&2; exit 1; }
[[ "$relay" == https://* ]] || { echo "hosted-public-config: relay URL is not https" >&2; exit 1; }
