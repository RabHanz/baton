// @effect-diagnostics nodeBuiltinImport:off
/**
 * Built-in standing jobs: a trigger, an owning persona, one tool judged by One Trust, and a count. They
 * read jobs and the watch from this machine's server, so T3's window need not be up. Never capped: each
 * runs once for what it saw, and every run is counted and logged. Rules and schedules run on the server.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import type { BatonJob, WatchFinding } from "@t3tools/baton-contracts";
import { triggersFromCi, type CiRun, type Trigger } from "@t3tools/baton-shared/initiative";

export type BuiltInId = "ci_look" | "morning_brief" | "waiting_remind" | "job_summary";

export type StandingTrigger =
  | { readonly kind: "time"; readonly hour: number }
  | { readonly kind: "event"; readonly event: string };

export interface StandingJobDef {
  readonly id: BuiltInId;
  readonly title: string;
  readonly what: string;
  /** The persona it runs as: "executive" is the lead, otherwise a role's file stem. */
  readonly owner: string;
  readonly trigger: StandingTrigger;
  /** The one Baton tool it uses, as One Trust judges it for the owner. */
  readonly tool: string;
}

export const BRIEF_HOUR = 6;

export const BUILT_INS: ReadonlyArray<StandingJobDef> = [
  {
    id: "ci_look",
    title: "When a build fails on one of my repositories",
    what: "Opens a read-only job that works out why and says what the smallest fix is. It changes nothing; the findings show on the Now page.",
    owner: "executive",
    trigger: { kind: "event", event: "a build failed" },
    tool: "job_start",
  },
  {
    id: "morning_brief",
    title: "Every morning, build my brief",
    what: `Writes the brief once a day, from ${BRIEF_HOUR} o'clock once quiet hours are over, keeps it on the Now page and shows or says it as the brief setting says.`,
    owner: "executive",
    trigger: { kind: "time", hour: BRIEF_HOUR },
    tool: "morning_brief",
  },
  {
    id: "waiting_remind",
    title: "When a session has waited on me for an hour",
    what: "Says one line aloud about it, once per session.",
    owner: "operations",
    trigger: { kind: "event", event: "a session waited an hour" },
    tool: "watch_report",
  },
  {
    id: "job_summary",
    title: "When a job finishes, summarise it",
    what: "Writes a short summary into the job's record, once. It does not wake the worker.",
    owner: "engineering",
    trigger: { kind: "event", event: "a job finished" },
    tool: "job_refine",
  },
];

export interface StandingRun {
  readonly id: BuiltInId;
  /** What it ran for, so the same thing is never done twice. */
  readonly key: string;
  readonly at: number;
  readonly outcome: "ran" | "held" | "failed";
  readonly text: string;
}

export interface StandingState {
  readonly on: Readonly<Partial<Record<BuiltInId, boolean>>>;
  readonly runs: ReadonlyArray<StandingRun>;
  readonly brief: { readonly day: string; readonly text: string } | null;
  /** Runs ever, by job (the run list keeps only the latest). */
  readonly counts: Readonly<Partial<Record<BuiltInId, number>>>;
}

export const EMPTY_STANDING: StandingState = { on: {}, runs: [], brief: null, counts: {} };
const KEEP_RUNS = 200;
const DAY_MS = 86_400_000;

const isDue = (state: StandingState, id: BuiltInId, key: string): boolean =>
  state.on[id] === true && !state.runs.some((r) => r.id === id && r.key === key);

export interface StandingOps {
  /** Starts a read-only job for a trigger and lets it begin; returns what happened. */
  readonly look: (offer: Trigger) => Promise<string>;
  readonly brief: () => Promise<string>;
  readonly say: (text: string) => void;
  /** Writes into the job's record only; the worker is not woken. */
  readonly note: (jobId: string, text: string) => Promise<void>;
}

export interface StandingInput {
  readonly state: StandingState;
  readonly now: number;
  readonly day: string;
  readonly hour: number;
  /** Do not disturb, a snooze or quiet hours: nothing is said aloud, and a reminder or the brief waits. */
  readonly quiet?: boolean;
  /** Why One Trust will not let this job's owner use its tool unattended, or null when it may. */
  readonly refusal: (job: StandingJobDef) => string | null;
  readonly findings: ReadonlyArray<WatchFinding>;
  readonly ci: ReadonlyArray<CiRun>;
  readonly jobs: ReadonlyArray<BatonJob>;
}

