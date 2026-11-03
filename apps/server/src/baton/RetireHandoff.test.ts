import { describe, expect, it } from "vite-plus/test";
import * as Effect from "effect/Effect";

import { retireHandoff, retireToken, type RetirePorts } from "./RetireHandoff.ts";

const MAIN = "baton-live4:cc828d1b";
const TWIN = "baton-live4:a262f02b";

const fixture = (over: Partial<{ mainInstance: string; running: boolean; switchWorks: boolean }> = {}) => {
  const calls: string[] = [];
  let instance = over.mainInstance ?? "claudeAgent";
  const ports: RetirePorts = {
    shell: (id) =>
      Effect.succeed(
        id === MAIN
          ? { instanceId: instance, running: over.running ?? false }
          : { instanceId: "baton-live", running: false },
      ),
    selectLive: (id) =>
      Effect.sync(() => {
        calls.push(`live:${id}`);
        if (over.switchWorks !== false) instance = "baton-live";
      }),
    activeInstance: () => Effect.succeed(instance),
    archive: (id) => Effect.sync(() => (calls.push(`archive:${id}`), true)),
    remove: (id) => Effect.sync(() => (calls.push(`delete:${id}`), true)),
    writeUndo: () => (calls.push("undo"), "/tmp/undo.json"),
  };
  return { ports, calls };
};
const run = (f: ReturnType<typeof fixture>, over: Record<string, unknown> = {}) =>
  Effect.runPromise(
    retireHandoff(f.ports, {
      threadId: MAIN,
      twinThreadId: TWIN,
      confirm: retireToken(MAIN),
      caughtUp: true,
      ...over,
    }),
  );

describe("retiring a handoff session", () => {
  it("refuses without the token or the caught-up acknowledgement, and touches nothing", async () => {
    for (const over of [{ confirm: "yes" }, { caughtUp: false }]) {
      const f = fixture();
      expect((await run(f, over)).state).toBe("refused");
      expect(f.calls).toEqual([]);
    }
  });

  it("switches back to the live session, then writes the undo list, archives, then deletes the twin", async () => {
    const f = fixture();
    const result = await run(f);
    expect(result.state).toBe("retired");
    expect(f.calls).toEqual([`live:${MAIN}`, "undo", `archive:${TWIN}`, `delete:${TWIN}`]);
  });

  it("leaves the twin alone when the switch back did not take, or the thread is working or already live", async () => {
    const stuck = fixture({ switchWorks: false });
    expect((await run(stuck)).state).toBe("incomplete");
    expect(stuck.calls).toEqual([`live:${MAIN}`]);
    expect((await run(fixture({ running: true }))).state).toBe("refused");
    expect((await run(fixture({ mainInstance: "baton-live" }))).state).toBe("refused");
  });
});
