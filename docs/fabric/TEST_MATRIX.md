# Test matrix

Specification §35 as a checklist. Every row names the phase that owns it and, once it exists, the
file that proves it. A row with no file is not tested, whatever the surrounding code looks like.

Status values: **done** (file named, passing), **partial** (some cases, gap stated), **open**,
**blocked** (with the blocker named).

## How tests are written in this tree

Upstream's rules, which Fabric inherits:

- `vp test run <files>` for the tests you touched. Never the repo-wide suite; CI owns that.
- Test meaningful logic or observable behavior. Do not render components to static markup to assert
  props or attributes, and do not add tests that merely assert callback wiring or mirror the
  implementation.
- The server is event-sourced and its async flows emit typed receipts. **Wait on receipts and
  worker drains, never on sleeps or polling** (`packages/shared/src/DrainableWorker.ts`,
  `apps/server/src/orchestration/Layers/RuntimeReceiptBus.ts`). A test that needs a timeout to pass
  is wrong.
- Backend behavior changes ship with focused tests for that behavior.
- Never run a test server against `~/.t3/userdata`. Snapshot it with `VACUUM INTO` — see
  `UPSTREAM.md`.

One Fabric-specific rule: a test may not assert a number the code under test just produced. A
timeline test asserts the ordering and the transitions, not "the synopsis said what the synopsis
said".

## Unit

| #    | Case                                                                                                                                    | Phase | Proven by                                                                                                                                                                                       | Status |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| U1   | WorkSession lifecycle: create → active → archived, and the illegal transitions                                                          | 2     | `apps/server/src/fabric/WorkSessionService.test.ts`                                                                                                                                             | done   |
| U2   | Attach an existing thread to a WorkSession; attaching twice is idempotent; attaching a thread that already belongs elsewhere is refused | 2     | `WorkSessionService.test.ts`                                                                                                                                                                    | done   |
| U3   | A WorkSession survives its provider thread ending — the §29 Phase 2 exit criterion, as a unit case over the domain                      | 2     | `WorkSessionService.test.ts`, "the work session outlives its provider thread ending"                                                                                                            | done   |
| U4   | Archive/settle a WorkSession independently of thread state, and the reverse state (unarchive) exists                                    | 2     | `WorkSessionService.test.ts`, "settling and archiving are separate, reversible" and "archiving is independent of the thread"                                                                    | done   |
| U5   | Provider-session timeline: ordering, overlapping parallel sessions, a session that ends without a successor                             | 2     | `WorkSessionService.test.ts` (re-attach keeps both stretches; review beside implementation); `apps/web/src/fabricWorkSessionGrouping.test.ts` (ordering and history)                            | done   |
| U5a  | The client's fold of snapshot + events into the rendered list                                                                           | 2     | `packages/client-runtime/src/state/fabricWorkSessions.test.ts`                                                                                                                                  | done   |
| U6   | Handoff capsule generation: required fields present, transcript not dumped wholesale, secrets never included                            | 3     |                                                                                                                                                                                                 | open   |
| U7   | Handoff rollback when the target provider fails to launch — the WorkSession returns to its prior state, the source session stays usable | 3     |                                                                                                                                                                                                 | open   |
| U8   | Context/routing priority: the §14 ladder, each rung tested including the tie-breaks                                                     | 5–6   |                                                                                                                                                                                                 | open   |
| U9   | State normalization: provider states → `FabricSessionState` (§10), including the priority order of sources                              | 4     | `packages/contracts/src/fabric/sessionState.test.ts` — reachability first, approvals over a running session, failure over lingering background liveness, `limited` only when nothing is running | done   |
| U9a  | Herdr states folded into the same normalization                                                                                         | 8     |                                                                                                                                                                                                 | open   |
| U10  | Voice intent parsing: dictate vs message vs status vs approve, and the deterministic grammar before any model is consulted              | 5     |                                                                                                                                                                                                 | open   |
| U11  | Risk policy: §24.1 classification, and that a wake word alone never authorizes a high-risk action                                       | 5     |                                                                                                                                                                                                 | open   |
| U12  | Synopsis staleness: age calculation, what counts as a refresh, and that a stale synopsis is labelled rather than silently served        | 4     | `fabricSynopsis.test.ts` (a no-op signal does not move the clock), `fabricFleetView.test.ts` (the row says "(stale)"), `fabricSpokenStatus.test.ts` (the spoken answer says how old it is)      | done   |
| U12a | Deterministic synopsis updates for every §11.1 trigger, and the event→signal mapping                                                    | 4     | `packages/shared/src/fabricSynopsis.test.ts`, `apps/server/src/fabric/SynopsisReactor.test.ts`                                                                                                  | done   |
| U12b | The fleet builder: ordering, parallel threads, a thread that is gone, offline, limited, and the server/client `done_unseen` difference  | 4     | `packages/shared/src/fabricFleet.test.ts`                                                                                                                                                       | done   |
| U12c | §20 spoken status, including the specification's own example sentence                                                                   | 4     | `packages/shared/src/fabricSpokenStatus.test.ts`                                                                                                                                                | done   |
| U12d | The §33 fleet row and the "Needs me" filter                                                                                             | 4     | `apps/web/src/fabricFleetView.test.ts`                                                                                                                                                          | done   |
| U13  | Orchestration rules terminate: a rule cannot trigger itself, and a bounded chain is enforced rather than hoped for                      | 9     |                                                                                                                                                                                                 | open   |

## Integration

