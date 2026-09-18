import {
  OrchestrationRuleId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  WorkSessionId,
  type OrchestrationAction,
  type OrchestrationThreadShell,
} from "@t3tools/contracts";
import { assert, describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import {
  FabricOrchestrationReactor,
  layer as reactorLayer,
  OrchestrationEffectsService,
  threadIdForEvent,
  type OrchestrationEffects,
} from "./OrchestrationReactor.ts";
import { layer as ruleServiceLayer, OrchestrationRuleService } from "./OrchestrationRuleService.ts";
import { layer as workSessionLayer, WorkSessionService } from "./WorkSessionService.ts";

describe("threadIdForEvent", () => {
  const threadId = ThreadId.make("thread-1");

  it("reacts to exactly the events Phase 4's state derivation reads", () => {
    // A rule must not fire on a fact the fleet cannot see. Keeping the two
    // event sets identical is what makes "done" mean the same thing in both.
    for (const type of [
      "thread.turn-diff-completed",
      "thread.session-set",
      "thread.activity-appended",
      "thread.message-sent",
    ]) {
      expect(threadIdForEvent({ type, payload: { threadId } })).toBe(threadId);
    }
  });

  it("ignores events that cannot change what the work is doing", () => {
    // Pinning, snoozing and renaming move a thread around the sidebar. None
    // of them is a reason to start a provider session.
    for (const type of [
      "thread.pinned",
      "thread.snoozed",
      "thread.meta-updated",
      "project.created",
    ]) {
      expect(threadIdForEvent({ type, payload: { threadId } })).toBeNull();
    }
  });

  it("returns null rather than guessing when an event carries no thread", () => {
    expect(threadIdForEvent({ type: "thread.session-set", payload: {} })).toBeNull();
    expect(threadIdForEvent({ type: "thread.session-set" })).toBeNull();
  });
});

// --- one evaluation, end to end over the real services --------------------
//
// The only stubs are the two upstream services the reactor reads through
// (the projection, for what a thread is doing, and the engine, which it only
// uses to subscribe) and `OrchestrationEffects`, which exists precisely so the
// list of things a rule may do can be swapped for a recording of what it asked
// for. The work sessions, the rules, the firings and the bound are real and go
// through SQLite.

const workSessionId = WorkSessionId.make("ws-reactor");
const projectId = ProjectId.make("project-reactor");
const implThreadId = ThreadId.make("impl-thread");
const reviewThreadId = ThreadId.make("review-thread");
const claude = ProviderInstanceId.make("claude-a");
const codex = ProviderInstanceId.make("codex");

/** A thread whose turn finished and that nobody has looked at: `done_unseen`. */
const finishedThread: OrchestrationThreadShell = {
  id: implThreadId,
  projectId,
  title: "Implementation",
  modelSelection: { instanceId: claude, model: "sonnet" },
  runtimeMode: "approval-required",
  interactionMode: "default",
  branch: null,
  worktreePath: null,
  pullRequests: [],
  latestTurn: {
    turnId: TurnId.make("turn-1"),
    state: "completed",
    requestedAt: "2026-09-18T05:00:00.000Z",
    startedAt: "2026-09-18T05:00:01.000Z",
    completedAt: "2026-09-18T05:00:30.000Z",
    assistantMessageId: null,
  },
  createdAt: "2026-09-18T05:00:00.000Z",
  updatedAt: "2026-09-18T05:00:30.000Z",
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  session: null,
  latestUserMessageAt: "2026-09-18T05:00:00.000Z",
  hasPendingApprovals: false,
  hasPendingUserInput: false,
  hasActionableProposedPlan: false,
};

const reviewAction = {
  kind: "start_provider_session",
  providerInstanceId: codex,
  model: "gpt-5",
  role: "review",
  runtimeMode: "approval-required",
  prompt: "Review the change.",
  title: "Review",
} satisfies Extract<OrchestrationAction, { kind: "start_provider_session" }>;

const harness = (effects: Partial<OrchestrationEffects>) =>
  reactorLayer.pipe(
    Layer.provide(
      Layer.succeed(OrchestrationEffectsService, {
        startProviderSession: () => Effect.succeed(null),
        messageThread: () => Effect.succeed(true),
        notify: () => Effect.void,
        ...effects,
      }),
    ),
    Layer.provideMerge(Layer.mergeAll(ruleServiceLayer, workSessionLayer)),
    Layer.provide(
      Layer.mock(ProjectionSnapshotQuery)({
        getThreadShellById: () => Effect.succeed(Option.some(finishedThread)),
      }),
    ),
    Layer.provide(
      Layer.mock(OrchestrationEngineService)({
        readEvents: () => Stream.empty,
        dispatch: () => Effect.succeed({ sequence: 1 }),
        streamDomainEvents: Stream.empty,
        latestSequence: Effect.succeed(0),
      }),
    ),
    Layer.provideMerge(SqlitePersistenceMemory),
  );

const givenFinishedWork = Effect.gen(function* () {
  const workSessions = yield* WorkSessionService;
  yield* workSessions.create({ id: workSessionId, projectId, title: "Reactor work" });
  yield* workSessions.attachThread({
    id: workSessionId,
    threadId: implThreadId,
    providerInstanceId: claude,
    providerDriver: ProviderDriverKind.make("claudeAgent"),
    role: "implementation",
    origin: "created",
  });
});

/** Distinct thread ids for the bound test, without reaching for randomness. */
let started = 0;

const ruleCount = (id: OrchestrationRuleId) =>
  Effect.gen(function* () {
    const rules = yield* OrchestrationRuleService;
    const listed = yield* rules.list({ workSessionId, includeDisabled: true });
    return listed.find((entry) => entry.rule.id === id)?.rule.firedCount ?? -1;
  });

describe("the reactor's own evaluation", () => {
  it.effect("starts the review a rule asked for and records what it produced", () =>
    Effect.gen(function* () {
      yield* givenFinishedWork;
      const rules = yield* OrchestrationRuleService;
      const id = OrchestrationRuleId.make("rule-review");
      yield* rules.create({
        id,
        workSessionId,
        trigger: { kind: "on_done" },
        action: reviewAction,
      });

      const reactor = yield* FabricOrchestrationReactor;
      const fired = yield* reactor.evaluate({ workSessionId, changedThreadId: implThreadId });

      assert.lengthOf(fired, 1);
      assert.strictEqual(fired[0]?.outcome, "completed");
      assert.strictEqual(fired[0]?.producedThreadId, reviewThreadId);
      assert.strictEqual(fired[0]?.triggeredBy, "on_done:done_unseen");
      assert.strictEqual(yield* ruleCount(id), 1);
    }).pipe(
      Effect.provide(harness({ startProviderSession: () => Effect.succeed(reviewThreadId) })),
    ),
  );

  it.effect("does not fire again on the thread its own firing created", () =>
    Effect.gen(function* () {
      // §22's loop, at the level that actually runs it: the review session
      // finishing satisfies the same `on_done` trigger that started it.
      yield* givenFinishedWork;
      const rules = yield* OrchestrationRuleService;
      const id = OrchestrationRuleId.make("rule-review");
      yield* rules.create({
        id,
        workSessionId,
        trigger: { kind: "on_done" },
        action: reviewAction,
      });

      const reactor = yield* FabricOrchestrationReactor;
      yield* reactor.evaluate({ workSessionId, changedThreadId: implThreadId });
      const second = yield* reactor.evaluate({ workSessionId, changedThreadId: reviewThreadId });

      assert.lengthOf(second, 0);
      assert.strictEqual(yield* ruleCount(id), 1);
    }).pipe(
      Effect.provide(harness({ startProviderSession: () => Effect.succeed(reviewThreadId) })),
    ),
  );

  it.effect("stops at the bound however many times the work finishes", () =>
    Effect.gen(function* () {
      yield* givenFinishedWork;
      const rules = yield* OrchestrationRuleService;
      const id = OrchestrationRuleId.make("rule-bounded");
      yield* rules.create({
        id,
        workSessionId,
        trigger: { kind: "on_done" },
        action: reviewAction,
        maxFirings: 2,
      });

      const reactor = yield* FabricOrchestrationReactor;
      for (let attempt = 0; attempt < 6; attempt += 1) {
        yield* reactor.evaluate({ workSessionId, changedThreadId: implThreadId });
      }

      // Six finishes, two firings. The bound is durable — it is the persisted
      // count, not a counter that a restart would reset.
      assert.strictEqual(yield* ruleCount(id), 2);
      const listed = yield* rules.list({ workSessionId, includeDisabled: true });
      assert.strictEqual(listed.find((entry) => entry.rule.id === id)?.rule.status, "exhausted");
    }).pipe(
      // A fresh thread id each time, so nothing is refused for self-triggering
      // and the bound is the only thing that can stop it.
      Effect.provide(
        harness({
          startProviderSession: () =>
            Effect.sync(() => {
              started += 1;
              return ThreadId.make(`review-${started}`);
            }),
        }),
      ),
    ),
  );

  it.effect("records a skip, not a failure, when the named account cannot run here", () =>
    Effect.gen(function* () {
      // D21: this environment has a Codex provider configured and no `codex`
      // binary. The live run created a dead thread and a synopsis full of a
      // spawn stack trace before the action learned to refuse first.
      yield* givenFinishedWork;
      const rules = yield* OrchestrationRuleService;
      const id = OrchestrationRuleId.make("rule-unavailable");
      yield* rules.create({
        id,
        workSessionId,
        trigger: { kind: "on_done" },
        action: reviewAction,
      });

      const reactor = yield* FabricOrchestrationReactor;
      const fired = yield* reactor.evaluate({ workSessionId, changedThreadId: implThreadId });

      assert.lengthOf(fired, 1);
      assert.strictEqual(fired[0]?.outcome, "skipped");
      assert.isNull(fired[0]?.producedThreadId ?? null);
      assert.include(fired[0]?.detail ?? "", "not available on this environment");
    }).pipe(Effect.provide(harness({ startProviderSession: () => Effect.succeed(null) }))),
  );

  it.effect("spends the bound even when the action raises", () =>
    Effect.gen(function* () {
      // Recorded before the action runs, on purpose: a rule whose action
      // reliably fails would otherwise retry forever, which is the loop
      // wearing a different hat.
      yield* givenFinishedWork;
      const rules = yield* OrchestrationRuleService;
      const id = OrchestrationRuleId.make("rule-raises");
      yield* rules.create({
        id,
        workSessionId,
        trigger: { kind: "on_done" },
        action: reviewAction,
      });

      const reactor = yield* FabricOrchestrationReactor;
      const fired = yield* reactor.evaluate({ workSessionId, changedThreadId: implThreadId });

      assert.strictEqual(fired[0]?.outcome, "failed");
      assert.strictEqual(yield* ruleCount(id), 1);
    }).pipe(
      Effect.provide(
        harness({ startProviderSession: () => Effect.die(new Error("provider exploded")) }),
      ),
    ),
  );

  it.effect("parks a confirmation gate and holds what is queued behind it", () =>
    Effect.gen(function* () {
      yield* givenFinishedWork;
      const rules = yield* OrchestrationRuleService;
      const gate = OrchestrationRuleId.make("rule-gate");
      const queued = OrchestrationRuleId.make("rule-queued");
      yield* rules.create({
        id: gate,
        workSessionId,
        trigger: { kind: "on_done" },
        action: { kind: "confirmation_gate", question: "Start the review?" },
      });
      yield* rules.create({
        id: queued,
        workSessionId,
        trigger: { kind: "after_rule", ruleId: gate },
        action: { kind: "notify", message: "the review is running" },
      });

      const reactor = yield* FabricOrchestrationReactor;
      const fired = yield* reactor.evaluate({ workSessionId, changedThreadId: implThreadId });

      // One firing, awaiting an answer. Nothing behind the gate ran, which is
      // the entire reason the step exists.
      assert.lengthOf(fired, 1);
      assert.strictEqual(fired[0]?.outcome, "awaiting_confirmation");
      assert.strictEqual(yield* ruleCount(queued), 0);
    }).pipe(Effect.provide(harness({}))),
  );

  it.effect("evaluates nothing for a work session that does not exist", () =>
    Effect.gen(function* () {
      const reactor = yield* FabricOrchestrationReactor;
      const fired = yield* reactor.evaluate({
        workSessionId: WorkSessionId.make("ws-never-created"),
        changedThreadId: implThreadId,
      });
      assert.lengthOf(fired, 0);
    }).pipe(Effect.provide(harness({}))),
  );
});
