# Upstream

Baton is a fork of T3 Code, not a rewrite of it. This page records which upstream commit the
fork sits on, how to move it forward, what each workspace package owns, how to run and check the
tree, and how to get real test data without touching a live install.

## Fork point

|                         |                                                                   |
| ----------------------- | ----------------------------------------------------------------- |
| Fork                    | `github.com/RabHanz/baton`                                        |
| Upstream                | `github.com/pingdotgg/t3code`                                     |
| Upstream commit at fork | `6deac7a924e6d90eef400cd218703cd3ad00a383`                        |
| Commit subject          | `fix(mobile): show Agent behavior icon on Android (#12316)`       |
| Commit date             | 2026-09-17 14:03:01 -0700                                         |
| Upstream license        | MIT, © 2026 T3 Tools Inc. (`LICENSE`)                             |
| Fork created            | 2026-09-17 ~21:50Z                                                |
| Baton work begins       | 2026-09-18                                                        |
| **Upstream pin now**    | `024d49520e` (2026-10-02), merged 2026-10-26 as `0.0.45-baton.20` |

The fork carried no Baton code at that point; it was a clean mirror of upstream `main`.
The pin is the last upstream commit before the v2 orchestrator (`de3439142`); see
"Where upstream went" below for why the fork stops there for now.

### Conflicts carried

Files Baton edits rather than adds — everything else it contributes is a new file. Each edit is a
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
| Migrations             | `apps/server/src/persistence/Layers/Sqlite.ts`                                              | two calls in the startup layer. Baton's migrations have their own manifest and their own tracking table, so upstream's `Migrations.ts` — the file they touch on every schema change — is byte-identical to theirs. `DECISIONS.md` D48   | 2     |
| Shared exports         | `packages/shared/package.json`                                                              | one export entry per shared Baton module — the fleet view, the grammars, the policies                                                                                                                                                   | 4–10  |
| Desktop IPC            | `apps/desktop/src/ipc/channels.ts`, `DesktopIpcHandlers.ts`, `preload.ts`                   | one channel, one registration, one preload binding: what this machine can type into (§18). The renderer cannot see the display server                                                                                                   | 6     |
| Desktop bridge type    | `packages/contracts/src/ipc.ts`                                                             | one optional method on `DesktopBridge`, so a build predating it still typechecks                                                                                                                                                        | 6     |
| Mobile navigation      | `apps/mobile/src/Stack.tsx`, `features/home/HomeHeader.tsx`, `HomeRouteScreen.tsx`          | one route, one header button, one prop. A screen nothing links to is a screen nobody has                                                                                                                                                | 7     |
| Upstream reactor       | `apps/server/src/orchestration/Layers/OrchestrationReactor.ts` and its test                 | the synopsis and rule reactors subscribe to the same domain events; the change is the subscription, not the reactor's own behaviour                                                                                                     | 4, 9  |
| Integration harness    | `apps/server/integration/OrchestrationEngineHarness.integration.ts`                         | the harness builds the engine by hand and gained the same dependency the routes did                                                                                                                                                     | 9     |
| Claude usage probe     | `apps/server/src/provider/Layers/ClaudeProvider.ts` and `ClaudeCapabilitiesProbe.test.ts`   | one constant and one call: the usage control request gets its own 15s deadline and asks to skip the local transcript scan. A defect found on the Director's own machine, not a Baton feature — offer it upstream                        | —     |

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
`git diff --name-only <fork-point> HEAD`, filtered to files Baton _edits_ rather than adds. Every
upstream file this fork touches is in it; everything else Baton contributes is a new file under a
`baton` name, which cannot conflict with anything upstream writes.

### Sync, 2026-10-26: to the last commit before the v2 orchestrator

Merged `52e4b44293..024d49520e`, 430 upstream commits, as `0.0.45-baton.20` (PR from
`baton/upstream-pre-v2`). 18 files conflicted, and upstream won wherever the two overlapped:

