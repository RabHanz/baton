// @effect-diagnostics nodeBuiltinImport:off globalDate:off
/**
 * The conversation's file (D142): `baton-conversation.ndjson` in the state folder, one turn a line,
 * in full, never sent anywhere except inside the model calls that need it. It survives a restart.
 * At 20 MB the file moves to `.1` and a new one starts; both are read, so the oldest turns stay
 * searchable. Dictated words are not kept: a dictation is a stub with its length.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import {
  EARLIER_TURNS,
  RECENT_TURNS,
  conversationBlock,
  parseTurn,
  searchTurns,
  currentTarget,
  type ConversationRoute,
  type ConversationTarget,
  type ConversationTurn,
} from "@t3tools/baton-shared/conversation";

const MAX_BYTES = 20 * 1024 * 1024;
/** Turns kept in memory to search; the file keeps everything. */
const LOADED_TURNS = 4_000;

export interface ConversationLog {
  readonly add: (turn: {
    readonly route: ConversationRoute;
    readonly said: string;
    readonly reply: string;
    readonly note?: string;
    readonly target?: ConversationTarget;
  }) => ConversationTurn;
  /** What "it" means now, if the conversation has been about something. */
  readonly target: () => ConversationTarget | null;
  readonly recent: (count?: number) => ReadonlyArray<ConversationTurn>;
  /** The block to put before a request: the latest turns, and older ones that share its words. */
  readonly blockFor: (request: string) => string;
}

const readTurns = (file: string): ReadonlyArray<ConversationTurn> => {
  try {
    return NodeFS.readFileSync(file, "utf8")
      .split("\n")
      .flatMap((line) => {
        const turn = line.trim() === "" ? null : parseTurn(line);
        return turn === null ? [] : [turn];
      });
  } catch {
    return [];
  }
};

export const createConversationLog = (input: {
  readonly file: string;
  readonly now?: () => Date;
}): ConversationLog => {
  const now = input.now ?? (() => new Date());
  let turns: ConversationTurn[] = [...readTurns(`${input.file}.1`), ...readTurns(input.file)].slice(
    -LOADED_TURNS,
  );
  let nextId = (turns.at(-1)?.id ?? 0) + 1;

  const append = (turn: ConversationTurn) => {
    try {
      NodeFS.mkdirSync(NodePath.dirname(input.file), { recursive: true });
      if (NodeFS.existsSync(input.file) && NodeFS.statSync(input.file).size > MAX_BYTES) {
        NodeFS.renameSync(input.file, `${input.file}.1`);
      }
      NodeFS.appendFileSync(input.file, `${JSON.stringify(turn)}\n`);
    } catch {
      // Losing a line must never stop an answer; the turn still sits in memory for this run.
    }
  };

  return {
    add: (turn) => {
      const entry: ConversationTurn = { id: nextId, at: now().toISOString(), ...turn };
      nextId += 1;
      turns = [...turns, entry].slice(-LOADED_TURNS);
      append(entry);
      return entry;
    },
    target: () => currentTarget(turns),
    recent: (count = RECENT_TURNS) => turns.filter((t) => t.route !== "dictation").slice(-count),
    blockFor: (request) => {
      const recent = turns.filter((t) => t.route !== "dictation").slice(-RECENT_TURNS);
      const earlier = searchTurns(turns, request, {
        exclude: new Set(recent.map((t) => t.id)),
        limit: EARLIER_TURNS,
      });
      return conversationBlock({ recent, earlier });
    },
  };
};
