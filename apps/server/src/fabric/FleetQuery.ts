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
import { type FabricFleet, type FabricFleetAdopted } from "@t3tools/contracts";
import {
  buildFabricFleet,
  filterFleetNeedsUser,
  type FleetThreadInput,
} from "@t3tools/shared/fabricFleet";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

import * as ProjectionSnapshotQuery from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as ProviderRegistry from "../provider/Services/ProviderRegistry.ts";
import { AdoptedSessionService } from "./AdoptedSessionService.ts";
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
  const adoptedSessions = yield* AdoptedSessionService;

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

  // §9's adopted sessions: terminals Fabric did not start. They belong in the
  // fleet for the same reason a thread does — the user asked "what is
  // everything doing" — and the entry's state takes them into account, so a
  // blocked Herdr pane makes the *work* say it needs you.
  const adoptedRows = yield* adoptedSessions
    .list({})
    .pipe(Effect.catchCause(() => Effect.succeed([])));
  const adopted = new Map<string, FabricFleetAdopted[]>();
  for (const session of adoptedRows) {
    if (session.workSessionId === null) continue;
    const existing = adopted.get(session.workSessionId);
    const row: FabricFleetAdopted = {
      id: session.id,
      runtime: session.runtime,
      label: session.label,
      state: session.state,
      canSendInput: session.capabilities.sendInput,
    };
    if (existing === undefined) adopted.set(session.workSessionId, [row]);
    else existing.push(row);
  }

  const fleet = buildFabricFleet({
    workSessions: sessions,
    threads,
    // The environment answering the question is by definition reachable.
    environmentOnline: true,
    exhaustedProviderInstanceIds: exhausted,
    lastVisitedAt: () => null,
    adopted,
    observedAt: DateTime.formatIso(yield* DateTime.now),
  });

  const result: FabricFleet = input.needsUserOnly === true ? filterFleetNeedsUser(fleet) : fleet;
  return result;
});
