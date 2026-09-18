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
 *   2. **Resolve — deterministically first, and deterministically last.**
 *      `resolveFabricIntent` is a pure function of the sentence and that
 *      vocabulary: no model, no clock, no network, the same command every
 *      time. When it cannot place a sentence, two more things are tried in
 *      order, and only in this order (D50):
 *
 *        - **a phrasing the user has already confirmed**, replayed from the
 *          vocabulary table. Still no model, still instant, still identical.
 *        - **a model**, running as one of the user's own accounts, answering in
 *          the same schema and naming ids it was shown. Everything it returns
 *          is then checked by the same deterministic rules — the ids have to
 *          exist, §24.1 is matched again on what it produced, and low
 *          confidence becomes a question rather than an action.
 *
 *      The read-back before execution is what makes that safe, and it is now
 *      load-bearing rather than merely polite.
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
  FabricIntentCommand as FabricIntentCommandSchema,
  DEFAULT_INTENT_LIST_LIMIT,
  DEFAULT_RETENTION,
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
import { expiredRecords } from "@t3tools/shared/fabricRetention";
import {
  normaliseIntentText,
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
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";

import * as ProjectionSnapshotQuery from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as ProviderRegistry from "../provider/Services/ProviderRegistry.ts";
import { getFleet } from "./FleetQuery.ts";
import {
  FabricIntentRepository,
  layer as intentRepositoryLayer,
  type FabricIntentRow,
} from "./IntentRepository.ts";
import { AdoptedSessionService } from "./AdoptedSessionService.ts";
import { FabricIntentInterpreter, layer as intentInterpreterLayer } from "./IntentInterpreter.ts";
import {
  FabricIntentVocabularyRepository,
  layer as intentVocabularyRepositoryLayer,
} from "./IntentVocabularyRepository.ts";
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
      /** Absent or false: grammar and learned phrasings only, never a model. */
      readonly allowModel?: boolean | undefined;
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

const encodeLearnedCommand = Schema.encodeEffect(Schema.fromJsonString(FabricIntentCommandSchema));

const firstWord = (text: string): string => text.trim().split(/\s+/)[0] ?? text;

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const repository = yield* FabricIntentRepository;
  const vocabularyMemory = yield* FabricIntentVocabularyRepository;
  const interpreter = yield* FabricIntentInterpreter;
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
    | AdoptedSessionService
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

  /** How many confirmed phrasings the prompt carries as examples. */
  const LEARNED_EXAMPLES = 8;

  /**
   * Readings shown to the user but not yet acted on.
   *
   * Small and short-lived on purpose: this is the gap between "here is what I
   * think you said" and "yes, do that", which is seconds. Anything longer
   * belongs in the learned table, and gets there by being run.
   */
  const RECENT_READING_LIMIT = 16;
  const recentReadings = new Map<
    string,
    { readonly resolution: FabricIntentResolution; readonly model: string }
  >();
  const rememberReading = (
    normalised: string,
    reading: { readonly resolution: FabricIntentResolution; readonly model: string },
  ): void => {
    recentReadings.set(normalised, reading);
    while (recentReadings.size > RECENT_READING_LIMIT) {
      const oldest = recentReadings.keys().next();
      if (oldest.done === true) break;
      recentReadings.delete(oldest.value);
    }
  };

  const decodeLearnedCommand = Schema.decodeUnknownOption(
    Schema.fromJsonString(FabricIntentCommandSchema),
  );

  /**
   * Resolve, and say which of the three answered.
   *
   * Everything downstream needs that: the record keeps it, the learning step
   * only fires for a model reading, and a reader asking "why did that happen?"
   * gets "the grammar did", "you have said that before", or "a model read it,
   * and here is which one".
   */
  const resolveWithSource = ({
    text,
    focusedWorkSessionId,
    allowModel,
  }: {
    readonly text: string;
    readonly focusedWorkSessionId: WorkSessionId | null;
    readonly allowModel?: boolean | undefined;
  }) =>
    Effect.gen(function* () {
      const vocabulary = yield* buildVocabulary(focusedWorkSessionId);
      const grammar = resolveFabricIntent(text, vocabulary);

      // Which refusals get a second reader, and which are final.
      //
      // Open: the grammar could not parse the shape (`unrecognised`), could not
      // parse a rule (`rule_not_understood`), or parsed a shape and could not
      // place the name in it (`unknown_target` — "the scheduler one" is a
      // target a model reads easily and the grammar cannot).
      //
      // Closed, and deliberately:
      //   - `high_risk`: §24.1 is matched before the model, and a sentence that
      //     asks for a production deploy does not get a second opinion.
      //   - `not_available_yet`: a fact about this build, not a reading.
      //   - `nothing_to_confirm`: a fact about the world — nothing is parked.
      //   - `ambiguous_target`: the grammar found *several* matches and asked
      //     which. Letting a model pick is precisely the "never guess a target"
      //     rule this surface is built on (§14 rung 9).
      const openToModel =
        grammar.outcome === "refused" &&
        (grammar.refusal.reason === "unrecognised" ||
          grammar.refusal.reason === "rule_not_understood" ||
          grammar.refusal.reason === "unknown_target");
      if (!openToModel) {
        return { resolution: grammar, source: "grammar" as const, model: null, normalised: null };
      }

      const normalised = normaliseIntentText(text);
      const learned = yield* vocabularyMemory
        .find(normalised)
        .pipe(Effect.catchCause(() => Effect.succeed(null)));
      if (learned !== null) {
        const command = decodeLearnedCommand(learned.commandJson);
        if (Option.isSome(command)) {
          return {
            resolution: {
              outcome: "resolved",
              command: command.value,
              description: learned.description,
              risk: learned.risk,
              workSessionId: learned.workSessionId,
            } satisfies FabricIntentResolution,
            source: "learned" as const,
            model: null,
            normalised,
          };
        }
      }

      // A reading the user was just shown is the reading that runs. Without
      // this the same sentence could be read differently on the second call,
      // and the line they approved would describe a command that never
      // executed.
      const remembered = recentReadings.get(normalised);
      if (remembered !== undefined) {
        return {
          resolution: remembered.resolution,
          source: "model" as const,
          model: remembered.model,
          normalised,
        };
      }

      if (allowModel !== true) {
        return { resolution: grammar, source: "grammar" as const, model: null, normalised };
      }

      const examples = yield* vocabularyMemory
        .list(LEARNED_EXAMPLES)
        .pipe(Effect.catchCause(() => Effect.succeed([])));
      const read = yield* interpreter.interpret({
        sentence: text.trim(),
        vocabulary,
        learned: examples.map((entry) => ({
          text: entry.text,
          description: entry.description,
        })),
      });
      if (read === null) {
        return { resolution: grammar, source: "grammar" as const, model: null, normalised };
      }
      rememberReading(normalised, { resolution: read.resolution, model: read.model });
      return {
        resolution: read.resolution,
        source: "model" as const,
        model: read.model,
        normalised,
      };
    });

  const resolve: FabricIntentService["Service"]["resolve"] = (input) =>
    Effect.map(resolveWithSource(input), (read) => read.resolution);

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

      const read = yield* resolveWithSource({ text, focusedWorkSessionId, allowModel: true });
      const resolution = read.resolution;

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
          source: read.source,
          model: read.model,
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
        source: read.source,
        model: read.model,
      });
      yield* publish({ kind: "fabric.intent.resolved", record: row });
      yield* learnFromReading({ read, text: trimmed, resolution, failed: execution.failed, at });
      yield* prune;
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

  /**
   * Remember a phrasing the user actually meant.
   *
   * Only on a model reading that *ran* and did not fail: a resolution the user
   * previewed and walked away from is the closest thing to a "no" this surface
   * gets, and a failed execution says nothing about whether the reading was
   * right. A learned phrasing that was already there has its use count bumped
   * instead, which is what makes "used once" and "used daily" distinguishable
   * later.
   */
  const learnFromReading = ({
    read,
    text,
    resolution,
    failed,
    at,
  }: {
    readonly read: {
      readonly source: string;
      readonly model: string | null;
      readonly normalised: string | null;
    };
    readonly text: string;
    readonly resolution: FabricIntentResolution;
    readonly failed: boolean;
    readonly at: string;
  }) =>
    Effect.gen(function* () {
      if (read.normalised !== null) recentReadings.delete(read.normalised);
      if (read.normalised === null || resolution.outcome !== "resolved") return;
      if (read.source === "learned") {
        yield* vocabularyMemory.markUsed({ normalisedText: read.normalised, at });
        return;
      }
      if (read.source !== "model" || read.model === null || failed) return;
      const commandJson = yield* encodeLearnedCommand(resolution.command);
      yield* vocabularyMemory.learn({
        normalisedText: read.normalised,
        text,
        commandJson,
        description: resolution.description,
        risk: resolution.risk,
        workSessionId: resolution.workSessionId,
        model: read.model,
        learnedAt: at,
      });
    }).pipe(Effect.ignoreCause({ log: true }));

  /**
   * §26's horizon, applied where the log grows rather than on a timer.
   *
   * A scheduler would be a second lifecycle to keep honest, and this log only
   * grows when somebody says something — so pruning here runs exactly as often
   * as it needs to and never on an idle machine. The *rule* is the shared one
   * (`expiredRecords`), so the horizon cannot drift between the policy and the
   * SQL.
   */
  const prune = Effect.gen(function* () {
    const now = yield* Effect.clockWith((clock) => clock.currentTimeMillis);
    const records = yield* repository
      .listForRetention()
      .pipe(Effect.catchCause(() => Effect.succeed([])));
    const expired = expiredRecords({
      records,
      days: DEFAULT_RETENTION.intentDays,
      keepRefusals: DEFAULT_RETENTION.keepRefusals,
      now,
    });
    if (expired.length === 0) return;
    yield* repository.deleteByIds(expired).pipe(Effect.ignoreCause({ log: true }));
  }).pipe(Effect.ignoreCause({ log: true }));

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
  Layer.provideMerge(intentVocabularyRepositoryLayer),
  // The interpreter is provided here rather than merged: nothing else needs it,
  // and leaving it in the requirement channel would push a Fabric detail into
  // every place that builds the routes.
  Layer.provide(intentInterpreterLayer),
);
