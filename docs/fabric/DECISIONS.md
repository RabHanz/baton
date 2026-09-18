# Decisions

Every deviation from the build specification, and every choice the specification left open, with
the reason. Newest last. A decision that later turns out wrong is superseded by a new entry rather
than edited, so the reasoning stays legible.

The specification these refer to is the Fabric implementation document dated 2026-09-18; section
numbers below are its sections.

---

## D1 — §0 rule 2 means "subscription, not API"

**Decided** 2026-09-17 by the Director. **Recorded** 2026-09-18.

Rule 2 reads "Do not replace interactive Claude Code subscription sessions with the Claude Agent SDK
or `claude -p`." Taken literally it forbids the transport T3 already uses, which would mean forking
T3's Claude adapter on day one — the exact thing rule 1 forbids.

The Director's clarification: the rule protects **the subscription**, not a particular process
shape. What must never happen is Fabric quietly moving his work onto metered API billing or onto a
harness that is not his real Claude Code.

Upstream satisfies that reading. `apps/server/src/provider/Layers/ClaudeAdapter.ts` drives
`@anthropic-ai/claude-agent-sdk` with `pathToClaudeCodeExecutable` pointed at the user's installed
`claude` binary, and `apps/server/src/provider/Drivers/ClaudeHome.ts` sets `CLAUDE_CONFIG_DIR` (not
`HOME`) so the spawned CLI finds the OAuth credentials that `claude auth login` wrote. The
signed-out message names both paths — subscription login, or an instance's configured API
credentials — so the distinction is explicit in upstream's own code.

**Consequence:** Fabric uses T3's provider transport unchanged. What Fabric must guard is
configuration: an instance configured with an API key is a different economic object from one
configured with a subscription login, and any Fabric surface that offers "continue with…" must show
which it is before the user picks. Nothing in Fabric may set `ANTHROPIC_API_KEY` in a provider
environment.

---

## D2 — T3's preview browser is Fabric's shared browser

**Decided** 2026-09-18.

The specification (§23 capability plane, §17 browser extension) assumes browser/computer use is a
capability Fabric will have to supply. It already exists upstream and is better than what was
planned.

`apps/server/src/mcp/toolkits/preview/tools.ts` publishes fourteen `preview_*` MCP tools to any
provider thread. The browser is a Chromium `<webview>` hosted by the desktop app; cookie jars are
**browser profiles** (`packages/contracts/src/browserProfile.ts`) — named partitions, up to 24,
`persistent` or `incognito`, client-local and bound to no provider and no account.

That last property is the whole point. One logged-in profile serves Claude A, Claude B, Claude C and
Codex alike. The browser-hopping the Director described — a different browser per account to keep
sessions apart — stops being necessary.

**Consequence:** Fabric builds no browser and no per-account cookie mechanism. §23's browser
capability is "register the existing preview toolkit", not "implement". The limitation to record and
surface honestly: the desktop app must be running, because it hosts the webview; web and mobile
clients cannot host one. Fabric's machine registry (§5.6) therefore carries
`browser-computer-use` as a capability of a _machine with a desktop client attached_, not of every
environment.

---

## D3 — Claude in Chrome stays, for the flows that need a real browser fingerprint

**Decided** 2026-09-18.

D2 does not retire the Claude-in-Chrome extension bridge. A Chromium webview on a headless server is
the wrong tool for a sign-up, a bank portal, or any flow that is sensitive to residential IP and
device fingerprint; those want the operator's own browser on his own machine.

So there are two browser surfaces with a clear rule between them:

| Flow                                                                                 | Surface                    |
| ------------------------------------------------------------------------------------ | -------------------------- |
| agent research, scraping, checking a page an agent just built, recorded walkthroughs | T3 preview browser (D2)    |
| sign-ups, logins to sensitive accounts, anything judged on IP or device fingerprint  | the operator's own browser |

Fabric's job is to make the second reachable from a WorkSession rather than replacing it. The
mechanism is deferred to Phase 6 or later: a bridge that exposes the operator's real browser to a
thread as a second MCP toolkit, alongside `preview_*`, with a different name so an agent cannot
confuse them. Nothing is built for this before Phase 6, and it is explicitly _not_ on the V1 path.

---

## D4 — Herdr is integrated, never copied

**Decided** 2026-09-18, following §36.

