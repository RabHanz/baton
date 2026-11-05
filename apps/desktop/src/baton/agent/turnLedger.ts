/** What one assistant turn did, for its own line in the turn log and no other turn's. */
export interface TurnRecord {
  readonly tools: string[];
  readonly results: Array<{ readonly tool: string; readonly ok: boolean; readonly error?: string }>;
  readonly decisions: Array<{ readonly tool: string; readonly outcome: string }>;
  readonly routes: Array<{ readonly route: string; readonly why: string }>;
}

const empty = (): TurnRecord => ({ tools: [], results: [], decisions: [], routes: [] });

/**
 * A sentence is logged when it is heard, but the assistant runs turns one at a time in that order. Each asked turn gets
 * its record when it really begins; one stopped before it began keeps an empty one, and writes outside any turn are dropped.
 */
export const createTurnLedger = () => {
  const waiting: Array<{ readonly record: TurnRecord }> = [];
  let running: TurnRecord | null = null;
  return {
    ask: () => {
      const slot = { record: empty() };
      waiting.push(slot);
      return {
        record: () => slot.record,
        done: () => {
          const at = waiting.indexOf(slot);
          if (at >= 0) waiting.splice(at, 1);
          if (running === slot.record) running = null;
        },
      };
    },
    begin: () => {
      running = waiting.shift()?.record ?? empty();
    },
    current: (): TurnRecord => running ?? empty(),
  };
};
