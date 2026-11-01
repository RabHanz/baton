import { describe, expect, it } from "vite-plus/test";

import { harnessControls, pluginOfControl } from "./harnessRows.ts";

describe("the Skills and tools area", () => {
  it("gives a plugin a switch, shows skills and servers as plain lines, and says so when empty", () => {
    const rows = harnessControls([
      {
        id: "p",
        name: "a@m",
        harness: "Claude",
        kind: "plugin",
        enabled: false,
        detail: "Applies to the next session.",
      },
      {
        id: "s",
        name: "review",
        harness: "Claude",
        kind: "skill",
        enabled: null,
        detail: "Reviews",
      },
      { id: "m", name: "docs", harness: "Codex", kind: "mcp", enabled: null, detail: "" },
    ]);
    expect(rows[0]).toMatchObject({ id: "k:a@m", kind: "toggle", on: false, section: "Plugins" });
    expect(rows[1]).toMatchObject({ kind: "check", section: "Skills", more: true });
    expect(rows[2]).toMatchObject({ section: "MCP servers", detail: "Installed." });
    expect(harnessControls([])[0]).toMatchObject({ id: "k.empty" });
    expect(pluginOfControl("k:a@m")).toBe("a@m");
    expect(pluginOfControl("k.claude-skill-x")).toBeNull();
  });
});
