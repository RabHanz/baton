# Upstream

Fabric is a fork of T3 Code, not a rewrite of it. This page records which upstream commit the
fork sits on, how to move it forward, what each workspace package owns, how to run and check the
tree, and how to get real test data without touching a live install.

## Fork point

|                         |                                                             |
| ----------------------- | ----------------------------------------------------------- |
| Fork                    | `github.com/RabHanz/t3code`                                 |
| Upstream                | `github.com/pingdotgg/t3code`                               |
| Upstream commit at fork | `6deac7a924e6d90eef400cd218703cd3ad00a383`                  |
| Commit subject          | `fix(mobile): show Agent behavior icon on Android (#12316)` |
| Commit date             | 2026-09-17 14:03:01 -0700                                   |
| Upstream license        | MIT, © 2026 T3 Tools Inc. (`LICENSE`)                       |
| Fork created            | 2026-09-17 ~21:50Z                                          |
| Fabric work begins      | 2026-09-18                                                  |

The fork carried no Fabric code at that point; it was a clean mirror of upstream `main`.

### Conflicts carried

Files Fabric edits rather than adds — everything else it contributes is a new file. Each edit is a
small, localized insertion chosen so a rebase conflicts in one place rather than across a rewrite.
Each phase that diverges further adds a row with the file, the reason, and the upstream construct it
extends.

| Area                   | Upstream file touched                                                                       | Why                                                                                                                                                                                                                                     | Phase |
| ---------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| RPC surface            | `packages/contracts/src/rpc.ts`                                                             | one import, eleven `Rpc.make`s, eleven entries in `WsRpcGroup`. There is no other way to add a method                                                                                                                                   | 2     |
| RPC surface            | `packages/contracts/src/index.ts`                                                           | one re-export line                                                                                                                                                                                                                      | 2     |
| Auth                   | `apps/server/src/auth/RpcAuthorization.ts`                                                  | eleven scope entries. The record is keyed off the RPC group's own type, so omitting them is a type error                                                                                                                                | 2     |
| Handlers               | `apps/server/src/ws.ts`                                                                     | one service acquired, eleven handler entries at the end of `WsRpcGroup.of`. Thin by design — only `startThread` has logic, and it has to reach the orchestration engine                                                                 | 2     |
| Layers                 | `apps/server/src/server.ts`                                                                 | one layer added to `RuntimeCoreDependenciesLive`. It cannot go beside the routes: `WsRpcGroup.toLayer` expresses handler requirements through an unresolved `HandlerRequirements<…>`, which `Layer.provide`'s `Exclude` cannot see into | 2     |
| Capability             | `packages/contracts/src/environment.ts`, `apps/server/src/environment/ServerEnvironment.ts` | one capability key and its `true`                                                                                                                                                                                                       | 2     |
| Client setting         | `packages/contracts/src/settings.ts`                                                        | one `ClientSettings` key                                                                                                                                                                                                                | 2     |
| Client RPC tags        | `packages/client-runtime/src/rpc/client.ts`                                                 | one member added to `EnvironmentSubscriptionRpcTag`                                                                                                                                                                                     | 2     |
| Client-runtime exports | `packages/client-runtime/package.json`                                                      | one subpath export                                                                                                                                                                                                                      | 2     |
| Sidebar                | `apps/web/src/components/Sidebar.tsx`                                                       | two memos, one callback, one status-label map, one flagged block above the thread list. The thread list itself is untouched — `DECISIONS.md` D12                                                                                        | 2     |
| Migrations             | `apps/server/src/persistence/Layers/Sqlite.ts`                                              | two calls in the startup layer. Fabric's migrations have their own manifest and their own tracking table, so upstream's `Migrations.ts` — the file they touch on every schema change — is byte-identical to theirs. `DECISIONS.md` D48  | 2     |
| Shared exports         | `packages/shared/package.json`                                                              | one export entry per shared Fabric module — the fleet view, the grammars, the policies                                                                                                                                                  | 4–10  |
| Desktop IPC            | `apps/desktop/src/ipc/channels.ts`, `DesktopIpcHandlers.ts`, `preload.ts`                   | one channel, one registration, one preload binding: what this machine can type into (§18). The renderer cannot see the display server                                                                                                   | 6     |
| Desktop bridge type    | `packages/contracts/src/ipc.ts`                                                             | one optional method on `DesktopBridge`, so a build predating it still typechecks                                                                                                                                                        | 6     |
| Mobile navigation      | `apps/mobile/src/Stack.tsx`, `features/home/HomeHeader.tsx`, `HomeRouteScreen.tsx`          | one route, one header button, one prop. A screen nothing links to is a screen nobody has                                                                                                                                                | 7     |
| Upstream reactor       | `apps/server/src/orchestration/Layers/OrchestrationReactor.ts` and its test                 | the synopsis and rule reactors subscribe to the same domain events; the change is the subscription, not the reactor's own behaviour                                                                                                     | 4, 9  |
| Integration harness    | `apps/server/integration/OrchestrationEngineHarness.integration.ts`                         | the harness builds the engine by hand and gained the same dependency the routes did                                                                                                                                                     | 9     |
| Claude usage probe     | `apps/server/src/provider/Layers/ClaudeProvider.ts` and `ClaudeCapabilitiesProbe.test.ts`   | one constant and one call: the usage control request gets its own 15s deadline and asks to skip the local transcript scan. A defect found on the Director's own machine, not a Fabric feature — offer it upstream                       | —     |

