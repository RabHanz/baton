import { describe, expect, it } from "vite-plus/test";

import { decideBinding, type BindingFacts } from "./BindingHealth.ts";

const SESSION = "cc828d1b-2b64-4a21-8aaf-2d1f0c2f99eb";
const base = (over: Partial<BindingFacts> = {}): BindingFacts => ({
  threadId: `baton-live4:${SESSION}`,
  sessionId: SESSION,
  session: { status: "waiting", pane: "fab-VentureOS~w1:p2" },
  thread: { instanceId: "baton-live", nativeId: SESSION, running: false },
  ...over,
});

describe("a live thread's binding", () => {
  it("replays the incident: handoff, stopped twin, unbound, running pane with the same session id", () => {
    // 1. A handoff moved the thread to a hosted provider; the real session still runs.
    const handoff = base({
      thread: { instanceId: "claudeAgent", nativeId: "a262f02b", running: false },
    });
    expect(decideBinding(handoff)).toEqual({ kind: "rebind-instance" });
    // 2. Back on the live instance but without its session (the unbound state): pointed at the session again.
    const unbound = base({ thread: { instanceId: "baton-live", nativeId: null, running: false } });
    expect(decideBinding(unbound)).toEqual({ kind: "rebind-native" });
    // 3. Healed: nothing more to do.
    expect(decideBinding(base())).toEqual({ kind: "ok" });
  });

  it("does nothing while no session runs under the id, and waits for a running turn", () => {
    expect(decideBinding(base({ session: null }))).toEqual({ kind: "no-session" });
    const working = base({ thread: { instanceId: "claudeAgent", nativeId: null, running: true } });
    expect(decideBinding(working)).toEqual({ kind: "wait" });
  });
});
