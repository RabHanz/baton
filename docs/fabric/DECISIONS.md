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

---

## D19 — The rule's action field is `action`, not `then`

**Decided** 2026-09-18, during Phase 9. **Deviates from** §22's YAML sketch.

§22 writes rules as `trigger: … then: …`, and the first cut of the contract used `then` verbatim. A
lint rule caught what that means in TypeScript: an object with a `then` property is **thenable**, so
`await rule` or a rule landing inside a resolved promise makes the runtime call `rule.then(...)`.
These objects cross an RPC boundary and land in promise-based client code, where exactly that
happens.

**Consequence:** the wire field is `action`. §22's vocabulary survives in the documentation and in
`describeRule`, which is where a human reads it; the property name is one a runtime cannot mistake
for a promise.

Recorded because the specification's own spelling was changed, and a reader comparing the two should
find the reason here rather than assume a typo.

---

## D20 — A sequenced rule fires once per predecessor completion, not once per evaluation

**Decided** 2026-09-18, after the first live run.

`after_rule` originally asked "has the predecessor completed?". That is true forever after the first
completion, so the rule fired on every subsequent event until `maxFirings` stopped it. The live proof
recorded `fired=3/3` on a notify rule that should have fired once.

The bound worked — nothing ran away, and the rule reported itself `exhausted` rather than going quiet
— but **a bound is a safety net, not a schedule**. A rule that relies on its limit to stop is a rule
whose limit is the only thing standing between the user and a runaway, and it burns the budget that
exists for real re-runs.

**Consequence:** a sequenced rule may fire only while its own firing count is behind the number of
times its predecessor has _completed_. One review completing releases one notification; a second
review releases a second. That is also what makes implement → review → fix → review work at all,
because the same rule has to be allowed to fire again for the right reason.

Worth stating plainly: the unit tests passed before this fix. The behaviour was only visible in a run
against a real provider, which is the argument for having one.

---

## D21 — A rule refuses to start a session on a provider that cannot run

**Decided** 2026-09-18, after the first live run.

The specification's sentence names Codex. This environment has a Codex provider _configured_ but no
`codex` binary installed, so the rule dutifully created a thread, the adapter failed to spawn, and
the work session's synopsis filled with a `spawn codex ENOENT` stack trace — a rule doing exactly
what it was told and producing nothing but noise.

**Consequence:** `startProviderSession` checks the instance registry before creating anything —
enabled, installed, and not marked unavailable — and the firing records `skipped` with the reason.
Not `failed`: "that account is not available on this environment" is a correct outcome, and calling
it a failure would train the user to ignore failures.

The general rule this instance of: **a rule's action should refuse early rather than create
wreckage.** Anything a rule can check before it acts, it checks before it acts.

---

## D22 — What a rule may do is a named service, not access to the engine

**Decided** 2026-09-18, during Phase 9.

The reactor could have been handed the orchestration engine and allowed to dispatch whatever it
liked. It is instead given `OrchestrationEffectsService`, whose whole surface is three methods: start
a provider session, message the active implementation thread, record a notification.

The reason is auditability under change. §22's limit — a graph over work sessions, not unrestricted
agent self-replication — is not enforceable by intention; it is enforceable by the list of things the
code can call being short and living in one file. A future phase that wants a rule to push a branch
has to add a method, and that shows up as a diff somebody reviews.

**Consequence:** rules cannot archive, delete, settle, push, or touch a work session other than their
own, because there is no method for it. The notification action writes to the work session's synopsis
rather than inventing a second delivery mechanism, so a rule's message reaches the fleet and the
spoken status through the path those already read.

---

## D23 — `after(rule)` is built; `after(time)` is not

**Decided** 2026-09-18, during Phase 9. **Deviates from** the Phase 9 brief, which names the trigger
set as `on_done, on_needs_user, on_failed, after(rule|time)`.

The three event triggers and `after_rule` ship. A time trigger does not, and the gap is deliberate
rather than forgotten.

Everything else in this phase is a **reactor**: something happened, a state was recomputed from
recorded facts, a rule was asked whether it may fire. A time trigger is a **scheduler**, and it does
not fit any of the three safety properties as they are written:

