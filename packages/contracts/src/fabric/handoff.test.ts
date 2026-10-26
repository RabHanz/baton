import { describe, expect, it } from "vite-plus/test";

import { buildHandoffCapsule } from "./handoff.ts";
import type { WorkSession } from "./workSession.ts";

const at = "2026-10-26T10:00:00.000Z";

const workSession = {
  id: "ws-1",
  projectId: "p-1",
  title: "scheduler reconnect race",
  objective: "Prevent duplicate dispatch on reconnect.",
  constraints: ["no schema change"],
  acceptanceCriteria: ["reconnect test passes"],
  environmentAffinity: [],
  repositoryIdentity: null,
  primaryWorktreePath: "/w/sched",
  baseBranch: "fix/reconnect",
  status: "active",
  riskClass: "low",
  priority: "normal",
  activeThreadId: "t-a",
  providerSessions: [],
  synopsis: {
    currentAction: "Running reconnect integration tests.",
    goal: "",
    recentFindings: [
      { text: "Stale ownership survives one path.", observedAt: at, source: "events" },
    ],
    changedFiles: ["src/scheduler.ts"],
    validation: [{ label: "reconnect.test", outcome: "failed", observedAt: at }],
    next: ["Guard the ACK path."],
    needsUser: false,
    updatedAt: at,
    updatedBy: null,
    source: "events",
  },
  createdAt: at,
  updatedAt: at,
  settledAt: null,
  archivedAt: null,
} as unknown as WorkSession;

const git = { branch: "fix/reconnect", worktree: "/w/sched", commit: null, dirtyFiles: ["a.ts"] };

describe("the §6.1 handoff capsule", () => {
  it("carries the work, the checkout and the next step, not a transcript", () => {
    const capsule = buildHandoffCapsule({
      workSession,
      git,
      sourceThreadId: "t-a",
      sourceProvider: "claudeAgent / claudeAgent",
      note: "keep it small",
    });
    expect(capsule.objective).toBe("Prevent duplicate dispatch on reconnect.");
    expect(capsule.knownFindings).toEqual(["Stale ownership survives one path."]);
    expect(capsule.validationResults).toEqual(["reconnect.test: failed"]);
    expect(capsule.recommendedNextAction).toBe("Guard the ACK path.");
    expect(capsule.latestHumanDirection).toBe("keep it small");
    expect(capsule.text).toContain("do not start over");
    expect(capsule.text).toContain("- uncommitted files: a.ts");
    expect(capsule.text).toContain("Earlier history lives in thread t-a");
    expect(capsule.text.length).toBeLessThan(2000);
  });

  it("still says something useful for work with no synopsis and no source", () => {
    const capsule = buildHandoffCapsule({
      workSession: { ...workSession, objective: "", synopsis: null },
      git: { branch: null, worktree: null, commit: null, dirtyFiles: [] },
      sourceThreadId: null,
      sourceProvider: null,
      note: null,
    });
    expect(capsule.objective).toBe("scheduler reconnect race");
    expect(capsule.text).toContain("started by another session");
    expect(capsule.text).toContain("uncommitted files: none");
    expect(capsule.text).not.toContain("Earlier history");
  });
});
