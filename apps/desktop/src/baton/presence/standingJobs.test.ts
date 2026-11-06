import type { BatonJob, WatchFinding } from "@t3tools/baton-contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  EMPTY_STANDING,
  migrateStanding,
  runStandingJobs,
  type StandingInput,
  type StandingOps,
  type StandingState,
} from "./standingJobs.ts";

const NOW = Date.parse("2026-11-03T09:00:00Z");
const allOn: StandingState = {
  ...EMPTY_STANDING,
  on: { ci_look: true, morning_brief: true, waiting_remind: true, job_summary: true },
};
const ci = (runId: number) => ({
  repo: "o/r",
  runId,
  name: "ci",
  branch: "main",
  conclusion: "failure",
  createdAt: "2026-11-03T08:00:00Z",
});
const waiting = {
  workSessionId: "w1",
  title: "Build",
  kind: "unanswered",
  minutes: 90,
} as WatchFinding;
const done = (id: string, at: string) =>
  ({
    workSessionId: id,
    title: id,
    group: "done",
    phase: "approved",
    lastActivityAt: at,
    usage: { minutes: 12, turns: 5, dollars: 0.5 },
  }) as unknown as BatonJob;

const fakes = () => {
  const log = { looked: [] as string[], said: [] as string[], noted: [] as string[], briefs: 0 };
  const ops: StandingOps = {
    look: async (t) => (log.looked.push(t.id), "read-only job started"),
    brief: async () => (log.briefs++, "the brief"),
    say: (t) => void log.said.push(t),
    note: async (id) => void log.noted.push(id),
  };
  return { log, ops };
};
const input = (over: Partial<StandingInput> = {}): StandingInput => ({
  state: allOn,
  refusal: () => null,
  now: NOW,
  day: "Tue",
  hour: 9,
  findings: [waiting],
  ci: [ci(1)],
  jobs: [done("j1", "2026-11-03T08:30:00Z"), done("old", "2026-10-01T08:30:00Z")],
  ...over,
});

describe("standing jobs", () => {
  it("does nothing while all are off", async () => {
    const { log, ops } = fakes();
    const r = await runStandingJobs(input({ state: EMPTY_STANDING }), ops);
    expect(r.did).toEqual([]);
    expect(log).toEqual({ looked: [], said: [], noted: [], briefs: 0 });
  });

  it("runs each switched-on playbook once for what it saw, and logs it", async () => {
    const { log, ops } = fakes();
    const first = await runStandingJobs(input(), ops);
    expect(first.did.map((d) => d.id).toSorted()).toEqual([
      "ci_look",
      "job_summary",
      "morning_brief",
      "waiting_remind",
    ]);
    expect(log.noted).toEqual(["j1"]);
    expect(log.said).toHaveLength(1);
    const again = await runStandingJobs(input({ state: first.state }), ops);
    expect(again.did).toEqual([]);
    expect(first.state.brief).toEqual({ day: "Tue", text: "the brief" });
  });

  it("is never capped: every run is counted, and each runs once for what it saw", async () => {
    const { log, ops } = fakes();
    const r = await runStandingJobs(
      input({ ci: [1, 2, 3, 4, 5].map((n) => ({ ...ci(n), repo: `o/r${n}` })) }),
      ops,
    );
    expect(log.looked).toHaveLength(5);
    expect(r.state.counts.ci_look).toBe(5);
  });

  it("holds a job its owner may not run by itself, once, and runs nothing for it", async () => {
    const { log, ops } = fakes();
    const r = await runStandingJobs(
      input({
        refusal: (job) =>
          job.id === "job_summary" ? "job_refine is not one of Alfred's tools." : null,
      }),
      ops,
    );
    expect(log.noted).toEqual([]);
    expect(r.did.find((d) => d.id === "job_summary")).toMatchObject({
      outcome: "held",
      text: "Held: job_refine is not one of Alfred's tools.",
    });
    expect(r.state.counts.job_summary).toBeUndefined();
    const again = await runStandingJobs(input({ state: r.state }), ops);
    expect(again.did.some((d) => d.id === "job_summary")).toBe(false);
  });

  it("moves an older playbooks file over, keeping a brief he was getting either way", () => {
    const old = {
      on: { ci_look: true },
      runs: [{ id: "ci_look", key: "k", at: 1, text: "t" }],
      brief: null,
    };
    const moved = migrateStanding(old, true);
    expect(moved.on).toEqual({ ci_look: true, morning_brief: true });
    expect(moved.runs[0]?.outcome).toBe("ran");
    expect(migrateStanding(null, false).on).toEqual({ morning_brief: false });
    expect(migrateStanding({ on: { morning_brief: true } }, false).on.morning_brief).toBe(true);
  });

  it("records a failing op and still runs the others", async () => {
    const { log, ops } = fakes();
    const r = await runStandingJobs(input(), {
      ...ops,
      look: async () => {
        throw new Error("no gh");
      },
    });
    expect(r.did.find((d) => d.id === "ci_look")?.text).toContain("Failed: no gh");
    expect(log.briefs).toBe(1);
  });

  it("says nothing aloud while silenced, and still reminds once it ends", async () => {
    const { log, ops } = fakes();
    const quiet = await runStandingJobs(input({ quiet: true }), ops);
    expect(log.said).toEqual([]);
    expect(quiet.did.some((d) => d.id === "waiting_remind")).toBe(false);
    await runStandingJobs(input({ state: quiet.state }), ops);
    expect(log.said).toHaveLength(1);
  });

  it("builds no brief before six, nor in quiet hours", async () => {
    const { log, ops } = fakes();
    await runStandingJobs(input({ hour: 5 }), ops);
    await runStandingJobs(input({ quiet: true }), ops);
    expect(log.briefs).toBe(0);
  });
});
