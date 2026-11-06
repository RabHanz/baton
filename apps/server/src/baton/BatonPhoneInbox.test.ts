import { ASK_LEASE_MS, ASK_TTL_MS, CONNECTED_MS } from "@t3tools/baton-shared/phoneRelay";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";

import { layerMemory as SqlitePersistenceMemory } from "./BatonDatabase.ts";
import { BatonPhoneInbox, layer as inboxLayer, phoneCall } from "./BatonPhoneInbox.ts";

const layer = it.layer(inboxLayer.pipe(Layer.provideMerge(SqlitePersistenceMemory)));

layer("BatonPhoneInbox", (it) => {
  it.effect("queues in order, marks the source, and a repeat of the same client id asks once", () =>
    Effect.gen(function* () {
      const inbox = yield* BatonPhoneInbox;
      const first = yield* inbox.post({ id: "client-aaaa-0001", text: "  what needs me " });
      assert.isTrue(first.ok);
      if (!first.ok) return;
      assert.strictEqual(first.ask.source, "phone");
      assert.strictEqual(first.ask.text, "what needs me");
      assert.isTrue((yield* inbox.post({ id: "client-aaaa-0001", text: "something else" })).ok);
      assert.strictEqual((yield* inbox.get("client-aaaa-0001"))?.text, "what needs me");
      yield* inbox.post({ id: "client-aaaa-0002", text: "second" });
      assert.strictEqual((yield* inbox.take)?.id, "client-aaaa-0001");
      assert.strictEqual((yield* inbox.take)?.id, "client-aaaa-0002");
      assert.isNull(yield* inbox.take);
    }),
  );

  it.effect("the web intent bar leaves words for the lead and reads where they stand", () =>
    Effect.gen(function* () {
      const inbox = yield* BatonPhoneInbox;
      const made = yield* phoneCall({
        op: "ask",
        args: { id: "web-dddd-0001", text: "plan my week" },
      });
      // The line depends on whether the desktop took anything lately; the layer is shared across cases.
      assert.include(made.value, { ok: true, status: "queued" });
      assert.strictEqual((yield* inbox.take)?.text, "plan my week");
      yield* inbox.answer("web-dddd-0001", "Done.", "Three things this week.");
      assert.deepEqual((yield* phoneCall({ op: "askGet", args: { id: "web-dddd-0001" } })).value, {
        status: "answered",
        line: "Three things this week.",
      });
      assert.deepEqual(
        (yield* phoneCall({ op: "ask", args: { id: "web-dddd-0002", text: " " } })).value,
        { ok: false, line: "Say something." },
      );
    }),
  );

  it.effect("refuses an empty, huge or id-less ask in words", () =>
    Effect.gen(function* () {
      const inbox = yield* BatonPhoneInbox;
      assert.deepEqual(yield* inbox.post({ id: "client-bbbb-0001", text: "   " }), {
        ok: false,
        why: "Say something.",
      });
      assert.isFalse((yield* inbox.post({ id: "client-bbbb-0001", text: "x".repeat(2001) })).ok);
      assert.isFalse((yield* inbox.post({ id: "bad id!", text: "hello" })).ok);
    }),
  );

  it.effect("answers only what was taken, once, and the phone reads the answer", () =>
    Effect.gen(function* () {
      const inbox = yield* BatonPhoneInbox;
      yield* inbox.post({ id: "client-cccc-0001", text: "stop the job" });
      assert.isFalse(yield* inbox.answer("client-cccc-0001", "Stopped.", "Stopped the job."));
      yield* inbox.take;
      assert.isTrue(yield* inbox.answer("client-cccc-0001", "Stopped.", "Stopped the job."));
      assert.isFalse(yield* inbox.answer("client-cccc-0001", "again", "again"));
      const got = yield* inbox.get("client-cccc-0001");
      assert.strictEqual(got?.status, "answered");
      assert.strictEqual(got?.card, "Stopped the job.");
    }),
  );

  it.effect(
    "an ask waits while the desktop is away, then expires; a taken one comes back after its lease",
    () =>
      Effect.gen(function* () {
        const inbox = yield* BatonPhoneInbox;
        // Earlier tests in this file took asks at clock zero.
        yield* TestClock.adjust(CONNECTED_MS + 1);
        assert.isFalse(yield* inbox.connected);
        yield* inbox.post({ id: "client-dddd-0001", text: "wait for me" });
        yield* TestClock.adjust(ASK_TTL_MS - 1000);
        assert.strictEqual((yield* inbox.get("client-dddd-0001"))?.status, "queued");
        yield* TestClock.adjust(2000);
        assert.strictEqual((yield* inbox.get("client-dddd-0001"))?.status, "expired");
        assert.isNull(yield* inbox.take);

        yield* inbox.post({ id: "client-dddd-0002", text: "lease" });
        assert.strictEqual((yield* inbox.take)?.id, "client-dddd-0002");
        assert.isTrue(yield* inbox.connected);
        yield* TestClock.adjust(CONNECTED_MS + 1);
        assert.isFalse(yield* inbox.connected);
        yield* TestClock.adjust(ASK_LEASE_MS);
        assert.strictEqual((yield* inbox.get("client-dddd-0002"))?.status, "queued");
      }),
  );

  it.effect(
    "a question the desktop mirrors can be answered once from the phone, and the desktop sees it",
    () =>
      Effect.gen(function* () {
        const inbox = yield* BatonPhoneInbox;
        yield* inbox.mirror({
          id: "prompt-1",
          title: "Run it?",
          detail: "Click Save in Notes",
          buttons: ["Go ahead", "Not now"],
          yes: 0,
          cancel: 1,
        });
        const [shown] = yield* inbox.pending;
        assert.strictEqual(shown?.detail, "Click Save in Notes");
        assert.isNull(yield* inbox.promptAnswer("prompt-1"));
        assert.isFalse(yield* inbox.answerPrompt("prompt-1", 5));
        assert.isTrue(yield* inbox.answerPrompt("prompt-1", 0));
        assert.isFalse(yield* inbox.answerPrompt("prompt-1", 1));
        assert.strictEqual(yield* inbox.promptAnswer("prompt-1"), 0);
        assert.lengthOf(yield* inbox.pending, 0);
      }),
  );

  it.effect("a mirrored question nobody answers is dropped", () =>
    Effect.gen(function* () {
      const inbox = yield* BatonPhoneInbox;
      yield* inbox.mirror({
        id: "prompt-2",
        title: "t",
        detail: "d",
        buttons: ["a", "b"],
        yes: 0,
        cancel: 1,
      });
      yield* TestClock.adjust(121_000);
      assert.lengthOf(yield* inbox.pending, 0);
      assert.isFalse(yield* inbox.answerPrompt("prompt-2", 0));
      // An answered question is kept for its reader, then deleted: the table does not grow forever.
      yield* inbox.mirror({
        id: "prompt-3",
        title: "t",
        detail: "d",
        buttons: ["a"],
        yes: 0,
        cancel: 0,
      });
      assert.isTrue(yield* inbox.answerPrompt("prompt-3", 0));
      assert.strictEqual(yield* inbox.promptAnswer("prompt-3"), 0);
      yield* TestClock.adjust(241_000);
      yield* inbox.pending;
      assert.isNull(yield* inbox.promptAnswer("prompt-3"));
    }),
  );

  it.effect(
    "keeps up to eight answers for the cloud card and answers the last one by its index",
    () =>
      Effect.gen(function* () {
        const inbox = yield* BatonPhoneInbox;
        const buttons = ["A", "B", "C", "D", "E", "F", "Deny", "Decide later"];
        yield* inbox.mirror({
          id: "prompt-8",
          title: "Cloud task waiting",
          detail: "d",
          buttons,
          yes: 0,
          cancel: 7,
        });
        const [shown] = yield* inbox.pending;
        assert.deepStrictEqual(shown?.buttons, buttons);
        assert.isTrue(yield* inbox.answerPrompt("prompt-8", 7));
        assert.strictEqual(yield* inbox.promptAnswer("prompt-8"), 7);
      }),
  );
});
