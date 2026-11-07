/**
 * His own standing jobs (KIRO-1): "every morning at 8, check CI on tessaya and tell me what broke". The assistant's
 * job_create call is the parse (its schema, not a regex); this checks and normalises it, says it back for the confirm
 * card, and decides when one is due. Each run is judged by standingVerdict, so a job uses only unattended tools.
 */
import { isUnattendedTool } from "./trust.ts";

export const MAX_USER_JOBS = 20;
/** An event job waits at least this long between runs. */
export const MIN_EVENT_MINUTES = 15;
export const USER_JOB_EVENTS = ["session_waiting", "build_failed", "job_finished"] as const;
export type UserJobEvent = (typeof USER_JOB_EVENTS)[number];
const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export type Weekday = (typeof DAYS)[number];

export type UserJobTrigger =
  | {
      readonly kind: "time";
      readonly hour: number;
      readonly minute: number;
      /** Empty: every day. */
      readonly days: ReadonlyArray<Weekday>;
    }
  | {
      readonly kind: "event";
      readonly event: UserJobEvent;
      /** session_waiting: how long a session has waited on him. Also the least time between two runs. */
      readonly minutes: number;
    };

export interface UserJob {
  readonly id: string;
  readonly title: string;
  /** His words for what to do, run as the job's instruction. */
  readonly instruction: string;
  /** The persona it runs as: "executive" is the lead. */
  readonly owner: string;
  readonly trigger: UserJobTrigger;
  readonly tools: ReadonlyArray<string>;
  readonly on: boolean;
  /** Proposed by a device or another agent: off until he approves it on the Trust page. */
  readonly proposed: boolean;
  /** A timed job whose time passed while Tessaya was off: run once when back (default), or skip that day. */
  readonly missed: "once" | "skip";
  readonly createdAt: number;
}

/** Read and report: what a job gets when he names no tools. The three record writes stay with the built-ins. */
export const DEFAULT_USER_JOB_TOOLS: ReadonlyArray<string> = [
  "jobs_list",
  "watch_report",
  "what_happened",
  "needs_me",
  "commit_list",
  "cloud_status",
  "activity_today",
  "approvals_list",
];

type Args = Readonly<Record<string, unknown>>;
const int = (v: unknown, lo: number, hi: number): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi ? v : null;

/** The job_create arguments as a job, or the reason they cannot be one, in words he can be told. */
export const userJobFromArgs = (
  args: Args,
  defaults: { readonly owner: string; readonly id: string; readonly now: number },
): { readonly job: Omit<UserJob, "on" | "proposed"> } | { readonly refused: string } => {
  const title = typeof args["title"] === "string" ? args["title"].trim().slice(0, 120) : "";
  const instruction =
    typeof args["instruction"] === "string" ? args["instruction"].trim().slice(0, 1_000) : "";
  if (title === "" || instruction === "") return { refused: "A job needs a title and what to do." };
  const t = (args["trigger"] ?? {}) as Args;
  let trigger: UserJobTrigger;
  if (t["kind"] === "time") {
    const hour = int(t["hour"], 0, 23);
    const minute = t["minute"] === undefined ? 0 : int(t["minute"], 0, 59);
    const days = Array.isArray(t["days"]) ? t["days"] : [];
    if (hour === null || minute === null)
      return { refused: "The time must be an hour 0-23 and a minute 0-59." };
    if (days.some((d) => !DAYS.includes(d as Weekday)))
      return { refused: `Days must be from ${DAYS.join(", ")}.` };
    trigger = { kind: "time", hour, minute, days: [...new Set(days as Weekday[])] };
  } else if (t["kind"] === "event") {
    const event = USER_JOB_EVENTS.find((e) => e === t["event"]);
    if (event === undefined)
      return { refused: `The event must be one of ${USER_JOB_EVENTS.join(", ")}.` };
    const minutes = t["minutes"] === undefined ? MIN_EVENT_MINUTES : int(t["minutes"], 1, 10_080);
    if (minutes === null) return { refused: "The minutes must be a whole number." };
    trigger = { kind: "event", event, minutes: Math.max(MIN_EVENT_MINUTES, minutes) };
  } else return { refused: "The trigger must be a time of day or an event." };
  const asked = Array.isArray(args["tools"])
    ? (args["tools"] as unknown[]).filter((x) => typeof x === "string")
    : [];
  // Only what may run with nobody there; anything else would only be held at run time.
  const tools =
    asked.length === 0 ? DEFAULT_USER_JOB_TOOLS : (asked as string[]).filter(isUnattendedTool);
  if (tools.length === 0) return { refused: "None of those tools may run with nobody there." };
  return {
    job: {
      id: defaults.id,
      title,
      instruction,
      owner:
        typeof args["owner"] === "string" && args["owner"] !== "" ? args["owner"] : defaults.owner,
      trigger,
      tools: [...new Set(tools)],
      missed: args["missed"] === "skip" ? "skip" : "once",
      createdAt: defaults.now,
    },
  };
};

const pad = (n: number) => String(n).padStart(2, "0");
const DAY_NAMES: Readonly<Record<Weekday, string>> = {
  sun: "Sunday",
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
};

/** When it runs, in words: "every day at 08:00", "Mondays and Fridays at 17:30", "when a session has waited 20 minutes". */
export const whenText = (trigger: UserJobTrigger): string => {
  if (trigger.kind === "time") {
    const at = `${pad(trigger.hour)}:${pad(trigger.minute)}`;
    return trigger.days.length === 0 || trigger.days.length === 7
      ? `every day at ${at}`
      : `${trigger.days.map((d) => `${DAY_NAMES[d]}s`).join(" and ")} at ${at}`;
  }
  if (trigger.event === "session_waiting")
    return `when a session has waited on you ${trigger.minutes} minutes`;
  return `${trigger.event === "build_failed" ? "when a build fails" : "when a job finishes"}, at most every ${trigger.minutes} minutes`;
};

/** The confirm card: what it will do, when, as whom, and with which tools. */
export const userJobCard = (job: Omit<UserJob, "on" | "proposed">, ownerName: string): string =>
  [
    `${job.title}`,
    `When: ${whenText(job.trigger)}.`,
    `What: ${job.instruction}`,
    `As: ${ownerName}. Tools: ${job.tools.join(", ")} (reading and reporting; anything else is held).`,
  ].join("\n");