- `shouldFire` is arithmetic over recorded facts. A clock is not a recorded fact, so a time trigger
  needs the clock injected and the decision stops being replayable from the database alone.
- The loop check compares the changed thread against the threads a rule's own firings produced. A
  timer changes no thread, so that check has nothing to read and a timed rule would need a different
  guard against re-entry.
- The reactor only wakes on domain events. A timed rule needs its own wake-up, which is a durable
  timer surviving restart — real work with its own failure modes, and not something to bolt on
  unnoticed inside a phase about not running away.

None of §22's own sentences — the ones this phase's parser must handle, including the specification's
worked example — uses a time. Building a scheduler with no caller, in the phase whose entire subject
is "rules must terminate", is the wrong trade.

**Consequence:** `after(time)` is named in `STATUS.md`'s not-built list and stays there until a
sentence needs it. When it arrives it gets its own guard, not a share of `after_rule`'s.

---

## D24 — No speech in the fork: it owns everything after the text exists

**Decided** 2026-09-18, during Phase 5. **Narrows** §29 Phase 5, which lists microphone
enumeration, a wake provider, VAD, STT, TTS and a HUD.

The Director already dictates all day, from three different places: iOS dictation on the phone,
Wispr Flow on the laptop, and a DJI receiver through his own speech-to-text. Every one of them puts
**text into a focused field**. Building a fourth speech pipeline inside the environment would add a
microphone it cannot reach — the server runs on a box in a rack — and would make the phone's words
mean something different from the laptop's.

So the boundary is the string. `fabric.intent.*` takes text and nothing else, and there is no audio
code in this repository. What §29 Phase 5 calls the voice service is a **client** concern, and the
client that exists today is a text input in the sidebar.

**Consequence:** the spoken reply is plain text on the wire; whatever the client has — iOS speech
synthesis, the OS voice, nothing at all — says it. Nothing in the fork needs a speech vendor, a
model, or a licence, and a phone, a laptop and a keyboard are the same input as far as the
environment is concerned.

What this does **not** cover, and is therefore not done: wake words, hands-free activation,
conversation windows, and the §12.3 mode machine. Those are real Phase 5 tasks and they live in the
client that owns the microphone.

---

## D25 — The event family is `fabric.intent.*`, not §28's `fabric.voice.*`

**Decided** 2026-09-18, during Phase 5. **Deviates from** §28's sketch, which names
`fabric.voice.targetChanged`, `fabric.voice.commandAccepted` and `fabric.voice.commandRejected`.

Given D24, "voice" would be the wrong word in the log: the same sentence arrives from dictation, a
phone, a keyboard, and one day a wake word, and naming the family after one transport misdescribes
every other one. The events are `fabric.intent.received`, `fabric.intent.resolved` and
`fabric.intent.refused`.

`targetChanged` has no counterpart yet because there is no conversation window to hold a target
between utterances — that belongs with the client that owns the microphone.

---

## D26 — §14's ladder stops where the environment's knowledge stops, and a named target never falls back

**Decided** 2026-09-18, during Phase 5.

§14 lists nine rungs of context resolution. An environment can honestly climb three of them: the
explicit target in the sentence (rung 1), what the client says is focused (rung 3, and only because
the client passes it), and the work that moved most recently (rung 6). Rungs 2, 4 and 5 are desktop
facts — the voice conversation's target, the VS Code session, the focused editable field — that this
process has never been told, and rung 8 is a semantic resolver, which D-by-default means a model.

The ladder therefore stops rather than guessing, and one rule makes the difference between useful
and dangerous: **a target the user named and the grammar cannot place is a refusal, never a fall
back to what is focused.** A pronoun falls back; a name does not. The failure that prevents is
specific — a message meant for one account landing in another because the resolver quietly decided
the user must have meant the thing on screen.

**Consequence:** "tell it to stop" uses the focused work, "tell the deploy pipeline to stop" is
refused by name when there is no such work, and rung 9's clarification is asked only when two
candidates genuinely match.

---

## D27 — Resolving and running are separate methods, because previewing must not need permission to act

**Decided** 2026-09-18, during Phase 5.

The input shows what a sentence will do before the user presses enter. That preview is not
decoration; on a surface fed by dictation it is the confirmation step. It runs while the user is
still typing, which means it must be free of side effects and cheap enough to call on a debounce.