| Route test wiring | `apps/server/src/server.test.ts` | the routes gained a dependency, so the test that builds them by hand provides it | 2 |

**One upstream file is rewritten rather than extended, and one is deleted.**
`apps/server/src/project/AgentSessionScanner.ts` now reads a transcript from its **end** instead of
streaming the whole file forwards (`DECISIONS.md` D54), which replaced `readTranscript` and made
`apps/server/src/project/AgentSessionJson.ts` — the streaming field-selecting JSON reader that
existed to bound a forward whole-file read — dead. It is deleted rather than left unused; an
upstream sync that changes it will report a delete/modify conflict, and the resolution is to keep
the deletion unless upstream's own importer has stopped reading forwards. This is the largest single
divergence in the fork and the reason is in D54: on the Director's own machine, a 420 MB and a
171 MB session both refused to import with `TranscriptJsonLimitError`, which is to say the
conversations most worth resuming were exactly the ones that could not be.

**Checked at Phase 10.** The table above was regenerated from
`git diff --name-only <fork-point> HEAD`, filtered to files Fabric _edits_ rather than adds. Every
upstream file this fork touches is in it; everything else Fabric contributes is a new file under a
`fabric` name, which cannot conflict with anything upstream writes.

## Remotes and rebasing

The clone is a blobless partial clone (`--filter=blob:none`) with full commit history, which keeps
`.git` near 100 MB instead of several hundred. Blobs are fetched on demand, so any `git log -p`,
`git blame`, or checkout of an old tree needs network.

```sh
git remote -v
# origin    https://github.com/RabHanz/t3code.git   (fetch/push)
# upstream  https://github.com/pingdotgg/t3code.git (fetch/push)
```

To take upstream changes:

```sh
scripts/fabric/upstream-sync.sh --report-only   # what upstream did, and what it will touch
scripts/fabric/upstream-sync.sh                 # merge it onto a branch and open the PR
```

The script fetches both remotes, lists upstream's new commits, intersects the files they changed
with the files this fork changed, flags every hit against the conflicts table above (read out of
this document, so the table stays the one source of that list), then merges `upstream/main` into a
branch off the fork's `main` and opens the pull request with that report as the body. It refuses a
dirty tree, never pushes to `main`, and when the merge conflicts it stops with the list of files
rather than guessing.

**The fork absorbs upstream; it is not rebased onto it.** The original plan here was the opposite —
keep `main` a fast-forward mirror and rebase `fabric/*` on top — and that stopped being possible
the moment Fabric work merged into the fork's `main`, which is where it belongs now that the fork
is what runs on the Director's machines. Rebasing would rewrite every Fabric commit on every sync,
so "what did the fork change" would have no stable answer, and every open branch would need
force-pushing. Merge commits on the fork's `main` are therefore expected and fine.

What keeps the Fabric diff legible instead is the conflicts table: every upstream file the fork
edits is listed with the reason, and everything else Fabric contributes is a new file under a
`fabric` name. `git diff <fork-point>..main -- ':!*fabric*'` is still the patch series against
upstream.

**The number space is not shared.** Fabric's migrations used to sit at 054–059 inside upstream's
manifest, one upstream release away from either a duplicate-id failure or — worse, because it is
silent — upstream's own migration being skipped forever. They now have their own manifest and their
own `fabric_sql_migrations` table, and databases carrying the old numbering are repaired on boot.
`DECISIONS.md` D48.

After a sync, re-run this page's fork-point table and the conflicts table.

## Package map

Workspace globs come from `pnpm-workspace.yaml`: `apps/*`, `infra/*`, `packages/*`,
`oxlint-plugin-t3code`, `scripts`.

