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
    expect(call).toHaveBeenCalledWith("sync", {});
    NodeFS.rmSync(dir, { recursive: true, force: true });
  });

  it("says so when only one server is connected or the window fails", async () => {
    const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "baton-msync-"));
    const file = NodePath.join(dir, "baton-memory.json");
    let out: unknown = { servers: 1, applied: 0 };
    const sync = createMemorySync({ file, call: async () => out });
    sync.setEnabled(true);
    expect(await sync.run()).toContain("nothing to sync");
    out = null;
    const failing = createMemorySync({ file, call: async () => Promise.reject(new Error("Memory did not answer.")) });
    expect(await failing.run()).toBe("Memory did not answer.");
    NodeFS.rmSync(dir, { recursive: true, force: true });
  });
});
