import { describe, expect, it } from "vite-plus/test";

import { batonUsageSummaries } from "./batonUsage";

describe("the limits Baton's window shows", () => {
  it("names each window the way the tile does, with when it resets", () => {
    const out = batonUsageSummaries([
      {
        box: "onnyx",
        providers: [
          {
            instanceId: "claudeAgent_a",
            displayName: "rabee",
            enabled: true,
            usageLimits: {
              windows: [
                {
                  kind: "session",
                  label: "5h",
                  usedPercent: 35,
                  resetsAt: "2026-11-01T12:00:00Z",
                },
                { kind: "weekly", label: "7d", usedPercent: 61 },
              ],
            },
          },
          { instanceId: "codex", enabled: true },
          {
            instanceId: "off",
            enabled: false,
            usageLimits: { windows: [{ kind: "weekly", label: "7d", usedPercent: 1 }] },
          },
        ],
      },
    ]);
    expect(out).toEqual([
      {
        account: "rabee",
        box: "onnyx",
        windows: [
          { label: "Session", usedPercent: 35, resetsAt: "2026-11-01T12:00:00Z" },
          { label: "Week", usedPercent: 61, resetsAt: null },
        ],
      },
    ]);
  });
});
