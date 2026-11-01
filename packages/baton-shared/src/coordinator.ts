/**
 * The coordinator (D148): a job with several parts hands each to its own worker, watches them, and
 * reports once. Pure: which parts are settled, and the one summary, from the cards and the watch.
 */
import type { BatonJob, WatchFinding } from "@t3tools/baton-contracts";

/** Marks the parent's record so the summary is written once. */
export const SUMMARY_MARK = "Summary of the parts:";

export const MAX_PARTS = 8;

/** Every part has finished one way or the other; none is still running or waiting for him. */
export const partsSettled = (parts: ReadonlyArray<BatonJob>): boolean =>
  parts.length > 0 && parts.every((p) => p.group === "done" || p.group === "failed");

export const partsSummary = (input: {
  readonly parentTitle: string;
  readonly parts: ReadonlyArray<BatonJob>;
  readonly findings: ReadonlyArray<WatchFinding>;
}): string => {
  const said = new Map(input.findings.map((f) => [f.workSessionId as string, f.lastDid]));
  const line = (p: BatonJob) => {
    const last = said.get(p.workSessionId);
    return `- ${p.title}: ${p.group === "done" ? "done" : "failed"}${last === undefined || last === "" ? "" : `. Last: ${last}`}`;
  };
  const failed = input.parts.filter((p) => p.group === "failed").length;
  return [
    `${SUMMARY_MARK} ${input.parentTitle}`,
    ...input.parts.map(line),
    failed === 0
      ? "All parts finished. Write the report against the outcomes, with the evidence."
      : `${failed} of ${input.parts.length} failed. Say what is missing, what it blocks, and what to do next.`,
  ].join("\n");
};
