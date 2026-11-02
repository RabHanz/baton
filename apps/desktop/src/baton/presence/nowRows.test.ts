import { describe, expect, it } from "vite-plus/test";

import { tabOf } from "../home/tabs.ts";
import { EMPTY_NOW, nowAction, nowControls } from "./nowRows.ts";

describe("the Now area", () => {
  it("every row lands on the Now tab, and empty sections say so plainly", () => {
    const rows = nowControls({ ...EMPTY_NOW, loaded: true }, 0);
    expect(rows.map((r) => r.id)).toContain("now.empty");
    for (const r of rows) expect(tabOf(r.id)).toBe("now");
  });
  it("lists what needs him with its reason, and a way back from a muted topic", () => {
    const rows = nowControls(
      {
        ...EMPTY_NOW,
        loaded: true,
        needs: [{ id: "x", source: "session", title: "Build", why: "failed (20 min)", weight: 80 }],
        declined: [{ title: "Study", why: "quiet hours" }],
        muted: [{ topic: "ws:a", title: "Nightly" }],
        weaves: [
          {
            id: "w1",
            from: "Tessaya",
            toLabel: "build",
            toPane: "p1",
            text: "rerun the tests",
            status: "queued",
            reason: "it is busy",
            job: null,
            tries: 1,
            createdAt: 0,
            deliveredAt: null,
            repliedAt: null,
            reply: null,
          },
        ],
      },
      0,
    );
    expect(rows.find((r) => r.id === "now.need:0")).toMatchObject({
      status: "bad",
      detail: "failed (20 min)",
    });
    expect(rows.find((r) => r.id === "now.held:0")).toMatchObject({
      detail: "It was your quiet hours.",
    });
    expect(rows.find((r) => r.id === "now.weave:w1")).toMatchObject({
      status: "warn",
      detail: "Waiting: it is busy",
    });
    expect(nowAction("now.allow:ws:a")).toEqual({ kind: "allow", topic: "ws:a" });
    expect(nowAction("now.c:ab12:later")).toEqual({ kind: "commitment", id: "ab12", drop: true });
  });

  it("lists what works and what does not, with the notification policy", () => {
    const rows = nowControls(
      {
        ...EMPTY_NOW,
        loaded: true,
        capabilities: [
          { name: "Answers", state: "off", why: "Needs the internet, which is not available." },
          { name: "Snippets", state: "works", why: "Kept here." },
        ],
      },
      0,
    );
    expect(rows.find((r) => r.id === "now.cap:0")).toMatchObject({ status: "bad" });
    expect(rows.find((r) => r.id === "now.cap:1")).toMatchObject({ status: "ok" });
    expect(rows.find((r) => r.id === "now.cap.summary")).toMatchObject({
      label: "1 of 2 things are unavailable right now; the rest work.",
      detail: "Tessaya never sends push notifications; everything arrives here or is said aloud.",
    });
  });
});
