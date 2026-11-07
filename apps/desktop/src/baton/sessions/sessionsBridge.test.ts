import type { BatonSessionSummary } from "@t3tools/baton-contracts";
import { expect, it, vi } from "vite-plus/test";

const ipc = vi.hoisted(() => new Map<string, (event: unknown, message: unknown) => void>());
vi.mock("electron", () => ({
  ipcMain: { on: (channel: string, handler: never) => void ipc.set(channel, handler) },
}));

import { BATON_SESSION_RESPONSE_CHANNEL, BATON_SESSIONS_SNAPSHOT_CHANNEL } from "../channels.ts";
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
            unreachable: [{ environmentId: "st", label: "Studio" }],
          }
        : { delivered: true, detail: "" };
    },
  });
  await vi.advanceTimersByTimeAsync(5_000);
  expect(bridge.rows().map((row) => row.key)).toEqual(["laptop", "box", "shared"]);
  expect(bridge.notes()).toEqual(["Studio isn't answering, so its sessions are not listed."]);

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

it("drops the window's rows as soon as the window closes and says the list is old when the server does not answer", async () => {
  using _timers = { [Symbol.dispose]: () => vi.useRealTimers() };
  vi.useFakeTimers();
  let up = true;
  const bridge = createSessionsBridge({
    ensureMainWindow: () => Promise.reject(new Error("must not open")),
    openMainWindow: () => undefined,
    onChange: () => undefined,
    mainWindowUp: async () => up,
    direct: () => Promise.reject(new Error("down")),
  });
  ipc.get(BATON_SESSIONS_SNAPSHOT_CHANNEL)?.(null, [summary("pushed", {})]);
  expect(bridge.rows().map((row) => row.key)).toEqual(["pushed"]);
  up = false;
  await vi.advanceTimersByTimeAsync(5_000);
  expect(bridge.rows()).toEqual([]);
  expect(bridge.notes()).toEqual([
    "This computer's server did not answer, so these sessions may be out of date.",
  ]);
});

it("with T3's window closed, opening a thread still goes to the window, which it brings up", async () => {
  const sent: Array<unknown> = [];
  const window = {
    webContents: {
      send: (_channel: string, message: { id: number; request: unknown }) => {
        sent.push(message.request);
        ipc.get(BATON_SESSION_RESPONSE_CHANNEL)?.(null, {
          id: message.id,
          ok: true,
          detail: "Opened.",
        });
      },
    },
  };
  const bridge = createSessionsBridge({
    ensureMainWindow: async () => window as never,
    openMainWindow: () => undefined,
    onChange: () => undefined,
    mainWindowUp: async () => false,
    direct: () => Promise.reject(new Error("not for opening")),
  });
  const open = { kind: "open", environmentId: "env-box", threadId: "t1" } as const;
  expect(await bridge.request(open)).toEqual({ ok: true, detail: "Opened." });
  expect(sent).toEqual([open]);
});
