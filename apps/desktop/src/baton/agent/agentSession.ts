// @effect-diagnostics globalDate:off
/**
 * The one assistant's session (D143): one long-lived agent, kept warm, that holds the whole
 * conversation. It starts before he speaks, is seeded from the conversation file when it starts or
 * is recycled, and puts every turn back into that file. A new session loses nothing.
 */
import type { ConversationLog } from "../conversation/conversationLog.ts";
import type { VisionSession } from "../screen/claudeVision.ts";
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
  /** His notes as a prompt block, read fresh when a session starts. */
  readonly notes?: () => string;
  /** Called at the start of a turn: a new sentence has not read anything yet. */
  readonly beginTurn: () => void;
}): AssistantAgent => {
  const now = input.now ?? Date.now;
  let session: Promise<VisionSession> | null = null;
  let turns = 0;
  let lastAt = now();

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
    session = input.start(
      agentSystemPrompt({ recent: input.conversation.recent(), notes: input.notes?.() ?? "" }),
    );
    return session;
  };

  return {
    warm: () => void ensure().catch(() => undefined),
    say: async (text, where, onDelta) => {
      input.beginTurn();
      const agent = await ensure();
      const target = input.conversation.target();
      const header = contextLine({
        now: input.clockLine(),
        window: where.window,
        session: where.session,
        target: target?.label ?? null,
      });
      const reply = await agent.ask(
        [{ type: "text", text: `${header}\n\nhe says: ${text}` }],
        onDelta,
      );
      turns += 1;
      lastAt = now();
      input.conversation.add({
        route: "answer",
        said: text,
        reply,
        ...(where.window === null ? {} : { target: { label: where.window } }),
      });
      return reply;
    },
    dispose: () => {
      void session?.then((s) => s.dispose()).catch(() => undefined);
      session = null;
    },
  };
};