const WAIT_MINUTES = 60;

/** One pass. A failing op is logged as a run that failed, and never stops the others. */
export const runStandingJobs = async (
  input: StandingInput,
  ops: StandingOps,
): Promise<{ readonly state: StandingState; readonly did: ReadonlyArray<StandingRun> }> => {
  let state = input.state;
  const did: StandingRun[] = [];
  const attempt = async (id: BuiltInId, key: string, work: () => Promise<string>) => {
    if (!isDue(state, id, key)) return;
    const refused = input.refusal(BUILT_INS.find((j) => j.id === id)!);
    let run: StandingRun;
    if (refused !== null) {
      run = { id, key, at: input.now, outcome: "held", text: `Held: ${refused}`.slice(0, 200) };
    } else {
      try {
        run = { id, key, at: input.now, outcome: "ran", text: await work() };
      } catch (error) {
        const why = error instanceof Error ? error.message : String(error);
        run = { id, key, at: input.now, outcome: "failed", text: `Failed: ${why}`.slice(0, 200) };
      }
    }
    did.push(run);
    state = {
      ...state,
      runs: [...state.runs, run].slice(-KEEP_RUNS),
      counts:
        run.outcome === "held"
          ? state.counts
          : { ...state.counts, [id]: (state.counts[id] ?? 0) + 1 },
    };
  };

  for (const t of triggersFromCi(input.ci, input.now)) {
    await attempt("ci_look", t.id, async () => `${t.title}: ${await ops.look(t)}`);
  }
  if (input.hour >= BRIEF_HOUR && input.quiet !== true && state.brief?.day !== input.day) {
    await attempt("morning_brief", input.day, async () => {
      const text = await ops.brief();
      state = { ...state, brief: { day: input.day, text } };
      return "Built the morning brief.";
    });
  }
  for (const f of input.findings) {
    if (f.kind !== "unanswered" || f.minutes < WAIT_MINUTES || input.quiet === true) continue;
    await attempt("waiting_remind", `wait:${f.workSessionId}`, async () => {
      ops.say(
        `${f.title} has been waiting for you for about ${Math.round(f.minutes / 60)} hour${f.minutes >= 120 ? "s" : ""}.`,
      );
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
      await ops.note(
        job.workSessionId,
        `Finished: ${job.title}.${used} Summary written by Tessaya.`,
      );
      return `Summarised ${job.title}.`;
    });
  }
  return { state, did };
};

/**
 * Reads the state, moving an older `playbooks.json` over once. The brief used to have its own switch
 * besides the playbook: a brief he was getting either way stays on.
 */
export const migrateStanding = (raw: unknown, briefOn: boolean): StandingState => {
  const value = (raw ?? {}) as Partial<StandingState>;
  const on = { ...value.on };
  if (raw === null || on.morning_brief !== true) on.morning_brief = briefOn;
  return {
    ...EMPTY_STANDING,
    ...value,
    on,
    runs: (value.runs ?? []).map((r) => ({ ...r, outcome: r.outcome ?? "ran" })),
    counts: value.counts ?? {},
  };
};

export const createStandingStore = (dir: string, briefOn: () => boolean) => {
  const file = NodePath.join(dir, "standing-jobs.json");
  const read = (name: string): unknown => {
    try {
      return JSON.parse(NodeFS.readFileSync(NodePath.join(dir, name), "utf8"));
    } catch {
      return undefined;
    }
  };
  const load = (): StandingState => {
    const current = read("standing-jobs.json");
    if (current !== undefined) return { ...EMPTY_STANDING, ...(current as Partial<StandingState>) };
    return migrateStanding(read("playbooks.json") ?? null, briefOn());
  };
  const save = (state: StandingState): void => {
    NodeFS.mkdirSync(dir, { recursive: true });
    NodeFS.writeFileSync(`${file}.tmp`, JSON.stringify(state));
    NodeFS.renameSync(`${file}.tmp`, file);
  };
  return {
    load,
    save,
    setOn: (id: BuiltInId, on: boolean): void => {
      const state = load();
      save({ ...state, on: { ...state.on, [id]: on } });
    },
  };
};
