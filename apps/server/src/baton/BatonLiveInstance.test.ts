import { assert, it } from "@effect/vitest";
import { ProviderThreadId, ThreadId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

import { deliverContextHandoffs } from "../orchestration-v2/ContextHandoffDelivery.ts";
import { takesNoContextHandoff } from "./BatonLiveInstance.ts";
import { supersedeLiveHandoffs } from "./LiveSessionMirror.ts";

const THREAD = ThreadId.make("baton-live4:11111111-2222-4333-8444-555555555555");
const at = DateTime.makeUnsafe(0);
/** A handoff carrying a long history, as a rebind leaves on a live thread. */
const handoff = (id: string, status: "ready" | "superseded") =>
  ({
    id,
    threadId: THREAD,
    targetRunId: "run-363",
    fromProviderThreadIds: [],
    toProviderThreadId: ProviderThreadId.make("pt-live"),
    coveredRunOrdinals: { from: 1, to: 362 },
    strategy: "full_thread_summary",
    status,
    summaryMessageId: null,
    summaryText: "x".repeat(500_000),
    history: {
      messages: Array.from({ length: 360 }, (_, i) => ({
        itemId: `item-${i}`,
        role: "user",
        text: "y".repeat(2_000),
      })),
      coverage: "runs 1-362",
      omittedItems: 0,
    },
    createdByProviderInstanceId: null,
    createdAt: at,
    updatedAt: at,
  }) as never;

it.effect("a live thread's ready handoffs are marked superseded, and others are left alone", () =>
  Effect.gen(function* () {
    const written: Array<{ id: string; status: string }> = [];
    const engine = {
      contextHandoffs: () => Effect.succeed([handoff("h1", "ready"), handoff("h2", "superseded")]),
      writeEvents: (input: {
        events: ReadonlyArray<{ payload: { id: string; status: string } }>;
      }) =>
        Effect.sync(() => {
          for (const event of input.events)
            written.push({ id: event.payload.id, status: event.payload.status });
          return input.events.length;
        }),
    } as never;
    assert.strictEqual(yield* supersedeLiveHandoffs(engine, THREAD), 1);
    assert.deepStrictEqual(written, [{ id: "h1", status: "superseded" }]);
  }),
);

it.effect(
  "a live-bridge turn with a pending handoff and no budget left starts, with nothing injected",
  () =>
    Effect.gen(function* () {
      assert.isTrue(takesNoContextHandoff("baton-live"));
      assert.isFalse(takesNoContextHandoff("claudeAgent"));
      let injected = 0;
      // What ProviderTurnStartService passes for a baton-live run: defer, and no injection.
      const result = yield* deliverContextHandoffs({
        handoffs: [handoff("h1", "ready")],
        providerThread: {
          id: ProviderThreadId.make("pt-live"),
          nativeThreadRef: { nativeId: "11111111-2222-4333-8444-555555555555" },
        } as never,
        budget: 0,
        deferInline: takesNoContextHandoff("baton-live"),
        alreadyDeliveredItemIds: new Set(),
        persist: () =>
          Effect.sync(() => {
            injected += 1;
          }),
      });
      assert.strictEqual(result.context, "");
      assert.strictEqual(injected, 0);
    }),
);
