import type { BatonJob, WatchFinding } from "@t3tools/baton-contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  describeNeeds,
  dueInTitle,
  needsFromDeadlines,
  needsFromFindings,
  needsFromJobs,
  needsFromLedger,
  isNeedsMeAsk,
  rankNeeds,
  spokenNeeds,
} from "./needsMe.ts";

const now = Date.parse("2026-11-02T12:00:00Z");

describe("what needs me", () => {
  it("ranks a failure above a stale finish, and lists a session once across sources", () => {
    const findings = [
      { workSessionId: "a", title: "Build", kind: "failed", minutes: 20 },
      { workSessionId: "b", title: "Study", kind: "unseen", minutes: 80 },
    ] as unknown as ReadonlyArray<WatchFinding>;
    const job = {
      workSessionId: "b",
      title: "Study",
      group: "done",
      state: "done_unseen",
      phase: "done",
      limitReached: null,
      lastActivityAt: "2026-11-02T10:40:00Z",
    } as unknown as BatonJob;
    const ranked = rankNeeds([...needsFromFindings(findings), ...needsFromJobs([job], now)], now);
    expect(ranked.map((n) => n.id)).toEqual(["ws:a", "ws:b"]);
    expect(ranked[1]?.why).toContain("nobody has looked");
  });

  it("does not flag a finished job that is fresh", () => {
    const job = {
      workSessionId: "b",
      title: "S",
      group: "done",
      state: "done_unseen",
      phase: "done",
      limitReached: null,
      lastActivityAt: "2026-11-02T11:50:00Z",
    } as unknown as BatonJob;
    expect(needsFromJobs([job], now)).toEqual([]);
  });

  it("reads the ledger's labels and a due date in a title, and ignores other rows", () => {
    const items = needsFromLedger([
      {
        repo: "o/r",
        number: 4,
        title: "[ledger] CLIPPING · setup due 2026-11-04",
        labels: ["ledger:money-blocker"],
        updatedAt: "",
      },
      { repo: "o/r", number: 5, title: "x", labels: ["ledger:directive"], updatedAt: "" },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]?.title).toBe("CLIPPING · setup due 2026-11-04");
    expect(dueInTitle("a due 2026-11-04")).toBe(Date.parse("2026-11-04T23:59:59Z"));
  });

  it("raises a near deadline and skips a far or dateless one", () => {
    const items = needsFromDeadlines(
      [
        { id: "a", what: "Tax code", due: "2026-11-15" },
        { id: "b", what: "Far", due: "2027-05-01" },
        { id: "c", what: "No date" },
      ],
      now,
    );
    expect(items.map((i) => i.id)).toEqual(["deadline:a"]);
  });

  it("hides what he put off, and says what it could not read", () => {
    const ranked = rankNeeds(
      needsFromDeadlines([{ id: "a", what: "Tax", due: "2026-11-03" }], now),
      now,
      new Set(["deadline:a"]),
    );
    expect(describeNeeds(ranked, ["the ledger"])).toBe(
      "Nothing needs you in the sources I can read.\nI could not read: the ledger.",
    );
  });

  it("speaks the top three and points at the card for the rest", () => {
    const items = [1, 2, 3, 4].map((n) => ({
      id: `i${n}`,
      source: "session" as const,
      title: `T${n}`,
      why: `failed (${n} min). Last: ran tests`,
      weight: 90 - n,
    }));
    expect(spokenNeeds(items)).toBe(
      "4 things need you. First, T1: failed (1 min). Second, T2: failed (2 min). Third, T3: failed (3 min). And 1 more on the card.",
    );
    expect(spokenNeeds([], ["the ledger"])).toBe(
      "Nothing needs you in what I can read. I could not read the ledger.",
    );
  });

  it("hears the ways of asking, and not a sentence that only mentions it", () => {
    for (const ok of [
      "What needs me?",
      "ok so what needs me today",
      "does anything need my attention",
      "what should I do next",
      "what's waiting for me",
    ]) {
      expect(isNeedsMeAsk(ok), ok).toBe(true);
    }
    for (const no of [
      "write what needs me into the readme",
      "what needs me to fix the build in the readme file please",
    ]) {
      expect(isNeedsMeAsk(no), no).toBe(false);
    }
  });
});