Herdr (`SuperCodeAgents/herdr-terminal`) is AGPL. T3 Code is MIT and the Director intends to keep
the fork publishable and possibly open-source it. Copying AGPL source into an MIT tree would relicense
the tree.

**Consequence:** the Phase 8 adapter talks to Herdr over its socket/CLI control surface as a separate
process. No Herdr source is vendored, no Herdr code is adapted, and Fabric's dependency on it is
optional — an environment with no Herdr running loses adopted sessions and nothing else. `.repos/`
in this tree is upstream's vendored read-only reference directory; Herdr does not go there either.

---

## D5 — Phase order 0 → 2 → 3 → 4 → 9 → 5 → 6 → 7 → 8 → 10

**Decided** 2026-09-17 with the Director, who asked for every phase, all functional.

Phase 1 is already done by configuration (`STATUS.md`), so the build starts at 2. The two departures
from the specification's numeric order:

**9 (orchestration) before 5 (voice).** Voice's hardest problem is not transcription, it is knowing
what the utterance refers to. "Tell Codex to review it" needs a WorkSession that has a timeline, a
current provider session, a state, and a rule engine that can express "after this, that". Phases
2–4 and 9 build exactly those. Bringing 5 forward would mean building intent routing against a
domain that cannot yet answer the questions the intents ask, and then rebuilding it. Orchestration
is also usable by keyboard the day it lands, which voice is not.

**8 (Herdr) last but one.** Adopted sessions are the lowest-fidelity members of the fleet — Fabric
cannot recover structured conversation state from a raw PTY, so they arrive with reduced
capabilities. Landing them after the fleet model is settled avoids designing the fleet around its
weakest member.

10 stays last because it hardens what exists.

---

## D6 — Extend T3's domain in place; no `packages/fabric-*`

**Decided** 2026-09-18. **Deviates from** §27's suggested layout.

§27 suggests `packages/fabric-domain`, `fabric-runtime`, `fabric-voice`, `fabric-context`, and then
says: "Where T3 already has a domain/service that naturally owns a concern, extend that instead of
creating duplicate packages." §38 says the same in decision-heuristic form. For the server-side
concerns, T3 already owns every one of them:

- wire contracts → `packages/contracts`, which is where the RPC boundary and every persisted schema
  lives, and where `WsRpcGroup` is assembled;
- durable state → `apps/server/src/persistence`, whose migrations are statically imported from one
  manifest, so a Fabric table in another package would still have to register there;
- client state shared by web and mobile → `packages/client-runtime`, which exists specifically so
  reconnect and multi-environment behavior do not diverge between clients.

A parallel `packages/fabric-domain` would either import all three or duplicate them, and would make
every upstream rebase a three-way merge across package boundaries.

**Consequence:** Fabric server and contract code lives in the existing packages, in directories named
`fabric/` inside them (`packages/contracts/src/fabric/`, `apps/server/src/fabric/`, and so on), so
the Fabric diff is still greppable as a patch series. The §27 packages that do **not** have a natural
upstream owner — the desktop voice sidecar, the OS context bus, the VS Code and browser extensions —
are genuinely separate, because §38 says native OS integrations must not run on remote servers. Those
arrive in Phases 5 and 6 as their own packages.

---

## D7 — "Reversible migration" means a rehearsed snapshot, because upstream migrations are forward only

**Decided** 2026-09-18.

`apps/server/src/persistence/Migrations.ts` runs Effect's `Migrator` over a static list of numbered
migrations and records applied ids in `effect_sql_migrations`. There is no `down` step anywhere in
the tree, and adding one would be a structural change to upstream's persistence layer for Fabric's
convenience.

**Consequence:** Fabric does not invent a rollback mechanism. Its reversibility discipline is:

1. every Fabric migration is additive — new tables, new nullable columns, new indexes. No column is
   dropped, renamed, or retyped; no existing row is rewritten except by an explicitly reviewed
   backfill;
2. a server built _before_ the migration must still open a database the migration has touched. That
   is what additive buys, and it is the actual rollback path: reinstall the older build;
3. each migration ships with a rehearsal recorded in the PR — a `VACUUM INTO` snapshot of a
   realistic database, the migration applied to the snapshot, the row counts before and after, and
   the older build opening the same snapshot afterwards;
4. anything that cannot be additive gets its own entry here, with what breaks and why it was
   unavoidable, before it is written.

