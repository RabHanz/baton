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
    expect(call).toHaveBeenCalledWith("sync", { peers: {} });
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

  it("keeps each server's credential encrypted, carries it, drops it when that server refuses it, and forgets it", async () => {
    const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "baton-msync-"));
    const peersFile = NodePath.join(dir, "memory-sync-peers.json");
    const calls: Array<[string, Record<string, unknown>]> = [];
    let refused: ReadonlyArray<{ environmentId: string; label: string }> = [];
    const credential = { origin: "https://box.example", token: "sync-token", expiresAt: 10_000 };
    const sync = createMemorySync({
      file: NodePath.join(dir, "baton-memory.json"),
      peersFile,
      now: () => 1_000,
      protection: () => ({
        protect: (plain) => Buffer.from(plain).toString("base64"),
        unprotect: (wrapped) => Buffer.from(wrapped, "base64").toString(),
      }),
      call: async (op, args) => {
        calls.push([op, args]);
        if (op === "syncLink") return credential;
        if (op === "syncPeers")
          return [
            { environmentId: "here", label: "Laptop", local: true },
            { environmentId: "box", label: "Server", local: false },
          ];
        return { servers: 2, applied: 0, refused };
      },
    });
    sync.setEnabled(true);
    const paired = async () => (await sync.peers()).find((p) => p.environmentId === "box");
    expect((await paired())?.paired).toBe(false);
    await sync.link("box", "CODE");
    expect(NodeFS.readFileSync(peersFile, "utf8")).not.toContain("sync-token");
    expect(await paired()).toMatchObject({ paired: true, expiresAt: 10_000 });
    await sync.run();
    expect(calls.at(-1)).toEqual(["sync", { peers: { box: credential } }]);

    // A 401 there: the credential is gone here too, and he is told which server to pair again.
    refused = [{ environmentId: "box", label: "Server" }];
    expect(await sync.run()).toContain("Server stopped accepting this computer's sync credential");
    expect((await paired())?.paired).toBe(false);

    refused = [];
    await sync.link("box", "CODE");
    sync.forget("box");
    expect((await paired())?.paired).toBe(false);
    NodeFS.rmSync(dir, { recursive: true, force: true });
  });

  it("keeps nothing unencrypted, and an expired or undecryptable credential counts as unpaired", async () => {
    const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "baton-msync-"));
    const peersFile = NodePath.join(dir, "memory-sync-peers.json");
    let encrypts = false;
    let clock = 1_000;
    const call = async (op: string) =>
      op === "syncLink"
        ? { origin: "https://box.example", token: "sync-token", expiresAt: 5_000 }
        : [{ environmentId: "box", label: "Server", local: false }];
    const sync = createMemorySync({
      file: NodePath.join(dir, "baton-memory.json"),
      peersFile,
      now: () => clock,
      protection: () =>
        encrypts
          ? { protect: (plain) => `enc:${plain}`, unprotect: (w) => w.replace(/^enc:/, "") }
          : null,
      call,
    });
    await expect(sync.link("box", "CODE")).rejects.toThrow("cannot keep the credential encrypted");
    expect(NodeFS.existsSync(peersFile)).toBe(false);

    encrypts = true;
    await sync.link("box", "CODE");
    expect((await sync.peers())[0]?.paired).toBe(true);
    clock = 6_000;
    expect((await sync.peers())[0]?.paired).toBe(false);

    clock = 1_000;
    NodeFS.writeFileSync(peersFile, JSON.stringify({ box: "garbage" }));
    expect((await sync.peers())[0]?.paired).toBe(false);
    NodeFS.rmSync(dir, { recursive: true, force: true });
  });

  it("shows the last list of servers when the window cannot be asked", async () => {
    const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "baton-msync-"));
    let open = true;
    const sync = createMemorySync({
      file: NodePath.join(dir, "baton-memory.json"),
      call: async () => {
        if (!open) throw new Error("T3's window is closed.");
        return [{ environmentId: "here", label: "Laptop", local: true }];
      },
    });
    expect(await sync.peers()).toHaveLength(1);
    open = false;
    expect(await sync.peers()).toHaveLength(1);
    NodeFS.rmSync(dir, { recursive: true, force: true });
  });
});
