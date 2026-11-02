/**
 * The commitments ledger (D149): what he asked Tessaya to keep track of or follow up on, with an
 * owner, a due time, a status and where it came from. Pure; the desktop keeps the list on disk.
 * A commitment is a note, not authority: acting on one still goes through the gate.
 */
import type { NeedItem } from "./needsMe.ts";

export type CommitmentStatus = "open" | "done" | "dropped";

export interface Commitment {
  readonly id: string;
  readonly text: string;
  /** Who has to do the next step. */
  readonly owner: "tessaya" | "you";
  /** Epoch ms, or null when it has no date. */
  readonly due: number | null;
  readonly status: CommitmentStatus;
  /** Where it came from: his voice, the assistant's own judgement, or an offer he accepted. */
  readonly source: "voice" | "assistant" | "offer";
  readonly createdAt: number;
  readonly closedAt?: number;
  /** A session or job it is about, so a follow-up can open it. */
  readonly ref?: string;
}

export const COMMITMENT_TEXT_MAX = 300;
export const OPEN_MAX = 200;
/** Closed ones are kept this long, so "what did I finish" still works. */
export const KEEP_CLOSED_MS = 30 * 86_400_000;

export interface CommitmentInput {
  readonly text: string;
  readonly owner?: Commitment["owner"];
  readonly due?: number | null;
  readonly source?: Commitment["source"];
  readonly ref?: string;
}

export const addCommitment = (
  list: ReadonlyArray<Commitment>,
  input: CommitmentInput,
  now: number,
  id: string,
): ReadonlyArray<Commitment> => {
  const text = input.text.replace(/\s+/g, " ").trim();
  if (text === "") throw new Error("A commitment needs words.");
  if (text.length > COMMITMENT_TEXT_MAX) throw new Error("That commitment is too long.");
  if (list.filter((c) => c.status === "open").length >= OPEN_MAX) {
    throw new Error("There are too many open commitments; close some first.");
  }
  const due = input.due ?? null;
  if (due !== null && !Number.isFinite(due)) throw new Error("The due time is not a time.");
  // The same words, still open: it is the same commitment, so only its date can move.
  const same = list.find((c) => c.status === "open" && c.text.toLowerCase() === text.toLowerCase());
  if (same !== undefined) return list.map((c) => (c === same ? { ...c, due: due ?? c.due } : c));
  return [
    ...list,
    {
      id,
      text,
      owner: input.owner ?? "tessaya",
      due,
      status: "open",
      source: input.source ?? "voice",
      createdAt: now,
      ...(input.ref === undefined ? {} : { ref: input.ref }),
    },
  ];
};

export const closeCommitment = (
  list: ReadonlyArray<Commitment>,
  id: string,
  status: "done" | "dropped",
  now: number,
): ReadonlyArray<Commitment> => {
  const hit = list.find((c) => c.id === id && c.status === "open");
  if (hit === undefined) throw new Error("No open commitment has that id.");
  return list.map((c) => (c === hit ? { ...c, status, closedAt: now } : c));
};

export const pruneCommitments = (
  list: ReadonlyArray<Commitment>,
  now: number,
): ReadonlyArray<Commitment> =>
  list.filter((c) => c.status === "open" || now - (c.closedAt ?? c.createdAt) <= KEEP_CLOSED_MS);

const when = (due: number | null, now: number): string => {
  if (due === null) return "no date";
  const mins = Math.round((due - now) / 60_000);
  if (mins < 0)
    return `overdue by ${-mins >= 120 ? `${Math.round(-mins / 60)} h` : `${-mins} min`}`;
  return mins >= 2880
    ? `due in ${Math.round(mins / 1440)} days`
    : mins >= 120
      ? `due in ${Math.round(mins / 60)} h`
      : `due in ${mins} min`;
};

export const isDue = (c: Commitment, now: number): boolean =>
  c.status === "open" && c.due !== null && c.due <= now;

export const describeCommitments = (
  list: ReadonlyArray<Commitment>,
  now: number,
  includeClosed = false,
): string => {
  const shown = list
    .filter((c) => includeClosed || c.status === "open")
    .toSorted(
      (a, b) =>
        Number(b.status === "open") - Number(a.status === "open") ||
        (a.due ?? Infinity) - (b.due ?? Infinity),
    );
  return shown.length === 0
    ? "No open commitments."
    : shown
        .map(
          (c) =>
            `${c.text} (${c.status === "open" ? `${c.owner === "you" ? "yours" : "mine"}, ${when(c.due, now)}` : c.status}) [id: ${c.id}]`,
        )
        .join("\n");
};

/** Due or overdue ones are needs; a dated one inside a day is a small one; an undated one is not. */
export const needsFromCommitments = (
  list: ReadonlyArray<Commitment>,
  now: number,
): ReadonlyArray<NeedItem> =>
  list.flatMap((c): ReadonlyArray<NeedItem> => {
    if (c.status !== "open" || c.due === null || c.due - now > 86_400_000) return [];
    return [
      {
        id: `commit:${c.id}`,
        source: "commitment",
        title: c.text,
        why: `${c.owner === "you" ? "you" : "I"} said I would: ${when(c.due, now)}`,
        weight: c.owner === "you" ? 60 : 65,
        dueAt: c.due,
        ref: c.id,
      },
    ];
  });

/** A line for the morning brief, or null when nothing is open and dated. */
export const briefCommitments = (list: ReadonlyArray<Commitment>, now: number): string | null => {
  const open = list.filter((c) => c.status === "open");
  if (open.length === 0) return null;
  const due = open.filter((c) => isDue(c, now)).map((c) => c.text);
  const soon = open.filter((c) => c.due !== null && !isDue(c, now) && c.due - now <= 86_400_000);
  const parts = [
    ...(due.length > 0 ? [`Due now: ${due.slice(0, 3).join("; ")}.`] : []),
    ...(soon.length > 0
      ? [
          `Due within a day: ${soon
            .slice(0, 3)
            .map((c) => c.text)
            .join("; ")}.`,
        ]
      : []),
  ];
  return parts.length === 0 ? `Keeping track of ${open.length} open.` : parts.join(" ");
};
