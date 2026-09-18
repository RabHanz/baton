/**
 * The intent surface end to end inside the environment: a sentence, the real
 * grammar, the real work sessions and rules, the real executor, and the log
 * that has to remember all of it.
 *
 * Only two things are stubbed, and both for the same reason a route test stubs
 * them — they reach outside this environment: `OrchestrationEffects` (which
 * would start and message real provider threads) and the projection/registry
 * pair (which would need a running engine). Everything between the words and
 * those edges is the code that ships.
 */
import {
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  WorkSessionId,
  type OrchestrationProjectShell,
  type OrchestrationThreadShell,
  type ServerProvider,
  type ThreadId as ThreadIdType,
} from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ProviderRegistry } from "../provider/Services/ProviderRegistry.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { AdoptedRuntimeAdapter, layer as adoptedSessionLayer } from "./AdoptedSessionService.ts";
import { layer as intentExecutorLayer } from "./IntentExecutorLive.ts";
import { FabricIntentService, layer as intentServiceLayer } from "./IntentService.ts";
import { FabricOrchestrationReactor, OrchestrationEffectsService } from "./OrchestrationReactor.ts";
import { layer as ruleServiceLayer, OrchestrationRuleService } from "./OrchestrationRuleService.ts";
import { layer as workSessionLayer, WorkSessionService } from "./WorkSessionService.ts";

const projectId = ProjectId.make("project-ventureos");
const workSessionId = WorkSessionId.make("ws-scheduler");
const implThreadId = ThreadId.make("impl-thread");
const claude = ProviderInstanceId.make("claude-a");
const startedThreadId = ThreadId.make("rule-started-thread");

const project: OrchestrationProjectShell = {
  id: projectId,
  title: "VentureOS",
  workspaceRoot: "/workspace/ventureos",
  defaultModelSelection: null,
  scripts: [],
  repositoryIdentity: null,
  createdAt: "2026-09-18T04:00:00.000Z",
  updatedAt: "2026-09-18T04:00:00.000Z",
};

/** One thread, blocked on an approval: the state §20's "what needs me" is for. */
const waitingThread: OrchestrationThreadShell = {
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
  hasPendingApprovals: true,
  hasPendingUserInput: false,
  hasActionableProposedPlan: false,
};

const provider = {
  instanceId: claude,
  driver: ProviderDriverKind.make("claudeAgent"),
  displayName: "Claude A",
  enabled: true,
  installed: true,
  version: null,
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-09-18T05:00:00.000Z",
  models: [{ slug: "claude-sonnet", label: "Sonnet" }],
  slashCommands: [],
  skills: [],
} as unknown as ServerProvider;

interface Sent {
  readonly threadId: string;
  readonly text: string;
}

const harness = Effect.gen(function* () {
  const sent = yield* Ref.make<ReadonlyArray<Sent>>([]);
  const started = yield* Ref.make(0);

  const effects = Layer.succeed(OrchestrationEffectsService, {
    startProviderSession: () =>
      Ref.update(started, (count) => count + 1).pipe(Effect.as(startedThreadId)),
    messageThread: (input: { readonly threadId: ThreadIdType; readonly text: string }) =>
      Ref.update(sent, (all) => [...all, { threadId: input.threadId, text: input.text }]).pipe(
        Effect.as(true),
      ),
    notify: () => Effect.void,
  });

  return { sent, started, effects };
});

