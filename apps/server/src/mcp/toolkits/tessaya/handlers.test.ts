import { expect, it } from "@effect/vitest";
import { EnvironmentId } from "@t3tools/contracts";
import type { BatonMemoryQuery } from "@t3tools/baton-contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import { BatonMemoryService, MemoryViewer } from "../../../baton/BatonMemoryService.ts";
import { BatonRuntime } from "../../../baton/BatonRpcHandlers.ts";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import * as TessayaHandlers from "./handlers.ts";
import { TessayaToolkit } from "./tools.ts";

it.effect(
  "an outside agent searches memory as a client, so walls hold and it names no persona",
  () =>
    Effect.gen(function* () {
      const asked: Array<[BatonMemoryQuery, string]> = [];
      const memory = BatonMemoryService.of({
        search: (query: BatonMemoryQuery) =>
          Effect.gen(function* () {
            asked.push([query, yield* MemoryViewer]);
            return [];
          }),
      } as never);
      const dependencies = Layer.mergeAll(
        Layer.succeed(McpInvocationContext.McpInvocationContext, {
          environmentId: EnvironmentId.make("environment:tessaya"),
          requestNamespace: "client:tessaya",
          thread: undefined,
          client: { sessionId: "agent-1", label: "Claude Code", access: "read-only" },
          capabilities: new Set(["orchestration" as const]),
          issuedAt: 0,
        }),
        Layer.mock(ThreadManagement.ThreadManagementService)({}),
        Layer.succeed(BatonRuntime, Context.make(BatonMemoryService, memory) as never),
      );
      const result = yield* Effect.gen(function* () {
        const toolkit = yield* TessayaToolkit;
        return yield* toolkit
          .handle("tessaya_memory_search", { text: "deploy key" })
          .pipe(Stream.unwrap, Stream.runCollect);
      }).pipe(
        Effect.provide(
          McpToolAccess.HandlersLayer.layer(TessayaHandlers.layer).pipe(
            Layer.provideMerge(dependencies),
          ),
        ),
      );
      expect(result.at(-1)?.isFailure).toBe(false);
      expect(asked).toEqual([[{ text: "deploy key", limit: 10 }, "client"]]);
    }),
);
