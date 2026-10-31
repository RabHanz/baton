# Decisions

Every deviation from the build specification, and every choice the specification left open, with
the reason. Newest last. A decision that later turns out wrong is superseded by a new entry rather
than edited, so the reasoning stays legible.

The specification these refer to is the Baton implementation document dated 2026-09-18; section
numbers below are its sections.

---

## D1 — §0 rule 2 means "subscription, not API"

**Decided** 2026-09-17 by the Director. **Recorded** 2026-09-18.

Rule 2 reads "Do not replace interactive Claude Code subscription sessions with the Claude Agent SDK
or `claude -p`." Taken literally it forbids the transport T3 already uses, which would mean forking
T3's Claude adapter on day one — the exact thing rule 1 forbids.

The Director's clarification: the rule protects **the subscription**, not a particular process
shape. What must never happen is Baton quietly moving his work onto metered API billing or onto a
harness that is not his real Claude Code.

Upstream satisfies that reading. `apps/server/src/provider/Layers/ClaudeAdapter.ts` drives
`@anthropic-ai/claude-agent-sdk` with `pathToClaudeCodeExecutable` pointed at the user's installed
`claude` binary, and `apps/server/src/provider/Drivers/ClaudeHome.ts` sets `CLAUDE_CONFIG_DIR` (not
`HOME`) so the spawned CLI finds the OAuth credentials that `claude auth login` wrote. The
signed-out message names both paths — subscription login, or an instance's configured API
credentials — so the distinction is explicit in upstream's own code.

**Consequence:** Baton uses T3's provider transport unchanged. What Baton must guard is
configuration: an instance configured with an API key is a different economic object from one
configured with a subscription login, and any Baton surface that offers "continue with…" must show
which it is before the user picks. Nothing in Baton may set `ANTHROPIC_API_KEY` in a provider
environment.

---

## D2 — T3's preview browser is Baton's shared browser

**Decided** 2026-09-18.

The specification (§23 capability plane, §17 browser extension) assumes browser/computer use is a
capability Baton will have to supply. It already exists upstream and is better than what was
planned.

`apps/server/src/mcp/toolkits/preview/tools.ts` publishes fourteen `preview_*` MCP tools to any
provider thread. The browser is a Chromium `<webview>` hosted by the desktop app; cookie jars are
**browser profiles** (`packages/contracts/src/browserProfile.ts`) — named partitions, up to 24,
`persistent` or `incognito`, client-local and bound to no provider and no account.

That last property is the whole point. One logged-in profile serves Claude A, Claude B, Claude C and
Codex alike. The browser-hopping the Director described — a different browser per account to keep
sessions apart — stops being necessary.

**Consequence:** Baton builds no browser and no per-account cookie mechanism. §23's browser
capability is "register the existing preview toolkit", not "implement". The limitation to record and
surface honestly: the desktop app must be running, because it hosts the webview; web and mobile
clients cannot host one. Baton's machine registry (§5.6) therefore carries
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

Baton's job is to make the second reachable from a WorkSession rather than replacing it. The
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
process. No Herdr source is vendored, no Herdr code is adapted, and Baton's dependency on it is
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

**8 (Herdr) last but one.** Adopted sessions are the lowest-fidelity members of the fleet — Baton
cannot recover structured conversation state from a raw PTY, so they arrive with reduced
capabilities. Landing them after the fleet model is settled avoids designing the fleet around its
weakest member.

10 stays last because it hardens what exists.

---

## D6 — Extend T3's domain in place; no `packages/baton-*`

**Decided** 2026-09-18. **Deviates from** §27's suggested layout.

§27 suggests `packages/baton-domain`, `baton-runtime`, `baton-voice`, `baton-context`, and then
says: "Where T3 already has a domain/service that naturally owns a concern, extend that instead of
creating duplicate packages." §38 says the same in decision-heuristic form. For the server-side
concerns, T3 already owns every one of them:

- wire contracts → `packages/contracts`, which is where the RPC boundary and every persisted schema
  lives, and where `WsRpcGroup` is assembled;
- durable state → `apps/server/src/persistence`, whose migrations are statically imported from one
  manifest, so a Baton table in another package would still have to register there;
- client state shared by web and mobile → `packages/client-runtime`, which exists specifically so
  reconnect and multi-environment behavior do not diverge between clients.

A parallel `packages/baton-domain` would either import all three or duplicate them, and would make
every upstream rebase a three-way merge across package boundaries.

**Consequence:** Baton server and contract code lives in the existing packages, in directories named
`baton/` inside them (`packages/contracts/src/baton/`, `apps/server/src/baton/`, and so on), so
the Baton diff is still greppable as a patch series. The §27 packages that do **not** have a natural
upstream owner — the desktop voice sidecar, the OS context bus, the VS Code and browser extensions —
are genuinely separate, because §38 says native OS integrations must not run on remote servers. Those
arrive in Phases 5 and 6 as their own packages.

---

## D7 — "Reversible migration" means a rehearsed snapshot, because upstream migrations are forward only

**Decided** 2026-09-18.

`apps/server/src/persistence/Migrations.ts` runs Effect's `Migrator` over a static list of numbered
migrations and records applied ids in `effect_sql_migrations`. There is no `down` step anywhere in
the tree, and adding one would be a structural change to upstream's persistence layer for Baton's
convenience.

**Consequence:** Baton does not invent a rollback mechanism. Its reversibility discipline is:

1. every Baton migration is additive — new tables, new nullable columns, new indexes. No column is
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

## D8 — Baton ships behind two flags, both of them upstream's

**Decided** 2026-09-18. **Superseded by D14** the same day, once it was built.

Upstream already solves "a new client is talking to an old server". `ExecutionEnvironmentCapabilities`
in `packages/contracts/src/environment.ts` is a struct of optional booleans the server advertises in
its descriptor; clients hide a feature whose capability is absent rather than probing an RPC that
does not exist. Every entry there carries a comment stating the skew contract, and
`docs/internals/overview.md` documents the pattern with the pull-request linking rollout as its
worked example.

**Consequence:** Baton's development flag is a capability key plus a server setting, not a build
constant and not an environment variable:

- `ExecutionEnvironmentCapabilities.batonWorkSessions` — advertised only when the server both
  supports and has enabled the feature. A client that does not see it renders the ordinary T3
  sidebar and never calls a `fabric.*` RPC;
- a `ServerSettings` entry — the operator's switch, persisted per environment.

Baton RPCs remain registered on the server whether or not the flag is on; the flag governs
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
WorkSession in, and inventing one would mean a Baton control plane above the environments — which
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

Baton work lands on `baton/*` branches. The fork's `main` is fast-forwarded from `upstream/main`
and carries no Baton commits of its own until a phase is deliberately frozen onto it.

The reason is rebase cost. §36 requires minimising divergence and rebasing regularly; a `main` that
has both upstream commits and Baton commits interleaved makes every rebase a merge of two histories
instead of replaying a patch series onto a moved base. It also keeps the answer to "what has Baton
changed?" available as a single diff against `upstream/main`.

The clone is a blobless partial clone (`--filter=blob:none`): full commit history, blobs fetched on
demand, `.git` under 100 MB instead of several hundred. Operations that need old file contents
(`git log -p`, `git blame`, checking out an old tree) need network.

---

## D11 — Baton events are a live broadcast; they do not go in T3's event store

**Decided** 2026-09-18, during Phase 2.

§28 asks for `fabric.workSession.created`, `.updated`, `.statusChanged`, `.providerAttached` and the
handoff pair. The obvious home is T3's orchestration event log, which is the durable source of truth
for everything else in the domain. That would be wrong here, for two reasons.

**It would make a downgrade fatal.** `docs/internals/overview.md`: persisted events must remain
decodable on replay, and a schema change affects old environments at startup as well as live traffic.
`providers.md` records the precedent — file attachments introduced a replay compatibility limit where
an image-only server _failed the entire environment's startup_ replaying one such event. A stock T3
binary replaying a log containing `fabric.*` events would hit exactly that. Since Baton's rollback
story is "run an older build against the same database" (D7), poisoning the shared event log would
remove the rollback.

**Nothing would read it back.** The durable timeline is the attachment rows: who ran the work, from
when, until when. An event log beside them would duplicate that and be read by nothing, which is a
stub with extra steps.

**Consequence:** `fabric.subscribeWorkSessions` streams a snapshot followed by events from an
in-process `PubSub`. Clients apply them without a refetch because each event carries the whole
record. The durable truth is `fabric_work_sessions` and `fabric_work_session_threads`, and a client
that reconnects gets a fresh snapshot rather than replaying anything.

If a durable Baton audit trail is later needed — Phase 10 lists one — it gets its own append-only
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
worktree's throwaway database. Once a Baton migration ships, D7's additive rule applies and a
correction is a new migration.

---

## D14 — Supersedes D8: the capability states what the server understands; the flag is a client setting

**Decided** 2026-09-18, during Phase 2.

D8 said Baton would ship behind an environment capability _plus_ a server setting, with the
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
somebody else. It is not work, it is not a prompt, and a Baton environment has
no business receiving it, resolving it, or keeping it in an intent log that
outlives the sentence.

So dictation is classified **on the client, before anything is sent**
(`packages/shared/src/batonDictation.ts`), and only what is left travels. The
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

- `packages/contracts/src/baton/context.ts` — exactly what a VS Code window
  (§16) and a browser tab (§17) may report, including the privacy line: origins
  and field types, never page content, and a field label only under an explicit
  capability.
- `packages/shared/src/batonContextBus.ts` — the bus that routes their
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

**Consequence:** `packages/shared/src/batonFleetView.ts` is the only builder;
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

**Consequence:** the phone's Baton screen is a text field, three quick-action
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

**Consequence:** `handoffAvailability` and `batonAvailability` return a reason
rather than a boolean, the screen renders the reason, and both are unit-tested —
including the case where an environment is simply too old to know what a work
session is.

---

## D37 — Herdr is integrated, never vendored

**Decided** 2026-09-18, during Phase 8. **Implements** §9 and the fork's own
licence boundary. **Corrected 2026-09-18** once Herdr was actually installed;
the correction changes the premise, not the decision.

Herdr is a separate program. Baton adopts sessions _from_ it by speaking to its
control surface from the outside, the way a person at a prompt would, and this
repository contains none of its code.

> **Correction — the licence premise was wrong.**
>
> This was written against `github.com/SuperCodeAgents/herdr-terminal`, which is
> **AGPL-3.0**. That repository is a **fork whose last push was 2026-05-24**.
> Upstream is `github.com/herdrdev/herdr`: Rust, ~39k stars, v0.9.1 released
> 2026-09-16, licensed **Apache-2.0**.
>
> So "Herdr is AGPL" is not true of the Herdr anyone would install, and the
> copyleft reasoning behind "never vendored" does not apply. **The decision
> stands on the better reason**: Herdr is a running server with its own
> lifecycle, release channel and update path, and a copy inside this repository
> would be a fork we then had to maintain. The port is a port because that is
> the right shape, not because a licence forbade the alternative.
>
> The stale fork would also be four months behind and would not have the
> `api snapshot` surface the adapter now uses.

The practical shape that forces: `AdoptedRuntimeAdapter` is a **port** — three
methods now that a pane's text can be read — and `HerdrAdapterLive` is the only
file that knows the runtime exists. Swapping in a second runtime later is a new
adapter, not a change to the domain, and nothing in `packages/` links against
Herdr at all.

**Consequence:** a machine without Herdr still gets the whole adopted-session
domain — registering, listing, the fleet, the refusals — and every call that
would have reached the runtime answers with the reason it could not.

---

## D38 — A state Baton cannot map is refused, never called idle

**Decided** 2026-09-18, during Phase 8.

§9 gives four mappings: blocked, working, done, idle. A runtime that says
anything else — "compacting", a version Baton has not met — could be mapped to
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
  a session nobody can approve from Baton.
- **A discovered pane whose state is unknown is still shown**, with a null
  state. Hiding it would be worse; it simply cannot be adopted until the mapping
  learns the word.

---

## D39 — An adopted session declares what Baton may not do to it

**Decided** 2026-09-18, during Phase 8. **Implements** §9 principle 5.

A terminal somebody else started has no structured conversation, no approval
requests Baton can answer, and no diffs — those belong to a thread T3 owns.
Rather than discovering that by trying, an adopted session carries a capability
record, and a runtime that claims nothing gets `ADOPTED_MINIMUM_CAPABILITIES`:
everything false except showing the terminal.

Every refusal names the capability _and_ why it is missing — "approvals belong to
a provider session Baton started; an adopted terminal has none to answer" —
because a bare "not supported" tells the user nothing about whether a different
setup would help.