Two RPCs rather than one flag: `fabric.intent.resolve` carries the **read** scope and writes
nothing — not even to the intent log — and `fabric.intent.run` carries the **operate** scope
because what it does depends on the sentence. The scope cannot depend on the words: a read-only
client must not be one phrasing away from starting a provider session.

---

## D28 — A sentence never authorises a high-risk action, and the §24.1 list is recognised by name

**Decided** 2026-09-18, during Phase 5. **Stricter than** §24.2, which allows a high-risk request
through an explicit confirmation surface or a narrow preauthorisation.

Neither of those exists yet, so the honest V1 is a refusal. What matters more is _how_ it refuses:
§24.1's HIGH list — production deploys, restarting production services, merging a protected branch,
destructive database work, credentials, purchases — is matched **before** anything else in the
grammar, and named back.

The reason is that the alternative is worse than a refusal. An unparsed "deploy to production" would
come back as "I could not place that", which invites rephrasing until something sticks; and the same
words inside a message — "tell VentureOS to deploy to production" — would otherwise resolve as a
perfectly ordinary low-risk message to an agent. Routing through an agent must not be a way around
the rule, so the risk check runs before the intent check.

**Consequence:** a sentence can start a session, message one, create a bounded rule and answer a
question. It cannot deploy, merge, drop, rotate or buy, and it says so in those words.

---

## D29 — Answering a question must not re-ask it

**Decided** 2026-09-18, after the Phase 5 live run. **Amends** Phase 9's confirmation path.

Answering a `confirmation_gate` re-evaluates the work session, on purpose: that is what releases
whatever was sequenced behind the question. In the live run it also re-fired the gate's own rule —
the work session's state had not changed, so the rule matched again — and a second
`awaiting_confirmation` appeared in the same second the first was answered. Left alone, the user
answers the same question three times and the rule then reports itself exhausted.

**Consequence:** the evaluation caused by an answer skips the rule that asked. `evaluate` takes a
`skipRuleId`, and both confirmation paths — the RPC and the spoken one — pass the answered firing's
rule.

**The general case is still open, and is recorded here rather than quietly fixed.** A state-triggered
rule fires whenever it is evaluated in a matching state, not only when the state _changes_ into a
match. An idle work session receiving three unrelated thread events can therefore fire an `on_done`
rule three times, up to its bound. The bound contains it — nothing runs away — but D20 already says
what a bound is: a safety net, not a schedule. The fix is a per-work-session record of the last
observed state so a rule can fire on the transition, and it is a Phase 9 amendment with its own
migration, not something to bolt on at the end of this one. It is in `STATUS.md`'s not-proven list.

---

## D30 — A trigger names a transition, not a condition

**Decided** 2026-09-18. **Closes** the general case D29 left open, and completes the argument D20
started.

`on_done` means "when this finishes". It does not mean "while this is finished". Until now the
reactor asked the second question: every evaluation in a matching state fired every matching rule,
so a work session sitting idle re-fired its `on_done` rules on each unrelated thread event until the
bound stopped them. Nothing ran away — that is what the bound is for — but D20 already named this
shape and rejected it: **a bound is a safety net, not a schedule.** The same reasoning that made a
sequenced rule fire once per predecessor _completion_ makes a state-triggered rule fire once per
_entry_ into the state.

Concretely, in migration 058 and `shouldFire`:

- The reactor records the state it last saw each work session in, one row per work session, before
  anything fires. Durable rather than in memory for the reason the firing count is durable: a
  restart would otherwise call every already-matched state a fresh transition, and a restart is when
  a runaway does the most damage.
- A state-triggered rule fires when the work session **entered** the matching state. While the state
  persists it is refused with `state_unchanged`.
- **One exception, and it is deliberate:** a rule that has never fired may act on a state it finds
  already true. "When this finishes, have it reviewed", said about work that has just finished, has
  to do something; only its second firing waits for a new transition.
- `after_rule` is untouched. Sequenced rules are released by their predecessor completing (D20), not
  by a state change, and nothing here changes that.

