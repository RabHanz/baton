#!/usr/bin/env python3
"""Claude account limits for setup tokens (D90).

`cswap`'s usage endpoint gives setup tokens nothing (http-429), so this reads the limits the
inference API reports on every reply: one 1-token Haiku call per account, on one box, then
`cswap import-usage` here and on the other machines. Baton's pool reads `cswap list --json`, so
its limits display and `cswap auto` both work from the same reading.

Run with cswap's own interpreter (see systemd/baton-limits-probe.service). Tokens stay in this
process: read through cswap's API, sent as a header, never printed, logged or passed as an argument.

The headers are undocumented, so anything unexpected fails visibly: the account is left out of the
document, its hold lapses, and the unit exits non-zero. `--self-test` runs the parser checks.
"""
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

MODEL = "claude-haiku-4-5"
STATE = Path.home() / ".t3" / "baton" / "limits-state.json"
HOLD_SECONDS = 900  # three missed five-minute ticks, then cswap's own collectors take over again
SSH_KEY = Path.home() / ".config" / "venture-ssh" / "onnyx_ed25519"
PEERS = {
    "onnyx": ("onnyx@onnyx", "PATH=$HOME/.local/bin:$PATH cswap import-usage - --hold %d" % HOLD_SECONDS),
    "laptop": ("rabee@100.89.213.113", "cswap import-usage - --hold %d" % HOLD_SECONDS),
}
SSH_OPTS = ["-o", "IdentitiesOnly=yes", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10"]


def iso(ts):
    return datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def window(headers, name):
    util = headers.get(f"anthropic-ratelimit-unified-{name}-utilization")
    reset = headers.get(f"anthropic-ratelimit-unified-{name}-reset")
    if util is None or reset is None:
        raise ValueError(f"no {name} headers")
    util, reset = float(util), int(reset)
    # Observed scale is 0..1 (0.21 beside cswap's 21%; 1.0 when rejected). Refuse anything else.
    if not 0 <= util <= 1.5:
        raise ValueError(f"{name} utilization out of the known scale")
    return {"pct": round(util * 100, 1), "reset": reset}


def parse(headers):
    """Turn response headers (lower-case keys) into one reading. Raises ValueError if unusable."""
    reading = {"five_hour": window(headers, "5h"), "seven_day": window(headers, "7d")}
    reading["rejected_until"] = None
    if headers.get("anthropic-ratelimit-unified-status") == "rejected":
        reading["rejected_until"] = int(headers["anthropic-ratelimit-unified-reset"])
    return reading


def self_test():
    h = {
        "anthropic-ratelimit-unified-5h-utilization": "0.2",
        "anthropic-ratelimit-unified-5h-reset": "100",
        "anthropic-ratelimit-unified-7d-utilization": "1.0",
        "anthropic-ratelimit-unified-7d-reset": "200",
        "anthropic-ratelimit-unified-status": "rejected",
        "anthropic-ratelimit-unified-reset": "200",
    }
    r = parse(h)
    assert r["five_hour"] == {"pct": 20.0, "reset": 100} and r["rejected_until"] == 200
    assert doc_row("a", {**r, "measured_at": 0}, 150)["usage"]["fiveHour"] == {"pct": 0.0}
    for bad in ({}, {**h, "anthropic-ratelimit-unified-7d-utilization": "21"}):
        try:
            parse(bad)
        except ValueError:
            continue
        raise AssertionError("accepted bad headers")
    print("ok")


def probe(token):
    body = json.dumps({"model": MODEL, "max_tokens": 1, "messages": [{"role": "user", "content": "."}]})
    request = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data=body.encode(),
        method="POST",
        headers={
            "authorization": "Bearer " + token,
            "anthropic-version": "2023-06-01",
            "anthropic-beta": "oauth-2025-04-20",
            "content-type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            status, headers = response.status, response.headers
    except urllib.error.HTTPError as error:
        status, headers = error.code, error.headers  # a 429 still carries the limits, and costs nothing
    if status not in (200, 429):
        raise ValueError(f"http {status}")
    return parse({k.lower(): v for k, v in headers.items()})


def doc_row(email, reading, now):
    five = reading["five_hour"]
    limited = (reading.get("rejected_until") or 0) > now
    # A rejected account is not probed until its reset, and the state cannot change before then, so
    # the reading stays current. Its five-hour window can roll over meanwhile, with nothing spent.
    five_json = {"pct": 0.0} if five["reset"] <= now else {"pct": five["pct"], "resetsAt": iso(five["reset"])}
    return {
        "email": email,
        "organizationUuid": "",
        "usageStatus": "ok",
        "usageAgeSeconds": 0 if limited else max(0, now - reading["measured_at"]),
        "usage": {
            "fiveHour": five_json,
            "sevenDay": {"pct": reading["seven_day"]["pct"], "resetsAt": iso(reading["seven_day"]["reset"])},
        },
    }


def main():
    from claude_swap.oauth import extract_access_token
    from claude_swap.switcher import ClaudeAccountSwitcher

    state = json.loads(STATE.read_text()) if STATE.exists() else {}
    switcher = ClaudeAccountSwitcher()
    accounts = (switcher._get_sequence_data_migrated() or {}).get("accounts", {})
    rows, failed = [], []
    now = int(time.time())
    for number, account in sorted(accounts.items()):
        email = account["email"]
        previous = state.get(number) or {}
        if (previous.get("rejected_until") or 0) > now:
            rows.append(doc_row(email, previous, now))
            continue
        try:
            token = extract_access_token(switcher.read_account_credentials(number, email))
            if not token:
                raise ValueError("no token in this slot")
            reading = probe(token)
            reading["measured_at"] = int(time.time())
            state[number] = reading
            rows.append(doc_row(email, reading, int(time.time())))
        except (ValueError, KeyError, OSError) as error:
            state[number] = {"error": str(error), "failed_at": now}
            failed.append(number)
            print(f"slot {number}: {error}", file=sys.stderr)

    STATE.parent.mkdir(parents=True, exist_ok=True)
    STATE.write_text(json.dumps(state, indent=1))
    STATE.chmod(0o600)
    if not rows:
        sys.exit("no account could be read")

    document = json.dumps({"schemaVersion": 1, "accounts": rows})
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as handle:
        handle.write(document)
    try:
        subprocess.run(
            ["cswap", "import-usage", handle.name, "--hold", str(HOLD_SECONDS)],
            check=True, capture_output=True, timeout=60,
        )
    finally:
        os.unlink(handle.name)
    for name, (target, command) in PEERS.items():
        try:
            result = subprocess.run(
                ["ssh", "-i", str(SSH_KEY), *SSH_OPTS, target, command],
                input=document.encode(), capture_output=True, timeout=45,
            )
            if result.returncode != 0:  # a machine that is asleep must not fail the reading itself
                print(f"{name}: import failed ({result.returncode})", file=sys.stderr)
        except subprocess.TimeoutExpired:
            print(f"{name}: import timed out", file=sys.stderr)
    if failed:
        sys.exit(f"no reading for slots {', '.join(failed)}")


if __name__ == "__main__":
    self_test() if "--self-test" in sys.argv else main()
