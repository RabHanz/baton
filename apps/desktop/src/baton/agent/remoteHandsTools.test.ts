// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { REMOTE_HANDS_TOOLS } from "@t3tools/baton-shared/remoteHands";
import { describe, expect, it } from "vite-plus/test";

import { buildRemoteHandsTools, type RemoteHandsDeps } from "./remoteHandsTools.ts";

const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "hands-"));
const make = (
  over: Partial<RemoteHandsDeps["sidecar"]> = {},
  foreground?: RemoteHandsDeps["foreground"],
) => {
  const stopped: number[] = [];
  const deps: RemoteHandsDeps = {
    sidecar: {
      locate: async (i) => ({
        found: true,
        name: i.label,
        x: 5,
        y: 6,
        ...(i.invoke ? { invoked: "invoke" } : {}),
      }),
      uiTree: async () => ({ window: "Notepad", controls: ["button: Save"] }),
      captureWindow: async () => ({}),
      ...over,
    },
    scratchDir: dir,
    ...(foreground === undefined ? {} : { foreground }),
    ops: {
      version: () => "1.2.3",
      logs: { main: NodePath.join(dir, "main.log") },
      processes: async () => [{ name: "notepad.exe", pid: 4242 }],
      stop: async (pid) => void stopped.push(pid),
      update: async (v) => `updating to ${v}`,
      pages: ["settings", "home"],
      openPage: async (p) => `opened ${p}`,
    },
    newId: (() => {
      let n = 0;
      return () => `p${(n += 1)}`;
    })(),
  };
  const tools = new Map(buildRemoteHandsTools(deps).map((t) => [t.name, t]));
  return { tools, stopped };
};

describe("remote hands tools", () => {
  it("offers exactly the allowlist and no raw-coordinate tool", () => {
    const { tools } = make();
    expect(new Set(tools.keys())).toEqual(new Set(REMOTE_HANDS_TOOLS));
  });

  it("acts through a control's pattern with no pointer, and refuses a pointer click without the foreground", async () => {
    const { tools } = make();
    expect(
      (await tools.get("click_element")!.run({ label: "Save", window: "Notepad", why: "w" })).text,
    ).toContain("no pointer");
    const bare = make({ locate: async (i) => ({ found: true, name: i.label, x: 5, y: 6 }) });
    await expect(bare.tools.get("click_element")!.run({ label: "Save", why: "w" })).rejects.toThrow(
      "pointer clicks are not allowed",
    );
  });

  it("falls back to a pointer click only through the foreground deps, with focus restored", async () => {
    const log: string[] = [];
    const { tools } = make(
      { locate: async (i) => ({ found: true, name: i.label, x: 5, y: 6 }) },
      {
        clickAt: async (to) => void log.push(`click ${to.x},${to.y}`),
        type: async () => {},
        press: async () => {},
        restoreFocus: async (run) => (
          log.push("save focus"),
          await run().finally(() => log.push("restore focus"))
        ),
      },
    );
    await tools.get("click_element")!.run({ label: "Save", why: "w" });
    expect(log).toEqual(["save focus", "click 5,6", "restore focus"]);
  });

  it("stops only a process id process_list returned, and reads only named logs", async () => {
    const { tools, stopped } = make();
    await expect(tools.get("process_stop")!.run({ id: "p1" })).rejects.toThrow(
      "not an id process_list returned",
    );
    expect((await tools.get("process_list")!.run({})).text).toBe("p1: notepad.exe");
    await tools.get("process_stop")!.run({ id: "p1" });
    expect(stopped).toEqual([4242]);
    NodeFS.writeFileSync(NodePath.join(dir, "main.log"), "a\nb\nc\n");
    expect((await tools.get("log_tail")!.run({ name: "main", lines: 2 })).text).toBe("b\nc");
    await expect(tools.get("log_tail")!.run({ name: "../etc/passwd" })).rejects.toThrow(
      "No log is named",
    );
  });

  it("runs a batch on a named window and stops when its title changes", async () => {
    const titles = ["Notepad", "Save As"];
    const { tools } = make({
      uiTree: async () => ({ window: titles.shift() ?? "Save As", controls: [] }),
    });
    const out = await tools.get("act_batch")!.run({
      steps: [
        { tool: "click_element", args: { label: "A", window: "Notepad", why: "w" } },
        { tool: "click_element", args: { label: "B", window: "Notepad", why: "w" } },
      ],
    });
    expect(out.text).toContain("Stopped before step 2");
  });
});
