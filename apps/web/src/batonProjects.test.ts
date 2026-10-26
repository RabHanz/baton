import type {
  AdoptedSessionCandidate,
  BatonFleetEntry,
  ClaudeLiveSession,
  EnvironmentId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { buildBatonProjects, type EnvironmentLive } from "./batonProjects";

const repo = { key: "github.com/rabhanz/ventureos", label: "VentureOS" };

const claude = (over: Partial<ClaudeLiveSession>): ClaudeLiveSession =>
  ({
    pid: 1,
    sessionId: "s",
    cwd: "/home/onnyx/VentureOS",
    name: null,
    status: "idle",
    entrypoint: "cli",
    herdrPane: null,
    tmux: null,
    account: null,
    updatedAt: null,
    project: repo,
    ...over,
  }) as ClaudeLiveSession;

const env = (id: string, label: string, over: Partial<EnvironmentLive>): EnvironmentLive => ({
  environmentId: id as EnvironmentId,
  environmentLabel: label,
  entries: [],
  herdr: [],
  claude: [],
  ...over,
});

describe("one entry per project, across boxes and accounts (D72)", () => {
  it("puts sessions on two boxes and two accounts under one project", () => {
    const groups = buildBatonProjects({
      environments: [
        env("e1", "signzart", {
          claude: [claude({ sessionId: "a", account: "optima", herdrPane: "fab-v~w1:p1" })],
        }),
        env("e2", "onnyx", { claude: [claude({ sessionId: "b", account: "rabee" })] }),
      ],
      resolveWorkProject: () => null,
    });
    expect(groups).toHaveLength(1);
    expect(groups[0]?.label).toBe("VentureOS");
    expect(groups[0]?.boxes).toEqual(["signzart", "onnyx"]);
    expect(groups[0]?.accounts.toSorted()).toEqual(["optima", "rabee"]);
    expect(groups[0]?.rows.map((row) => row.key)).toEqual(["claude:a", "claude:b"]);
  });

  it("keeps a session's row through rotation and adoption: the key is the conversation", () => {
    const before = buildBatonProjects({
      environments: [
        env("e1", "signzart", { claude: [claude({ sessionId: "a", pid: 10, account: "optima" })] }),
      ],
      resolveWorkProject: () => null,
    });
    const after = buildBatonProjects({
      environments: [
        env("e1", "signzart", {
          claude: [claude({ sessionId: "a", pid: 99, account: "rabee", herdrPane: "fab-v~w1:p2" })],
        }),
      ],
      resolveWorkProject: () => null,
    });
    expect(after[0]?.rows[0]?.key).toBe(before[0]?.rows[0]?.key);
    const row = after[0]?.rows[0];
    expect(row?.kind === "claude" && row.pane).toBe("fab-v~w1:p2");
  });

  it("files a T3 work session under the same project, and a bare Herdr pane by its folder", () => {
    const groups = buildBatonProjects({
      environments: [
        env("e1", "signzart", {
          entries: [
            {
              workSessionId: "w1",
              projectId: "p1",
              title: "handoff",
              state: "working",
              needsUser: false,
            } as unknown as BatonFleetEntry,
          ],
          herdr: [
            {
              label: "tail -f",
              location: { pane: "w2:p1", workspace: "logs", host: null },
              state: "monitoring",
              runtimeState: "unknown",
              cwd: "/srv/logs",
            } as unknown as AdoptedSessionCandidate,
          ],
          claude: [claude({ sessionId: "a" })],
        }),
      ],
      resolveWorkProject: () => repo,
    });
    const ventureos = groups.find((group) => group.key === repo.key);
    expect(ventureos?.rows.map((row) => row.kind).toSorted()).toEqual(["claude", "work"]);
    expect(groups.find((group) => group.key === "dir:logs")?.rows[0]?.kind).toBe("pane");
  });
});
