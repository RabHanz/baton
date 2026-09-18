# Status

What actually works, as opposed to what is planned. Updated at the end of every phase.

Phase order: **0 → 2 → 3 → 4 → 9 → 5 → 6 → 7 → 8 → 10**. Phase 1 is already done; the reasoning
for moving 9 ahead of 5 is in `DECISIONS.md`.

| Phase                                          | State                     | Evidence                                                                                     |
| ---------------------------------------------- | ------------------------- | -------------------------------------------------------------------------------------------- |
| 0 — upstream audit and safe base               | **done**                  | this page, `UPSTREAM.md`, `DECISIONS.md`, `TEST_MATRIX.md`; upstream tree read at `6deac7a9` |
| 1 — real deployment baseline, zero custom code | **done by configuration** | two environments running stock `t3@0.0.42`, see below                                        |
| 2 — WorkSession domain                         | **done**                  | the table below; 31 new tests, migration and rollback rehearsed on real data                 |
| 3 — provider/account handoff                   | not started               | —                                                                                            |
| 4 — working synopsis + fleet status            | not started               | —                                                                                            |
| 9 — orchestration                              | not started               | —                                                                                            |
| 5 — desktop voice service                      | not started               | —                                                                                            |
| 6 — VS Code + browser + system dictation       | not started               | —                                                                                            |
| 7 — mobile voice + quick actions               | not started               | —                                                                                            |
| 8 — Herdr adoption                             | not started               | —                                                                                            |
| 10 — capability plane + hardening              | not started               | —                                                                                            |

Nothing in this repository implements Fabric beyond what the Phase 2 section below claims.

## Phase 1 — done by configuration, no code changes

Spec §29 Phase 1 asks for a working stock deployment before any Fabric abstraction is added, and
§37 step 7 asks whether it can be reached with zero code changes. It can, and it was: two Linux
environments run the released `t3@0.0.42` from the official installer as user-mode services, a
desktop client and a phone client pair to them over the tailnet, and projects are registered with
worktree-per-thread as the default.

What that deployment proves against the Phase 1 exit criteria:

| Exit criterion                                            | State                                                                                                                                                |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| see projects on more than one environment from one client | yes — two environments, paired                                                                                                                       |
| start Claude sessions                                     | yes                                                                                                                                                  |
| start Codex                                               | yes                                                                                                                                                  |
| create parallel worktrees                                 | yes — threads default to a new worktree; the live checkout is never checked out by a thread                                                          |
| continue sessions from the phone                          | yes                                                                                                                                                  |
| approve/respond remotely                                  | yes; agent-activity publishing is **enabled**, so push arrives on finish, failure, approval, and question                                            |
| several Claude accounts authenticated at once             | **partial** — the provider-instance mechanism is configured and the additional config directories exist, but only one account is currently logged in |

