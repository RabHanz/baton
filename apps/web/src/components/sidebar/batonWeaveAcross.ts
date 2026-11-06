/**
 * Weave across every environment this window is connected to: a message goes to the first one that has a session by
 * that name, this computer first, and the list is all of theirs together. Each environment's own server types into
 * its own panes, so no machine reaches another over ssh.
 */
import type { BatonWeave, BatonWeaveBridgeRequest } from "@t3tools/baton-contracts";

export type WeaveReply =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly reason: string; readonly missing: boolean };

export interface WeaveEnvironment {
  readonly id: string;
  readonly label: string;
}

export const weaveAcross = async (
  request: BatonWeaveBridgeRequest,
  /** This computer first. */
  environments: ReadonlyArray<WeaveEnvironment>,
  call: (
    environmentId: string,
    op: BatonWeaveBridgeRequest["op"],
    args: unknown,
  ) => Promise<WeaveReply>,
): Promise<unknown> => {
  if (request.op === "send") {
    // "office:build" names the computer, as weave_list shows a session on another one.
    const to = String((request.args as { to?: unknown }).to ?? "");
    const named = environments.find((e) =>
      to.toLowerCase().startsWith(`${e.label.toLowerCase()}:`),
    );
    const targets =
      named === undefined
        ? environments.map((environment) => ({ environment, args: request.args }))
        : [{ environment: named, args: { ...request.args, to: to.slice(named.label.length + 1) } }];
    let missing: string | null = null;
    for (const { environment, args } of targets) {
      const reply = await call(environment.id, "send", args);
      if (reply.ok) return reply.value;
      // Only "no such session here" moves on; anything else (a secret, a name that fits two) is the answer.
      if (!reply.missing) throw new Error(reply.reason);
      missing ??= reply.reason;
    }
    throw new Error(missing ?? "Weaving did not answer. Nothing was sent.");
  }
  const replies = await Promise.all(
    environments.map(async (environment) => ({
      environment,
      reply: await call(environment.id, request.op, request.args),
    })),
  );
  if (request.op === "tick") {
    let delivered = 0;
    let replied = 0;
    for (const { reply } of replies) {
      if (!reply.ok) continue;
      const counts = reply.value as { delivered?: number; replied?: number };
      delivered += counts.delivered ?? 0;
      replied += counts.replied ?? 0;
    }
    return { delivered, replied };
  }
  const answered = replies.filter((r) => r.reply.ok);
  if (answered.length === 0) {
    const first = replies[0]?.reply;
    throw new Error(first !== undefined && !first.ok ? first.reason : "Weaving did not answer.");
  }
  const items = answered
    .flatMap(({ environment, reply }) =>
      ((reply as { value: { items?: ReadonlyArray<BatonWeave> } }).value.items ?? []).map((w) =>
        // A session on another computer is named with that computer, as the ssh boxes did.
        environment.id === environments[0]?.id
          ? w
          : { ...w, toLabel: `${environment.label}:${w.toLabel}` },
      ),
    )
    .toSorted((a, b) => b.createdAt - a.createdAt);
  const limit = (request.args as { limit?: unknown }).limit;
  return { items: typeof limit === "number" ? items.slice(0, limit) : items };
};
