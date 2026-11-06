import { assert, it } from "@effect/vitest";
import { OrchestratorMcpFailure, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as McpInvocationContext from "../mcp/McpInvocationContext.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import { gateThreadSend } from "./AgentMessageGate.ts";
import { layerMemory as SqlitePersistenceMemory } from "./BatonDatabase.ts";
import { BatonRecordService, layer as recordLayer } from "./BatonRecordService.ts";

const TARGET = ThreadId.make("thread:target");
const shell = (linkSession?: string) =>
  ({
    id: TARGET,
    title: "Fix the checkout",
    projectId: "project:shop",
    deletedAt: null,
    ...(linkSession === undefined ? {} : { linkOrigin: { sessionId: linkSession, label: "x" } }),
  }) as never;

/** A call from another environment's link, with `access`, to a thread that link did or did not start. */
const fromLink = (
  access: "full-access" | "auto",
  targetStartedByLink = false,
  label = "Ann's laptop",
) =>
  Effect.provide(
    Layer.mergeAll(
      Layer.succeed(McpInvocationContext.McpInvocationContext, {
        thread: undefined,
        client: { sessionId: "link-1", label, access, linked: true },
      } as never),
      Layer.succeed(ThreadManagement.ThreadManagementService, {
        getThreadShell: () => Effect.succeed(shell(targetStartedByLink ? "link-1" : undefined)),
      } as never),
    ),
  );

const layer = it.layer(recordLayer.pipe(Layer.provideMerge(SqlitePersistenceMemory)));

layer("the agent-message gate", (it) => {
  it.effect(
    "records a send and a refusal; a lower link reaches only its own threads, by name",
    () =>
      Effect.gen(function* () {
        const record = yield* BatonRecordService;
        let sent = 0;
        const send = Effect.sync(() => (sent += 1));
        yield* gateThreadSend({ threadId: TARGET }, send).pipe(fromLink("full-access"));
        yield* gateThreadSend({ threadId: TARGET }, send).pipe(fromLink("auto", true));
        const refused = yield* gateThreadSend({ threadId: TARGET }, send).pipe(
          fromLink("auto"),
          Effect.flip,
        );
        assert.strictEqual(sent, 2);
        assert.include((refused as OrchestratorMcpFailure).message, "Ann's laptop");
        assert.include((refused as OrchestratorMcpFailure).message, "full access");
        const rows = yield* record.query({ kind: "agent_message" });
        assert.deepStrictEqual(
          rows.map((r) => [r.actor, r.outcome, r.ref]),
          [
            ["link:Ann's laptop", "refused", TARGET],
            ["link:Ann's laptop", "sent", TARGET],
            ["link:Ann's laptop", "sent", TARGET],
          ],
        );
      }),
  );

  it.effect("records a refusal from further in, and stops a sender at 30 sends a minute", () =>
    Effect.gen(function* () {
      const record = yield* BatonRecordService;
      const fenced = new OrchestratorMcpFailure({ code: "capability_denied", message: "fence" });
      yield* gateThreadSend({ threadId: TARGET }, Effect.fail(fenced)).pipe(
        fromLink("full-access", false, "Server"),
        Effect.flip,
      );
      assert.strictEqual((yield* record.query({ kind: "agent_message" }))[0]?.detail, "fence");
      for (let i = 0; i < 30; i += 1)
        yield* gateThreadSend({ threadId: TARGET }, Effect.void).pipe(
          fromLink("full-access", false, "Server"),
        );
      const limited = yield* gateThreadSend({ threadId: TARGET }, Effect.void).pipe(
        fromLink("full-access", false, "Server"),
        Effect.flip,
      );
      assert.include((limited as OrchestratorMcpFailure).message, "30 messages in the last minute");
    }),
  );
});
