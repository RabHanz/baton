import { describe, expect, it } from "vite-plus/test";

import { tabOf } from "../home/tabs.ts";
import { presenceControls, presencePatch } from "./presenceRows.ts";

const settings = {
  awarenessWindow: false,
  awarenessIdle: false,
  awarenessFocus: false,
  awarenessJobs: false,
  initiativeMode: "written",
  initiativePerHour: 3,
} as const;

describe("the Presence settings", () => {
  it("shows every switch off by default, none folded away, all on the Settings tab", () => {
    const rows = presenceControls(settings);
    expect(rows.filter((r) => r.kind === "toggle").every((r) => r.kind === "toggle" && !r.on)).toBe(
      true,
    );
    expect(rows.some((r) => r.more === true)).toBe(false);
    for (const r of rows) expect(tabOf(r.id)).toBe("settings");
  });
  it("turns a control into a settings patch and refuses a value it does not offer", () => {
    expect(presencePatch("pr.awWindow", true)).toEqual({ awarenessWindow: true });
    expect(presencePatch("pr.initiative", "spoken")).toEqual({ initiativeMode: "spoken" });
    expect(presencePatch("pr.initiative", "loud")).toBeNull();
    expect(presencePatch("pr.perHour", "5")).toEqual({ initiativePerHour: 5 });
    expect(presencePatch("pr.perHour", "99")).toBeNull();
  });
});
