import { describe, expect, it } from "vite-plus/test";

import {
  addCommitment,
  briefCommitments,
  closeCommitment,
  describeCommitments,
  needsFromCommitments,
  pruneCommitments,
} from "./commitments.ts";

const now = Date.parse("2026-11-02T12:00:00Z");
const HOUR = 3_600_000;

describe("the commitments ledger", () => {
  it("adds, dedupes the same words, and closes", () => {
    let list = addCommitment(
      [],
      { text: " Check back on the  deploy ", due: now + HOUR },
      now,
      "a",
    );
    expect(list[0]?.text).toBe("Check back on the deploy");
    list = addCommitment(list, { text: "check back on the deploy", due: now + 2 * HOUR }, now, "b");
    expect(list).toHaveLength(1);
    expect(list[0]?.due).toBe(now + 2 * HOUR);
    list = closeCommitment(list, "a", "done", now);
    expect(list[0]?.status).toBe("done");
    expect(() => closeCommitment(list, "a", "done", now)).toThrow("No open commitment");
  });

  it("refuses empty, long and undated-nonsense input", () => {
    expect(() => addCommitment([], { text: "  " }, now, "a")).toThrow();
    expect(() => addCommitment([], { text: "x".repeat(301) }, now, "a")).toThrow("too long");
    expect(() => addCommitment([], { text: "x", due: NaN }, now, "a")).toThrow();
  });

  it("raises what is due or near as needs, not what has no date or is far", () => {
    let list = addCommitment([], { text: "due soon", due: now - HOUR }, now, "a");
    list = addCommitment(list, { text: "someday" }, now, "b");
    list = addCommitment(list, { text: "next week", due: now + 7 * 24 * HOUR }, now, "c");
    expect(needsFromCommitments(list, now).map((n) => n.ref)).toEqual(["a"]);
    expect(briefCommitments(list, now)).toBe("Due now: due soon.");
    expect(describeCommitments(list, now)).toContain("overdue by 60 min");
  });

  it("forgets closed ones after a month", () => {
    const list = closeCommitment(addCommitment([], { text: "t" }, now, "a"), "a", "done", now);
    expect(pruneCommitments(list, now + 31 * 24 * HOUR)).toEqual([]);
    expect(pruneCommitments(list, now + HOUR)).toHaveLength(1);
  });
});
