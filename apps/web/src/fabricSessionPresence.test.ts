import { describe, expect, it } from "vite-plus/test";
import { ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import type { AgentSessionThreadSummary } from "@t3tools/contracts";

import {
  buildSessionPresence,
  sessionPresenceSummary,
  type SessionPresenceCounts,
} from "./fabricSessionPresence";

const thread = (
  overrides: Partial<AgentSessionThreadSummary> & { readonly providerSessionId: string },
): AgentSessionThreadSummary => ({
  provider: "claudeAgent",
  providerInstanceId: ProviderInstanceId.make("claudeAgent"),
  threadId: ThreadId.make(`import:claudeAgent:${overrides.providerSessionId}`),
  title: "A conversation",
  preview: "Do the thing",
  workspaceRoot: "/home/onnyx/VentureOS",
  model: "claude-x",
  messageCount: 4,
  sizeBytes: 1024,
  startedAt: "2026-09-18T10:00:00.000Z",
  lastActiveAt: "2026-09-18T11:00:00.000Z",
  alreadyImported: false,
  stillWriting: false,
  ...overrides,
});

const projectLabels: Record<string, string> = {
  "project-1": "VentureOS",
  "project-2": "rabee.dev",
};
const resolveProjectLabel = (projectId: ProjectId) => projectLabels[projectId] ?? null;

describe("buildSessionPresence", () => {
  it("lists a session that is on disk and omits one that is already a thread", () => {
    const view = buildSessionPresence({
      threads: [
        thread({ providerSessionId: "a", projectId: ProjectId.make("project-1") }),
        thread({
          providerSessionId: "b",
          projectId: ProjectId.make("project-1"),
          alreadyImported: true,
        }),
      ],
      knownThreadIds: new Set(),
      resolveProjectLabel,
    });

    expect(view.groups).toHaveLength(1);
    expect(view.groups[0]?.projectLabel).toBe("VentureOS");
    expect(view.groups[0]?.rows.map((row) => [row.providerSessionId, row.state])).toEqual([
      ["a", "on-disk"],
    ]);
    expect(view.counts).toMatchObject({ discovered: 2, present: 1, onDisk: 1, running: 0 });
  });

  it("marks a conversation still being written as running rather than offering it", () => {
    const view = buildSessionPresence({
      threads: [
        thread({ providerSessionId: "old", projectId: ProjectId.make("project-1") }),
        thread({
          providerSessionId: "live",
          projectId: ProjectId.make("project-1"),
          stillWriting: true,
        }),
      ],
      knownThreadIds: new Set(),
      resolveProjectLabel,
    });

    // Running leads the group: it is the only row that is about right now.
    expect(view.groups[0]?.rows.map((row) => [row.providerSessionId, row.state])).toEqual([
      ["live", "running"],
      ["old", "on-disk"],
    ]);
    expect(view.counts.running).toBe(1);
  });

  it("treats a thread the client already holds as present even before the server agrees", () => {
    const summary = thread({ providerSessionId: "a", projectId: ProjectId.make("project-1") });
    const view = buildSessionPresence({
      threads: [summary],
      knownThreadIds: new Set([summary.threadId]),
      resolveProjectLabel,
    });

    expect(view.groups).toHaveLength(0);
    expect(view.counts).toMatchObject({ present: 1, onDisk: 0 });
  });

  it("keeps a nested session under its project, after the project's own", () => {
    const view = buildSessionPresence({
      threads: [
        thread({
          providerSessionId: "lane",
          projectId: ProjectId.make("project-1"),
          nested: true,
          sessionRoot: "/home/onnyx/VentureOS/.claude-worktrees/agent-a1",
          lastActiveAt: "2026-09-18T12:00:00.000Z",
        }),
        thread({ providerSessionId: "his", projectId: ProjectId.make("project-1") }),
      ],
      knownThreadIds: new Set(),
      resolveProjectLabel,
    });

    expect(view.groups[0]?.rows.map((row) => [row.providerSessionId, row.nested])).toEqual([
      ["his", false],
      ["lane", true],
    ]);
    expect(view.groups[0]?.rows[1]?.sessionRoot).toBe(
      "/home/onnyx/VentureOS/.claude-worktrees/agent-a1",
    );
  });

  it("hides nested sessions when asked, without changing the counts", () => {
    const view = buildSessionPresence({
      threads: [
        thread({ providerSessionId: "lane", projectId: ProjectId.make("project-1"), nested: true }),
        thread({ providerSessionId: "his", projectId: ProjectId.make("project-1") }),
      ],
      knownThreadIds: new Set(),
      resolveProjectLabel,
      hideNested: true,
    });

    expect(view.groups[0]?.rows.map((row) => row.providerSessionId)).toEqual(["his"]);
    // The count still says two, because hiding a row must not make the gap
    // report smaller than it is.
    expect(view.counts.discovered).toBe(2);
    expect(view.counts.onDisk).toBe(2);
  });

  it("sorts sessions with no project last and counts them as the actionable gap", () => {
    const view = buildSessionPresence({
      threads: [
        thread({ providerSessionId: "orphan", workspaceRoot: "/home/onnyx/meliura-engine" }),
        thread({ providerSessionId: "owned", projectId: ProjectId.make("project-2") }),
      ],
      knownThreadIds: new Set(),
      resolveProjectLabel,
    });

    expect(view.groups.map((group) => group.projectLabel)).toEqual(["rabee.dev", null]);
    expect(view.groups[1]?.workspaceRoot).toBe("/home/onnyx/meliura-engine");
    expect(view.counts.orphaned).toBe(1);
  });
});

describe("sessionPresenceSummary", () => {
  const counts = (overrides: Partial<SessionPresenceCounts>): SessionPresenceCounts => ({
    discovered: 0,
    present: 0,
    onDisk: 0,
    running: 0,
    orphaned: 0,
    ...overrides,
  });

  it("states the gap as a count rather than a mood", () => {
    expect(
      sessionPresenceSummary(
        counts({ discovered: 151, present: 87, onDisk: 62, running: 2, orphaned: 9 }),
      ),
    ).toBe("87 of 151 here · 62 on disk · 2 running · 9 with no project");
  });

  it("says so plainly when nothing was found", () => {
    expect(sessionPresenceSummary(counts({}))).toBe("No conversations found on this machine");
  });

  it("drops the empty clauses once everything is here", () => {
    expect(sessionPresenceSummary(counts({ discovered: 12, present: 12 }))).toBe("12 of 12 here");
  });
});
