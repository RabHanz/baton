// @effect-diagnostics globalDate:off
/**
 * The one assistant's session (D143): one long-lived agent, kept warm, that holds the whole
 * conversation. It starts before he speaks, is seeded from the conversation file when it starts or
 * is recycled, and puts every turn back into that file. A new session loses nothing.
 */
import { RECENT_TURNS, conversationBlock } from "@t3tools/baton-shared/conversation";
import type { Brain } from "@t3tools/baton-shared/osPack";

import type { ConversationLog } from "../conversation/conversationLog.ts";
import { SessionClosed, type VisionSession } from "../screen/claudeVision.ts";
import { agentSystemPrompt, contextLine } from "./agentPrompt.ts";

/** About this many turns, and the session is replaced and re-seeded; a long one gets slow and costly. */
export const RECYCLE_TURNS = 40;
export const RECYCLE_IDLE_MS = 6 * 60 * 60_000;
/** Every screenshot stays in the session's context; after this many the next sentence starts a fresh one. */
export const RECYCLE_IMAGES = 12;

export const shouldRecycle = (state: {
  readonly alive: boolean;
  readonly turns: number;
  readonly idleMs: number;
  readonly images?: number;
}): boolean =>
  !state.alive ||
  state.turns >= RECYCLE_TURNS ||
  state.idleMs >= RECYCLE_IDLE_MS ||
  (state.images ?? 0) >= RECYCLE_IMAGES;

export interface AssistantAgent {
  /** Start the session now, so the first sentence does not wait for it. */
  readonly warm: (brain?: Brain) => void;
  /** What he said, with where he is; the reply streams to `onDelta` as it is written. */
  readonly say: (text: string, where: Where, onDelta?: (delta: string) => void) => Promise<string>;
  readonly dispose: () => void;
}

export interface Where {
  readonly window: string | null;
  readonly session: string | null;
  /** The focused session's project, so its memories come back and another project's stay out. */
  readonly project?: string | null;
  /** The persona he woke: its name and line, and whether this turn is the first under that name. */
  readonly persona?: { readonly name: string; readonly role: string; readonly introduce: boolean };
  /** The persona's own model and effort; a change starts a session on it, seeded like any other. */
  readonly brain?: Brain;
}

export const createAssistantAgent = (input: {
  /** Starts the model session with this system prompt, on this model when one is given. */
  readonly start: (systemPrompt: string, brain?: Brain) => Promise<VisionSession>;
  readonly conversation: ConversationLog;
  readonly now?: () => number;
  readonly clockLine: () => string;
  /** His notes and standing memory as a prompt block, read fresh when a session starts. */
  readonly notes?: () => string | Promise<string>;
  /** Memory that matches this sentence (D150): a block for the turn, empty when none. Bounded by the caller. */
  readonly recall?: (text: string, project: string | null) => Promise<string>;
  /** After a turn: what he said and what came back, for the learning loop. Never awaited. */
  readonly learn?: (said: string, reply: string, project: string | null) => void;
  /** Called at the start of a turn: a new sentence has not read anything yet. */
  readonly beginTurn: (said: string) => void;
  /** His state right now (awareness), empty when he has turned it all off. */
  readonly presence?: () => Promise<string>;
  /** How many images the tools have handed the assistant so far, ever. */
  readonly images?: () => number;
}): AssistantAgent => {
  const now = input.now ?? Date.now;
  let session: Promise<VisionSession> | null = null;
  let sessionBrain = "";
  let turns = 0;
  let lastAt = now();
  const imagesNow = () => input.images?.() ?? 0;
  let imagesAtStart = imagesNow();
  // The newest conversation turn this session has in view, and the turns it wrote itself.
  let seenId = 0;
  let own = new Set<number>();
  // One sentence at a time, so a second one never resets the running turn's state (taint, tools).
  let queue: Promise<unknown> = Promise.resolve();
  // Bumped by a stop: sentences queued before it are dropped, not run on a fresh session.
  let generation = 0;

  const ensure = async (brain?: Brain): Promise<VisionSession> => {
    const wanted = brain === undefined ? sessionBrain : `${brain.model}/${brain.effort}`;
    if (session !== null) {
      const current = await session.catch(() => null);
      if (
        current !== null &&
        wanted === sessionBrain &&
        !shouldRecycle({
          alive: current.alive(),
          turns,
          idleMs: now() - lastAt,
          images: imagesNow() - imagesAtStart,
        })
      ) {
        return current;
      }
      current?.dispose();
      session = null;
    }
    turns = 0;
    sessionBrain = wanted;
    imagesAtStart = imagesNow();
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
          brain,
        ),
      );
    return session;
  };

  const turn = async (
    text: string,
    where: Where,
    onDelta?: (delta: string) => void,
  ): Promise<string> => {
    input.beginTurn(text);
    const agent = await ensure(where.brain);
    // Turns answered without it (a refusal, the older router) since it last looked.
    const meanwhile = input.conversation
      .recent(RECYCLE_TURNS)
      .filter((t) => t.id > seenId && !own.has(t.id));
    seenId = meanwhile.at(-1)?.id ?? seenId;
    const target = input.conversation.target();
    const project = where.project ?? null;
    const [presence, remembered] = await Promise.all([
      input.presence?.().catch(() => "") ?? "",
      input.recall?.(text, project).catch(() => "") ?? "",
    ]);
    const header = contextLine({
      now: input.clockLine(),
      window: where.window,
      session: where.session,
      target: target?.label ?? null,
      presence,
      ...(where.persona === undefined ? {} : { persona: where.persona }),
    });
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
    input.learn?.(text, reply, project);
    record(reply);
    return reply;
  };

  return {
    // In line with the sentences, and only when there is no session: a live one (any persona's) is never replaced.
    warm: (brain) => {
      queue = queue
        .then(() => (session === null ? ensure(brain) : undefined))
        .catch(() => undefined);
    },
    say: (text, where, onDelta) => {
      const asked = generation;
      const run = queue.then(() => {
        if (asked !== generation) throw new SessionClosed("Stopped before it began.");
        return turn(text, where, onDelta);
      });
      queue = run.catch(() => undefined);
      return run;
    },
    dispose: () => {
      generation += 1;
      void session?.then((s) => s.dispose()).catch(() => undefined);
      session = null;
    },
  };
};
