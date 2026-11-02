/**
 * The assistant's memory as the desktop sees it (D150): the server's store when it answers, and his
 * plain notes folder (D146) when it does not, so "remember that" never silently does nothing. The
 * server owns the rules (what is never kept, decay, conflicts); this only asks and phrases.
 */
import {
  MEMORY_TEXT_MAX,
  type MemoryHit,
  type MemoryItem,
} from "@t3tools/baton-shared/memory";

import type { NotesStore } from "./memoryNotes.ts";

/** One call to the server's `baton.memory.*` through the window; rejects with a reason in plain words. */
export type MemoryCall = (op: string, args: Record<string, unknown>) => Promise<unknown>;

/** Waiting for memory must never slow a spoken answer. */
const RECALL_MS = 800;

const line = (item: MemoryItem): string =>
  `[id: ${item.id}] ${item.text} (${item.kind}${item.pinned ? ", pinned" : ""}, ${item.source === "user" ? "his own words" : `${Math.round(item.confidence * 100)}% sure`}${item.proposed ? ", waiting for his yes" : ""})`;

export const createDesktopMemory = (input: {
  /** Absent or failing: the notes folder answers. */
  readonly call?: MemoryCall | undefined;
  readonly notes: NotesStore;
}) => {
  let turn = 0;
  let lastTurnRef: string | null = null;
  const ask = async <T>(op: string, args: Record<string, unknown>): Promise<T | null> => {
    if (input.call === undefined) return null;
    try {
      return (await input.call(op, args)) as T;
    } catch (error) {
      if (op === "add" || op === "edit") throw error;
      return null;
    }
  };

  return {
    /** The turn the next recall belongs to; "what did you use?" is asked of the last one. */
    beginTurn: (): string => {
      turn += 1;
      lastTurnRef = `turn-${Date.now()}-${turn}`;
      return lastTurnRef;
    },
    /** Standing memory for the first prompt: pinned and what he told it about working with him. */
    standing: async (): Promise<string> => {
      const out = await ask<{ block: string }>("recall", { budgetTokens: 600 });
      return out?.block ?? "";
    },
    /** What matches this sentence, for the turn; empty when the server is slow or has nothing. */
    forSentence: async (text: string): Promise<string> => {
      const call = ask<{ block: string }>("recall", {
        text,
        budgetTokens: 300,
        ...(lastTurnRef === null ? {} : { turnRef: lastTurnRef }),
      });
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), RECALL_MS);
      });
      try {
        return (await Promise.race([call, timeout]))?.block ?? "";
      } finally {
        clearTimeout(timer);
      }
    },
    search: async (query: string): Promise<ReadonlyArray<string>> => {
      const out = await ask<{ hits: ReadonlyArray<MemoryHit> }>("search", { text: query, limit: 12 });
      if (out !== null) return out.hits.map((h) => line(h.item));
      return input.notes.search(query).map((n) => `his note [id: ${n.id}]: ${n.text}`);
    },
    remember: async (text: string): Promise<string> => {
      const clean = text.trim().slice(0, MEMORY_TEXT_MAX);
      try {
        const out = await ask<{ item: MemoryItem }>("add", { kind: "note", text: clean, source: "user" });
        if (out !== null) return `Kept [id: ${out.item.id}].`;
      } catch (error) {
        return error instanceof Error ? error.message : "That was not kept.";
      }
      return `Kept as a note [id: ${input.notes.add(clean).id}].`;
    },
    forget: async (id: string): Promise<string> => {
      const out = await ask<{ forgotten: boolean }>("forget", { id });
      if (out !== null) return out.forgotten ? "Forgotten." : "There is no memory by that id.";
      return input.notes.remove(id) ? "Forgotten." : "There is no note by that id.";
    },
    pin: async (id: string, pinned: boolean): Promise<string> => {
      const out = await ask<{ item: MemoryItem }>("pin", { id, pinned });
      return out === null ? "Memory is not reachable, so nothing was pinned." : pinned ? "Pinned." : "Unpinned.";
    },
    /** What the last answer drew on. */
    used: async (): Promise<string> => {
      if (lastTurnRef === null) return "Nothing yet this session.";
      const out = await ask<{ items: ReadonlyArray<MemoryItem> }>("used", { turnRef: lastTurnRef });
      if (out === null) return "Memory is not reachable.";
      return out.items.length === 0
        ? "That answer did not draw on any memory."
        : out.items.map((i) => `- ${i.text} (${i.kind})`).join("\n");
    },
    /** After a turn: fire and forget, never read aloud and never in the way. */
    learn: (said: string, reply: string, tainted: boolean): void => {
      void ask("learn", { said, reply, tainted, ...(lastTurnRef === null ? {} : { turnRef: lastTurnRef }) });
    },
  };
};

export type DesktopMemory = ReturnType<typeof createDesktopMemory>;
