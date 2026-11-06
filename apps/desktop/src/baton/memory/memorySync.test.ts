// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { describe, expect, it, vi } from "vite-plus/test";

import { createMemorySync } from "./memorySync.ts";

describe("memory sync", () => {
  it("is off until he turns it on, and then asks the window to carry", async () => {
    const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "baton-msync-"));
    const call = vi.fn(async () => ({ servers: 2, applied: 3 }));
    const sync = createMemorySync({ file: NodePath.join(dir, "baton-memory.json"), call });
    expect(await sync.run()).toBe("Memory sync is off.");
    expect(call).not.toHaveBeenCalled();
    sync.setEnabled(true);
    expect(await sync.run()).toBe("Synced 3 changes across 2 servers.");
    expect(call).toHaveBeenCalledWith("sync", { tokens: {} });
    NodeFS.rmSync(dir, { recursive: true, force: true });
  });

  it("says so when only one server syncs or the window fails", async () => {
    const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "baton-msync-"));
    const file = NodePath.join(dir, "baton-memory.json");
    let out: unknown = { servers: 1, applied: 0 };
    const sync = createMemorySync({ file, call: async () => out });
    sync.setEnabled(true);
    expect(await sync.run()).toContain("nothing to carry");
    out = null;
    const failing = createMemorySync({
      file,
      call: async () => Promise.reject(new Error("Memory did not answer.")),
    });
    expect(await failing.run()).toBe("Memory did not answer.");
    NodeFS.rmSync(dir, { recursive: true, force: true });
  });

  it("keeps each server's sync credential wrapped, carries it, shows who is paired, and forgets it", async () => {
    const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "baton-msync-"));
    const peersFile = NodePath.join(dir, "memory-sync-peers.json");
    const calls: Array<[string, Record<string, unknown>]> = [];
    const sync = createMemorySync({
      file: NodePath.join(dir, "baton-memory.json"),
      peersFile,
      protect: (plain) => `wrapped:${plain}`,
      unprotect: (wrapped) => wrapped.replace(/^wrapped:/, ""),
      call: async (op, args) => {
        calls.push([op, args]);
        if (op === "syncLink") return { token: "sync-token" };
        if (op === "syncPeers")
          return [
            { environmentId: "here", label: "Laptop", local: true },
            { environmentId: "box", label: "Server", local: false },
          ];
        return { servers: 2, applied: 0 };
      },
    });
    sync.setEnabled(true);
    expect((await sync.peers()).map((p) => [p.environmentId, p.paired])).toEqual([
      ["here", true],
      ["box", false],
    ]);
    await sync.link("box", "CODE");
    expect(NodeFS.readFileSync(peersFile, "utf8")).not.toContain('"sync-token"');
    expect((await sync.peers()).find((p) => p.environmentId === "box")?.paired).toBe(true);
    await sync.run();
    expect(calls.at(-1)).toEqual(["sync", { tokens: { box: "sync-token" } }]);
    sync.forget("box");
    expect((await sync.peers()).find((p) => p.environmentId === "box")?.paired).toBe(false);
    NodeFS.rmSync(dir, { recursive: true, force: true });
  });
});
