// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { describe, expect, it, vi } from "vite-plus/test";

import type { MemoryItem } from "@t3tools/baton-shared/memory";

import { createMemoryTab } from "./memoryTab.ts";
import type { NotesStore } from "./memoryNotes.ts";

const item = (id: string, over: Partial<MemoryItem> = {}): MemoryItem => ({
  id,
  kind: "fact",
  text: `fact ${id}`,
  source: "user",
  sourceRef: null,
  scope: "global",
  scopeRef: null,
  confidence: 1,
  pinned: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  lastUsedAt: null,
  expiresAt: null,
  supersededBy: null,
  proposed: false,
  ...over,
});

const notes = { list: () => [{ id: "n1", text: "likes tea", file: "/x" }] } as unknown as NotesStore;

const make = (call: (op: string, args: Record<string, unknown>) => Promise<unknown>) => {
  const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "baton-mtab-"));
  const refresh = vi.fn();
  const reveal = vi.fn();
  const sync = { enabled: () => false, setEnabled: vi.fn(), run: vi.fn(async () => "Synced 1 changes across 2 servers."), start: vi.fn() };
  const tab = createMemoryTab({ call, sync, notes, stateDir: dir, refresh, reveal });
  return { tab, refresh, reveal, sync, dir };
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("the Memory tab", () => {
  it("shows his notes folder until the server has answered, then the server's memory", async () => {
    const { tab } = make(async (op) => (op === "list" ? { items: [item("a")] } : { items: [] }));
    expect(tab.controls()[0]!.id).toBe("m:n1");
    await tab.load();
    expect(tab.controls().map((c) => c.id)).toEqual(["m.bar", "m:a"]);
  });

  it("falls back to the notes when the server cannot be reached", async () => {
    const { tab } = make(async () => Promise.reject(new Error("down")));
    await tab.load();
    expect(tab.controls().some((c) => c.label === "likes tea")).toBe(true);
    expect(tab.act("m:n1", null)).toBe(false);
  });

  it("edit, pin, forget and accept go to the server and the page is read again", async () => {
    const calls: Array<[string, Record<string, unknown>]> = [];
    const { tab } = make(async (op, args) => {
      calls.push([op, args]);
      return op === "list" ? { items: [item("a")] } : {};
    });
    await tab.load();
    expect(tab.act("m.edit:a", "new words")).toBe(true);
    expect(tab.act("m.pin:a", true)).toBe(true);
    expect(tab.act("m.forget:a", null)).toBe(true);
    expect(tab.act("m.accept:a", null)).toBe(true);
    await settle();
    expect(calls.filter(([op]) => op !== "list" && op !== "used" && op !== "pull")).toEqual([
      ["edit", { id: "a", text: "new words" }],
      ["pin", { id: "a", pinned: true }],
      ["forget", { id: "a" }],
      ["accept", { id: "a" }],
    ]);
  });

  it("says why the server refused an edit", async () => {
    const { tab } = make(async (op) => {
      if (op === "edit") throw new Error("that looks like a password, so I did not keep it");
      return op === "list" ? { items: [item("a")] } : {};
    });
    await tab.load();
    tab.act("m.edit:a", "my password is x");
    await settle();
    expect((tab.controls()[0] as { status: string }).status).toContain("password");
  });

  it("searches, filters, exports a file and imports a folder", async () => {
    const { tab, reveal, dir } = make(async (op) => {
      if (op === "list") return { items: [item("a"), item("b", { kind: "preference", text: "tea at four" })] };
      if (op === "export") return { markdown: "# Tessaya memory\n- [fact] fact a\n" };
      if (op === "import") return { files: 2, added: 2, refused: 0, unchanged: 0 };
      return { items: [] };
    });
    await tab.load();
    tab.act("m.kind", "preference");
    expect(tab.controls().filter((c) => c.kind === "memory").map((c) => c.id)).toEqual(["m:b"]);
    tab.act("m.kind", "all");
    tab.act("m.query", "fact a");
    expect(tab.controls().filter((c) => c.kind === "memory").map((c) => c.id)).toEqual(["m:a"]);
    tab.act("m.export", null);
    await settle();
    expect(NodeFS.readFileSync(NodePath.join(dir, "memory-export.md"), "utf8")).toContain("fact a");
    expect(reveal).toHaveBeenCalled();
    tab.act("m.import", "/some/folder");
    await settle();
    expect((tab.controls()[0] as { status: string }).status).toBe("Read 2 files: 2 added, 0 unchanged, 0 not kept.");
  });

  it("sync is switched and run from the tab", async () => {
    const { tab, sync } = make(async () => ({ items: [] }));
    tab.act("m.syncOn", true);
    expect(sync.setEnabled).toHaveBeenCalledWith(true);
    tab.act("m.sync", null);
    await settle();
    expect(sync.run).toHaveBeenCalled();
  });

  it("leaves other ids alone", () => {
    const { tab } = make(async () => ({}));
    expect(tab.act("v.enabled", true)).toBe(false);
  });
});
