/** T3's status pill for a Baton session row; the rows themselves are shared with the server (baton-shared). */
import type { BatonSessionRow } from "@t3tools/baton-shared/batonProjects";
import type { ThreadStatusPill } from "./components/Sidebar.logic";

export {
  batonSessionSummaries,
  buildBatonProjects,
  paneWaiting,
  type BatonProjectGroup,
  type BatonSessionRow,
  type EnvironmentLive,
} from "@t3tools/baton-shared/batonProjects";

const PILL = {
  approval: {
    label: "Pending Approval",
    colorClass: "text-amber-600 dark:text-amber-300/90",
    dotClass: "bg-amber-500 dark:bg-amber-300/90",
    pulse: false,
  },
  input: {
    label: "Awaiting Input",
    colorClass: "text-indigo-600 dark:text-indigo-300/90",
    dotClass: "bg-indigo-500 dark:bg-indigo-300/90",
    pulse: false,
  },
  working: {
    label: "Working",
    colorClass: "text-sky-600 dark:text-sky-300/80",
    dotClass: "bg-sky-500 dark:bg-sky-300/80",
    pulse: true,
  },
  waiting: {
    label: "Waiting",
    colorClass: "text-sidebar-muted-foreground",
    dotClass: "bg-sidebar-muted-foreground",
    pulse: false,
  },
  failed: {
    label: "Failed",
    colorClass: "text-red-600 dark:text-red-300/90",
    dotClass: "bg-red-500 dark:bg-red-300/90",
    pulse: false,
  },
  completed: {
    label: "Completed",
    colorClass: "text-emerald-600 dark:text-emerald-300/90",
    dotClass: "bg-emerald-500 dark:bg-emerald-300/90",
    pulse: false,
  },
} as const satisfies Record<string, ThreadStatusPill>;

/**
 * A row's state as T3's own status pill, so a Baton row and a thread row say the same thing the
 * same way. The states come from three vocabularies: Baton's §10 ladder (work rows), Claude Code's
 * session status, and Herdr's agent state. Quiet states get no pill, as quiet threads get none.
 */
export function batonRowStatusPill(row: BatonSessionRow): ThreadStatusPill | null {
  switch (row.state) {
    case "needs_approval":
    case "blocked":
      return PILL.approval;
    case "needs_input":
      return PILL.input;
    case "working":
    case "running":
    case "busy":
    case "starting":
      return PILL.working;
    case "limited":
    case "offline":
      return PILL.waiting;
    case "failed":
      return PILL.failed;
    case "done_unseen":
      return PILL.completed;
    default:
      return null;
  }
}
