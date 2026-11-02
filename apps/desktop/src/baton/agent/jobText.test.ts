import type { BatonJob } from "@t3tools/baton-contracts";
import { describe, expect, it } from "vite-plus/test";

import { describeJobs } from "./jobText.ts";

const job = (over: Record<string, unknown>) =>
  ({
    workSessionId: "j1",
    title: "Rebuild the site",
    group: "running",
    phase: "approved",
    limitReached: null,
    permissionsSummary: "read and edit ~/site",
    ...over,
  }) as unknown as BatonJob;

describe("describeJobs", () => {
  it("says where each job is, with its id, and says so when there are none", () => {
    expect(describeJobs([])).toBe("There are no jobs.");
    const text = describeJobs([
      job({ phase: "awaiting_agreement", group: "needs_you" }),
      job({ workSessionId: "j2", title: "Audit", limitReached: "turns" }),
    ]);
    expect(text).toContain("Rebuild the site [id: j1]: plan ready, waiting for his OK.");
    expect(text).toContain("Audit [id: j2]: running, turns limit reached.");
  });
});
