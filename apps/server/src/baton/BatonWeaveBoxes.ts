// @effect-diagnostics nodeBuiltinImport:off
/**
 * Where a weave on this machine may reach (D149): its Herdr panes, and live sessions outside Herdr. Another machine is
 * reached through its own server over the link, never from here.
 */
import * as NodePath from "node:path";

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { ClaudeLiveSession } from "@t3tools/baton-contracts";

import { AdoptedRuntimeAdapter } from "./AdoptedSessionService.ts";
import { readAllProfileLiveSessions } from "./ClaudeLiveSessions.ts";
import { appendLiveQueue, liveQueueDir } from "./BatonLiveQueue.ts";
import {
  cliLayer,
  HerdrCli,
  parseHerdrSessionList,
  SESSION_SEPARATOR,
} from "./HerdrAdapterLive.ts";

export interface WeaveBox {
  readonly name: string;
  readonly adapter: AdoptedRuntimeAdapter["Service"];
  /** Puts a line into the named sender's own thread, when the sender is a session of this box. */
  readonly notify?: (from: string, line: string) => Effect.Effect<void>;
  /** The pane a Claude session is in now, found by its id, so a Herdr restart that renumbers panes still finds it. */
  readonly locate?: (sessionId: string) => Effect.Effect<SessionPane | null>;
}

export interface SessionPane {
  readonly pane: string;
  /** Herdr's word for the agent: idle, working, blocked (a question or approval is up), done, unknown. */
  readonly status: string;
}

/** The agent running a Claude session, from `herdr agent list`. */
export const agentOfSession = (json: string, sessionId: string): SessionPane | null => {
  try {
    const agents: unknown = (JSON.parse(json) as { result?: { agents?: unknown } })?.result?.agents;
    if (!Array.isArray(agents)) return null;
    const agent = agents.find(
      (a: { agent_session?: { value?: unknown } }) => a?.agent_session?.value === sessionId,
    ) as { pane_id?: unknown; agent_status?: unknown } | undefined;
    return typeof agent?.pane_id === "string"
      ? {
          pane: agent.pane_id,
          status: typeof agent.agent_status === "string" ? agent.agent_status : "unknown",
        }
      : null;
  } catch {
    return null;
  }
};

/** Every running Herdr session is asked, as discovery does; the pane comes back as `<session>~<pane>` off default. */
export const locateWith =
  (cli: HerdrCli["Service"]) =>
  (sessionId: string): Effect.Effect<SessionPane | null> =>
    Effect.gen(function* () {
      const listed = yield* cli.run(["session", "list"]);
      const names = listed.exitCode === 0 ? parseHerdrSessionList(listed.stdout) : [];
      for (const session of names.length === 0 ? ["default"] : names) {
        const named = session === "default" ? [] : ["--session", session];
        const out = yield* cli.run([...named, "agent", "list"]);
        const found = out.exitCode === 0 ? agentOfSession(out.stdout, sessionId) : null;
        if (found !== null)
          return named.length === 0
            ? found
            : { ...found, pane: `${session}${SESSION_SEPARATOR}${found.pane}` };
      }
      return null;
    });

export class BatonWeaveBoxes extends Context.Service<BatonWeaveBoxes, ReadonlyArray<WeaveBox>>()(
  "t3/baton/BatonWeaveBoxes",
) {}

const liveName = (s: ClaudeLiveSession): string => s.name ?? NodePath.basename(s.cwd);

/**
 * Live threads outside Herdr: a Claude Code session in a plain terminal has no pane to type into yet. A weave to one
 * is stored addressed to the session, and the server types it once the session is in a Herdr pane.
 */
export const makeLiveBox = (
  read: Effect.Effect<ReadonlyArray<ClaudeLiveSession>>,
  dir: () => string = liveQueueDir,
): WeaveBox => ({
  name: "live",
  adapter: {
    discover: Effect.map(read, (sessions) => ({
      available: true,
      reason: "",
      candidates: sessions
        .filter((s) => s.herdrPane === null)
        .map((s) => ({
          runtime: "herdr" as const,
          label: liveName(s),
          location: { workspace: "live", pane: s.sessionId, host: null },
          agentKind: "claude",
          runtimeState: s.status === "busy" ? "working" : "idle",
          state: null,
        })),
    })),
  } as unknown as AdoptedRuntimeAdapter["Service"],
  notify: (from, line) =>
    Effect.flatMap(read, (sessions) =>
      Effect.sync(() => {
        const want = from.trim().toLowerCase();
        const me = sessions.find(
          (s) => liveName(s).toLowerCase() === want || s.sessionId.startsWith(from.trim()),
        );
        if (me !== undefined && want !== "") {
          appendLiveQueue(dir(), me.sessionId, { text: line, shown: line, kind: "note" });
        }
      }),
    ),
});

export const layer = Layer.effect(
  BatonWeaveBoxes,
  Effect.gen(function* () {
    const local = yield* AdoptedRuntimeAdapter;
    const cli = yield* HerdrCli;
    return [
      { name: "here", adapter: local, locate: locateWith(cli) },
      makeLiveBox(readAllProfileLiveSessions()),
    ] as ReadonlyArray<WeaveBox>;
  }),
).pipe(Layer.provide(cliLayer));
