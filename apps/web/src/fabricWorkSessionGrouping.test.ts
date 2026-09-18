import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  WorkSessionId,
  type WorkSession,
  type WorkSessionProviderSession,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { buildWorkSessionGrouping, workSessionThreadSubtitle } from "./fabricWorkSessionGrouping";
import type { SidebarThreadSummary } from "./types";

const environmentId = EnvironmentId.make("home-linux");
const projectId = ProjectId.make("ventureos");

function thread(id: string): SidebarThreadSummary & { environmentId: EnvironmentId } {
  return {
    environmentId,
    id: ThreadId.make(id),
    projectId,
    title: id,
    modelSelection: { instanceId: ProviderInstanceId.make("claudeAgent"), model: "sonnet" },
    runtimeMode: "approval-required",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    pullRequests: [],
    latestTurn: null,
    createdAt: "2026-09-18T00:00:00.000Z",
    updatedAt: "2026-09-18T00:00:00.000Z",
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    session: null,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
  };
}

function providerSession(input: {
  threadId: string;
  instanceId?: string;
  role?: WorkSessionProviderSession["role"];
  attachedAt?: string;
  detachedAt?: string | null;
}): WorkSessionProviderSession {
  return {
    threadId: ThreadId.make(input.threadId),
    providerInstanceId:
      input.instanceId === undefined ? null : ProviderInstanceId.make(input.instanceId),
    providerDriver: null,
    role: input.role ?? "implementation",
    origin: "attached",
    attachedAt: input.attachedAt ?? "2026-09-18T00:00:00.000Z",
    detachedAt: input.detachedAt ?? null,
  };
}

function workSession(input: {
  id?: string;
  activeThreadId?: string | null;
  providerSessions: readonly WorkSessionProviderSession[];
}): WorkSession {
  return {
    id: WorkSessionId.make(input.id ?? "scheduler-reconnect"),
    projectId,
    title: "Scheduler reconnect race",
    objective: "",
    constraints: [],
    acceptanceCriteria: [],
    environmentAffinity: [],
    repositoryIdentity: null,
    primaryWorktreePath: null,
    baseBranch: null,
    status: "active",
    riskClass: "low",
    priority: "normal",
    activeThreadId:
      input.activeThreadId === undefined || input.activeThreadId === null
        ? null
        : ThreadId.make(input.activeThreadId),
    providerSessions: input.providerSessions,
    createdAt: "2026-09-18T00:00:00.000Z",
    updatedAt: "2026-09-18T00:00:00.000Z",
    settledAt: null,
    archivedAt: null,
  };
}

const grouping = (input: {
  workSession: WorkSession;
  threads: ReadonlyArray<SidebarThreadSummary & { environmentId: EnvironmentId }>;
}) =>
  buildWorkSessionGrouping({
    workSessions: [{ environmentId, workSession: input.workSession }],
    threads: input.threads,
    resolveEnvironmentLabel: () => "home-linux",
    resolveProviderAccount: (_environmentId: string, instanceId: string) => {
      const label =
        instanceId === "claude-b" ? "Claude B" : instanceId === "claude-a" ? "Claude A" : null;
      return label === null ? null : { label, email: null };
    },
  });

describe("buildWorkSessionGrouping", () => {
  it("names the account and the host on the work session's live thread", () => {
    const result = grouping({
      workSession: workSession({
        activeThreadId: "t-b",
        providerSessions: [providerSession({ threadId: "t-b", instanceId: "claude-b" })],
      }),
      threads: [thread("t-b")],
    });
    const row = result.groups[0]?.threads[0];
    expect(row?.providerLabel).toBe("Claude B");
    expect(row?.hostLabel).toBe("home-linux");
    expect(row?.isActive).toBe(true);
  });

  it("keeps the work session when its provider thread no longer exists", () => {
    // The Phase 2 exit criterion, seen from the sidebar: the thread is gone,
    // the work is not, and the account that ran it is still named.
    const result = grouping({
      workSession: workSession({
        activeThreadId: null,
        providerSessions: [providerSession({ threadId: "t-a", instanceId: "claude-a" })],
      }),
      threads: [],
    });
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]?.threads).toHaveLength(0);
    expect(result.groups[0]?.pastProviderLabels).toEqual(["Claude A"]);
  });

  it("moves a detached provider into history rather than dropping it", () => {
    const result = grouping({
      workSession: workSession({
        activeThreadId: "t-b",
        providerSessions: [
          providerSession({
            threadId: "t-a",
            instanceId: "claude-a",
            detachedAt: "2026-09-18T10:32:00.000Z",
          }),
          providerSession({ threadId: "t-b", instanceId: "claude-b" }),
        ],
      }),
      threads: [thread("t-a"), thread("t-b")],
    });
    expect(result.groups[0]?.pastProviderLabels).toEqual(["Claude A"]);
    expect(result.groups[0]?.threads.map((row) => row.thread.id)).toEqual(["t-b"]);
    // A detached thread is released back to the flat list, not hidden.
    expect(result.groupedThreadIds.has(ThreadId.make("t-a"))).toBe(false);
  });

  it("puts the active thread first and a review session after it", () => {
    const result = grouping({
      workSession: workSession({
        activeThreadId: "t-impl",
        providerSessions: [
          providerSession({ threadId: "t-review", instanceId: "codex", role: "review" }),
          providerSession({ threadId: "t-impl", instanceId: "claude-b" }),
        ],
      }),
      threads: [thread("t-review"), thread("t-impl")],
    });
    expect(result.groups[0]?.threads.map((row) => row.thread.id)).toEqual(["t-impl", "t-review"]);
  });

  it("reports which work session owns a thread, for the reverse lookup", () => {
    const result = grouping({
      workSession: workSession({
        activeThreadId: "t-b",
        providerSessions: [providerSession({ threadId: "t-b", instanceId: "claude-b" })],
      }),
      threads: [thread("t-b")],
    });
    expect(result.workSessionByThreadId.get(ThreadId.make("t-b"))).toBe("scheduler-reconnect");
  });

  it("leaves ungrouped threads for the ordinary list", () => {
    const result = grouping({
      workSession: workSession({
        activeThreadId: "t-b",
        providerSessions: [providerSession({ threadId: "t-b", instanceId: "claude-b" })],
      }),
      threads: [thread("t-b"), thread("t-loose")],
    });
    expect(result.groupedThreadIds.has(ThreadId.make("t-loose"))).toBe(false);
  });
});

describe("workSessionThreadSubtitle", () => {
  it("reads account, host, status", () => {
    expect(
      workSessionThreadSubtitle({
        providerLabel: "Claude B",
        hostLabel: "home-linux",
        statusLabel: "Working",
      }),
    ).toBe("Claude B · home-linux · Working");
  });

  it("drops missing parts instead of rendering stray separators", () => {
    expect(
      workSessionThreadSubtitle({
        providerLabel: null,
        hostLabel: "home-linux",
        statusLabel: null,
      }),
    ).toBe("home-linux");
  });
});
