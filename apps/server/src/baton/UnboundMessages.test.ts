// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { it } from "@effect/vitest";
import { Effect } from "effect";
import { describe, expect } from "vite-plus/test";

import type { BatonEngineShape } from "./BatonEngine.ts";

import {
  appendLedger,
  pendingKept,
  readKept,
  readLedger,
  resendKept,
  sessionOfThread,
  type KeptMessage,
} from "./UnboundMessages.ts";

const entry = (id: string, over: Partial<KeptMessage> = {}): KeptMessage => ({
  id,
  at: "2026-11-04T10:00:00Z",
  cwd: "/work",
  sessionId: "baton-unbound-1-2",
  threadId: null,
  text: id,
  ...over,
});

describe("kept unbound messages", () => {
  it("belong to the thread the ledger stamped, wait until claimed, and come back when released", () => {
    const kept = [entry("a"), entry("b"), entry("c", { threadId: "baton-live4:s" })];
    expect(pendingKept(kept, []).map((e) => e.thread)).toEqual([null, null, "baton-live4:s"]);
    const stamped = [
      { id: "a", threadId: "baton-live4:s" },
      { id: "b", state: "claimed" as const },
    ];
    expect(pendingKept(kept, stamped).map((e) => [e.id, e.thread])).toEqual([
      ["a", "baton-live4:s"],
      ["c", "baton-live4:s"],
    ]);
    // A failed resend releases the claim: the message is waiting again, not lost.
    expect(
      pendingKept(kept, [...stamped, { id: "b", state: "released" as const }]).map((e) => e.id),
    ).toEqual(["a", "b", "c"]);
  });
  it("reads the session id from a live thread id", () => {
    expect(sessionOfThread("baton-live4:abc")).toBe("abc");
    expect(sessionOfThread("other")).toBeNull();
  });
});

describe("resending a kept message", () => {
  const THREAD = "baton-live4:s";
  const setup = (sendOk: boolean, active: boolean) => {
    const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "baton-kept-"));
    NodeFS.writeFileSync(
      NodePath.join(dir, "unbound-messages.ndjson"),
      `${JSON.stringify({ id: "m1", at: "t", text: "one", threadId: THREAD })}\n${JSON.stringify({ id: "m2", at: "t", text: "two", threadId: THREAD })}\n`,
    );
    const sent: string[] = [];
    const engine = {
      threadShell: () => Effect.succeed({ activeRunId: active ? "run" : null }),
      sendMessage: (input: { text: string }) => (sent.push(input.text), Effect.succeed(sendOk)),
    } as unknown as BatonEngineShape;
    const run = () => resendKept(engine, { dir, threadId: THREAD, bound: true });
    return { dir, sent, run };
  };

  it.effect("sends the oldest once, then the next, and never the same twice", () =>
    Effect.gen(function* () {
      const { dir, sent, run } = setup(true, false);
      yield* run();
      yield* run();
      yield* run();
      expect(sent).toEqual(["one", "two"]);
      expect(pendingKept(readKept(dir), readLedger(dir))).toEqual([]);
    }),
  );

  it.effect("keeps a message whose send failed, and waits while a turn is running", () =>
    Effect.gen(function* () {
      const failed = setup(false, false);
      yield* failed.run();
      expect(pendingKept(readKept(failed.dir), readLedger(failed.dir)).map((e) => e.id)).toEqual([
        "m1",
        "m2",
      ]);
      const busy = setup(true, true);
      yield* busy.run();
      expect(busy.sent).toEqual([]);
      appendLedger(busy.dir, { id: "m1", state: "claimed" });
      expect(pendingKept(readKept(busy.dir), readLedger(busy.dir)).map((e) => e.id)).toEqual([
        "m2",
      ]);
    }),
  );
});
