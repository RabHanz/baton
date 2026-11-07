import { describe, expect, it } from "vite-plus/test";

import {
  DEFAULT_USER_JOB_TOOLS,
  MIN_EVENT_MINUTES,
  userJobCard,
  userJobFromArgs,
  whenText,
} from "./userJobs.ts";

const defaults = { owner: "executive", id: "user:1", now: 0, owners: ["executive", "operations"] };

describe("his own standing jobs, from the assistant's job_create call", () => {
  it("takes a time job, read and report by default", () => {
    const made = userJobFromArgs(
      {
        title: "Morning CI check",
        instruction: "Check CI on tessaya and tell me what broke",
        trigger: { kind: "time", hour: 8 },
      },
      defaults,
    );
    if (!("job" in made)) throw new Error(made.refused);
    expect(made.job.trigger).toEqual({ kind: "time", hour: 8, minute: 0, days: [] });
    expect(made.job.tools).toEqual(DEFAULT_USER_JOB_TOOLS);
    expect(made.job.owner).toBe("executive");
    expect(made.job.missed).toBe("once");
    expect(whenText(made.job.trigger)).toBe("every day at 08:00");
    expect(userJobCard(made.job, "Tessaya")).toContain("Tools: jobs_list");
  });

  it("keeps only tools that may run with nobody there, and refuses a job left with none", () => {
    const made = userJobFromArgs(
      {
        title: "t",
        instruction: "i",
        trigger: { kind: "time", hour: 9 },
        tools: ["watch_report", "type_text", "session_send", "job_start", "skill_draft"],
      },
      defaults,
    );
    expect("job" in made && made.job.tools).toEqual(["watch_report"]);
    expect(
      userJobFromArgs(
        { title: "t", instruction: "i", trigger: { kind: "time", hour: 9 }, tools: ["click"] },
        defaults,
      ),
    ).toEqual({ refused: "His own jobs only read and report; none of those tools does." });
  });

  it("gives an event job at least the minimum gap", () => {
    const made = userJobFromArgs(
      {
        title: "Waiting nudge",
        instruction: "Remind me",
        trigger: { kind: "event", event: "session_waiting", minutes: 5 },
      },
      defaults,
    );
    if (!("job" in made)) throw new Error(made.refused);
    expect(made.job.trigger).toEqual({
      kind: "event",
      event: "session_waiting",
      minutes: MIN_EVENT_MINUTES,
    });
    expect(whenText({ kind: "event", event: "session_waiting", minutes: 20 })).toBe(
      "when a session has waited on you 20 minutes",
    );
  });

  it.each([
    [{ title: "t", instruction: "i", trigger: { kind: "time", hour: 25 } }, "hour"],
    [
      { title: "t", instruction: "i", trigger: { kind: "time", hour: 8, days: ["funday"] } },
      "Days",
    ],
    [{ title: "t", instruction: "i", trigger: { kind: "event", event: "rain" } }, "event"],
    [{ title: "", instruction: "i", trigger: { kind: "time", hour: 8 } }, "title"],
    [{ title: "t", instruction: "i", trigger: { kind: "monthly" } }, "trigger"],
    [{ title: "t", instruction: "i", trigger: { kind: "time", hour: 8, days: "mon" } }, "list"],
    [
      { title: "t", instruction: "i", trigger: { kind: "time", hour: 8 }, owner: "nobody" },
      "persona",
    ],
  ])("refuses %j in words", (args, word) => {
    const made = userJobFromArgs(args, defaults);
    expect("refused" in made && made.refused).toContain(word);
  });

  it("says a weekly time back", () => {
    expect(whenText({ kind: "time", hour: 17, minute: 30, days: ["mon", "fri"] })).toBe(
      "Mondays and Fridays at 17:30",
    );
  });
});