**Consequence:** the bound stops meaning "how many times this will happen" and goes back to meaning
what it should — the last line of defence. `maxFirings` 3 now bounds three genuine finishes rather
than three arbitrary evaluations, and D29's `skipRuleId` remains as the narrower, explicit guard on
the one path that re-evaluates as a direct result of a user's answer.

---

## D31 — Dictated words never reach an environment

**Decided** 2026-09-18, during Phase 6. **Reads together with** §12.3, §18 and §26.

"Dictate: thanks, I'll send the revised contract tomorrow" is an email to
somebody else. It is not work, it is not a prompt, and a Fabric environment has
no business receiving it, resolving it, or keeping it in an intent log that
outlives the sentence.

So dictation is classified **on the client, before anything is sent**
(`packages/shared/src/fabricDictation.ts`), and only what is left travels. The
environment's own grammar still recognises a dictation sentence, and refuses it
with that reason rather than "not built yet" — a refusal that names the boundary
is the only way a user finds out the boundary exists.

This is a stronger guarantee than handling the words carefully once they arrive.
Careful handling is a promise about code; not receiving them is a property of the
architecture.

**Consequence:** the mode lives in the client, `staysLocal` is the one gate that
decides, and the environment's intent log contains no dictated text. When the
browser and VS Code producers land, they insert locally too — the words go from
the microphone to the field without passing through a work session.

---

## D32 — The extension hosts are blocked; what they must satisfy is not

**Decided** 2026-09-18, during Phase 6.

§29 Phase 6 asks for a VS Code extension and a browser extension. Neither can be
loaded, run or proven from this box: there is no desktop session, no VS Code, and
no browser with an extension host. The honest options were to ship two skeletons
that nobody can execute, or to ship the **contract they must satisfy** and say
plainly that the hosts are not built.

Skeletons lose. This repository already carries the lesson that code wired to
nothing is worse than an admitted gap: it reads as progress, it rots against a
host nobody ran it on, and the next person cannot tell the difference between
"tested" and "compiled".

**What ships instead**, and it is not nothing:

- `packages/contracts/src/fabric/context.ts` — exactly what a VS Code window
  (§16) and a browser tab (§17) may report, including the privacy line: origins
  and field types, never page content, and a field label only under an explicit
  capability.
- `packages/shared/src/fabricContextBus.ts` — the bus that routes their
  snapshots, today, with tests that drive `vscode` and `browser` producers
  through §14's ladder. When the extensions land they publish into a bus whose
  behaviour is already pinned.
- The refusals: a sentence that needs a producer nobody is running is refused by
  name, rather than resolving against a stale fact.

**Consequence:** `STATUS.md` lists both extensions as blocked with the blocker
named — a device this box does not have — and the matrix rows I8 and I9 stay
open rather than being marked done against untested code.

---

## D33 — Injection capability is computed from the host's facts, never assumed

**Decided** 2026-09-18, during Phase 6. **Implements** §18's "surface capability
must be reported honestly in the UI".

Dictation that silently does nothing is worse than dictation that refuses,
because the user learns about it by discovering their sentence went nowhere —
usually after saying something they would rather not repeat.

So the capability report is derived from what the machine actually is: platform,
display server (`XDG_SESSION_TYPE`, then the Wayland and X sockets), whether the
OS granted accessibility, whether an application integration is connected,
whether the user turned simulated keystrokes on. Every unavailable method carries
a reason a person can act on, and the report is produced in the desktop main
process because the renderer cannot see any of those facts.

The Linux case is the one the specification calls out and the one this repository
runs on: **under Wayland a process cannot type into another application's
window**, and the report says so in those words rather than offering a method
that will fail.