**Consequence:** the fleet row carries `canSendInput`, so a client can render
what it may offer rather than offering everything and apologising afterwards.

---

## D40 — An adopted terminal can make the work need you

**Decided** 2026-09-18, during Phase 8.

The fleet's state for a work session is the most demanding of its live sessions.
Adopted sessions are counted in that, so a Herdr pane that reports `blocked`
makes the _work_ say it needs the user — even though Baton cannot answer it,
and even when the work has no thread of Baton's own.

The alternative — counting only sessions Baton controls — would produce a fleet
that says "idle" about work that is visibly stuck, which is the specific failure
§29 Phase 4's exit criterion was written against. A session Baton cannot
control still tells the truth about what the work is waiting for.

---

## D41 — The capability plane is the abstraction, not the capabilities

**Decided** 2026-09-18, during Phase 10. **Follows** §23's own instruction.

§23 lists twelve provider-neutral capabilities and then says plainly: _do not
implement every capability during the first Baton milestone; build the
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

The reason is where the confirmation would appear. Baton's surfaces are a
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

**Decided** 2026-09-18, during Phase 10. **Implements** §26 for Baton's own
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

## D45 — Baton is on by default in this fork

**Decided** 2026-09-18 by the Director, for the first deploy: the fork is to be
installed on his own running server and a Baton surface is to render "so he does
not have to find a setting".

`fabricWorkSessionsEnabled` was introduced in Phase 2 as a client preference
defaulting to **off**, which was right while the fork was a branch nobody ran and
wrong the moment it became the thing he opens. A build of Baton where the user
must first find a switch is a build nobody uses.

It stays a _client preference_ rather than becoming an environment setting,
because what it changes is this client's navigation. The sidebar still checks the
server's `fabricWorkSessions` capability before calling anything, so a client
pointed at a stock T3 server renders the stock sidebar rather than erroring — the
default moved, the safety did not.

**Consequence:** `Schema.withDecodingDefault(Effect.succeed(true))`, so a profile
that has never seen the setting gets Baton, and a profile that explicitly turned
it off keeps it off.

**What this also exposes, said plainly:** the key is not in `ClientSettingsPatch`
and there is no row for it in the settings panel — Phase 2 never added one,
because the walk set it directly in the client's stored settings. Turning Baton
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
`scripts/baton/cloud-public-config.sh`, which reads them out of whichever
official release is installed on the machine and prints a systemd drop-in. No
value ever enters the repository, and a machine with no official release gets a
refusal that names what to install.

The relay client's OTLP tracing triple is deliberately **not** carried over: it
contains an Axiom ingest token, which is a credential and is upstream's. Leaving
it unset disables relay-client tracing.

**Consequence:** "T3 Connect works" is a deploy check with a log line to look for
(`T3 Connect desired link reconciled on startup`) and a process to see
(`cloudflared tunnel run`), not an assumption.

## D48 — Baton's migrations leave upstream's number space alone

**Decided** 2026-09-18, on the Director's instruction to fix the collision before the first upstream
merge rather than after it.

Phases 2–10 numbered Baton's six migrations 054–059 inside upstream's single ascending manifest.
That was always borrowed time. Upstream's migrator runs exactly the entries whose id is greater than
the highest id recorded in the tracking table, so the moment upstream publishes its own 054 one of
two things happens:

- merged into our manifest, two entries claim 54 and the migrator fails with `Duplicates` — loud,
  survivable;
- renumbered around ours, upstream's migration sits below our high-water mark of 59 and **never
  runs**. No error, no log line. The first symptom is a query against a column that was never added,
  on somebody's machine, weeks later.

The second is the one that decides this. A fork cannot hold a veto over upstream's numbering.

**What ships:** `apps/server/src/persistence/BatonMigrations.ts`, a second manifest numbered from 1
with `table: "fabric_sql_migrations"` — `MigratorOptions.table` is upstream's own parameter, so
nothing in their migrator was reshaped. `Migrations.ts` is byte-identical to upstream's again, which
takes the file they touch on _every_ schema change off the conflicts table.

**Databases that already ran the old numbering are repaired, not re-migrated.** Both of the
Director's machines carry rows 54–59 today. On the next boot `reclaimUpstreamMigrationIds` moves
that record across — each legacy row is written into Baton's table under its new id and deleted
from upstream's — so the high-water mark drops back to upstream's real latest.

The tempting alternative was to drop the rows and let Baton's migrator re-run 1–6 over tables that
already exist, on the grounds that every `CREATE TABLE` says `IF NOT EXISTS`. That is wrong, and the
test found it before a machine did: `002_WorkSessionSynopsis` adds a column, and SQLite has no
`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`. Re-running fails the boot with
`duplicate column name: synopsis_json` on precisely the machines the repair exists for. Adoption is
also simply truer — those migrations did run.

**Consequence:** the repair runs _before_ upstream's migrator, not after, so a machine upgrading
into a release that already contains upstream's 054 runs it on that boot rather than the next one.
A half-migrated database adopts what it applied and runs the rest; a database that never saw the old
numbering reclaims nothing. All four cases are tested against a real SQLite database, including an
upstream migration at 054 proven to run after the repair and proven to be skipped before it.

---

## D49 — The fork absorbs upstream, and the sync is a script rather than a habit

**Decided** 2026-09-18, replacing the rebase plan written at Phase 0.

`UPSTREAM.md` originally said the fork's `main` would stay a fast-forward mirror of upstream's and
Baton would live on `baton/*` branches rebased on top. That stopped being true the moment Baton
merged into the fork's `main`, which is where it belongs now that the fork is what runs on the
Director's machines. Keeping the old policy would mean rewriting every Baton commit on every sync:
"what did the fork change" would have no stable answer, and every open branch would need a force
push.

So the fork **absorbs** upstream through merge commits, and legibility comes from the conflicts
table instead — every upstream file Baton edits, listed with the reason, everything else a new file
under a `baton` name.

`scripts/baton/upstream-sync.sh` does it: fetch, report the new commits, intersect upstream's
changed files with the fork's, flag every hit against the conflicts table (read out of `UPSTREAM.md`
itself, so the document stays the source of that list), merge onto a dated branch and open the PR
with the report as its body. It refuses a dirty tree, never pushes to `main`, and stops with the
file list when the merge conflicts rather than guessing.

**Consequence:** the distance from upstream is a number somebody can read on demand, and a sync that
would touch a file Baton depends on says so before the merge rather than during it.

---

## D50 — A model reads the sentences the grammar cannot, and the grammar checks its work

**Decided** 2026-09-18 by the Director, reversing D24 ("no model on the intent path") in his own
words: _"don't dumb it down by generic grammar! what the hell even is the point of this if it isn't
smart or sentient!"_

D24 was right about the danger and wrong about the remedy. The danger is a probabilistic parser
doing something the user did not ask for; the remedy D24 chose was to refuse everything the grammar
could not place, which in practice means refusing the way people actually talk. Ten sentences
written the way he speaks — "what's cooking", "get the radar one moving again", "tell the scheduler
one to stop what it's doing" — are all refused by the shipped grammar. A surface that answers only
sentences shaped like its own regexes is not an assistant.

**The path is now three steps, in this order:**

1. **The grammar**, unchanged. Instant, free, identical every time, and still the only thing that
   runs on a sentence it can place.
2. **A phrasing the user has already confirmed**, replayed from `fabric_intent_vocabulary`. Still
   no model, still instant.
3. **A model**, running as one of the user's own accounts through the same `TextGeneration` path
   that writes thread titles — subscription, not API, and the cheapest tier that can classify
   (`claude-haiku-4-5`).

**What did not move, and this is the whole of the safety argument:**

- **§24.1 is matched before the model.** A high-risk sentence is refused by the grammar and never
  reaches it. `high_risk`, `not_available_yet` and `nothing_to_confirm` refusals are final.
- **§24.1 is matched again after the model**, against the effectful text it produced — the message
  an agent would receive, the title new work would carry. A model asked to be helpful is exactly
  the component that would turn a vague sentence into "deploy to production" inside a message.
  Deliberately _not_ against the description, which quotes names this environment already holds:
  work called "Production deploy check" is the user naming their work, not asking for a deploy.
- **Every id is checked against the same vocabulary the grammar uses.** An id that is not in the
  list is a refusal naming what the model said, never a nearest match.
- **`ambiguous_target` stays final.** When the grammar found _several_ matches and asked which, a
  model picking one is precisely the "never guess a target" rule this surface is built on (§14
  rung 9). A model may read an _unplaced_ name; it may not choose between two placed ones.
- **Low confidence is a question.** The model's own question becomes the refusal message.

**Two structural consequences that took a real run to find.**

The first: **the live preview must not call a model.** It fires on every pause in typing, and a
model call per pause spends the user's quota to describe a half-typed sentence. So `resolve`
carries `allowModel`, absent meaning no. The first Enter on an unplaceable sentence asks for a
reading and _shows_ it; the second Enter runs it. That two-step is not friction added for its own
sake — it is what makes the read-back load-bearing on the one path where the reading might be
wrong.

The second: **the reading a user was shown must be the reading that runs.** Without a short-lived
cache of readings keyed by the normalised sentence, the second Enter would ask again and could get
a different answer, and the line the user approved would describe a command that never executed.

**What it cost, honestly.** The first real run read **0 of 10**: the model answered `none` for
phrasings it plainly understood and `low` confidence for sentences with one obvious target, because
the prompt told it "low confidence is always safe" and it believed that. Rewriting the prompt with
the kinds spelled out, an example sentence per kind, and a confidence rule that names when _not_ to
hedge took it to **8 of 10**. The last two were `status_fleet` readings where the model wrote a
sentence into an enum field; a deterministic fallback to `everything` — the superset of the four
status questions, all of which are reads, with no target involved — took it to **10 of 10**.

**Consequence:** every intent row carries `source` (`grammar` | `learned` | `model`) and the model
that read it, so "why did that happen?" has an answer with a name in it. A model reading that runs
and does not fail is learned, and the next identical sentence is answered by step 2 — the model's
job is to teach the grammar the user's vocabulary, not to stay in the path forever.

---

## D51 — The synopsis is written at a milestone, not only assembled

