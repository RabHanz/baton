/**
 * One thread's account (D95). Accounts are provider instances and their homes share transcripts, so
 * a move is `thread.model-selection.set` and the next turn resumes the conversation. That releases
 * the live session at once, so during a turn the move is stored and applied when the turn ends.
 */
import type { BatonThreadAccountUseResult } from "@t3tools/baton-contracts";
import { ProviderInstanceId, ThreadId, type ModelSelection } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as Stream from "effect/Stream";

import { BatonEngine, type BatonEngineShape } from "./BatonEngine.ts";

export class ThreadAccountMoveError extends Schema.TaggedError<ThreadAccountMoveError>()(
  "ThreadAccountMoveError",
  { detail: Schema.String },
) {
  override get message(): string {
    return this.detail;
  }
}

// Not "queued": a run held by a spent account is exactly the thread that needs to move.
const TURN_RUN_STATUSES: ReadonlySet<string> = new Set([
  "preparing",
  "starting",
  "running",
  "waiting",
]);

const isMoveError = Schema.is(ThreadAccountMoveError);

export const threadHasRunningTurn = (runs: ReadonlyArray<{ readonly status: string }>): boolean =>
  runs.some((run) => TURN_RUN_STATUSES.has(run.status));

/** The same conversation and model, on another instance. */
export const selectionOnInstance = (
  selection: ModelSelection,
  instanceId: string,
): ModelSelection =>
  ({ ...selection, instanceId: ProviderInstanceId.make(instanceId) }) as ModelSelection;

export interface ThreadAccountMovesShape {
  readonly request: (input: {
    readonly threadId: ThreadId;
    readonly instanceId: string;
  }) => Effect.Effect<BatonThreadAccountUseResult, ThreadAccountMoveError>;
}

export class ThreadAccountMoves extends Context.Service<
  ThreadAccountMoves,
  ThreadAccountMovesShape
>()("t3/baton/ThreadAccountMoves") {}

export const makeMoves = Effect.fn("ThreadAccountMoves.make")(function* (
  engine: BatonEngineShape,
  sql: SqlClient.SqlClient,
) {
  const stored = yield* sql<{ readonly thread_id: string; readonly instance_id: string }>`
    SELECT thread_id, instance_id FROM fabric_thread_account_moves
  `;
  const pending = new Map(stored.map((row) => [row.thread_id, row.instance_id]));

  const forget = (threadId: string) =>
    Effect.suspend(() => {
      pending.delete(threadId);
      return sql`DELETE FROM fabric_thread_account_moves WHERE thread_id = ${threadId}`;
    });

  const move = Effect.fn("ThreadAccountMoves.move")(function* (
    threadId: ThreadId,
    instanceId: string,
  ) {
    const shell = yield* engine.threadShell(threadId);
    if (shell === null) return yield* new ThreadAccountMoveError({ detail: "No such thread." });
    if (shell.modelSelection.instanceId === instanceId) return;
    yield* engine.setThreadSelection({
      tag: "account",
      threadId,
      modelSelection: selectionOnInstance(shell.modelSelection, instanceId),
    });
  });

  const applyWhenIdle = Effect.fn("ThreadAccountMoves.applyWhenIdle")(
    function* (threadId: string, instanceId: string) {
      const id = ThreadId.make(threadId);
      if (threadHasRunningTurn(yield* engine.threadRuns(id))) return;
      yield* forget(threadId);
      yield* move(id, instanceId);
      yield* Effect.logInfo("Baton moved a thread to another account", { threadId, instanceId });
    },
    Effect.ignoreCause({ log: true }),
  );

  const request: ThreadAccountMovesShape["request"] = Effect.fn("ThreadAccountMoves.request")(
    function* ({ threadId, instanceId }) {
      if (threadHasRunningTurn(yield* engine.threadRuns(threadId))) {
        const now = DateTime.formatIso(yield* DateTime.now);
        yield* sql`
          INSERT INTO fabric_thread_account_moves (thread_id, instance_id, requested_at)
          VALUES (${threadId}, ${instanceId}, ${now})
          ON CONFLICT (thread_id) DO UPDATE SET
            instance_id = excluded.instance_id,
            requested_at = excluded.requested_at
        `;
        pending.set(threadId, instanceId);
        return { instanceId, timing: "next-turn" as const };
      }
      // A later choice replaces a waiting one.
      yield* forget(threadId);
      yield* move(threadId, instanceId);
      return { instanceId, timing: "now" as const };
    },
    Effect.mapError((cause) =>
      isMoveError(cause) ? cause : new ThreadAccountMoveError({ detail: String(cause) }),
    ),
  );

  const settle = (threadId: string) => {
    const instanceId = pending.get(threadId);
    return instanceId === undefined ? Effect.void : applyWhenIdle(threadId, instanceId);
  };

  return { request, settle, pendingThreadIds: () => [...pending.keys()] };
});

export const layer = Layer.effect(
  ThreadAccountMoves,
  Effect.gen(function* () {
    const engine = yield* BatonEngine;
    const sql = yield* SqlClient.SqlClient;
    const moves = yield* makeMoves(engine, sql);
    // Moves left waiting by a restart first, then every thread as it changes.
    yield* Effect.forEach(moves.pendingThreadIds(), moves.settle, { discard: true });
    yield* engine.changedThreads.pipe(Stream.runForEach(moves.settle), Effect.forkScoped);
    return ThreadAccountMoves.of({ request: moves.request });
  }),
);