| Path                               | Package name                    | Owns                                                                                                                                                               | Fabric relevance                                                                            |
| ---------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `apps/server`                      | `t3`                            | WebSocket server, orchestration (command → decider → event → projector → reactor), providers, checkpointing, persistence, MCP toolkits, terminals, preview browser | WorkSession persistence, RPC handlers, and every Fabric reactor live here                   |
| `apps/web`                         | `@t3tools/web`                  | React/Vite client; the sidebar, thread view, settings                                                                                                              | WorkSession sidebar grouping, timeline, synopsis card                                       |
| `apps/desktop`                     | `@t3tools/desktop`              | Electron shell wrapping `apps/web`, bundles a server runner, hosts the Chromium `<webview>` preview browser                                                        | desktop voice service, context bus, tray/HUD (Phase 5–6)                                    |
| `apps/mobile`                      | `@t3tools/mobile`               | React Native (iOS + Android), separate navigation                                                                                                                  | WorkSession list, mic button, App Intents (Phase 7)                                         |
| `apps/marketing`                   | `@t3tools/marketing`            | the public site                                                                                                                                                    | not touched by Fabric                                                                       |
| `packages/contracts`               | `@t3tools/contracts`            | Effect/Schema wire contracts; `rpc.ts` is the client↔server boundary, `orchestration.ts` the domain commands/events, `environment.ts` the capability descriptor    | the `WorkSession` schema, `fabric.*` RPC methods and events, and the Fabric capability flag |
| `packages/shared`                  | `@t3tools/shared`               | shared runtime utilities, subpath exports, no barrel                                                                                                               | normalization helpers shared by server and clients                                          |
| `packages/client-runtime`          | `@t3tools/client-runtime`       | connection supervisor, RPC session, shared state services used by web **and** mobile                                                                               | WorkSession state service, so web and mobile do not diverge                                 |
| `packages/ssh`                     | `@t3tools/ssh`                  | SSH tunnels and desktop-managed remote environments                                                                                                                | multi-host topology; unchanged by Fabric                                                    |
| `packages/tailscale`               | `@t3tools/tailscale`            | tailnet serve/status integration                                                                                                                                   | the private-network default (spec §25)                                                      |
| `packages/effect-acp`              | `effect-acp`                    | Agent Client Protocol binding                                                                                                                                      | provider adapters                                                                           |
| `packages/effect-codex-app-server` | `effect-codex-app-server`       | Codex app-server protocol binding                                                                                                                                  | Codex provider                                                                              |
| `infra/relay`                      | `t3code-relay`                  | T3 Connect relay                                                                                                                                                   | push notifications for "needs me"                                                           |
| `oxlint-plugin-t3code`             | `@t3tools/oxlint-plugin-t3code` | repo lint rules                                                                                                                                                    | —                                                                                           |
| `scripts`                          | `@t3tools/scripts`              | dev runner, release, icon and mobile tooling                                                                                                                       | —                                                                                           |

### The three files a Fabric change almost always touches

1. `packages/contracts/src/rpc.ts` — `WS_METHODS`, one `Rpc.make` per method, and the method must
   be added to `WsRpcGroup` at the bottom of the file.
2. `apps/server/src/auth/RpcAuthorization.ts` — `RPC_REQUIRED_SCOPES` is keyed by the RPC group's
   own method union, so adding an RPC without choosing a scope is a **type error**, not a runtime
   hole. There is a test asserting the key sets match exactly.
3. `apps/server/src/ws.ts` — `makeWsRpcLayer` builds one `WsRpcGroup.of({...})` object with every
   handler. Fabric handlers are built in their own module and spread in, to keep the diff in this
   3 800-line file to a couple of lines.

### Persistence shape

Durable state is SQLite under the environment's `userdata` directory. Migrations are **forward
only**: `apps/server/src/persistence/Migrations.ts` statically imports each numbered file from
`Migrations/` and runs them through Effect's `Migrator`, which records applied ids in
`effect_sql_migrations`. There is no `down`. The upstream rollback story is "restore the database
file", which is why the test-data strategy below matters.

Highest migration at the fork point: **053_PullRequestFilesViewed**. Fabric's first migration is
therefore 054 or later; the number is claimed at the moment the file lands, and a rebase that finds
upstream took the number renumbers the Fabric one rather than editing upstream's.

`apps/server/src/persistence/ProjectionThreadPullRequests.ts` is the closest existing template for a
new Fabric table: a `Schema.Struct` row, `SqlSchema.findAll`/`SqlSchema.void` statements, a
`Context.Service` repository, and a `Layer.effect`.

### Feature flagging

Two mechanisms exist upstream and Fabric uses both rather than inventing a third:

- `ExecutionEnvironmentCapabilities` in `packages/contracts/src/environment.ts` — an optional
  boolean the server advertises, so a new client talking to an old server hides the feature instead
  of probing an RPC that does not exist. Every entry there carries a comment explaining the
  version-skew contract; Fabric's entries must too.
