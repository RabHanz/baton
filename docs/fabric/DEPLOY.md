# Deploying this fork onto a machine that runs stock T3 Code

Written from the first real deploy (signzart-prod, 2026-09-18, `0.0.43-fabric.1`
replacing `0.0.42`), so every step below is one that was actually needed. Two
rules shape all of it:

1. **Build the way upstream builds.** The runtime layout, the SEA, the archive
   and the smoke test are upstream's scripts, run in upstream's order. Inventing
   a layout produces something that starts once and cannot be updated, rolled
   back, or reasoned about by `t3 update`.
2. **Never edit the installed release.** The fork goes in _beside_ it as another
   version, and the unit is repointed with a systemd drop-in. Rolling back is
   then deleting a file, not restoring a tree.

## 0. Before anything

```bash
tar -czf <backups>/t3-userdata-$(date -u +%Y%m%dT%H%M%SZ).tar.gz -C ~/.t3 userdata
```

The migrations this fork adds are additive and reversible, but a tarball of
`userdata` is the only thing that makes "roll back" a promise rather than a hope.

## 1. Build the distribution

Requires **Node ≥ 25.7** for `--build-sea` (the repo itself runs on Node 24; the
pack step is the only thing that needs the newer one, and `VP_NODE_VERSION` is
not honoured — put the newer `node` first on `PATH` for that step only).

```bash
node scripts/update-release-package-versions.ts 0.0.43-fabric.1   # release-time, not committed
vp run --filter t3 build                                          # server bundle + apps/server/dist/client
node apps/server/scripts/cli.ts build-exe                         # vp pack with T3CODE_PACK_EXE=1
node scripts/build-cli-archive.ts \
  --platform linux --arch x64 --version 0.0.43-fabric.1 \
  --resource-monitor-dir ~/.t3/runtime/versions/<installed>/resource-monitor \
  --output-dir release-cli
node scripts/smoke-cli-archive.ts \
  --archive release-cli/t3-0.0.43-fabric.1-linux-x64.tar.gz --expect-version 0.0.43-fabric.1
```

Notes that cost time the first time:

- `update-release-package-versions.ts` is not optional. Without it the SEA
  reports the version in `package.json` and the smoke test fails on a version
  mismatch — it is upstream's own first release step.
- The version may be any full semver, prerelease included: the service
  launcher's `EXACT_SERVICE_VERSION` accepts `0.0.43-fabric.1`. Using a
  prerelease suffix keeps the fork unmistakable in `runtime/versions/`.
- `--resource-monitor-dir` reuses the installed release's resource monitor. It
  is a Rust binary this fork does not modify, and borrowing it avoids needing a
  Rust toolchain on the deploy box. Drop the flag where the toolchain exists.

## 2. Install it beside the release

Follow `scripts/install.sh`: extract with `--strip-components=1` into
`$T3CODE_HOME/runtime/versions/<version>/`, check `t3 --version`, then write
`.install-complete` containing the version. Nothing under the existing version's
directory is touched.

## 3. Point the service at it

```ini
# ~/.config/systemd/user/t3code.service.d/fabric-runtime.conf
[Service]
ExecStart=
ExecStart=%h/.t3/runtime/versions/0.0.43-fabric.1/t3 __service-launcher
```

`ExecStart=` must be cleared first; systemd appends otherwise and a unit with two
`ExecStart` lines starts both.

**The service-state protocol.** `~/.t3/runtime/service-state.json` carries
`{protocol, activeVersion}`, and the launcher refuses a state whose protocol is
not exactly its own — this fork is protocol 3, released 0.0.42 wrote 2. The first
restart fails with `Service state is invalid or unsupported.` until the file is
rewritten (keep a copy of the old one; restoring it is half of the rollback):

```json
{ "protocol": 3, "activeVersion": "0.0.43-fabric.1" }
```

## 4. T3 Connect needs three values the fork build does not carry

`hasCloudPublicConfig` (`apps/server/src/cloud/publicConfig.ts`) gates the entire
T3 Connect startup path. It is true only when a relay URL, a Clerk publishable
key and a Clerk CLI OAuth client id are present, and in the official release all
three arrive as build-time defines injected by upstream's CI. A fork build has
none of them, so the startup link reconcile is skipped, no managed tunnel is
provisioned, and the environment silently stops being reachable from t3.codes —
silently because everything local still works.

It is worth knowing exactly how that failure presents, because nothing errors:
the previous server _deletes_ its Cloudflare tunnel on a clean shutdown
(`releaseManagedTunnelOnShutdown`, so an offline environment is not billed) on
the understanding that the next startup's reconcile provisions a replacement. The
fork boots, never reconciles, and the tunnel is simply gone.

The three values are public identifiers that ship in plain text in every
published binary, so they are read out of the installed release at deploy time
rather than committed here:

