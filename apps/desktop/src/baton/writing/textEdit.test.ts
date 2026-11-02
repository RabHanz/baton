import { DEFAULT_TRANSFORMS } from "@t3tools/baton-shared/transforms";
import { describe, expect, it } from "vite-plus/test";

import { tabOf } from "../home/tabs.ts";
import { hotkeyFor, transformAction, transformControls } from "./transformRows.ts";
import { createTextEdit, type EditPorts } from "./textEdit.ts";

const rig = (selection: string | null, reply: string | Error) => {
  const log: string[] = [];
  const ports: EditPorts = {
    copySelection: async () => selection,
    replaceSelection: async (t) => void log.push(`paste ${t}`),
    press: async (k) => void log.push(`press ${k.join("+")}`),
    setClipboard: (t) => void log.push(`clip ${t}`),
    ask: async () => {
      if (reply instanceof Error) throw reply;
      return reply;
    },
    now: () => 0,
  };
  return { edit: createTextEdit(ports), log };
};
const polish = DEFAULT_TRANSFORMS[0]!;

describe("editing the selection", () => {
  it("replaces the selection with the rewrite and can take it back", async () => {
    const { edit, log } = rig("ths is bad", "This is bad.");
    expect(await edit.transform(polish)).toContain("Polish applied.");
    expect(log).toEqual(["paste This is bad."]);
    expect(await edit.undo()).toContain("Undone");
    expect(log.slice(1)).toEqual(["press ctrl+z", "clip ths is bad"]);
    expect(await edit.undo()).toBe("There is nothing to undo.");
  });
  it("changes nothing when nothing is selected, the model fails, or the answer is not usable", async () => {
    expect(await rig(null, "x").edit.transform(polish)).toBe("Nothing is selected.");
    const failing = rig("some words", new Error("boom"));
    expect(await failing.edit.transform(polish)).toContain("nothing changed");
    const chatty = rig("some words", "Sure! Here is the text:\nSome words.");
    expect(await chatty.edit.transform(polish)).toContain("Nothing changed");
    expect(chatty.log).toEqual([]);
  });
  it("hands the rewrite of a text it already has back without touching the app", async () => {
    const { edit, log } = rig(null, "Better.");
    expect(await edit.transformText(polish, "good enough")).toBe("Better.");
    expect(log).toEqual([]);
  });
});

describe("the Transforms area", () => {
  it("is on the Transforms tab with the built-ins and a hotkey each, off by default", () => {
    const rows = transformControls(
      { enabled: false, autoApply: null, custom: [] },
      DEFAULT_TRANSFORMS,
      "",
    );
    for (const r of rows) expect(tabOf(r.id)).toBe("transforms");
    expect(rows.find((r) => r.id === "tr.enabled")).toMatchObject({ kind: "toggle", on: false });
    expect(rows.find((r) => r.id === "tr.key:polish")).toMatchObject({
      label: "Polish: Control+Alt+Shift+1",
    });
    expect(hotkeyFor(9)).toBeNull();
  });
  it("turns rows into actions", () => {
    expect(transformAction("tr.enabled", true)).toEqual({ kind: "enabled", on: true });
    expect(transformAction("tr.auto", "none")).toEqual({ kind: "auto", id: null });
    expect(transformAction("tr.list:add", "Formal = make it formal")).toMatchObject({
      kind: "put",
    });
    expect(transformAction("tr.list:add", "junk")).toEqual({ kind: "bad" });
    expect(transformAction("tr.list:rm", "Formal = make it formal")).toEqual({
      kind: "remove",
      id: "formal",
    });
  });
});
