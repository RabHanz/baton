/**
 * Keeps each work session's Working Synopsis current, from the orchestration
 * event log alone.
 *
 * §11.1's deterministic triggers, mapped onto the events T3 actually emits:
 *
 * | §11.1 trigger            | orchestration event            |
 * | ------------------------ | ------------------------------ |
 * | turn completed           | `thread.turn-diff-completed`   |
 * | file changed             | `thread.turn-diff-completed`   |
 * | test started / completed | `thread.activity-appended`     |
 * | approval requested       | `thread.activity-appended`     |
 * | provider question        | `thread.activity-appended`     |
 * | plan step changed        | `thread.activity-appended`     |
 * | background started/stop  | `thread.session-set`           |
 * | PR opened                | `thread.pull-request-linked`   |
 *
 * A turn *starting* comes from `thread.message-sent`, which carries the user's
 * words; `thread.turn-start-requested` carries only ids.
 *
 * §11 allows semantic summarisation at milestones, and since D51 this reactor
 * does it — at exactly one milestone, a completed turn, and at most once per
 * turn. Everything else stays assembled from events: the model writes the two
 * sentences that say where the work is and what is needed, and decides nothing.
 * `needsUser` in particular remains derived, because a model guessing "needs
 * approval" is a model deciding whether to interrupt a person.
 *
 * When no account here can write one — no provider, a driver without the
 * capability, a failed call — the deterministic synopsis stands. It is the
 * older, plainer answer, and it is never wrong about the facts.
 */
import { type OrchestrationEvent, type ThreadId, type TurnId } from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import { synopsisSignalForActivity, type SynopsisSignal } from "@t3tools/shared/fabricSynopsis";
import {
  buildSynopsisPrompt,
  SYNOPSIS_TURN_WINDOW,
  type SynopsisTurn,
} from "@t3tools/shared/fabricSynopsisModel";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import * as OrchestrationEngine from "../orchestration/Services/OrchestrationEngine.ts";
import * as ProjectionSnapshotQuery from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as ProviderRegistry from "../provider/Services/ProviderRegistry.ts";
import { forkParked } from "../serverActivation.ts";
import { TextGeneration } from "../textGeneration/TextGeneration.ts";
import { WorkSessionService } from "./WorkSessionService.ts";

/**
 * The tier that writes two sentences about a turn.
 *
 * A step above the intent classifier, because this is writing rather than
 * matching: the difference between "Running tests" and "The reconnect fix is in
 * and the queue drain no longer double-schedules" is the whole point, and the
 * cheapest tier does not reliably produce the second.
 */
export const SYNOPSIS_MODEL_SLUG = "claude-sonnet-5";

export class FabricSynopsisReactor extends Context.Service<
  FabricSynopsisReactor,
  {
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
    readonly drain: Effect.Effect<void>;
  }
>()("t3/fabric/SynopsisReactor/FabricSynopsisReactor") {}

interface Pending {
  readonly threadId: ThreadId;
  readonly signals: ReadonlyArray<SynopsisSignal>;
  /** Set only for a completed turn, which is the one milestone that is written. */
  readonly completedTurnId?: TurnId | undefined;
}

/**
 * Turn one orchestration event into synopsis signals.
 *
 * Exported for its test: this mapping is where a wrong guess about an event's
 * meaning would quietly produce a confident, false synopsis, so it is worth
 * asserting directly rather than through a reactor.
 */
