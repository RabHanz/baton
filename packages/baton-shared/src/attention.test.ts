import type { BatonJob, WatchFinding } from "@t3tools/baton-contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import { freshFindings, inQuietHours, morningBrief, noticeLine } from "./attention.ts";

const f = (id: string, kind: WatchFinding["kind"]) =>
  ({ workSessionId: id, title: `Work ${id}`, kind, minutes: 40 }) as unknown as WatchFinding;

describe("unprompted notices", () => {
  it("wraps quiet hours over midnight, and none is never quiet", () => {
    expect(inQuietHours("22-8", 23)).toBe(true);
    expect(inQuietHours("22-8", 7)).toBe(true);
    expect(inQuietHours("22-8", 8)).toBe(false);
    expect(inQuietHours("0-9", 3)).toBe(true);
    expect(inQuietHours("none", 3)).toBe(false);
  });
  it("announces a finding once, again after it clears, and leaves 'unseen' for the morning", () => {
    const a = freshFindings([f("1", "failed"), f("2", "unseen")], new Set());
    expect(a.fresh.map((x) => x.workSessionId)).toEqual(["1"]);
    expect(freshFindings([f("1", "failed")], a.next).fresh).toEqual([]);
    expect(freshFindings([], a.next).next.size).toBe(0);
    expect(freshFindings([f("1", "failed")], new Set()).fresh).toHaveLength(1);
  });
  it("says one line however many there are", () => {
    expect(noticeLine([])).toBeNull();
    expect(noticeLine([f("1", "failed")])).toBe("Work 1 failed.");
    expect(noticeLine([f("1", "unanswered"), f("2", "failed"), f("3", "failed")])).toBe(
      "Work 1 is waiting for you, and 2 more need a look.",
    );
  });
});

describe("the morning brief", () => {
  const NOW = Date.parse("2026-11-03T08:00:00.000Z");
  const job = (title: string, group: string, hoursAgo: number) =>
    ({
      title,
      group,
      lastActivityAt: DateTime.formatIso(DateTime.makeUnsafe(NOW - hoursAgo * 3_600_000)),
    }) as unknown as BatonJob;
  it("reports the last day only, and says so when nothing happened", () => {
    const text = morningBrief({
      jobs: [
        job("Site", "done", 5),
        job("Old", "done", 80),
        job("Audit", "running", 30),
        job("Tax", "needs_you", 2),
      ],
      findings: [f("9", "failed")],
      now: NOW,
    });
    expect(text).toBe(
      "Good morning. Finished: Site. Failed: Work 9. Waiting for you: Tax. Still running: Audit.",
    );
    expect(morningBrief({ jobs: [], findings: [], now: NOW })).toContain("Nothing happened");
  });
});
