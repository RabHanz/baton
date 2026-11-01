/** What the assistant is told about jobs: plain sentences from the job cards, never raw JSON. */
import type { BatonJob } from "@t3tools/baton-contracts";

const GROUP: Record<BatonJob["group"], string> = {
  running: "running",
  needs_you: "needs him",
  done: "done",
  failed: "failed",
};

export const describeJobs = (jobs: ReadonlyArray<BatonJob>): string =>
  jobs.length === 0
    ? "There are no jobs."
    : jobs
        .map((j) => {
          const waiting =
            j.phase === "drafting_plan"
              ? "writing the plan"
              : j.phase === "awaiting_agreement"
                ? "plan ready, waiting for his OK"
                : GROUP[j.group];
          const cap = j.limitReached === null ? "" : `, ${j.limitReached} limit reached`;
          return `${j.title} [id: ${j.workSessionId}]: ${waiting}${cap}. May: ${j.permissionsSummary}`;
        })
        .join("\n");
