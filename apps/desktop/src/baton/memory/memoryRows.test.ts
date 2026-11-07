import { describe, expect, it } from "vite-plus/test";

import type { MemoryItem } from "@t3tools/baton-shared/memory";

import { memoryControls, memoryIdOf, type MemoryTabState } from "./memoryRows.ts";

const item = (over: Partial<MemoryItem>): MemoryItem => ({
  id: "a",
  kind: "fact",
  text: "The shop builds with pnpm",
  source: "thread",
  sourceRef: null,
  scope: "global",
  scopeRef: null,
  confidence: 0.65,
  pinned: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  lastUsedAt: null,
  expiresAt: null,
  supersededBy: null,
  proposed: false,
  ...over,
});
const state = (over: Partial<MemoryTabState>): MemoryTabState => ({
  items: [],
  query: "",
  filter: "all",
  usedIds: new Set(),
  usedOnly: false,
  syncOn: false,
  peers: [],
  pullOn: false,
  status: "",
  ...over,
});

describe("memoryControls", () => {
  const items = [
    item({
      id: "1",
      kind: "preference",
      text: "Short answers",
      source: "user",
      confidence: 1,
      pinned: true,
    }),
    item({ id: "2", text: "Staging is on the second box", scope: "project", scopeRef: "shop" }),
    item({ id: "3", text: "Invoices go to a new host", proposed: true }),
    item({ id: "4", text: "Old rule", supersededBy: "1" }),
  ];

  it("counts by kind, groups rows under kinds and says where each came from", () => {
    const [bar, ...rows] = memoryControls(state({ items, usedIds: new Set(["2"]) }));
    expect(bar).toMatchObject({ kind: "memoryBar", usedCount: 1 });
    expect(
      (bar as unknown as { kinds: Array<{ value: string; count: number }> }).kinds.map(
        (k) => `${k.value}:${k.count}`,
      ),
    ).toEqual(["all:2", "preference:1", "fact:1", "held:1", "replaced:1"]);
    expect(rows.map((r) => [r.id, r.section])).toEqual([
      ["m:1", "Preferences"],
      ["m:2", "Facts"],
    ]);
    expect(rows[0]).toMatchObject({ pinned: true, hint: "preference · your words · pinned" });
    expect(rows[1]!.hint).toBe("fact · 65% sure · project: shop · used in the last answer");
    expect((rows[1] as unknown as { why: string }).why).toContain(
      "I picked this up from a conversation on 2026-01-01",
    );
  });

  it("filters by kind, search, held, replaced and used", () => {
    const ids = (s: Partial<MemoryTabState>) =>
      memoryControls(state({ items, ...s }))
        .filter((c) => c.kind === "memory")
        .map((c) => c.id);
    expect(ids({ filter: "fact" })).toEqual(["m:2"]);
    expect(ids({ query: "staging box" })).toEqual(["m:2"]);
    expect(ids({ filter: "held" })).toEqual(["m:3"]);
    expect(ids({ filter: "replaced" })).toEqual(["m:4"]);
    expect(ids({ usedOnly: true, usedIds: new Set(["1"]) })).toEqual(["m:1"]);
  });

  it("says plainly when there is nothing", () => {
    expect(memoryControls(state({}))[1]).toMatchObject({
      id: "m.empty",
      label: "Nothing remembered yet",
    });
    expect(memoryControls(state({ items, query: "zzz" }))[1]).toMatchObject({
      label: "Nothing matches",
    });
  });

  it("reads the id out of an action", () => {
    expect(memoryIdOf("m.pin:abc-1", "m.pin")).toBe("abc-1");
    expect(memoryIdOf("m:abc", "m.pin")).toBeNull();
  });
});

describe("an item's history on the Memory page", () => {
  it("lists its earlier wordings under it, each with Restore, only while its History is open", () => {
    const one = item({ id: "m1", text: "The shop deploys on Thursdays" });
    const versions = [
      {
        version: 1,
        text: "The shop deploys on Fridays",
        kind: "fact" as const,
        at: "2026-11-01T09:30:00.000Z",
        by: "him" as const,
        why: "he edited it",
      },
    ];
    const open = memoryControls(state({ items: [one], history: { id: "m1", versions } }));
    const restore = open.find((c) => c.id === "m.restore:m1:1");
    expect(restore?.label).toBe("The shop deploys on Fridays");
    expect(restore?.hint).toContain("changed by you: he edited it");
    expect(memoryIdOf("m.restore:m1:1", "m.restore")).toBe("m1:1");
    expect(memoryControls(state({ items: [one] })).some((c) => c.id.startsWith("m.restore:"))).toBe(
      false,
    );
    const none = memoryControls(state({ items: [one], history: { id: "m1", versions: [] } }));
    expect(none.some((c) => c.id === "m.history.none:m1")).toBe(true);
  });
});
