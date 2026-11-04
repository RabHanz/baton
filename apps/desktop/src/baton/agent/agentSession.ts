// @effect-diagnostics globalDate:off
/**
 * The one assistant's session (D143): one long-lived agent, kept warm, that holds the whole
 * conversation. It starts before he speaks, is seeded from the conversation file when it starts or
 * is recycled, and puts every turn back into that file. A new session loses nothing.
 */
import { RECENT_TURNS, conversationBlock } from "@t3tools/baton-shared/conversation";

import type { ConversationLog } from "../conversation/conversationLog.ts";
import { SessionClosed, type VisionSession } from "../screen/claudeVision.ts";
import { agentSystemPrompt, contextLine } from "./agentPrompt.ts";

/** About this many turns, and the session is replaced and re-seeded; a long one gets slow and costly. */
export const RECYCLE_TURNS = 40;
export const RECYCLE_IDLE_MS = 6 * 60 * 60_000;

export const shouldRecycle = (state: {
  readonly alive: boolean;
  readonly turns: number;
  readonly idleMs: number;
}): boolean => !state.alive || state.turns >= RECYCLE_TURNS || state.idleMs >= RECYCLE_IDLE_MS;

export interface AssistantAgent {
  /** Start the session now, so the first sentence does not wait for it. */
  readonly warm: () => void;
  /** What he said, with where he is; the reply streams to `onDelta` as it is written. */
  readonly say: (
    text: string,
    where: { readonly window: string | null; readonly session: string | null },
    onDelta?: (delta: string) => void,
  ) => Promise<string>;
  readonly dispose: () => void;
}

export const createAssistantAgent = (input: {
  /** Starts the model session with this system prompt. */
  readonly start: (systemPrompt: string) => Promise<VisionSession>;
  readonly conversation: ConversationLog;
  readonly now?: () => number;
  readonly clockLine: () => string;
  /** His notes and standing memory as a prompt block, read fresh when a session starts. */
  readonly notes?: () => string | Promise<string>;
  /** Memory that matches this sentence (D150): a block for the turn, empty when none. Bounded by the caller. */
  readonly recall?: (text: string) => Promise<string>;
  /** After a turn: what he said and what came back, for the learning loop. Never awaited. */
  readonly learn?: (said: string, reply: string) => void;
  /** Called at the start of a turn: a new sentence has not read anything yet. */
  readonly beginTurn: () => void;
  /** His state right now (awareness), empty when he has turned it all off. */
  readonly presence?: () => Promise<string>;
}): AssistantAgent => {
  const now = input.now ?? Date.now;
  let session: Promise<VisionSession> | null = null;
  let turns = 0;
  let lastAt = now();
  // The newest conversation turn this session has in view, and the turns it wrote itself.
  let seenId = 0;
  let own = new Set<number>();
  // One sentence at a time, so a second one never resets the running turn's state (taint, tools).
  let queue: Promise<unknown> = Promise.resolve();

  const ensure = async (): Promise<VisionSession> => {
    if (session !== null) {
      const current = await session.catch(() => null);
      if (
        current !== null &&
        !shouldRecycle({ alive: current.alive(), turns, idleMs: now() - lastAt })
      ) {
        return current;
      }
      current?.dispose();
      session = null;
    }
    turns = 0;
    // A new session gets as much as the old one held: the latest turns in full, the rest clipped.
    const window = input.conversation.recent(RECYCLE_TURNS);
    seenId = window.at(-1)?.id ?? 0;
    own = new Set();
    // Assigned before any await, so a second caller finds this session instead of starting another.
    session = Promise.resolve(input.notes?.() ?? "")
      .catch(() => "")
      .then((notes) =>
        input.start(
          agentSystemPrompt({
            recent: window.slice(-RECENT_TURNS),
            earlier: window.slice(0, -RECENT_TURNS),
            notes,
          }),
        ),
      );
    return session;
  };

  const turn = async (
    text: string,
    where: { readonly window: string | null; readonly session: string | null },
    onDelta?: (delta: string) => void,
  ): Promise<string> => {
    input.beginTurn();
    const agent = await ensure();
    // Turns answered without it (a refusal, the older router) since it last looked.
    const meanwhile = input.conversation
      .recent(RECYCLE_TURNS)
      .filter((t) => t.id > seenId && !own.has(t.id));
    seenId = meanwhile.at(-1)?.id ?? seenId;
    const target = input.conversation.target();
    const header = contextLine({
      now: input.clockLine(),
      window: where.window,
      session: where.session,
      target: target?.label ?? null,
      presence: (await input.presence?.().catch(() => "")) ?? "",
    });
    const remembered = (await input.recall?.(text).catch(() => "")) ?? "";
    const missed =
      meanwhile.length === 0
        ? ""
        : `said and answered outside this chat since your last reply:\n${conversationBlock({ recent: meanwhile, earlier: [] })}`;
    const record = (reply: string, note?: string) =>
      own.add(
        input.conversation.add({
          route: "answer",
          said: text,
          reply,
          ...(note === undefined ? {} : { note }),
          ...(where.window === null ? {} : { target: { label: where.window } }),
        }).id,
      );
    let partial = "";
    let reply: string;
    try {
      reply = await agent.ask(
        [
          {
            type: "text",
            text: [header, missed, remembered, `he says: ${text}`]
              .filter((part) => part !== "")
              .join("\n\n"),
          },
        ],
        (delta) => {
          partial += delta;
          onDelta?.(delta);
        },
      );
    } catch (error) {
      // His sentence is kept even when the answer never finished, so "what did I just say" works.
      record(
        partial,
        error instanceof SessionClosed
          ? "he stopped it before the end"
          : "it failed before the end",
      );
      throw error;
    }
    turns += 1;
    lastAt = now();
    input.learn?.(text, reply);
    record(reply);
    return reply;
  };

  return {
    warm: () => void ensure().catch(() => undefined),
    say: (text, where, onDelta) => {
      const run = queue.then(() => turn(text, where, onDelta));
      queue = run.catch(() => undefined);
      return run;
    },
    dispose: () => {
      void session?.then((s) => s.dispose()).catch(() => undefined);
      session = null;
    },
  };
};
