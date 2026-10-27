import { ProjectId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { liveThreadId, projectForDirectory } from "./LiveSessionMirror.ts";

const project = (id: string, workspaceRoot: string, canonicalKey?: string) => ({
  id: ProjectId.make(id),
  workspaceRoot,
  repositoryIdentity:
    canonicalKey === undefined
      ? null
      : ({ canonicalKey } as unknown as NonNullable<
          Parameters<typeof projectForDirectory>[1][number]["repositoryIdentity"]
        >),
});

describe("which T3 project a live session belongs to", () => {
  const projects = [
    project("ventureos", "/home/onnyx/VentureOS", "github.com/rabhanz/ventureos"),
    project("nested", "/home/onnyx/VentureOS/apps/web"),
  ];

  it("is the deepest project whose root holds the session's directory", () => {
    expect(projectForDirectory("/home/onnyx/VentureOS", projects, null)).toBe("ventureos");
    expect(projectForDirectory("/home/onnyx/VentureOS/.worktrees/lane", projects, null)).toBe(
      "ventureos",
    );
    expect(projectForDirectory("/home/onnyx/VentureOS/apps/web/src", projects, null)).toBe(
      "nested",
    );
    // A sibling folder whose name only starts the same is not inside.
    expect(projectForDirectory("/home/onnyx/VentureOS-old", projects, null)).toBeNull();
  });

  it("falls back to the same repository checked out elsewhere", () => {
    expect(
      projectForDirectory("/mnt/vol/dev/ventureos-copy", projects, "github.com/rabhanz/ventureos"),
    ).toBe("ventureos");
    expect(projectForDirectory("/mnt/vol/dev/other", projects, "github.com/x/other")).toBeNull();
  });

  it("names a thread by the conversation, so rotation and adoption keep it", () => {
    expect(liveThreadId("abc")).toBe("baton-live:abc");
  });
});
