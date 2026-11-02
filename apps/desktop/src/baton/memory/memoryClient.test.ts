import { describe, expect, it, vi } from "vite-plus/test";

import { createDesktopMemory } from "./memoryClient.ts";
import type { NotesStore } from "./memoryNotes.ts";

const notes = (): NotesStore =>
  ({
    dir: "/x",
    list: () => [],
    add: (text: string) => ({ id: "n1", text, file: "/x/n1.md" }),
    remove: (id: string) => id === "n1",
    search: () => [{ id: "n1", text: "likes tea", file: "/x/n1.md" }],
  }) as unknown as NotesStore;

describe("desktop memory", () => {
  it("asks the server, and says why when it refuses", async () => {
    const call = vi.fn(async (op: string) => {
      if (op === "add") throw new Error("that looks like a password, so I did not keep it");
      return {};
    });
    const memory = createDesktopMemory({ call, notes: notes() });
    expect(await memory.remember("my password is x")).toContain("password");
  });

  it("falls back to the notes folder when the server does not answer", async () => {
    const memory = createDesktopMemory({ notes: notes() });
    expect(await memory.remember("likes tea")).toBe("Kept as a note [id: n1].");
    expect(await memory.forget("n1")).toBe("Forgotten.");
    expect((await memory.search("tea"))[0]).toContain("likes tea");
    expect(await memory.standing()).toBe("");
  });

  it("recalls for the sentence under the turn's reference and reads what was used", async () => {
    const calls: Array<[string, Record<string, unknown>]> = [];
    const call = async (op: string, args: Record<string, unknown>) => {
      calls.push([op, args]);
      if (op === "recall") return { block: "what you remember...\n- likes tea", ids: ["a"] };
      if (op === "used") return { items: [{ text: "likes tea", kind: "note" }] };
      return {};
    };
    const memory = createDesktopMemory({ call, notes: notes() });
    const ref = memory.beginTurn();
    expect(await memory.forSentence("make me tea")).toContain("likes tea");
    expect(calls[0]![1]).toMatchObject({ text: "make me tea", turnRef: ref });
    expect(await memory.used()).toBe("- likes tea (note)");
  });

  it("a stuck server costs the turn no more than the wait", async () => {
    vi.useFakeTimers();
    const memory = createDesktopMemory({ call: () => new Promise(() => undefined), notes: notes() });
    const pending = memory.forSentence("hello");
    await vi.advanceTimersByTimeAsync(900);
    expect(await pending).toBe("");
    vi.useRealTimers();
  });
});
