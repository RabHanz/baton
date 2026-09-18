/**
 * Adopting a session Fabric did not start (§9).
 *
 * The service is thin on purpose. Everything interesting is a refusal:
 *
 *   - a runtime state Fabric cannot map is refused by name, rather than
 *     becoming `idle` and sorting a blocked terminal to the bottom of the
 *     fleet;
 *   - a capability the runtime did not claim is refused by name, before the
 *     action is attempted rather than after it fails;
 *   - the runtime itself, when it is not installed, is refused by name by the
 *     adapter this service calls.
 *
 * Nothing here runs a provider. An adopted session belongs to whatever started
 * it, which is the point: §9's rule is that Fabric adapts to sessions outside
 * its ownership rather than taking them over.
 */
import {
  AdoptedCapabilityRefusedError,
  AdoptedSessionNotFoundError,
  AdoptedStateUnknownError,
  AdoptedStorageError,
  type AdoptedDiscoverResult,
  type AdoptedListInput,
  type AdoptedRefreshInput,
  type AdoptedRegisterInput,
  type AdoptedSendInputInput,
  type AdoptedSendInputResult,
  type AdoptedSession,
  type AdoptedSessionError,
  type AdoptedSessionId,
  type WorkSessionId,
} from "@t3tools/contracts";
import {
  ADOPTED_MINIMUM_CAPABILITIES,
  mapHerdrState,
  refuseCapability,
} from "@t3tools/shared/fabricAdoptedSession";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { ProjectionRepositoryError } from "../persistence/Errors.ts";
import {
  AdoptedSessionRepository,
  layer as adoptedSessionRepositoryLayer,
  type AdoptedSessionRow,
} from "./AdoptedSessionRepository.ts";

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

/**
 * What an external runtime must be able to do for Fabric to adopt anything
 * from it.
 *
 * A port rather than an import: Herdr is AGPL and lives in its own process, and
 * this repository ships none of it. The live implementation shells out to the
 * runtime's own control surface, and the one on a machine without it refuses by
 * name.
 */
export class AdoptedRuntimeAdapter extends Context.Service<
  AdoptedRuntimeAdapter,
  {
    readonly discover: Effect.Effect<AdoptedDiscoverResult>;
    /** Type into a pane. False with a reason is a normal answer. */
    readonly sendInput: (input: {
      readonly session: AdoptedSession;
      readonly text: string;
      readonly submit: boolean;
    }) => Effect.Effect<AdoptedSendInputResult>;
  }
>()("t3/fabric/AdoptedSessionService/AdoptedRuntimeAdapter") {}

export class AdoptedSessionService extends Context.Service<
  AdoptedSessionService,
  {
    readonly discover: Effect.Effect<AdoptedDiscoverResult>;
    readonly register: (
      input: AdoptedRegisterInput,
    ) => Effect.Effect<AdoptedSession, AdoptedSessionError>;
    readonly refresh: (
      input: AdoptedRefreshInput,
    ) => Effect.Effect<AdoptedSession, AdoptedSessionError>;
    readonly list: (
      input: AdoptedListInput,
    ) => Effect.Effect<ReadonlyArray<AdoptedSession>, AdoptedSessionError>;
    readonly detach: (id: AdoptedSessionId) => Effect.Effect<AdoptedSession, AdoptedSessionError>;
    readonly sendInput: (
      input: AdoptedSendInputInput,
    ) => Effect.Effect<AdoptedSendInputResult, AdoptedSessionError>;
    /** Live adopted sessions for one work session; the fleet's question. */
    readonly forWorkSession: (
      workSessionId: WorkSessionId,
    ) => Effect.Effect<ReadonlyArray<AdoptedSession>, AdoptedSessionError>;
  }
>()("t3/fabric/AdoptedSessionService") {}

