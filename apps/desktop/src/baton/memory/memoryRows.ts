/** The Memory area of Tessaya's window (D150): the bar, then one row per memory, grouped by kind. */
import type { MemoryItem, MemoryKind } from "@t3tools/baton-shared/memory";

import type { HomeControl } from "../home/batonHome.ts";

export interface MemoryTabState {
  readonly items: ReadonlyArray<MemoryItem>;
  readonly query: string;
  /** "all", a kind, "held" (waiting for his yes) or "replaced" (history). */
  readonly filter: string;
  readonly usedIds: ReadonlySet<string>;
  readonly usedOnly: boolean;
  readonly syncOn: boolean;
  readonly pullOn: boolean;
  readonly status: string;
}

const KINDS: ReadonlyArray<readonly [MemoryKind, string]> = [
  ["preference", "Preferences"],
  ["correction", "Corrections"],
  ["decision", "Decisions"],
  ["fact", "Facts"],
  ["learning", "Learnings"],
  ["episode", "Episodes"],
  ["note", "Notes"],
];

const matches = (item: MemoryItem, words: ReadonlyArray<string>): boolean => {
  const hay = `${item.text} ${item.kind} ${item.scopeRef ?? ""}`.toLowerCase();
  return words.every((w) => hay.includes(w));
};

const meta = (item: MemoryItem, used: boolean): string =>
  [
    item.kind,
    item.source === "user" ? "your words" : `${Math.round(item.confidence * 100)}% sure`,
    item.scope === "global" ? null : `${item.scope}: ${item.scopeRef ?? ""}`,
    item.source === "import" ? "imported" : null,
    item.pinned ? "pinned" : null,
    used ? "used in the last answer" : null,
  ]
    .filter((x): x is string => x !== null)
    .join(" · ");

export const memoryControls = (s: MemoryTabState): ReadonlyArray<HomeControl> => {
  const live = s.items.filter((i) => i.supersededBy === null && !i.proposed);
  const held = s.items.filter((i) => i.proposed);
  const replaced = s.items.filter((i) => i.supersededBy !== null);
  const kinds = [
    { value: "all", label: "All", count: live.length },
    ...KINDS.map(([value, label]) => ({
      value,
      label,
      count: live.filter((i) => i.kind === value).length,
    })).filter((k) => k.count > 0),
    ...(held.length > 0 ? [{ value: "held", label: "Waiting for you", count: held.length }] : []),
    ...(replaced.length > 0
      ? [{ value: "replaced", label: "Replaced", count: replaced.length }]
      : []),
  ];
  const bar: HomeControl = {
    id: "m.bar",
    section: "Memory",
    label: "Memory",
    kind: "memoryBar",
    query: s.query,
    filter: s.filter,
    kinds,
    usedOnly: s.usedOnly,
    usedCount: s.usedIds.size,
    syncOn: s.syncOn,
    pullOn: s.pullOn,
    status: s.status,
  };

  const pool = s.filter === "held" ? held : s.filter === "replaced" ? replaced : live;
  const words = s.query.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = pool
    .filter(
      (i) =>
        s.filter === "all" || s.filter === "held" || s.filter === "replaced" || i.kind === s.filter,
    )
    .filter((i) => !s.usedOnly || s.usedIds.has(i.id))
    .filter((i) => matches(i, words));

  const row = (item: MemoryItem, section: string): HomeControl => ({
    id: `m:${item.id}`,
    section,
    label: item.text,
    hint: meta(item, s.usedIds.has(item.id)),
    kind: "memory",
    pinned: item.pinned,
    held: item.proposed,
  });
  const sectionOf = (item: MemoryItem): string =>
    item.proposed
      ? "Waiting for your yes"
      : item.supersededBy !== null
        ? "Replaced"
        : (KINDS.find(([k]) => k === item.kind)?.[1] ?? "Notes");
  const ordered = [...shown].toSorted(
    (a, b) =>
      KINDS.findIndex(([k]) => k === a.kind) - KINDS.findIndex(([k]) => k === b.kind) ||
      Number(b.pinned) - Number(a.pinned) ||
      b.updatedAt.localeCompare(a.updatedAt),
  );
  const rows = ordered.map((i) => row(i, sectionOf(i)));
  if (rows.length > 0) return [bar, ...rows];
  return [
    bar,
    {
      id: "m.empty",
      section: "Memory",
      label: s.items.length === 0 ? "Nothing remembered yet" : "Nothing matches",
      hint:
        s.items.length === 0
          ? 'Say "remember that..." and it is kept here. What you teach it while you work is added as it learns.'
          : "Try fewer words, or pick All.",
      kind: "check",
      status: "ok",
      detail: s.items.length === 0 ? "Nothing is being kept." : "No memory fits the filter.",
    },
  ];
};

/** `m.pin:<id>` and the like carry the memory's id after the colon. */
export const memoryIdOf = (id: string, prefix: string): string | null =>
  id.startsWith(`${prefix}:`) ? id.slice(prefix.length + 1) : null;
