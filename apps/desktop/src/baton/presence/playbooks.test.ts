import type { BatonJob, WatchFinding } from "@t3tools/baton-contracts";
import { describe, expect, it } from "vite-plus/test";

import { EMPTY_PLAYBOOKS, runPlaybooks, type PlaybookInput, type PlaybookOps, type PlaybookState } from "./playbooks.ts";

const NOW = Date.parse("2026-11-03T09:00:00Z");
const allOn: PlaybookState = {
  ...EMPTY_PLAYBOOKS,
  on: { ci_look: true, morning_brief: true, waiting_remind: true, job_summary: true },
};
const ci = (runId: number) => ({ repo: "o/r", runId, name: "ci", branch: "main", conclusion: "failure", createdAt: "2026-11-03T08:00:00Z" });
const waiting = { workSessionId: "w1", title: "Build", kind: "unanswered", minutes: 90 } as WatchFinding;
const done = (id: string, at: string) => ({ workSessionId: id, title: id, group: "done", phase: "approved", lastActivityAt: at, usage: { minutes: 12, turns: 5, dollars: 0.5 } }) as unknown as BatonJob;

const fakes = () => {
  const log = { looked: [] as string[], said: [] as string[], noted: [] as string[], briefs: 0 };
  const ops: PlaybookOps = {
    look: async (t) => (log.looked.push(t.id), "read-only job started"),
    brief: async () => (log.briefs++, "the brief"),
    say: (t) => void log.said.push(t),
    note: async (id) => void log.noted.push(id),
  };
  return { log, ops };
};
const input = (over: Partial<PlaybookInput> = {}): PlaybookInput => ({
  state: allOn, now: NOW, day: "Tue", hour: 9, findings: [waiting], ci: [ci(1)],
  jobs: [done("j1", "2026-11-03T08:30:00Z"), done("old", "2026-10-01T08:30:00Z")], ...over,
});

describe("playbooks", () => {
  it("does nothing while all are off", async () => {
    const { log, ops } = fakes();
    const r = await runPlaybooks(input({ state: EMPTY_PLAYBOOKS }), ops);
    expect(r.did).toEqual([]);
    expect(log).toEqual({ looked: [], said: [], noted: [], briefs: 0 });
  });

  it("runs each switched-on playbook once for what it saw, and logs it", async () => {
    const { log, ops } = fakes();
    const first = await runPlaybooks(input(), ops);
    expect(first.did.map((d) => d.id).toSorted()).toEqual(["ci_look", "job_summary", "morning_brief", "waiting_remind"]);
    expect(log.noted).toEqual(["j1"]);
    expect(log.said).toHaveLength(1);
    const again = await runPlaybooks(input({ state: first.state }), ops);
    expect(again.did).toEqual([]);
    expect(first.state.brief).toEqual({ day: "Tue", text: "the brief" });
  });

  it("keeps to the budget per day", async () => {
    const { log, ops } = fakes();
    const r = await runPlaybooks(input({ ci: [1, 2, 3, 4, 5].map((n) => ({ ...ci(n), repo: `o/r${n}` })) }), ops);
    expect(log.looked).toHaveLength(3);
    expect(r.state.runs.filter((x) => x.id === "ci_look")).toHaveLength(3);
  });

  it("records a failing op and still runs the others", async () => {
    const { log, ops } = fakes();
    const r = await runPlaybooks(input(), { ...ops, look: async () => { throw new Error("no gh"); } });
    expect(r.did.find((d) => d.id === "ci_look")?.text).toContain("Failed: no gh");
    expect(log.briefs).toBe(1);
  });

  it("says nothing aloud while silenced, and still reminds once it ends", async () => {
    const { log, ops } = fakes();
    const quiet = await runPlaybooks(input({ quiet: true }), ops);
    expect(log.said).toEqual([]);
    expect(quiet.did.some((d) => d.id === "waiting_remind")).toBe(false);
    await runPlaybooks(input({ state: quiet.state }), ops);
    expect(log.said).toHaveLength(1);
  });

  it("builds no brief before six", async () => {
    const { log, ops } = fakes();
    await runPlaybooks(input({ hour: 5 }), ops);
    expect(log.briefs).toBe(0);
  });
});
