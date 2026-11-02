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
  "stop" and (until D115) moving the mouse more than 12 px stop it, a held button is always released, and each
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

## D94 — One limits tile per Claude account, and the tile can switch to it

**Decided** 2026-10-31. Setup tokens have no email, so T3's `accountKey` had nothing to merge on and
every machine's instance got its own tile: eight cramped tiles on three environments, the default
instance named "C" (T3's driver name "Claude", truncated).

- `limitsFromAccount` sets `credentialFingerprint` to the cswap slot. Slots match on all machines, and
  T3's existing merge does the rest. No token or anything derived from one goes in it.
- `withAccount` sets the instance's `displayName` to the account's name; `stampIdentity` runs next and
  restores a configured name. T3's snapshot always carries a driver name, so "only if empty" never fired.
- A probe-filled instance reports the slot's email from cswap, not the box's login. T3 keys on email
  first, so onnyx's own login split Rabee into a separate tile. Dropping the email instead broke
  `switchedAccount`, the signed-in check in `IntentService` and the picker's account line.
- `accountUse` refreshes the provider, so the name and limits follow a switch at once. A rotation by
  the reactor still waits for the 5-minute check.
- `applyUsageLimitsUpdate` keeps the fingerprint (`0008-claude-account-limits`), or a live turn's
  rate-limit event would pull that instance out of the merge until the next refresh.
- `BatonTileSwitch` adds a row per environment to the tile popover, on the same `useAccountSwitch` as
  the thread header. cswap is per machine, so one button across all machines would hide a broad action.
  A row says In use, Spent, Signed out or Held out and the button is disabled. Spent is new here: the
  thread menu and the server leave a spent account clickable, but a misclick in a hover popover would
  stall every thread on that machine.
- With three tiles T3's own layout reads properly at 1440, 1775 and 2560, so no layout change.

Rejected: grouping by display name in the client (new merge logic for a thing the server knows); one
"switch everywhere" button.

Known limits. The default instance follows the active account, so when every environment rotates off
Rabee no instance reports slot 4 and that tile is gone until one does. A pinned default (`--pin-default`,
laptop) reads as cswap's active account, as it has since D92. The laptop's server is part of the
desktop app, so its tiles merge only once it runs a build with this. A default instance rotated onto
Optima shows that name beside `claudeAgent_optima` in the model picker. `signzart-prod`'s unit now has
nvm's bin on PATH: under load T3's login-shell PATH read timed out and `claude` was "not found".

Not yet run live: pressing Switch. Rabee is in use and the other two are spent until 2 Nov.

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
  `fabric_thread_account_moves` and `ThreadAccountMoves` applies it when the turn and any queue behind it
  have ended. A queued run keeps its own selection and would put the thread back, and upstream has no
  command to change it, so a queue with no turn in front of it (one held by a spent account) refuses the
  move and asks for the message to be cancelled or sent. The composer's selection follows the move for
  the same reason.
- The server refuses a signed-out account and one with no headroom, naming when the full window resets;
  the menu shows the same and disables the row. `limits-unknown` is allowed, since a reading that failed
  says nothing about the account.
- A mirrored terminal session is not T3's process to restart, so it keeps cswap's switch (D92). So does
  the limits tile's switch (D94), which is a machine-wide action by design.

Seen live on `0.1.5-baton.46`: one thread went from the default instance to `claudeAgent_rabee` and
back, keeping one native session id and answering from its earlier context; a move requested during a
turn waited, the turn completed, and the move applied after it. On a rehearsal copy a pinned thread stayed
pinned through a server restart and answered from context. Not run in T3: a move onto Optima or Signzart,
both spent until 2 Nov, so cross-account resume in T3 itself is proven only by the CLI run above.

Rejected: a handoff through `provider.switch` (it summarises the conversation, and the Director asked
for it to carry on); copying transcripts per account (two sources of truth for one session); a client
that waits and retries (the choice would die with the tab).

Known limits: a pinned thread does not rotate; when its account runs out it waits or is moved by hand.
A waiting move shows only in its toast and is not rechecked when it applies. The shared key also lets the
composer's model picker choose any account, without this menu's refusal; T3's own limit logic still applies.
A home whose `projects/` is a real directory cannot resume, so `.claude-a/b/c` were checked on each box.

## D96 — A thread can live in its own window

**Decided** 2026-10-31. D93 rejected separate windows as the way to do splits (no shared focus, a
second renderer), and that stands: splits stay in one renderer. This is a different feature, for
different monitors, and those two costs are what he is asking for.

- **Detach to window** on a pane's bar and on a sidebar thread's menu is `window.open` on the thread's
  route with `?batonWindow=<id>`, on both web and desktop. Same app, server and session, nothing to sign
  in to. The window keeps that id in `window.name`, which outlives reloads and route changes, and its
  panes persist under `t3code:baton-panes:v1:<id>`. The main window keeps its old key, so an existing
  layout survives.
- **Drafts.** Every window writes the whole drafts blob, so on a `storage` event a window keeps the
  drafts of the threads it holds and takes the rest from what was stored.
- **One thread, one window.** A window that takes a thread in claims it over a `BroadcastChannel`, and
  any other window showing it drops its ChatView for "Bring it here", which claims it back. So a thread
  never has two composers: nothing can send twice from a stale draft, and focus stays per window. Only
  a thread arriving claims, so a reload cannot take one back. Two plain tabs of the main window share a
  layout and are not covered, as before.
- **Attach to main window** asks the main window to open it in a pane. The detached pane closes, and the
  window with it when that was its last pane. With no main window on a thread it says so and stays.
- On the desktop app `setWindowOpenHandler` allows exactly this URL shape, so the window has
  the main window's preload and session. `baton/detachedWindows.ts` gives it the main window's navigation
  and webview policy, saves its route and bounds to `baton-detached-windows.json`, and has the main window
  reopen them after a restart. It outlives its opener, so closing the main window leaves it up. Closed
  while the main window is up it is forgotten; torn down with the main window by a quit or an update it
  returns. Electron does not pass the opener's preload to a child here, so the main window's web
  preferences are passed explicitly; without them the window fails before its first request.

Rejected: a second server or a login per window (he said the same one); a route per window; a lease
with heartbeats to detect a dead holder ("Bring it here" is one click and needs no liveness).

Known limits: a closed web window leaves its small layout entry in localStorage. Web windows are
restored by the browser, not by Baton.

## D97 — Dictation is Handy's engine stack in our own sidecar, not Handy beside the app

Director, 2026-10-30: Handy's approach first, Wispr as the fallback (#45). Read Handy at `7bfb2e2c`
before choosing. Its parts are already crates: `transcribe-cpp` runs Parakeet, `handy-recorder` opens
the mic, `handy-keys` gives real key-up on a low-level hook, which Electron's `globalShortcut` cannot.
So `native/baton-dictation` is a 6 MB exe on those three crates plus Handy's Windows paste, adapted
under MIT, driven by JSON lines from the desktop main process.

Rejected: running Handy alongside (a second tray app, its name on his screen, a second mic owner and
no way to route the wake path through it); embedding Handy's Tauri app (a whole second UI);
`onnxruntime-node` with hand-written Parakeet decoding (a decoder of our own to keep right, when the
engine exists); keeping whisper.cpp for the wake path (two speech engines on one laptop).

Voice is Windows only for now, wake included: the exe is built for no other platform, the whisper-cli
and hidden Chromium capture paths are gone, and on macOS and Linux the tray says so and opens no mic.
**Reopened 2026-10-31: Windows first, the others queued, not Windows only. See D106.**

The same exe is the wake path's microphone (`record` piped into the core), replacing the hidden
Chromium window. That removes AGC and noise suppression from the path and means the lab
measures what the product hears. The static build pins a portable AVX2 floor, because a native build
on the runner may use instructions his i7-8550U does not have.

The exe links the C runtime statically, because nothing installs the VC++ redistributable. Text pastes
only into the window focused when recording began; otherwise, or if nothing reads the clipboard, it
stays on the HUD and under Tray → Copy last dictation. A recording stops at five minutes and is
transcribed but not pasted; Esc cancels. Nothing global exists until he asks: no model download and no
hold or toggle key before Tray → Download speech model, ticking Always listening, or a first press of
the Airdeck chord. Always listening needs Parakeet even with Wispr chosen, so ticking it downloads it.

Wispr stays installed and untouched. Tray → Dictation chooses; on "Wispr Flow" Baton registers no
dictation key, and a recording in progress is discarded. Baton's keys are Ctrl+Alt+Space (hold) and Ctrl+Alt+Shift+Space (toggle), clear of the
Ctrl+Win, Ctrl+Win+Space and Ctrl+Alt+Win read from his Wispr config.
Ctrl+Alt+Shift+F8 toggles for Airdeck, whose mic button is a tap with no hold.

## D98 — Custom wake words, no "Hey", trained on free GitHub runners

`.github/workflows/baton-wake-train.yml` runs openWakeWord's trainer on `ubuntu-24.04` (public repo,
free, CPU only). Pinned: piper-sample-generator v2.0.0, because upstream's notebook still imports the
layout it had then; AudioSet from its parquet files; a CMU pronunciation shim, because the trainer's
fallback phonemizer is a dead S3 link. A new word: add it to `make_config.py`, push the
`baton/wake-train` branch, drop `<word>.onnx` in `<state dir>/voice/models`, add it to `wakeWords` in
`fabric-voice.json`.

All enabled words run on one shared feature pipeline (mel, embedding) with one head each, so another
word costs almost nothing.

The Director's accent is closer to British, and he says FRAY-uh. Rounds three and four take 60% of the
positives from Piper's en_GB voices (VCTK less ten speakers, aru, semaine, alba, jenny_dioco,
northern_english_male, southern_english_female), the rest from the trainer's LibriTTS generator.
espeak says Sebastian only as "se-BAS-chun", which fired 2 of 30 on en-GB test voices, so round four
gives that word raw phonemes for both endings and takes all its positives from the en_GB voices.

Chosen per word, from four rounds, on 6.6 hours of his AT2020 dictation and on Microsoft neural en-GB
voices kept out of training (Sonia, Ryan, Libby, Maisie, Thomas; 30 clips a word):

| Word      | Model   | Threshold | False wakes/h | en-GB hits | His own uses that fired |
| --------- | ------- | --------- | ------------- | ---------- | ----------------------- |
| Sebastian | round 4 | 0.97      | 0.45          | 24 of 30   | 2 of 2                  |
| Alfred    | round 2 | 0.9       | 0.30          | 27 of 30   | 1 of 2                  |
| Freya     | round 3 | 0.95      | 0.15          | 26 of 30   | 1 of 1                  |
| Onyx      | round 3 | 0.9       | 0.30          | 29 of 30   | 6 of 12                 |

Each count is a handful of events, so these are coarse. No word reaches under 5% misses on these test
voices, and none of this is his own voice saying the words on request. The three enabled words together
are 0.90 an hour. No DJI audio exists in his Wispr store, so that mic is unmeasured. Onyx ships off:
he says Onnyx in ordinary speech, and six such uses in 6.6 hours would have woken it, about 0.9 an hour
on top of the false wakes.

Rejected: Colab and Kaggle (an account in a browser, not repeatable); RunPod (paid); the server (a
loaded box with earlyoom, and 17 GB of negative features on a tight disk).

Dictation result (D97), 240 of his AT2020 clips, 54 minutes: Parakeet v3 differs from Wispr's raw text
on 3.0% of words and Parakeet 110M on 3.0%; they differ from each other on 3.9%. That is agreement, not
accuracy. Median wait for a 5 to 15 s clip on the i7-8550U: v3 4.2 s, 110M 1.2 s, Wispr's own end to end
0.6 s. v3 stays the default as ordered, and the tray switches to the fast model.

## D99 — Mics are an ordered list by part of the name

`micOrder`: Scarlett Solo, Focusrite, Wireless Mic Rx, DJI, then the system default; an explicit pin
outranks it. The list is his setup kept as the default, and has no effect on a machine without those
devices. Checked every 5 s, so a vanished mic falls through and a returning one is taken back.
Windows on his laptop calls the DJI receiver "Wireless Mic Rx"; "USBAudio2.0" is the air remote's mic,
not the DJI, so it is deliberately not in the list. The Scarlett is read from input 1 only, because
the AT2020 is on it and mixing the empty input 2 halves the level.

## D100 — One brain decides what was said, and code keeps the last word

Director, 2026-10-31: "route everything through that intelligence layer so it's not making dumb
actions." Before this, `withScreenRoutes` ran regexes first, so words chose the action, and a plain
question fell into the command path, where it was refused or sent to a session.

