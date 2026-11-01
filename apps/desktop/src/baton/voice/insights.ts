// @effect-diagnostics globalDate:off
/** Counts for Home from what History already holds: nothing new is collected. Days are his local days. */
import type { HistoryTurn } from "./history.ts";

export interface Insights {
  readonly wordsToday: number;
  /** Words per minute over the dictations whose length is known; null until there is one. */
  readonly wpm: number | null;
  /** Days in a row, ending today or yesterday, with at least one dictation. */
  readonly streak: number;
  readonly topApps: ReadonlyArray<{ readonly app: string; readonly count: number }>;
}

const wordCount = (text: string): number =>
  text.trim() === "" ? 0 : text.trim().split(/\s+/).length;
const dayKey = (at: Date): string => `${at.getFullYear()}-${at.getMonth()}-${at.getDate()}`;

export const computeInsights = (
  turns: ReadonlyArray<Pick<HistoryTurn, "at" | "kind" | "app" | "raw" | "cleaned" | "seconds">>,
  now: Date,
): Insights => {
  const dictations = turns.filter((turn) => turn.kind === "dictation");
  const today = dayKey(now);
  let wordsToday = 0;
  let words = 0;
  let seconds = 0;
  const days = new Set<string>();
  const apps = new Map<string, number>();
  for (const turn of dictations) {
    const at = new Date(turn.at);
    const n = wordCount(turn.cleaned ?? turn.raw);
    days.add(dayKey(at));
    if (dayKey(at) === today) wordsToday += n;
    if (turn.seconds !== null && turn.seconds > 0) {
      words += n;
      seconds += turn.seconds;
    }
    if (turn.app !== "") apps.set(turn.app, (apps.get(turn.app) ?? 0) + 1);
  }
  let streak = 0;
  const cursor = new Date(now);
  if (!days.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  while (days.has(dayKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return {
    wordsToday,
    wpm: seconds >= 5 ? Math.round((words / seconds) * 60) : null,
    streak,
    topApps: [...apps.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([app, count]) => ({ app, count })),
  };
};