```bash
scripts/fabric/cloud-public-config.sh --systemd \
  > ~/.config/systemd/user/t3code.service.d/fabric-cloud-config.conf
```

Deliberately not carried over: the relay client's OTLP tracing triple, which
includes an Axiom ingest token. That one is a credential and it is upstream's;
leaving it unset disables relay-client tracing, which is the right default for a
fork.

### Before the first build from a fresh upstream tree

`pnpm-workspace.yaml` on upstream `main` currently contains the literal string
`msgpackr-extract: set this to true or false`. pnpm tolerates it; the release
archive's schema does not, and `build-cli-archive.ts` fails with a decode error
at `["allowBuilds"]["msgpackr-extract"]` that says nothing about where it came
from. The fork pins it back to `true`. If a sync brings the placeholder back,
that is what to look for — and drop the pin when upstream fixes it.

## 5. Restart and verify

```bash
systemctl --user daemon-reload && systemctl --user restart t3code.service
```

Then check, in this order, because each one can pass while the next fails:

| Check                   | How                                                                                                                                                                                                                                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The service is up       | `systemctl --user is-active t3code.service`, `curl -o /dev/null -w '%{http_code}' http://127.0.0.1:3773/`                                                                                                                                                                                                    |
| It is the fork          | `t3 --version` reports the fork version; `ExecStart` in `systemctl --user show` points at it                                                                                                                                                                                                                 |
| Migrations applied      | `fabric_sql_migrations` in `userdata/state.sqlite` holds 1–6 and the seven `fabric_*` tables exist. On a machine deployed before D48 the six sit at 054–059 in `effect_sql_migrations` instead, and the first boot of a build carrying D48 moves them across — `Reclaimed upstream migration ids` in the log |
| Projects survived       | `projection_projects` still has the rows it had before                                                                                                                                                                                                                                                       |
| T3 Connect is back      | `T3 Connect desired link reconciled on startup` in `userdata/logs/boot-service.log`, and a `cloudflared tunnel run` process exists                                                                                                                                                                           |
| Tailscale Serve         | `tailscale serve status` still maps the HTTPS port to `127.0.0.1:3773`, and **another tailnet device** gets 200 from it (a same-host probe fails the TLS handshake on SNI and proves nothing)                                                                                                                |
| Accounts are themselves | each Claude instance's cache under `~/.t3/caches/<instance>.json` names **its own** `auth.email` and reads its own limits. An instance with no address and `unsupported` limits has stored credentials that have expired — nothing in a deploy fixes that, only a fresh `claude auth login`                  |
| The model path          | one sentence the grammar refuses, resolved with `allowModel: true`, comes back as a reading rather than a refusal. `t3 auth session issue --token-only` gives the bearer; the RPC is at `ws://127.0.0.1:3773/ws`                                                                                             |
| The OOM shield          | `choom -n -900 -p <launcher pid>` and `<server pid>`; a restart resets it, so it is re-applied every time                                                                                                                                                                                                    |

### When the relay keeps reconnecting

Symptom: the client says _"Reconnecting: Relay could not reach the environment
endpoint (endpoint_request_failed)"_, and `userdata/logs/boot-service.log` shows
one connection index failing every ~30 seconds with
`control stream encountered a failure while serving` while the other three stay
up.

Cause, on the Director's home network: QUIC to the nearest Cloudflare edge. The
connector opens four connections, and the one that lands on the flaky edge
cannot hold its control stream.

Fix, with no code change and no rebuild — the server spawns the connector with
its own environment, and cloudflared reads its flags from there:

```ini
# ~/.config/systemd/user/t3code.service.d/fabric-tunnel-protocol.conf
[Service]
Environment=TUNNEL_TRANSPORT_PROTOCOL=http2
```

`TUNNEL_TRANSPORT_PROTOCOL` is the env form of `--protocol` for `tunnel run`.
**Not `TUNNEL_PROTOCOL`** — that name is accepted silently and does nothing,
which cost a restart to find out. Confirm by the log: every
`Registered tunnel connection` line should end `protocol=http2`, and the failure
lines stop. Deleting the file goes back to QUIC.

## 6. Rolling back

In increasing order of severity. The first is almost always enough:

1. `rm ~/.config/systemd/user/t3code.service.d/fabric-runtime.conf`, restore the
   saved `service-state.json` (protocol 2, the release version), `daemon-reload`,
   restart. The release runs again, from data the fork only added tables to.
2. Also `rm fabric-cloud-config.conf` — the release carries those values itself.
3. Only if data is damaged: stop the service, restore the `userdata` tarball,
   start.

The fork's migrations are additive (`docs/fabric/DECISIONS.md` D7), so step 1
leaves the release reading a database with six tables it does not know about,
which is exactly the case D7 was written to keep safe.
