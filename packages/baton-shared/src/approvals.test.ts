import type { BatonJob, BatonSessionSummary } from "@t3tools/baton-contracts";
import { describe, expect, it } from "vite-plus/test";

import { buildApprovals, describeApprovals } from "./approvals.ts";

describe("the approvals list", () => {
  it("lists plans waiting for an OK and sessions that asked him, and says so when none do", () => {
    const jobs = [
      {
        workSessionId: "j1",
        title: "Site",
        phase: "awaiting_agreement",
        permissionsSummary: "edit ~/site",
      },
      { workSessionId: "j2", title: "Audit", phase: "approved", permissionsSummary: "read" },
    ] as unknown as BatonJob[];
    const sessions = [
      { key: "k1", session: "Fix bug", project: "App", box: "onyx", urgent: true },
      { key: "k2", session: "Idle", project: "App", box: "onyx", urgent: false },
    ] as unknown as BatonSessionSummary[];
    const items = buildApprovals({ jobs, sessions });
    expect(items.map((i) => i.id)).toEqual(["p:j1", "s:k1"]);
    expect(describeApprovals(items)).toContain(
      "Site: Start the work as planned. Would use: edit ~/site.",
    );
    expect(describeApprovals([])).toBe("Nothing is waiting for his yes.");
  });
});
