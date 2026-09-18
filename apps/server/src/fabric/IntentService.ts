/**
 * The environment's answer to "here is a sentence; what does it mean, and do
 * it".
 *
 * Three jobs, in this order, and the order is the design:
 *
 *   1. **Build the vocabulary from what is actually here.** Work sessions,
 *      projects, accounts, the questions currently waiting for an answer, this
 *      machine's own names. The grammar resolves against facts, so "Codex"
 *      means this environment's Codex and "the scheduler" means a work session
 *      that exists — or the sentence is refused.
 *   2. **Resolve, deterministically.** `resolveFabricIntent` is a pure
 *      function of the sentence and that vocabulary. No model, no clock, no
 *      network. The same words on the same fleet always produce the same
 *      command, which is what makes the read-back before execution worth
 *      anything.
 *   3. **Record what happened, including the refusals.** A log that keeps only
 *      what worked cannot show a grammar its own blind spots, and on a surface
 *      fed by dictation the interesting question is usually "what did it think
 *      I said?".
 *
 * The vocabulary is read from the **fleet**, not assembled separately: the
 * states a sentence resolves against have to be the states the user was just
 * told about, or "tell it to stop" means one thing on screen and another here.
 */
import {
  DEFAULT_INTENT_LIST_LIMIT,
  FabricIntentExecutionError,
  FabricIntentId,
  FabricIntentStorageError,
  isProviderAvailable,
  type FabricIntentCommand,
  type FabricIntentError,
  type FabricIntentEvent,
  type FabricIntentRecord,
  type FabricIntentResolution,
  type WorkSessionId,
} from "@t3tools/contracts";
import {
  resolveFabricIntent,
  type IntentGate,
  type IntentProvider,
  type IntentVocabulary,
} from "@t3tools/shared/fabricIntentParser";
import { HostProcessHostname } from "@t3tools/shared/hostProcess";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import type * as Scope from "effect/Scope";

import * as ProjectionSnapshotQuery from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as ProviderRegistry from "../provider/Services/ProviderRegistry.ts";
import { getFleet } from "./FleetQuery.ts";
import {
  FabricIntentRepository,
  layer as intentRepositoryLayer,
  type FabricIntentRow,
} from "./IntentRepository.ts";
import { OrchestrationRuleService } from "./OrchestrationRuleService.ts";
import { WorkSessionService } from "./WorkSessionService.ts";

/**
 * What running a resolved command actually does.
 *
 * Injected rather than imported for the same reason the orchestration effects
 * are: the list of things a sentence can cause has to be short, named, and in
 * one file that somebody reviews when it grows.
 */
export interface IntentExecution {
  /** What to say back. Plain text, for whatever TTS the client has. */
  readonly reply: string;
  /** Known only after execution for a command that creates work. */
  readonly workSessionId: WorkSessionId | null;
  /** "Could not", as opposed to "would not". The user needs the difference. */
  readonly failed: boolean;
}

export class FabricIntentExecutor extends Context.Service<
  FabricIntentExecutor,
  {
    readonly execute: (command: FabricIntentCommand) => Effect.Effect<IntentExecution>;
  }
>()("t3/fabric/IntentService/FabricIntentExecutor") {}

export class FabricIntentService extends Context.Service<
  FabricIntentService,
  {
    /** Resolve and do nothing. What the input shows you before you press enter. */
    readonly resolve: (input: {
      readonly text: string;
      readonly focusedWorkSessionId: WorkSessionId | null;
    }) => Effect.Effect<FabricIntentResolution, FabricIntentError>;
    readonly run: (input: {
      readonly text: string;
      readonly focusedWorkSessionId: WorkSessionId | null;
    }) => Effect.Effect<
      {
        readonly resolution: FabricIntentResolution;
        readonly reply: string;
        readonly record: FabricIntentRecord;
      },
      FabricIntentError
    >;
    readonly list: (input: {
      readonly workSessionId: WorkSessionId | null;
      readonly limit: number | null;
    }) => Effect.Effect<ReadonlyArray<FabricIntentRecord>, FabricIntentError>;
    readonly subscribe: Effect.Effect<PubSub.Subscription<FabricIntentEvent>, never, Scope.Scope>;
  }