---

## D8 — Fabric ships behind two flags, both of them upstream's

**Decided** 2026-09-18. **Superseded by D14** the same day, once it was built.

Upstream already solves "a new client is talking to an old server". `ExecutionEnvironmentCapabilities`
in `packages/contracts/src/environment.ts` is a struct of optional booleans the server advertises in
its descriptor; clients hide a feature whose capability is absent rather than probing an RPC that
does not exist. Every entry there carries a comment stating the skew contract, and
`docs/internals/overview.md` documents the pattern with the pull-request linking rollout as its
worked example.

**Consequence:** Fabric's development flag is a capability key plus a server setting, not a build
constant and not an environment variable:

- `ExecutionEnvironmentCapabilities.fabricWorkSessions` — advertised only when the server both
  supports and has enabled the feature. A client that does not see it renders the ordinary T3
  sidebar and never calls a `fabric.*` RPC;
- a `ServerSettings` entry — the operator's switch, persisted per environment.

Fabric RPCs remain registered on the server whether or not the flag is on; the flag governs
advertisement and client behavior. Registering conditionally would make the RPC group's shape depend
on runtime state, and `RPC_REQUIRED_SCOPES` is keyed off that group's type.

---

## D9 — A WorkSession belongs to one environment in V1

**Decided** 2026-09-18.

The specification's §5.4 gives WorkSession an `environmentAffinity[]`, which reads as though one
WorkSession spans machines. Upstream's `docs/internals/remote.md` is explicit that a project and its
threads belong to one environment, that a repository identity can correlate clones across
environments but never routes work between them, and that saved connections are client-local while
server identity and state are not. There is no cross-environment durable store to put a shared
WorkSession in, and inventing one would mean a Fabric control plane above the environments — which
§0 rule 7 and §25 both push against, and which would become the single point whose failure hides
every machine's work.

**Consequence in V1:** a WorkSession is persisted by one environment and holds the provider sessions
running on it. `environmentAffinity` is retained in the schema with its §5.4 meaning narrowed to
"environments this work is _intended_ for", which is what handoff and machine-capability routing
need it for; it does not imply distributed ownership.

The fleet view the Director actually wants — everything, everywhere, in one list — is assembled
**client-side** in `packages/client-runtime` by merging each connected environment's WorkSessions,
which is exactly how the existing sidebar already merges projects across environments
(`apps/web/src/sidebarProjectGrouping.ts`). It works offline for cached environments, it degrades to
"that machine is unreachable" instead of to a blank list, and it needs no new trust boundary.

If cross-environment durable work identity is later required, it is a separate decision with its own
entry, and it needs an answer for which environment is authoritative during a partition.

---

## D10 — The fork's `main` stays a mirror of upstream `main`

**Decided** 2026-09-18.

Fabric work lands on `fabric/*` branches. The fork's `main` is fast-forwarded from `upstream/main`
and carries no Fabric commits of its own until a phase is deliberately frozen onto it.

The reason is rebase cost. §36 requires minimising divergence and rebasing regularly; a `main` that
has both upstream commits and Fabric commits interleaved makes every rebase a merge of two histories
instead of replaying a patch series onto a moved base. It also keeps the answer to "what has Fabric
changed?" available as a single diff against `upstream/main`.

The clone is a blobless partial clone (`--filter=blob:none`): full commit history, blobs fetched on
demand, `.git` under 100 MB instead of several hundred. Operations that need old file contents
(`git log -p`, `git blame`, checking out an old tree) need network.

---

## D11 — Fabric events are a live broadcast; they do not go in T3's event store

**Decided** 2026-09-18, during Phase 2.

§28 asks for `fabric.workSession.created`, `.updated`, `.statusChanged`, `.providerAttached` and the
handoff pair. The obvious home is T3's orchestration event log, which is the durable source of truth
for everything else in the domain. That would be wrong here, for two reasons.

**It would make a downgrade fatal.** `docs/internals/overview.md`: persisted events must remain
decodable on replay, and a schema change affects old environments at startup as well as live traffic.
`providers.md` records the precedent — file attachments introduced a replay compatibility limit where
an image-only server _failed the entire environment's startup_ replaying one such event. A stock T3
binary replaying a log containing `fabric.*` events would hit exactly that. Since Fabric's rollback
story is "run an older build against the same database" (D7), poisoning the shared event log would
remove the rollback.

