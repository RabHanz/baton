import type { BatonJob } from "@t3tools/baton-contracts";
import { describe, expect, it } from "vite-plus/test";

import { jobAction, jobControls } from "./jobRows.ts";

const job = (
  id: string,
  group: string,
  phase = "approved",
  scheduleTaskId: string | null = null,
): BatonJob =>
  ({
    workSessionId: id,
    title: id,
    group,
    phase,
    limitReached: null,
    permissionsSummary: "read",
    terms: { scheduleTaskId },
  }) as unknown as BatonJob;

describe("the Jobs area", () => {
  it("lists what needs him first, with Approve, Stop, an answer line and a schedule where each applies", () => {
    const jobs = [
      job("a", "done"),
      job("b", "needs_you", "awaiting_agreement"),
      job("c", "running", "approved", "task-1"),
    ];
    const rows = jobControls(jobs);
    expect(rows.map((r) => r.id)).toEqual(["j:b", "ja:b", "j:c", "js:c", "j:a", "js:a"]);
    expect(rows[0]).toMatchObject({ button: "Approve", secondary: "Stop", lead: true });
    expect(rows[1]).toMatchObject({ kind: "session", canSend: true });
    expect(rows[2]).toMatchObject({ button: "Open T3", secondary: "Stop" });
    expect(rows[3]).toMatchObject({ button: "Turn off", more: true });
    expect(rows[5]).toMatchObject({ button: "Run daily" });
  });
  it("maps an action back to its job and what it asks for", () => {
    const jobs = [
      job("b", "needs_you", "awaiting_agreement"),
      job("c", "running", "approved", "t"),
    ];
    expect(jobAction(jobs, "j:b")).toMatchObject({ id: "b", kind: "primary", approve: true });
    expect(jobAction(jobs, "j:b:later")).toMatchObject({ kind: "stop" });
    expect(jobAction(jobs, "ja:b")).toMatchObject({ kind: "answer" });
    expect(jobAction(jobs, "js:c")).toMatchObject({ kind: "schedule", scheduled: true });
    expect(jobAction(jobs, "j:zzz")).toBeNull();
  });
});
