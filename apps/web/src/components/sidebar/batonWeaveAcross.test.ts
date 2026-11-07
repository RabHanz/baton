import { describe, expect, it } from "vite-plus/test";

import {
  weaveAcross,
  weaveSessionsOf,
  type WeaveEnvironment,
  type WeaveReply,
} from "./batonWeaveAcross";

const weave = (toLabel: string, createdAt: number) => ({ id: toLabel, toLabel, createdAt });

/** Each environment answers a send from its own sessions, unless told to fail, and a list with its own weaves. */
const machines = (fail: Record<string, WeaveReply> = {}) => {
  const calls: Array<[string, string, unknown]> = [];
  const call = async (environmentId: string, op: string, args: unknown): Promise<WeaveReply> => {
    calls.push([environmentId, op, args]);
    if (op === "list")
      return {
        ok: true,
        value: { items: environmentId === "e-here" ? [weave("build", 1)] : [weave("deploy", 2)] },
      };
    const failed = fail[environmentId];
    if (failed !== undefined) return failed;
    const to = (args as { to: string }).to;
    return { ok: true, value: { weave: { toLabel: to, environmentId } } };
  };
  return { calls, call };
};
const env = (
  id: string,
  label: string,
  sessions: ReadonlyArray<string> | null,
): WeaveEnvironment => ({
  id,
  label,
  sessions,
});
const send = (
  to: string,
  environments: ReadonlyArray<WeaveEnvironment>,
  call: Parameters<typeof weaveAcross>[2],
) => weaveAcross({ kind: "weave", op: "send", args: { to, text: "hi" } }, environments, call);

describe("weave across his connected computers", () => {
  it("picks an exact name on any computer before a part of one here, and names that computer", async () => {
    const { calls, call } = machines();
    const here = env("e-here", "Laptop", ["build-ci"]);
    const office = env("e-office", "office", ["build"]);
    expect(await send("build", [here, office], call)).toEqual({
      weave: { toLabel: "office:build", environmentId: "e-office" },
    });
    expect(calls).toEqual([["e-office", "send", { to: "build", text: "hi" }]]);
  });

  it("refuses a name that fits sessions on two computers, saying which, and sends nothing", async () => {
    const { calls, call } = machines();
    await expect(
      send(
        "build",
        [env("e-here", "Laptop", ["build"]), env("e-office", "office", ["build"])],
        call,
      ),
    ).rejects.toThrow('"build" fits more than one session (Laptop:build, office:build); say which');
    expect(calls).toEqual([]);
  });

  it("goes straight to a named computer, as weave_list shows its sessions", async () => {
    const { calls, call } = machines();
    await send(
      "office:build",
      [env("e-here", "Laptop", ["build"]), env("e-office", "office", ["build"])],
      call,
    );
    expect(calls).toEqual([["e-office", "send", { to: "build", text: "hi" }]]);
  });

  it("skips a computer that is not connected or not permitted, and stops on a timeout", async () => {
    // Not in any list yet: each connected computer is asked in turn.
    const refused = machines({
      "e-here": { ok: false, reason: "not permitted", kind: "unreachable" },
    });
    expect(
      await send(
        "new-one",
        [env("e-here", "Laptop", []), env("e-gone", "attic", null), env("e-office", "office", [])],
        refused.call,
      ),
    ).toMatchObject({ weave: { environmentId: "e-office" } });
    expect(refused.calls.map(([id]) => id)).toEqual(["e-here", "e-office"]);
    const timedOut = machines({ "e-here": { ok: false, reason: "timed out", kind: "other" } });
    await expect(
      send("new-one", [env("e-here", "Laptop", []), env("e-office", "office", [])], timedOut.call),
    ).rejects.toThrow("timed out");
    expect(timedOut.calls.map(([id]) => id)).toEqual(["e-here"]);
  });

  it("lists every connected computer's weaves together, newest first, naming another computer's sessions", async () => {
    const { call } = machines();
    expect(
      await weaveAcross(
        { kind: "weave", op: "list", args: { limit: 10 } },
        [env("e-here", "Laptop", []), env("e-office", "office", [])],
        call,
      ),
    ).toEqual({ items: [{ ...weave("deploy", 2), toLabel: "office:deploy" }, weave("build", 1)] });
  });

  it("knows a computer's sessions by their Herdr panes and Claude sessions outside Herdr", () => {
    expect(weaveSessionsOf(null)).toBeNull();
    expect(
      weaveSessionsOf({
        entries: [],
        herdr: [{ label: "build" }],
        claudeSessions: [
          { name: "notes", herdrPane: null, cwd: "/w/notes" },
          { name: null, herdrPane: null, cwd: "/w/shop" },
          { name: "in-herdr", herdrPane: "p1", cwd: "/w/x" },
        ],
        observedAt: "2026-11-07T00:00:00.000Z",
      } as never),
    ).toEqual(["build", "notes", "shop"]);
  });
});
