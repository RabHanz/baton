/**
 * Weave across the computers this window is connected to (his own machines): a name is looked up in every one's
 * sessions together, exact first, and a name that fits sessions on two computers is refused, never guessed. Each
 * environment's own server types into its own panes, so no machine reaches another over ssh.
 */
import type { BatonFleet, BatonWeave, BatonWeaveBridgeRequest } from "@t3tools/baton-contracts";

/** The names weave knows a computer's sessions by: its Herdr panes, and Claude sessions outside Herdr. */
export const weaveSessionsOf = (fleet: BatonFleet | null): ReadonlyArray<string> | null =>
  fleet === null
    ? null
    : [
        ...(fleet.herdr ?? []).map((pane) => pane.label),
        ...(fleet.claudeSessions ?? [])
          .filter((session) => session.herdrPane === null)
          .map((session) => session.name ?? session.cwd.split(/[\\/]/).at(-1) ?? session.cwd),
      ];

export type WeaveReply =
  | { readonly ok: true; readonly value: unknown }
  | {
      readonly ok: false;
      readonly reason: string;
      /** "missing": no session by that name there. "unreachable": refused before anything was sent (not permitted). */
      readonly kind: "missing" | "unreachable" | "other";
    };

export interface WeaveEnvironment {
  readonly id: string;
  readonly label: string;
  /** The session names it shows now; null while it is not connected. */
  readonly sessions: ReadonlyArray<string> | null;
}

interface Found {
  readonly environment: WeaveEnvironment;
  readonly name: string;
}

/** Exact names first, then a part of exactly one; more than one is said, with the computers, so he can name one. */
const choose = (
  to: string,
  environments: ReadonlyArray<WeaveEnvironment>,
): { readonly found: Found } | { readonly why: string } | null => {
  const want = to.trim().toLowerCase();
  const all = environments.flatMap((environment) =>
    (environment.sessions ?? []).map((name) => ({ environment, name })),
  );
  const exact = all.filter((f) => f.name.toLowerCase() === want);
  const fits = exact.length > 0 ? exact : all.filter((f) => f.name.toLowerCase().includes(want));
  if (fits.length === 1) return { found: fits[0]! };
  if (fits.length === 0) return null;
  return {
    why: `"${to}" fits more than one session (${fits
      .slice(0, 5)
      .map((f) => `${f.environment.label}:${f.name}`)
      .join(", ")}); say which`,
  };
};

const named = (
  environment: WeaveEnvironment,
  first: WeaveEnvironment | undefined,
  value: unknown,
) => {
  const weave = (value as { weave?: BatonWeave }).weave;
  return environment.id === first?.id || weave === undefined
    ? value
    : {
        ...(value as object),
        weave: { ...weave, toLabel: `${environment.label}:${weave.toLabel}` },
      };
};

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
  const connected = environments.filter((e) => e.sessions !== null);
  const first = environments[0];
  if (request.op === "send") {
    const to = String((request.args as { to?: unknown }).to ?? "");
    // "office:build" names the computer, as weave_list shows a session on another one.
    const prefixed = connected.find((e) =>
      to.toLowerCase().startsWith(`${e.label.toLowerCase()}:`),
    );
    const chosen =
      prefixed !== undefined
        ? { found: { environment: prefixed, name: to.slice(prefixed.label.length + 1) } }
        : choose(to, connected);
    if (chosen !== null && "why" in chosen) throw new Error(chosen.why);
    // Not in any list yet (a session that started a moment ago): each computer is asked in turn.
    const targets =
      chosen === null
        ? connected.map((environment) => ({ environment, name: to }))
        : [chosen.found];
    let missing: string | null = null;
    for (const { environment, name } of targets) {
      const reply = await call(environment.id, "send", { ...request.args, to: name });
      if (reply.ok) return named(environment, first, reply.value);
      // A computer that refused before sending is skipped; anything else, a timeout included, may have been typed.
      if (reply.kind === "other") throw new Error(reply.reason);
      if (reply.kind === "missing") missing ??= reply.reason;
    }
    throw new Error(missing ?? "No connected computer has that session. Nothing was sent.");
  }
  const replies = await Promise.all(
    connected.map(async (environment) => ({
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
    const firstReply = replies[0]?.reply;
    throw new Error(
      firstReply !== undefined && !firstReply.ok ? firstReply.reason : "Weaving did not answer.",
    );
  }
  const items = answered
    .flatMap(({ environment, reply }) =>
      ((reply as { value: { items?: ReadonlyArray<BatonWeave> } }).value.items ?? []).map((w) =>
        // A session on another computer is named with that computer.
        environment.id === first?.id ? w : { ...w, toLabel: `${environment.label}:${w.toLabel}` },
      ),
    )
    .toSorted((a, b) => b.createdAt - a.createdAt);
  const limit = (request.args as { limit?: unknown }).limit;
  return { items: typeof limit === "number" ? items.slice(0, limit) : items };
};
