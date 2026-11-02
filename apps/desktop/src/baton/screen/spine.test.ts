// @effect-diagnostics nodeBuiltinImport:off
/**
 * The regression matrix behind docs/baton/SPINE.md: every way in reaches the same modes, every tool that sees,
 * points, teaches or acts is judged by the one gate, and nothing grows a second overlay or dialog family.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";

import { entryRoute, fallbackDecision, instantDecision } from "@t3tools/baton-shared/brain";
import { BATON_TOOLS, judgeToolCall } from "@t3tools/baton-shared/operator";

import { buildBatonTools, type ToolHost } from "../agent/batonTools.ts";

const baton = NodePath.resolve(import.meta.dirname, "..");
const source = (...parts: string[]) => NodeFS.readFileSync(NodePath.join(baton, ...parts), "utf8");

describe("entry points: voice, typed Ask, hotkey and tray all arrive as a sentence", () => {
  // [sentence, a lesson or drive is running, expected first hop with the one assistant on, and with it off]
  const rows = [
    ["teach: change the font size", false, "router", "router"],
    ["drive: change the font size", false, "router", "router"],
    ["look: what is this", false, "router", "router"],
    ["stop", true, "router", "router"],
    ["next", true, "router", "router"],
    ["teach me how to change the font size", false, "assistant", "router"],
    ["where is the export button", false, "assistant", "router"],
    ["do it for me", false, "assistant", "router"],
  ] as const;
  it.each(rows)("%s", (said, active, withAssistant, without) => {
    expect(entryRoute(said, active, true)).toBe(withAssistant);
    expect(entryRoute(said, active, false)).toBe(without);
  });

  it("the older router still reaches every mode when the assistant is off or fails", () => {
    expect(fallbackDecision("teach me how to use this", false).route).toBe("teach");
    expect(fallbackDecision("where is the export button on this screen", false).route).toBe("look");
    expect(instantDecision("drive: open the file", false)?.route).toBe("drive");
  });
});

describe("tools: what sees, points, teaches or acts goes through the one gate", () => {
  const host = {} as ToolHost;
  const tools = buildBatonTools(host).map((t) => t.name);
  const call = (tool: string, input: Record<string, unknown> = {}) =>
    judgeToolCall({ tool, input }, { actWithoutAsking: false, tainted: false });

  it("every tool is in the table the gate reads", () => {
    expect(new Set(tools)).toEqual(new Set(BATON_TOOLS));
  });
  it("seeing, pointing and the two guided modes are allowed here because each asks where it runs", () => {
    for (const name of ["screen_capture", "ui_tree", "point_at", "teach_start", "drive_start"])
      expect(call(name, { goal: "x" }).verdict).toBe("allow");
  });
  it("acting is judged: a drag asks, and typing into a command line asks", () => {
    expect(call("drag").verdict).toBe("ask");
    expect(
      judgeToolCall(
        { tool: "type_text", input: { text: "rm -rf ." } },
        { actWithoutAsking: false, tainted: false, focusedShell: true },
      ).verdict,
    ).toBe("ask");
  });
  it("the guided modes are tools of the one assistant, not a second table", () => {
    for (const name of ["point_at", "teach_start", "drive_start"]) expect(tools).toContain(name);
  });
});

describe("one overlay family, one dialog family", () => {
  const files = NodeFS.readdirSync(NodePath.join(baton, "screen")).filter(
    (f) => f.endsWith(".ts") && !f.endsWith(".test.ts"),
  );
  it("only pointerOverlay and companionWindows create windows in screen/", () => {
    const makers = files.filter((f) => /new Electron\.BrowserWindow\(/.test(source("screen", f)));
    expect(makers.toSorted()).toEqual(["companionWindows.ts", "pointerOverlay.ts"]);
  });
  it("nothing in screen/ or agent/ opens a system dialog; every question goes through windows.ask", () => {
    for (const dir of ["screen", "agent"])
      for (const f of NodeFS.readdirSync(NodePath.join(baton, dir)))
        if (f.endsWith(".ts") && !f.endsWith(".test.ts") && f !== "spine.test.ts")
          expect(source(dir, f), `${dir}/${f}`).not.toMatch(/dialog\.showMessageBox/);
  });
  it("every question the companion asks uses the Go ahead / Not now family or an explicit choice", () => {
    const text = source("screen", "ScreenCompanion.ts");
    expect(text.match(/buttons: \["Go ahead", "Not now"\]/g)?.length ?? 0).toBeGreaterThanOrEqual(
      4,
    );
  });
  it("cards and prompts share one clearance above the pill", () => {
    for (const f of ["pointerOverlay.ts", "companionWindows.ts"])
      expect(source("screen", f)).toContain("CARD_ABOVE_WORK_AREA");
  });
  it("cues have one path: the companion reports them, the pill plays them", () => {
    expect(source("screen", "ScreenCompanion.ts")).not.toMatch(/AudioContext|new Audio\(/);
  });
});
