/**
 * The environment's own answer to "what is everything doing?".
 *
 * Reads the same shell snapshot the clients stream, joins it to the work
 * sessions, and derives each state with the shared rules — so the server and a
 * client looking at the same instant agree.
 *
 * One input it cannot supply: `lastVisitedAt`. When *this user* last opened a
 * thread is client state and the environment has never been told. The server
 * therefore passes null, which makes its `done_unseen` mean "a turn completed
 * and nothing has happened since" rather than "you have not seen it". A client
 * building the same fleet locally passes its real value and gets the stricter
 * answer. See `docs/fabric/DECISIONS.md` D17.
 */
import { type FabricFleet } from "@t3tools/contracts";
import {
  buildFabricFleet,
  filterFleetNeedsUser,
  type FleetThreadInput,
} from "@t3tools/shared/fabricFleet";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

import * as ProjectionSnapshotQuery from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as ProviderRegistry from "../provider/Services/ProviderRegistry.ts";
import { WorkSessionService } from "./WorkSessionService.ts";

/** A provider window at 100% is the account saying it is out, not a guess. */
const isExhausted = (usedPercent: number): boolean => usedPercent >= 100;

export const getFleet = Effect.fn("fabric.getFleet")(function* (input: {
  readonly includeArchived?: boolean | undefined;
  readonly needsUserOnly?: boolean | undefined;
}) {
  const workSessions = yield* WorkSessionService;
  const snapshotQuery = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
  const providerRegistry = yield* ProviderRegistry.ProviderRegistry;

  const sessions = yield* workSessions.list(
    input.includeArchived === undefined ? {} : { includeArchived: input.includeArchived },
  );

  const shell = yield* snapshotQuery
    .getShellSnapshot()
    .pipe(Effect.catchCause(() => Effect.succeed(null)));

  const threads = new Map<string, FleetThreadInput>();
  for (const thread of shell?.threads ?? []) {
    threads.set(thread.id, {
      threadId: thread.id,
      title: thread.title,
      branch: thread.branch,
      worktreePath: thread.worktreePath,
      hasPendingApprovals: thread.hasPendingApprovals,
      hasPendingUserInput: thread.hasPendingUserInput,
      sessionStatus: thread.session?.status ?? null,
      sessionLastError: thread.session?.lastError ?? null,
      backgroundLiveness: thread.backgroundLiveness ?? null,
      latestTurnState: thread.latestTurn?.state ?? null,
      latestTurnCompletedAt: thread.latestTurn?.completedAt ?? null,
      updatedAt: thread.updatedAt,
    });
  }

  const providers = yield* providerRegistry.getProviders.pipe(
    Effect.catchCause(() => Effect.succeed([])),
  );
  const exhausted = new Set<string>();
  for (const provider of providers) {
    const windows = provider.usageLimits?.windows ?? [];
    if (windows.some((window) => isExhausted(window.usedPercent))) {
      exhausted.add(provider.instanceId);
    }
  }

  const fleet = buildFabricFleet({
    workSessions: sessions,
    threads,
    // The environment answering the question is by definition reachable.
    environmentOnline: true,
    exhaustedProviderInstanceIds: exhausted,
    lastVisitedAt: () => null,
    observedAt: DateTime.formatIso(yield* DateTime.now),
  });

  const result: FabricFleet = input.needsUserOnly === true ? filterFleetNeedsUser(fleet) : fleet;
  return result;
});