- `pnpm-workspace.yaml`: upstream fixed the `msgpackr-extract` placeholder, so our pin is gone.
  `node-pty: 1.2.0-beta.15` is added to `overrides`, backported from upstream `22840ab943`. The CLI
  archive installs without the lockfile, so `^beta.15` drifted to beta.18 and pnpm refused the unused patch.
- `AgentSessionJson.ts` is back. Upstream's usage transcript reader imports it now.
- Mobile `HomeHeader.tsx`: upstream's rewrite is taken whole. Baton is one header-right item plus
  one prop in `HomeHeader.types.ts`.
- Model picker: upstream's `ComboboxSearchInput`, with the account line kept above it.
- The Sqlite layer keeps upstream's `journal_size_limit` and our reclaim. Upstream now ships its
  own 054, so the legacy-numbering test fixtures stop at 053.
- The version label is `0.0.45-baton.20` on upstream's `0.0.45`. Service protocol is still 3.

The upstream workflows that deploy or publish with upstream's secrets are disabled through the
GitHub API, not by editing the files. That is `scripts/baton/disable-upstream-workflows.sh`, and
`upstream-sync.sh` re-runs it after every merge. CI is kept.

### Where upstream went (2026-10-02 onward)

On 2026-10-02 upstream replaced its orchestration engine (`de3439142`, "introduce new
orchestrator", #2829). Everything after it, 3,250 commits to `3f9448747` as of 2026-10-26, sits on
the new engine:

- `apps/server/src/orchestration/` (v1: OrchestrationEngine, reactors, ProjectionSnapshotQuery,
  the Sqlite layer Baton hooks) is **deleted**. `apps/server/src/orchestration-v2/` (about 540
  files) replaces it.
- State moves to a **new database file**, `userdata/statev2.sqlite`. A legacy importer
  (`orchestration-v2/legacy/LegacyV1ThreadImporter.ts`) copies v1 threads across.
  `state.sqlite`, where Baton's seven `fabric_*` tables live, is no longer opened.
- `packages/contracts/src/orchestration.ts` is deleted. The Claude adapter moved to
  `orchestration-v2/Adapters/ClaudeAdapterV2.ts`, and providers are split into `packages/provider-*`.
- Node `26.12.1` and pnpm `12.14.0`.

Baton's server half is written against v1. Six modules call it directly (`FleetQuery`,
`IntentService`, `IntentExecutorLive`, `OrchestrationEffectsLive`, `OrchestrationReactor`,
`SynopsisReactor`), and every repository opens `state.sqlite` through the deleted layer. So
going past `024d49520e` is a **port**, not a conflict resolution.

### Patch points today (2026-10-26, measured)

`git diff --name-only --diff-filter=M 024d49520e HEAD` lists **60 upstream files** the fork edits,
against 236 it adds. The old nine-row list here undercounted. By area:

