# Status

What actually works, as opposed to what is planned. Updated at the end of every phase.

Phase order: **0 → 2 → 3 → 4 → 9 → 5 → 6 → 7 → 8 → 10**. Phase 1 is already done; the reasoning
for moving 9 ahead of 5 is in `DECISIONS.md`.

| Phase                                          | State                     | Evidence                                                                                                                                                                            |
| ---------------------------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 — upstream audit and safe base               | **done**                  | this page, `UPSTREAM.md`, `DECISIONS.md`, `TEST_MATRIX.md`; upstream tree read at `6deac7a9`                                                                                        |
| 1 — real deployment baseline, zero custom code | **done by configuration** | two environments running stock `t3@0.0.42`, see below                                                                                                                               |
| 2 — WorkSession domain                         | **done**                  | the table below; both gaps since closed in a real browser and against a real provider                                                                                               |
| 3 — provider/account handoff                   | not started               | blocked on a second Claude login (Phase 1)                                                                                                                                          |
| 4 — working synopsis + fleet status            | **done**                  | the Phase 4 table below; proven against two threads in different states on a real provider                                                                                          |
| 9 — orchestration                              | **done**                  | the Phase 9 table below; the specification's own sentence created rules that fired once and stopped                                                                                 |
| 5 — the intent surface                         | **done for text**         | the Phase 5 table below. The fork owns everything after the text exists (D24), so the microphone, the wake word and the conversation window are the client's and are not in it      |
| 6 — VS Code + browser + system dictation       | **partial**               | the Phase 6 table below: the context bus, the routing, the injection report and dictation are built and proven; both extension hosts are blocked on a device this box does not have |
| 7 — mobile voice + quick actions               | **partial**               | the Phase 7 table below: the fleet, the status questions and the deep links are built and typecheck; the mic, App Intents and handoff are blocked on a device, a mac and Phase 3    |
| 8 — Herdr adoption                             | **partial**               | the Phase 8 table below: the domain, the mapping, the fleet and every refusal are proven on the snapshot; discovery and send-input are blocked on Herdr not being installed here    |
| 10 — capability plane + hardening              | **partial**               | the Phase 10 table below: the plane, the policy, retention, the audit view, migration additivity as a test, and the reconnect and performance runs on the snapshot                  |

## Where Fabric is — the whole programme

One table, so this file answers the question on its own. "Proven" means run
against the snapshot of real userdata or asserted by a test that drives the real
services; "built" without "proven" is said explicitly.