export function synopsisSignalsForEvent(event: OrchestrationEvent): Pending | null {
  switch (event.type) {
    case "thread.message-sent": {
      const payload = event.payload;
      if (payload.role !== "user") return null;
      return {
        threadId: payload.threadId,
        signals: [{ kind: "turn-started", at: payload.createdAt, prompt: payload.text }],
      };
    }
    case "thread.turn-diff-completed": {
      const payload = event.payload;
      const paths = payload.files.map((file) => file.path);
      return {
        threadId: payload.threadId,
        completedTurnId: payload.turnId,
        signals: [
          ...(paths.length === 0
            ? []
            : [{ kind: "files-changed" as const, at: payload.completedAt, paths }]),
          { kind: "turn-completed" as const, at: payload.completedAt },
        ],
      };
    }
    case "thread.activity-appended": {
      const signal = synopsisSignalForActivity(event.payload.activity);
      return signal === null ? null : { threadId: event.payload.threadId, signals: [signal] };
    }
    case "thread.session-set": {
      const session = event.payload.session;
      // The session's own status is the state machine's business; what the
      // synopsis wants from it is the one thing the state does not say —
      // whether the provider failed, and why.
      if (session.status !== "error" || session.lastError === null) return null;
      return {
        threadId: event.payload.threadId,
        signals: [{ kind: "turn-failed", at: session.updatedAt, reason: session.lastError }],
      };
    }
    case "thread.pull-request-linked": {
      const payload = event.payload;
      return {
        threadId: payload.threadId,
        signals: [
          {
            kind: "pull-request-opened",
            at: payload.updatedAt,
            label: `${payload.link.repository}#${payload.link.number}`,
          },
        ],
      };
    }
    default:
      return null;
  }
}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const engine = yield* OrchestrationEngine.OrchestrationEngineService;
  const workSessions = yield* WorkSessionService;
  const snapshotQuery = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
  const providerRegistry = yield* ProviderRegistry.ProviderRegistry;
  const textGeneration = yield* TextGeneration;

  /**
   * Turns already written about.
   *
   * "At most once per trigger" is the Director's own wording, and a turn id is
   * exactly that trigger's identity. Bounded, because this is a running
   * server: a thousand turns later, whether turn one was written is not a
   * question anybody asks.
   */
  const WRITTEN_TURN_LIMIT = 256;
  const writtenTurns = new Set<string>();
  const markWritten = (turnId: string): boolean => {
    if (writtenTurns.has(turnId)) return false;
    writtenTurns.add(turnId);
    while (writtenTurns.size > WRITTEN_TURN_LIMIT) {
      const oldest = writtenTurns.values().next();
      if (oldest.done === true) break;
      writtenTurns.delete(oldest.value);
    }
    return true;
  };

  /** The first available account, the same boring rule the intent path uses. */
  const chooseInstance = Effect.gen(function* () {
    const providers = yield* providerRegistry.getProviders.pipe(
      Effect.catchCause(() => Effect.succeed([])),
    );
    const available = providers.find(
      (provider) => provider.enabled && provider.installed && provider.driver === "claudeAgent",
    );
    return available?.instanceId ?? null;
  });

  const recentTurns = (threadId: ThreadId) =>
    Effect.gen(function* () {
      const detail = yield* snapshotQuery
        .getThreadDetailSnapshot(threadId, { turnLimit: SYNOPSIS_TURN_WINDOW })
        .pipe(Effect.catchCause(() => Effect.succeed(Option.none())));
      if (Option.isNone(detail)) return [] as ReadonlyArray<SynopsisTurn>;
      const messages = detail.value.thread.messages ?? [];
      return messages.flatMap((message): ReadonlyArray<SynopsisTurn> => {
        const role =
          message.role === "user" ? "user" : message.role === "assistant" ? "assistant" : null;
        const text = typeof message.text === "string" ? message.text : "";
        return role === null || text.trim().length === 0 ? [] : [{ role, text }];
      });
    });

  /**
   * Write the two sentences, if anything here can.
   *
   * Every failure is silent and leaves the assembled synopsis in place: no
   * account, no capability, no answer. A synopsis is a convenience, and the
   * plain one is never wrong about the facts.
   */
  const writeSynopsis = (input: {
    readonly workSessionId: string;
    readonly threadId: ThreadId;
    readonly at: string;
  }) =>
    Effect.gen(function* () {
      const write = textGeneration.writeFabricSynopsis;
      if (write === undefined) return;
      const instanceId = yield* chooseInstance;
      if (instanceId === null) return;

      const workSession = yield* workSessions.get(input.workSessionId as never);
      const turns = yield* recentTurns(input.threadId);
      if (turns.length === 0) return;

      const written = yield* write({
        prompt: buildSynopsisPrompt({
          title: workSession.title,
          objective: workSession.objective,
          turns,
        }),
        modelSelection: {
          instanceId: instanceId as never,
          model: SYNOPSIS_MODEL_SLUG,
          options: [],
        },
      });

      yield* workSessions.applySynopsis({
        workSessionId: input.workSessionId as never,
        signals: [
          {
            kind: "written",
            at: input.at,
            currentAction: written.currentAction,
            next: written.next,
          },
        ],
      });
    }).pipe(Effect.ignoreCause({ log: true }));

  const worker = yield* makeDrainableWorker((pending: Pending) =>
    Effect.gen(function* () {
      const workSessionId = yield* workSessions.findForThread(pending.threadId);
      // Most threads belong to no work session, and that is the normal case
      // while Fabric is opt-in. Nothing to do, no log line worth writing.
      if (workSessionId === null) return;
      yield* workSessions.applySynopsis({ workSessionId, signals: pending.signals });

      // The written account comes after the assembled one, so the facts are
      // already current when the model's two sentences land on top of them.
      const turnId = pending.completedTurnId;
      if (turnId === undefined || !markWritten(turnId)) return;
      const at = pending.signals.at(-1)?.at;
      if (at === undefined) return;
      yield* writeSynopsis({ workSessionId, threadId: pending.threadId, at });
    }).pipe(
      // A synopsis is a convenience. A failure to write one must never take
      // down the event loop that carries the work itself.
      Effect.ignoreCause({ log: true }),
    ),
  );

  const start: FabricSynopsisReactor["Service"]["start"] = Effect.fn("FabricSynopsisReactor.start")(
    function* () {
      const events = yield* engine.subscribeDomainEvents;
      yield* forkParked(
        Stream.runForEach(events, (event) => {
          const pending = synopsisSignalsForEvent(event);
          return pending === null ? Effect.void : worker.enqueue(pending);
        }),
      );
    },
  );

  return { start, drain: worker.drain } satisfies FabricSynopsisReactor["Service"];
});

export const layer = Layer.effect(FabricSynopsisReactor, make);
