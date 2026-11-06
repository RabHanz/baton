import { describe, expect, it } from "vite-plus/test";

import { weaveAcross, type WeaveReply } from "./batonWeaveAcross";

const here = { id: "e-here", label: "Laptop" };
const office = { id: "e-office", label: "office" };
const weave = (toLabel: string, createdAt: number) => ({ id: toLabel, toLabel, createdAt });

/** Each environment answers send from its own sessions, and list with its own weaves. */
const environments = (sessions: Record<string, ReadonlyArray<string>>) => {
  const calls: Array<[string, string, unknown]> = [];
  const call = async (environmentId: string, op: string, args: unknown): Promise<WeaveReply> => {
    calls.push([environmentId, op, args]);
    if (op === "list")
      return {
        ok: true,
        value: { items: environmentId === here.id ? [weave("build", 1)] : [weave("deploy", 2)] },
      };
    const to = (args as { to: string }).to;
    if (to === "secret") return { ok: false, reason: "that looks like a secret", missing: false };
    return (sessions[environmentId] ?? []).includes(to)
      ? { ok: true, value: { weave: { toLabel: to, environmentId } } }
      : { ok: false, reason: `no session is called "${to}" here now`, missing: true };
  };
  return { calls, call };
};

describe("weave across connected environments", () => {
  it("sends to this computer first, then the first other one that has the session", async () => {
    const { calls, call } = environments({ [here.id]: ["build"], [office.id]: ["deploy"] });
    const send = (to: string) =>
      weaveAcross({ kind: "weave", op: "send", args: { to, text: "hi" } }, [here, office], call);
    expect(await send("build")).toMatchObject({ weave: { environmentId: here.id } });
    expect(await send("deploy")).toMatchObject({ weave: { environmentId: office.id } });
    expect(calls.map(([id]) => id)).toEqual([here.id, here.id, office.id]);
  });

  it("names the computer to skip the search, and stops on any answer but no such session", async () => {
    const { calls, call } = environments({ [here.id]: ["build"], [office.id]: ["build"] });
    const sent = await weaveAcross(
      { kind: "weave", op: "send", args: { to: "office:build", text: "hi" } },
      [here, office],
      call,
    );
    expect(sent).toMatchObject({ weave: { environmentId: office.id } });
    expect(calls).toEqual([[office.id, "send", { to: "build", text: "hi" }]]);
    await expect(
      weaveAcross(
        { kind: "weave", op: "send", args: { to: "secret", text: "x" } },
        [here, office],
        call,
      ),
    ).rejects.toThrow("that looks like a secret");
    await expect(
      weaveAcross(
        { kind: "weave", op: "send", args: { to: "nobody", text: "x" } },
        [here, office],
        call,
      ),
    ).rejects.toThrow('no session is called "nobody"');
  });

  it("lists every environment's weaves together, newest first, naming another computer's sessions", async () => {
    const { call } = environments({});
    expect(
      await weaveAcross({ kind: "weave", op: "list", args: { limit: 10 } }, [here, office], call),
    ).toEqual({ items: [{ ...weave("deploy", 2), toLabel: "office:deploy" }, weave("build", 1)] });
  });
});
