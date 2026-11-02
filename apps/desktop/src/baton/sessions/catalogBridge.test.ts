import { describe, expect, it } from "vite-plus/test";

import { createBridgeCatalogService, reasonOf, rowsFromAnswer } from "./catalogBridge.ts";
import type { SessionsBridge } from "./sessionsBridge.ts";

const row = {
  id: "abc",
  environmentId: "e1",
  machine: "Laptop",
  project: "app",
  cwd: "/w/app",
  title: "T",
  lastActivityAt: null,
  account: null,
  state: "stopped",
  source: "transcript",
  canResume: true,
  detail: null,
};

describe("the real catalog service", () => {
  it("shows the server's own reason when a new session cannot start", async () => {
    expect(
      reasonOf(JSON.stringify({ state: "failed", detail: "The folder X is not on this machine." })),
    ).toBe("The folder X is not on this machine.");
    const service = createBridgeCatalogService({
      bridge: {
        request: async () => ({
          ok: false,
          detail: JSON.stringify({ detail: "Claude Code is not installed here." }),
        }),
      } as unknown as SessionsBridge,
      openMainWindow: () => undefined,
    });
    await expect(service.create({ environmentId: "e1", cwd: "D:\\x" })).rejects.toThrow(
      "Claude Code is not installed here.",
    );
  });

  it("opens the thread a machine without Herdr made for the resumed session", async () => {
    const sent: unknown[] = [];
    const answers = [
      {
        ok: true,
        detail: JSON.stringify({
          state: "running",
          pane: null,
          threadId: "import:claudeAgent:abc",
        }),
      },
    ];
    const bridge = {
      request: async (r: unknown) => (sent.push(r), answers.shift() ?? null),
    } as unknown as SessionsBridge;
    const service = createBridgeCatalogService({
      bridge,
      openMainWindow: () => undefined,
      wait: async () => undefined,
    });
    const [stopped] = rowsFromAnswer(JSON.stringify([row]));
    await service.resume(stopped!);
    service.open(stopped!);
    expect(sent.at(-1)).toEqual({
      kind: "open",
      environmentId: "e1",
      threadId: "import:claudeAgent:abc",
    });
  });

  it("reads rows from the sidebar's answer and drops malformed ones", () => {
    const rows = rowsFromAnswer(
      JSON.stringify([
        row,
        { id: 5 },
        { ...row, id: "x", state: "bogus" },
        { ...row, id: "h", source: "history" },
      ]),
    );
    expect(rows.map((r) => [r.id, r.source])).toEqual([
      ["e1:abc", "thread"],
      ["e1:h", "history"],
    ]);
    expect(rowsFromAnswer("not json")).toEqual([]);
  });

  it("waits for a resume the server says is still coming back, and fails with a reason otherwise", async () => {
    const answers: Array<{ ok: boolean; detail: string } | null> = [
      { ok: true, detail: JSON.stringify({ state: "resuming" }) },
      { ok: true, detail: JSON.stringify([{ ...row, state: "running" }]) },
    ];
    const bridge = { request: async () => answers.shift() ?? null } as unknown as SessionsBridge;
    const service = createBridgeCatalogService({
      bridge,
      openMainWindow: () => undefined,
      wait: async () => undefined,
    });
    const [stopped] = rowsFromAnswer(JSON.stringify([row]));
    await expect(service.resume(stopped!)).resolves.toBeUndefined();
    const failing = createBridgeCatalogService({
      bridge: { request: async () => ({ ok: false, detail: "{}" }) } as unknown as SessionsBridge,
      openMainWindow: () => undefined,
    });
    await expect(failing.resume(stopped!)).rejects.toThrow();
  });
});
