import type { BatonJob } from "@t3tools/baton-contracts";
import { describe, expect, it } from "vite-plus/test";

import { jobAction, jobControls } from "./jobRows.ts";

const job = (id: string, group: string, phase = "approved"): BatonJob =>
  ({ workSessionId: id, title: id, group, phase, limitReached: null, permissionsSummary: "read" }) as unknown as BatonJob;

describe("the Jobs area", () => {
  it("lists what needs him first, offers Approve only for a plan waiting, and maps an action back to its job", () => {
    const jobs = [job("a", "done"), job("b", "needs_you", "awaiting_agreement"), job("c", "running")];
    const rows = jobControls(jobs);
    expect(rows.map((r) => r.id)).toEqual(["j:b", "j:c", "j:a"]);
    expect(rows[0]).toMatchObject({ button: "Approve", lead: true });
    expect(rows[1]).toMatchObject({ button: "Open T3" });
    expect(jobAction(jobs, "j:b")).toEqual({ id: "b", approve: true });
    expect(jobAction(jobs, "j:zzz")).toBeNull();
  });
});
