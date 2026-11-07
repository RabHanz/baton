import type { BatonSessionSummary } from "@t3tools/baton-contracts";
import { expect, it, vi } from "vite-plus/test";

vi.mock("electron", () => ({ ipcMain: { on: () => undefined } }));

import { createSessionsBridge } from "./sessionsBridge.ts";

const summary = (key: string, over: Partial<BatonSessionSummary>): BatonSessionSummary => ({
  key,
  project: "Storefront",
  session: key,
  account: null,
  state: "idle",
  urgent: false,
  box: key,
  updatedAt: null,
  thread: null,
  pane: null,
  ...over,
});

it("with T3's window closed, lists from this machine's server and types only into its own panes, never opening the window", async () => {
  using _timers = { [Symbol.dispose]: () => vi.useRealTimers() };
  vi.useFakeTimers();
  const calls: Array<{ method: string; input: unknown }> = [];
  const ensureMainWindow = vi.fn(() => Promise.reject(new Error("must not open")));
  const bridge = createSessionsBridge({
    ensureMainWindow,
    openMainWindow: () => undefined,
    onChange: () => undefined,
    mainWindowUp: async () => false,
    direct: async (method, input) => {
      calls.push({ method, input });
      return method === "baton.sessions.across"
        ? {
            here: { environmentId: "here", label: "laptop" },
            sessions: [
              summary("laptop", { access: null, pane: { environmentId: "here", pane: "s~1" } }),
              summary("box", {
                access: "full-access",
                pane: { environmentId: "box", pane: "s~2" },
              }),
              summary("shared", {
                access: "read-only",
                pane: { environmentId: "ro", pane: "s~3" },
              }),
            ],
            unreachable: [],
          }
        : { delivered: true, detail: "" };
    },
  });
  await vi.advanceTimersByTimeAsync(5_000);
  expect(bridge.rows().map((row) => row.key)).toEqual(["laptop", "box", "shared"]);

  expect(await bridge.act("n:laptop", "go on")).toBe("Sent.");
  expect(calls.at(-1)).toEqual({
    method: "baton.live.herdrSend",
    input: { pane: "s~1", text: "go on" },
  });
  expect(await bridge.act("n:box", "go on")).toContain("Open T3 to send to box");
  expect(await bridge.act("n:shared", "go on")).toBe(
    "shared is linked read-only, so nothing can be sent to it.",
  );
  expect(calls.filter((call) => call.method === "baton.live.herdrSend")).toHaveLength(1);
  expect(ensureMainWindow).not.toHaveBeenCalled();
});
