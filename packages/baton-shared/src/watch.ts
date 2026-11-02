/**
 * Session monitoring (D146): which sessions have been left alone when they should not be. Pure and
 * read from state the server already holds (the fleet's derived state and timestamps), never a
 * model's guess: a session is failed because its state says so, stalled because it says "working"
 * and nothing has happened for a long time.
 */
import type { BatonFleetEntry, WatchFinding } from "@t3tools/baton-contracts";

export const WATCH_LIMITS = {
  /** Working, and no activity at all for this long. */
  stalledMinutes: 30,
  /** Waiting for his answer for this long. */
  unansweredMinutes: 30,
  /** Finished and never looked at for this long. */
  unseenMinutes: 60,
} as const;

const SEVERITY: Record<WatchFinding["kind"], number> = {
  failed: 0,
  limited: 1,
  offline: 2,
  stalled: 3,
  unanswered: 4,
  unseen: 5,
};

const lastActivity = (entry: BatonFleetEntry): number => {
  const times = [entry.updatedAt, ...entry.threads.map((t) => t.lastActivityAt)].flatMap((t) => {
    const ms = t === null ? NaN : Date.parse(t);
    return Number.isNaN(ms) ? [] : [ms];
  });
  return Math.max(0, ...times);
};

export const watchFleet = (
  entries: ReadonlyArray<BatonFleetEntry>,
  now: number,
  limits: typeof WATCH_LIMITS = WATCH_LIMITS,
): ReadonlyArray<WatchFinding> =>
  entries
    .flatMap((entry): ReadonlyArray<WatchFinding> => {
      if (entry.lifecycle !== "active") return [];
      const since = lastActivity(entry);
      const minutes = since === 0 ? 0 : Math.max(0, Math.floor((now - since) / 60_000));
      const said = entry.synopsis?.currentAction ?? entry.synopsis?.recentFindings[0]?.text ?? "";
      const make = (kind: WatchFinding["kind"]): ReadonlyArray<WatchFinding> => [
        {
          workSessionId: entry.workSessionId,
          title: entry.title,
          kind,
          minutes,
          ...(said === "" ? {} : { lastDid: said.slice(0, 200) }),
        },
      ];
      switch (entry.state) {
        case "failed":
        case "limited":
        case "offline":
          return make(entry.state);
        case "working":
        case "starting":
        case "monitoring":
          return minutes >= limits.stalledMinutes ? make("stalled") : [];
        case "needs_approval":
        case "needs_input":
          return minutes >= limits.unansweredMinutes ? make("unanswered") : [];
        case "done_unseen":
          return minutes >= limits.unseenMinutes ? make("unseen") : [];
        case "idle":
          return [];
      }
    })
    .toSorted((a, b) => SEVERITY[a.kind] - SEVERITY[b.kind] || b.minutes - a.minutes);

const WORDS: Record<WatchFinding["kind"], string> = {
  failed: "failed",
  limited: "stopped, its account is out of room",
  offline: "is offline",
  stalled: "looks stalled",
  unanswered: "has been waiting for you",
  unseen: "finished and has not been looked at",
};

export const describeWatch = (findings: ReadonlyArray<WatchFinding>): string =>
  findings.length === 0
    ? "Nothing is being left alone."
    : findings
        .map(
          (f) =>
            `${f.title} ${WORDS[f.kind]}${f.minutes >= 1 ? ` (${f.minutes >= 120 ? `${Math.round(f.minutes / 60)} h` : `${f.minutes} min`})` : ""}${f.lastDid === undefined ? "" : `. Last: ${f.lastDid}`} [id: ${f.workSessionId}]`,
        )
        .join("\n");