const baseLayer = (effects: Layer.Layer<OrchestrationEffectsService>) =>
  intentServiceLayer.pipe(
    Layer.provideMerge(intentExecutorLayer),
    Layer.provide(effects),
    Layer.provide(
      Layer.succeed(FabricOrchestrationReactor, {
        start: () => Effect.void,
        drain: Effect.void,
        evaluate: () => Effect.succeed([]),
      }),
    ),
    Layer.provideMerge(
      Layer.mergeAll(
        workSessionLayer,
        ruleServiceLayer,
        // The fleet now includes adopted sessions (§9). None is registered
        // here, and the runtime is not installed, so every answer is the
        // refusal a machine without Herdr gives.
        adoptedSessionLayer.pipe(
          Layer.provide(
            Layer.succeed(AdoptedRuntimeAdapter, {
              discover: Effect.succeed({
                available: false,
                reason: "herdr is not installed on this environment.",
                candidates: [],
              }),
              sendInput: () =>
                Effect.succeed({
                  delivered: false,
                  detail: "herdr is not installed on this environment.",
                }),
            }),
          ),
        ),
      ),
    ),
    Layer.provide(
      Layer.mock(ProjectionSnapshotQuery)({
        getProjectShells: () => Effect.succeed([project]),
        getShellSnapshot: () =>
          Effect.succeed({
            snapshotSequence: 1,
            projects: [project],
            threads: [waitingThread],
            updatedAt: "2026-09-18T05:00:30.000Z",
          }),
      }),
    ),
    Layer.provide(Layer.mock(ProviderRegistry)({ getProviders: Effect.succeed([provider]) })),
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

/** One piece of work with one live thread on it, as the fleet would see it. */
const givenWork = Effect.gen(function* () {
  const workSessions = yield* WorkSessionService;
  yield* workSessions.create({
    id: workSessionId,
    projectId,
    title: "Scheduler reconnect race",
  });
  yield* workSessions.attachThread({
    id: workSessionId,
    threadId: implThreadId,
    providerInstanceId: claude,
    providerDriver: ProviderDriverKind.make("claudeAgent"),
    role: "implementation",
    origin: "created",
  });
});

const run = <A, E>(
  body: (context: {
    readonly sent: Ref.Ref<ReadonlyArray<Sent>>;
  }) => Effect.Effect<A, E, FabricIntentService | WorkSessionService | OrchestrationRuleService>,
) =>
  Effect.gen(function* () {
    const { sent, effects } = yield* harness;
    return yield* body({ sent }).pipe(Effect.provide(baseLayer(effects)));
  });

describe("the intent surface", () => {
  it.effect("answers §20's question from the fleet, and records that it did", () =>
    run(() =>
      Effect.gen(function* () {
        yield* givenWork;
        const intents = yield* FabricIntentService;
        const result = yield* intents.run({ text: "What needs me?", focusedWorkSessionId: null });

        assert.strictEqual(result.resolution.outcome, "resolved");
        // The answer comes from the same states the fleet reports — the thread
        // is blocked on an approval, so that is what it says.
        assert.include(result.reply, "waiting for approval");
        assert.include(result.reply, "Scheduler reconnect race");
        assert.strictEqual(result.record.commandKind, "status_fleet");
        assert.strictEqual(result.record.outcome, "resolved");

        const logged = yield* intents.list({ workSessionId: null, limit: null });
        assert.lengthOf(logged, 1);
        assert.strictEqual(logged[0]?.text, "What needs me?");
      }),
    ),
  );

  it.effect("passes a message to the work's own session, in the user's words", () =>
    run(({ sent }) =>
      Effect.gen(function* () {
        yield* givenWork;
        const intents = yield* FabricIntentService;
        const result = yield* intents.run({
          text: "Tell the scheduler reconnect race to run the migration tests too",
          focusedWorkSessionId: null,
        });

        assert.strictEqual(result.record.commandKind, "message_work_session");
        assert.strictEqual(result.record.workSessionId, workSessionId);
        const delivered = yield* Ref.get(sent);
        assert.deepStrictEqual(delivered, [
          { threadId: implThreadId, text: "run the migration tests too" },
        ]);
      }),
    ),
  );

  it.effect("creates §22's rules from one sentence and sequences them", () =>
    run(() =>
      Effect.gen(function* () {
        yield* givenWork;
        const intents = yield* FabricIntentService;
        const result = yield* intents.run({
          text: "When Claude finishes this, have Claude review it and tell me if either needs me.",
          focusedWorkSessionId: workSessionId,
        });

        assert.strictEqual(result.record.commandKind, "create_rules");
        const rules = yield* OrchestrationRuleService;
        const listed = yield* rules.list({ workSessionId });
        assert.lengthOf(listed, 2);
        assert.deepStrictEqual(listed[0]?.rule.trigger, { kind: "on_done" });
        // The second rule waits for the first by its real id, which only exists
        // once the first has been created.
        assert.strictEqual(listed[1]?.rule.trigger.kind, "after_rule");
        if (listed[1]?.rule.trigger.kind === "after_rule") {
          assert.strictEqual(listed[1].rule.trigger.ruleId, listed[0]?.rule.id);
        }
      }),
    ),
  );

  it.effect("records a refusal as carefully as a success, and starts nothing", () =>
    run(({ sent }) =>
      Effect.gen(function* () {
        yield* givenWork;
        const intents = yield* FabricIntentService;
        const result = yield* intents.run({
          text: "Deploy to production",
          focusedWorkSessionId: workSessionId,
        });

        assert.strictEqual(result.resolution.outcome, "refused");
        assert.strictEqual(result.record.outcome, "refused");
        assert.strictEqual(result.record.refusalReason, "high_risk");
        assert.isNull(result.record.commandKind);
        // Nothing reached a provider. A refusal that still did something would
        // be the worst of both answers.
        assert.lengthOf(yield* Ref.get(sent), 0);

        const logged = yield* intents.list({ workSessionId: null, limit: null });
        assert.lengthOf(logged, 1);
        assert.strictEqual(logged[0]?.refusalReason, "high_risk");
      }),
    ),
  );

  it.effect("resolves without doing or recording anything", () =>
    run(({ sent }) =>
      Effect.gen(function* () {
        yield* givenWork;
        const intents = yield* FabricIntentService;
        const resolution = yield* intents.resolve({
          text: "Tell the scheduler reconnect race to stop",
          focusedWorkSessionId: null,
        });

        assert.strictEqual(resolution.outcome, "resolved");
        // A preview is a preview: no message, no row. This is what the input
        // calls on every keystroke.
        assert.lengthOf(yield* Ref.get(sent), 0);
        assert.lengthOf(
          yield* (yield* FabricIntentService).list({ workSessionId: null, limit: null }),
          0,
        );
      }),
    ),
  );

  it.effect("says it could not, rather than pretending it did", () =>
    run(() =>
      Effect.gen(function* () {
        // Work with no live session: "would not" and "could not" are different
        // answers and the log keeps them apart.
        const workSessions = yield* WorkSessionService;
        yield* workSessions.create({
          id: WorkSessionId.make("ws-empty"),
          projectId,
          title: "Nothing running",
        });
        const intents = yield* FabricIntentService;
        const outcome = yield* intents
          .run({ text: "Tell nothing running to stop", focusedWorkSessionId: null })
          .pipe(Effect.result);

        assert.strictEqual(outcome._tag, "Failure");
        const logged = yield* intents.list({ workSessionId: null, limit: null });
        assert.strictEqual(logged[0]?.outcome, "failed");
        assert.include(logged[0]?.reply ?? "", "no session running");
      }),
    ),
  );

  it.effect("lists one work session's intents, newest first", () =>
    run(() =>
      Effect.gen(function* () {
        yield* givenWork;
        const intents = yield* FabricIntentService;
        yield* intents.run({ text: "What needs me?", focusedWorkSessionId: null });
        yield* intents.run({
          text: "Tell the scheduler reconnect race to run the tests",
          focusedWorkSessionId: null,
        });

        const mine = yield* intents.list({ workSessionId, limit: null });
        assert.lengthOf(mine, 1);
        assert.strictEqual(mine[0]?.commandKind, "message_work_session");
        const all = yield* intents.list({ workSessionId: null, limit: null });
        assert.lengthOf(all, 2);
        assert.strictEqual(all[0]?.commandKind, "message_work_session");
      }),
    ),
  );
});
