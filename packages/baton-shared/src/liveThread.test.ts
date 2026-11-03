import { describe, expect, it } from "vite-plus/test";

import { classifierStopReason, describeAnswerer, liveThreadSwitchRefusal } from "./liveThread.ts";

describe("a mirrored live thread", () => {
  const live = "baton-live4:cc828d1b";
  it("refuses a turn that would hand it off to another provider instance", () => {
    expect(
      liveThreadSwitchRefusal({
        threadId: live,
        currentInstance: "baton-live",
        targetInstance: "claudeAgent",
      }),
    ).toContain("answered only by it");
  });
  it("lets it stay live, lets a handed-off one go back, and leaves ordinary threads alone", () => {
    const ok = (threadId: string, currentInstance: string, targetInstance: string) =>
      liveThreadSwitchRefusal({ threadId, currentInstance, targetInstance });
    expect(ok(live, "baton-live", "baton-live")).toBeNull();
    expect(ok(live, "claudeAgent", "baton-live")).toBeNull();
    // A thread already moved to a handoff session cannot wake it again.
    expect(ok(live, "claudeAgent", "claudeAgent")).toContain("handoff session");
    expect(ok("import:claudeAgent:x", "claudeAgent", "codex")).toBeNull();
  });
});

describe("who answers a thread", () => {
  it("names the harness, session, model, effort and account, and flags a summary handoff on a live thread", () => {
    const live = describeAnswerer({
      threadId: "baton-live4:cc828d1b-1111",
      instanceId: "baton-live",
      model: "claude-opus-5-5",
      effort: "medium",
      account: "Main",
    });
    expect(live).toMatchObject({ harness: "herdr-session", handedOff: false });
    expect(live.line).toBe("Terminal session · cc828d1b · claude-opus-5-5 · medium · Main");
    const twin = describeAnswerer({
      threadId: "baton-live4:cc828d1b-1111",
      instanceId: "claudeAgent",
      model: "claude-opus-5-5",
    });
    expect(twin).toMatchObject({ harness: "t3-hosted", handedOff: true });
  });
});

describe("a reply stopped by the safety classifier", () => {
  it("names the reason from the session's own wording, and only then", () => {
    expect(
      classifierStopReason(
        "Your response above was stopped by a safety classifier. Try rephrasing.",
      ),
    ).toBe("Stopped by a safety classifier: rephrase or switch model for this session");
    expect(classifierStopReason("Here is the plan.")).toBeNull();
    expect(classifierStopReason(null)).toBeNull();
  });
});