**Nothing would read it back.** The durable timeline is the attachment rows: who ran the work, from
when, until when. An event log beside them would duplicate that and be read by nothing, which is a
stub with extra steps.

**Consequence:** `fabric.subscribeWorkSessions` streams a snapshot followed by events from an
in-process `PubSub`. Clients apply them without a refetch because each event carries the whole
record. The durable truth is `fabric_work_sessions` and `fabric_work_session_threads`, and a client
that reconnects gets a fresh snapshot rather than replaying anything.

If a durable Fabric audit trail is later needed — Phase 10 lists one — it gets its own append-only
table, not a place in `orchestration_events`.

---

## D12 — Phase 2's sidebar grouping is an additive Work block, not a re-parented thread list

**Decided** 2026-09-18. **Narrows** §29 Phase 2's "display WorkSession in sidebar/navigation".

The sidebar's thread list is not a list. It is a drag-and-drop sortable with pinned, active, snoozed
and settled sections, placeholder markers, a measured order key driving the motion pass, and drop
targets resolved against that exact item sequence (`Sidebar.logic.ts`). Threading work-session groups
through it means teaching every one of those about a new kind of row, and getting it wrong breaks
reordering in ways no unit test would catch.

So Phase 2 renders a **Work block above the thread list**: project, work, then account · host ·
status, behind the flag. The thread list underneath is untouched, and a thread appears in both. The
block is also the only place that can show what the thread list cannot — a work session whose
provider thread has ended, which is the entire point of the object.

Folding the thread list itself under work sessions is deferred, and it needs the sortable's item
model to grow a group concept first. This is recorded as a narrowing rather than done quietly,
because "the sidebar groups by work session" would otherwise read as more than what shipped.

---

## D13 — The attachment table is keyed on a surrogate, not on (work session, thread, attached_at)

**Decided** 2026-09-18, after a test failed.

The first cut of migration 054 keyed `fabric_work_session_threads` on
`(work_session_id, thread_id, attached_at)`, so that a thread detached and re-attached later kept
both stretches. The unit test covering that case failed with `UNIQUE constraint failed`: detach and
re-attach happen inside the same millisecond, and `DateTime.now` has millisecond resolution.

That is not a test artifact. A handoff is two RPCs in a row, not two seconds apart, so the natural
key would have rejected real work. The key is now a surrogate `id INTEGER PRIMARY KEY`, the timeline
orders by `(attached_at, id)` so equal timestamps order by insert, and the "one live attachment per
thread" rule stays where it was: a partial unique index on `thread_id WHERE detached_at IS NULL`.

Migration 054 was edited rather than superseded because it had never been applied outside this
worktree's throwaway database. Once a Fabric migration ships, D7's additive rule applies and a
correction is a new migration.

---

## D14 — Supersedes D8: the capability states what the server understands; the flag is a client setting

**Decided** 2026-09-18, during Phase 2.

D8 said Fabric would ship behind an environment capability _plus_ a server setting, with the
capability advertised only when the operator enabled the feature. Building it showed that is the
wrong shape on both counts.

Upstream capabilities are statements of fact about the build, not switches: every comment in
`ExecutionEnvironmentCapabilities` reads "server understands X", and clients use them to avoid
calling an RPC an older server does not have. Making one conditional on an operator toggle would
change what the field means for everybody reading it.

The server setting was also unbuildable as specified. `ServerEnvironment` is layered _beneath_
`ServerSettings` — settings may depend on the environment, not the other way round — so the
descriptor cannot read a setting without inverting that graph for a development flag.

**Consequence:**

- `capabilities.fabricWorkSessions` is `true` on any build that has these RPCs. A client that does
  not see it renders the stock sidebar and calls nothing `fabric.*`;
- the on/off switch is `ClientSettings.fabricWorkSessionsEnabled`, default false. What it gates is
  this client's navigation, which is what `docs/internals/overview.md` says a client preference is
  for.

The two gates answer different questions and both are needed: the capability answers "would this call
even work", the setting answers "does this user want it".

---

## D15 — `limited` comes from the provider's own quota report, and only when nothing is running

**Decided** 2026-09-18, during Phase 4.

