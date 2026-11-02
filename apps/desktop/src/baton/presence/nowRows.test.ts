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
    expect(nowAction("now.allow:ws:a")).toEqual({ kind: "allow", topic: "ws:a" });
    expect(nowAction("now.c:ab12:later")).toEqual({ kind: "commitment", id: "ab12", drop: true });
  });
});