Now every utterance and typed ask outside dictation goes through `decide` in
`packages/baton-shared/src/brain.ts`, which returns answer, look, teach, drive, act or clarify. The
order: lesson controls and his own `drive:`, `teach:`, `look:` prefixes; then a sentence the grammar
places; then a warm `haiku` session on his subscription. The old word rules are the fallback when no
model can be reached. `guardDecision` then checks what he said and what the model turned it into, so
rewording cannot pass the high-risk list. A clarify counts, because "which project should I deploy?"
invites the order it must refuse. A question about a dangerous thing is answered: an answer does
nothing. The medium-risk read-back, the later "confirm" and the drive plan's Run it are unchanged, and
the model has no route that confirms anything. `dictate` effects never reach the brain.

Answers come from a `sonnet` conversation, also on his subscription, spoken sentence by sentence as
they stream. The same conversation serves looks, so a follow-up keeps its thread either way. It decides
for itself that it needs the screen, by replying `[LOOK]`, and the capture rules still apply.

Measured on his laptop: a routed sentence takes a median 1.6 s; first spoken sentence 1.2 to 1.4 s on a
warm session and 2.8 to 4.7 s on a cold one. The intent table is 48 sentences in
`scripts/baton/voice-lab/brain-table.ts`.

Rejected: letting the model confirm or refuse (a reply could then widen a guard); one model for both
jobs (sonnet on every sentence spends quota to classify, and haiku answers too thinly); keeping the
regexes first (the failure he named).

The ask box moves to Ctrl+Alt+Shift+B. F8 was bound twice, the ask box won, and Airdeck's dictation
toggle did nothing on 0.1.9 (seen on the laptop: the chord opened the box).

## D110 — The hold is tied to the words, not to a clock

Director, 2026-10-31: pointing and cards "last barely a fraction of a second". Reproduced on his
Windows desktop with `screen/smoke/overlayLab.ts`: the real companion, a scripted model, 50 ms polling
of the overlay's own DOM (the overlay is excluded from capture, so a screenshot cannot show this).

| Case                        | Before                                                                            | After                                                                        |
| --------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Target on the other display | Answer card up under 50 ms, wiped by `point()`; never shown on the target display | Card moves with the pointer, 14.9 s on screen, 3.06 s past the end of speech |
| Target on the same display  | Cleared by a fixed timer 0.3 s before the last sentence ended                     | 3.2 s past the end of speech                                                 |
| Teach, busy screen          | Any change replaced the step with "Looking…", possibly during speech              | Step stays; nothing advances until it is spoken and readable                 |

Real run on his desktop, his own `claude`, Anna aloud, 2026-10-31: the card was up 30.1 s and left 3.05 s
after speech ended. In Written only nothing played, and a nine-sentence answer took four pages, the
first held 17.6 s. The numbers in the table used a scripted model, on his real screen.

