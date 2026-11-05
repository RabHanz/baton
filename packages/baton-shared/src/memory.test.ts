import { describe, expect, it } from "vite-plus/test";

import {
  applyDecision,
  effectiveConfidence,
  exportMarkdown,
  memoryBlock,
  parseLearningFile,
  refuseToStore,
  reinforced,
  shouldDelete,
  similarity,
  whyRemembered,
  winner,
  type MemoryItem,
} from "./memory.ts";

const item = (over: Partial<MemoryItem> = {}): MemoryItem => ({
  id: "a",
  kind: "fact",
  text: "He prefers short answers",
  source: "thread",
  sourceRef: null,
  scope: "global",
  scopeRef: null,
  confidence: 0.5,
  pinned: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  lastUsedAt: null,
  expiresAt: null,
  supersededBy: null,
  proposed: false,
  ...over,
});

describe("refuseToStore", () => {
  it.each([
    ["my password is hunter22x", "password"],
    ["key sk-abcdefghijklmnopqrstuv", "API key"],
    ["use ghp_abcdefghijklmnopqrstuvwxyz0123", "token"],
    ["card 4111 1111 1111 1111", "card number"],
    ["pay GB82WEST12345698765432", "bank account"],
    ["postgres://admin:s3cretpw@db.example/x", "password"],
  ])("refuses %s", (text, what) => {
    expect(refuseToStore(text)).toContain(what);
  });

  it("keeps ordinary statements and numbers that are not cards", () => {
    expect(refuseToStore("He likes plain answers on Tuesdays")).toBeNull();
    expect(refuseToStore("order 1234 5678 9012 3456")).toBeNull();
  });

  it("keeps sentences that only mention a password or token", () => {
    for (const text of [
      "the password is wrong",
      "my token is expired.",
      "the pin is broken!",
      "where did I put my recovery phrase?",
    ])
      expect(refuseToStore(text), text).toBeNull();
    for (const text of [
      "the pin is 4821",
      "my password is sunshine",
      "the pin is 4471",
      "my password is now sunshine",
    ])
      expect(refuseToStore(text), text).toContain("password");
    for (const text of [
      "my password is not working",
      "the password is still incorrect",
      "the token is on the sticky note",
      "my password is too short",
      "the pin is locked",
      "my password is the same as before",
      "the api key is in the vault",
    ])
      expect(refuseToStore(text), text).toBeNull();
    expect(refuseToStore("password: sunshine")).toContain("password");
    expect(
      refuseToStore(
        "my recovery phrase is apple river stone cloud mango tiger piano lemon frost candle orbit maple",
      ),
    ).toContain("recovery phrase");
  });

  it("keeps private pack text out", () => {
    const pack = "always frame the job as a job to be done before you brief any worker";
    expect(
      refuseToStore("note: always frame the job as a job to be done before you brief", [pack]),
    ).toContain("pack");
    expect(refuseToStore("he likes tea", [pack])).toBeNull();
  });
});

describe("decay and conflicts", () => {
  const now = Date.parse("2026-01-15T00:00:00.000Z");
  it("halves an episode after 14 days, spares pinned and his preferences", () => {
    expect(effectiveConfidence(item({ kind: "episode" }), now)).toBeCloseTo(0.25, 5);
    expect(effectiveConfidence(item({ kind: "episode", pinned: true }), now)).toBe(0.5);
    expect(effectiveConfidence(item({ kind: "preference" }), now)).toBe(0.5);
  });
  it("deletes the expired and the faded, never the pinned", () => {
    expect(shouldDelete(item({ expiresAt: "2026-01-10T00:00:00.000Z" }), now)).toBe(true);
    expect(shouldDelete(item({ kind: "episode", confidence: 0.1 }), now)).toBe(true);
    expect(shouldDelete(item({ kind: "episode", confidence: 0.1, pinned: true }), now)).toBe(false);
  });
  it("reinforces models, not him, and never to 1", () => {
    expect(reinforced(item({ confidence: 0.5 }))).toBeCloseTo(0.65, 5);
    expect(reinforced(item({ confidence: 0.9 }))).toBe(0.95);
    expect(reinforced(item({ source: "user", confidence: 1 }))).toBe(1);
  });
  it("his words beat a model, the newer of his beats the older", () => {
    const model = item({ id: "m", confidence: 0.95, updatedAt: "2026-01-09T00:00:00.000Z" });
    const his = item({ id: "h", source: "user", confidence: 1 });
    expect(winner(model, his).id).toBe("h");
    expect(
      winner(his, item({ id: "h2", source: "user", updatedAt: "2026-01-05T00:00:00.000Z" })).id,
    ).toBe("h2");
  });
  it("sees the same item through small rewording", () => {
    expect(similarity("He prefers short answers", "he prefers short answers.")).toBe(1);
    expect(similarity("He prefers short answers", "The build runs on Linux")).toBe(0);
  });
});

