import { describe, expect, it } from "vite-plus/test";

import {
  autoResumeAllowed,
  classifyTranscriptTail,
  emptyAutoResumeState,
  markStoppedOnPurpose,
  recordAutoResume,
  RESTART_NOTICE,
} from "./AutoResume.ts";

const line = (o: unknown) => JSON.stringify(o);
const user = (content: unknown, extra: Record<string, unknown> = {}) =>
  line({ type: "user", message: { role: "user", content }, ...extra });
const assistant = (content: unknown, stop: string | null | undefined) =>
  line({
    type: "assistant",
    message: { role: "assistant", content, ...(stop === undefined ? {} : { stop_reason: stop }) },
  });

describe("what the end of a transcript says about the last turn", () => {
  it("is unfinished when the last entry is a question nobody answered", () => {
    expect(
      classifyTranscriptTail(
        [assistant([{ type: "text", text: "Done" }], "end_turn"), user("Now fix the tests")].join(
          "\n",
        ),
      ),
    ).toBe("unfinished");
  });
  it("is unfinished on a tool call with no result, a tool result nobody read, or an assistant cut off mid-turn", () => {
    const call = assistant([{ type: "tool_use", id: "t1", name: "Bash", input: {} }], "tool_use");
    expect(classifyTranscriptTail([user("go"), call].join("\n"))).toBe("unfinished");
    expect(
      classifyTranscriptTail(
        [user("go"), call, user([{ type: "tool_result", tool_use_id: "t1", content: "ok" }])].join(
          "\n",
        ),
      ),
    ).toBe("unfinished");
    expect(
      classifyTranscriptTail(
        [user("go"), assistant([{ type: "text", text: "Working on" }], null)].join("\n"),
      ),
    ).toBe("unfinished");
  });
  it("is finished after a clean end of turn, and when he interrupted or left on purpose", () => {
    expect(
      classifyTranscriptTail(
        [user("hi"), assistant([{ type: "text", text: "Hello" }], "end_turn")].join("\n"),
      ),
    ).toBe("finished");
    expect(
      classifyTranscriptTail(
        [user("go"), user([{ type: "text", text: "[Request interrupted by user]" }])].join("\n"),
      ),
    ).toBe("finished");
    expect(
      classifyTranscriptTail([user("hi"), user("<command-name>/exit</command-name>")].join("\n")),
    ).toBe("finished");
  });
  it("skips lines that are not conversation, and does not guess from nothing or from an old format", () => {
    expect(
      classifyTranscriptTail(
        [user("hi"), line({ type: "summary", summary: "x" }), "{broken"].join("\n"),
      ),
    ).toBe("unfinished");
    expect(classifyTranscriptTail("")).toBe("unknown");
    expect(
      classifyTranscriptTail(
        [user("hi"), assistant([{ type: "text", text: "ok" }], undefined)].join("\n"),
      ),
    ).toBe("unknown");
  });
});

describe("when the watchdog may resume a session", () => {
  const base = {
    verdict: "unfinished" as const,
    background: false,
    enabled: true,
    running: false,
    now: 1_000_000_000,
  };
  it("resumes an unfinished session and says it was restarted", () => {
    expect(
      autoResumeAllowed({ ...base, state: emptyAutoResumeState, sessionId: "s1" }).resume,
    ).toBe(true);
    expect(RESTART_NOTICE).toMatch(/restarted after your process stopped/);
  });
  it("never when it is off, finished, a background run, already live, or he stopped it on purpose", () => {
    const stopped = markStoppedOnPurpose(emptyAutoResumeState, "s1");
    for (const input of [
      { ...base, enabled: false },
      { ...base, verdict: "finished" as const },
      { ...base, verdict: "unknown" as const },
      { ...base, background: true },
      { ...base, running: true },
    ])
      expect(
        autoResumeAllowed({ ...input, state: emptyAutoResumeState, sessionId: "s1" }).resume,
      ).toBe(false);
    expect(autoResumeAllowed({ ...base, state: stopped, sessionId: "s1" }).resume).toBe(false);
  });
  it("at most three times an hour for one session", () => {
    let state = emptyAutoResumeState;
    for (let i = 0; i < 3; i += 1) state = recordAutoResume(state, "s1", base.now + i * 1000);
    expect(
      autoResumeAllowed({ ...base, now: base.now + 5000, state, sessionId: "s1" }).resume,
    ).toBe(false);
    expect(
      autoResumeAllowed({ ...base, now: base.now + 5000, state, sessionId: "other" }).resume,
    ).toBe(true);
    expect(
      autoResumeAllowed({ ...base, now: base.now + 3_700_000, state, sessionId: "s1" }).resume,
    ).toBe(true);
  });
});
