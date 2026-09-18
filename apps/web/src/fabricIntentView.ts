/**
 * Presentation for the intent input.
 *
 * The input has one job beyond taking text: **say what will happen before it
 * happens.** A surface fed by dictation mishears, and the difference between a
 * useful assistant and a dangerous one is whether the user sees "Tell Claude on
 * Scheduler: run the migration tests" and can stop it, or only finds out
 * afterwards.
 *
 * So the preview is not decoration. It is the confirmation step, and the
 * wording below is what the user reads at the moment they decide.
 */
import type {
  FabricIntentRecord,
  FabricIntentResolution,
  FabricIntentRisk,
} from "@t3tools/contracts";

export interface IntentPreview {
  /** `will` — pressing enter does this. `refused` — it will not happen. */
  readonly tone: "will" | "refused";
  /** The line under the input. */
  readonly line: string;
  /** The words it could not place, when that is why it refused. */
  readonly unplaced: string | null;
  /**
   * True when the action spends a subscription, starts a session, or releases
   * queued automation. The input marks these; it does not block them.
   */
  readonly weighty: boolean;
}

const WEIGHTY: ReadonlySet<FabricIntentRisk> = new Set(["medium", "high"]);

export const previewResolution = (resolution: FabricIntentResolution): IntentPreview =>
  resolution.outcome === "resolved"
    ? {
        tone: "will",
        line: resolution.description,
        unplaced: null,
        weighty: WEIGHTY.has(resolution.risk),
      }
    : {
        tone: "refused",
        line: resolution.refusal.message,
        // Shown separately so the user can see which words to change, rather
        // than re-reading their own sentence looking for the problem.
        unplaced:
          resolution.refusal.unplaced.trim().length === 0
            ? null
            : resolution.refusal.unplaced.trim(),
        weighty: false,
      };

export interface IntentRow {
  readonly id: string;
  /** What was said. */
  readonly text: string;
  /** What came of it, in one line. */
  readonly outcome: string;
  readonly refused: boolean;
  readonly failed: boolean;
}

/**
 * The recent-intent list.
 *
 * Refusals stay in it on purpose: a log that keeps only what worked cannot show
 * the grammar its own blind spots, and "it did nothing and I do not know why"
 * is the complaint this list exists to answer.
 */
export const buildIntentRows = (records: ReadonlyArray<FabricIntentRecord>): readonly IntentRow[] =>
  records.map((record) => ({
    id: record.id,
    text: record.text,
    outcome: record.reply.trim().length > 0 ? record.reply : describeOutcome(record),
    refused: record.outcome === "refused",
    failed: record.outcome === "failed",
  }));

const describeOutcome = (record: FabricIntentRecord): string => {
  switch (record.outcome) {
    case "resolved":
      return record.description.length > 0 ? record.description : "Done.";
    case "refused":
      return "Refused.";
    case "failed":
      return "Could not be done.";
  }
};
