import {
  BATON_JOB_WS_METHODS,
  BATON_MEMORY_WS_METHODS,
  BATON_ORCHESTRATION_WS_METHODS,
  BATON_RECORD_WS_METHODS,
  BATON_SESSIONS_WS_METHODS,
  BATON_WATCH_WS_METHODS,
} from "@t3tools/baton-contracts";
import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as BatonRpcHandlers from "../../../baton/BatonRpcHandlers.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { readCaller } from "../../threadAccess.ts";
import { TessayaToolkit } from "./tools.ts";

const failed = (cause: unknown) =>
  new OrchestratorMcpFailure({
    code: "orchestration_error",
    message:
      typeof cause === "object" && cause !== null && "reason" in cause
        ? String(cause.reason)
        : "Tessaya could not answer that.",
  });

export const layer = McpToolAccess.toLayer(
  TessayaToolkit,
  Effect.gen(function* () {
    const handlers = yield* BatonRpcHandlers.makeHandlers;
    // The same handlers as the clients' RPC, behind T3's read check for this credential.
    const call = <A, E>(effect: Effect.Effect<A, E>) =>
      readCaller().pipe(
        Effect.filterOrFail(
          ({ scope }) => scope.client !== undefined,
          () =>
            new OrchestratorMcpFailure({
              code: "capability_denied",
              message: "Tessaya's tools are for agents signed in from outside T3 Code.",
            }),
        ),
        Effect.andThen(effect.pipe(Effect.mapError(failed))),
      );
    return {
      tessaya_jobs: McpToolAccess.reads(() => call(handlers[BATON_JOB_WS_METHODS.jobList]())),
      tessaya_watch: McpToolAccess.reads(() => call(handlers[BATON_WATCH_WS_METHODS.watchGet]())),
      tessaya_record: McpToolAccess.reads((input) =>
        call(handlers[BATON_RECORD_WS_METHODS.list](input)),
      ),
      // Read as a client (MemoryViewer's default here): walls hold and no persona can be named.
      tessaya_memory_search: McpToolAccess.reads((input) =>
        call(
          handlers[BATON_MEMORY_WS_METHODS.search]({ text: input.text, limit: input.limit ?? 10 }),
        ),
      ),
      tessaya_rules: McpToolAccess.reads((input) =>
        call(handlers[BATON_ORCHESTRATION_WS_METHODS.ruleList](input)),
      ),
      tessaya_sessions: McpToolAccess.reads((input) =>
        call(handlers[BATON_SESSIONS_WS_METHODS.list](input)),
      ),
    };
  }),
);