The one open Phase 1 item is therefore the second and third Claude subscription logins, which are a
human action (`CLAUDE_CONFIG_DIR=<dir> claude auth login` on the environment's own machine) and not
a code change. Phase 3 (handoff) cannot be _proved_ end to end until at least two are live; it can
be built and unit-tested before then.

Host names, tailnet URLs, pairing files, and account identities are deliberately **not** recorded in
this repository. The fork is meant to be publishable; the operator's deployment record lives outside
it.

## Upstream capabilities Fabric must not rebuild

Read from the source tree at `6deac7a9`, not from release notes.

**Providers are already multi-account.** A driver kind identifies an integration; an instance
identifies one configuration and account lifecycle, and work routes by instance
(`docs/internals/providers.md`). Claude instances isolate through `CLAUDE_CONFIG_DIR` rather than
`HOME`, because overriding `HOME` also moves the macOS keychain lookup and the spawned CLI then
reports "Not logged in" (`apps/server/src/provider/Drivers/ClaudeHome.ts`). Codex instances use a
shared `CODEX_HOME` plus a shadow home. Spec §6 and §7 are satisfied by configuration; Fabric adds
the layer _above_ them, not another provider system.

**Claude runs on the subscription, through the local CLI.** `apps/server/src/provider/Layers/
ClaudeAdapter.ts` drives `@anthropic-ai/claude-agent-sdk` with
`pathToClaudeCodeExecutable: claudeBinaryPath` and the instance's `CLAUDE_CONFIG_DIR`, so the
session authenticates with the OAuth credentials the user's own `claude auth login` wrote. The
sign-out message in `ClaudeHome.ts` names both paths explicitly: subscription login, or an
instance's configured API credentials. Metadata work such as title generation shells out separately
with `-p --output-format json`. See `DECISIONS.md` D1 for why this satisfies spec §0 rule 2.

**There is already a provider-agnostic agent browser.** `apps/server/src/mcp/toolkits/preview/
tools.ts` exposes fourteen MCP tools — `preview_open`, `preview_navigate`, `preview_snapshot`,
`preview_click`, `preview_type`, `preview_press`, `preview_scroll`, `preview_evaluate`,
`preview_wait_for`, `preview_resize`, `preview_set_appearance`, `preview_status`,
`preview_recording_start`, `preview_recording_stop` — to _any_ provider thread, Claude or Codex or
another. The browser is a Chromium `<webview>` hosted by the desktop app, so a desktop client must
be running; web and mobile cannot host it. Cookie jars are **browser profiles**
(`packages/contracts/src/browserProfile.ts`): named partitions, `persistent` or `incognito`, up to
24, with built-in `default` and `incognito`. They are client-local and bound to no provider and no
account, so one logged-in profile serves every account and every vendor. The profile is fixed at
`preview_open`. This is the end of per-account browser hopping, and it is why Fabric does not build
a browser.

**Voice today is iOS dictation into a draft, and nothing else.** `docs/internals/voice-input.md`:
transcription edits a composer draft and does not submit an agent turn; the implementation
transcribes locally on supported iOS devices; environment-backed transcription is not implemented.
The shared controller lives in `packages/client-runtime/src/voice-input/`, which is the right seam
for Fabric to extend — there is no desktop capture, no wake word, no intent routing, no dictation
into anything but the composer. Spec Phase 5 stands in full.

**"Devices" upstream means simulators, not handsets.** `docs/internals/devices.md` covers iOS
simulators and Android emulators owned by the environment server, streamed by `expo-device-hub` and
driven by `agent-device` over adb/simctl. Useful shape, different thing; Fabric does not reuse the
name.

**Environment identity is independent of the route.** An environment keeps its id across restarts
and endpoint changes; a project and its threads belong to one environment; a repository identity can
correlate clones across environments but never routes work between them
(`docs/internals/remote.md`). This is the constraint that decides where a WorkSession may live —
see `DECISIONS.md` D6.

**The event log is the source of truth.** Commands are serialized by the engine, a pure decider
produces events, events and projections and the command receipt commit in one transaction, and
reactors do side effects afterwards and feed results back as commands
(`docs/internals/overview.md`). Persisted events must stay decodable on replay forever. Fabric's
domain follows this, which is why the WorkSession is not a mutable row updated in place by handlers.

## Phase 2 — WorkSession domain

Nothing here is a claim until the row names the file or test that proves it.

| Item                                                                | State                     | Where it is proven                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WorkSession` schema, versioned on the wire                         | done                      | `packages/contracts/src/fabric/workSession.ts`; decoded by `packages/contracts/src/rpc.test.ts` as part of the group                                                                                                                                                                     |
| Persistence beside threads, one migration                           | done                      | `apps/server/src/persistence/Migrations/054_FabricWorkSessions.ts`, `apps/server/src/fabric/WorkSessionRepository.ts`                                                                                                                                                                    |
| `fabric.workSession.create` (idempotent on id)                      | done                      | `WorkSessionService.test.ts`: "creating twice with one id is a retry"                                                                                                                                                                                                                    |
| `fabric.workSession.update`                                         | done                      | `WorkSessionService.test.ts`: "update leaves absent keys alone"                                                                                                                                                                                                                          |
| `fabric.workSession.attachThread` / `.detachThread`                 | done                      | `WorkSessionService.test.ts`: attach, idempotent attach, conflict, review role, detach, re-attach                                                                                                                                                                                        |
| `fabric.workSession.startThread`                                    | done                      | `apps/server/src/ws.ts` — dispatches `thread.create` through the ordinary engine, then attaches with `origin: created`. Covered by typecheck and the route suite's layer; **not** covered by a test that starts a provider                                                               |
| `.settle` / `.unsettle` / `.archive` / `.unarchive`                 | done                      | `WorkSessionService.test.ts`: "settling and archiving are separate, reversible"                                                                                                                                                                                                          |
| `fabric.workSession.list` with the provider timeline                | done                      | `WorkSessionService.test.ts`: archived hidden by default, `includeArchived` returns it                                                                                                                                                                                                   |
| `fabric.workSession.*` events (§28)                                 | done, as a live broadcast | `WorkSessionService.test.ts`: "subscribers receive a snapshot and then the events they caused". Not durable — see `DECISIONS.md` D11                                                                                                                                                     |
| Auth scope per method                                               | done                      | `apps/server/src/auth/RpcAuthorization.ts`; `RpcAuthorization.test.ts` asserts the key sets match the RPC group exactly                                                                                                                                                                  |
| Sidebar Work block, behind the flag                                 | done, narrowed            | `apps/web/src/components/sidebar/FabricWorkSessionSection.tsx`, logic in `fabricWorkSessionGrouping.ts` + its tests. `DECISIONS.md` D12 records what "grouping" means in this phase                                                                                                      |
| Client state shared by web and mobile                               | done                      | `packages/client-runtime/src/state/fabricWorkSessions.ts` + its test                                                                                                                                                                                                                     |
| Migration rehearsal on real data                                    | done                      | `VACUUM INTO` snapshot of the live install, `migrate-dev-db`: 53 and 54 applied, 18 → 21 tables, **no existing table's schema changed**, nothing dropped                                                                                                                                 |
| Rollback rehearsal (D7)                                             | done                      | a build pinned to migration 53 opens the migrated file, runs 0 migrations, and reads projections normally                                                                                                                                                                                |
| Real-path proof: create → attach → thread ends → restart → survives | done                      | two separate processes against the migrated snapshot of real data: process 1 created the work in the real `VentureOS` project, attached a Claude A thread and ended it; process 2 read back `status=active`, objective and branch intact, `activeThread=null`, timeline `claude-a:ended` |

### What the Phase 2 exit criterion says, and what proves it

> A WorkSession persists even if its provider thread ends.

Proven twice: as a unit case over the domain (`WorkSessionService.test.ts`, "the work session outlives
its provider thread ending"), and on a snapshot of the developer's real database across two separate
OS processes.

### Not proven

- **No browser walk.** The Work block's logic is unit-tested and the whole web package typechecks,
  but nothing here rendered it in a real client. The box was at load 47 with 5.5 GB free when this
  phase finished, and a dev server plus a browser is the one thing that could not be squeezed in.
- **`startThread` has not started a real provider.** It dispatches the same `thread.create` command a
  client would, through the same engine, so it cannot diverge from the sidebar's path — but that is
  an argument, not a test.
- **Multi-account handoff is Phase 3** and still blocked on a second Claude login (see Phase 1
  above).