const toSession = (row: AdoptedSessionRow): AdoptedSession => ({
  id: row.id,
  runtime: row.runtime,
  workSessionId: row.workSessionId,
  label: row.label,
  location: { workspace: row.workspace, pane: row.pane, host: row.host },
  agentKind: row.agentKind,
  state: row.state,
  capabilities: row.capabilities,
  observedAt: row.observedAt,
  createdAt: row.createdAt,
  detachedAt: row.detachedAt,
});

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const repository = yield* AdoptedSessionRepository;
  const adapter = yield* AdoptedRuntimeAdapter;

  const storageFailure = (operation: string) => (cause: ProjectionRepositoryError) =>
    new AdoptedStorageError({ operation, detail: String(cause) });

  const require_ = (id: AdoptedSessionId) =>
    repository.get(id).pipe(
      Effect.mapError(storageFailure("read")),
      Effect.flatMap((row) =>
        row === null ? Effect.fail(new AdoptedSessionNotFoundError({ id })) : Effect.succeed(row),
      ),
    );

  /** §9's mapping, with the refusal the contract promises. */
  const mapState = (runtime: AdoptedSession["runtime"], runtimeState: string) => {
    const state = mapHerdrState(runtimeState);
    return state === null
      ? Effect.fail(new AdoptedStateUnknownError({ runtime, runtimeState }))
      : Effect.succeed(state);
  };

  const register: AdoptedSessionService["Service"]["register"] = (input) =>
    Effect.gen(function* () {
      const state = yield* mapState(input.runtime, input.runtimeState);
      const timestamp = yield* nowIso;
      const row: AdoptedSessionRow = {
        id: input.id,
        runtime: input.runtime,
        workSessionId: input.workSessionId ?? null,
        label: input.label,
        workspace: input.location.workspace,
        pane: input.location.pane,
        host: input.location.host,
        agentKind: input.agentKind ?? null,
        state,
        // A runtime that claims nothing gets the least. Fabric never assumes a
        // capability on a session it did not start.
        capabilities: input.capabilities ?? ADOPTED_MINIMUM_CAPABILITIES,
        observedAt: timestamp,
        createdAt: timestamp,
        detachedAt: null,
      };
      const inserted = yield* repository
        .insert(row)
        .pipe(Effect.mapError(storageFailure("register")));
      // Registering twice with one id is a retry, not a second terminal.
      return toSession(inserted ?? (yield* require_(input.id)));
    });

  const refresh: AdoptedSessionService["Service"]["refresh"] = (input) =>
    Effect.gen(function* () {
      const current = yield* require_(input.id);
      const state = yield* mapState(current.runtime, input.runtimeState);
      const observedAt = yield* nowIso;
      const next: AdoptedSessionRow = { ...current, state, observedAt };
      yield* repository.update(next).pipe(Effect.mapError(storageFailure("refresh")));
      return toSession(next);
    });

  const list: AdoptedSessionService["Service"]["list"] = (input) =>
    repository
      .list({
        workSessionId: input.workSessionId ?? null,
        includeDetached: input.includeDetached ?? false,
      })
      .pipe(
        Effect.mapError(storageFailure("list")),
        Effect.map((rows) => rows.map(toSession)),
      );

  const detach: AdoptedSessionService["Service"]["detach"] = (id) =>
    Effect.gen(function* () {
      const current = yield* require_(id);
      // Releasing an adopted session does not stop it. It was somebody else's
      // terminal before Fabric knew about it and it still is.
      const detachedAt = current.detachedAt ?? (yield* nowIso);
      const next: AdoptedSessionRow = { ...current, detachedAt };
      yield* repository.update(next).pipe(Effect.mapError(storageFailure("detach")));
      return toSession(next);
    });

  const sendInput: AdoptedSessionService["Service"]["sendInput"] = (input) =>
    Effect.gen(function* () {
      const session = toSession(yield* require_(input.id));
      const refusal = refuseCapability({
        capabilities: session.capabilities,
        capability: "sendInput",
      });
      if (refusal !== null) {
        return yield* new AdoptedCapabilityRefusedError({
          id: input.id,
          capability: "sendInput",
          reason: refusal,
        });
      }
      if (session.detachedAt !== null) {
        return yield* new AdoptedCapabilityRefusedError({
          id: input.id,
          capability: "sendInput",
          reason: "this session was released; adopt it again to type into it.",
        });
      }
      return yield* adapter.sendInput({
        session,
        text: input.text,
        submit: input.submit ?? false,
      });
    });

  const forWorkSession: AdoptedSessionService["Service"]["forWorkSession"] = (workSessionId) =>
    list({ workSessionId });

  return {
    discover: adapter.discover,
    register,
    refresh,
    list,
    detach,
    sendInput,
    forWorkSession,
  } satisfies AdoptedSessionService["Service"];
});

export const layer = Layer.effect(AdoptedSessionService, make).pipe(
  Layer.provideMerge(adoptedSessionRepositoryLayer),
);