| #   | Case                                                                                                                                               | Phase | Proven by                                                                                                                                          | Status                                                                           |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| I1  | Two provider instances with different `CLAUDE_CONFIG_DIR`s stay distinct — separate sessions, separate identities, no credential crossover         | 3     |                                                                                                                                                    | blocked: only one Claude account is currently logged in on the box (`STATUS.md`) |
| I2  | WorkSession persistence survives a server restart, read back from SQLite, not from memory                                                          | 2     | Two separate processes against a migrated snapshot of the real database; see `STATUS.md` Phase 2                                                   | done                                                                             |
| I3  | Migration rehearsal: a `VACUUM INTO` snapshot, the migration applied, row counts before and after, and a pre-migration build still opening it (D7) | 2+    | `migrate-dev-db` on a real snapshot (18 → 21 tables, no existing schema changed) plus a migrator pinned to 53 reading the migrated file            | done                                                                             |
| I4  | A remote T3 environment's WorkSessions appear in the client's fleet and disappear cleanly when it disconnects                                      | 4     |                                                                                                                                                    | open                                                                             |
| I5  | Codex as the provider inside a WorkSession, including Codex's async-question path                                                                  | 3     |                                                                                                                                                    | open                                                                             |
| I6  | Provider limit and error handling: an exhausted account moves the WorkSession to `limited` rather than losing it (§31 Scenario E)                  | 3–4   |                                                                                                                                                    | open                                                                             |
| I7  | Worktree handoff: the target provider starts in the same intended worktree, and refuses rather than silently using another checkout                | 3     |                                                                                                                                                    | open                                                                             |
| I8  | VS Code context bridge reports workspace, remote authority, branch and terminal, and resolves to the right WorkSession                             | 6     |                                                                                                                                                    | open                                                                             |
| I9  | Browser dictation bridge inserts into a focused editable field and sends nothing to any agent                                                      | 6     |                                                                                                                                                    | open                                                                             |
| I10 | Herdr adapter: discovery, state mapping, adopted session with declared reduced capabilities                                                        | 8     |                                                                                                                                                    | open                                                                             |
| I11 | Capability advertisement: a client that does not see `fabricWorkSessions` renders the stock sidebar and calls no `fabric.*` RPC (D14)              | 2     | The gate is in `Sidebar.tsx` (`fabricWorkSessionEnvironmentIds`); no test drives a client against a capability-less server                         | open                                                                             |
| I12 | Every `fabric.*` RPC has a declared auth scope                                                                                                     | 2     | `apps/server/src/auth/RpcAuthorization.test.ts` — the key set must equal the RPC group's, so an unscoped method is a type error and a failing test | done                                                                             |

## End-to-end topology

The specification's minimum lab (§35):

```text
Client machine   T3/Fabric desktop · voice service · browser · VS Code
Server A         T3 server · Claude A · Claude B · Codex · test repo
Server B         T3 server · Claude C or Codex · test repo
Phone            T3/Fabric mobile
```

Available on this box today: two Linux environments and a phone client. Server A's second and third
Claude accounts, and the desktop client's voice service, arrive with their phases.

| #   | Case                                                                                                            | Phase | Status                                                                                                                                                                     |
| --- | --------------------------------------------------------------------------------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E1  | Disconnect and reconnect a client mid-turn; work continues server-side and the client resumes the correct state | 2–4   | open                                                                                                                                                                       |
| E2  | Server restart with work in flight                                                                              | 2     | partial — persistence across a process restart is proven on real data (I2); a running server was not restarted under load, because the box was at load 47 with 5.5 GB free |
| E2a | The Work block rendered in a real client                                                                        | 2     | done — Playwright against the built client on the snapshot database; `frames/phase-2/`, no console errors                                                                  |
| E2b | The Fleet and its "Needs me" filter rendered in a real client                                                   | 4     | done — same walk; `frames/phase-4/`, the filter clicked and the list reduced to the blocked row                                                                            |
| E2c | `startThread` against a real provider subscription, one turn                                                    | 2     | done — Claude Max, `origin: created` on the timeline, the assistant answered; `STATUS.md` Phase 2                                                                          |
| E2d | The fleet answers the five Phase 4 questions with two threads in different states                               | 4     | done — one thread completed, one left at `needs_approval`; `STATUS.md` Phase 4                                                                                             |
| E3  | Phone background → foreground, including a long suspension the OS did not report                                | 7     | open                                                                                                                                                                       |
| E4  | Provider process exits unexpectedly; the WorkSession does not                                                   | 2–3   | open                                                                                                                                                                       |
| E5  | Account handoff end to end, with the old thread still inspectable                                               | 3     | blocked: I1's blocker                                                                                                                                                      |
| E6  | Laptop sleep and network loss                                                                                   | 4     | open                                                                                                                                                                       |
| E7  | Duplicate client connections to one environment                                                                 | 4     | open                                                                                                                                                                       |
| E8  | Stale synopsis is shown as stale, not as current                                                                | 4     | open                                                                                                                                                                       |
| E9  | Voice ambiguity: a clarification is asked only when the ambiguity is material                                   | 5     | open                                                                                                                                                                       |
| E10 | Orchestration rule fires once and stops — no ping-pong (§31 Scenario G)                                         | 9     | open                                                                                                                                                                       |

## V1 definition of done

§30's fifteen criteria are the release gate, not this matrix. Two of them are testable from the
first phase onward and are checked on every PR rather than at the end:

- **§30.15** — no live T3 userdata was used as a writable dev database. Checked by the home
  directory each proof ran against being named in the PR.
- **§30.14** — no provider auth secret is copied to a client to make something work. Checked by the
  diff: nothing under `fabric/` reads a credential file or forwards one over the wire.
