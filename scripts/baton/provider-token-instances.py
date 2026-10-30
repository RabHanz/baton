#!/usr/bin/env python3
"""Give each extra Claude account a T3 provider instance that runs on its setup token (D91).

Run with cswap's interpreter on each machine. For every slot below it writes the slot's token into
T3's secret store (never into settings.json), then adds the instance to settings.json with
CLAUDE_CODE_OAUTH_TOKEN marked sensitive and stored, the shape T3 itself writes. The server watches
settings.json and picks the change up. The token is read in-process and never printed or passed on.

The default `claudeAgent` instance is left alone unless `--pin-default`: on a box it runs whatever
cswap has active (a setup token too), and pinning a token on it would silently stop cswap rotation
reaching it. The laptop's CLI keeps a full login for Remote Control, so there the flag gives T3's
default instance slot 4's token and leaves that login where it is.
"""
import base64
import json
import os
import shutil
import sys
import time
from pathlib import Path

INSTANCES = {
    "5": ("claudeAgent_optima", "Optima", "#ea580c", ".claude-b"),
    "6": ("claudeAgent_signzart", "Signzart", "#dc2626", ".claude-c"),
}
VARIABLE = "CLAUDE_CODE_OAUTH_TOKEN"
USERDATA = Path.home() / ".t3" / "userdata"


def encode(value):
    return base64.urlsafe_b64encode(value.encode()).decode().rstrip("=")


def write_private(path, data):
    temp = path.with_suffix(path.suffix + ".tmp")
    descriptor = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, "wb") as handle:
        handle.write(data)
    os.replace(temp, path)


def main():
    from claude_swap.oauth import extract_access_token
    from claude_swap.switcher import ClaudeAccountSwitcher

    switcher = ClaudeAccountSwitcher()
    accounts = (switcher._get_sequence_data_migrated() or {}).get("accounts", {})
    settings_path = USERDATA / "settings.json"
    settings = json.loads(settings_path.read_text(encoding="utf-8")) if settings_path.exists() else {}
    instances = settings.setdefault("providerInstances", {})
    wanted = dict(INSTANCES)
    if "--pin-default" in sys.argv:
        wanted["4"] = ("claudeAgent", "Rabee", "#4225eb", None)
    for number, (instance_id, name, accent, home) in wanted.items():
        account = accounts.get(number)
        token = account and extract_access_token(switcher.read_account_credentials(number, account["email"]))
        if not token:
            raise SystemExit(f"slot {number}: no token readable")
        (USERDATA / "secrets").mkdir(parents=True, exist_ok=True)
        secret = f"provider-env-{encode(instance_id)}-{encode(VARIABLE)}.bin"
        write_private(USERDATA / "secrets" / secret, token.encode())
        current = instances.get(instance_id, {})
        config = dict(current.get("config") or {})
        if home:
            home_path = Path.home() / home
            home_path.mkdir(exist_ok=True)
            config["homePath"] = str(home_path)
        instances[instance_id] = {
            **current,
            "driver": "claudeAgent",
            "displayName": current.get("displayName", name),
            "accentColor": current.get("accentColor", accent),
            "enabled": True,
            "environment": [{"name": VARIABLE, "value": "", "sensitive": True, "valueRedacted": True}],
            "config": config,
        }
        print(f"{instance_id}: token stored")
    if settings_path.exists():
        shutil.copy2(settings_path, f"{settings_path}.bak-before-token-instances-{int(time.time())}")
    write_private(settings_path, json.dumps(settings, indent=2).encode())


if __name__ == "__main__":
    main()
