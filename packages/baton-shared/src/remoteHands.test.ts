import { describe, expect, it } from "vite-plus/test";

import {
  auditWhat,
  createHandleRegistry,
  createHandsBroker,
  HOST_LISTENING_MS,
} from "./remoteHands.ts";

const make = () => {
  let t = 0;
  let n = 0;
  const log: string[] = [];
  const broker = createHandsBroker({
    now: () => t,
    newId: () => `c${(n += 1)}`,
    callTimeoutMs: 1_000,
    onAudit: (e) => log.push(`${e.tool}:${e.outcome}`),
  });
  return { broker, log, advance: (ms: number) => void (t += ms) };
};

describe("remote hands broker", () => {
  it("passes a call to a waiting desktop at once and returns its answer", async () => {
    const { broker, log } = make();
    const taking = broker.take(50);
    const answer = broker.call("s1", "ui_tree", {});
    const call = (await taking)!;
    expect(call).toMatchObject({ tool: "ui_tree", session: "s1" });
    expect(broker.reply(call.id, { ok: true, text: "Notepad" })).toBe(true);
    expect(await answer).toEqual({ ok: true, text: "Notepad" });
    expect(log).toEqual(["ui_tree:done"]);
  });

  it("queues a call made before the desktop asks, and says so when nobody is listening", async () => {
    const { broker, advance } = make();
    expect((await broker.call("s", "ui_tree", {})).error).toContain("not listening");
    await broker.take(1);
    const queued = broker.call("s", "wait_for", { label: "OK", seconds: 1 });
    advance(HOST_LISTENING_MS - 1);
    const call = (await broker.take(1))!;
    expect(call.tool).toBe("wait_for");
    broker.reply(call.id, { ok: false, error: "no" });
    expect((await queued).ok).toBe(false);
  });

  it("refuses a tool that is not a remote hands tool, an oversized call, and a reply to nothing", async () => {
    const { broker, log } = make();
    void broker.take(1);
    expect((await broker.call("s", "click", { x: 1, y: 2 })).error).toContain(
      "not a remote hands tool",
    );
    expect((await broker.call("s", "type_text", { text: "x".repeat(30_000) })).error).toContain(
      "too large",
    );
    expect(broker.reply("nope", { ok: true })).toBe(false);
    expect(log).toEqual(["click:refused", "type_text:refused"]);
  });

  it("keeps typed text out of the audit and stops only handles it issued", () => {
    expect(auditWhat("type_text", { text: "my password", why: "w" })).toBe(
      'type_text text(11 chars) why="w"',
    );
    const ids = createHandleRegistry<number>(() => "h1");
    const id = ids.add(4242);
    expect(ids.get(id)).toBe(4242);
    expect(ids.get("h2")).toBeUndefined();
  });
});