- `ServerSettings` in `packages/contracts/src/settings.ts` — the operator's own switch, persisted
  per environment.

## Development and checks

Upstream's `AGENTS.md` and `docs/operations/development.md` are authoritative. The commands, as
they state them:

```sh
vp i                                   # install (Vite+; curl -fsSL https://vite.plus | bash)
vp run dev                             # server + web
vp run dev:desktop                     # Electron client
vp run dev --share                     # publish the web port over the tailnet, prints a pairing URL

vp test run <files>                    # the tests you touched
vp lint <files>
vp run --filter <package> typecheck
vp run knip:check                      # unused files/deps/exports
```

Node 24 is required (`engines.node: ^24.13.1`); pnpm 11.10.0 is the declared package manager and
`vp` (Vite+) is the task runner the scripts call. Bun is optional and is used by the test-data
snippet below.

### Rules that are not negotiable while developing in this tree

Upstream calls these "the three ways to hurt yourself"; two of them are also spec §0 rules.

1. **Never kill by pattern.** No `pkill -f`, no `pgrep | kill`, no killing a PID matched by a path
   or worktree string. This box runs several agents whose argv contains this worktree's path. Kill
   only a PID captured at spawn.
2. **Never run a dev server against `~/.t3/userdata`.** That is the live install — on this box a
   systemd user unit `t3code.service` running `t3@0.0.42` on `127.0.0.1:3773` has the database
   open right now. Reading and copying out of it is fine and encouraged; opening it read-write,
   starting a server against it, or cleaning it up is not. Spec §0 rule 9 and MVP criterion 15 say
   the same thing.
3. **Never set `VITE_HTTP_URL` or `VITE_WS_URL` for dev.** Dev is single-origin and Vite proxies
   `/api`, `/ws`, `/oauth`, `/.well-known`. Setting them bakes localhost into the bundle and
   silently breaks every remote browser — which for Fabric means every phone and laptop client.

Also inherited: do not run repo-wide checks (`vp check`, `vp run -r test`, `vp run -r typecheck`).
CI owns the full suite. On this box a repo-wide run is minutes of CPU on a machine that is usually
oversubscribed.

## Test data

An empty database is a bad test, and the live one is off limits for writes. The strategy, from
upstream `AGENTS.md`:

```sh
mkdir -p .t3/userdata
rm -f .t3/userdata/state.sqlite*        # VACUUM INTO refuses to overwrite
bun -e "new (require('bun:sqlite').Database)(process.env.HOME + '/.t3/userdata/state.sqlite', { readonly: true }).run(\"VACUUM INTO '.t3/userdata/state.sqlite'\")"
```

`VACUUM INTO` is safe while a server has the source open and yields one consistent file. A plain
`cp` is only safe when nothing has the source open, and must bring the `-wal` and `-shm` siblings —
a live file copy is a corrupt copy, and the live install has a 181 KB `-wal` sitting beside a
299 KB `state.sqlite` as this is written.

Copy in, never symlink. Data flows one way: into the sandbox, never back out. Bring `secrets` and
`settings.json` only when the flow under test needs them, and never commit either.

A linked worktree defaults to its own gitignored `<worktree>/.t3/userdata`, which deliberately
outranks an ambient `T3CODE_HOME`. The main checkout defaults to `~/.t3/dev/userdata`. An explicit
`--home-dir` wins in both cases. Every Fabric real-path proof runs against a snapshot in one of
those two, and the proof writes down which.

### Migration rehearsal

Because migrations are forward only, "rollback" for Fabric means: take a `VACUUM INTO` snapshot of
the pre-migration database, run the server against the snapshot so the migration applies, then
confirm a build from **before** the migration still opens the untouched original. Any Fabric
migration that would make an older server fail to open the database is a breaking change and needs
a line in `DECISIONS.md` explaining why it was unavoidable.

## Fork hygiene

The Director may open-source this fork. Therefore:

- no VentureOS specifics, no customer data, no business content in the fork;
- no secrets, tokens, pairing URLs, or `T3CODE_DEV_AUTH_TOKEN` values in any commit, test fixture,
  snapshot, or PR body — upstream's own docs call the dev token a reusable administrative secret;
- MIT-compatible only. Herdr (`SuperCodeAgents/herdr-terminal`) is AGPL: Fabric integrates with it
  over its socket/CLI surface and never copies its source;
- upstream's documentation rules apply to `docs/fabric/` too. These pages exist because the
  reasoning crosses component boundaries and a maintainer would otherwise get the fork's
  relationship to upstream wrong. They are not a feature index.