| Phase                             | State                     | What is proven                                                                                                                                                   | What is not                                                           | What the Director must supply                                                                 |
| --------------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 0 — upstream audit                | **done**                  | the fork point, the package map, the conflicts table (refreshed at Phase 10)                                                                                     | —                                                                     | —                                                                                             |
| 1 — deployment baseline           | **done by configuration** | two environments on stock `t3@0.0.42`, paired, with a phone client                                                                                               | several Claude accounts logged in at once                             | **a second and third `claude auth login`**, one per config dir                                |
| 2 — WorkSession domain            | **done**                  | the domain, the RPC, the sidebar; the work outliving its thread, proven twice — unit and two processes on real data; a real Claude turn; a browser walk          | —                                                                     | —                                                                                             |
| 3 — provider/account handoff      | **not started**           | —                                                                                                                                                                | everything                                                            | **the second Claude login** (Phase 1's item). The handoff cannot be _proved_ with one account |
| 4 — synopsis + fleet              | **done**                  | §10's ladder, §11.1's triggers, the §33 fleet and its "Needs me" filter, §20's spoken answers; proven against two threads in different states                    | a remote environment's fleet appearing in another client              | —                                                                                             |
| 5 — the intent surface            | **done for text**         | one deterministic grammar; status, message, start/resume, rule creation and gate answers; every intent recorded; the §29 exit sentences run against the snapshot | a microphone, App Intents, a browser walk of the bar                  | — (the phone's own keyboard supplies dictation)                                               |
| 6 — VS Code, browser, dictation   | **partial**               | the context bus, §14's routing, §18's injection report refusing Wayland by name, dictation kept client-side                                                      | both extensions; no desktop run                                       | **VS Code and a browser with an extension host**, on a machine with a desktop session         |
| 7 — the phone                     | **partial**               | the fleet screen, the §20 questions, deep links including work whose thread has ended                                                                            | the app has never been run                                            | **a phone or a simulator, and a mac** for App Intents and the Action Button                   |
| 8 — adopted sessions              | **partial**               | §9's mapping, declared capability limits, an adopted terminal moving the work's state — proven on the snapshot                                                   | discovery from a real runtime; input delivered to a real pane         | **Herdr installed** where the terminals are                                                   |
| 9 — orchestration                 | **done**                  | bounded rules, no self-triggering, a durable bound, transition semantics; §22's own sentence fired once and stopped, live                                        | a genuinely cross-account review                                      | **the second account**                                                                        |
| 10 — capability plane + hardening | **partial**               | the plane and its policy, retention, the audit view, migration additivity as a test, reconnect and two-client agreement, `fleet.get` at 26ms median              | a mid-turn disconnection; a phone resume; the capabilities themselves | **a device** for the resume case                                                              |

## On the boxes — what is actually running

The fork stopped being a branch on 2026-09-18: the Director cleared it to replace
the stock release on his own servers ("you can restart the t3 as I haven't used
it yet"). The runbook is `DEPLOY.md`; this is the state.

| Machine       | Runtime                                   | Verified                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| signzart-prod | `0.0.43-fabric.1` (fork), beside `0.0.42` | service active, `http://127.0.0.1:3773` → 200; migrations 054–059 applied to the live `userdata` and seven `fabric_*` tables present; `projection_projects` still carries VentureOS; T3 Connect reconciled and the tunnel re-registered; Tailscale Serve returns 200 from another tailnet device; OOM shield re-applied; frames in `frames/deploy-2026-09-18/`                                                                                                                                                                                                                                                                                                                 |
| the local box | `0.0.43-fabric.1` (fork), beside `0.0.42` | service active, `http://127.0.0.1:3773` → 200; migrations 054–059 and the seven `fabric_*` tables; row counts identical either side of the switch (nothing to lose — that environment has no projects or threads, it is the paired second one); T3 Connect reconciled on the first restart and four tunnel connections registered; the fork's client chunk carrying the intent surface is installed and served, and the stock client has no such string. **Not applied there: the OOM shield** — `sudo` on that box wants a password and a user unit cannot lower `OOMScoreAdjust` below the manager's `DefaultOOMScoreAdjust=200`, which is what the stock release ran at too |

What the deploy changed in the fork itself: `fabricWorkSessionsEnabled` now
defaults **on** (`DECISIONS.md` D45), because a build where the user must find a
setting before seeing any of it is a build nobody uses.

Two things the first deploy taught, both now in `DEPLOY.md` and both invisible
until they bite: the service-launcher **protocol number** must match (D46), and a
fork build carries **none of T3 Connect's public config**, so the cloud link is
skipped and the environment quietly stops being reachable from t3.codes while
every local check still passes (D47).

### §30's V1 definition of done, honestly

| #   | Criterion                                                           | State                                                                                           |
| --- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 1   | One desktop UI shows Claude A/B/C and Codex across two environments | **blocked** — one account is logged in                                                          |
| 2   | Phone connects to the same environments and continues work          | **done** (upstream), and Fabric's own screen is built but unrun                                 |
| 3   | Separate Claude accounts stay logged in                             | **blocked** — the second login                                                                  |
| 4   | WorkSession survives account handoff                                | **blocked** — Phase 3                                                                           |
| 5   | Parallel tasks use separate worktrees                               | **done** (upstream)                                                                             |
| 6   | State/needs-attention visible across sessions                       | **done** — the fleet, proven                                                                    |
| 7   | Mic messages a focused or named WorkSession without push-to-talk    | **not met** — no microphone in the fork by D24; the client that owns one is not built           |
| 8   | "What's X doing?" answers without interrupting X                    | **done** — proven against the snapshot                                                          |
| 9   | Dictation writes into a focused browser field                       | **partial** — the routing and the refusals are proven; the browser extension is not built       |
| 10  | VS Code Remote SSH context associates with a WorkSession            | **partial** — the contract and the routing are proven; the extension is not built               |
| 11  | High-risk production operations require confirmation                | **done, and stricter** — refused from a sentence (D28) and off in the production template (D42) |
| 12  | Disconnecting the laptop does not kill server-side work             | **done** — proven at the connection level                                                       |
| 13  | Reconnecting from another client restores the correct state         | **done** — proven: identical fleet after a drop, two clients agreeing                           |

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
| Persistence beside threads, one migration                           | done                      | `apps/server/src/persistence/Migrations/Fabric/001_WorkSessions.ts`, `apps/server/src/fabric/WorkSessionRepository.ts`                                                                                                                                                                   |
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

### Both Phase 2 gaps, closed

The two things this page called unproven when Phase 2 shipped have since been done.

**The Work block, in a real browser.** The built web client, served by a real server on the snapshot
database, paired with Playwright at 1440×900, the client setting on. Frames in `frames/phase-2/`,
described in `frames/README.md`. What it renders, read off the page:

```text
Fabric proof scratch
Production deploy check
  Claude · signzart-prod · Approval needed

VentureOS
Scheduler reconnect race
  signzart-prod · No provider
```

Project, then work, then account · host · state. The second row is a work session whose provider
threads have all ended — still present, still naming the account that ran it. No console errors.

**`startThread` against a real provider.** Over the real WebSocket, against the box's own Claude Max
subscription (`claudeAgent`, status `ready`, authenticated as a Claude Max account):

```text
provider claudeAgent: status=ready auth={"status":"authenticated","type":"Claude Max", …}
startThread: Scheduler reconnect race [active] active=live-thread-1789705575850
             timeline=…,claudeAgent/created/implementation:live
turn dispatched; waiting for the provider to answer...
assistant answered: ready
```

One turn, seven seconds, on a scratch git repository — never the developer's live checkout, because a
thread takes checkpoints as hidden refs in whatever workspace it runs in. `origin: created` on the
timeline is what distinguishes a thread Fabric started from one it adopted.

### Not proven

- **Multi-account handoff is Phase 3** and still blocked on a second Claude login (see Phase 1
  above).
- **Two UI observations from the frames, neither cropped out:** sidebar headings truncate at 256 px,
  and the Fleet and Work blocks read as two similar lists at that width. Both are in
  `frames/README.md`.

## Phase 4 — Working Synopsis and fleet status

| Item                                                            | State                      | Where it is proven                                                                                                                                                                                                                                                                                   |
| --------------------------------------------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FabricSessionState`, all ten values, derived deterministically | done                       | `packages/contracts/src/fabric/sessionState.ts` + `sessionState.test.ts`. Reachability outranks everything; approvals and questions outrank a running session; a failure outranks lingering background liveness; an exhausted account reads `limited` rather than `idle` so the reason is not hidden |
| The §10 source ladder, with no model anywhere                   | done                       | the derivation reads `hasPendingApprovals`, `hasPendingUserInput`, `session.status`, `session.lastError`, `backgroundLiveness`, `latestTurn`, and the provider's own quota report — nothing else, and no transcript                                                                                  |
| Work-session state from its threads                             | done                       | `deriveWorkSessionState`: the most demanding live thread wins, so an implementation session working beside a review session waiting for approval reads as needing the user                                                                                                                           |
| `WorkSession.synopsis`, persisted                               | done                       | Fabric migration 002 (additive, one nullable column), `WorkSessionRepository`                                                                                                                                                                                                                        |
| Deterministic synopsis updates from events (§11.1)              | done                       | `packages/shared/src/fabricSynopsis.ts` + test: turn started/completed/failed, tool started, files changed, validation started/finished, approval requested/resolved, question asked/answered, plan step, PR opened, background changed                                                              |
| The event→signal mapping                                        | done                       | `apps/server/src/fabric/SynopsisReactor.ts` + test. An unknown activity kind returns null rather than guessing                                                                                                                                                                                       |
| Staleness                                                       | done                       | `SYNOPSIS_STALE_AFTER_MS`, `isSynopsisStale`; the Fleet row renders "(stale)" and the spoken answer says how old it is                                                                                                                                                                               |
| Semantic summarisation at milestones                            | **not done, deliberately** | `DECISIONS.md` D16                                                                                                                                                                                                                                                                                   |
| `fabric.fleet.get` + `needsUserOnly`                            | done                       | `apps/server/src/fabric/FleetQuery.ts`, `packages/shared/src/fabricFleet.ts` + test                                                                                                                                                                                                                  |
| `fabric.synopsis.updated` (§28)                                 | done                       | on the existing subscription; `WorkSessionService.test.ts` asserts it is its own event, not a work-session update                                                                                                                                                                                    |
| Fleet view in `apps/web`, §33 shape                             | done                       | `FabricFleetSection.tsx`, logic in `fabricFleetView.ts` + test; frames in `frames/phase-4/`                                                                                                                                                                                                          |
| "Needs me" as a top-level filter                                | done                       | one always-visible control; the browser walk clicked it and the list reduced to the blocked row                                                                                                                                                                                                      |
| §20 spoken status as a pure function                            | done                       | `packages/shared/src/fabricSpokenStatus.ts` + test, including the specification's own example sentence                                                                                                                                                                                               |

### The Phase 4 exit criterion, against two threads in different states

> The fleet view answers what is running, where, under which account, what needs the user, what
> recently completed.

Two work sessions were started on the real provider: one asked for a word, one asked for a file
under `approval-required` so it would stop and wait. `fabric.fleet.get` then answered:

```text
fleet: Production deploy check    [needs_approval] needsUser=true
       threads=claudeAgent:needs_approval
       synopsis="Waiting for approval: File-change approval requested"
fleet: Scheduler reconnect race   [done_unseen]    needsUser=false
       threads=claudeAgent:done_unseen
needs me: Production deploy check
```

What is running and what recently completed: the two states. Where: the environment that answered.
Under which account: `claudeAgent`. What needs the user: the `needsUserOnly` read returned exactly
one entry. The synopsis line was written by the reactor from the approval event — nothing asked the
agent what it was doing.

The same two rows in the browser are `frames/phase-4/01-fleet.png`, ordered with the blocked one
first, and `02-needs-me-filter.png` after the filter was clicked.

### Not proven in Phase 4

- **No model-generated synopsis.** The deterministic path is complete; the milestone summariser is
  not built, and D16 says why rather than leaving a gap to be discovered.
- **`done_unseen` is coarser on the server than in a client.** The environment does not know when
  this user last opened a thread, so its `done_unseen` means "completed and nothing since". A client
  passing its own last-visited time gets the stricter answer, and the fleet builder takes that as an
  input. D17.
- **No mobile surface.** The fleet RPC and every derivation are shared code, but nothing in
  `apps/mobile` renders them yet; that is Phase 7.
- **`limited` has not been seen in the wild.** It is unit-tested against a reported quota window at
  100%, but no account was exhausted to watch it happen.

## Phase 9 — bounded orchestration

| Item                                                                                  | State         | Where it is proven                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `OrchestrationRule` contract: trigger, action, follow-up, confirmation gate           | done          | `packages/contracts/src/fabric/orchestrationRule.ts`                                                                                                                                                               |
| Triggers `on_done` / `on_needs_user` / `on_failed` / `after_rule`                     | done          | `OrchestrationRuleService.test.ts` — each mapped onto the `FabricSessionState` values §10 derives, and nothing else                                                                                                |
| `after(time)` triggers                                                                | **not built** | a scheduler rather than a reactor, and none of this phase's three safety properties is written to hold for one; `DECISIONS.md` D23                                                                                 |
| Actions: start a provider session, message the implementer, notify, confirmation gate | done          | `OrchestrationEffectsLive.ts` is the whole list of what a rule may do; `OrchestrationReactor.test.ts` drives each one through the real services and reads back the firing it recorded                              |
| Persistence, additive                                                                 | done          | Fabric migration 003, two tables; `OrchestrationRuleRepository.ts`                                                                                                                                                 |
| Create / list / disable / enable / confirm over RPC, each with an auth scope          | done          | `rpc.ts`, `RpcAuthorization.ts` — the key set must equal the RPC group's, so an unscoped method is a compile error                                                                                                 |
| Evaluated by a reactor on the same events Phase 4 reads                               | done          | `OrchestrationReactor.test.ts` pins the event set — the four Phase 4 reads, and pinning/snoozing/renaming ignored: a rule must not fire on a fact the fleet cannot see                                             |
| Never a model in the firing decision                                                  | done          | `shouldFire` is arithmetic over recorded facts; there is no model call anywhere in the path                                                                                                                        |
| Hard loop bound: at most N firings, default 3, durable                                | done          | the count lives in the database, not in memory — a bound that resets on restart is not one. `OrchestrationReactor.test.ts`: six finishes, two firings, then `exhausted`                                            |
| Never re-triggered by its own effect                                                  | done          | `shouldFire` checks the produced thread **before** the trigger, so a matching state on a rule's own thread cannot slip past; the reactor test fires once and then returns nothing for the review thread it created |
| `ruleTriggered` / `ruleCompleted` events (§28)                                        | done          | `OrchestrationRuleService.test.ts`                                                                                                                                                                                 |
| Firings on the work-session timeline                                                  | done          | every firing records what produced it; the Work block renders the rule and its last firing                                                                                                                         |
| Natural language → rule, deterministic grammar, no model                              | done          | `packages/shared/src/fabricRuleParser.ts` + 12 tests, including the specification's own sentence                                                                                                                   |
| The parser refuses with the phrase it could not place                                 | done          | "deploy to production" is named back rather than dropped, and nothing is created when part of a sentence cannot be placed                                                                                          |
| Rules shown in the UI behind the same flag                                            | done          | `apps/web/src/fabricRuleView.ts` + tests; rendered in the Work block                                                                                                                                               |

### The Phase 9 exit criterion

> The specification's sentence creates an inspectable rule and, against the snapshot with a thread
> you finish by hand, it fires once, starts the review thread, and stops.

```text
parsed: ok=true
parsed into 2 rule(s)
rule rule-proof-b-1: trigger=on_done   action=start_provider_session max=3
rule rule-proof-b-2: trigger=after_rule action=notify                max=3
implementation thread started: rule-proof-impl-2

  … one cheap turn on the box's own Claude Max subscription, finished by hand …

rule rule-proof-b-1 [enabled] fired=1/3
  firing rule-proof-b-1#1: completed by=on_done:idle
    produced=rule-rule-proof-2-47f9c726-… detail="Started claudeAgent as review."
rule rule-proof-b-2 [enabled] fired=1/3
  firing rule-proof-b-2#1: completed by=after_rule:starting detail="if either needs me"
timeline: claudeAgent/created/implementation:live, claudeAgent/created/review:live
synopsis: [{"text":"if either needs me", …}]
```

Re-read minutes later, after the review thread had taken its own turn: still `fired=1/3` on both.
The review session finishing did **not** re-fire the rule that created it, which is the loop §22
names.

### Two defects the live run found

Neither was visible to the unit tests, and both are the kind only a real run produces.

**A sequenced rule fired on every event, not once per predecessor completion.** The first run
recorded `fired=3/3` on the notify rule, which then read `exhausted`. `shouldFire` was asking "has
the predecessor completed?", and that stays true forever. The bound stopped it — the safety net doing
exactly its job — but a bound is not a schedule. A sequenced rule now fires only while its own firing
count is behind the predecessor's completions, so a second review releases a second notification and
nothing else does. `DECISIONS.md` D20.

**A rule started a session on a provider that cannot run.** The first run started the review on this
environment's Codex, which is configured but whose binary is not installed. The rule did what it was
told; the result was a dead thread and a synopsis containing a spawn stack trace. A rule now checks
availability before creating anything and records `skipped` with the reason, because "that account is
not available here" is a correct outcome rather than a fault. D21.

### Not built, and not pretended otherwise

- **`after(time)` triggers.** The brief's trigger set is `on_done, on_needs_user, on_failed,
after(rule|time)`. The event triggers and `after_rule` ship; a time trigger does not, because it is
  a scheduler rather than a reactor and none of this phase's three safety properties is written to
  hold for one. The reasoning, and what it would take, is `DECISIONS.md` D23.

### Not proven in Phase 9

- **No second account.** The specification's sentence names Codex; this box has no Codex binary, so
  the proof's vocabulary resolves "Codex" to the installed Claude instance. The _mechanism_ —
  starting a named account as a reviewer — is what ran; a genuinely cross-account review needs the
  second subscription Phase 1 is still waiting on.
- **The review's findings were not read back.** `message_active_implementation_session` with
  `include: review_findings` is built and unit-tested, but no run has taken a real reviewer's
  BLOCKING output and returned it to the implementer. That is §22's full loop and it needs a reviewer
  that can actually run.
- **`confirmation_gate` has not been answered in a browser.** The RPC, the parked state and the
  release path are tested; no run has clicked it.
- **No browser walk of the rule rows.** The rendering is unit-tested and the web package typechecks;
  the frames under `frames/` are from Phase 2 and Phase 4.
- **Voice does not create rules yet.** The parser is pure and ready; wiring it to speech is Phase 5.

## Phase 5 — the intent surface

The Director's north star: he speaks a sentence into whatever microphone is nearest — iOS dictation,
Wispr Flow, a DJI receiver through his own speech-to-text — and the fleet does the thing. **The fork
owns everything after the text exists** (`DECISIONS.md` D24). There is no audio code in this
repository and there should not be: a phone, a laptop and a keyboard must mean the same thing to the
environment.

| Item                                                             | State | Where it is proven                                                                                                                                                                           |
| ---------------------------------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fabric.intent.run(text)` over RPC, with auth scopes             | done  | `rpc.ts`, `RpcAuthorization.ts` — three methods; `resolve` reads, `run` operates, `list` reads. The scope map's key set must equal the RPC group's, so an unscoped method is a compile error |
| One deterministic grammar, §13, no model                         | done  | `packages/shared/src/fabricIntentParser.ts` — a pure function of the sentence and the environment's own vocabulary; nothing in the path can reach a provider                                 |
| Work-session status → Phase 4's spoken sentence                  | done  | `IntentService.test.ts`; the live run answered "What needs me?" with the §20 sentence built from the real fleet                                                                              |
| Start / resume a work session on a named project, host, provider | done  | `fabricIntentParser.test.ts`; `IntentExecutorLive.ts` starts it through the same narrow effects a rule uses                                                                                  |
| Message the active implementation session                        | done  | `IntentService.test.ts` — the user's own words reach the work session's live thread, unchanged                                                                                               |
| Create a rule, by delegating to `fabricRuleParser`               | done  | `IntentService.test.ts`; the live run created §22's two rules from one sentence, each carrying the sentence as its source                                                                    |
| Answer a parked confirmation gate                                | done  | the live run parked a gate and released it by sentence; `fabricIntentParser.test.ts` for the grammar, including two questions waiting                                                        |
| Refuse everything else, naming the phrase                        | done  | `fabricIntentParser.test.ts` — 32 cases; every refusal carries the words it could not place                                                                                                  |
| Every intent recorded (`received` / `resolved` / `refused`)      | done  | Fabric migration 004, one additive table; `IntentService.ts` publishes the three §28-style events and writes the row, refusals included                                                      |
| Shown on the work session when it has one                        | done  | `apps/web/src/fabricIntentView.ts` + tests; the Work block renders the last three for each work session                                                                                      |
| A text entry point in the web UI, behind the same flag           | done  | `FabricIntentBar.tsx` in the Fleet section: resolves while typing, shows what enter will do, says the reply afterwards                                                                       |
| The spoken reply is text any TTS can read                        | done  | `FabricIntentRunResult.reply` is a plain string; no speech vendor, model or licence anywhere in the fork (D24)                                                                               |
| No model decides anything                                        | done  | `resolveFabricIntent` is arithmetic over strings and the environment's own records                                                                                                           |
| 15+ parser cases from the specification and his phrasing         | done  | 32 in `fabricIntentParser.test.ts`, plus 7 service cases and 7 view cases                                                                                                                    |

### The Phase 5 exit criterion

> Against the snapshot: the specification's status sentence returns the Phase 4 sentence, a rule
> sentence creates the rule, a gate sentence releases a parked gate, and a nonsense sentence is
> refused by name.

```text
> What needs me?
  resolves to: status_fleet — Say what needs you. [risk low]
  reply:       Claude is waiting for approval on Production deploy check. Rule proof failed on Claude.

> When Claude finishes this, have Claude review it and tell me if either needs me.
  resolves to: create_rules — Create 2 rules on Fabric proof scratch / Intent proof. [risk medium]
  reply:       Created 2 rules. Each will fire at most three times.
    rule-…-1: trigger=on_done    action=start_provider_session max=3 source="When Claude finishes this, …"
    rule-…-2: trigger=after_rule action=notify                 max=3 source="When Claude finishes this, …"

  before: fired=1/3 — intent-proof-gate-3#1:awaiting_confirmation
> Yes, go ahead on intent-proof-3
  resolves to: answer_gate — Answer yes to: Restart the worker?
  reply:       Confirmed.
  after:              fired=1/3 — intent-proof-gate-3#1:completed
  five seconds later: fired=1/3 — intent-proof-gate-3#1:completed

> Sort out the thing with the stuff
  resolves to: REFUSED (unrecognised) — I could not place "Sort out the thing with the stuff". …

> Deploy to production
  resolves to: REFUSED (high_risk) — That asks for a production deploy. Fabric never does that from
               a sentence — do it yourself, with the change in front of you.
```

The gate was parked without spending anything: stopping the thread's session emits
`thread.session-set`, one of the four events the reactor already reads, so the rule fired on a real
event rather than on a hand-written row. No provider turn was taken anywhere in this phase.

### Three defects the live run found

**Rules created by sentence had no source.** §22 keeps the user's own words on the rule so it can be
read back; the intent path was not passing them, and the live run printed `source=""`. The sentence
now travels with the command and onto every rule it creates.

**A refusal nobody could act on.** Two pieces of work shared a title, so the ambiguity refusal read
"That could be Intent proof, or Intent proof. Say which one." The refusal now names the ids when the
labels collide — and the ids are matchable, so "Yes, go ahead on intent-proof-3" is an answer the
grammar accepts.

**Answering a question re-asked it.** Confirming a gate re-evaluates the work session so that what
was queued behind it can run; the gate's own rule matched the same unchanged state and parked a
second question in the same second. The evaluation caused by an answer now skips the rule that
asked. `DECISIONS.md` D29, which also records the general case that is still open.

### Not proven in Phase 5

- **No microphone, wake word, or conversation window.** By decision (D24) those belong to the client
  that owns the audio device. What is proven is everything after the text: this phase does not claim
  hands-free operation, and §29 Phase 5's own exit criterion — walking away from the keyboard with a
  DJI mic — is not met by this repository alone.
- **No browser walk of the intent bar.** The rendering and the preview wording are unit-tested and
  the web package typechecks; the committed frames are still Phase 2 and Phase 4.
- **`start_work_session` was not run live.** The grammar and the executor are tested, and the live
  run deliberately did not start a provider session, because this phase was not authorised to spend
  a turn.
- ~~**A state-triggered rule still fires on a state that persists**~~ — **closed** by the Phase 9
  transition amendment below: Fabric migration 005, and a rule now fires on entering a state rather than
  while it holds. D30.
- **No second account**, so "continue this with Claude B" resolves against one Claude. The mechanism
  is there; the second subscription is still Phase 1's open item.

## Phase 9 amendment — a trigger is a transition

| Item                                                                 | State | Where it is proven                                                                                                                         |
| -------------------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| The reactor remembers the state it last saw each work session in     | done  | Fabric migration 005, one additive table, one row per work session; `OrchestrationRuleRepository.getObservedState` / `setObservedState`    |
| Durable, so a restart is not a fresh transition                      | done  | the row is in the database, for the reason the firing count is: a restart is when a runaway does the most damage                           |
| A rule fires on **entering** a matching state, not while it holds    | done  | `OrchestrationRuleService.test.ts`, "fires on entering a state, not while it stays true" — `state_unchanged` is a named refusal            |
| A rule that has never fired may act on a state it finds already true | done  | `OrchestrationRuleService.test.ts` — "when this finishes, have it reviewed" said about work that has just finished must still do something |
| A persisting state produces one firing; a re-entry produces a second | done  | `OrchestrationReactor.test.ts` — four evaluations in the same state fire once; out to `working` and back to `done_unseen` fires again      |
| The bound still stops a rule that really does finish repeatedly      | done  | `OrchestrationReactor.test.ts` — six genuine finishes, two firings, then `exhausted`                                                       |
| `after_rule` unchanged                                               | done  | sequenced rules are released by their predecessor completing (D20); the transition check does not apply to them                            |
| Migration rehearsed                                                  | done  | 058 applied to the snapshot, then builds pinned to 57 and to 53 each ran 0 migrations and read the same `projects=2 threads=14`            |

Not proven: no live run. The behaviour is a refusal that leaves no trace — the evidence for it is
firings that **do not** happen — so the reactor test, which drives the real services and moves the
work session between states, is the stronger proof. A live run would show the same absence.

## Phase 6 — context, dictation, and the boundaries this box has

§29 Phase 6 wants voice to become an input transport beyond T3: a desktop context
bus, a VS Code extension, a browser extension, an OS foreground-app adapter,
text-injection adapters, an explicit dictation mode, and deterministic context
routing.

Four of those seven are built and proven here. Two need a host this box does not
have and are blocked with that blocker named. One is partial, and the part that
is missing is missing because the operating system forbids it — which the code
now says out loud rather than discovering at runtime.

| Item                                | State                                                       | Where it is proven, or what blocks it                                                                                                                                                                                                                                     |
| ----------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Desktop context bus (§15)           | done                                                        | `packages/contracts/src/fabric/context.ts` for the shape, `packages/shared/src/fabricContextBus.ts` for the behaviour: one slot per producer, late arrivals dropped, facts that expire. Client-local by construction — nothing here crosses to an environment             |
| Deterministic context routing (§14) | done                                                        | `fabricContextBus.test.ts` walks every rung an environment-free client can honestly climb, and stops rather than reaching §14's rung 8, which is a model                                                                                                                  |
| Text-injection adapters (§18)       | done                                                        | `packages/shared/src/fabricInjection.ts` — the interface, the preference order applied in order rather than in registration order, and a capability report where every "no" carries a reason                                                                              |
| Explicit dictation mode (§12.3)     | done                                                        | `packages/shared/src/fabricDictation.ts` and the intent bar. Classified on the client; **the words never reach an environment** (D31)                                                                                                                                     |
| OS foreground-app adapter           | partial                                                     | `apps/desktop/src/fabric/DesktopInjectionCapability.ts` reports platform, display server and permission from the machine's own facts. Reading _another_ application's window under Wayland is not possible, and the report refuses it by name instead of pretending (D33) |
| VS Code extension (§16)             | **blocked** — no VS Code and no desktop session on this box | the contract it must satisfy is built, and the bus routes its snapshots today: `fabricContextBus.test.ts` drives a `vscode` producer through the ladder, linked and unlinked. D32                                                                                         |
| Browser extension (§17)             | **blocked** — no browser with an extension host             | same: the `browser` producer's shape is pinned, including the privacy line (origin and field type, never page content), and dictation into a reported field is routed and refused correctly today. D32                                                                    |

### The exit criterion

> The mic can be used both for agent messages and ordinary text entry without a
> keyboard press.

**Not met, and it cannot be met from this repository alone.** There is no
microphone on this box, no desktop session, no VS Code and no browser extension
host. What is proven is everything up to those boundaries, and each boundary
refuses by name rather than failing quietly:

```text
dictation, no producer running
  → "I can only type into a field something has told me about.
     Nothing is reporting one right now."

dictation, a field reported but not writable
  → "Gmail compose cannot take dictated text from here."

this box, asked what it can type into
  → accessibility: unavailable — "Wayland does not let one application type
     into another. Use the browser or VS Code integration instead."
    keystrokes:    unavailable — "Wayland does not allow synthetic input from
     another process."
    application:   unavailable — "no application integration is connected."

the environment, sent a dictation sentence
  → refused: "Dictated words stay on your own device — the client handles them
     and never sends them here."
```

### What changed for the user today

§14's rung 3 finally has a producer. Until this phase the intent bar sent
`focusedWorkSessionId: null`, so "tell it to run the tests" always fell through
to whatever moved last; now the thread on screen resolves to the work it belongs
to (`apps/web/src/fabricContextView.ts`, and the fleet section passes it).

### Not proven in Phase 6

- **No microphone anywhere in the loop.** The phase's own exit criterion needs
  one, and by D24 the fork does not contain speech at all.
- **Neither extension has been loaded.** Both are blocked on a host; the contract
  and the routing are proven, the hosts are not written.
- **No desktop run.** `DesktopInjectionCapability` is unit-tested against
  fabricated environments, and `apps/desktop` typechecks with its dependencies
  installed, but the Electron app was not started — there is no desktop session
  on this box to start it in.
- **No live run against the snapshot.** Nothing in this phase talks to an
  environment: the context bus, the injection report and the dictation pass are
  client-local by design (D31, D32), so a server proof would prove nothing about
  them.

## Phase 7 — the phone

§29 Phase 7 wants the phone to become a supervisor and a voice remote: a mobile
work-session UI, a mic button, status query, voice message, provider handoff, iOS
App Intents, an Action Button shortcut, a quick "What needs me?", and notification
deep links.

Four are built. Four are blocked on a device, a mac, or a phase that does not
exist yet — and the phone says which, where the action would have been.

| Item                                | State                                                           | Where it is proven, or what blocks it                                                                                                                                                                                   |
| ----------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mobile WorkSession UI               | done                                                            | `apps/mobile/src/features/fabric/FabricRouteScreen.tsx`, reachable from the home header and by deep link; rows come from the same builder the desktop uses (D34)                                                        |
| Status query                        | done                                                            | the three §20 questions as one-tap sentences, answered by `fabric.intent.run`; `fabricFleetScreenModel.test.ts`                                                                                                         |
| Voice message / send an instruction | done                                                            | the same field and the same grammar. The phone has no microphone of its own: iOS's keyboard dictation key fills the field, which is the whole of D24 applied to a phone (D35)                                           |
| Quick "What needs me?"              | done                                                            | `FABRIC_QUICK_ACTIONS` — sentences, not special-cased buttons, so a button cannot drift from what the same words do typed out                                                                                           |
| Notification deep links             | done                                                            | `fabricNotificationLink.ts`: a live thread opens the thread, and work whose thread has ended opens the Fabric screen focused on it — the case upstream's thread links cannot express, and the one the object exists for |
| See all active work                 | done                                                            | the fleet list, with §33's "Needs me" as a top-level filter                                                                                                                                                             |
| Open the relevant WorkSession       | done                                                            | the deep link, and the row                                                                                                                                                                                              |
| Approve / respond                   | **already upstream**                                            | T3's mobile client answers approvals and questions today (Phase 1's table); Fabric adds the route to the right thread rather than a second approval surface                                                             |
| Mic button                          | **blocked**: no device, no mac                                  | and by D24 the fork contains no speech pipeline; the keyboard's dictation key is the microphone (D35)                                                                                                                   |
| iOS App Intents                     | **blocked**: no Xcode, no signing identity, no device           | §19.1's supported entry points all need a native target                                                                                                                                                                 |
| Action Button shortcut              | **blocked**: same                                               |                                                                                                                                                                                                                         |
| Provider handoff action             | **blocked**: Phase 3 is not built, and one account is logged in | the phone renders the reason where the button would be (D36)                                                                                                                                                            |

### The exit criteria

> From iPhone the user can: see all active work; ask what is happening; send an
> instruction; approve/respond; hand off account; open the relevant WorkSession.

Five of the six are built; **hand off account** is not, and cannot be until Phase
3 exists and a second subscription is logged in. None of the six has been
exercised on a phone: this box has no simulator and no device, so what is proven
is that the code typechecks, the view models are unit-tested, and the screen is
wired to routes and to the same RPC the desktop uses.

### Not proven in Phase 7

- **The app has never been run.** No simulator, no device, no mac. `@t3tools/mobile`
  typechecks with its dependencies installed and its view models are tested; no
  screen has been rendered.
- **No App Intents, Action Button, or custom audio**, by D35 and for want of a
  native toolchain.
- **Handoff**, by Phase 3 and the second account.
- **Background → foreground behaviour (E3)** is untested: it needs a phone that
  can be backgrounded.
- **No live run against the snapshot.** The phone's screen calls the same
  `fabric.*` RPCs Phases 4 and 5 already proved against it; nothing new crosses
  the wire, so a second live run would prove nothing the earlier ones did not.

## Phase 8 — adopted sessions

§29 Phase 8 brings terminals Fabric did not start into the same fleet: a Herdr
adapter, discovery, state mapping, an `AdoptedSession`, attachment to a work
session, a raw terminal surface, "show X", and a safe send-input capability.

The domain is built and proven against the snapshot. The parts that need the
runtime itself are **blocked on Herdr not being installed on this box** — and
that absence is what makes their refusals provable rather than hypothetical.

| Item                                  | State                                                               | Where it is proven, or what blocks it                                                                                                                                                                  |
| ------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Herdr adapter                         | done, as a **port**                                                 | `AdoptedRuntimeAdapter` + `HerdrAdapterLive.ts`: the only file that knows the runtime exists. Herdr is AGPL and is integrated, never vendored (D37)                                                    |
| Discover server/workspaces/panes      | **partial**                                                         | the shape and the line parser are proven (`HerdrAdapterLive.test.ts`); on a machine without Herdr discovery refuses **by name** rather than returning an empty list that reads as "nothing is running" |
| Map semantic agent state              | done                                                                | `packages/shared/src/fabricAdoptedSession.ts` — §9's four rows, and a word Fabric does not know is refused rather than called idle (D38)                                                               |
| Create an AdoptedSession              | done                                                                | Fabric migration 006, `AdoptedSessionService.test.ts`; registering twice with one id is a retry                                                                                                        |
| Attach to a WorkSession               | done                                                                | the work session id is on the row, and the fleet groups by it                                                                                                                                          |
| Appear in the fleet                   | done                                                                | `fabricFleet.test.ts` and the live run: an adopted pane that reports `blocked` makes the _work_ say it needs the user (D40)                                                                            |
| Declared capability limits            | done                                                                | every adopted session carries what Fabric may not do to it, and each refusal says why (D39)                                                                                                            |
| Safe send-input                       | done as a gate, **blocked** as an action                            | the capability check, the released-session check and the runtime's own refusal are proven; nothing has been typed into a real pane                                                                     |
| Raw terminal attach surface, "show X" | **blocked**: no Herdr, and no desktop session to show a terminal in | the capability is declared and carried on the row; the surface is the desktop's, which Phase 6 already lists as blocked                                                                                |

### The Phase 8 exit criterion

> A Claude/Codex/Hermes CLI running persistently in Herdr can appear in the
> Fabric fleet and be surfaced/controlled with declared capability limits.

Against the snapshot, with the server on it and Herdr absent:

```text
discover: available=false candidates=0
  reason: herdr is not installed on this environment. Install it where the
          terminals are, or adopt sessions by hand.

adopted herdr:ops:hermes-1: state=working runtime=herdr
  capabilities: readConversation=false sendInput=true approvals=false
                diffs=false stop=true showTerminal=true

fleet:
  with a working pane:        work state=working    needsUser=false threads=0 adopted=hermes:working
  after herdr says blocked:   work state=needs_input needsUser=true  threads=0 adopted=hermes:needs_input

sendInput: delivered=false
  detail: herdr is not installed on this environment. …

unknown state: refused
  after the refusal: work state=needs_input needsUser=true adopted=hermes:needs_input
```

So: **appearing in the fleet with declared capability limits is proven**, and
with a work session that has no thread of Fabric's own — the adopted terminal is
the only thing running, and the fleet says what it is doing. What is not proven
is the half that needs the runtime: a real Herdr pane, discovered rather than
registered by hand, and input actually delivered to it.

### Not proven in Phase 8

- **Herdr is not installed on this box**, so nothing has been discovered from a
  real runtime and nothing has been typed into a real pane. Both paths end in a
  refusal that names the missing runtime, which is the honest answer and is
  itself proven.
- **No raw terminal surface.** Showing a terminal is a desktop client's job, and
  Phase 6 already lists the desktop pieces as blocked on a session this box does
  not have.
- **One runtime.** `AdoptedRuntime` has a single member; a second is a contract
  change rather than a value somebody invents.
- **No UI.** The fleet carries adopted sessions and the entry's state accounts
  for them, so they already move the "Needs me" count on both clients; neither
  client renders an adopted row of its own yet.

## Phase 10 — the capability plane, and hardening

| Item                           | State                                                   | Where it is proven, or what blocks it                                                                                                                                                                                                                       |
| ------------------------------ | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Capability registry and policy | done                                                    | `packages/contracts/src/fabric/capability.ts`, `packages/shared/src/fabricCapabilityPolicy.ts` — §23's twelve capabilities, §24.1's classes, and one evaluation everything goes through. The capabilities themselves are deliberately not implemented (D41) |
| Production policy templates    | done                                                    | development, supervised and production; production switches high-risk capabilities **off** rather than gating them, because the confirmation would be a tap on a phone in a taxi (D42)                                                                      |
| Retention settings             | done                                                    | `packages/shared/src/fabricRetention.ts`, applied to the intent log where it grows rather than on a timer (D43)                                                                                                                                             |
| Audit log                      | done                                                    | `packages/shared/src/fabricAudit.ts` — a view over the records that already exist, never a fourth table (D44)                                                                                                                                               |
| Schema migration testing       | done                                                    | `apps/server/src/persistence/FabricMigrationsAdditive.test.ts` — D7 as a test: no Fabric migration may drop, rename or rewrite anything, or touch a table Fabric does not own                                                                               |
| Reconnect / offline resume     | **partial**                                             | against the snapshot: a connection dropped and remade returns identical fleet state, and two clients at once agree. A _mid-turn_ disconnection and a phone resume still need a client that can be backgrounded                                              |
| Performance profiling          | done, at this scale                                     | `fabric.fleet.get` over the real snapshot: **min 18ms, median 26ms, max 40ms** for 10 work sessions. Recorded rather than assumed; it is not a load test                                                                                                    |
| Observability                  | **already upstream**                                    | every `fabric.*` handler goes through `observeRpcEffect` with `rpc.aggregate: "fabric"`, so Fabric's RPCs appear in the same traces and metrics as T3's                                                                                                     |
| Upstream rebase workflow       | done                                                    | `UPSTREAM.md`'s conflicts table regenerated from `git diff --name-only` at Phase 10: every upstream file this fork edits is listed, and everything else it contributes is a new file                                                                        |
| Security review                | done, as a review                                       | below                                                                                                                                                                                                                                                       |
| Machine capability integration | **partial**                                             | the policy is per-environment and the mode is a property of the environment; binding a policy to each machine in the registry needs the machine registry work §5.6 describes, which no phase has built                                                      |
| Reconnect chaos testing        | **blocked**: needs a client that can be killed mid-turn | the connection-level case is proven; the turn-level case is not                                                                                                                                                                                             |

### The security review

What Fabric adds to T3's surface, and what holds it:

- **Every `fabric.*` RPC has a declared auth scope**, and the scope map's key set
  must equal the RPC group's — an unscoped method does not compile
  (`RpcAuthorization.test.ts`).
- **No secret is read, written or forwarded by Fabric code.** The provider
  credentials stay where T3 put them; nothing under `fabric/` opens a credential
  file, and §30.14 is checked by the diff on every PR.
- **Three boundaries are client-local by construction**, so the environment
  cannot receive what it has no business having: the context bus (D24, D32),
  dictated text (D31), and the browser's page content (§17, enforced by the
  contract's shape rather than by a policy).
- **A sentence never authorises a high-risk action** (D28), and §24.1's list is
  matched before intent classification so routing through an agent is not a way
  around it.
- **Automation is bounded**: rules have a durable firing bound, cannot be
  triggered by their own effect, and fire on a transition rather than while a
  state persists (D20, D29, D30).
- **Adopted sessions declare what Fabric may not do to them** (D39), so a
  terminal Fabric does not own cannot be typed into by accident.

What the review did **not** cover, and should before daily use: a dependency
audit of the fork against upstream, a look at the pairing/token lifetimes T3
ships with, and a second pair of eyes on the WebSocket authentication path,
which Fabric inherits unchanged and did not test.
