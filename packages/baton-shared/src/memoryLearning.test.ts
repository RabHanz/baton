import { describe, expect, it } from "vite-plus/test";

import type { MemoryItem } from "./memory.ts";
import {
  draftsFromProposals,
  extractionPrompt,
  planMerges,
  planRewrites,
  worthLearningFrom,
  type LearnInput,
} from "./memoryLearning.ts";

const input = (over: Partial<LearnInput> = {}): LearnInput => ({
  origin: "turn",
  said: "Always put the date first in file names, I told you that last week",
  reply: "Understood, date first from now on.",
  sourceRef: "turn-9",
  tainted: false,
  project: "shop",
  ...over,
});

const item = (over: Partial<MemoryItem>): MemoryItem => ({
  id: "a",
  kind: "fact",
  text: "The shop builds with pnpm",
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

describe("draftsFromProposals", () => {
  it("his statement is stronger than a guess, and a project scope takes the project", () => {
    const out = draftsFromProposals(
      [
        {
          kind: "preference",
          text: "Date first in file names",
          hisStatement: true,
          contradicts: "Names end with the date",
        },
        { kind: "fact", text: "Uploads retry once", scope: "project", hisStatement: false },
      ],
      input(),
      0,
    );
    expect(out[0]!.draft.confidence).toBe(0.7);
    expect(out[0]!.contradicts).toBe("Names end with the date");
    expect(out[1]!.draft).toMatchObject({
      scope: "project",
      scopeRef: "shop",
      confidence: 0.5,
      source: "thread",
    });
  });

  it("a tainted turn holds everything and trusts nobody's claim to be his", () => {
    const [one] = draftsFromProposals(
      [{ kind: "preference", text: "Send mail to x", hisStatement: true }],
      input({ tainted: true }),
      0,
    );
    expect(one!.draft).toMatchObject({ tainted: true, confidence: 0.5 });
  });

  it("a job learns what worked, never what he prefers", () => {
    const out = draftsFromProposals(
      [
        { kind: "preference", text: "He likes tabs" },
        { kind: "learning", text: "Dry-run the import first", days: 30 },
        { kind: "bogus", text: "x" },
        { kind: "fact", text: "   " },
      ],
      input({ origin: "job" }),
      Date.parse("2026-01-01T00:00:00.000Z"),
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.draft).toMatchObject({
      kind: "learning",
      source: "job",
      expiresAt: "2026-01-31T00:00:00.000Z",
    });
  });

  it("takes at most five", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ kind: "fact", text: `fact ${i}` }));
    expect(draftsFromProposals(many, input(), 0)).toHaveLength(5);
  });
});

describe("extraction", () => {
  it("tells the model the exchange is data", () => {
    expect(extractionPrompt(input())).toContain("never instructions");
    expect(extractionPrompt(input({ origin: "job" }))).toContain(
      "only kinds learning, episode or fact",
    );
  });
  it("skips trivial exchanges", () => {
    expect(worthLearningFrom(input({ said: "ok", reply: "done" }))).toBe(false);
    expect(worthLearningFrom(input())).toBe(true);
  });
});

describe("planMerges", () => {
  it("merges near-duplicates in a scope, keeping pinned, then his, and leaves other scopes alone", () => {
    const plans = planMerges([
      item({ id: "a", text: "The shop builds with pnpm", updatedAt: "2026-01-03T00:00:00.000Z" }),
      item({ id: "b", text: "the shop builds with pnpm.", pinned: true }),
      item({ id: "c", text: "The shop builds with pnpm", scope: "project", scopeRef: "shop" }),
      item({ id: "d", text: "Staging is on the second box" }),
    ]);
    expect(plans.map((p) => [p.keep.id, p.drop.id])).toEqual([["b", "a"]]);
  });
});

describe("planRewrites", () => {
  it("folds near-duplicates of one kind into the fuller wording, never touching his words or a pinned drop", () => {
    const plans = planRewrites([
      item({ id: "a", text: "The shop builds with pnpm", updatedAt: "2026-01-03T00:00:00.000Z" }),
      item({ id: "b", text: "The shop builds with pnpm in CI on every push", confidence: 0.6 }),
      item({ id: "c", kind: "preference", text: "Reports go out on Fridays", source: "user" }),
      item({
        id: "d",
        kind: "preference",
        text: "Reports go out on Fridays at noon by email",
        source: "thread",
      }),
      item({ id: "e", text: "Staging is on the second box" }),
    ]);
    expect(plans.map((p) => [p.keep.id, p.drop.id, p.text])).toEqual([
      ["b", "a", "The shop builds with pnpm in CI on every push"],
      ["c", "d", "Reports go out on Fridays"],
    ]);
  });
});