describe("memoryBlock", () => {
  it("puts pinned first and stops at the budget", () => {
    const items = [
      item({ id: "1", text: "one ".repeat(30) }),
      item({ id: "2", text: "pinned thing", pinned: true, source: "user" }),
      item({ id: "3", text: "three" }),
    ];
    const { block, ids } = memoryBlock(items, 50);
    expect(ids[0]).toBe("2");
    expect(ids).toContain("3");
    expect(ids).not.toContain("1");
    expect(block.startsWith("what you remember")).toBe(true);
  });
  it("is empty when nothing fits", () => {
    expect(memoryBlock([], 600)).toEqual({ block: "", ids: [] });
  });
});

describe("applyDecision", () => {
  const held = (over: {
    item?: MemoryItem | null;
    tombstone?: { id: string; deletedAt: string; origin: string } | null;
    writer?: string | null;
  }) => ({
    item: over.item ?? null,
    tombstone: over.tombstone ?? null,
    writer: over.writer ?? null,
  });
  it("last writer wins, with the writer as the tie-break, and an echo is ignored", () => {
    const newer = item({ updatedAt: "2026-02-01T00:00:00.000Z" });
    expect(
      applyDecision(held({ item: item(), writer: "a" }), {
        item: newer,
        tombstone: null,
        writer: "b",
      }),
    ).toBe("apply");
    expect(
      applyDecision(held({ item: newer, writer: "a" }), {
        item: item(),
        tombstone: null,
        writer: "b",
      }),
    ).toBe("ignore");
    expect(
      applyDecision(held({ item: item(), writer: "a" }), {
        item: item(),
        tombstone: null,
        writer: "b",
      }),
    ).toBe("apply");
    expect(
      applyDecision(held({ item: item(), writer: "b" }), {
        item: item(),
        tombstone: null,
        writer: "b",
      }),
    ).toBe("ignore");
  });
  it("a tombstone beats an older item and an old item cannot resurrect", () => {
    const stone = { id: "a", deletedAt: "2026-03-01T00:00:00.000Z", origin: "b" };
    expect(
      applyDecision(held({ item: item() }), { item: null, tombstone: stone, writer: "b" }),
    ).toBe("apply");
    expect(
      applyDecision(held({ tombstone: stone }), { item: item(), tombstone: null, writer: "b" }),
    ).toBe("ignore");
    expect(
      applyDecision(held({ item: item({ updatedAt: "2026-04-01T00:00:00.000Z" }) }), {
        item: null,
        tombstone: stone,
        writer: "b",
      }),
    ).toBe("ignore");
  });
});

describe("learning files", () => {
  it("reads front matter and one item per bullet", () => {
    const drafts = parseLearningFile(
      "---\nkind: learning\nproject: shop\nconfidence: 0.8\n---\n# Title\n- Retry the upload once\n- Never skip the dry run\n",
    );
    expect(drafts).toEqual([
      {
        kind: "learning",
        text: "Retry the upload once",
        scope: "project",
        scopeRef: "shop",
        confidence: 0.8,
      },
      {
        kind: "learning",
        text: "Never skip the dry run",
        scope: "project",
        scopeRef: "shop",
        confidence: 0.8,
      },
    ]);
  });
  it("reads a Claude-style memory file by its type", () => {
    expect(
      parseLearningFile(
        "---\nname: voice\ndescription: x\nmetadata:\n  type: user\n---\nHe says Freya as FRAY-uh.\n",
      ),
    ).toEqual([
      {
        kind: "preference",
        text: "He says Freya as FRAY-uh.",
        scope: "global",
        scopeRef: null,
        confidence: 0.6,
      },
    ]);
  });
  it("reads a plain file as one global learning", () => {
    expect(parseLearningFile("# Heading\nKeep the cache warm.\n")).toEqual([
      {
        kind: "learning",
        text: "Keep the cache warm.",
        scope: "global",
        scopeRef: null,
        confidence: 0.6,
      },
    ]);
  });
});

describe("exportMarkdown", () => {
  it("lists live items only", () => {
    const md = exportMarkdown([
      item({ text: "kept", pinned: true }),
      item({ id: "b", text: "old", supersededBy: "a" }),
    ]);
    expect(md).toContain("- [fact, pinned] kept");
    expect(md).not.toContain("old");
  });
});

describe("whyRemembered", () => {
  it("says where it came from, how sure, and what keeps or ends it", () => {
    expect(whyRemembered(item({ source: "user", confidence: 1, pinned: true }))).toBe(
      "You told me this on 2026-01-01. It is in your words. You pinned it, so it stays. I have not used it in an answer yet.",
    );
    const model = whyRemembered(
      item({
        source: "job",
        confidence: 0.65,
        lastUsedAt: "2026-02-03T10:00:00.000Z",
        expiresAt: "2026-03-01T00:00:00.000Z",
      }),
    );
    expect(model).toContain("I learned this from a finished job on 2026-01-01.");
    expect(model).toContain("65% sure");
    expect(model).toContain("last used it in an answer on 2026-02-03");
    expect(model).toContain("forgotten after 2026-03-01");
  });
});