**Decided** 2026-09-18 by the Director, in the same breath as D50, reversing D16 ("no model
summariser").

D16 declined §11's semantic summarisation because the fork had no model on any path and adding one
for a convenience was the wrong first use. D50 put one there. What the assembled synopsis produces
at the moment somebody most wants to read it — a completed turn — is this:

```
currentAction: (none)
next:          (none)
```

That is correct and useless. The provider stopped, so there is no current action; no rule fired, so
there is no next step. Somebody who stepped away and came back learns nothing.

What a model produces from the same thread's own turns, measured on the snapshot with
`claude-sonnet-5`, in 3.1 seconds:

> The review is complete: the branch was found to contain only a one-line README with no code, and
> the reviewer gave it LGTM.
>
> Merge can proceed; optionally clean up the placeholder commit message and author email first if
> the repo will be long-lived.

**What the model may write:** `currentAction` and `next`, one sentence each, and `source` becomes
`"model"` so a reader always knows which kind they are looking at.

**What it may not touch, enforced in `applyModelSynopsis` rather than asked for in a prompt:**

- **`needsUser`.** Whether the fleet interrupts a person stays derived from events. A model
  guessing "needs approval" is a model deciding whether to interrupt somebody, which is not a
  summarisation task.
- **`changedFiles`, `validation`, `recentFindings`.** These are observations, and they keep coming
  from the events that observed them. A model that "remembers" a file nobody touched is worse than
  no synopsis at all.

**One milestone, once.** Only a completed turn is written about, and each turn id at most once —
the Director's "cache by turn id so a synopsis is written at most once per trigger", taken
literally. Tool events and activity appends keep updating the assembled record for free, as they
did.

**It arrives as a signal**, `{ kind: "written", currentAction, next }`, folded by the same reducer
as every other signal. Not a second service method: one write path means one staleness rule and one
file to read when a synopsis looks wrong.

**Every failure is silent and leaves the plain synopsis standing** — no account, a driver without
the capability, a model that does not answer. The assembled version is never wrong about the facts,
which makes it the right thing to fall back to.

**What it cost, honestly.** The first real run produced _"Wrote a two-sentence status update for the
'Reconnect fix review' work based on the recent turns provided."_ — the model narrating the request
instead of the work. Two causes, both in this fork: the two output fields reached the CLI's JSON
schema with no descriptions, so the only guidance was prose several paragraphs earlier; and nothing
in the prompt said "do not describe this request". Annotating the fields and adding that rule fixed
it on the next call.

**Consequence:** the synopsis is now the most expensive thing Baton does per turn, at one Sonnet
call. It is bounded by the turn rate of work the user is actually running, and it is the line they
read to decide whether to look — which is the one place in this product where a sentence is worth
more than a label.

---

## D52 — A provider account is a login, not a second copy of everything

**Decided** 2026-09-18 by the Director: _"any new profile I add picks up the same config"_, with the
coordinator's clarification that "profile" means a **provider account** — a second or third Claude
login, and Codex accounts when they exist — not anything Baton-specific.

The shape, for both providers: the account directory holds **only that account's credentials**, and
`settings.json` (which carries `hooks`), `CLAUDE.md`, `skills/`, `agents/`, `commands/`, `plugins/`
and the `projects/` memory tree are the primary's, shared by symlink.

**Upstream already does this for Codex, and Baton does not reinvent it.**
`CodexHomeLayout.ts` implements a _shadow home_: `auth.json` private, every other entry in the
shared home symlinked in, re-materialised on every session start. Baton's account plan simply
names the shadow home and the setting that turns it on. Proven with upstream's own materializer
against the real `~/.codex`: `config.toml`, the caches, the session stores and the rest linked,
`auth.json` absent until somebody logs in.

**Claude had no equivalent**, which is the gap this closes. `ClaudeHome.ts` sets
`CLAUDE_CONFIG_DIR` and nothing else, so a second Claude account got an empty directory: no skills,
no agents, no instructions, no memory. `ClaudeAccountHome.ts` is the Codex mechanism applied to
Claude, deliberately built the same way so there is one idea here rather than two.

**On the question the Director actually asked — do symlinks survive the CLI's writes?** The honest
answer is that it could not be forced to write one on demand (2.1.263 has no `config set`; settings
are written in-session), so the design does not depend on the answer: the layout is
**re-materialised before every session**, a link that has drifted is repaired, and the two ways this
could silently fork are both named errors instead —

- a shared entry that has become a **real file** stops the layout rather than deleting somebody's
  data;
- a private entry (`.credentials.json`, `.claude.json`) that has become a **link** stops it too,
  because two "accounts" sharing one login is the failure the whole thing exists to prevent.

**Only the named entries are shared.** The first version linked everything in the primary that was
not obviously private, and the first real run produced thirty-odd links including `history.jsonl`,
`stats-cache.json`, `telemetry/` and three stale `settings.json` backups. Two accounts writing one
cache is a contention bug waiting to be blamed on something else, and none of it is what "the same
config" means.

**claude-swap is preferred when it is there.** The Director already runs `cswap`, which keeps a
per-account directory under `~/.local/share/claude-swap/sessions/<n>-<email>`. Adding an account it
already manages **reuses that directory** — a second home for one login is how somebody ends up
wondering which of them a rate limit belongs to — and adds the links cswap does not make.

**Adopting an existing directory keeps the original.** cswap creates `plugins/` and `projects/` as
real directories per account, so six of the eight shared entries linked and two refused. Refusing is
right by default; a session starting must never move somebody's data. So there is an explicit
`adoptExisting` mode that renames the original to `<name>.account-local-<timestamp>` beside the new
link. Nothing is ever deleted. Run against both of his real accounts, both now see the primary's 33
skills and 210-entry memory tree, both keep their own credentials, and both keep their previous
copies next to the links.

**Consequence:** "add a provider account" is a plan before it is a mkdir —
`planProviderAccount` decides the directory, the instance id and the one command to run, and returns
it for a person to read. The surface that shows that plan to the Director is not built yet; the
mechanism underneath it is, and it is exercised on every Claude session start.

---

## D53 — The ten seconds were a scratchpad, and most of what is left is not ours

**Decided** 2026-09-18, after the Director's point that for a voice surface the wait _is_ the
product.

A model reading took ~10 s live. Measured on his own account, with the real transport, the
decomposition is:

| Part                                           | Measured                                                                      | Whose                          |
| ---------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------ |
| CLI spawn + initialisation                     | 0.7–1.0 s                                                                     | ours to pre-pay, not to remove |
| Claude Code's own system prompt                | ~26,000 tokens, cache-read every call                                         | **not ours**                   |
| Model generation **with thinking**             | ~9 s                                                                          | ours to turn off               |
| Model generation **without thinking**          | ~5 s                                                                          | the floor for this transport   |
| Baton's own work (fleet read, grammar, memory) | milliseconds — a gate sentence that never reaches a model answers in **6 ms** | ours, and already negligible   |

**The finding: his own `settings.json` turns thinking on**, reasonably, because he writes code with
it. The CLI loads user settings, so a classification against a closed list of names inherited a
scratchpad it has no use for. Turning it off for Baton's two model reads — as a model-selection
option, which is upstream's own mechanism, rather than a special case inside the driver — took the
same sentence from **10.0 s to 6.0 s** with 0 thinking tokens, and the ten-sentence median on the
live server from ~10 s to **5.4 s**.

**What else was done, and what it was worth:**

- The variable half of the prompt is bounded: accounts that cannot be chosen are not listed at all
  (naming them invites a pick that is refused downstream anyway), and each list is capped at 40
  with a note. Worth little today — our prompt is hundreds of tokens against Claude Code's 26,000 —
  and it stops a busy fleet turning a 5-second read into a 9-second one.
- The constant block already came first, which is what lets the CLI's prompt cache hold it. Left
  alone deliberately.
- The learned-phrasing lookup now runs beside the fleet read instead of after it. An exact grammar
  hit never waited on a model; a _learned_ hit waited on a fleet read it has no use for.

**Why the 3-second target is not met, precisely.** After thinking is off, the remaining ~5 s is one
API call carrying ~26k cached tokens of Claude Code's own system prompt, answered through an
**end-turn tool** — the structured-output mechanism is a tool call plus its carrier, not a single
completion. The fork chooses neither. What is left to us is the 0.7–1.0 s of spawn, which a
pre-warmed session would remove: the SDK does support a streaming-input session with
`outputFormat: json_schema`, measured here at **0.9 s to initialise** and reusable across sentences.

**That session is not shipped, and the reason is worth recording.** It buys ~1 s of ~5.4 s, and it
costs a resident `claude` process per environment plus a conversation that accumulates history —
which is the one thing this path must not have, because "tell it to stop" resolving against what was
said three sentences ago is exactly the guessing §14 forbids. The variant that keeps the property —
a pre-spawned session per read, replaced immediately after use — is worth building when the
remaining 4 s comes down, and pointless while it does not.

**Consequence:** the honest number for "speak a sentence the grammar cannot place, see what it
understood" is about five seconds on this transport, and a sentence the grammar or the memory can
place is instant. The gap between those two is now the reason to teach the grammar, and the learned
table is what does it.

---

## D54 — A conversation is imported from its end, and the door to it is permanent

**Decided** 2026-09-18, on the Director's words: _"it imports the projects but not the latest sessions
to resume with all transcripts!! SOLVE THIS! it is the whole point to pivot to this from vscode and
claude remote!"_ and, before that, _"I don't see any sessions I can import, I need to know how to
resume this one and my others!"_

Two defects, one feature, one file.

### The transcript read was forwards, and his sessions are enormous

signzart's boot log after his wizard run, three times:

```
WARN Could not read imported transcript
  cause: TranscriptJsonLimitError: Transcript selected history exceeds the 32 MiB memory budget
```

His real sessions in `/home/dev/.claude/projects/-home-onnyx-VentureOS/` are **171 MB** and
**420 MB**. The importer read forwards from byte 0 and held every retained record, so the budget was
a verdict on the file rather than on the work: **the conversations most worth resuming were exactly
the ones that could not be**.

The last 200 records of either file are about **0.4 MB**. So the read now walks **backwards from the
end**, joins chunks at record boundaries, keeps only records that become visible messages, and folds
the rest into five fields. The budget is on what is **read** (16 MiB backwards, 4 MiB forwards for
what only a file's head knows), never on what the file holds.

Consequences that follow from reading the end rather than the whole:

- **The record limit stopped being a verdict.** A 100,000-record transcript imports its newest
  messages instead of being skipped. Two tests that asserted the old refusal now assert the import,
  and say in their names what they now guard.
- **One enormous record cannot hide a session.** Past 8 MiB a single record's bytes are dropped
  rather than held, so the messages on the other side of it are still reachable; and when the end of
  a file is one such record, the head is read for the conversation instead.
- **The session id still resumes everything.** `--resume <session id>` carries the provider's own
  history regardless of how much of it T3 shows. That is what makes showing a tail honest, and the
  imported thread says so in its first line: _"Showing the last N messages of this conversation. The
  agent has the whole thing."_ `thread.history.import` gained `system` as a role for it — the
  projection already had one, nothing rendered it, and now the timeline does.
- **`AgentSessionJson.ts` is deleted.** Its streaming field-selecting reader existed to bound a
  forward whole-file read. Nothing reads forwards through a whole file any more.

### A session continued after compaction was invisible to the scan

`6bf22e2d…`'s first records are `history-suppression`, `ai-title`, `agent-name`, `mode` and
`permission-mode` — no `cwd`. Its first `cwd` sits at **byte 952,129**, record 23 of 35,814: inside
the 1 MiB forward budget by **96 KB**. A slightly longer compaction summary would have dropped that
session from the scan without a word, and a session the scan never lists is a session nothing can
import.

Claude writes `cwd` on **every** record, so when the head does not answer within its budget, the end
of the file answers in one 256 KB read. The forward pass is unchanged for the normal case, where the
first record names the directory.

The direction matters for which answer is kept: **the earliest `cwd` wins** — a session belongs to
the directory it started in, whatever a later record says — while **title and model take the newest**.
A backwards walk sees the newest first, so the code says which it wants rather than relying on order.

### The import surface is permanent, and it lists conversations

Upstream's only import surface is the first-run `WelcomeWizard`, which every returning user has
already passed. The machinery underneath it — `agentSessions.scan`, `agentSessions.import`,
`AgentSessionImporter` — was reachable exactly once per install.

Two new methods, because the wizard's shape answers the wrong question. Its scan answers _which
folders have history_; somebody looking for a session they remember is asking _which conversation was
that_:

- `agentSessions.threads` lists recent conversations across **every configured provider instance's
  home** — so the cswap profiles' sessions appear — with the project path, the account, the last
  activity, the size, a preview of the first thing he typed, and whether it is already here. 50 at a
  time, 30-day window, and it says "scan limit reached" when it cut the list.
- `agentSessions.importThread` imports **exactly one**. The project-wide import takes everything
  recent in a directory, which is right for onboarding and wrong for "resume that one": a folder can
  hold a transcript being written right now, and importing it beside the wanted one puts a second
  writer one click away.

Both are reachable from Settings → Environments (per machine, including this one) and from the
project's own page (narrowed to its directory), behind an
`agentSessionConversationImport` capability so an older server is not probed.

---

## D55 — A turn asked the CLI to change to the mode it already had, and a resumed session refused

**Decided** 2026-09-18, after the Director's _"When can I move all of my sessions to T3 code?"_ —
where the difference between **imported** and **moved** is whether the thread can take a turn.

The 420 MB conversation imported cleanly and then could not answer. The projection said:

```
session=error   turn/setPermissionMode failed
```

and nothing else. The provider log said more:

```
session.started     resume: 735f333a-898c-479e-9370-26be44c409c3
session.configured  cwd=/home/onnyx/VentureOS
claude/result/success   session_id=735f333a-…   num_turns=0   result=""
```

**So the resume worked.** The CLI restored a four-day-old session, reported back its own session id,
and then the turn died before the prompt reached it.

**The request that killed it was a request for the mode already in effect.** `sendTurn` applies the
thread's interaction mode by calling `setPermissionMode`, and for `interactionMode: "default"` — what
every ordinary turn carries — the target is `basePermissionMode`, which is _the mode the session was
started with_. On a fresh session that is a no-op the CLI tolerates. On a resumed one it is refused,
and the refusal takes the turn with it.

The fix is the obvious one and would be right whatever the CLI did: **track the mode in effect and
call only on a change.** A control request whose success would change nothing is work that can only
fail.

**Two things this cost, both recorded:**

- The first attempt left `turn/setPermissionMode failed` and no cause at all. `toRequestError` now
  carries the rejection's own message — the same lesson `cause: [Object]` taught the intent path in
  D50, learned twice in three days.
- Two authorised turns on his account: one to reproduce with the cause visible, one to prove the
  fix. The second answered with what that session was doing on 14 September.

**Consequence:** an imported conversation is a conversation he can continue, not an archive he can
read. That is the whole difference between this feature and a transcript viewer.

---

## D56 — The amendment: continuity is the product, and voice is the point

**Decided** 2026-09-18. The specification never says this, and he called that a flaw in
the document. The document is not the authority; he is. Verbatim:

"I want all of my projects and the active sessions within those projects that I am
managing to work on to be in the T3 code, or whatever UI the Baton should have,
beautifully and functionally in threads there. If it is working and any kind of provider
reaches limits, it should automatically or manually swap seamlessly to the other
provider, and the coding and work mustn't ever stop unless it is stopped manually. That
was my hands-off vision for development and coding, but it is just a part, a small part
of the grand scheme of things, because what I envision is a completely hands-off computer
control using my voice. That is what Baton was brought to life for, across my devices,
across my agents, across my projects, and across platforms."

Three things follow, and they outrank the phase list:

1. **A limit is an event Baton absorbs, not an interruption he sees.** "The coding and work
   mustn't ever stop unless it is stopped manually" is the acceptance test for account
   rotation — not "a handoff exists", but that the work continued and he did not have to do
   anything. Same thread, same transcript, credential swapped underneath at a turn boundary.
2. **"Any kind of provider."** In-place rotation covers accounts behind one config directory;
   the §6.1 capsule covers a different directory or a different provider. Which mechanism ran
   is a detail he should never have to think about: one action, one policy, and the only place
   the difference is named is the timeline.
3. **Voice is the grand scheme; development is one slice.** Everything else is scaffolding for
   "completely hands-off computer control using my voice… across my devices, across my agents,
   across my projects, and across platforms." The reconciliation table judges every phase
   against that sentence rather than against the document's own list.

---

## D57 — One Claude instance, not three: the credential lives in the default config directory

**Decided** 2026-09-18, after the Director signed the second account back in and the
credential did not land where two of his three configured instances were pointing.

Measured on signzart, read-only, immediately after that sign-in:

```
/home/dev/.claude
  credentials file: present (2048 bytes, modified 19:06)
  loggedIn: true, authMethod: claude.ai

/home/dev/.local/share/claude-swap/sessions/1-signzartco_gmail.com
  credentials file: ABSENT            loggedIn: false, authMethod: none

/home/dev/.local/share/claude-swap/sessions/2-rabeehanzla_gmail.com
  credentials file: ABSENT            loggedIn: false, authMethod: none
```

**That is cswap's actual model.** One config directory holds the live credential, and the
store swaps the account underneath it — its log reads `Backed up account 3 / Wrote target
credentials / Updated config file / Switched from account 3 to 1`, and its own comment on
the publish step is "nothing can fail after the file is published". The
`sessions/<n>-<email>` directories are materialised for `cswap run`, which is a
this-terminal-only affordance; one of them held a credential file at 15:16 and cswap had
removed it by 19:06 (`Invalidated session credentials for account 1`).

**So three provider instances was the wrong shape, and the reason is not preference.** Two
of them pointed at directories with no credential, which is why they reported themselves
authenticated with no address and unreadable limits — the state that reads identically to
an expired login and sent this author looking in the wrong place twice. Worse, a separate
config directory is precisely the thing that **cannot** continue another directory's
threads: upstream refuses a resume across instances whose continuation identity differs.
Three instances would have made rotation impossible by construction.

**The correct shape is one Claude instance on the default config directory, with Baton
rotating the account under it.** That is what `fabric.account.use` does, and it is why the
same thread, session id, transcript and working directory survive a switch.

**Done:** both instances removed from `~/.t3/userdata/settings.json` on signzart and on
onnyx, each with a timestamped backup of the file beside it, and both servers restarted
and answering. The default `claudeAgent` instance remains, and it is the one the pool
rotates.

---

## D58 — Ghostty does not replace tmux, and T3's terminal is already Ghostty

**Asked** 2026-09-18: "we need to replace tmux with Herdr and Ghostty if it is good enough
or in the vision." §8.2 says the raw terminal is secondary, to use T3's terminal where it is
sufficient, to evaluate `libghostty` later only if a stronger embedded terminal is materially
useful, and not to block V1 on it. This answers the question directly rather than deferring
it again.

**Ghostty is a terminal emulator that runs on his laptop. tmux's job is keeping a process
alive on the server after the client goes away.** Those are different layers, and no
emulator can do the second one: it is not on the machine where the work runs. Closing the
window still kills what is inside it. So Ghostty cannot replace tmux, however good it is —
and it is good.

**What replaces tmux is Herdr plus T3's own terminal surface**, and the mechanism was
measured on this box tonight rather than assumed:

```
herdr server (pid 1393201, its own systemd-independent process)
  └── /bin/bash (1393244)        ← the pane
        └── claude (1762158)     ← the agent, reported as blocked → needs_input
```

No client, no ssh session and no editor appears in that chain. The agent outlived the shell
that started it, which is the whole property tmux is kept around for.

**The part that is already decided: T3's terminal _is_ Ghostty.** `apps/web/src/terminal/
ghostty/` is the browser adapter for the official `libghostty-vt` C ABI, pinned at
`native/libghostty-vt/`, and `apps/mobile/modules/t3-terminal/` uses the same ABI. The VT
engine question §8.2 left open is answered in the affirmative and shipped; what is _not_
embedded is Ghostty's own GPU renderer and desktop app, and nothing here needs them. (All 89
tests under `apps/web/src/terminal/ghostty` pass in this worktree under both `vitest` and
`vp test`; the three failures reported to this lane did not reproduce.)

**What T3's terminal is still missing for him to live in it.** Three gaps, each read out of
the code rather than guessed:

1. **It dies with the server.** A terminal is a PTY owned by the T3 server process, so a
   deploy, an update or an OOM takes every terminal with it. History is persisted and
   replayed; the running process is not, and cannot be. A Herdr pane survives all three,
   because Herdr is a separate supervisor.
2. **Every terminal belongs to a thread.** `TerminalOpenInput` is keyed by `threadId` +
   `terminalId`, so there is no terminal that is simply "this project" or "this machine" —
   which is most of what tmux gets used for.
3. **A terminal opened outside T3 is only ever an adopted pane.** Adoption gives pane text
   and input; `HERDR_CAPABILITIES` deliberately leaves `readConversation`, `approvals` and
   `diffs` false, because a pane has no structured conversation to read.

**`libghostty` closes none of the three.** They are process-lifecycle and scoping problems;
the VT engine is a renderer, and we already have it. So §8.2's "evaluate later" resolves to:
nothing further to embed, and the work that matters is routing T3's terminal at a Herdr pane
so it inherits that survival, which is queued rather than pretended.

## D59 — A terminal that is not an agent is `monitoring` or `idle`, and adoptable

**Decided** 2026-09-18, once Herdr was installed and discovery ran against it.
**Refines** D38. **Implements** §9.

D38 refuses a runtime state Baton does not know rather than calling it `idle`,
and that stays. The first live discovery showed the rule swallowing the case §9
was written for.

Herdr gives every pane an `agent_status`, and for a pane that is not a
recognised coding agent — an infrastructure terminal, a test watcher, a
`tail -f`, the examples in this contract's own docstring — that value is
`unknown`. Under D38 alone such a pane was **discoverable and never adoptable**:
`herdr reported a state Baton does not know: 'unknown'`, every time, forever.

`unknown` is not a word Baton failed to learn. It is Herdr saying it has no
agent state to give. So it falls through to another fact Herdr reports rather
than to a guess — whether the pane has a foreground process:

| Herdr says                              | Baton calls it        |
| --------------------------------------- | --------------------- |
| `blocked` / `working` / `done` / `idle` | §9's table, unchanged |
| `unknown`, something running            | `monitoring`          |
| `unknown`, a bare prompt                | `idle`                |
| anything else                           | refused (D38)         |

`monitoring` rather than `working`, which would claim an agent is mid-turn, and
rather than `idle`, which would sort a live terminal to the bottom of the fleet.
§10 already uses `monitoring` for a watch loop, and an unclassified live terminal
is exactly that. **Neither answer is in `BATON_STATES_NEEDING_USER`**: an
adopted terminal never raises "needs me" on an inference. Only `blocked` does.

**The fact has to travel with the candidate.** State is derived on the server so
a client cannot invent one, which means adopting a pane has to supply the same
observation discovery had. `AdoptedSessionCandidate` and `AdoptedRegisterInput`
carry `foreground` for that reason — the observation, what is running, not a
state.

**"Is anything running" is not "is the process list non-empty".** A pane at a
bare prompt reports one foreground process: the shell. The two are told apart by
whether the foreground process group is the shell's own:

```text
idle    fg_pgid=1393244  shell_pid=1393244  [(1393244, "/bin/bash")]
busy    fg_pgid=1419932  shell_pid=1393241  [(1419932, "bash …/ticker.sh"), …]
```

Both shapes are committed in `apps/server/src/baton/__fixtures__/herdr-0.9.1/`,
captured from two live panes side by side. The invented version of that check
read every idle terminal as busy, and only the real capture showed it.

---

## D60 — Reading an adopted terminal is `showTerminal`, never `readConversation`

**Decided** 2026-09-18, during Phase 8's completion.

`fabric.adopted.readOutput` returns the text on a pane. It is gated on
`showTerminal`, which is the capability it exercises: §21's "show X", answered on
the server for a client that has no terminal of its own to render into.

It is emphatically **not** `readConversation`, which stays false for every
adopted session. There is no structured conversation on a session Baton did not
start — no turns, no roles, no approvals — only characters a program wrote to a
terminal. A capability check that conflated the two would be exactly the pretence
§9 exists to prevent, and would put a "read the conversation" button on a session
that has none.

The read is bounded (1–2000 lines, 200 by default) and asks Herdr for
`recent-unwrapped`, because a transcript line a soft wrap split in two is one
line of work, and reading it as two is how a log stops being searchable.

---

## D61 — T3's terminal is a Herdr session client, by machine

**Decided** 2026-10-26, closing D58's first gap. With `T3CODE_FABRIC_TERMINAL_RUNTIME=herdr` in the
service environment, the terminal manager spawns `herdr --session t3-<thread>-<terminal>` instead
of a shell, with the ordinary shells behind it as fallbacks. The PTY T3 owns is only a Herdr client;
the shell and its children belong to Herdr's own server, so a T3 restart, deploy or OOM takes the
client and not the work. Reopening the terminal runs the same command and re-attaches. An explicit
close stops and deletes the session, because closing is the user ending it.

Proven live (`apps/server/scripts/baton-herdr-terminal-proof.ts`, herdr 0.9.5): `sleep 7777` in the
pane, the pty killed with SIGKILL, the process still alive, the re-attach seeing the same pid, and
after the close path the process gone and the session unlisted.

Rejected: a setting in `settings.json` (a per-machine fact, and no client renders it yet; upgrade
when one does); wrapping T3's provider processes in Herdr (§9 principle 1).

## D62 — Handoff to another instance is a capsule plus a new thread in the same worktree

**Decided** 2026-10-26. `fabric.workSession.handoff` implements §6.1 for every move in-place
rotation (D56/D57) cannot make: another driver, another config directory. It refuses before
creating anything (same instance: rotate instead; not configured; not signed in), reads the
checkout's branch and dirty files, builds the capsule from the work session and its capped
synopsis (`buildHandoffCapsule`, pure and tested), creates the thread in the same worktree,
attaches it active, sends the capsule as the first turn, and only then closes the previous thread
onto the timeline. A failure after the thread exists detaches it and restores the previous active
thread. The resume intent ("continue X with Codex") now starts from the same capsule rather than
an empty prompt. Not auto-triggered (§29 Phase 3: no silent switches in V1).

## D63 — Automatic rotation is a trigger on the limits T3 already reads

**Decided** 2026-10-26 (queue item 5). `AccountRotationReactor` reads the Claude account pool every
two minutes and hands it to the existing `decideRotation` policy; a spent window counts as a reported
limit. One automatic rotation per limit window, the cooldown and hysteresis stay in the policy.
Enabled per machine with `T3CODE_FABRIC_ON_LIMIT=auto` (both boxes, drop-in
`fabric-on-limit.conf`); anything else is "ask", so a stock install never rotates on its own. This
honours D56 ("the work mustn't ever stop") over §29 Phase 3's "no silent switch in V1", which D56
already outranks. Known limit: the turn boundary is not enforced; a swap mid-turn takes effect on
the next turn because the running CLI already holds its token.

## D64 — Airdeck is Baton's hands-free input device, joined by an input spot

**Decided** 2026-10-26. Airdeck (RabHanz/airdeck) already hops between saved "input spots" found by
UI Automation, and Wispr push-to-talk types into whichever has focus. So the seam is a spot, not a
new protocol: the intent bar carries `id="fabric-intent-input"` (Chromium's UI Automation id) and
`aria-label="Say what you want"`, and the web server publishes `/fabric/airdeck-spots.json` in
Airdeck's own `spots.json` shape. Airdeck's "Import Baton input spots" (RabHanz/airdeck#1, not
compiled here) adds them. Text arriving in the bar is routed by the intent surface to the focused
work session (§14), so nothing Airdeck sends bypasses the gates the bar already has. A test pins
the file to the input's real id, name and the page title.

Rejected: a loopback HTTP input endpoint on T3 (Airdeck runs on the laptop, T3 on the boxes, and a
network text-injection endpoint would be a new trust boundary for no gain over the bar).

## D65 — Herdr's agents are listed in the fleet, from every named session

**Decided** 2026-10-26, after the Herdr walkthrough (`docs/baton/research/herdr-0.9.5-2026-10-26/`).
Herdr 0.9.5 is the agent runtime (spaces, tabs, agents panel, restore, remote attach); Baton adopts
it instead of rebuilding it. Discovery now walks every running Herdr session (`herdr session list`,
then `--session <name> api snapshot`), so agents in T3's own Herdr-backed terminals (D61) are found.
The fleet carries them as `herdr` (cached 15 s server-side, polled 20 s by the client), and a blocked
agent's last 12 lines ride along as `blockedPrompt`, shown in place in the sidebar. A non-default
session is carried in the pane ref as `<session>~<pane>` so adopted rows need no migration.

"Come back from any machine" is Herdr's own: T3 on any device already reaches each box's terminals
(D61), and box to box it is `herdr --remote <ssh-target> --session <name>` per the snapshot docs.
Not wired: a T3 terminal on one box attached to a Herdr session on the other, because the boxes'
SSH route needs a dedicated key alias that a T3 terminal does not have.

## D66 — The desktop owns the microphone, the HUD and where the words go

**Decided** 2026-10-26. **Amends** D24 for the desktop only. The Director wants Baton hands-free and
always listening through his DJI mic, or any mic, with nothing touched. D24 kept speech out of the
fork because the server sits on a box with no microphone. That still holds for the server. The
desktop app does sit next to the mic, so it captures audio and hands it to the voice core
(`packages/baton-voice`, a separate lane). Everything after the core still ends as text through the
same grammar and gates, so D24's rule that a phone, a laptop and a keyboard mean the same thing
holds.

- **Capture** (`apps/desktop/src/baton/voice/`): Chromium's `getUserMedia` in a hidden window, so
  a DJI receiver is an ordinary device. No native module and no driver. The page sends float PCM,
  and `pcm.ts` turns it into 16 kHz mono int16 in 20 ms frames.
- **Device pin**: by normalised _name_, never by id. Windows renumbers a USB receiver on replug
  ("(2- DJI MIC MINI)" becomes "(3- …)"), so an id pin is lost the first time it is unplugged. When
  the pinned mic is missing, capture falls back to the OS default and says which one is missing. A
  `devicechange` moves capture back when the mic returns.
- **Hard mute** is enforced in `voiceLoop.ts`: no frame reaches the core while muted.
- **Routing**: dictation is pasted into the focused field on Windows (the clipboard rung of Phase
  6's `TextInjectionAdapter`) and never leaves the machine. Direct-session speech becomes
  `Tell it: <words>` and command speech goes as said. Both reach the intent bar over
  `desktopBridge.onBatonVoiceUtterance` and run through `fabric.intent.run`, the same path as a
  typed sentence.
- **Opt-in**: "Always listening" and "Start Baton when I sign in" are tray checkboxes, both off by
  default, saved in `fabric-voice.json` in the state dir.
- **Airdeck** is an explicit activation provider through global hotkeys, which Airdeck's `"keys"`
  action can already send. Airdeck needs no code change. The chords stay clear of Airdeck's own
  F9 to F12:

  | Chord               | Does                    | Airdeck profile entry                               |
  | ------------------- | ----------------------- | --------------------------------------------------- |
  | `Ctrl+Alt+Shift+F5` | wake (unmutes if muted) | `{ "action": "keys", "keys": "ctrl+alt+shift+f5" }` |
  | `Ctrl+Alt+Shift+F6` | toggle direct-session   | `{ "action": "keys", "keys": "ctrl+alt+shift+f6" }` |
  | `Ctrl+Alt+Shift+F7` | toggle mute             | `{ "action": "keys", "keys": "ctrl+alt+shift+f7" }` |

**The core seam.** `voiceTypes.ts` uses §12.2's names, `AudioInputProvider` included, and declares
`VoiceCore` (`pushAudio`, `activate`, `onState`, `onUtterance`). `DesktopApp`'s `makeCore` builds
the real core (`desktopVoiceCore.ts`: openWakeWord, Silero, whisper.cpp, OS TTS) with the core's own
router, so its rules hold on the desktop: high risk is refused by voice, medium risk needs a later
"confirm", and dictation stays local. The router's four calls are answered here. `resolve` and `run`
go to the Baton window's intent bar over `desktopBridge.onBatonVoiceRequest`; `sendToSession`
becomes `Tell it: <words>` with that session pinned; `insertText` is the paste adapter. The window
reports the session on screen (`setBatonVoiceFocus`), which becomes the context bus's rung 3.
Models and `whisper-cli(.exe)` are read from `<state dir>/voice/`, or from `BATON_VOICE_MODELS` /
`BATON_WHISPER_CLI`, or from `modelsDir` / `whisperCli` in `fabric-voice.json`. If any are missing,
the tray names them and no mic is opened.

**The Windows installer** cannot be cross-built here. `scripts/build-desktop-artifact.ts --platform
win` compiles Rust helpers for `x86_64-pc-windows-msvc` and needs the Visual Studio Build Tools, so
it runs on Windows: `pnpm install` then `pnpm run dist:desktop:win:x64`, with the prerequisites in
`docs/operations/development.md#windows-installer-prerequisites`.

Rejected: a loopback HTTP endpoint for Airdeck (D64's reason still applies, and hotkeys need nothing
new on Airdeck's side); pinning by device id (lost on replug); a native audio module such as
naudiodon (a Windows build dependency for something Chromium already does).

**Not proven:** nothing has run on Windows. The loop is proven headless: `voiceLoop.test.ts` (a
48 kHz stereo WAV, resampled, framed, routed, hard-muted) and `desktopVoiceCore.test.ts` (the voice
lane's espeak fixtures as the mic, through the real core, down to the HUD's last-words line). The
tray, HUD, `getUserMedia` capture and SendKeys paste have not been run on a Windows desktop.

## D68 — One control surface for every session, independent of the account

**Decided** 2026-10-26 on the Director's priority 1: Claude Remote Control is bound to an account,
so every account change broke his control channel. Baton's channel is the session's _place_, not
its account:

- **The list.** Each environment's fleet now also carries every interactive Claude Code process on
  the machine, read from Claude Code's own `~/.claude/sessions/<pid>.json` descriptors (conversation
  id, directory, name, busy/idle, entrypoint cli/VS Code, tmux) and, from `/proc/<pid>/environ`,
  only the `HERDR_*` routing variables, which say which Herdr pane hosts it. The `.key` files and
  the peer messaging socket beside them are never opened. The account is the pool's active account,
  because every session shares one config directory (D57). The T3 client already merges both
  boxes' environments, on the phone and the laptop.
- **The send.** `fabric.herdr.send` types into any pane a fresh discovery sees, through the adopted
  capability gate; the sidebar gives every Herdr row and every Claude session in Herdr one field.
  A session in a plain terminal or VS Code is listed, not typed into: the only way into a running
  CLI that is not in a pane is Claude Code's private peer socket, so its row says
  `fab --resume <id>` instead.
- **Birth inside Baton.** `fab <project> [claude|codex]` (scripts/baton/fab, installed to
  `~/.local/bin/fab`) starts the agent in a tab of the project's Herdr space, so new work is
  sendable and survivable from the start.

## D69 — Rotation restarts Herdr-hosted sessions on the new account, same conversation

After D63 rotates the account, each idle Claude session hosted in a Herdr pane gets `/exit` and,
once its shell is back, `claude --resume <id>` in the same pane: same conversation, same pane, same
send path, no Remote Control step. Busy sessions are skipped (still working means not limited).

## D70 — Box-to-box attach is Herdr's own `--remote`, with the key given to one command

**Decided** 2026-10-26. Herdr's `--remote` runs plain `ssh` and reads the user's SSH config; the
box-to-box key lives at `~/.config/venture-ssh/` and is in no SSH config. `fab-remote <target>
[session]` (scripts/baton/fab-remote) puts a throwaway `ssh` shim first on PATH for that one
command, adding `-i <key> -o IdentitiesOnly=yes -o BatchMode=yes`; nothing on the machine changes.
Proven signzart → onnyx: a pane on onnyx printing `REMOTE-OK-onnyx` rendered in the local client.
**onnyx → signzart is blocked**: onnyx holds no key for signzart, and signzart's SSH is Tailscale SSH
in check mode, which asks for a browser login at login.tailscale.com before any key is consulted.
The Director either approves that check for onnyx or adds a key for `dev@signzart-prod`.

## D71 — Fabric is renamed Baton; persisted and wire names keep "fabric"

**Decided** 2026-10-26 by the Director: _"Baton is cooler, shorter, and punchier."_ The repo is
`github.com/RabHanz/baton`. Everything a person reads or a developer types is renamed: the product
name in UI strings, these docs (`docs/fabric/` → `docs/baton/`), the voice package
(`@t3tools/baton-voice`), our own source files, directories and exported identifiers
(`apps/server/src/baton/`, `packages/contracts/src/baton/`, `Baton*`, `BATON_*`), the CLI
(`baton`, `baton-remote`) and the version label (`0.0.43-baton.N`, numbering carried on from
`fabric.16`, so the first is `baton.17`). Older entries in this file are renamed in place, except
quotes, version labels and branch names, which are history.

Kept, because renaming them would break a running install or a client already in someone's hand:

| Kept as                                                                              | What it is                                     | Why it cannot move                                                                                        |
| ------------------------------------------------------------------------------------ | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `fabric_sql_migrations`, the seven `fabric_*` tables, `idx_fabric_*`                 | SQLite schema in `userdata/state.sqlite`       | live databases; migration files are moved, byte-identical                                                 |
| `FabricWorkSessions` … `FabricAdoptedSessions` (legacy migration names)              | rows D48 reclaims from `effect_sql_migrations` | the reclaim matches on them                                                                               |
| `fabric.*` RPC methods, `fabric.*` event types, `Fabric*Error` tags                  | the wire and the event store                   | installed phone and desktop builds call them; stored events replay                                        |
| `fabricWorkSessionsEnabled`                                                          | client settings key                            | renaming resets the toggle for everyone                                                                   |
| `fabricWorkSessions` capability                                                      | server environment descriptor                  | older clients check for it                                                                                |
| `"fabric"` account-pool source and context producer                                  | stored and published values                    | written by running servers and producers                                                                  |
| `T3CODE_FABRIC_ON_LIMIT`, `T3CODE_FABRIC_TERMINAL_RUNTIME`                           | env vars                                       | set by drop-ins on both boxes                                                                             |
| `fabric-*.conf` drop-ins                                                             | systemd files on both boxes                    | rollback is "edit or delete one file"; renaming them changes that                                         |
| `/fabric/airdeck-spots.json`, `id="fabric-intent-input"`, `data-fabric-intent-input` | Airdeck route and match keys                   | imported spots match them; `/baton/airdeck-spots.json` serves the same file (a test keeps them identical) |
| `t3code://fabric/…` deep link                                                        | mobile route                                   | links already issued; the parser accepts `fabric/` and `baton/`                                           |
| `fabric-voice` Electron partition, `fabric-voice.json`                               | desktop userdata                               | the mic grant and voice settings live there                                                               |
| `fab-<project>` Herdr session names                                                  | live Herdr sessions                            | `baton <project>` rejoins spaces `fab` started                                                            |

`fab` and `fab-remote` remain as aliases that print one line on stderr and run `baton` /
`baton-remote` unchanged; `FAB_ROOTS` and `FAB_REMOTE_IDENTITY` are read when the `BATON_` names
are unset. Each kept name carries a one-line "Legacy name (D71)" comment where it is defined.
Because nothing persisted changed, the proof that an existing userdata opens is the deploy itself:
`baton.17` started on both boxes' live `userdata` with no migration to run. `0.0.43-baton.17`
sorts below `0.0.43-fabric.16` in semver (`b` < `f`); nothing here compares fork versions (the
drop-in names the exact path), but `t3 update` must never be pointed at a fork build.

## The P1 proof, 2026-10-26 (frames in `frames/p1-2026-10-26/`)

1. `fab fabproof claude` twice: two Claude Code sessions in one Herdr space, both on the same
   account (optima). The phone-width (390 px) sidebar lists both, plus the orchestrator session in a
   VS Code terminal, each with state and account (`1-every-session-390.png`).
2. One field each: "ALPHA" and "BRAVO" sent from that view; each pane answered (`2-…`).
3. Pane 1 restarted by the D69 path (`/exit`, then `claude --resume <id>` in the same pane): new pid,
   same session id. Asked from the same view "which word did you reply with earlier?" it answered
   ALPHA; pane 2 answered CHARLIE (`3-…`). The cswap credential swap itself was **not** fired live
   for this proof, because it moves every session on the box including the orchestrator; it was
   proven by hand in PR #21 and is what D63 calls before D69 runs.
4. On a userdata copy (`VACUUM`-style backup, its own server on :3790): "Start work on VentureOS
   called handoff proof with claude" from the intent bar, then **Continue with… → Codex**. The work
   moved to a Codex thread, which took a real turn on the capsule and asked for its first command
   approval (`4-continue-with-codex.png`).

## D72 — One entry per project, across boxes and accounts

**Decided** 2026-10-26 on the Director's binding shape: _"different sessions are one surface, even
across accounts. One project, regardless of the account, shows as one session if it is running, or
multiple."_ The sidebar's Baton block is now an input plus **Projects**: every connected
environment's fleet (T3 work sessions, Claude Code sessions, Herdr panes) is merged in the client,
grouped by a project key, one line when one session runs. The key is T3's own repository identity
(`RepositoryIdentityResolver`, the canonical remote) on both sides, so a checkout on signzart and one
on onnyx at different paths are one project; a directory with no remote falls back to `dir:<folder>`.
Accounts and boxes are attributes on a row, never a place to go.

Merging happens in the client because the client is already where T3 joins environments (it groups
logical projects across environments the same way); the server adds only the project ref. On the
phone, the T3 app shows both boxes when both environments are added to it.

Row identity: a Claude row is keyed by its conversation id, a work row by its work session id. A
rotation (D69, same id resumed), an adoption into Herdr (D74, same id) and a "Continue with…"
handoff (D62, same work session) therefore keep the row; only its attributes change. SDK-driven
Claude sessions (`entrypoint: sdk-*`) are not listed: their owner is a program.

## D73 — A file goes into the session's own directory, and the message carries its path

`baton.live.attach` writes up to 8 MB into `<session cwd>/.baton/inbox/<stamp>-<safe name>` (mode
600, `.baton/` appended to the repository's `info/exclude`, never `.gitignore`), and the client
sends the text with `@<path>`, which Claude Code reads as a file reference and a shell takes as a
path. The name is reduced to a basename and a safe character set before it touches the disk.

## D74 — A session outside Herdr is adopted in one tap, never reached through Claude's socket

A Claude session in a plain terminal or VS Code has no input path Baton may use: its only one is
Claude Code's private peer socket (`messagingSocketPath` with a `.key`), which stays closed. Its row
offers **Bring into Herdr to send**: after a confirm, and only when Claude Code reports it idle,
Baton sends it SIGTERM, waits for it to exit, and runs `baton --resume <id> <cwd>`, which reopens the
same conversation in the project's Herdr space. The row keeps its key and gains a Send box.

## D75 — onnyx OOM protection needs one root command

A user unit cannot set `OOMScoreAdjust` below its manager's `DefaultOOMScoreAdjust=200`, and the
onnyx askpass refuses non-interactive use, so `sudo choom` fails there. The fix is one root command
on onnyx, after which the user unit's `OOMScoreAdjust=-900` is allowed:

```bash
sudo mkdir -p /etc/systemd/system/user@1000.service.d
printf '[Service]\nOOMScoreAdjust=-900\n' | sudo tee /etc/systemd/system/user@1000.service.d/baton-oom.conf
sudo systemctl daemon-reload && sudo systemctl restart user@1000.service
```

Not applied by an agent: it restarts the user manager (every user service on the box).

## D76 — The vendor tree stays at the repository root; a patch series and a gate keep it untouched

The port plan drew upstream under `vendor/t3code/`. Doing that moves every path upstream's own
tooling assumes: the workspace globs, the root `package.json` scripts, `vite.config.ts`, and the
release chain in `scripts/` that builds the CLI archive we deploy. Each would need a Baton edit to
find the moved tree, so the subdirectory adds patch points instead of removing them.

The subdirectory's purpose is met another way. `vendor-patches/t3code/` holds the pin (`PIN`), the
ordered `series`, and one patch per concern. `scripts/baton/patches.sh verify` proves that every
path upstream owns equals the pin plus the series, so an edit that bypasses the series fails the
gate. A sync is `patches.sh rebase <commit>`: upstream's paths become the new commit's, and the
series re-applies with `--3way`. `pnpm-lock.yaml` is listed in `REGENERATED` and re-resolved on
every sync, because a lockfile patch would conflict on every upstream release.

Rejected: `git subtree` under `vendor/` (above). A Debian-style overlay that assembles a build tree
from pristine sources at build time, because every edit would then happen in a generated copy and
the deploy would build from something that is not the commit. Plain `git merge upstream`, because
nothing answers "what does Baton change in upstream", and a conflict is resolved once, inside a
merge commit, where nobody can re-run it.

## D77 — The gates run locally, because upstream's CI cannot run in this repository

Upstream's `ci.yml` runs on Blacksmith runners. RabHanz/baton has none, so its runs queue forever
(PR #4's did). The gates are `scripts/baton/gates.sh`: the patch-series verify and its self-test,
typecheck, lint, the tests of every package Baton adds to or patches, and the build. The sync job
runs the same script, so a sync meets the same bar as a hand-made change.

## D78 — Baton's code moves into its own packages when the port rewrites it, not before

The plan's `packages/baton-server`, `baton-contracts` and `baton-web` are the end state. At the
pre-v2 pin, though, Baton's server code imports the v1 engine, the v1 Sqlite layer and server
internals that are not a package, and `contracts/rpc.ts` would import a package that imports
`@t3tools/contracts` back. Moving it now means moving it twice: once at v1, and again when the port
rewrites every one of those imports against v2. So Phase A ships the series and the sync. The
package split happens in Phase B as part of the rewrite, with the RPC group merged at the server and
the client so contracts never import Baton.

Done in Phase B as: `packages/baton-contracts` (the `fabric.*` schemas and `BatonRpcGroup`, plus a
re-export of `@t3tools/contracts` so Baton files import one module) and `packages/baton-shared`
(the pure logic and the client's work-session atoms). Server code stays in `apps/server/src/baton/`
and web code in `apps/web/src/components/sidebar/Baton*`: both are new files, never patches, and
moving them into packages would need upstream's apps to export internals they do not export.

## D79 — Baton reaches upstream's engine through one service, `BatonEngine`

Six Baton modules called the v1 engine directly, which is why the v2 move was a port rather than a
merge. Now one file, `apps/server/src/baton/BatonEngine.ts`, holds every call into
`orchestration-v2`: thread shells, projects, the domain-event stream, launching a thread (upstream's
`ThreadLaunchService`), sending a message (`ThreadManagementService.sendToThread`), switching
provider and settling (`provider.switch`, `thread.settle`). It also maps a v2 thread shell onto the
§10 ladder (`batonStateInputFromShell`). The next engine change upstream makes is a change to this
file. The model one-shots (D50, D51) run `claude -p --json-schema` through `BatonOneShot`, because
upstream's text generation exposes only its own five operations; they run as the box's primary
Claude home, which is the account cswap has active.

## D80 — "Continue with…" is upstream's `provider.switch`; Baton's capsule is gone

D62 moved work to another provider by starting a second thread seeded with a capsule. Upstream v2
switches the provider on the same thread and carries the context with its own handoff service, so
the thread keeps its id and history, and the work session keeps its thread. `fabric.workSession.handoff`
keeps its name and refusals and now dispatches `provider.switch`; an optional note is sent as the
first message on the new provider. The capsule schema and builder are deleted. Settling a work
session also settles its threads in upstream, so T3's own sidebar agrees.

Also adopted from upstream rather than ported (the plan's list): restart resume and waiting out a
limit (upstream's recovery workers), large-transcript import and its UI (upstream's scanner and
importer; Baton's import dialog, presence section and landing are deleted), the Claude usage-probe
deadline (upstream bounds it). Kept as Baton's: account rotation (D63, D69), adoption and live
sessions (D68, D73, D74), work sessions, rules, intents, synopsis, Herdr.

## D81 — Herdr terminals stay a two-line hook, not a PtyAdapter

The plan expected v2's `PtyAdapter` service to absorb D61. The adapter receives a shell, arguments,
a cwd and an environment, but not the thread and terminal it serves, and upstream strips `T3CODE_*`
variables from the terminal's environment. The Herdr session name has to be stable per terminal or
a reopened terminal cannot re-attach. So `terminal/Manager.ts` keeps two hooks into
`baton/HerdrTerminal.ts`: one wraps the spawn candidates, one ends the Herdr session on close.
Upstream's own `survivesRestart` puts the terminal's process in a separate systemd slice, which
keeps it alive across a restart but leaves nothing to re-attach to, so it does not replace Herdr.

## D82 — Baton files that predate upstream's newer lint and Effect rules opt out per file

Upstream's v2 tree enforces rules Baton's code predates: comments of at most four lines,
`Effect.fn` for every generator, no manual memoisation and no effects in React files, no em dashes in
copy. Bringing roughly 360 findings in 116 Baton files up to them is real work that would hold the
port back. Each such file carries a first-line `oxlint-disable` (or `@effect-diagnostics`) naming
the rules it is exempt from and pointing here. New Baton files follow upstream's rules. Phase C
rewrites the web block from T3's components and drops those headers there; the server files lose
theirs as they are next touched.

## D83 — Live Claude Code sessions are ordinary T3 threads, so the official apps show them

The Director uses T3's official phone, desktop and web apps, which carry none of Baton's sidebar
code, so he saw none of his sessions. The official apps render the server's read model and nothing
else, so the fix is server-side: `apps/server/src/baton/LiveSessionMirror.ts` turns every session
in Claude Code's registry (`~/.claude/sessions/*.json`, D68; SDK sessions excluded) into a thread
`baton-live:<claude session id>` under the T3 project that holds its directory (deepest workspace
root, else same repository key, else a new project), written with the same events upstream's
agent-session import writes, and follows the transcript by Claude Code's record `uuid`.

Sending uses T3's own extension point rather than a patch: the thread's provider is a "Live
session" instance of upstream's **ACP Registry → Local command** driver, running
`scripts/baton/live/baton-live-acp.mjs` (Node built-ins; installed to `~/.t3/baton/` by
`deploy-beside.sh`; the server registers the instance in settings at start). `session/resume`
binds to the conversation id; `session/prompt` strips T3's instruction wrappers, copies
attachments into `<cwd>/.baton/inbox/` as `@path` (D73), types through `herdr agent prompt`
(bracketed paste), adopts an idle plain-terminal session into Herdr first (D74), and ends the turn
when Claude Code reports idle. The agent writes no content: the mirror is the one writer, and skips
the transcript copy of a message T3's composer already recorded.

Identity: the thread id is the conversation id, which rotation (`claude --resume`, D69) and
adoption keep, so the thread survives both (rehearsed). Each box's threads sit under its own
VentureOS project, which the official client already merges by repository identity.

Rejected: a custom provider driver (needs `builtInDrivers.ts` patched); intercepting the composer
send in `ThreadMessageIntake` (a patch on upstream's hottest path); synthetic runs for
terminal-driven turns (T3's recovery services act on runs they did not start).

Known limits: runless items sort before every run, so a message written after a composer turn is
attached to the thread's latest run; a terminal-typed turn after a composer turn therefore shows
inside that run, and the run's earlier reply folds under "Worked for…". Status is native only for
composer turns (Working/Completed); a session working from its terminal does not read as Working.
The account is not shown. Patch cost: one line in 0002 exposing the runtime's memoized `EventSink`
to Baton. Off per machine with `BATON_LIVE_THREADS=off`. Frames: `frames/live-threads-2026-10-27/`.

**D83 round 2 (2026-10-27, `0.1.2-baton.31` on both boxes).** Supersedes the "Known limits" above:

- **No plumbing as messages.** T3 prefixes a context handoff as `<context>\n\nUser message:\n<text>`
  when a thread holds history its provider has not seen; the agent now sends only the text after
  the marker (the round-1 leak typed the handoff into Claude itself), and never types T3's restart
  continuation ("Continue where you left off."). Claude Code's own user records
  (`<task-notification>`, command echoes, local command output, reminders) are not mirrored.
- **Terminal turns are turns.** A user message typed in the terminal opens a run
  (`baton-live:run:<session>:<uuid>`, no provider attempt), so it renders as its own turn and the
  thread reads **Working** while Claude Code reports busy; the run completes on idle and dispatches
  `queue.resume` so a composer message queued behind it starts. T3's startup reconcile cancels such
  a run; if the session is still busy Baton reopens it (timer from now). A thread with no runs gets
  one around its last user message, so idle threads read Done, not Waiting.
- **Title = session name · account · box** (T3's lists render only the title). The account is the
  config directory's `oauthAccount`; a thread keeps its first name across restarts unless the
  session was named by a person; T3's auto-title is re-asserted away.
- **Sessions under every config dir**: `~/.claude`, claude-swap `cswap run` profiles, `~/.claude-*`,
  `BATON_CLAUDE_CONFIG_DIRS`.
- **Real rotation proven** on onnyx with an isolated profile: `CLAUDE_CONFIG_DIR=<profile> cswap
  switch 3` (rabeehanzla → optimapacifist), `/exit`, `claude --resume <id>` in the same Herdr pane:
  same thread id, history kept, title account updated, composer send answered. The orchestrator
  session and the default profiles were not touched.

Still not done: a terminal turn after a composer turn on a session busy _without_ a new user
message (e.g. resumed work after a restart) shows Working only via the reopen rule; runs carry no
provider attempt, so T3 features keyed to attempts (retry, checkpoints) do not apply to them.

**D83 round 3 (2026-10-27, `0.1.2-baton.34` both boxes) — the Director's real sessions.** Misses
found on his five long-running sessions: home-network was hidden behind an old upstream _import_
snapshot of the same session (Baton treated it as owned) — the live thread now replaces an import
nobody continued, and that import is archived; rabee.dev was auto-settled for age and filed under
Settled — live threads now have auto-settle off and are unsettled; back-fill of older messages into
existing threads sorted them after newer ones — threads were rebuilt (`baton-live3:` ids; retired
ones deleted, the transcript is the record) and existing threads only take newer messages; finished
turns end at their last message. Transcript mapping was correct for all five (rabee.dev's newer
files are `sdk-cli` cron runs, not the live process). A plain-terminal / Remote Control session is
never restarted by a send: the reply says it was not delivered and that `bring into Herdr` moves
it (restart, Remote Control drops). No safe outside input path exists: Claude Code's peer socket is
private, and TIOCSTI is off on kernel 6.8.

## D84 — The screen companion: look, teach and drive, on his subscription, with his yes

The Director, 2026-10-27, after the Clicky research (`research/clicky-2026-10-27/`): build what
Clicky does, reuse its MIT code, and do not limit what may be captured, because that depends on
intent and his approval. The research's "never continuous, skip password windows" limits are not
used. User guide and the Windows checklist: `SCREEN.md`.

Built in `packages/baton-shared/src/screenCompanion.ts` (pure, tested without a display) and
`apps/desktop/src/baton/screen/` (Electron):

- **Look.** "What's this error?", "where is the export button", or anything typed into the
  Ctrl+Alt+Shift+F8 box. Every display is captured once (cursor's first, long edge 1280 px, as
  farzaa/clicky does), sent with the question, answered aloud (OS voice) and on a caption card,
  and the blue pointer flies to `[POINT:x,y:label:screenN]`. Follow-ups within five minutes share
  the conversation.
- **Teach.** "Teach me / show me how / walk me through …": one step at a time, each pointed at.
  Baton then watches a 320 px grey thumbnail, compared against the screenshot the step was judged
  from. When it changes and then holds still for two polls, Baton captures again and the model
  checks the previous step before giving the next, until `[DONE]`. "Next", "repeat" and "stop"
  work by voice. Thresholds were measured under Xvfb: a typed name changes 0.05 % of the
  thumbnail, a line of result text 0.15 %, a blinking caret 0.006 %.
- **Drive.** "Drive: …", "take over", "… for me". The model returns a `baton-drive` JSON plan.
  clicky-windows' validator (ported) refuses unknown kinds and fields, coordinates outside the
  screenshot, multi-line typing, the Windows key and security chords, and more than 20 steps. The
  plan's clicks are drawn as numbered dots, the steps are listed in an approval box, and nothing
  runs without "Run it". A screen that changed since the plan refuses it. While running, Esc,
  "stop" and moving the mouse more than 12 px stop it, a held button is always released, and each
  step that names what it `expect`s is checked against a fresh screenshot (`[OK]` or
  `[STOP: why]`). Input is one long-lived PowerShell calling user32 on Windows (per-monitor DPI
  aware, text pasted so any keyboard layout works), xdotool on Linux; macOS refuses by name.

**Approval.** Every capture asks first: allow once, for this lesson or drive, for an hour, or
always (also a tray checkbox). A drive plan always asks again, whatever that setting says.
Screenshots are held in memory for the request and never written to disk.

**The model is his subscription (D1).** The companion runs his own `claude` binary as a
long-lived `-p --input-format stream-json` conversation, screenshots as base64 image blocks, with
`--safe-mode` (no hooks, CLAUDE.md, MCP servers or plugins; auth kept), `--tools ""`, its own
system prompt, `--no-session-persistence`, and `ANTHROPIC_API_KEY` removed from the child's
environment. Measured on the box: 3.6 s for a screenshot question, `apiKeySource: none`, and the
subscription model's raw coordinates landed on the right element twice out of two (YouTube's
search box, the form's name field), so clicky-windows' grid locator was not needed. That answers
research C11/C12 for Sonnet.

**Voice.** `withScreenRoutes` sits in front of the voice router. A command `parseScreenIntent`
recognises goes to the companion; everything else goes to Baton's grammar unchanged. The parser
is deliberately narrow, so "show me the scheduler session" stays §21's show.

Rejected:

- **Sending the screenshot to the focused work session through D73**, the research's suggested
  first step. It puts screenshots into his work threads, cannot point, and a lesson needs its own
  conversation.
- **The Agent SDK or metered API calls**, Clicky's route: D1.
- **clicky-windows as a sidecar**: GPL-3.0 UI, a second voice stack, no inbound control API.
- **The `computer_*` computer-use tool**: API only, and plain vision on the subscription was
  accurate enough.
- **A native input module** (nut.js, robotjs): a native rebuild per Electron version, for what
  user32 through one PowerShell already does.

Proven on Linux with `scripts/baton/screen-smoke.sh` (Xvfb, a compositor, xdotool as the user, his
claude answering). Look pointed at the right field in 14 s. Teach gave step 1, noticed the typing
without a "next", confirmed it ("Rabee is in the name field, so that step worked"), pointed at the
next field, and finished on submit. Drive planned three steps, drew them, and after approval
filled the field and submitted ("Submitted: Baton Test"). Frames in
`frames/screen-companion-2026-10-27/`. Not proven: anything on Windows (DPI maths, PowerShell input,
SAPI voice, content protection keeping the overlay out of screenshots), more than one monitor, and
the voice path end to end with a microphone.

## D85 — Live threads: media, one alert per asked-for turn, sends that never queue, tool steps

The Director, 2026-10-29: live-session threads were text only, every reply alerted, the session
"still feels read-only through T3" with messages showing as queued, and replies arrived whole.

- **Media.** The mirror keeps what the transcript holds besides text. A pasted image (a `user`
  record's base64 `image` block) is copied into T3's attachment store under an id hashed from its
  bytes and becomes the user message's own image attachment. Files the session sent
  (`SendUserFile` `files: [...]`) are copied into the same store and added to the assistant
  message as markdown, because T3 renders an assistant message's images and file links from its
  markdown (upstream's `media-file` assets): images inline, anything else a file link. Only paths
  the session itself sent or bytes the user pasted are read; a missing file is named in a quiet
  note; images cap at T3's 10 MB, other files at 20 MB. Threads were rebuilt as `baton-live4:`
  (the transcript is the record), so history shows its media too.
- **Sends never queue.** The agent's `session/prompt` held the ACP turn open until Claude Code
  went idle. A busy session (the orchestrator, nearly always) therefore had one running T3 run,
  and T3 queued every later message in itself. The prompt now ends once Herdr has delivered the
  text; Claude Code takes input mid-turn itself ("the user sent a new message while you were
  working"). Stop sends Esc to the pane during or after a send. A send carrying files presses
  Enter a second time: Claude Code reads a pasted `@image` while the paste's Enter arrives and
  drops it.
- **Working is a background task, not a running run.** Every live run is finished when written,
  so nothing T3 owns is ever in progress for a live thread. While a turn someone asked for is
  being worked on (a terminal or composer message, until the session has been idle 4 s), the
  provider thread carries one `background_task` (`baton-live-turn`); T3 reads that as working
  (upstream's `backgroundWorkHoldsCompletion`) and alerts once when it clears. Work with no new
  user message (a background agent's report) is not a turn and does not alert. A thread the user
  settles is muted (T3's relay sends no completion alert for a settled thread), and Baton no
  longer unsettles it. T3's web client already skips the alert for the thread being viewed.
- **Progress.** Each tool call is mirrored the moment Claude Code writes it, as the item upstream's
  Claude adapter writes (`Bash` as a command, anything else a named tool), running until its
  result replaces it in place. A reply is attached to the newest turn asked for before it.

Rejected: streaming assistant text from the Herdr pane. `herdr agent read` does read the pane,
but Claude Code draws an assistant text block only when the block is complete (a spinner and a
token count until then), the same moment it writes the transcript, so the pane holds nothing the
transcript does not, behind a wrapped TUI that would need scraping. Sessions T3 starts itself run
on T3's own Claude provider, which streams. Also rejected: a per-thread mute of Baton's own (T3
has Settle).

Known limits: a turn's runs end at once, so T3's own Stop button on the run is gone; Stop on the
working task reaches the pane as Esc only where T3 routes it to the provider. Settling to mute
also files the thread under Settled. Images inside tool results (a `Read` of a PNG) are not shown.
Sent-file copies are not listed on the message, so deleting the thread leaves them in the store.

## D86 — A plain `baton` attach starts the space headless

The server-start block runs before the agent branch, so VS Code's terminal profile (a plain
`baton`) starts a stopped space as a `setsid` server with no tty instead of hosting it; closing
the terminal leaves every agent running. Installed on both boxes by the coordinator on
2026-10-29 (onnyx backup `~/.local/bin/baton.bak-20261029`).

## D87 — Make native: upstream's agent-session import, resumed rather than replayed

A terminal Claude Code session becomes a native T3 thread through upstream's
`agentSessions.import` (the onboarding wizard's RPC; `scripts/baton/live/agent-session-import.mjs`
calls it as a paired client). The import writes an `import:<instance>:<sessionId>` thread whose
provider thread names the session id. Upstream's first turn on it then failed every time: it
opened the session with `sessionId` (a new session), which Claude Code refuses ("Session ID … is
already in use"), and it also queued a text replay of the last 200 messages. Patched: a
`v1_import` thread whose provider thread carries a strong native ref resumes that session
(`nativeThreadHasTurns`), and skips the replay (`shouldPrepareLegacyImportHandoff`). The session
file is the context, so nothing is lost and nothing is said twice. The terminal process must be
stopped first, since two processes must not append to one session.

## D88 — Terminal prompts are answered from T3

The Director, 2026-10-29: when a live session showed a permission dialog, an AskUserQuestion or a
mod's `ui.ask`, T3 only said to answer it in the terminal, so he could not answer from his phone.

- **Detection.** Claude Code's own session record says `status: "waiting"` while a prompt shows.
  For a waiting session with a Herdr pane, the mirror runs the agent script's `--pane-prompt`,
  which reads the pane's screen and parses the prompt: the footer (`Esc to cancel`, `Enter to
  select`), the options (numbered, or the unnumbered kind with a `❯` marker), their descriptions,
  the highlighted one, the question above them, and what it asks about (up to the box's rule).
  One parser, in the agent script, used by both sides.
- **Shown as T3's own question.** The mirror writes a `user_input_request` turn item and a
  `runtime-request` of kind `user_input` with upstream's `message` response mode (the shape
  Codex's async questions use), so T3 renders the options as buttons on every client. "Type
  something" becomes T3's free-text field; "Chat about this" is left out.
- **Answering.** T3 sends the answer back as a message ("<question>\n<answer>"). The agent sees
  the session waiting, re-reads the screen, and presses arrows from the highlighted option to the
  chosen one, then Enter. Free text goes in with Herdr's `send-text`. It then waits until the
  prompt has left the screen and says so in the thread, with the session's new state.
- **Closing.** When the prompt leaves the screen still pending (answered in the terminal), the
  mirror marks the request expired and the item completed, so no stale buttons stay. A waiting
  session counts as working, so the turn's one alert waits for the answer.
- **Fallback.** When the screen cannot be read, or the message is not one of the options, the
  old line ("answer it there first") is kept.

Known limits: a prompt is read from what the screen shows, so a dialog taller than the pane, or
a layout Claude Code changes, falls back to the old line. Multi-select questions are answered
one option at a time. Proof frames in `frames/prompts-2026-10-29/`.

## D89 — Desktop releases carry T3 Connect's public config, read from app.t3.codes

Baton 0.1.5 on the Windows laptop reached neither box. Its trace showed every saved environment
(onnyx, signzart-prod, both relay connections made by the stock T3 app) failing each attempt
with `session-pending`: "Waiting for the T3 Connect sign-in to load." The desktop release was
built with no Clerk publishable key, JWT template or relay URL, so the T3 Connect sign-in never
loads and a relay connection can never authorize. Both boxes' servers were up (HTTP 200 on both
tailnet Serve URLs from the laptop); the client was the only broken part.

- `scripts/baton/hosted-public-config.sh` reads the four public values out of the official
  hosted client's bundle at build time and the release workflow appends them to `$GITHUB_ENV` in
  every build job; `loadRepoEnv` maps them to the `VITE_*` names the web build inlines.
- Not committed, for the reason in `cloud-public-config.sh`: they are upstream's cloud. The relay
  OTLP ingest token in the same bundle is a credential and is left out.
- The step fails the build when a value is missing, so a desktop that cannot sign in is never
  published again.

Rejected: committing the values (upstream's environment as our source); asking the Director to
re-add both boxes as direct tailnet connections (works around the client, leaves the relay path
broken, and costs him a pairing per box).

## D90 — Claude limits for setup tokens come from inference response headers

Moving the three accounts to setup tokens left cswap with `usage unavailable (http-429)` and Baton's
pool with no numbers, so rotation could only fire at the hard limit. `GET /api/oauth/usage` with a
setup token answers `429 rate_limit_error` with a `retry-after`: a throttle, not a scope refusal, and
what it would say once unthrottled is unproven. Claude Code's own `get_usage` returns no windows for
a setup token at all (T3 shows `unsupported`); the same account on a full login shows live numbers.

The inference API does report them: `anthropic-ratelimit-unified-{5h,7d}-{utilization,reset}` and
`-status`, on a 200 and on a 429. Scale checked on real replies: 0..1 (0.21 beside cswap's 21%, 1.0
on the rejected accounts).

- `scripts/baton/limits-probe.py` (timer, five minutes, signzart only): one 1-token Haiku call per
  account, 9 tokens on a 200 and none on a 429. An account already rejected is not called until its
  reset. Output goes through `cswap import-usage --hold 900` here, on onnyx and on the laptop, and
  the hold keeps cswap's own collectors off the throttled endpoint, so this lowers that traffic.
- Headers are undocumented, so a missing or out-of-scale value fails visibly: that account is left
  out, its hold lapses, the unit exits non-zero.
- Side effect: a probe counts as a message, so it can open a 5h window on an idle account.

Rejected: a local reverse proxy capturing real traffic (no data for idle accounts, which are exactly
the rotation candidates, and it reroutes every session through a new process); a full login per
account only for reading (works, but needs a login per account and is the refresh-token rotation
that moved us to tokens); anything needing TLS interception.

## D91 — Every Claude account is a T3 provider instance on its own setup token

`scripts/baton/provider-token-instances.py` writes the slot's token to T3's secret store and adds
`claudeAgent_optima` / `claudeAgent_signzart` with `CLAUDE_CODE_OAUTH_TOKEN` marked sensitive and
stored, the shape T3 writes. `--pin-default` does the same for slot 4 on the default instance; used
on the laptop only, where the CLI keeps a full login for Remote Control. On the boxes the default
instance follows cswap, so rotation keeps reaching it.

## D92 — T3's usage panel reads the probe; the thread view shows and switches the account

T3 reported `unsupported` for a setup token, so `ClaudeDriver` now passes every status through
`withProbeLimits`: where the provider has no windows, it takes cswap's reading for that instance
(a token instance's own slot, the default instance's active account). `checkedAt` stays the time of
the reading, not of the refresh, and `BatonLimitsAge` states it under the windows in the thread
details and the composer's limits panel, turning to "Stale" past 15 minutes (three missed probe
ticks, where cswap's hold lapses). Because windows now exist, T3's own exhausted-limit logic applies
to token instances too.

`BatonThreadAccount` sits in the thread header: the account label, and on the default instance a
menu of the pool with room left and reading age. A click calls `fabric.account.use`. That is
cswap's switch, so it moves every Claude thread on the environment at its next turn, and the toast
says so; the menu is disabled during a running turn. A thread on a token instance shows its label
only, since cswap cannot reach it. The sentence is `switch account to <name>` / `use the <name>
account`, command `switch_account`, medium risk. It is the one command that carries a label instead
of an id, because the pool is a process read and the vocabulary is pure.

Rejected: a per-thread switch through `provider.switch` (a token instance has another config
directory, so it is a handoff rather than a swap, and `Continue with` already offers that); a
"probe" marker in the contract so only probe data shows an age (a new contract field for what a
generic age line does for every provider).

Not yet run live: a real switch needs a second account with quota, from 2 Nov.
## D93 — Split chat panes are ChatViews side by side, and the route is the focused pane

**Decided** 2026-10-30 (Baton #40). Upstream has split terminals and no split for chat; the requests
(pingdotgg/t3code discussions 6746, 8149) have no shipped shape to follow. ChatView already takes
`environmentId` and `threadId` as props, so a pane is a plain ChatView and the hook is one element in
`ThreadRouteView` (`0008-web-panes.patch`), with the rest in `components/panes/`.

- Up to four slots with fixed ids, persisted per window (D96). Two side by side, three as three
  columns, four as a two-by-two grid. The layout is a split tree (`batonPaneLayout.ts`) flattened to
  rects under one parent, so a rearrange never remounts a ChatView. Every gap is a divider, by pointer
  or arrow keys; it moves only the two panes beside it, and none goes below 15 percent of its split.
- A pane's bar drags onto another pane: near an edge docks it on that side, the middle swaps them. From
  the keyboard the bar's grip takes an arrow to swap with that neighbour, and Shift with an arrow to
  give the pane that whole side. Once rearranged, opening a pane adapts the layout instead of resetting
  it; going back to one pane clears that. Native drag events, no dependency.
- The route thread is the focused pane. A pointer press or a key in another pane moves the route with
  `replace`. A route to a thread with no pane goes into the focused pane, so the sidebar behaves as it
  always did. The focused pane renders the route's own ChatView element at the same tree position as
  the pane's own, so a focus change never remounts one.
- Unfocused panes sit under upstream's `BackgroundThreadContext`, made for threads kept mounted under
  Settings; their shortcuts stand down and they keep streaming. A few lines in ChatView stop a
  background pane taking DOM focus. Not `inert`, so they stay clickable.
- Only the focused pane renders the window-level controls (Toggle thread details, Terminal, right
  panel, maximize). They are `position: fixed` at the window's top right, so with one set per pane all
  of them stacked at one point and every click reached the last pane: measured on `0.1.5-baton.43` with
  three panes at `[1335,12]`, pane a focused and the hit test landing on pane c. Each pane's own header
  (account, Open in, git actions) sits in that pane and always acted on its own thread.
- Closing removes the slot only. The thread and its draft stay. When the focused pane closes the route
  leaves first, because a slot closed under the route would hand its thread to the neighbour.
- Open with **Open in split** on a sidebar thread's menu, Alt+click on the row (Ctrl/Cmd+click is
  upstream's multi-select), or **Open in split** on a Baton session. A full grid gives up its last
  unfocused pane.
- Below 1024 px only the focused pane renders and the slots stay. The brief said `md` (768), but with
  the sidebar open that leaves 250 px per pane.
- The pane bar (environment, close) is a footer. At the top it collided with the right-panel controls,
  which T3 pins to the top right of the whole inset, and with the window controls.

Rejected: a route per pane (search params in every link, and a large patch to the router); separate
windows (discussion 6740; no shared focus and a second renderer); `react-resizable-panels` (a
dependency for two dividers); a focus-capture handler (an editor that restores its own focus after a
reload moved the route).

Known limit: moving focus to a pane does not put the caret in its composer, because doing so would
cancel a text selection started in that pane. Upstream's thread details card follows the viewport
width, so at 2560 each pane shows its own.

## D95 — A thread picks its own account, and keeps its conversation

**Decided** 2026-10-31. Every account is a provider instance, so a thread's account is its
`modelSelection.instanceId`. D92 rejected this because a token instance has its own config directory,
which made an instance change a handoff. That was a property of one key, not of the storage:
`ClaudeAccountHome` links every account's `projects/` to the primary's, so all accounts see one
transcript tree, and upstream's `canResumeAcrossInstances` ("Account overlays share native history")
already resumes when two instances share a continuation key. Claude's key was the account's own home,
so it never fired. `makeClaudeContinuationGroupKey` now returns the shared home for an account overlay,
as `CodexHomeLayout` does.

The evidence, because nothing published settles it. Anthropic documents no cross-account resume; a
third-party guide warns that changing key or token route can fail thinking signatures. So it was run:
on onnyx on 2026-10-30, three transcripts written while Optima was active (2026-10-15 to 10-20, 7 to 8
signed thinking blocks each) were resumed with `--fork-session` under Rabee's token with
`CLAUDE_CONFIG_DIR=~/.claude-c`. All three answered from their own context with exit 0. Sources:
docs.apiyi.com/en/faq/claude-thinking-signature-invalid, github.com/anthropics/claude-code/issues/48511.

- `fabric.account.useForThread` takes a thread and an account key, or null to follow the machine's
  active account again. The header menu calls it; only that thread moves. It survives a restart because
  the selection is the thread's own, in upstream's event store.
- Rabee gets a token instance (`claudeAgent_rabee`, `.claude-a`), or no thread could stay on Rabee
  while cswap rotates. `--pin-default` skips it, since there the default instance already is Rabee.
- `thread.model-selection.set` releases the live session at once, so during a turn the move goes in
  `fabric_thread_account_moves` and `ThreadAccountMoves` applies it when the turn ends. A queued run does
  not count as a turn: a run held by a spent account is the thread that most needs to move.
- The server refuses a signed-out account and one with no headroom, naming when the full window resets;
  the menu shows the same and disables the row. `limits-unknown` is allowed, since a reading that failed
  says nothing about the account.
- A mirrored terminal session is not T3's process to restart, so it keeps cswap's switch (D92). So does
  the limits tile's switch (D94), which is a machine-wide action by design.

Rejected: a handoff through `provider.switch` (it summarises the conversation, and the Director asked
for it to carry on); copying transcripts per account (two sources of truth for one session); a client
that waits and retries (the choice would die with the tab).

Known limit: a pinned thread does not rotate. When its account runs out it waits or is moved by hand.

## D96 — A thread can live in its own window

**Decided** 2026-10-31. D93 rejected separate windows as the way to do splits (no shared focus, a
second renderer), and that stands: splits stay in one renderer. This is a different feature, for
different monitors, and those two costs are what he is asking for.

- **Detach to window** on a pane's bar and on a sidebar thread's menu is `window.open` on the thread's
  route with `?batonWindow=<id>`, on both web and desktop. Same app, server and session, nothing to sign
  in to. The window keeps that id in `window.name`, which outlives reloads and route changes, and its
  panes persist under `t3code:baton-panes:v1:<id>`. The main window keeps its old key, so an existing
  layout survives.
- **One thread, one window.** A window that takes a thread in claims it over a `BroadcastChannel`, and
  any other window showing it drops its ChatView for "Bring it here", which claims it back. So a thread
  never has two composers: nothing can send twice from a stale draft, and focus stays per window. Only
  a thread arriving claims, so a reload cannot take one back. Two plain tabs of the main window share a
  layout and are not covered, as before.
- **Attach to main window** asks the main window to open it in a pane. The detached pane closes, and the
  window with it when that was its last pane. With no main window on a thread it says so and stays.
- On the desktop app `setWindowOpenHandler` allows exactly this URL shape, so Electron gives the window
  the main window's preload and session. `baton/detachedWindows.ts` gives it the main window's navigation
  policy, saves its route and bounds to `baton-detached-windows.json`, and has the main window reopen
  them after a restart. Closed by hand it is forgotten; closed by quitting it returns.

Rejected: a second server or a login per window (he said the same one); a route per window; a lease
with heartbeats to detect a dead holder ("Bring it here" is one click and needs no liveness).

Known limits: a closed web window leaves its small layout entry in localStorage. Web windows are
restored by the browser, not by Baton.