§10 lists "explicit provider usage-limit responses" as the third source of state, and §31 Scenario E
wants an exhausted account to read as `limited` so the user is offered a handoff. Two questions had
to be settled to build that without guessing.

**What counts as exhausted.** Only a window the provider itself published at 100%
(`ServerProviderUsageLimits.windows[].usedPercent`). Not a failed turn, not an error message shaped
like a rate limit, not a heuristic on timing. An account that cannot report windows at all — an API
key, Bedrock — reports `unavailable` and so never reads `limited`, which is correct: we do not know.

**Whether a busy thread can be limited.** No. Quota is reported per _account_, and one account runs
several threads; a window at 100% while this thread's session is running means a sibling spent it.
So `limited` applies only when the provider is not busy. Getting this wrong would paint a working
session as blocked every time another thread used up the window.

`limited` sits below `failed` — a failure needs attention first — and above `idle`, because "idle"
would hide the reason the work stopped, and the reason is what tells the user a handoff is available.

---

## D16 — No model-generated synopsis in Phase 4, and what it would take

**Decided** 2026-09-18. **Narrows** §11.1 and the Phase 4 brief.

§11.1 permits semantic summarisation at milestones — after a turn settles, on handoff, after
substantial change — using the provider the session runs on. It is buildable: every provider instance
already exposes `textGeneration`, which is how T3 generates thread titles. It is not built, for two
reasons.

**It spends the Director's subscription on a cadence.** A summary per settled turn, across a fleet, is
a recurring cost on the thing his work depends on. His standing rule is bare-minimum spend without his
word, and a feature that quietly consumes quota while he is not looking is the wrong default even when
each call is cheap.

**The deterministic path already carries the load.** `currentAction`, changed files, validation
outcomes, findings from runtime errors, approvals and questions all come from events and cannot
hallucinate. What a model would add is a _nicer sentence_, and §11's own warning is that the synopsis
must never become authoritative over provider reality — so the nicer sentence is precisely the part
with the worst risk-to-value ratio.

**What is already in place for it.** `SynopsisSource` is `"events" | "model"` on both the record and
each finding, so generated text is distinguishable the moment it exists, and `SynopsisSignal` has a
`finding` variant that accepts `source: "model"`. Turning it on is a reactor that, on
`thread.turn-diff-completed`, calls the instance's `textGeneration` and feeds one `finding` signal —
plus a minimum interval and a setting, default off.

Recorded as a deviation rather than done quietly, because "the synopsis updates from events" would
otherwise read as the whole of §11.

---

## D17 — `done_unseen` is client knowledge, so the fleet takes it as an input

**Decided** 2026-09-18, during Phase 4.

"Finished, and you have not looked" needs to know when _this user_ last opened the thread. That is
client state: the environment was never told, and a server that guessed would be inventing.

The fleet builder therefore takes `lastVisitedAt` as a function. The server passes null, so its
`done_unseen` means "a turn completed and nothing has happened since". A client passes its own
last-visited store and gets the stricter, truer answer.

**Consequence:** the two can legitimately disagree, and only in one direction — the server may call
something unseen that this client has already seen, never the reverse. The alternative, teaching the
environment about per-user read state, is a new durable concept and a new privacy surface for a single
UI nicety. The same shared builder serves both, so nothing else about the two answers can drift.

---

## D18 — A synopsis write does not touch the work session's own `updatedAt`

**Decided** 2026-09-18, during Phase 4.

The synopsis moves on every tool call. A work session's `updatedAt` moves when the user changes the
work — renames it, attaches a thread, settles it. Letting a synopsis write bump the record's timestamp
would make "recently touched" meaningless, because whatever is running would always be the most
recently touched thing.

**Consequence:** `applySynopsis` writes the synopsis column and leaves `updated_at` alone, and it
publishes `fabric.synopsis.updated` rather than `fabric.workSession.updated`. The fleet orders by the
synopsis timestamp where there is one and falls back to the record's, so a running work session sorts
by activity and one nobody has run sorts by when it was last changed.

The client reducer follows: a synopsis event updates the record in place and does **not** move it to
the front. A list that reshuffles on every tool call is unreadable while anything is running.

A related trap, caught by a test: the "nothing moved, do not write" guard first compared timestamps,
which swallowed the opening update of a fresh synopsis whenever the signal's instant matched the empty
record's. Identity is the right test, because the reducer returns its input unchanged for a signal
that carried nothing.