**Consequence:** `describeInjectionCapabilities` never returns a bare "no", the
desktop exposes the report over its existing local IPC (§15's "local
authenticated IPC interface, not a public network API"), and the client's
dictation refusal quotes the host's own reason.

---

## D34 — One fleet-row builder, in `shared`, for every client

**Decided** 2026-09-18, during Phase 7.

The §33 fleet row — glyph, project and work, state, then the account and host —
was written in `apps/web`. Phase 7 needs the same row on the phone, and the
choice was to copy it or to move it.

Copying loses, and the reason is specific rather than aesthetic: the two copies
would drift, and **the drift would be silent**. The desktop would say a session
needs you and the phone would not, and the phone is the surface the Director
glances at while walking away from the desk — the one place the disagreement
would be discovered last.

**Consequence:** `packages/shared/src/fabricFleetView.ts` is the only builder;
the web sidebar and the mobile screen both import it; its tests moved with it and
still pin the wording. A client may style a row however it likes and may not
decide what it says.

---

## D35 — The phone ships no microphone of its own

**Decided** 2026-09-18, during Phase 7. **Follows** D24, and narrows §29 Phase 7's
"mic button" and "iOS App Intents".

§19.1 already rules out a background always-listening service on iOS and points at
the supported entry points: an in-app button, App Intents, Shortcuts, the Action
Button. Every one of those needs Xcode, a signing identity and a device — none of
which exist on this box — and by D24 the fork contains no speech pipeline anyway.

What it does contain is the field. **iOS's own keyboard has a dictation key**, and
the Director already uses it: he taps it, speaks, and the text lands in the input.
That sentence then goes through the same deterministic grammar as one typed on a
laptop, which is the property D24 exists to protect — a phone and a keyboard mean
the same thing to the environment.

**Consequence:** the phone's Fabric screen is a text field, three quick-action
sentences and the fleet. App Intents, the Action Button and any custom audio are
listed as blocked on a device and a mac, not as design work that is pending.

---

## D36 — The phone names what it cannot do, where it cannot do it

**Decided** 2026-09-18, during Phase 7.

§29 Phase 7's exit criteria include handing a work session to another provider
account. Phase 3 has not built handoff, and this deployment has one Claude
account logged in, so the honest phone shows a sentence saying so rather than a
button that fails when pressed.

That is a sharper rule on a phone than on a desktop, and worth writing down: the
user is usually **away from the machine that could fix it**. A desktop user who
presses a dead button can go and look; a phone user gets a spinner and a guess.
So the refusal travels with its reason, in the place the action would have been.

**Consequence:** `handoffAvailability` and `fabricAvailability` return a reason
rather than a boolean, the screen renders the reason, and both are unit-tested —
including the case where an environment is simply too old to know what a work
session is.

---

## D37 — Herdr is integrated, never vendored

**Decided** 2026-09-18, during Phase 8. **Implements** §9 and the fork's own
licence boundary.

Herdr is AGPL and is a separate program. Fabric adopts sessions _from_ it by
speaking to its control surface from the outside, the way a person at a prompt
would, and this repository contains none of its code.

The practical shape that forces: `AdoptedRuntimeAdapter` is a **port** with two
methods, and `HerdrAdapterLive` is the only file that knows the runtime exists.
Swapping in a second runtime later is a new adapter, not a change to the domain,
and nothing in `packages/` links against Herdr at all.

**Consequence:** a machine without Herdr still gets the whole adopted-session
domain — registering, listing, the fleet, the refusals — and every call that
would have reached the runtime answers with the reason it could not.

---

## D38 — A state Fabric cannot map is refused, never called idle

**Decided** 2026-09-18, during Phase 8.

§9 gives four mappings: blocked, working, done, idle. A runtime that says
anything else — "compacting", a version Fabric has not met — could be mapped to
`idle` and forgotten about.

It is refused instead, by name, and the session keeps whatever state it had.
The reason is the fleet's ordering: `idle` sorts to the bottom and `needs_input`
sorts to the top, so a wrong `idle` on a terminal that is actually waiting for a
human is the one mapping error that hides exactly the thing the fleet exists to
surface.

Two smaller decisions inside the same table:

- **`blocked` maps to `needs_input`, not `needs_approval`.** Herdr can tell that
  a pane is waiting for a human; it cannot tell whether what it wants is an
  answer or permission. Claiming the stronger one would put an approval badge on
  a session nobody can approve from Fabric.
- **A discovered pane whose state is unknown is still shown**, with a null
  state. Hiding it would be worse; it simply cannot be adopted until the mapping
  learns the word.

---

## D39 — An adopted session declares what Fabric may not do to it

**Decided** 2026-09-18, during Phase 8. **Implements** §9 principle 5.

A terminal somebody else started has no structured conversation, no approval
requests Fabric can answer, and no diffs — those belong to a thread T3 owns.
Rather than discovering that by trying, an adopted session carries a capability
record, and a runtime that claims nothing gets `ADOPTED_MINIMUM_CAPABILITIES`:
everything false except showing the terminal.

Every refusal names the capability _and_ why it is missing — "approvals belong to
a provider session Fabric started; an adopted terminal has none to answer" —
because a bare "not supported" tells the user nothing about whether a different
setup would help.

**Consequence:** the fleet row carries `canSendInput`, so a client can render
what it may offer rather than offering everything and apologising afterwards.

---

## D40 — An adopted terminal can make the work need you

**Decided** 2026-09-18, during Phase 8.

The fleet's state for a work session is the most demanding of its live sessions.
Adopted sessions are counted in that, so a Herdr pane that reports `blocked`
makes the _work_ say it needs the user — even though Fabric cannot answer it,
and even when the work has no thread of Fabric's own.

The alternative — counting only sessions Fabric controls — would produce a fleet
that says "idle" about work that is visibly stuck, which is the specific failure
§29 Phase 4's exit criterion was written against. A session Fabric cannot
control still tells the truth about what the work is waiting for.

---

## D41 — The capability plane is the abstraction, not the capabilities

**Decided** 2026-09-18, during Phase 10. **Follows** §23's own instruction.

§23 lists twelve provider-neutral capabilities and then says plainly: _do not
implement every capability during the first Fabric milestone; build the
registration/policy abstraction first, then migrate tools incrementally._

So Phase 10 ships the registry and the policy and **none of the capabilities**.
What that buys before a single tool moves is the thing §23 is actually after:
one place where "may this happen here?" has an answer, computed from what the
environment is for and what class the action is, instead of each provider's tool
configuration deciding privately and nobody being able to say what the system as
a whole permits.

**Consequence:** `evaluateCapability` is a pure function over a policy, three
templates exist (development, supervised, production), and a capability nobody
declared is refused rather than defaulted. Migrating a real tool onto the plane
is a later phase's work and will not need this decided again.

---

## D42 — Production turns high-risk capabilities off rather than gating them

**Decided** 2026-09-18, during Phase 10. **Stricter than** §24.2.

§24.2 allows a high-risk operation through an explicit confirmation surface. The
production template does not use one: deployment, databases and email are
`enabled: false` with a reason, and turning one on is a visible edit to the
policy.

The reason is where the confirmation would appear. Fabric's surfaces are a
sidebar, a phone and a spoken sentence; a production deploy confirmed by a tap
on a phone in a taxi is not a confirmation, it is a formality with a witness.
Making it an edit to the policy puts the decision somewhere it can be read
afterwards.

Two details that keep this honest rather than merely strict:

- **Medium risk still asks on supervised and production environments**, because
  somebody else is watching those, and an ask is cheap.
- **A narrowly scoped preauthorisation lifts a confirmation and never a
  refusal** (§24.2's own exception, kept narrow). A capability the policy
  switched off stays off however the caller asks.

---

## D43 — Retention runs where the log grows, not on a timer

**Decided** 2026-09-18, during Phase 10. **Implements** §26 for Fabric's own
records.

The intent log only grows when somebody says something, so pruning on write runs
exactly as often as it needs to and never on an idle machine. A scheduler would
be a second lifecycle to keep honest — started, stopped, tested — for a job with
no deadline.

The horizon itself is the shared `expiredRecords`, so the rule cannot drift
between the policy and the SQL: the server reads the candidate rows, the tested
function decides, and only ids are deleted.

Two rules inside it, both from §26's spirit rather than its letter:

- **Refusals are kept** when the policy says so, and it says so by default. A
  log that keeps only what worked cannot show a grammar its own blind spots.
- **A row whose timestamp will not parse is kept.** Deleting something because
  its date was unreadable is the wrong way round.

---

## D44 — The audit trail is a view, never a fourth table

**Decided** 2026-09-18, during Phase 10.

"What happened to this work, and who asked?" is answered from three records that
already exist — intents, firings, provider sessions — merged in time order by a
pure function.

Writing a fourth table alongside them would drift from them, and the drift would
be discovered by somebody trying to work out what went wrong. A view cannot
drift: if it is wrong, the records it reads are wrong, which is the thing you
wanted to know anyway.

**Consequence:** a person's sentence sorts above the rule it set off at the same
instant, so cause reads above effect rather than in whatever order the tables
came back.

---

## D45 — Fabric is on by default in this fork

**Decided** 2026-09-18 by the Director, for the first deploy: the fork is to be
installed on his own running server and a Fabric surface is to render "so he does
not have to find a setting".

`fabricWorkSessionsEnabled` was introduced in Phase 2 as a client preference
defaulting to **off**, which was right while the fork was a branch nobody ran and
wrong the moment it became the thing he opens. A build of Fabric where the user
must first find a switch is a build nobody uses.

It stays a _client preference_ rather than becoming an environment setting,
because what it changes is this client's navigation. The sidebar still checks the
server's `fabricWorkSessions` capability before calling anything, so a client
pointed at a stock T3 server renders the stock sidebar rather than erroring — the
default moved, the safety did not.

**Consequence:** `Schema.withDecodingDefault(Effect.succeed(true))`, so a profile
that has never seen the setting gets Fabric, and a profile that explicitly turned
it off keeps it off.

**What this also exposes, said plainly:** the key is not in `ClientSettingsPatch`
and there is no row for it in the settings panel — Phase 2 never added one,
because the walk set it directly in the client's stored settings. Turning Fabric
_off_ therefore means editing stored settings, not clicking something. That is
acceptable while the default is the intended state and the Director wanted no
setting to find, and it is deliberately not fixed here: the row would go in
`SettingsPanels.tsx`, the single file most likely to conflict on every upstream
merge, and this branch's job was the deploy. A test asserts both halves so the
gap cannot be mistaken for an oversight later.

---

## D46 — The fork ships as a version beside the release, never over it

**Decided** 2026-09-18, during the first deploy.

Upstream's runtime keeps every version under `~/.t3/runtime/versions/<version>/`
and picks one through `service-state.json` and the unit's `ExecStart`. The fork
is installed as another such version, built through upstream's own release chain
(`vp run --filter t3 build` → `build-exe` → `build-cli-archive.ts` →
`smoke-cli-archive.ts`), and the unit is repointed with a systemd **drop-in**.

The alternative — overwriting the installed release, or editing the unit file —
was rejected because it destroys the rollback. With a drop-in, rolling back is
deleting one file and restoring one JSON file, and both are in `DEPLOY.md`.

**Consequence:** the service-state protocol number is part of the deploy. This
fork is protocol 3 and the installed 0.0.42 wrote 2, and the launcher refuses a
state whose protocol is not exactly its own — so the first restart failed with
`Service state is invalid or unsupported.` until the file was rewritten. The old
file is kept as half of the rollback.

---

## D47 — T3 Connect's public config is read from the installed release, not committed

**Decided** 2026-09-18, during the first deploy, after T3 Connect did not come
back with the fork.

`hasCloudPublicConfig` gates the whole cloud-link startup path on three values —
relay URL, Clerk publishable key, Clerk CLI OAuth client id — which the official
release receives as build-time defines from upstream's CI. A fork build has none,
so the startup reconcile is skipped. Nothing errors: the _previous_ server
deletes its Cloudflare tunnel on clean shutdown (so an offline environment is not
billed), expecting the next startup to provision a replacement, and the fork
simply never does. The environment stops being reachable from t3.codes while
every local check still passes.

Three options were considered. Baking the values into the fork's build was
rejected: they are upstream's cloud, and this fork may be open-sourced. Carrying
them in a committed `.env` was rejected for the same reason plus the standing no
secrets rule. What ships instead is
`scripts/fabric/cloud-public-config.sh`, which reads them out of whichever
official release is installed on the machine and prints a systemd drop-in. No
value ever enters the repository, and a machine with no official release gets a
refusal that names what to install.

The relay client's OTLP tracing triple is deliberately **not** carried over: it
contains an Axiom ingest token, which is a credential and is upstream's. Leaving
it unset disables relay-client tracing.

**Consequence:** "T3 Connect works" is a deploy check with a log line to look for
(`T3 Connect desired link reconciled on startup`) and a process to see
(`cloudflared tunnel run`), not an assumption.
