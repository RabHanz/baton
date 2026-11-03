// @effect-diagnostics globalDate:off preferSchemaOverJson:off
/**
 * Retire a handoff session: a live (mirrored) thread that a provider switch moved onto a T3-hosted twin goes back to
 * its own live provider, the twin's session is released by the provider layer (never by killing a pid), and the twin's
 * mirror thread is archived (ids written to an undo file) and then deleted. The main thread keeps every message and run.
 */
import { isLiveThreadId, LIVE_INSTANCE } from "@t3tools/baton-shared/liveThread";
import * as Effect from "effect/Effect";

import type { BatonEngineError } from "./BatonEngine.ts";

export const retireToken = (threadId: string): string => `retire-handoff:${threadId}`;

export interface RetirePorts {
  readonly shell: (
    threadId: string,
  ) => Effect.Effect<{ readonly instanceId: string; readonly running: boolean } | null>;
  /** Back to the live instance; the provider layer releases the handoff session. */
  readonly selectLive: (threadId: string) => Effect.Effect<void, BatonEngineError>;
  readonly activeInstance: (threadId: string) => Effect.Effect<string | null>;
  readonly archive: (threadId: string) => Effect.Effect<boolean>;
  readonly remove: (threadId: string) => Effect.Effect<boolean>;
  /** Returns where the undo list was written, or null if it could not be. */
  readonly writeUndo: (json: string) => string | null;
}

export interface RetireResult {
  readonly state: "retired" | "refused" | "incomplete";
  readonly detail: string;
  readonly undoFile: string | null;
}

const refused = (detail: string): RetireResult => ({ state: "refused", detail, undoFile: null });

export const retireHandoff = Effect.fn("RetireHandoff.retire")(function* (
  ports: RetirePorts,
  input: {
    readonly threadId: string;
    readonly twinThreadId: string;
    readonly confirm: string;
    readonly caughtUp: boolean;
  },
) {
  if (input.confirm !== retireToken(input.threadId))
    return refused(`Not done: confirm must be exactly ${retireToken(input.threadId)}.`);
  if (!input.caughtUp)
    return refused("Not done: say that the live session has caught up (caughtUp: true).");
  if (!isLiveThreadId(input.threadId) || !isLiveThreadId(input.twinThreadId))
    return refused("Not done: both threads must be mirrored live threads.");
  if (input.threadId === input.twinThreadId)
    return refused("Not done: the twin cannot be the main thread.");
  const main = yield* ports.shell(input.threadId);
  if (main === null) return refused("Not done: the main thread does not exist.");
  if (main.instanceId === LIVE_INSTANCE)
    return refused("Not done: that thread is already answered by its live session.");
  if (main.running) return refused("Not done: the handoff session is working; wait for its turn.");
  const twin = yield* ports.shell(input.twinThreadId);
  if (twin === null) return refused("Not done: the twin's mirror thread does not exist.");
  if (twin.instanceId !== LIVE_INSTANCE)
    return refused("Not done: the twin's mirror thread is not a live mirror.");

  const switched = yield* Effect.exit(ports.selectLive(input.threadId));
  const now = yield* ports.activeInstance(input.threadId);
  if (switched._tag === "Failure" || now !== LIVE_INSTANCE)
    return {
      state: "incomplete",
      detail: `The thread is still on ${now ?? "no provider"}; the twin's mirror thread was left alone.`,
      undoFile: null,
    } satisfies RetireResult;

  const undoFile = ports.writeUndo(
    JSON.stringify({ archived: [input.twinThreadId], mainThread: input.threadId }),
  );
  if (undoFile === null)
    return {
      state: "incomplete",
      detail: "The thread is back on its live session, but the undo list could not be written, so the twin was not archived.",
      undoFile: null,
    } satisfies RetireResult;
  const archived = yield* ports.archive(input.twinThreadId);
  if (!archived)
    return {
      state: "incomplete",
      detail: "The thread is back on its live session; the twin's mirror thread could not be archived.",
      undoFile,
    } satisfies RetireResult;
  const removed = yield* ports.remove(input.twinThreadId);
  return {
    state: "retired",
    detail: removed
      ? "Back on its live session. The twin's session is released and its mirror thread is archived and deleted."
      : "Back on its live session. The twin's mirror thread is archived (delete failed; undo list written).",
    undoFile,
  } satisfies RetireResult;
});