Causes: `point()` cleared every other display and the card lived on the cursor's display; `clearLater`
ran from the end of the reply regardless of speech; `watch` waited 1.5 s regardless of speech. Rules
now, in `baton-shared/companionPacing`: a page gets 260 ms a word plus 1.2 s, 3 s minimum; the last page
holds until speech ends plus the larger of 3 s (Clicky's number) and whatever reading is left; a
countdown line shows the hold. Long answers turn pages at sentence ends. Pointer and card share one
display.

Rejected: longer timers. Any fixed number is wrong for some answer, and it would not have touched the
multi-display wipe, which was the fraction of a second.

Esc stays his apps' while a card is merely showing: the overlay cannot take focus, and a global grab
swallowed the key. It is held only while the microphone is live and during a running drive, as its
safety stop; the ask box and prompts hear it through their own focus. Tray, Clear the screen takes
down a card, and "stop" does by voice.

## D111 — One look, and text beside the pointer

Pill, pointer label, card, prompt and ask box share `companionStyle.ts`. The card rides beside the
pointer once it lands, as the paid Clicky does; with no pointer it sits low on the display above the
pill. System dialogs became `companionWindows.ts`, excluded from capture. Overlay windows are built
lazily and go after two idle minutes, so the layer never stops "last window closed" quitting.

The HUD window is removed. It kept a dot on screen at rest, and the pill says all of it.

## D112 — The pill

Bottom centre of the cursor's display, 44 px above the work area, because Wispr's own bar owns the edge
and he runs both. States against Wispr's: `research/companion-ui-2026-10-31.md`.

Sounds are three warm two-note figures (350 to 780 Hz with a soft second harmonic, 0.2 s, about -27
dBFS peak), replacing 1.3 to 1.8 kHz sines. `scripts/baton/voice-lab/sound-score.ts` puts the same
samples through `createOpenWakeWordScorer` and Silero, six repeats, at normal level and 9.5 and 18 dB
louder: every wake word's peak is at most 0.0009 against thresholds of 0.9 and up, and Silero peaks at
0.47 at the loudest, under its 0.5.

Wake to pill: 0 to 9 ms from the wake event to the call that shows the window (15 wakes on his laptop),
because the window is built ahead. Paint was not measured separately, and the wake model's own
detection time comes before that event.

## D113 — Speech is Pocket TTS, kept loaded, streamed into a hidden page

Director, 2026-10-31: the OS voice is old-fashioned and generic; real voices, free and local. Bake-off on
his i7-8550U, fixed sentences, BelowNormal, one job at a time, warm medians:

| Model                           | First audible                | RTF  | Peak RSS | Download          | British        | Off Windows without Python             |
| ------------------------------- | ---------------------------- | ---- | -------- | ----------------- | -------------- | -------------------------------------- |
| Pocket `english`                | 334 ms                       | 0.37 | 737 MB   | 227 MB            | VCTK voices    | Official binaries                      |
| Pocket 7m                       | 138 ms                       | 0.15 | 217 MB   | 74 MB with binary | same           | same                                   |
| Piper jenny                     | 433 ms, whole sentence       | 0.12 | 210 MB   | 63 MB             | Yes            | Repo archived                          |
| Piper cori                      | 2,556 ms                     | 0.66 | 266 MB   | 114 MB            | Yes            | same                                   |
| Supertonic 3, 5 steps           | 2,080 ms                     | 0.44 | 381 MB   | 129 MB            | No             | Weights OpenRAIL-M, repo archived      |
| Kokoro v1.0 fp32 bf_emma        | 3,982 ms                     | 1.11 | 774 MB   | 350 MB            | Yes            | Needs a GPL phonemiser for right words |
| Kitten mini                     | 5,245 ms, run not clean      | 1.51 | 395 MB   | 68 MB             | No             | Espeak                                 |
| Chatterbox Nano, community ONNX | 8,935 ms                     | 2.60 | 1,283 MB | 570 MB            | Reference clip | No official route                      |
| MeloTTS                         | Blocked: install over 10 min |      |          | about 1 GB        | Yes            | Python only                            |

Default Pocket `english`, voice Anna: word-perfect in transcription on all five sentences, 1,345 read
right. Fallback Pocket 7m, offered as Quick: faster and much smaller, but it misread words, including
that number. Tray, Voice offers Anna, Vera, Charles, Paul, Quick and System voice. The transcription
was a machine's; how they sound is his call. Samples: `D:\baton-voice-lab\voice-samples`.

Kokoro lost on speed on this CPU, not quality. Through sherpa's lexicon it silently dropped words, and
the correct route needs a GPL-3.0 phonemiser in an MIT repo. Piper's bundled espeak is GPL-3.0 and the
`alan` voice's source says All Rights Reserved, so Piper is removed from Baton's code.

Cloud option, not signed up for: ElevenLabs, which the original Clicky uses. Its pricing page on
2026-10-31: Starter $6 a month for 30,000 credits, Creator $22 for 121,000, Pro $99. Not heard or
compared here, and every answer would leave the machine.

In Baton's own process on the laptop, with the real speaker and player: cold start to first bytes 1.4 s,
four sentences played in order with no fall-back to the OS voice, and the sentences read ahead joined with no gap
at the boundary. The first-run path downloaded and hash-checked the Quick files; a real run found the Windows
zip has a folder inside and that a Git tar on PATH fails on "D:", both fixed. The full model's
download itself was seeded by copy, not fetched.

How it runs: `pocket-tts serve` on a random loopback port with two threads, files fetched and
hash-checked on first speech while the OS voice covers, stopped after ten quiet minutes because it holds 700 MB.
Each sentence generates once the one before has finished generating, and plays as bytes arrive. Credit
CC-BY-4.0 for weights and voices (THIRD_PARTY_NOTICES). The weights used are Kyutai's set without voice
cloning, and Baton offers none.

## D101 — What was on screen, and what a pointer may do

The Director watched a test ask for an Export button that was not there, and the pointer flew anyway.
That run used a scripted stand-in for the model, which replied with a fixed point whatever was on
screen. No scripted model runs where he can watch it again. Real traces then found real defects, and
these are the rules that came from them.

A point needs a named element and a confidence of at least 0.75, and the tag says both. A thing that
is not visible is called not visible, and the pointer stays still. On Windows the sidecar looks the
label up in UI Automation inside the top-level window under the point. A real element of at least
8 px within 160 DIP takes over from the model's pixels. Further away, or smaller, it is another
thing. When the tree cannot answer, as on the taskbar, the model's point stands.

The display he means is the one with the focused window, read when he spoke or before the ask box
took focus, not the cursor's. The router cannot see, so it is told the window's app and title, and
anything that could depend on the screen goes to look, where a fresh 1568 px shot goes to the stronger
model. 1568 is the most it reads; 1280 lost small text at 4K. The router's tidy-up never replaces his
words for an answer. A drive names the target it found, or asks.

Proved with markers at known positions on both displays (175 % and 125 %): capture to desktop within
1 DIP on 18 of 18, the model within 1 DIP on 10 of 10. `screen-eval.ts` and `gridLab.ts` stay as
regression checks. Rejected: routing with a screenshot on every sentence (a capture needs his yes, and
most sentences do not need one).

## D102 — Baton does not hear itself

While Baton speaks, and for 500 ms after, the core runs only the wake detector. VAD and speech
recognition get nothing, so its own voice cannot open a turn in a conversation window. A wake word over
its voice cuts it off and listens. The desktop feeds `setSpeaking` from the one speaker, so this covers
assistant answers as well as the core's own replies. Rejected: a lower wake threshold or echo
cancellation (no reference signal for Pocket's page on this path yet, and a gate is enough for a first
live test).

Audio through the real wake, VAD and Parakeet path, with a spoken reply fed back at -9 dB: 0 transcripts from
its own 11.9 s of speech, and a wake word over it cut in. Limit: the reply plays on until the wake word has
been detected, so a command said straight after it can pick up reply words ("What needs me? And about ten.").
The grammar still resolved that one. Removing them needs echo cancellation, which is the rejected option above.

## D103 — Dictation decodes while he speaks, by chunks cut at pauses

Goal: Wispr's 0.6 s from key release. Neither Parakeet TDT build can stream: transcribe.cpp offers
`session.stream` only to cache-aware models (`src/arch/parakeet`), which is why Handy also falls back
to live chunks for these. Handy cuts at 30 s for accuracy; here the cut is 2.5 to 8 s for latency, so
only the last piece is left at release. A piece carries 1 s of the audio before it and keeps only the
words past that, so the model has context and a pause does not become a false sentence end. Pauses are
measured against the audio's own floor, so a whisper pauses as clearly as a shout. A failed piece falls
back to decoding the whole recording, which is still held.

Rejected: a cache-aware streaming model (a third model to fetch, and not what was measured against
Wispr); re-decoding the whole clip while he speaks (work grows with every second). The cloud engines in
VentureOS `docs/research/live-stt-2026-10-28` were not reused: they need a metered key or a network hop.
That research's Silero defaults informed the thinking, but no VAD is used here.

Status: built and on the laptop, **not yet timed**. See the numbers in VOICE.md.

## D104 — Quiet speech gets gain; the fast model is not the default yet

Measured 2026-10-31 on the laptop, 60 AT2020 clips against Wispr's raw text, before any gain:

| Condition                        | v3              | 110M  |
| -------------------------------- | --------------- | ----- |
| As recorded                      | 2.8%            | 5.5%  |
| Attenuated 20 dB                 | 2.5%            | 6.1%  |
| Attenuated 30 dB                 | 2.9%            | 8.4%  |
| Attenuated 40 dB                 | 8.1%            | 20.8% |
| His clips made whisper, -35 dBFS | none            | 9.8%  |
| His clips made whisper, -45 dBFS | none            | 10.8% |
| His 30 quietest real clips       | 4.2% (13 clips) | 4.0%  |

This does not repeat D97's "both 3.0%" on 240 clips, and on quiet audio 110M is far worse. So `speechModel`
stays `v3` until the same table is re-measured with gain. Each recording or piece is lifted towards
-23 dBFS, up to 40 dB, never turned down, and digital silence is left alone. The gain ships unmeasured.
Whisper is simulated (LPC with noise excitation over the clip's own room tone), not real whispering. The
en-GB voice rows are left out: their script spells numbers out, so format inflates them.

## D105 — Clean-up is code first, his Claude second, and the answer is checked

Order: filler and stutter removal, value corrections ("6, no 7"), dictionary, spoken breaks, capitals,
mode shape, all in about 0.4 ms. The model is asked only when something is left that code cannot settle:
a correction marker, a restart, a long run-on, or document and notes modes. That was 243 of 1,777 of his
clips (14%), so most dictation never waits on it.

The model is his own `claude` on `haiku` through `startVisionSession`: subscription, no tools. A hard limit
of 2.5 s plus 8 ms a character, capped at 6 s, pastes the local text instead. A timeout replaces the session
at once, because leaving that to the next dictation made one timeout cause the next (60 of 80 in the first
run). `checkRewrite` then refuses any answer that lost or changed a digit, lost a name (capitals count),
lost a path or flag, added a number or name, grew, shrank or replied. Refused answers paste the local text.

This is a change to D31's spirit, stated plainly: with level `claude`, flagged dictation leaves the machine
for Anthropic on his own account. It still never reaches an environment. Tray: Clean-up, Local only keeps
everything on the laptop, and Raw is exact.

Rejected: a local LLM (an i7-8550U cannot rewrite a sentence in time); calling the API (D84, he pays by plan);
rewriting every dictation (1.6 s added to the 86% that do not need it).

Logic lives in `packages/baton-shared/src/dictationCleanup.ts` so a phone can use it; only the session is
in Electron. Modes come from the foreground exe, then a browser's title, then his per-app choice in `appModes`.

## D106 — Voice is Windows first, not Windows only

Director, 2026-10-31, reopening D97. Windows is what is built, packaged and tested. `desktop_unix.rs` holds
focus and paste for macOS and Linux, written and **never compiled**, because the scope moved to Windows first
part-way through; it is kept so nothing is rewritten. The rest is queued in STATUS.md.

Handy's macOS receipt-based paste was not adapted: it needs an AppKit run loop, and the sidecar has none.

## D107 — What the real laptop broke in Drive and Teach

Each of these passed every unit test and failed on his machine.

Run it and Allow counted as Cancel. The prompt destroyed its window before recording the answer, and the
window's "closed" handler answered first. Most Windows drive runs before this fix never had a real yes.

The drive model planned the Windows key, which the rules refuse, so the drive ended. It is now told to
click Start, and a refused plan gets one retry, told why. The same rules read the second plan.

Teach watched only the cursor's display, so a step done on his other screen was never noticed. The
fingerprint now covers every display in a fixed order, and each display is judged alone, because a line of
text on one display averaged with a quiet second one falls under the threshold. A video on either display
reads as change that never settles, so that lesson waits for "next". That limit is in the code.

UI Automation returns 0x80040201 from a whole-window search when one provider fails: 14 of 18 lookups up to
now. That was a symptom. The sidecar was not DPI aware, so at 175 % Windows scaled its coordinates and it asked
about the wrong window. It now declares per-monitor awareness. "View" and "File" in Notepad on the 125 %
display then snapped on real elements, 70 in the tree. The search also falls back to the element at the point
and up to three parents. When nothing answers, the model's point stands.

Rejected: raising the threshold or dropping the second-display watch (either loses steps on his setup).

## D114 — What a page, a plan or a reply can no longer do

An independent review of PR #51 confirmed these against the code.

A window title and the recent lines reach the router as quoted, untrusted data. A command the model
reworded is marked restated: it may read, and anything else waits for his later "confirm", because a low-risk
`message_work_session` would otherwise reach an agent with tools unconfirmed. The warm router is dropped after
six turns. Direct speech skips the model and stays word for word. Rejected: always running his exact words,
which loses "what's the craic with the Margin".

Titles go to Anthropic only where a screenshot may, so with capture on "ask" the router works without them.

A plan is held to the high-risk list across its title, reasons and typed text, joined across steps, and to a
list of destructive commands. Both lists are a second layer behind Run it, not a boundary: no list catches
every spelling. Run it shows typed text whole, only plain spaces may be typed, and Run it stays disabled until
a long box has been scrolled to its end. A paste is typing nobody has read, so its step shows the clipboard, a
changed clipboard stops the drive, and a paste or right-click into a command line is refused. Reaching a
command line asks a second time, as does not knowing where the keys will go, and editors count, because their
terminal has the editor's name. A drive that reaches a command line without that yes stops.

Before each keyboard step Drive reads the window: a change stops it, no reading stops it, and a switch during a
long type is not accepted afterwards. Ctrl+Esc, Ctrl+Shift+Esc, Alt+F4, Alt+Tab and Ctrl+Alt+anything are refused.

Esc goes to the most urgent holder only: a drive, then a recording, then a card, so closing a card cannot lose a
recording, and a holder that throws passes to the next.

Every sentence reaches the speaker when it exists, so a cancel covers the queue, and an answer still streaming
stays quiet after he silences it. A wake word over speech holds what he says next against the echo gate. A
"confirm" that starts over Baton's own voice is ignored, since a reply can say the wake word and the word
itself; he says it again after the voice stops. Stop and cancel still count. Limit: with nothing pending, a
reply that says a wake word and then a command is heard as far as the cancel lets it, and the pre-roll can add
Baton's own words. Dropping the pre-roll over its voice was tried on real audio and lost his first words.

Dictation clean-up is local until he rules otherwise (D105), and a "claude" saved by an earlier build of this
branch does not stick: it needs his own click. Even on `claude`, password managers, sign-in and bank pages,
private windows and any app Baton cannot name stay on this machine, judged where he spoke and where he is now.

Coordinator, relaying the Director, 2026-10-31: dictation clean-up stays local by default, and v3 stays the
default model with 110M in the tray. "Black display" on the laptop was his FlipIt screen saver, which takes the
input desktop away after 10 minutes idle, so nothing can be captured or pasted under it.

## D115 — The mouse stays his during a drive

Director, 2026-10-31: "Don't tie the stop cue with the mouse movements because, of course, I will be moving it
using the mouse while these actions are being performed." Mouse movement stops nothing now, and this replaces
the 12 px rule in D84.

The stops are Esc, the Stop button shown during a drive, a spoken stop, and the keyboard's focus check. The Stop
button takes no focus, so pressing it leaves the keys where they were.

His hand must not misdirect a click, so pointer and button go in one `SendInput` call, which Windows does not
interleave with his own input. Just before that, the sidecar reads the top-level window under the point and the
foreground window. If the window differs from the one read when the last step settled, or focus moved, or either
cannot be read, Baton clicks nothing and asks "Carry on?". A wheel step goes back to the plan's last point first.

The check runs before the click, not after, because a good click may open a new window and a check afterwards
could not tell. There is a gap of milliseconds between the read and the click, and that gap remains.

Rejected: blocking his input during a step (needs elevation, and takes his mouse away), and moving the pointer
back after each step (still racy).

Measured on the laptop: a real 2-step and a 6-step Notepad drive finished, and a pointer moved mid-drive stopped
nothing. In the runs where the lab moved the pointer, one typed word was lost, and Drive's own check reported it.
The lab started a PowerShell for that move, so a stolen moment of focus is the likely cause, but a pointer moving
throughout a typed step is not proven safe. The run that settles it uses real input from inside the sidecar
(`nudge`, only with BATON_LAB set), with no process starting, and waits until he is away. None of the D115 runs
had BATON_LAB: they moved the pointer through PowerShell, and `nudge` has never run. A `(mouse)` turn now fails
without it, because the sidecar would drop every nudge and the run would pass with nothing moved.

Third review: a paste or right-click on a window seen to be a terminal is refused at the moment it would happen,
even after a yes. Editors and Baton's own terminal drawer ask rather than refuse, and words in a plan's title
never refuse, because he should not be blocked from pasting into an editor. A window change during a wait or
scroll asks instead of being adopted. "Carry on?" takes no default focus, arms after 900 ms, and goes with Esc or
Stop. A clipboard that cannot be written stops the drive, and a paste over 2,000 characters is refused.

## D116 — Work for the whole app belongs to the main window

Detached thread windows (D96) run the same app with the same preload, so each mounted `SnapShotCoordinator` and
asked for pending snapshots. The main process rightly refuses any sender but the main window, and that refusal
reached him as an error popup. The coordinator now mounts only in the main window, and the refusal stays. Rejected:
trusting detached windows, as two coordinators would race to deliver one capture, and catching the error, which
would leave a loop that fails on every event.

## D117 — What the first installed build showed

Baton can run with no main window: 0.1.10 did after install. A question then opened the ask box and the card, and
when the last of them closed, "last window closed" quit the whole app, 27 s after the answer. Quitting now needs a
window he opened to have been the last of its kind to close. The companion windows no longer count. Closing the
main window still quits, including with the pill up. Rejected: keeping a hidden window open (it hides real quits).

"Stop" during an answer went to the model, which asked what he meant. With no lesson or drive running the word was
not treated as a control. While an answer is coming or being read out it now stops at once, with no model.

## D118 — Baton lives in the tray, and only Quit ends it

Director, 2026-11-01, on 0.1.11: the tray icon vanished. Nothing crashed. `closedLast` went true when the main
window closed and only another non-companion window could clear it, so when the last companion window went after
idle, `window-all-closed` quit the whole app, tray and voice with it. This replaces the rule in D117 that closing
the main window quits.

Once the tray exists, no window closing quits anything. The tray's Quit and a system shutdown do. A build whose
tray did not start keeps upstream's rule, because with no tray there would be no way back. Rejected: keeping a
hidden window open (D117's reason still holds), and tracking window kinds more carefully (the question stopped
being which window closed last).

## D119 — Opening the main window lands on the main window

Director: the session manager will not open. His trace shows `ElectronWindow.reveal` succeeding six times while he
saw nothing. Reading the path found three real defects:

- `currentMainOrFirst` skipped only `auxiliaryWindows`, and the pill, overlay, ask box and prompts are made with
  `new BrowserWindow`, so they were never in that set. With the main window closed, a reveal could land on one.
  It succeeds, on a transparent window that ignores the mouse. `activate` and `second-instance` both go through it.
- `second-instance` created nothing when no window existed.
- The tray's Open Baton called `ensureMain` then `show()`, with no restore, no focus and no way past Windows'
  foreground lock. A left click on the icon did nothing at all.

Companion windows are now excluded, a left click and a second launch open the window, and all three take
upstream's capture reveal, which is the path built for that foreground lock. It then reloads a crashed page and
brings back a window no display shows, which a reveal cannot do. Upstream's own bounds check runs only when the
window is created.

**Not proven to be what he hit.** The laptop was not touched, so the spans were not matched to these causes, and
the two later symptoms (a reveal with nothing seen, a relaunch with no main window) fit this path without
confirming it. `voice-turns.ndjson` now writes an `open_main` line with visibility and bounds, so the next
report can settle it.

## D120 — A log of what Baton heard

There was no record, so his exchange could not be reviewed. `<logs>/voice-turns.ndjson` takes one line a turn:
wake word and score, transcript, route and source, decide, first-sentence and total ms. Also its own lines for a
spoken stop, dropped noise, a wake with nothing after it, an error, and `open_main`. It uses upstream's rotating
writer, 5 MB and five files. `desktop.trace.ndjson` already rotated, so that needed nothing.

It stays on his machine. Dictated words are not written, only their length: dictation is the one thing that never
leaves the client (§12.3), and a log is a place it could leak from. Rejected: a file writer of our own (upstream's
is already there).

## D121 — Silence gets no transcript

Director: after the wake word it registers random "yeah" while he is silent. The segment started at a wake was
seeded with `minSpeechMs` of credit, so a silent wake always passed the minimum and went to Parakeet, which invents
words from a wake word's tail and a quiet room. The wake now keeps the audio and earns no credit, so a bare wake
leaves the window open and says nothing. Speech in the first 200 ms after the wake does not count either, since
that is the word's own tail. The pre-roll stays, so D102's lost first words stay fixed.

A lone filler (yeah, um, hmm, okay and the like) is dropped unless a confirmation is pending or he is dictating.
"Yes" and "no" are not on the list, because a clarifying question can be waiting on one. Limit: "yeah" in answer
to a clarifying question is dropped too, so he has to say yes.

## D122 — Stop works over Baton's voice, with no wake word

Director: saying "stop" mid-explanation does not stop it. D102 gave the mic to the wake detector alone while
Baton speaks. Now the VAD and recogniser also run then, on short windows, and only a short list acts: stop,
quiet, enough, that's enough, cancel, shut up, and near forms. Everything else said over its voice is discarded.
The check runs on its own path, because the `work` queue is waiting on the routing and speech he is stopping.

Its own voice cannot stop it: the speaker reports each sentence, and a phrase found in the last twelve is dropped
as `own voice`. This means Baton saying "stop the service" can eat a real stop said during that sentence; he says
it again. A stop reaches the tray's `dismiss`, so the voice, the answer's remaining words and the card go, and a
lesson or drive ends. The conversation window stays open, so he can carry straight on. "Thanks", "cheers" and "go
to sleep" end the window.

Over speakers the mic hears Baton as continuous speech, so a window is cut every 2 s and recognition runs about
that often during an answer. Its CPU cost alongside Pocket on his laptop is unmeasured. A real stop mixed with
Baton's voice may also transcribe as something else and do nothing, which fails safe. Neither has been tried with
a real microphone. Rejected: echo cancellation (no reference signal yet, as in D102).

## D123 — Starting the sessions when he wakes it

Measured on the box with Baton's exact flags, three runs each, first text in ms:

|        | new process      | process started 3 s earlier | warm, second turn |
| ------ | ---------------- | --------------------------- | ----------------- |
| haiku  | 1590, 1898, 2297 | 904, 1029, 1289             | 969, 1003, 1007   |
| sonnet | 1812, 1840, 2220 | 646, 925, 1275              | 1021, 1031, 1094  |

So nearly a second of a cold turn is the process starting, a pre-started one is as good as a warm one, and starting
costs no quota. A wake now starts the router, and a spare answer session, if they are missing, are past the turn
cap, or have died. A first answer pays that second twice today, once to route and once to answer, so it should
come down by about 1.8 s. That is arithmetic from the table: there is no before and after from his laptop, and
the voice log will give one.

Rejected: more sentences in `instantDecision`, because words choosing the route is the failure D100 removed. The
`[LOOK]` round trip stays, since only the model knows it needs the screen. TTS was not measured: Pocket is not on
the box.

## D124 — The pill says what state he is in

Director: while Baton is listening the pill stays and names the state, so he can tell whether he needs the wake
word again. The pill was tied to a turn and left between turns, so a window that was open looked closed. It now
follows the window: Listening between turns, then Thinking, Speaking, Dictating or the activity, and back to
Listening. When the window closes it says "Not listening" and "Say the wake word", for 3.5 s, after any speech
still playing. `pillAtRest` governs resting only. While Baton talks the window's deadline rolls forward, so a
long answer no longer closes it underneath him. Esc goes back to his apps once a window has heard him.

## D125 — Hands-free, one session

Director: no action may require holding a key. Keys stay as options. From a conversation he can say he wants to
dictate ("dictate", "I want to dictate", "let me dictate"), speak into the focused field, say he has finished, and
carry on with no wake word, because stopping dictation now returns to the conversation and not to sleep. The pill
reads Dictating throughout and has no time limit there.

The stop phrase must be unmistakable: "stop dictating", "end dictation", "I'm done dictating" and near forms, alone
or at the very end of what he said. Plain "stop" and "done" are typed. Words before the phrase in the same breath
are typed first. "Stop dictating the letter" is now text, where before it stopped. Dictated words still go only to
`dictate` effects and never reach the brain.

Capture consent, Run it, the shell check and Carry on? were mouse-only. On a voice turn each is now also asked
aloud, through the machine's confirmation rules, and whichever he answers first counts. A question that runs out
leaves the box up. A typed ask stays box-only.

## D126 — Each limit window is optional per account

Director, 2026-11-01: the $200 Max plan is reportedly now Ultra and some accounts no longer have a 5-hour window.
Not confirmed here: no account on the box was seen without one. Nothing keys on a plan's name. What is shown follows
the windows an account reports.

`limits-probe.py` required the 5h headers, so an account without them would have been left out whole, weekly figure
included. The 5h pair is now optional, half a pair is still refused, and 7d is still required. cswap reads
`fiveHour` only if the key is there, so the probe leaves it out. The server parsers and the pool already read what
is present and never invented a zero. The tile, the thread details and the pooled page now say "Not applicable" for
Session when a weekly window is reported with no session one, and the weekly amount shows as before. The 5-hour code
stays, so a downgraded plan shows its window again with no change.

## D127 — The operator: Claude or Codex with their own tools, and Baton's gate in front

Director, 2026-11-01: Baton should have complete computer use, because the operator underneath is Claude or Codex
with full capabilities, not just reading the surface. This replaces the read-only limit first proposed for this work.

A new route, `operate`, runs the harness with files, shell and the web. It starts in the folder of the focused Explorer
window, or his home folder. "Explain this folder" lists it, opens files some layers down and says what each does. The
router prefers it to `drive` whenever no click is needed (UFO's hybrid actions; see
`research/computer-use-2026-11-01.md`). The tray's Works through picks Claude or Codex, and `VisionSession` is the seam
both sit behind. A drive stays its own path: an operator turn never touches the input driver, and a drive reads no files.

**Every tool call stops at `judgeToolCall` before it runs, and code decides.** Refused stays refused: the high-risk
list and destructive commands. Reading runs. A tool nobody has classified gets a yes. Deleting, sending, paying or
publishing gets a yes with any setting. So does anything after the turn's first tool, which is how read content is kept
from acting alone. The rest runs with Act without asking on and gets a yes with it off. A yes is spoken on a voice
turn. A stop ends the work as well as the talking. Each call goes in the turn log.

The gate is real only with these flags, and each was found by trying it on the CLI with a tool call denied:

- `--permission-prompt-tool stdio` alone did nothing here. His user default of `bypassPermissions` ran a Write with no
  request at all, on a run that looked fine. `--permission-mode default` did not change that.
- `--setting-sources ""` did. It also shuts out a planted `.claude/settings.json` in the folder, which asked for bypass.
- Codex: `app-server` with `approvalPolicy: untrusted`. A decline stopped the command.

Live on the box, with Baton's own session code and the real judge: a folder explained, with a planted "run this" line
in a file not acted on. A delete reached the gate and was stopped on both Claude and Codex, and the file survived. The
planted line's result is the model's restraint, not proof of the gate.

Limits: the CLI runs what it judges read-only without asking, so those calls are logged and not gated, and Read can
reach any path, secrets included. After a refusal Claude ran one more Bash call that needed no permission. A file can
say whatever it likes to the model. The gate decides what happens next, not what it believes. `sensitiveAction` is
words, so it can over-ask, and something it does not name, with a harmless path and command, is routine. The
tainted rule lasts one turn, so an idea from a file read earlier in the conversation is not flagged on a later turn's
first call. Rejected: a read-only operator (what he overruled); hooks (`--safe-mode` drops them, and they are his to
configure); parsing a plan and running it ourselves (a second harness).

Nothing here has run on Windows. Explorer's folder comes from a PowerShell call that has never run.

## D128 — Act without asking

A tray checkbox, off by default, saved in `baton-screen.json`. On: a plain drive plan runs with no Run it box, and
routine operator work with no yes. Off: everything asks as before. What it can never cover: `shellCheck`'s prompts, a
plan or call that deletes, sends, pays or publishes, a Codex file change, a tool call on a turn that has read something,
and capture consent, which keeps its own setting. The high-risk list (`highRiskSubject`, `dangerousCommand`,
`planHighRisk`) used to refuse outright. It now asks for a spoken yes or no, with the box beside it. A question that runs
out is a no and the box comes down. No setting covers it, and a tainted turn still asks. Still refused, because a yes
cannot make them safe: a paste too long to show first, and a paste into a command line.

## D129 — A clean thread list, and titles that stick

Cause of "titles default back": `LiveSessionMirror.retitle` ran every tick and treated any title without `·`
as unnamed, so a rename or a regenerated title was overwritten with `name · account · box` within seconds
(and after every restart). Now the mirror touches only a title ending in ` · <this box>`, which it wrote itself
(`mirrorTitle`); a title he typed or T3 generated always wins, and nothing is stored to lose.

What stays in the list: a thread he started or created in T3 (never touched), and a mirrored thread of a live
session. A mirrored thread whose session ended leaves the list (archived through `BatonEngine`, so reversible)
after 5 minutes, unless he sent a message in it from T3 (`sentFromT3`). The importer skips transcripts whose
`entrypoint` starts with `sdk`, so scheduled tasks and SDK runs such as `publish-engagement` never become threads.
Not covered: an archived thread whose session later comes back live is not unarchived by the mirror.

One-time sweep at startup, guarded by `baton-thread-sweep.done` in the state dir: each project keeps its live
session's thread, or its newest thread if none is live; the projects `baton-prompt-test`, `baton-media-test`,
`native-copy-1` and `resume-proof` keep none. It logs `thread sweep: open N -> M`. Unarchiving afterwards sticks.

Two live sessions in one project (for example the manager beside `baton-autosync-b2`): both threads stay listed
for as long as both sessions are live, each titled with its own session name. When one ends, its thread leaves the
list after about five minutes unless he wrote in it from T3. Nothing is deleted.

## D130 — Baton's own window

Tray left-click and "Open Baton" open Baton's own window (`apps/desktop/src/baton/home/`), not T3's web app. It is a
local page in its own BrowserWindow, like the pill and the ask box. A few plain choices per section; "More options"
reveals the raw ones. Each side owns its settings as data (`HomeControl`): the voice side in `DesktopBatonVoice.ts`
(`v.` ids), the companion in `ScreenCompanion.ts` (`s.` ids). The tray right-click shrinks to status, listening, mute,
wake now, Ask, Clear, Stop, Open Baton, Quit. "Open sessions" in the window opens T3 as before. Not yet there: the
assistant's own account setting (queued separately). Copy ran through the uiux-stack copy check.

## D131 — The mark

A rounded tile with three bars, one per capability he can switch on: listening, screen capture, acting without asking.
Lit is on, dim is off. The tile colour is the state, exactly the old dot's colours; a slash across it is muted. One
geometry (`voice/trayMark.ts`) draws the tray bitmap and the SVG that `scripts/baton/export-icons.mjs` turns into the
app and installer icons in `assets/prod/` (the fork's production icon set; dev and nightly are untouched). The home page
opens once by itself on the first run after install (`baton-home.shown` in the state dir); a second launch still opens
T3's window.

D131 addendum (step 3): the window's header mark is the live one, in the state's colour, made by the main process
(`HomeState.status.mark`). Motion is one 0.3 s rise on open and short transitions on switches and "More options"; nothing
repaints continuously, and `prefers-reduced-motion` turns them off.

## D132 — The assistant's own Claude login

Baton's window, Working for you, More options: "Claude login for Baton". Default "Follow the claude login" changes
nothing. A chosen login is a config directory (`~/.claude`, a `~/.claude-*` home, or a claude-swap session);
`ScreenCompanion` sets `CLAUDE_CONFIG_DIR` to it, and removes `CLAUDE_CODE_OAUTH_TOKEN`, for the router, look, teach,
drive and operator `claude` children, always still through `subscriptionEnv`, so the API is never billed. Logins are found
by asking `claude auth status` of each directory (`assistantAccounts.ts`), at startup, on a choice and when the window
opens; a turn reads the remembered answer and never waits. A login that is gone or signed out falls back to his own with
one plain line on the pill. The address is masked until clicked. Not done: per-account limits in this list (the server's
pool has them; the desktop does not reach it), and Codex has no account choice.

## D133 — First-run: what Baton works through

Until he picks, Baton's window opens by itself and leads with "Choose what Baton works through": Claude Code and Codex,
each with whose subscription or billing it uses; API key and local model are listed as coming soon and cannot be picked
(the real choices are the only controls). Only a tool that is installed and signed in can be chosen: `claude auth status`
and `codex login status`, asked at startup and on "Check again" (`brainChoice.ts`, `brainDetect.ts`). The pick is saved as
the operator and `brainChosen`, after which the same row lives under Working for you. A Codex login with an API key says
each use is billed to that key. Voice stays local, and says so. Checked and found nothing to do: the Microphone double
tick was in the tray's radio list, gone since D130; the voice turn log already rotates (5 files of 5 MiB).

## D134 — The Check area

Baton's window, More options, "Check": one button runs the checks and shows a plain row for each, with a one-line fix when
it is not fine (`voice/selfChecks.ts`, pure). Microphone present, wake word models (the voice core's own
`resolveWakeModels` and `missingVoiceAssets`), speech model, Claude Code and Codex sign-in (the first-run detection),
screen capture permission (macOS; elsewhere none is needed) and disk free against the models still to fetch. Nothing runs
on its own. The level is read from the stream the voice loop already has open, for four seconds, only after "Test
microphone" is pressed, and only while Baton is listening; Baton never opens a microphone for it.

## D136 — A repeatable proof of the gate

`scripts/baton/operator-proof.sh`. To make the gate provable, three pieces of `ScreenCompanion` moved to
`packages/baton-shared/src/operator.ts` unchanged in behaviour (`taintedAfter`, `gatePrompt`, `spokenOutcome`), and the
Claude permission reply to `claudeVision.ts` (`toolAnswerOf`). The proof runs the real functions, not copies.

## D135 — Launch audit: private defaults

Shipped code (apps/, packages/) searched for the Director's names, hostnames, paths and accounts. Changed:
(1) The three cswap token instances `claudeAgent_rabee/_optima/_signzart` were a built-in table in
`packages/baton-contracts/src/accountPool.ts`. It is now empty at start. The server fills it from
`BATON_CLAUDE_ACCOUNT_INSTANCES` (JSON of instance id to cswap slot) when set; when unset, from `ClaudeAccountInstances.ts`'s
compatibility table, which applies only to instances of those exact ids that exist in `settings.providerInstances`
(settings hold no slot number, so it cannot be read from them). So his two boxes need nothing set and behave as before,
and any other machine gets none. To retire the table later, set on each box
`BATON_CLAUDE_ACCOUNT_INSTANCES={"claudeAgent_rabee":"4","claudeAgent_optima":"5","claudeAgent_signzart":"6"}` in the
server's environment. (2) The wake word "Freya" is off for a fresh install only: a settings file that exists without a
saved wake-word list keeps Freya on, and one with a list keeps exactly that list (`voice/wakeDefaults.ts`).
(3) Example addresses in two comments. Left, by decision: the words "the Director" in comments, wake words
Sebastian and Alfred (generic), the "Jarvis" speech prompt and the `jarvis|baton` prefix strip (a stock openWakeWord
name), and everything under `scripts/baton/` (operator tools, deploy and auto-sync for his boxes: not in the installer).
Facts for launch: `docs/baton/LAUNCH.md`.

## D137 — Baton updates itself from this repository's releases

**What the app did already.** T3's `electron-updater` is in the desktop app (`updates/DesktopUpdates.ts`). In a
packaged build it checks 15 s after start and every 4 minutes, with auto-download and install-on-quit both off, so
nothing happened until someone pressed Download and then Install in T3's own web UI, which Baton's window did not show.
The feed is baked in at build time: `resolveGitHubPublishConfig` reads `GITHUB_REPOSITORY`, which the Baton release
workflow sets to `RabHanz/baton`, and `app-update.yml` carries that. So the feed was already this repository's, never
upstream's. electron-updater reads the newest published, non-prerelease release; it takes the version from `latest.yml`,
so the tag name `baton-v<version>` is fine. The one upstream link left, the startup-recovery message
(`DesktopStartupRecovery.ts`), is now rewritten at release time by `apply-release-branding.sh`.

**What Baton adds** (`apps/desktop/src/baton/update/`): a downloaded-in-the-background flow on top of that updater,
with no change to upstream's files. When the updater reports a newer version Baton downloads it at once (install-on-quit
was dropped in D139: it quits without relaunching). Baton's window shows "Updates" (More options while up to date, up
front once an update is ready) with "Install and restart"; the tray gets "● Update ready: Install and restart" and a dot
on the icon. A click while Baton is speaking, listening past a wake word, dictating or driving waits for the quiet
moment (checked every 5 s) and then installs. A quit by hand installs it too. The 4-minute check is upstream's and is
left as is (it is a request for a small atom feed, not the API).

**Unsigned.** The Windows NSIS build is not code-signed, so `app-update.yml` has no publisher name and
electron-updater does not verify a signature on the update: it checks the SHA-512 in `latest.yml`, fetched over HTTPS
from the same release as the installer. Anyone who can publish to the repository's releases can therefore ship code to
every install, and a stolen GitHub token is a stolen fleet. Files fetched by the updater do not carry the web's
mark-of-the-web, so SmartScreen warns on the first manual install only, not on updates. Signing (an Azure Trusted Signing
or EV certificate, plus `publisherName`) is the fix, and is a Director decision with a cost.

## D139 — An update restarts Baton itself, and says so first

The report: an install at 15:58 left Baton down until 16:09, and it looked like a crash. Upstream installs with
`quitAndInstall(silent, forceRunAfter)`, which relaunches; an install on quit did not, so Baton no longer installs on
quit. Now, once an update is downloaded and Baton is quiet (not speaking, not past a wake word, not dictating, no
assistant run), the window opens with "Baton is updating to X and restarts at HH:MM:SS. It reopens this window." and a
Windows notification says "Restarting in 30 seconds"; the buttons are Restart now and Later (Later asks again in four
hours). The notification's click is Restart now; Windows toasts from Electron carry no buttons, so Later is in the window.
At the end of the 30 seconds it restarts only if still quiet, otherwise it waits for the end of the conversation
(`update/updatePlan.ts`, tested). The install writes `baton-update-pending.json`; the next start reopens the window with
"Updated to X." and a "Baton is back" notification, or says the update did not take.

**Why it went down**, in `<logDir>/baton-lifecycle.ndjson` (2 MB, 3 files, written synchronously): `start`,
`exiting` with the reason (update, quit), `exit`, `update-heads-up`, `restarted-after-update`, `before-quit`,
`uncaught-exception` and `unhandled-rejection` with the stack, `render-process-gone` and `child-process-gone` with
reason and exit code. A start that finds the previous run's `baton-running.json` still there writes
`previous-run-ended-badly`: a crash, a kill or a power loss. Before this, nothing logged uncaught exceptions or a
child process dying; renderer loss was only handled in the window code.

**Not proven:** the real restart on Windows, the toast, and `forceRunAfter` bringing the app back, all tests-only.

## D138 — Sessions in Baton's own window

Baton's window leads with Sessions: the five that matter (needs him, then working, then newest), "Show all" for the
rest. Each row: session, project, box, state (Working, Needs you, Idle) and the account, masked until clicked. A click
on the name opens that thread in T3's window; a row with a terminal pane has a one-line Send.

**One source.** The rows are the sidebar's own: `BatonProjectsBlock` builds them with `buildBatonProjects` from the
fleet atoms it already subscribes to (every connected environment, Claude live sessions and Herdr panes included), and
pushes a summary to the desktop shell whenever it changes (`setBatonSessions`). Nothing polls, and Baton's window has no
list of its own to disagree with the sidebar. Open and Send go back through the same sidebar (`onBatonSessionRequest`)
and take the same paths as a click there: `onOpenThread`, and `herdrSend` for text. Because the rows come from T3's
renderer, the list fills in once T3's window has loaded its sessions view; until then the window says so and offers
"Open sessions". A work session that is a T3 thread has no pane, so it has Open and no Send; replying there is T3's
composer.

## D140 — Baton's window v2: a sidebar of tabs

The Director rejected the single-column settings page ("way too simple"). The window is now an app: a sidebar of Home,
Sessions, Dictation, Assistant, Voice, Screen, Usage and Checks, a top bar with the state, and a Settings dialog (General,
System, Keyboard, Account, Updates, About), 1100x740 by default, resizable, remembering its size (`baton-window.json`). The
look follows the Wispr Flow app and the cream-window taste references: a warm ground, one raised panel, a serif for what
is said to him, a deep green as the one accent, amber only for "needs you". Tabs are fixed by `home/tabs.ts`; the page
(`appScript.ts`) draws whatever controls each tab gets, plus Home's history (from `voice-turns.ndjson`, never the words
dictated), a Vocabulary editor on `dictionary.json` (word, spelling, Learned or Added, count, last used; filter; add, edit,
delete; Forget all learned; reloads live), Usage (T3's own `usageLimits`, pushed by the sidebar when they change), the
fixed hotkeys read-only, and paths, About and the lifecycle log. Choices show their value with a Change button; booleans
stay switches. Speaking volume is a new setting applied in the player. The default microphone order is now empty (it was
his own hardware). Quick actions (Wake now, Ask, Clear, Stop) and Quit use the same handlers the tray did.

## D146 — The assistant plan of 2026-11-01: more than a voice, a keeper of everything

The Director's words, in `VISION.md` ("An employee, not a command line", "Semi-sentient, and public"): "It is like a semi-sentient assistant that can do everything and keep track of everything." Research on the comparison products is in `research/assistant-research-2026-11-01.md`. The plan items, all inside the one assistant (D143) and tracked on RabHanz/baton issue #78:

- **Monitoring.** Sessions and projects are watched so none is "left unattended forever": crashed, failed, stalled, and what each did, from state the server already holds (T3 thread state, Herdr, the fleet), never inferred by a model where an event says it.
- **Skills, plugins and MCPs** come from the Claude and Codex harnesses it drives. Baton does not build a second plugin system.
- **One memory, learnings across projects.** Every learning from work across ventures goes into the one memory as compact notes plus searchable history, so it only improves (D145 skills; D142 store).
- **Morning brief**: what finished, what failed, what waits, what it did overnight, spoken or written on his choice.
- **An approval list as clear as Duet's**: one place listing everything that waits for his yes, with the exact action, the job it belongs to and the permission it would use.
- **Memory he can open and edit like Muse**: plain files he can read, correct and delete; clearing never means deleting the assistant.
- **A coordinator over workers**: the assistant plans and hands parts to worker threads (jobs, D145), watches them and reports.
- **Public release.** Baton ships to strangers: no private defaults, no VentureOS dependency (D135), third-party licences kept clean for either MIT or a stricter licence, which he has not chosen. Known blockers to MIT redistribution are listed in `LAUNCH.md` section 2 (the openWakeWord models and Baton's own wake models) and need his pick; the Anthropic and OpenAI terms questions in section 1 are his to check.

What it does not do: post to his social accounts. VentureOS owns phones, warm-up and posting rules; no integration is built until the two managers agree it.

## D142 — One shared conversation, kept on this computer

`baton-conversation.ndjson` in the state folder: every turn with its time, route, what he said, the full reply (never
cut), a note on what came of it, and what it was about (`target`, so "show it" and "tell it to" mean something).
It survives a restart. Retrieval is the latest six turns in full plus a text search over the older ones
(`packages/baton-shared/src/conversation.ts`, `apps/desktop/src/baton/conversation/conversationLog.ts`). It goes
nowhere except inside the model calls that need it. Dictated words are not kept (D31): a dictation is a stub with its
length. This is the memory of the assistant in D143, and until D143 ships it also feeds the router as before.

## D143 — One assistant, not stages (design, before building)

**Why.** "It couldn't type it because it doesn't have the context of all of its tools and memories and everything in
one file." The router sends each sentence to answer, look, drive, operate or teach, each with its own session and a
partial context, so no stage can do what another stage just said. Baton becomes one long-lived agent that holds the
whole conversation and every tool, decides for itself and uses several tools in one turn.

**The agent** is one warm session on the seam that exists: the user's own `claude` (`-p`, stream-json in and out, the
operator session of D127) or `codex app-server`. It starts when Baton starts and again at a wake word, stays alive between
turns, and is recycled after about 40 turns, six hours idle, or a failure; a new session is seeded from the
conversation store (the last six turns in full, the current target, a one-paragraph summary of older days) so a restart or a
recycle loses nothing. No separate router call. The router stays as the fallback behind the setting below.

**Tools.** Baton's own tools are served by a local MCP server **inside Baton's main process**, streamable HTTP on
127.0.0.1 with a random port and a per-session bearer token, passed with `--mcp-config` (Claude) or the Codex MCP
config. Rejected: a stdio MCP server, which needs a second packaged program and a channel back to the main process for the
screen, the pointer, the fleet and the store; and the harness's built-ins alone, which have no screen, no pointer, no
sessions. The harness's own tools stay for what they do well: Read, Glob, Grep, Bash, Write, Edit, WebFetch, WebSearch.
Baton's tools: `screen_capture` (the existing consent), `click`, `double_click`, `type_text`, `press_keys`, `scroll`,
`drag`, `wait`, `sessions_list`, `session_show`, `session_send` (through the intent run, so the same §24 gates as typing
it), `fleet_status` (answers from state, §20, never by interrupting a session), `dictation_start`, `dictation_stop`,
`memory_search`, `remember_target`. The agent is told each turn the context the founding document's §14 ranks: the explicit
target in the sentence, the current target of the conversation, the focused session, the focused window and field, then the
most recent session; it asks a short question only when the ambiguity matters.

**The gate does not change shape.** Every tool call, built-in or Baton's, reaches `judgeToolCall` (D127) before it runs,
because the MCP tools execute in Baton's own process and the harness's go through the permission seam already there.
Extended for the new tools: reading is allowed (`sessions_list`, `session_show`, `fleet_status`, `memory_search`, `wait`);
`screen_capture` runs the unchanged capture consent; `click`, `scroll`, `double_click` are routine; `type_text` is
routine, with no Run it, when it types plain text, which is the rule that makes "type what you said" work on the first
try; it asks when the text trips the high-risk list or `dangerousCommand`, when the focused window is a shell or its
class cannot be told (`shellCheck`), or when the turn has read something outside the conversation and the text did not come
from it (text that is his words or Baton's own earlier reply, found in the store, counts as his); `press_keys` with Enter
or a send, `drag`, and anything that deletes, sends, pays or publishes asks; `session_send` is allowed and left to the intent
gates; dictation is local and reversible. High risk is a spoken yes or no, with the box beside it, default no when the
question runs out; the wake word alone never authorises it (§24); a refusal is said in plain words, aloud and on the pill,
and logged with its reason. The proof script grows a case for each new tool.

**Before the model.** The wake word and STOP (and "cancel", "quiet") stay in the voice core, exactly as D122: they never wait
on a model. Mute and the hotkeys too.

**Fast first words.** The agent's reply streams: the first sentence goes to the speaker as soon as it ends, and the prompt
tells it to say one short line before a tool that will take over a second ("Looking."), and to stay silent about tool churn
(§20: progress silent; needs input, approval, completion and failure spoken). Speculative thinking at a pause comes later, as
a follow-up, not in this build.
_Target:_ from the end of his speech to the first sound of Baton's voice, **p50 1.5 s and p90 3 s for a plain answer**, and a
spoken first line within 1.5 s p50 for a turn that uses tools. _Measured_ from `voice-turns.ndjson`: each agent turn writes
`agent_turn {endOfSpeechAt, firstTokenMs, firstAudioMs, tools:[name, ms], totalMs, route:"agent"}`, and
`scripts/baton/latency-report.mjs` prints p50, p90 and the slowest five for the last 50 turns. I run it on his laptop only
after he has been told, and report the numbers, not a feeling.

**Shipping.** Behind a setting, **One assistant (new)**, in Assistant, off by default, saved in the screen file as
`oneAssistant`. Until it has been measured on his laptop and he agrees, the router is the default; then the default flips,
and the router and its stages are deleted in a later change, not this one. Small pushes, each with `patches.sh verify`:
(1) the store wired to the existing stages, with every reply and every refusal reason in the turn log; (2) the MCP server,
the tool table and the gate rules, with tests; (3) the warm session, seeding and recycling; (4) the voice wiring and the
streaming; (5) the latency fields and the report; (6) the proof script extended.

**Not decided here:** Codex's handling of MCP tool approvals through app-server; the gate runs in Baton's process either way,
so the design does not depend on it, but the Codex path ships after the Claude one.

**D143 push 1.** Every reply (answer, look, teach, drive, operate, clarify, and the sessions side's act replies) goes into
the one conversation file in full and into `voice-turns.ndjson` as `reply`; every refusal says why aloud and on the pill
and goes into both as `refusal {kind, reason, said}`: a guard, a declined screen capture, no plan, a paste that is too long,
a shell, a screen that changed. A drive logs its plan (`drive_plan`) and what came of it (`drive_outcome`), and errors are
logged. The router reads its recent lines from the store, full replies cut only at 600 characters. A dictation is a stub
with its length. `scripts/baton/latency-report.mjs <voice-turns.ndjson>` prints p50, p90 and the slowest turns.

**D143 push 2.** `agent/batonMcp.ts` serves Baton's tools over MCP on 127.0.0.1, a random port, with the session's token on
every request; a request without it, with the wrong host, or from a browser (an Origin header) is refused, and `close()`
ends it. `agent/agentGate.ts` runs `judgeToolCall` inside every tool handler, with a spoken or clicked yes (high risk: no
by default), and marks the turn tainted after a screenshot, a file read, a command, a fetch or a search. `agent/batonTools.ts`
is the tool table with each argument checked before the host is touched. `judgeToolCall` knows the new tools: reading is
allowed, `type_text` is routine unless the text is high risk, the window is a command line, or the turn read something and
the text did not come from the conversation (`textIsFromConversation`); Enter, drag and a sensitive click ask. Tests: no
token, wrong token and a browser are refused; a high-risk call without a yes never runs; plain typing runs with no question;
after a screenshot other text asks and his own words do not.

**D143 push 3.** `agent/agentSession.ts` keeps one session warm, seeds it from the conversation file (the last six turns in
full, the current target), puts every turn back into the file, and replaces the session when it dies, after 40 turns or six
hours idle, re-seeded, so nothing is lost. `agent/agentPrompt.ts` is what it is told: §14's order for what "it" means, §20's
quiet about progress, §24's lines, and "type what you said" as a recipe (screenshot, click the box, `type_text` exactly the
words from the conversation). A test seeds a fixture conversation and checks that the session's first prompt holds the last
reply in full and that the turn goes back into the file. `claudeVision` takes an `mcp` option: a private config file naming
Baton's tool server and its token, passed with `--mcp-config --strict-mcp-config`, removed with the session.

## D144 — The assistant's hands (folds issue #52 into D143)

Computer use is not a stage. It is the agent calling tools itself, in a loop it controls: see, act, check, and again, with
retries and a changed plan when the screen is not what it expected, several tools in one turn, in any app. Today's drive is
one plan from one screenshot with a check after each step and an accessibility lookup for where a control is (D111); it
cannot replan. In the new design the tools are `screen_capture` (the existing consent), `ui_tree` and `locate` (Windows UI
Automation: names, roles and rectangles of what is on screen), `click`, `double_click`, `drag`, `scroll`, `press_keys`,
`type_text`, `wait_for` (waits until a named control or text appears, or gives up), and the agent looks again after each
action. UFO's idea, taken (MIT; its code is read first-hand before anything is ported): use the API or UIA first and pixels
last, so a control the tree names is clicked by name and a screenshot is for what the tree cannot see. Visual plus UIA
detection comes only where a before and after on the task set shows a gain. The guards stay and move into the tools: the gate
on every call; plain text into a named box is routine; send, delete, pay, publish and secrets are a spoken yes; no pointer
move while he is using the mouse unless he asked (D115); Escape and "stop" end it at once, before any model.
The Windows task set of the research note (six tasks, three runs each) runs only when he is away and has been told; the
harness is built with a dry run on fixtures that touches no pointer, so the real run is one command.
Push order from here: 4 the host and the voice wiring behind "One assistant (new)"; 5 the hands tools and the harness;
6 the proof script for every new tool.

## D145 — Jobs: Baton takes long work like an employee (design; builds after the hands loop)

**A job is a T3 thread with a record.** The worker is an ordinary T3 thread on a server (`BatonEngine` makes it), so it
survives Baton closing, shows in T3's phone app, and can be opened in T3. A server-side service, `BatonJobService`
(`apps/server/src/baton`), owns the job index in `baton.sqlite`: id, title, goal, thread, project, environment, account,
written permissions, standing grants, schedule link, created and last-activity times. Status is not stored: it is read from
the thread through the §10 ladder (running, needs you, done, failed), so it cannot drift. The same service methods serve the
desktop tool, the web and Baton windows, the phone and an MCP tool on the server, per AGENTS.md: `create`, `list` (and a
stream), `get`, `answer`, `stop`, `schedule`, `grant`, `revoke`. A job started on his laptop's own backend ends if Baton is
quit; started on a box (where the sessions live) it runs on. The default is a box, and a card says where.

**Scheduled and recurring: T3's own service.** `ScheduledTaskService` already persists tasks (`scheduled_tasks` in the
server's `statev2.sqlite`; interval of a minute or more, fixed time, or webhook; `runNow`, `setEnabled`, `list`/stream).
A scheduled job is a task whose run starts or resumes the worker thread; the job record keeps the task id and shows its next
run. No second scheduler. Note: `migrate-dev-db` drops `scheduled_tasks` so a dev server never runs his agents, so a copied
job whose task is gone says "not scheduled on this machine" and never runs.

**Reports back, asks in conversation.** A worker that needs input or approval raises a job event carrying the question
text. The desktop agent speaks it or shows it (§20: needs you, completion and failure are spoken; progress is silent) and his
answer goes back to that thread through the approval and input paths the sessions already have. Nothing is answered for him.

**Written permissions, and nothing public without a yes.** Each job carries a plain-language list, stored with it and on its
card: which folders and projects, which tools (read, edit, shell, web, sessions), a spend limit, and what it may send. Any
public post or message (email, social, chat, a PR comment to others) needs his spoken or written yes every time, until he
grants that job a standing permission: explicit, for that one job, revocable, and logged in the audit view (D44). This build
makes the model and the confirm path and nothing that posts. His social accounts, phones, warm-up and posting rules belong to
VentureOS; no integration without that manager's agreement, asked through the coordinator.

**Learned skills and memory (Hermes-style).** A compact local store of skills (name, when to use, steps, learned from which
job) that the agent writes after a job succeeds and reads before a similar one (the best matches are put in the worker's
first prompt), plus long-term notes (short facts about him and his work) beside the conversation history and its search
(D142). All of it is local, listed in the window, editable and deletable, and goes nowhere except inside the model calls
that need it.

**Hands: the browser as well as the screen.** Per step the agent picks the more reliable: for a web page, the page's DOM and
accessibility tree first (T3's preview browser, `apps/server/src/preview`, which is already Baton's shared browser, D2; the
real Chrome through Claude in Chrome stays for flows that need a real fingerprint, D3, laptop only); for a native app, UIA
first and pixels last (D144). The context line tells the agent which kind of window has focus; the gate is the same.

**The window.** A Jobs tab in the app-v2 design: cards in four groups (running, needs you, done, failed) with last activity,
worker thread, account, project, the permissions in words, and Open in T3, Answer, Stop, Schedule and Standing permission.
It follows the app-v2 design language, with frames at real size.

**Order, behind "One assistant (new)", after pushes 4 to 6:** J1 the service, its table and the status read, with tests;
J2 contracts, RPC and the MCP tools; J3 the Jobs tab; J4 report-back; J5 permissions and the confirm path; J6 skills and
notes; J7 scheduling; J8 the browser tools. Not decided here: which provider and model a worker uses by default (Claude on
the account with most headroom, from the pool), and a per-job spend limit's unit before there is anything that spends.

**D143 push 4.** The setting "One assistant (new)" (Assistant, More options; `oneAssistant` in the screen file, off). On, every
sentence except stop and its kin (`instantDecision` control, which never waits on a model) goes to the one assistant:
`ScreenCompanion` starts Baton's tool server and a warm session for it, with the host that does the work (screenshot through the
existing consent, the pointer and keyboard through the input driver, sessions through the voice side's list and the intent path,
dictation through the sidecar, memory search over the conversation file). The harness's own tools go through the same gate
(`harnessGate`); Baton's tools through it inside the tool server, so a call is asked about once, in the tool. The reply streams:
the first sentence goes to the speaker as it is written. Each turn writes `agent_turn` to `voice-turns.ndjson` with
`firstTokenMs`, `firstAudioMs`, `totalMs` and the tools it used, measured from the transcript (the voice core does not hand over
the moment his speech ended, so the time from his last word is these plus recognition; `latency-report.mjs` reads them).
Stop interrupts the agent's turn (the session is dropped and the next one is re-seeded from the file). The router is unchanged
and stays the default.

**D143 push 5, the hands (D144).** New tools: `click_element` (a control by its name, through the accessibility tree: UIA first,
pixels last) and `wait_for` (until a named control is on screen). `ui_tree`, a dump of the whole tree, waits for a command in the
dictation sidecar, which today can only locate a named control near a point; it is not faked. The mouse stays his: if the pointer
is not where Baton left it, the next move is refused with a plain line (`agent/pointerGuard.ts`), and Escape ends the turn at
once. Two changes to the gate's taint rule, to make a see-act-check loop usable, and flagged for his say: a key or chord (not
Enter, not a sensitive one) no longer asks after a read, since it carries nothing out; and one explicit yes to typing after a
read covers the rest of that turn's typing, while Enter, sends, fetch, search, a command line and high risk still ask every
time. Text that is his own words or Baton's reply still types with no question. The harness: `scripts/baton/computer-use-harness.sh
dry` replays recorded traces through the real tool server and gate, no pointer; `real <out>` runs the six tasks three times on the
Windows desktop and refuses unless `LAB_AWAY` names a time within four hours and `BATON_LAB=1`. Finished is automatic for task one
only; the rest is read from the frames, and misclicks are counted in review. Not yet measured: any of it on his laptop.

**D143 push 6.** `operator-proof.sh` now has ten cases: the five for the harness's tools (D127, D128) and five for the assistant's own:
his own words type with no question after a screenshot; text from the screen asks and is not typed without a yes; high risk and a
command line ask and a question that runs out is a no; Enter, a drag and a send always ask; nothing reaches a tool without the
token or from a browser. `STATUS.md` says what is proven and what is not.

**D144, rulings on the two gate changes.** (1) After a read, a key or chord is free only if it is navigation or editing with no Windows key and no
Alt: arrows, Tab, Shift+Tab, Home, End, the page keys, Backspace, Delete, Escape, and Ctrl+A, C, X, V, Z, Y, F, each with Shift or Ctrl only
(`keyIsNavigation`). The Windows key, Alt (Alt+F4, Alt+Tab, Alt+Space), Ctrl+Alt+Delete, Ctrl+Shift+Escape, Ctrl+W, T, N, Q, R, L, Ctrl+S, Enter,
the F-keys, Ctrl+Shift+Delete and anything not sure to be one of these ask; unknown is ask. Before a read they are as he asked. (2) One yes to
typing after a read covers more typing only into the same window and the same box (the control last clicked, by name or by a coarse place); it is
asked again when the window with the keyboard or the box changes, after Enter or a send, and it ends with the turn. Proof cases 10 and 11.

**D145 J1, and the job's flow from his words to work.** `BatonJobService` (`apps/server/src/baton/BatonJobService.ts`, migration 9, table
`fabric_job_terms`) keeps the terms of a job beside its work session: the goal as he said it, permissions, caps (2 hours and 40 worker
turns by default, dollars only for a metered key), standing permissions as a log, a phase, and a list of revisions (who said what, when, by
voice, text or in the thread). The job's status is read from the fleet's state, never stored; `jobGroupFor` puts a job waiting for his OK in
the group that needs him.
_The flow:_ he gives a task by voice; Baton creates the worker thread through the engine (`launchThread` takes an `interactionMode`, here
plan mode) with a first message that carries his words verbatim, then the written permissions, then "plan first, do not start"
(`workerFirstMessage`). The plan and its questions are written in that thread. Baton says one short line ("The plan for X is ready in its
thread.") and the Jobs page shows "Waiting for your OK" with Open thread and Approve. His refinements, by text or voice in the thread or
through "tell it to", are appended to the job's revisions and the plan is made again. Work starts only on his explicit agreement (spoken "go
ahead", the Approve button, or a reply in the thread), or at once when that job holds a standing permission to start (explicit, revocable,
logged). An edit after the start that widens what the job may do (a new folder, project or tool, or a longer leash) sends it back to
waiting, with or without that standing permission. The phases are drafting-plan, awaiting-his-agreement and approved; running, needs-you,
done and failed after that are read from the thread. `reduceJob` is the whole of it, pure and tested: no work turn before agreement, a
refinement is stored as context, a standing permission skips the wait only for the job that has it, a widening edit asks again.
Next: J2 (the wire and the MCP tools, which also create the thread and run the reducer's events from the thread's state), J3 the Jobs tab.

## D148 — The operating-system pack: an executive way of thinking, owned by the user (design; builds after J3)

The planning step of every job, and the coordinator over workers, think like an executive and brief specialists, from a pack the
user owns (D147). The pack is data, never code, and a user can replace it with their own.

**The pack** lives in `<userdata>/operating-system/`: `executive.md`, `roles/*.md` and `reference/` (any file dropped in).
`OperatingSystemService` (server, `apps/server/src/baton`) reads it; the Memory tab of the window lists, opens, edits and deletes
those files (the same files, not a copy). A user file wins over the default of the same name. **The default pack ships in the repo,
written from scratch:** outcome-first; the job stated without a solution, with its functional, emotional and social side; desired
outcomes as direction, measure, object and circumstance; the job-map steps as the plan's skeleton (define, locate, prepare,
confirm, execute, monitor, modify, conclude); find the leverage point before choosing the work; build or do not build, with the
reason and whether it can be undone; brief specialists as persona, tools, memory, constraints and triggers; ask only a question
that changes the decision; workers report outcomes, not activity. Roles in the default: engineering, marketing, research, operations.

**Planning.** The prompt of the planning turn is his words verbatim, then `executive.md`, then the briefs of the specialists the plan
picks. Before any work the plan thread shows a **Job brief**: job statement, desired outcomes, leverage point, build or do not build
with its reason, the plan skeleton, the specialists, reversibility and the written permissions. `parseJobBrief` checks the sections
are there; a plan without them is not "ready" (D145's reducer waits).

**Workers.** A worker's brief carries persona, tools, memory, constraints and triggers and the role's mental model. Its report is
outcome-first: what changed for each outcome, the evidence, what is next, what blocks it. The job card shows outcomes first.

**Cost.** Mechanical worker steps run on a cheap model; planning and judgment on the strong one, by a routing table he can edit.
The card shows which model each step used.

**Private stays private.** His own pack is made on his machine, by `scripts/baton/import-operating-system.mjs <file>`: it reads his
document and distils the executive file and the role briefs with his own Claude login, into userdata. It is never committed and
nothing leaves the machine except that one model call. The repo and the installer carry no part of it: a guard test hashes a
list of private markers (never written in clear in the repo) and fails if any word run in a tracked file or the installer's file
list matches. The public build starts with the neutral default.

## D147 — The operating-system pack: the top agent thinks like an executive

The Director's request: the assistant works efficiently with an executive and specialist way of thinking, from an operating system he owns. Design, for the coordinator and the planning step of every job (D145):

- **A pack of plain files the user owns**, in the user data folder, outside the repository and the installer: an executive file (how the top agent frames and decides), one file per specialist role (for example technical, marketing, research, operations), and the user's own full operating-system document kept as a reference they can open and edit. Loaded as a skill or memory pack (D146), viewable and editable in Baton's window.
- **The framing every plan goes through.** (1) State the job in solution-free words with its functional, emotional and social side. (2) List the desired outcomes as direction, measure, object and circumstance. (3) Lay out the job's steps as the plan's skeleton (define, locate, prepare, confirm, execute, monitor, modify, conclude). (4) Name the highest-leverage point reachable, preferring rules, information flow and feedback loops over parameters. (5) Decide build or don't build: which outcome it serves, how underserved it is, whether it strengthens what exists, the whole cost, and how reversible it is (decide fast when reversible, slowly when not); "don't build" is a valid result with its reason. (6) Brief each specialist worker as persona, tools, memory, constraints and triggers, with the mental model of its role. (7) Ask him only the questions that change the decision.
- **Workers report outcomes, not activity:** what changed against each desired outcome, the evidence, what is next, what blocks. The job card shows outcomes first.
- **Cost by routing (value per unit of spend, not lowest spend):** mechanical and repeatable work goes to cheaper models, judgment and planning to the strong one; subscription jobs are capped by time and turns (D145); every job card shows what it used.
- **Private by construction.** The user's own pack lives only in their user data folder. A test fails the build if the repository or the installer contains it. The public build ships a neutral default pack written from scratch (outcome first, frame the job, find the leverage, decide build or not, brief specialists, report outcomes) that a user replaces with their own.

**D139, update label.** An install over a running Baton stops it by force, so the next start found its marker and logged a crash. The start now compares the
marker's version with its own: a different version logs `replaced-by-update {from, to}`; `previous-run-ended-badly` is kept for the same version (or one it cannot tell).

**D143, shipped as the default.** The one assistant is on by default (setting "One assistant"). When it fails before saying anything (the harness will not start, or dies), the sentence goes to the older router and the card says "The one assistant couldn't answer, so the older router is handling this." (note `agent_fallback`). A stop he gives, or a failure after it has begun to speak, is not retried. Switching the setting off sends everything to the router, as before. Not proven: a live voice turn on his machine.

**D144, UI Automation first (built).** `ui_tree` lists the named controls (kind, name, which one has the keyboard) of the window he is using, through the sidecar's UI Automation walk; `click_element` and `wait_for` now search that same window wherever the pointer is (before, a control had to be within 160 px of the pointer, which an agent working from names never is). The tree is screen content, so it asks for the same consent as a screenshot and taints the turn like one. The prompt teaches the loop: read the tree, act, look again, change the plan when the screen differs, stop after two identical failures. Not yet done: the Windows task-set run and a before and after against a screenshot-only loop (needs the laptop, and he away); the Rust walk is untested off Windows.

**D145 J2 (server wire).** `BatonJobFlow` (`apps/server/src/baton`) is the flow as service functions: `startJob` makes the work session, the terms and the worker thread in plan mode with his words verbatim (`workerFirstMessage`); `refineJob` records the revision and passes his words to the thread unchanged; `agreeJob` is the only way to work: it moves the thread out of plan mode and sends one "go ahead", and agreeing twice sends nothing twice; `listJobs` joins terms to the fleet. RPC `baton.job.list|start|agree|refine|grant|revoke` (read scope for list, operate for the rest), with `setInteractionMode` added to the engine. A planning turn that has ended (thread completed) counts as the plan being written when he agrees; a reactor that notices it unprompted is J4. Known edge: right after a refinement the old plan's completed turn still counts, but the refinement is already in the thread ahead of "go ahead". Not here: the desktop tools (J2b), the tab (J3).

**D145 J2b (the desktop's job tools).** The assistant gets `jobs_list`, `job_start`, `job_refine`, `job_agree`, `job_grant` and `job_revoke`. Main asks the sidebar's window to make the job RPCs (the same bridge the intent calls use, request kind `job`); the window picks the project by the name he said and the first ready Claude as the worker, at `approval-required`, so whatever the worker would ask permission for becomes a card that needs him. The gate: a start, a refinement and an agreement run on his words and ask after a read; an agreement after a read always asks; `job_grant` asks every time and counts as high risk; `job_revoke` is free. The worker's model choice from the account pool by headroom is still open (D145 "not decided"). Never run live.

**D145 J3 (the Jobs tab).** A Jobs tab in Baton's window, drawn by the window's generic rows (no new drawing code): cards grouped Needs you, Running, Failed, Done, each with its status, what it may do, and one button: Approve for a plan waiting for his OK (the same `job agree` as the voice path), otherwise Open T3. The cards are read through the sidebar's window (job list RPC) once he presses Load, then every 15 s while Tessaya runs; nothing opens T3's window unasked. Not here: Answer, Stop, Schedule and Standing permission buttons, and the reactor that notices a finished plan by itself (J4).

**D146 monitoring (built, first step).** `watchFleet` (`packages/baton-shared/src/watch.ts`, pure, tested) reads the fleet and flags, from state and timestamps only: failed, account out of room, offline, stalled (working or starting and no activity in any thread for 30 minutes), waiting for his answer for 30 minutes, and finished but never looked at for 4 hours; settled and archived work is ignored, a busy thread keeps its session from being called stalled, and each finding carries what the session last did from its synopsis. RPC `baton.watch.get` (read scope) and the assistant's `watch_report` tool (answers "is anything stuck", "did anything fail overnight"). Thresholds are constants for now. Not yet: an unprompted notice or spoken line when a finding first appears, and the morning brief built on it.

**D146 editable memory (built, first step).** His notes are plain files: one `.md` per note in `<state>/memory/` (500 characters at most, 200 notes). They are read fresh every time, so a change made by hand counts at the next session; the newest ones (3,000 characters) go into the assistant's first prompt as data, not instructions. Tools: `memory_remember` (his words; after a read it asks, so a page cannot plant a note), `memory_forget` (always asks) and `memory_search`, which now covers the notes as well as the conversation. A Memory tab lists the notes with Edit (opens the file) and Delete, and Open folder. Deleting a note, or all of them, touches nothing else: the conversation, the settings and the assistant stay. Not yet: learnings written automatically after a job (D145 skills), shared across projects.

**D145 J4 (the reactor, Stop, Answer, Schedule).** `BatonJobReactor` watches thread changes; when a job's worker has finished its planning turn the job moves to "waiting for your OK" by itself, or begins at once if it holds a standing "start" (`noticePlan`). `stopJob` interrupts the worker's active run (`run.interrupt`); the thread and plan stay. `scheduleJob` makes a T3 scheduled task bound to the job's own thread (so each run reports there), only for a job he has agreed to, and stores the task id on the job; null removes it. RPCs `baton.job.stop` and `baton.job.schedule`; assistant tools `job_stop` (free) and `job_schedule` (always asks). The Jobs tab: Stop beside Approve/Open for a running job or one that needs him, a one-line answer/refine box for a job that needs him (sent word for word to the worker), and Run daily/Turn off behind More. Not here: weekly or fixed-time schedules in the window (the assistant sets any interval), and a webhook trigger. Never run live.

**D146 notices and the morning brief.** Every five minutes, once T3's window exists (nothing is opened for it), the desktop reads the watch. A finding that is new and worth interrupting for (failed, out of room, waiting on him, stalled) is announced once as one line however many there are ("X failed, and 2 more need a look."); one that stays is not repeated, and one that clears and returns is. Settings, under Assistant: Tell me when something needs me (Off, a card, a card and one spoken line; default a card), Quiet hours (default 10 pm to 8 am; nothing is announced inside them and it waits until they end), and Morning brief (Off, a card, spoken; default a card; once a day from 8 am). The brief is plain sentences from the job cards and the watch for the last day (finished, failed, waiting, running, stalled) and nothing invented; `morning_brief` gives it on request. **Deviation from "the brief as a job":** it is built from state in the app, not as a scheduled worker thread, because a worker has no way to read the fleet yet; when it has, the brief can become a scheduled job without changing what it says. Never run live.

**D146 approvals list.** One place for everything waiting for his yes: a job's plan that wants his OK, and a session that has asked him something, each with the exact action and the permission it would use (`buildApprovals`, pure). The Approvals tab shows them first on the list: Approve and Deny for a plan (Approve is the same agree as the voice path; Deny stops the worker, which has done nothing yet), Open T3 for a session's own question, which only he can answer in its thread. The assistant reads it with `approvals_list` and acts on a plan only through `job_agree` or `job_stop` after he says so; the gate is unchanged, so every high-risk action still asks aloud, with a default of no, when it happens. Not in the list: a gate question is spoken and answered on the spot, so it is never waiting; and a session's tool approval cannot be answered from here yet, only opened.

**D148 built: the neutral pack and its loader.** `packages/baton-shared/src/osPack.ts` ships a neutral default written from scratch (the executive framing and four roles: engineering, marketing, research, operations) as data. `apps/server/src/baton/OperatingSystemPack.ts` reads the user's own pack from `<userdata>/operating-system/` (`executive.md`, `roles/<name>.md`; files over 64 KB or with bad names are ignored) and merges it over the default, user files winning by name, read fresh at each job. `startJob` puts the frame after his words and before the written permissions, so every plan begins with the job brief. The guard: `scripts/baton/private-markers.txt` holds SHA-256 hashes of four-word phrases from a private document (none listed yet; the phrases are never written down), and `privatePack.guard.test.ts` fails, naming only the file, if any appears in Baton's own tracked files. The people who hold the private pack add its hashes; nothing here contains it. Not built: `import-operating-system.mjs` (distilling his document with his own Claude login), `parseJobBrief` (a plan without the sections is not ready), editing the pack in the window, and the cost-routing table.

**D146 skills, plugins and MCP servers in the window.** A Skills tab lists what Claude Code and Codex already have on this computer: Claude plugins (from the `enabledPlugins` of its settings file, with a switch), skills of both (from their `skills/*/SKILL.md`), and MCP servers of both (`mcpServers` in `~/.claude.json`, `[mcp_servers.*]` in Codex's `config.toml`). Tessaya adds no plugin system. The one switch it flips is Claude's own `enabledPlugins` for a plugin the file already lists: it keeps every other key, writes a `.tessaya-backup` first, refuses a file it cannot read or a plugin not listed, and says the change applies to the next session. Skills and MCP servers are shown, not switched: Claude and Codex define no per-file switch for them, and editing their server tables by hand would risk his config. The config folder follows `CLAUDE_CONFIG_DIR`, so the default account's; per-account folders are not listed. Never run against his real files.

**D3 built: the assistant in his own Chrome.** Rulings from the Director, relayed 2026-11-03: it drives his own logged-in Chrome through Claude in Chrome (a separate profile was the first idea and is dropped); social accounts are allowed, with a stricter gate, with a plain switch in Settings. **Later the same day the Director ruled it on by default** ("Yes, I allow it, build it all. It will just need a user's approval, that's all."), so the switch ships on; the VentureOS wait is dropped. It still only has effect once "Use my Chrome" (off, untried) is on; money movement stays refused.

- **How.** A setting, "Use my Chrome" (off; not yet tried on his machine), adds `--chrome` to the assistant's `claude` session. Every Chrome tool call reaches `judgeChrome` (`webPolicy.ts`) through the same gate as the rest. It is unverified whether the extension's tools appear under `--safe-mode` and `--strict-mcp-config`; if they do not, the setting does nothing harmful and that is the first thing to check on the laptop.
- **Reading is routine and taints.** Page text, a read, a find, a screenshot: allowed, and the turn is tainted, so text typed after a read that is not his words asks.
- **Asks aloud, default no:** a submit, send, delete, purchase, order, checkout, subscription, settings or password change, Enter, JavaScript, an upload, and any tool it does not know. Risky ones need a real yes (a silence is a no).
- **Refused, asked or not:** moving money (wire, transfer, withdraw, confirm a payment, send funds) and any address that is not a web page.
- **Social.** With the setting off, a social site is refused by name with the reason in words, and so is acting on a tab last taken to one. With it on: reading and scrolling are routine; a post, comment, like, follow, message, share, delete or profile change asks every time, with the exact text in the question; at most ten such actions an hour per site; each is logged to `social-actions.ndjson` in the state folder (time, site, tool, what, outcome). The site of a click is the last address the assistant took the tab to; a tab he already had on a social site and the assistant never navigated cannot be told apart, so while social is off an action there is judged like any other site (it asks if it submits or sends).
- **Unattended.** The assistant is attended: every ask is spoken to him. Job workers and scheduled runs are T3 threads on their own provider setup and are not given this Chrome path by Tessaya, so nothing here acts on an account unattended; a per-account standing permission is therefore not built.
- Test: `webPolicy.test.ts` (rules) and `agentGateChrome.test.ts` (the gate: page memory, the ask text, the hour limit, the log). Never run against his browser.

**D148 the coordinator (built).** A job with several parts hands each to its own worker, watches them and reports once. `job_split` (and `baton.job.split`) takes an agreed job and up to eight parts (title, goal in his words, optional pack role). Each part is a job of its own (`fabric_job_terms.parent_id`, migration 10) started already agreed, because the parent's plan he agreed named it: it works at once, in the parent's folders, projects and tools and no more, at `approval-required`, on the parent's model, with the role's brief from the pack in its frame. A split of a plan that is not agreed does nothing. The reactor, on any part's thread change, checks the parent's parts: when every one is done or failed, one summary goes to the parent's thread (what each did and its last action from the watch, how many failed, what to write next), and a mark in the parent's record keeps it to once. A part that needs him, stalls or fails shows through the same cards, watch and notices as any job. The gate treats `job_split` like `job_start`: his words run, and after a read it asks. Not built: a part choosing its own cheaper model (cost routing is the next step), and starting parts in sequence or with dependencies; all start together. Never run live.

**D148 the job brief and cost routing (built).** `parseJobBrief` checks that a plan shows the eight sections of the job brief (the job, the outcomes, the leverage point, build or do not build, the steps, the specialists, reversibility, the permissions), lenient about heading style. When a worker's planning turn ends without them, the reactor asks once ("Show the job brief... it is missing: ...") and records that it asked; the plan is accepted on the next completed turn whatever it holds, so a worker that will not comply cannot hold the job for ever (the missing sections are in the record). **Cost routing:** `routing.json` in his operating-system folder names `strong` and `cheap` models (default the Claude aliases `opus` and `haiku`, which follow the newest of each size); planning and judgment use the strong one and a part marked `routine` in `job_split` uses the cheap one. Each part's record says which model it used. Not built: the window editing of the routing table (it is a file he opens), and choosing between providers by price.

**D148 the import script and the pack in the window (built).** `scripts/baton/import-operating-system.mjs <file>` reads a person's own document and asks their own `claude` (their login; metered keys stripped from its environment) to distil it into the executive framing and up to eight role briefs; `parseDistilled` checks the reply (JSON, sizes, role names) before anything is written. It writes `executive.md`, `roles/*.md` and a copy of the document under `reference/` in their operating-system folder, refuses to overwrite without `--force` (and keeps `.bak`), and has a `--dry-run`. Nothing is written to the repository, and the document goes nowhere but that one call. The Memory tab lists the framing, each role (the defaults and his own) and the routing table as rows: Edit writes the neutral default into the folder when he has no file yet and opens it; Use default moves his file aside (`.bak`), never touching the default; Open folder. Tested with a stand-in `claude`; not run with a real model call.

**D148 dependencies between parts (built).** A part in `job_split` can list `after`: the earlier parts (numbered from 1) that must be done first. Only earlier parts can be named, so there is no cycle. A part with no `after` starts at once as before. A waiting part is recorded as a job of its own (migration 11, `part_spec_json`: what it waits on, its role and whether it is routine) with no thread. On each part's thread change the coordinator starts the waiting parts whose earlier parts are all done, in the same agreed, same-permission, same-model-rules way, and then waits for the next change before it looks at a summary. If a part it waited on failed it is never started: its record says which one failed, and the single summary lists it as "not started" and counts it among the failures. The summary is held back while any part is still waiting. Not built: waiting on something other than a sibling part (a time, an external event), and restarting a blocked part after its dependency is fixed. Never run live.

**Public-release guard (2026-11-03).** D135's audit is now enforced. `scripts/baton/guard-private.mjs` (plain Node; CI runs it first, and a unit test runs it) fails on a maintainer host or account name, a cloud provider used as a machine name, a key or token, a tailnet address, or a hashed private-pack phrase, in the shipped code Tessaya owns. It has one allow-list entry (`ClaudeAccountInstances.ts`, the compatibility table for the maintainer's two boxes, to go once `BATON_CLAUDE_ACCOUNT_INSTANCES` is set there) and fails if an entry stops being needed. This pass also replaced the maintainer's names in comments and examples with neutral ones. `packages/baton-voice` is out of the guard's scope until the voice lane lands its branch. What still blocks a release is in `PUBLIC_RELEASE_CHECKLIST.md`.

**D3 first run for "Use my Chrome".** One switch, and a one-line check beside it: the Chrome extension is installed in a Chrome profile, and its native host is listening (a named pipe on Windows, a socket in the temp folder elsewhere). The line says what to do when it is not: install the extension, or open Chrome and sign in. At the first start, if the check passes and he has never chosen, the switch turns itself on once and a card says so; if it does not pass it stays off and the check runs again at the next start. Choosing the switch either way is final (`browserChromeSet`). Read-only: the check starts and changes nothing. Unverified until the laptop: the extension id and the pipe name are from the extension's published behaviour.

**The hands loop on real apps (#52).** `scripts/baton/hands-ci/` runs the assistant's real tool path (the tool table, the input driver, the UI Automation sidecar) on a Windows desktop in CI (`baton-hands-loop.yml`, windows-2022) against Notepad, Calculator, File Explorer, Paint and Settings: 12 tasks, scripted planner, 12 of 12 passed on the final run. Results, what each run found and what is not measured (the model-planned variant, the gate, other languages and DPI) are in `docs/baton/research/hands-loop-tasks.md`. One change to the product came out of it: the rule "stop after two identical failures" is now enforced in code (`failureGuard.ts`, wrapped around the tool server) instead of only asked for in the prompt. A keystroke that returns "Pressed" is not proof it did anything (Ctrl+C in Notepad on the runner did not copy; the menu did): read the result back.

**Copy right after typing.** Typing goes by the clipboard and puts his old clipboard back 400 ms after the paste. Two ways that could undo a copy made soon after: the put-back overwrote it (fixed first: it now happens only if the clipboard still holds what was pasted), and when the copy was of the same text as the paste, the content check could not tell (fixed now: pressing a copy chord, Ctrl+C, Ctrl+X or Ctrl+Insert, cancels the pending put-back). On the CI desktop the keystroke itself was never at fault: Notepad leaves the clipboard empty for about five seconds after a copy, so a read-back after one or two seconds saw "" and looked like a failed copy. A copy is confirmed by reading the clipboard back for several seconds, not by the keystroke's "Pressed" and not by one early read.

**Jobs and Approvals load by themselves.** Opening either tab asks the sessions window for the jobs (it opens if it is not already, as the Sessions tab does), shows "Reading your jobs" meanwhile, and keeps them fresh every 15 seconds from then on. A failure says so in words with a "Try again" button; nothing waiting, and no jobs, have plain empty states. The earlier "Load" button is gone. Nothing is read, and no window is opened, until one of these tabs is opened.

**The Chrome check is off the render path.** `checkChrome` ran synchronously inside `ScreenCompanion.controls()`, which the voice code calls on every render, including during start-up (it reads `controls()` for the tray icon). It listed Chrome's profile folders and, on Windows, the named-pipe namespace, and `userInfo()` could throw. Anything slow or throwing there would stall or fail the voice start. It is now asynchronous (`fs.promises`), limited to four seconds, cannot throw (`checkChromeWithin`), runs in the background, and the window shows the last answer ("Checking Chrome..." first). Nothing from the Jobs or Approvals tabs, the turn log or the failure guard runs at start-up.

**How long it listens (Director: "it doesn't listen for long after triggering").** Two timings were fixed in the voice code (command window 8 s after the wake word, conversation 30 s after a reply). They are settings now, under Voice > Listening: "Listen after waking" 8 / 15 / 30 s (default 15) and "Keep the conversation open" 30 s / 1 min / 2 min (default 1 min). They are read at each use (`liveTimings`, getters over the voice core's timings), so a change counts at the next wake with no restart; the end-of-speech wait stays its own setting. The voice package is unchanged. A countdown on the pill is not added: it would repaint on a timer for no gain the pill's existing state does not give. Not measured on the laptop.

**Smoothness (Director: "there is jerkiness").** Audited by reading the update paths, not yet profiled on the laptop. Fixed: (1) every `render()` rebuilt the tray icon (six PNGs decoded and drawn on), its menu and the window's whole state: renders within 40 ms of each other are now one, and the tray icon is kept per state; (2) every window update re-read the skills, MCP, note and pack folders from disk (about 2 ms per update on Linux with a warm cache, more on Windows with a virus scanner): they are kept for 3 s and forgotten at once when a row changes them; (3) the pill's listening bars changed their height about 12 times a second (a layout each time) and now scale with a transform on the compositor. Not changed and checked: the pill already throttles level updates to 80 ms; the window already skips an update whose state is unchanged; no continuous animation runs while idle. Still to measure on the laptop: long tasks in the voice loop during speech (model inference per frame), which this box cannot show.