| Area           | Files                                                                                                                                                                                                                     |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RPC and auth   | `contracts/src/rpc.ts`, `index.ts`, `environment.ts`, `settings.ts`, `ipc.ts`, `agentSessions.ts`; `server/src/ws.ts`, `auth/RpcAuthorization.ts`, `environment/ServerEnvironment.ts`; `client-runtime/src/rpc/client.ts` |
| Server wiring  | `server.ts`, `server.test.ts`, `persistence/Layers/Sqlite.ts`, `orchestration/Layers/OrchestrationReactor.ts` (+test), the integration harness                                                                            |
| Providers      | `ClaudeAdapter.ts` (+test), `ClaudeProvider.ts`, `ClaudeCapabilitiesProbe.test.ts`, `textGeneration/ClaudeTextGeneration.ts`, `TextGeneration.ts`, `shared/src/usageLimits.ts`                                            |
| Import         | `project/AgentSessionScanner.ts` (rewritten, D54), `AgentSessionImporter.ts`, their tests                                                                                                                                 |
| Terminal       | `terminal/Manager.ts` (Herdr runtime, D61)                                                                                                                                                                                |
| Web            | `Sidebar.tsx`, `_chat.index.tsx`, `ModelPickerContent.tsx`, `ProviderModelPicker.tsx`, `ComposerUsageLimits.tsx`, `MessagesTimeline.tsx`, `ConnectionsSettings.tsx`, `ProjectSettingsPanel.tsx`, `state/agentSessions.ts` |
| Desktop/mobile | `DesktopApp.ts`, `ipc/channels.ts`, `DesktopIpcHandlers.ts`, `preload.ts`; `Stack.tsx`, `HomeHeader.tsx`, `HomeHeader.types.ts`, `HomeRouteScreen.tsx`                                                                    |
| Build          | every `package.json` (version, deps), `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `third-party-licenses.config.json`, `scripts/lib/desktop-external-packages.ts`, `.gitignore`                                               |

The words "Fabric" left in upstream's mobile code (`ComposerAttachmentStrip.tsx`,
`nativeReviewDiffSurface.ts`, `apps/mobile/modules/`, `patches/`) are React Native's renderer and
are not ours.

### The port plan (decided 2026-10-26; progress in STATUS.md, "v2 port")

**Target shape.** T3 becomes a pinned vendor tree that Baton does not edit. Baton lives in its own
top-level packages around it, and the edits T3 truly forces become a short, named patch series
that the sync job re-applies.

```text
vendor/t3code/            upstream at a pinned commit, never hand-edited (git subtree, squash)
patches/t3code/NNNN-*.patch  the unavoidable edits, one concern each, applied in order
packages/baton-server/    work sessions, fleet, intents, rules, accounts, Herdr, adoption
packages/baton-contracts/ fabric.* schemas and Rpc definitions
packages/baton-web/       sidebar Projects block, intent bar, Continue with…
packages/baton-voice/     (exists)
scripts/baton/            sync, patch apply/refresh, deploy, workflow disable
```

The sync job does five things in order. It moves the pin, re-applies the series with `git apply --3way`,
and runs the Baton gates. Then it builds, and it opens a PR only when all of that passes. A patch
that stops applying is the one signal a human needs.

**Adopt T3's, delete ours.** These are features the v2 engine or upstream already ships. Each
is confirmed in the port by reading upstream's module, not by its name.

| Baton feature                                                            | Upstream now                                                               | Action                                                                                                               |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| "Continue with…" handoff (D62): capsule + new thread on another provider | `ContextHandoffService`, `ContextHandoffDelivery`, `ProviderSwitchService` | Use theirs. Keep only the button and the work-session link                                                           |
| Work-session settle / needs-me                                           | `ThreadSettlementService` (settle, snooze, PR-aware)                       | Read settlement from v2. Drop our settle state                                                                       |
| Resume after restart                                                     | `RestartContinuation`, `ProviderRuntimeRecoveryService`                    | Drop any Baton restart logic for T3 threads. Keep D69 (Claude CLI in Herdr) only                                     |
| Wait for a limit to reset                                                | `UsageLimitRecoveryWorker` (auto-resume at reset)                          | Use theirs for the same account. **Rotation to another account (D63) stays Baton's**, triggered by their limit class |
| Large-transcript import (D54 tail reader)                                | `AgentSessionScanner` now caps the scan at 1 MB and imports up to 4 GB     | Take upstream's scanner and importer. Delete our rewrite once a 420 MB transcript imports                            |
| Cross-environment project identity (D72 key)                             | logical projects keyed by `RepositoryIdentity`                             | Already theirs. Our grouping stays a client-side view on top                                                         |
| Scheduled/triggered runs (part of orchestration rules)                   | `scheduledTasks/` (interval, schedule, webhook)                            | Rules that are time or webhook triggered become scheduled tasks. Keep only "when thread X settles, do Y"             |
| Claude usage probe deadline                                              | check upstream's `ClaudeProvider`                                          | Drop ours if upstream bounded it, otherwise offer it upstream                                                        |

**Port work that remains Baton's.**

1. Work sessions, synopsis, intents, orchestration rules: rewrite the six v1 call sites against
   v2's command/event API (`Orchestrator`, `ThreadLaunchService`, `ThreadStream`, `EventSink`).
   The synopsis and rule reactors subscribe to v2's event stream, the same way upstream's
   `PullRequestSyncReactor` does. That is one line in `server.ts`.
2. Herdr terminal runtime (D61): implement it as a `PtyAdapter` layer (the v2 terminal manager takes
   the adapter as a service). This removes the `terminal/Manager.ts` patch.
3. Account pool and rotation (D63, D69), adoption (D74), live sessions and send, attach (D73), fleet
   query: mostly free of the engine. Re-point the provider-registry imports to `packages/provider-core`.
4. RPC: the `fabric.*` methods stay on the wire, names unchanged (D71). One patch adds the Baton
   group to `WsRpcGroup` and its scopes, unless v2 has a mergeable group by then.
5. Web: the Projects block mounts at one point in the sidebar. The model-picker account line,
   usage-limit notice and import button move into Baton components behind one slot each.

**Data: Baton gets its own SQLite file.** `userdata/baton.sqlite`, opened by
`packages/baton-server` with its own client and its own migration table. That removes the
Sqlite-layer patch point and the D48 reclaim. The migration from today's data runs once, on the
first boot of the ported build:

1. If `baton.sqlite` is missing and `state.sqlite` has `fabric_sql_migrations`, read the seven
   `fabric_*` tables from `state.sqlite` (read-only) and write them into a fresh `baton.sqlite`.
   Run Baton's manifest first, then `INSERT … SELECT` per table, with row counts compared table by table.
2. Rewrite the references that point into v1. A work session's thread ids become v2 thread ids
   through the legacy importer's id map. Rows whose thread did not import keep the work session
   and lose the link, with a count in the boot log.
3. Never write to `state.sqlite`. Rollback to `0.0.45-baton.20` keeps working, because it still reads
   the untouched v1 file.
4. Rehearse on a `VACUUM INTO` copy of each box's `state.sqlite` (signzart: 1 project, 7 Baton
   migrations; onnyx: 17 projects) before any deploy.

**Toolchain.** Node `26.12.1` and pnpm `12.14.0`, user-local under `dev/toolchain/` with corepack,
proven on the current tree before the port starts. Build on signzart (31 GB RAM; onnyx's 7 GB is
too small), `nice -n 10`, one build at a time.

**Sequence and estimate.**

| Step                                                                                                 | Estimate                                          |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| 1. Toolchain, plus the restructure (vendor subtree, patch series, Baton packages) at the current pin | 1 day                                             |
| 2. Move the pin to upstream main and apply the series against v2                                     | 0.5 day                                           |
| 3. Port the server half (items 1–4 above) and adopt-and-delete                                       | 2 days                                            |
| 4. Own database and its migration, rehearsed on both boxes' copies                                   | 0.5 day                                           |
| 5. Web and mobile slots, gates, the real run, deploy beside `baton.20`                               | 1 day                                             |
| 6. The automatic sync job (pin, re-apply, gate, build, PR), then daily on a timer                    | 0.5 day                                           |
| **Total**                                                                                            | **about 5 lane-days, in 2 lanes (1–2, then 3–6)** |

## Remotes and rebasing

The clone is a blobless partial clone (`--filter=blob:none`) with full commit history, which keeps
`.git` near 100 MB instead of several hundred. Blobs are fetched on demand, so any `git log -p`,
`git blame`, or checkout of an old tree needs network.

```sh
git remote -v
# origin    https://github.com/RabHanz/baton.git   (fetch/push)
# upstream  https://github.com/pingdotgg/t3code.git (fetch/push)
```

To take upstream changes:

```sh
scripts/baton/upstream-sync.sh --report-only     # what upstream did, which patched paths it touched
scripts/baton/upstream-sync.sh [--to <commit>]   # move the pin, re-apply the series, gates, PR
scripts/baton/gates.sh [--install] [--build]     # the same gates by hand
```

Since 2026-10-26 (D76) the sync does not merge. Baton's edits to upstream are the patch series in
`vendor-patches/t3code/` over the commit in `PIN`, and the sync is mechanical:

1. `patches.sh rebase <commit>` makes every upstream path the new commit's, deletions included,
   then re-applies each patch with `git apply --3way`. A patch that fails leaves conflict markers
   and is named; nothing else needs a human.
2. `pnpm-lock.yaml` is re-resolved from upstream's (`REGENERATED`), never patched.
3. The result is committed with two parents, the fork's `main` and the upstream commit, so
   upstream's history stays reachable and `git merge-base` keeps meaning something.
4. `gates.sh --install --build` (D77), then push and open the PR with the report as its body.

`patches.sh verify` is the invariant: every path upstream owns equals `PIN` plus the series. It
runs first in the gates, so an upstream file edited outside a patch fails before anything else.

**The number space is not shared.** Baton's migrations used to sit at 054–059 inside upstream's
manifest, one upstream release away from either a duplicate-id failure or — worse, because it is
silent — upstream's own migration being skipped forever. They now have their own manifest and their
own `fabric_sql_migrations` table, and databases carrying the old numbering are repaired on boot.
`DECISIONS.md` D48.

After a sync, update this page's fork-point table. The patch list is `vendor-patches/t3code/series`.

## Package map

Workspace globs come from `pnpm-workspace.yaml`: `apps/*`, `infra/*`, `packages/*`,
`oxlint-plugin-t3code`, `scripts`.

| Path                               | Package name                    | Owns                                                                                                                                                               | Baton relevance                                                                            |
| ---------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `apps/server`                      | `t3`                            | WebSocket server, orchestration (command → decider → event → projector → reactor), providers, checkpointing, persistence, MCP toolkits, terminals, preview browser | WorkSession persistence, RPC handlers, and every Baton reactor live here                   |
| `apps/web`                         | `@t3tools/web`                  | React/Vite client; the sidebar, thread view, settings                                                                                                              | WorkSession sidebar grouping, timeline, synopsis card                                      |
| `apps/desktop`                     | `@t3tools/desktop`              | Electron shell wrapping `apps/web`, bundles a server runner, hosts the Chromium `<webview>` preview browser                                                        | desktop voice service, context bus, tray/HUD (Phase 5–6)                                   |
| `apps/mobile`                      | `@t3tools/mobile`               | React Native (iOS + Android), separate navigation                                                                                                                  | WorkSession list, mic button, App Intents (Phase 7)                                        |
| `apps/marketing`                   | `@t3tools/marketing`            | the public site                                                                                                                                                    | not touched by Baton                                                                       |
| `packages/contracts`               | `@t3tools/contracts`            | Effect/Schema wire contracts; `rpc.ts` is the client↔server boundary, `orchestration.ts` the domain commands/events, `environment.ts` the capability descriptor    | the `WorkSession` schema, `fabric.*` RPC methods and events, and the Baton capability flag |
| `packages/shared`                  | `@t3tools/shared`               | shared runtime utilities, subpath exports, no barrel                                                                                                               | normalization helpers shared by server and clients                                         |
| `packages/client-runtime`          | `@t3tools/client-runtime`       | connection supervisor, RPC session, shared state services used by web **and** mobile                                                                               | WorkSession state service, so web and mobile do not diverge                                |
| `packages/ssh`                     | `@t3tools/ssh`                  | SSH tunnels and desktop-managed remote environments                                                                                                                | multi-host topology; unchanged by Baton                                                    |
| `packages/tailscale`               | `@t3tools/tailscale`            | tailnet serve/status integration                                                                                                                                   | the private-network default (spec §25)                                                     |
| `packages/effect-acp`              | `effect-acp`                    | Agent Client Protocol binding                                                                                                                                      | provider adapters                                                                          |
| `packages/effect-codex-app-server` | `effect-codex-app-server`       | Codex app-server protocol binding                                                                                                                                  | Codex provider                                                                             |
| `infra/relay`                      | `t3code-relay`                  | T3 Connect relay                                                                                                                                                   | push notifications for "needs me"                                                          |
| `oxlint-plugin-t3code`             | `@t3tools/oxlint-plugin-t3code` | repo lint rules                                                                                                                                                    | —                                                                                          |
| `scripts`                          | `@t3tools/scripts`              | dev runner, release, icon and mobile tooling                                                                                                                       | —                                                                                          |

### The three files a Baton change almost always touches

1. `packages/contracts/src/rpc.ts` — `WS_METHODS`, one `Rpc.make` per method, and the method must
   be added to `WsRpcGroup` at the bottom of the file.
2. `apps/server/src/auth/RpcAuthorization.ts` — `RPC_REQUIRED_SCOPES` is keyed by the RPC group's
   own method union, so adding an RPC without choosing a scope is a **type error**, not a runtime
   hole. There is a test asserting the key sets match exactly.
3. `apps/server/src/ws.ts` — `makeWsRpcLayer` builds one `WsRpcGroup.of({...})` object with every
   handler. Baton handlers are built in their own module and spread in, to keep the diff in this
   3 800-line file to a couple of lines.

### Persistence shape

Durable state is SQLite under the environment's `userdata` directory. Migrations are **forward
only**: `apps/server/src/persistence/Migrations.ts` statically imports each numbered file from
`Migrations/` and runs them through Effect's `Migrator`, which records applied ids in
`effect_sql_migrations`. There is no `down`. The upstream rollback story is "restore the database
file", which is why the test-data strategy below matters.

Highest migration at the fork point: **053_PullRequestFilesViewed**. Baton's first migration is
therefore 054 or later; the number is claimed at the moment the file lands, and a rebase that finds
upstream took the number renumbers the Baton one rather than editing upstream's.

`apps/server/src/persistence/ProjectionThreadPullRequests.ts` is the closest existing template for a
new Baton table: a `Schema.Struct` row, `SqlSchema.findAll`/`SqlSchema.void` statements, a
`Context.Service` repository, and a `Layer.effect`.

### Feature flagging

Two mechanisms exist upstream and Baton uses both rather than inventing a third:

- `ExecutionEnvironmentCapabilities` in `packages/contracts/src/environment.ts` — an optional
  boolean the server advertises, so a new client talking to an old server hides the feature instead
  of probing an RPC that does not exist. Every entry there carries a comment explaining the
  version-skew contract; Baton's entries must too.
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
   silently breaks every remote browser — which for Baton means every phone and laptop client.

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
`--home-dir` wins in both cases. Every Baton real-path proof runs against a snapshot in one of
those two, and the proof writes down which.

### Migration rehearsal

Because migrations are forward only, "rollback" for Baton means: take a `VACUUM INTO` snapshot of
the pre-migration database, run the server against the snapshot so the migration applies, then
confirm a build from **before** the migration still opens the untouched original. Any Baton
migration that would make an older server fail to open the database is a breaking change and needs
a line in `DECISIONS.md` explaining why it was unavoidable.

## Fork hygiene

The Director may open-source this fork. Therefore:

- no VentureOS specifics, no customer data, no business content in the fork;
- no secrets, tokens, pairing URLs, or `T3CODE_DEV_AUTH_TOKEN` values in any commit, test fixture,
  snapshot, or PR body — upstream's own docs call the dev token a reusable administrative secret;
- MIT-compatible only. Herdr (`SuperCodeAgents/herdr-terminal`) is AGPL: Baton integrates with it
  over its socket/CLI surface and never copies its source;
- upstream's documentation rules apply to `docs/baton/` too. These pages exist because the
  reasoning crosses component boundaries and a maintainer would otherwise get the fork's
  relationship to upstream wrong. They are not a feature index.
