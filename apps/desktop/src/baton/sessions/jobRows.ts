/** The Jobs area of Baton's window (D145): job cards as window rows, grouped by where each job is. */
import type { BatonJob } from "@t3tools/baton-contracts";

import type { HomeControl } from "../home/batonHome.ts";

const SECTION = {
  needs_you: "Needs you",
  running: "Running",
  failed: "Failed",
  done: "Done",
} as const;
const ORDER = ["needs_you", "running", "failed", "done"] as const;

const status = (j: BatonJob): string =>
  j.phase === "drafting_plan"
    ? "Writing the plan"
    : j.phase === "awaiting_agreement"
      ? "The plan is ready; waiting for your OK"
      : j.limitReached === null
        ? SECTION[j.group]
        : `Stopped at its ${j.limitReached} limit`;

export const jobControls = (jobs: ReadonlyArray<BatonJob>): ReadonlyArray<HomeControl> =>
  ORDER.flatMap((group) =>
    jobs
      .filter((j) => j.group === group)
      .map(
        (j): HomeControl => ({
          id: `j:${j.workSessionId}`,
          section: SECTION[group],
          label: j.title,
          hint: `${status(j)}. May: ${j.permissionsSummary}`,
          kind: "action",
          button: j.phase === "awaiting_agreement" ? "Approve" : "Open T3",
          ...(group === "needs_you" ? { lead: true } : {}),
        }),
      ),
  );

/** The job a row's action is about, and whether the action is approval. */
export const jobAction = (jobs: ReadonlyArray<BatonJob>, id: string) => {
  const job = jobs.find((j) => id === `j:${j.workSessionId}`);
  return job === undefined
    ? null
    : ({ id: job.workSessionId, approve: job.phase === "awaiting_agreement" } as const);
};
