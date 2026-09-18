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
 * Nothing here calls a model. §11 allows semantic summarisation at milestones
 * and this reactor deliberately does not do it — `docs/fabric/DECISIONS.md`
 * D16 records why, and what it would take to turn on.
 */
import { type OrchestrationEvent, type ThreadId } from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import { synopsisSignalForActivity, type SynopsisSignal } from "@t3tools/shared/fabricSynopsis";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import * as OrchestrationEngine from "../orchestration/Services/OrchestrationEngine.ts";
import { forkParked } from "../serverActivation.ts";
import { WorkSessionService } from "./WorkSessionService.ts";

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

  const worker = yield* makeDrainableWorker((pending: Pending) =>
    Effect.gen(function* () {
      const workSessionId = yield* workSessions.findForThread(pending.threadId);
      // Most threads belong to no work session, and that is the normal case
      // while Fabric is opt-in. Nothing to do, no log line worth writing.
      if (workSessionId === null) return;
      yield* workSessions.applySynopsis({ workSessionId, signals: pending.signals });
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
