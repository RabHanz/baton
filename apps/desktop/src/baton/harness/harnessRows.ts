/** The Skills and tools area of Baton's window (D146): the harnesses' own plugins, skills and servers. */
import type { HomeControl } from "../home/batonHome.ts";
import type { HarnessItem } from "./harnessInventory.ts";

export const harnessControls = (items: ReadonlyArray<HarnessItem>): ReadonlyArray<HomeControl> => {
  if (items.length === 0) {
    return [
      {
        id: "k.empty",
        section: "Plugins",
        label: "Nothing found",
        hint: "Tessaya reads the plugins, skills and servers of Claude Code and Codex on this computer.",
        kind: "check",
        status: "ok",
        detail: "Neither has any installed here.",
      },
    ];
  }
  const section = { plugin: "Plugins", skill: "Skills", mcp: "MCP servers" } as const;
  return items.map((i): HomeControl =>
    i.kind === "plugin"
      ? {
          id: `k:${i.name}`,
          section: section.plugin,
          label: `${i.name} (${i.harness})`,
          hint: i.detail,
          kind: "toggle",
          on: i.enabled === true,
        }
      : {
          id: `k.${i.id}`,
          section: section[i.kind],
          label: `${i.name} (${i.harness})`,
          kind: "check",
          status: "ok",
          detail: i.detail === "" ? "Installed." : i.detail,
          ...(i.kind === "skill" ? { more: true } : {}),
        },
  );
};

/** `k:<plugin name>` is the switch of one Claude plugin; anything else is not. */
export const pluginOfControl = (id: string): string | null =>
  id.startsWith("k:") ? id.slice(2) : null;
