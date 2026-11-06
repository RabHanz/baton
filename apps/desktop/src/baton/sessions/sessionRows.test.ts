import type { BatonSessionSummary } from "@t3tools/baton-contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  describeSession,
  findSession,
  maskAccount,
  orderSessions,
  requestFor,
  sendRefusal,
  sessionControls,
} from "./sessionRows.ts";

const row = (key: string, over: Partial<BatonSessionSummary> = {}): BatonSessionSummary => ({
  key,
  project: "VantageOS",
  session: key,
  account: null,
  state: "idle",
  urgent: false,
  box: "orbit",
  updatedAt: null,
  thread: null,
  pane: null,
  ...over,
});

describe("the sessions list", () => {
  it("puts what needs him first, then what is working, then the newest", () => {
    const ordered = orderSessions([
      row("old", { updatedAt: "2026-11-01T08:00:00Z" }),
      row("new", { updatedAt: "2026-11-01T09:00:00Z" }),
      row("busy", { state: "working" }),
      row("asks", { state: "waiting", urgent: true }),
    ]).map((s) => s.key);
    expect(ordered).toEqual(["asks", "busy", "new", "old"]);
  });
  it("shows five and puts the rest behind Show all", () => {
    const controls = sessionControls(Array.from({ length: 8 }, (_, i) => row(`s${i}`)));
    expect(controls.filter((c) => c.more !== true)).toHaveLength(5);
    expect(controls.filter((c) => c.more === true && c.moreLabel === "Show all")).toHaveLength(3);
  });
  it("masks the account until it is clicked, and offers Send only where a pane exists", () => {
    const [c] = sessionControls([
      row("a", { account: "alex@example.com", pane: { environmentId: "e", pane: "p1" } }),
    ]);
    expect(c).toMatchObject({
      masked: "a•••@example.com",
      revealed: "alex@example.com",
      canSend: true,
      canOpen: false,
    });
    expect(maskAccount("alex")).toBe("a•••");
  });
  it("turns a click into an open and a typed line into a send, and refuses what has no target", () => {
    const rows = [
      row("t", { thread: { environmentId: "e", threadId: "th1" } }),
      row("p", { pane: { environmentId: "e", pane: "p1" } }),
    ];
    expect(requestFor(rows, "n:t", null)).toEqual({
      kind: "open",
      environmentId: "e",
      threadId: "th1",
    });
    expect(requestFor(rows, "n:p", "  hello ")).toEqual({
      kind: "send",
      environmentId: "e",
      pane: "p1",
      text: "hello",
    });
    expect(requestFor(rows, "n:t", "hi")).toBeNull();
    expect(requestFor(rows, "n:p", "   ")).toBeNull();
    expect(requestFor(rows, "n:p", null)).toBeNull();
  });
});

describe("the assistant's session tools", () => {
  it("finds a session by its id or its name, whatever words the message holds", () => {
    const rows = [row("k1", { session: "build: tests" }), row("k2")];
    expect(findSession(rows, "k1")?.key).toBe("k1");
    expect(findSession(rows, "Build: Tests")?.key).toBe("k1");
    expect(findSession(rows, "nope")).toBeNull();
  });
  it("types nothing into a session that waits on him, whatever its pane runs", () => {
    expect(sendRefusal(row("k", { state: "waiting", urgent: true }))).toContain("nothing was sent");
    expect(sendRefusal(row("k", { state: "waiting" }))).toBeNull();
  });
  it("says what a session is doing from its row", () => {
    const now = Date.parse("2026-11-01T10:00:00Z");
    expect(
      describeSession(row("k", { state: "working", updatedAt: "2026-11-01T09:55:00Z" }), now),
    ).toBe("k (VantageOS, on orbit) is working, last active 5 min ago.");
    expect(describeSession(row("k", { state: "waiting", urgent: true }), now)).toContain(
      "a question or an approval",
    );
  });
});
