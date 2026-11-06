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

export type BuiltInId =
  | "ci_look"
  | "morning_brief"
  | "waiting_remind"
  | "job_summary"
  | "nightly_learning";

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
export const LEARN_HOUR = 2;

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
  {
    id: "nightly_learning",
    title: "Every night, learn from the day",
    what: `On unless you turn it off. Once a day from ${LEARN_HOUR} o'clock, finds the last day's slow or corrected turns, writes a skill for the worst two kinds, and tests each by replaying the turn. A skill that passes waits for your yes under What I've learned; one that fails is logged and not tried again.`,
    owner: "executive",
    trigger: { kind: "time", hour: LEARN_HOUR },
    tool: "skill_draft",
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

/**
 * A timed job whose hour passed while Tessaya was off or asleep: "once" runs it when she is back the same day, "skip"
 * leaves that day out. A missed day before today is never made up either way.
 */
export type MissedRun = "once" | "skip";

export interface StandingState {
  readonly on: Readonly<Partial<Record<BuiltInId, boolean>>>;
  /** Per timed job; "once" when not set. */
  readonly missed?: Readonly<Partial<Record<BuiltInId, MissedRun>>>;
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
  /** The nightly learning pass; returns what it did, replays counted. */
  readonly learn: () => Promise<string>;
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

export const missedRunOf = (state: StandingState, id: BuiltInId): MissedRun =>
  state.missed?.[id] ?? "once";

/** A timed job's hour has come: at its hour, or later the same day when a missed run is made up once. */
const timeHasCome = (state: StandingState, id: BuiltInId, hour: number, at: number): boolean =>
  hour === at || (hour > at && missedRunOf(state, id) === "once");

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
  if (
    timeHasCome(state, "morning_brief", input.hour, BRIEF_HOUR) &&
    input.quiet !== true &&
    state.brief?.day !== input.day
  ) {
    await attempt("morning_brief", input.day, async () => {
      const text = await ops.brief();
      state = { ...state, brief: { day: input.day, text } };
      return "Built the morning brief.";
    });
  }
  if (timeHasCome(state, "nightly_learning", input.hour, LEARN_HOUR))
    await attempt("nightly_learning", input.day, ops.learn);
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

/** Learning was asked for: on unless he turned it off. Never adopts anything by itself. */
const ON_UNLESS_OFF: ReadonlyArray<BuiltInId> = ["nightly_learning"];
const withDefaults = (state: StandingState): StandingState => ({
  ...state,
  on: { ...Object.fromEntries(ON_UNLESS_OFF.map((id) => [id, true])), ...state.on },
});

/**
 * Reads the state, moving an older `playbooks.json` over once. The brief used to have its own switch
 * besides the playbook: a brief he was getting either way stays on.
 */
export const migrateStanding = (
  raw: unknown,
  briefOn: boolean,
  /** The day (as `Date.toDateString`) the old switch last gave the brief, so today's is not given twice. */
  briefGivenOn: string | null = null,
): StandingState => {
  const value = (raw ?? {}) as Partial<StandingState>;
  const on = { ...value.on };
  if (raw === null || on.morning_brief !== true) on.morning_brief = briefOn;
  const given: ReadonlyArray<StandingRun> =
    briefGivenOn === null
      ? []
      : [
          {
            id: "morning_brief",
            key: briefGivenOn,
            at: 0,
            outcome: "ran",
            text: "Given before the update.",
          },
        ];
  return withDefaults({
    ...EMPTY_STANDING,
    ...value,
    on,
    runs: [...(value.runs ?? []).map((r) => ({ ...r, outcome: r.outcome ?? "ran" })), ...given],
    counts: value.counts ?? {},
  });
};

export const createStandingStore = (
  dir: string,
  /** The old brief switch, read once when the state is first moved over. */
  legacy: () => { readonly briefOn: boolean; readonly briefGivenOn: string | null },
) => {
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
    if (current !== undefined)
      return withDefaults({ ...EMPTY_STANDING, ...(current as Partial<StandingState>) });
    const old = legacy();
    return migrateStanding(read("playbooks.json") ?? null, old.briefOn, old.briefGivenOn);
  };
  const save = (state: StandingState): void => {
    NodeFS.mkdirSync(dir, { recursive: true });
    NodeFS.writeFileSync(`${file}.tmp`, JSON.stringify(state));
    NodeFS.renameSync(`${file}.tmp`, file);
  };
  return {
    load,
    /** A pass's runs, keeping the switches and missed-run choices as they are now: he may have changed one while it ran. */
    saveRun: (state: StandingState): void => {
      const now = load();
      save({ ...state, on: now.on, ...(now.missed === undefined ? {} : { missed: now.missed }) });
    },
    setOn: (id: BuiltInId, on: boolean): void => {
      const state = load();
      save({ ...state, on: { ...state.on, [id]: on } });
    },
    setMissed: (id: BuiltInId, missed: MissedRun): void => {
      const state = load();
      save({ ...state, missed: { ...state.missed, [id]: missed } });
    },
  };
};
