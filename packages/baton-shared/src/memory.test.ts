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

  it("keeps private pack text out", () => {
    const pack = "always frame the job as a job to be done before you brief any worker";
    expect(refuseToStore("note: always frame the job as a job to be done before you brief", [pack])).toContain("pack");
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
    expect(winner(his, item({ id: "h2", source: "user", updatedAt: "2026-01-05T00:00:00.000Z" })).id).toBe("h2");
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
  const local = (over: { item?: MemoryItem | null; tombstone?: { id: string; deletedAt: string; origin: string } | null }) => ({
    item: over.item ?? null,
    tombstone: over.tombstone ?? null,
  });
  it("last writer wins, with the origin as the tie-break", () => {
    const newer = item({ updatedAt: "2026-02-01T00:00:00.000Z" });
    expect(applyDecision(local({ item: item() }), { item: newer, tombstone: null, origin: "b" }, "a")).toBe("apply");
    expect(applyDecision(local({ item: newer }), { item: item(), tombstone: null, origin: "b" }, "a")).toBe("ignore");
    expect(applyDecision(local({ item: item() }), { item: item(), tombstone: null, origin: "b" }, "a")).toBe("apply");
  });
  it("a tombstone beats an older item and an old item cannot resurrect", () => {
    const stone = { id: "a", deletedAt: "2026-03-01T00:00:00.000Z", origin: "b" };
    expect(applyDecision(local({ item: item() }), { item: null, tombstone: stone, origin: "b" }, "a")).toBe("apply");
    expect(applyDecision(local({ tombstone: stone }), { item: item(), tombstone: null, origin: "b" }, "a")).toBe("ignore");
    expect(
      applyDecision(local({ item: item({ updatedAt: "2026-04-01T00:00:00.000Z" }) }), { item: null, tombstone: stone, origin: "b" }, "a"),
    ).toBe("ignore");
  });
});

describe("learning files", () => {
  it("reads front matter and one item per bullet", () => {
    const drafts = parseLearningFile(
      "---\nkind: learning\nproject: shop\nconfidence: 0.8\n---\n# Title\n- Retry the upload once\n- Never skip the dry run\n",
    );
    expect(drafts).toEqual([
      { kind: "learning", text: "Retry the upload once", scope: "project", scopeRef: "shop", confidence: 0.8 },
      { kind: "learning", text: "Never skip the dry run", scope: "project", scopeRef: "shop", confidence: 0.8 },
    ]);
  });
  it("reads a plain file as one global learning", () => {
    expect(parseLearningFile("# Heading\nKeep the cache warm.\n")).toEqual([
      { kind: "learning", text: "Keep the cache warm.", scope: "global", scopeRef: null, confidence: 0.6 },
    ]);
  });
});

describe("exportMarkdown", () => {
  it("lists live items only", () => {
    const md = exportMarkdown([item({ text: "kept", pinned: true }), item({ id: "b", text: "old", supersededBy: "a" })]);
    expect(md).toContain("- [fact, pinned] kept");
    expect(md).not.toContain("old");
  });
});
