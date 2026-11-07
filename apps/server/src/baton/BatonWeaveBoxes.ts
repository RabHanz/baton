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

export interface WeaveBox {
  readonly name: string;
  readonly adapter: AdoptedRuntimeAdapter["Service"];
  /** A box with no pane to read: sending hands the text to the session's own queue, which types it later. */
  readonly queueOnly?: boolean;
  /** Puts a line into the named sender's own thread, when the sender is a session of this box. */
  readonly notify?: (from: string, line: string) => Effect.Effect<void>;
}

export class BatonWeaveBoxes extends Context.Service<BatonWeaveBoxes, ReadonlyArray<WeaveBox>>()(
  "t3/baton/BatonWeaveBoxes",
) {}

const liveName = (s: ClaudeLiveSession): string => s.name ?? NodePath.basename(s.cwd);

/**
 * Live threads outside Herdr: a Claude Code session in a plain terminal has no pane to type into.
 * A weave to one is written into the queue that baton-live-acp drains (it types the text once the
 * session is moved into Herdr, and says so in that thread).
 */
export const makeLiveBox = (
  read: Effect.Effect<ReadonlyArray<ClaudeLiveSession>>,
  dir: () => string = liveQueueDir,
): WeaveBox => ({
  name: "live",
  queueOnly: true,
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
    readOutput: () => Effect.succeed({ available: false, detail: "no pane", output: "" }),
    sendInput: ({ session, text }: { session: { location: { pane: string } }; text: string }) =>
      Effect.sync(() => {
        const n = appendLiveQueue(dir(), session.location.pane, {
          text,
          shown: text.slice(0, 200),
        });
        return {
          delivered: true,
          detail: `queued (${n} waiting); typed when the session is in a Herdr pane`,
        };
      }),
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
    return [
      { name: "here", adapter: local },
      makeLiveBox(readAllProfileLiveSessions()),
    ] as ReadonlyArray<WeaveBox>;
  }),
);
