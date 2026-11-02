// @effect-diagnostics nodeBuiltinImport:off globalDate:off
/**
 * Playbooks: narrow standing permissions for work Tessaya does unattended, all off until he turns one
 * on, each with a budget per day. None of them sends, posts or spends: the most any does is open a
 * read-only job, write a note in a job's record, build the brief, or say one line aloud. Every run is
 * returned so the caller can log it, and the state is one small JSON file.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import type { BatonJob, WatchFinding } from "@t3tools/baton-contracts";
import { triggersFromCi, triggersFromFindings, type CiRun, type Trigger } from "@t3tools/baton-shared/initiative";

export type PlaybookId = "ci_look" | "morning_brief" | "waiting_remind" | "job_summary";

export interface PlaybookDef {
  readonly id: PlaybookId;
  readonly title: string;
  readonly what: string;
  /** At most this many runs in any 24 hours. */
  readonly perDay: number;
}

export const PLAYBOOKS: ReadonlyArray<PlaybookDef> = [
  {
    id: "ci_look",
    title: "When a build fails on one of my repositories",
    what: "Opens a read-only job that works out why and says what the smallest fix is. It changes nothing; the findings show on the Now page.",
    perDay: 3,
  },
  {
    id: "morning_brief",
    title: "Every morning, build my brief",
    what: "Writes the brief once a day, from 6 o'clock, and keeps it on the Now page. It does not speak.",
    perDay: 1,
  },
  {
    id: "waiting_remind",
    title: "When a session has waited on me for an hour",
    what: "Says one line aloud about it, once per session.",
    perDay: 3,
  },
  {
    id: "job_summary",
    title: "When a job finishes, summarise it",
    what: "Writes a short summary into the job's record, once. It does not wake the worker.",
    perDay: 10,
  },
];

export interface PlaybookRun {
  readonly id: PlaybookId;
  /** What it ran for, so the same thing is never done twice. */
  readonly key: string;
  readonly at: number;
  readonly text: string;
}

export interface PlaybookState {
  readonly on: Readonly<Partial<Record<PlaybookId, boolean>>>;
  readonly runs: ReadonlyArray<PlaybookRun>;
  readonly brief: { readonly day: string; readonly text: string } | null;
}

export const EMPTY_PLAYBOOKS: PlaybookState = { on: {}, runs: [], brief: null };
const KEEP_RUNS = 200;
const DAY_MS = 86_400_000;

export const isDue = (state: PlaybookState, id: PlaybookId, key: string, now: number): boolean => {
  const def = PLAYBOOKS.find((p) => p.id === id);
  if (def === undefined || state.on[id] !== true) return false;
  if (state.runs.some((r) => r.id === id && r.key === key)) return false;
  return state.runs.filter((r) => r.id === id && now - r.at < DAY_MS).length < def.perDay;
};

export interface PlaybookOps {
  /** Starts a read-only job for a trigger and lets it begin; returns what happened. */
  readonly look: (offer: Trigger) => Promise<string>;
  readonly brief: () => Promise<string>;
  readonly say: (text: string) => void;
  /** Writes into the job's record only; the worker is not woken. */
  readonly note: (jobId: string, text: string) => Promise<void>;
}

export interface PlaybookInput {
  readonly state: PlaybookState;
  readonly now: number;
  readonly day: string;
  readonly hour: number;
  /** Do not disturb, a snooze or quiet hours: nothing is said aloud, and a reminder waits. */
  readonly quiet?: boolean;
  readonly findings: ReadonlyArray<WatchFinding>;
  readonly ci: ReadonlyArray<CiRun>;
  readonly jobs: ReadonlyArray<BatonJob>;
}

const WAIT_MINUTES = 60;

/** One pass. A failing op is logged as a run that failed, and never stops the others. */
export const runPlaybooks = async (
  input: PlaybookInput,
  ops: PlaybookOps,
): Promise<{ readonly state: PlaybookState; readonly did: ReadonlyArray<PlaybookRun> }> => {
  let state = input.state;
  const did: PlaybookRun[] = [];
  const attempt = async (id: PlaybookId, key: string, work: () => Promise<string>) => {
    if (!isDue(state, id, key, input.now)) return;
    let text: string;
    try {
      text = await work();
    } catch (error) {
      text = `Failed: ${error instanceof Error ? error.message : String(error)}`.slice(0, 200);
    }
    const run = { id, key, at: input.now, text };
    did.push(run);
    state = { ...state, runs: [...state.runs, run].slice(-KEEP_RUNS) };
  };

  for (const t of triggersFromCi(input.ci, input.now)) {
    await attempt("ci_look", t.id, async () => `${t.title}: ${await ops.look(t)}`);
  }
  if (input.hour >= 6 && state.brief?.day !== input.day) {
    await attempt("morning_brief", input.day, async () => {
      const text = await ops.brief();
      state = { ...state, brief: { day: input.day, text } };
      return "Built the morning brief.";
    });
  }
  for (const f of input.findings) {
    if (f.kind !== "unanswered" || f.minutes < WAIT_MINUTES || input.quiet === true) continue;
    await attempt("waiting_remind", `wait:${f.workSessionId}`, async () => {
      ops.say(`${f.title} has been waiting for you for about ${Math.round(f.minutes / 60)} hour${f.minutes >= 120 ? "s" : ""}.`);
      return `Reminded you about ${f.title}.`;
    });
  }
  for (const job of input.jobs) {
    if (job.group !== "done" || job.phase !== "approved") continue;
    // Only what finished lately: turning this on does not summarise last month.
    if (input.now - Date.parse(job.lastActivityAt) > DAY_MS) continue;
    await attempt("job_summary", job.workSessionId, async () => {
      const u = job.usage;
      const used =
        u === undefined || u === null
          ? ""
          : ` It ran ${u.minutes} min and ${u.turns} turns${u.dollars == null ? "" : `, about $${u.dollars.toFixed(2)}`}.`;
      await ops.note(job.workSessionId, `Finished: ${job.title}.${used} Summary written by Tessaya.`);
      return `Summarised ${job.title}.`;
    });
  }
  return { state, did };
};

export const createPlaybookStore = (dir: string) => {
  const file = NodePath.join(dir, "playbooks.json");
  const load = (): PlaybookState => {
    try {
      const raw = JSON.parse(NodeFS.readFileSync(file, "utf8")) as Partial<PlaybookState>;
      return { ...EMPTY_PLAYBOOKS, ...raw };
    } catch {
      return EMPTY_PLAYBOOKS;
    }
  };
  const save = (state: PlaybookState): void => {
    NodeFS.mkdirSync(dir, { recursive: true });
    NodeFS.writeFileSync(`${file}.tmp`, JSON.stringify(state));
    NodeFS.renameSync(`${file}.tmp`, file);
  };
  return {
    load,
    save,
    setOn: (id: PlaybookId, on: boolean): void => save({ ...load(), on: { ...load().on, [id]: on } }),
  };
};