>()("t3/fabric/IntentService/FabricIntentService") {}

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

const firstWord = (text: string): string => text.trim().split(/\s+/)[0] ?? text;

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const repository = yield* FabricIntentRepository;
  const snapshotQuery = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
  const providerRegistry = yield* ProviderRegistry.ProviderRegistry;
  const rules = yield* OrchestrationRuleService;
  const executor = yield* FabricIntentExecutor;
  const hostname = yield* HostProcessHostname;
  // The three services `getFleet` reads through, named explicitly. Inferring
  // them from the function's own type resolves to `any` and quietly poisons the
  // requirement channel of everything downstream — which is how a change here
  // turns into three hundred errors in `server.test.ts`.
  const fleetContext = yield* Effect.context<
    | WorkSessionService
    | ProjectionSnapshotQuery.ProjectionSnapshotQuery
    | ProviderRegistry.ProviderRegistry
  >();

  // Unique within this process, and a restart moves the prefix. No clock
  // collision, no randomness, and the ids sort in the order they happened.
  const startedAt = yield* Effect.clockWith((clock) => clock.currentTimeMillis);
  let sequence = 0;
  const nextId = (): FabricIntentId => {
    sequence += 1;
    return FabricIntentId.make(`intent-${startedAt}-${sequence}`);
  };

  const events = yield* PubSub.unbounded<FabricIntentEvent>();
  const publish = (event: FabricIntentEvent) => PubSub.publish(events, event).pipe(Effect.asVoid);

  const storageFailure = (operation: string) => () =>
    new FabricIntentStorageError({ operation, detail: "the intent log is not writable" });

  const providerVocabulary = Effect.gen(function* () {
    const providers = yield* providerRegistry.getProviders.pipe(
      Effect.catchCause(() => Effect.succeed([])),
    );
    const candidates = providers.map((provider) => {
      const display = provider.displayName ?? provider.driver;
      return {
        provider,
        display,
        // The user's own words for an account: what it is called, what the
        // driver is called, the instance id someone may well say out loud, and
        // the first word of the display name — because he says "Claude", not
        // "Claude A", whenever there is only one.
        aliases: [display, provider.driver, provider.instanceId, firstWord(display)],
      };
    });

    // An alias two accounts answer to is no alias at all. Dropping it makes
    // "have Claude review it" a refusal that names the clause when there are
    // two Claudes, instead of a silent choice between them.
    const counts = new Map<string, number>();
    for (const candidate of candidates) {
      for (const alias of new Set(candidate.aliases.map((alias) => alias.toLowerCase()))) {
        counts.set(alias, (counts.get(alias) ?? 0) + 1);
      }
    }

    return candidates.map((candidate): IntentProvider => ({
      instanceId: candidate.provider.instanceId,
      label: candidate.display,
      aliases: candidate.aliases.filter((alias) => counts.get(alias.toLowerCase()) === 1),
      model: candidate.provider.models[0]?.slug ?? null,
      available:
        candidate.provider.enabled &&
        candidate.provider.installed &&
        isProviderAvailable(candidate.provider),
    }));
  });

  /** Confirmation gates waiting for an answer, across every work session. */
  const openGates = Effect.gen(function* () {
    const listed = yield* rules
      .list({ includeDisabled: true })
      .pipe(Effect.catchCause(() => Effect.succeed([])));
    const gates: IntentGate[] = [];
    for (const entry of listed) {
      for (const firing of entry.firings) {
        if (firing.outcome !== "awaiting_confirmation") continue;
        gates.push({
          firingId: firing.id,
          workSessionId: firing.workSessionId,
          // The question is the gate's own text, which is what the user will
          // be read back when two are waiting.
          question:
            entry.rule.action.kind === "confirmation_gate"
              ? entry.rule.action.question
              : firing.detail,
        });
      }
    }
    return gates;
  });

  const buildVocabulary = (focusedWorkSessionId: WorkSessionId | null) =>
    Effect.gen(function* () {
      const fleet = yield* getFleet({}).pipe(
        Effect.provideContext(fleetContext),
        Effect.catchCause(() => Effect.succeed(null)),
      );
      const projectShells = yield* snapshotQuery
        .getProjectShells()
        .pipe(Effect.catchCause(() => Effect.succeed([])));
      const projectTitle = new Map(projectShells.map((project) => [project.id, project.title]));

      const short = hostname.split(".")[0]?.trim() ?? hostname;
      const vocabulary: IntentVocabulary = {
        workSessions: (fleet?.entries ?? []).map((entry) => ({
          id: entry.workSessionId,
          title: entry.title,
          projectId: entry.projectId,
          projectLabel: projectTitle.get(entry.projectId) ?? null,
          needsApproval: entry.state === "needs_approval",
          updatedAt: entry.updatedAt,
        })),
        projects: projectShells.map((project) => ({ id: project.id, title: project.title })),
        providers: yield* providerVocabulary,
        openGates: yield* openGates,
        hostAliases: [hostname, short, "this box", "this machine", "here"],
        focusedWorkSessionId,
      };
      return vocabulary;
    });

  const resolve: FabricIntentService["Service"]["resolve"] = ({ text, focusedWorkSessionId }) =>
    Effect.map(buildVocabulary(focusedWorkSessionId), (vocabulary) =>
      resolveFabricIntent(text, vocabulary),
    );

  const record = (row: FabricIntentRow) =>
    repository
      .insert(row)
      .pipe(Effect.mapError(storageFailure("write")), Effect.as(row as FabricIntentRecord));

  const run: FabricIntentService["Service"]["run"] = ({ text, focusedWorkSessionId }) =>
    Effect.gen(function* () {
      const id = nextId();
      const at = yield* nowIso;
      const trimmed = text.trim();
      yield* publish({ kind: "fabric.intent.received", id, text: trimmed, at });

      const resolution = yield* resolve({ text, focusedWorkSessionId });

      if (resolution.outcome === "refused") {
        const row = yield* record({
          id,
          text: trimmed,
          outcome: "refused",
          commandKind: null,
          workSessionId: null,
          description: "",
          reply: resolution.refusal.message,
          // A refusal is not an action, so it carries no risk of its own —
          // including the high-risk refusal, which is the absence of one.
          risk: "low",
          refusalReason: resolution.refusal.reason,
          at,
        });
        yield* publish({ kind: "fabric.intent.refused", record: row });
        return { resolution, reply: resolution.refusal.message, record: row };
      }

      const execution = yield* executor.execute(resolution.command);
      const row = yield* record({
        id,
        text: trimmed,
        outcome: execution.failed ? "failed" : "resolved",
        commandKind: resolution.command.kind,
        workSessionId: execution.workSessionId ?? resolution.workSessionId,
        description: resolution.description,
        reply: execution.reply,
        risk: resolution.risk,
        refusalReason: null,
        at,
      });
      yield* publish({ kind: "fabric.intent.resolved", record: row });
      if (execution.failed) {
        // Recorded first, then raised: the caller gets an error, and the log
        // still shows what was attempted.
        return yield* new FabricIntentExecutionError({
          commandKind: resolution.command.kind,
          detail: execution.reply,
        });
      }
      return { resolution, reply: execution.reply, record: row };
    });

  const list: FabricIntentService["Service"]["list"] = ({ workSessionId, limit }) =>
    repository.list({ workSessionId, limit: limit ?? DEFAULT_INTENT_LIST_LIMIT }).pipe(
      Effect.mapError(storageFailure("read")),
      Effect.map((rows) => rows as ReadonlyArray<FabricIntentRecord>),
    );

  return {
    resolve,
    run,
    list,
    subscribe: PubSub.subscribe(events),
  } satisfies FabricIntentService["Service"];
});

export const layer = Layer.effect(FabricIntentService, make).pipe(
  Layer.provideMerge(intentRepositoryLayer),
);
