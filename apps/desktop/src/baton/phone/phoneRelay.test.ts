import { describe, expect, it } from "vite-plus/test";

import { createPhoneRelay } from "./phoneRelay.ts";

const make = (over: { take?: unknown; run?: () => Promise<{ spoken: string; card: string }>; poll?: Array<number | null> } = {}) => {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const polls = [...(over.poll ?? [])];
  const relay = createPhoneRelay({
    call: async (op, args) => {
      calls.push([op, args]);
      if (op === "take") return over.take ?? null;
      if (op === "promptPoll") return polls.shift() ?? null;
      return true;
    },
    run: over.run ?? (async () => ({ spoken: "Two jobs.", card: "Two jobs are running." })),
    wait: async () => undefined,
    newId: () => "p1",
  });
  return { relay, calls };
};

describe("the desktop's phone relay", () => {
  it("does nothing when nothing is waiting, and says away when the server does not answer", async () => {
    expect(await make().relay.tick()).toBe("idle");
    const down = createPhoneRelay({ call: async () => Promise.reject(new Error("x")), run: async () => ({ spoken: "", card: "" }) });
    expect(await down.tick()).toBe("away");
  });

  it("runs a taken ask as a typed ask and sends back the reply and the card", async () => {
    const { relay, calls } = make({ take: { id: "c-1", text: "what is running" } });
    expect(await relay.tick()).toBe("answered");
    expect(calls.at(-1)).toEqual(["answer", { id: "c-1", spoken: "Two jobs.", card: "Two jobs are running." }]);
  });

  it("reports a failed turn instead of leaving the ask hanging", async () => {
    const { relay, calls } = make({ take: { id: "c-2", text: "x" }, run: async () => Promise.reject(new Error("boom")) });
    expect(await relay.tick()).toBe("failed");
    expect(calls.at(-1)?.[0]).toBe("fail");
  });

  it("mirrors a question and resolves with the phone's button; closing tells the server", async () => {
    const { relay, calls } = make({ poll: [null, 1] });
    const mirrored = relay.mirror({ title: "Run it?", detail: "Click Save", buttons: ["Go ahead", "Not now"], yes: 0, cancel: 1 });
    expect(await mirrored!.answer).toBe(1);
    expect(calls[0]).toEqual(["prompt", { id: "p1", title: "Run it?", detail: "Click Save", buttons: ["Go ahead", "Not now"], yes: 0, cancel: 1 }]);
    mirrored!.close();
    expect(calls.at(-1)).toEqual(["promptClose", { id: "p1" }]);
  });
});
