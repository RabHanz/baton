import type { EnvironmentId, FabricFleetEntry, ProjectId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildFabricScreenModel,
  fabricAvailability,
  FABRIC_QUICK_ACTIONS,
  handoffAvailability,
} from "./fabricFleetScreenModel";
import { fabricDeepLink, parseFabricDeepLink } from "./fabricNotificationLink";

const environmentId = "env-1" as EnvironmentId;

const entry = (overrides: Partial<FabricFleetEntry>): FabricFleetEntry =>
  ({
    workSessionId: "ws-scheduler",
    title: "Scheduler reconnect race",
    projectId: "project-ventureos" as ProjectId,
    lifecycle: "active",
    state: "working",
    needsUser: false,
    activeThreadId: "thread-a",
    threads: [
      {
        threadId: "thread-a",
        title: "Implementation",
        state: "working",
        providerInstanceId: "claude-a",
        providerDriver: "claudeAgent",
        branch: null,
        worktreePath: null,
        lastActivityAt: null,
      },
    ],
    synopsis: null,
    updatedAt: "2026-09-18T07:00:00.000Z",
    ...overrides,
  }) as unknown as FabricFleetEntry;

const model = (
  entries: ReadonlyArray<FabricFleetEntry>,
  needsUserOnly = false,
): ReturnType<typeof buildFabricScreenModel> =>
  buildFabricScreenModel({
    entries: entries.map((candidate) => ({ environmentId, entry: candidate })),
    resolveProjectLabel: () => "VentureOS",
    resolveEnvironmentLabel: () => "hetzner",
    resolveProviderLabel: () => "Claude A",
    now: Date.parse("2026-09-18T07:01:00.000Z"),
    needsUserOnly,
  });

describe("the phone's fleet screen", () => {
  it("shows the same rows the desktop shows", () => {
    // One builder, in shared. Two implementations of "does this need me" would
    // drift, and the phone is where that drift is discovered too late.
    const built = model([entry({})]);
    expect(built.rows).toHaveLength(1);
    expect(built.rows[0]?.heading).toBe("VentureOS / Scheduler reconnect race");
    expect(built.rows[0]?.attribution).toBe("Claude A · hetzner");
  });

  it("counts what needs the user before the filter hides it", () => {
    const built = model(
      [
        entry({}),
        entry({ workSessionId: "ws-two" as never, needsUser: true, state: "needs_approval" }),
      ],
      true,
    );
    expect(built.total).toBe(2);
    expect(built.needsUserCount).toBe(1);
    expect(built.rows).toHaveLength(1);
  });

  it("says something different for each kind of empty", () => {
    // "Nothing needs you" and "no work yet" are different facts, and a phone
    // glanced at for two seconds is exactly where conflating them misleads.
    expect(model([], false).emptyMessage).toBe("No work on this environment yet.");
    expect(model([entry({})], true).emptyMessage).toBe("Nothing needs you.");
  });

  it("offers the §20 questions as sentences the grammar already understands", () => {
    // Sentences rather than special-cased buttons: a button cannot drift from
    // what the same words would do typed out.
    expect(FABRIC_QUICK_ACTIONS.map((action) => action.sentence)).toEqual([
      "What needs me?",
      "What's running?",
      "What finished?",
    ]);
  });
});

describe("what the phone will not pretend to do", () => {
  it("names why handoff is missing rather than showing a dead button", () => {
    expect(handoffAvailability({ handoffImplemented: false, accountCount: 2 })).toEqual({
      available: false,
      reason: "Handing work to another account is not built yet.",
    });
    expect(handoffAvailability({ handoffImplemented: true, accountCount: 1 })).toEqual({
      available: false,
      reason: "Only one provider account is logged in on this environment.",
    });
    expect(handoffAvailability({ handoffImplemented: true, accountCount: 2 })).toEqual({
      available: true,
    });
  });

  it("names an environment that does not understand fabric at all", () => {
    expect(fabricAvailability({ capabilityAdvertised: false }).available).toBe(false);
    expect(fabricAvailability({ capabilityAdvertised: true })).toEqual({ available: true });
  });
});

describe("notification deep links", () => {
  it("opens the thread while the work still has one", () => {
    expect(
      fabricDeepLink({
        environmentId: "env-1",
        workSessionId: "ws-scheduler",
        activeThreadId: "thread-a",
      }),
    ).toBe("t3code://threads/env-1/thread-a");
  });

  it("opens the work itself once the thread has ended", () => {
    // The work outliving its provider thread is the whole point of the object.
    // A notification that opened a thread which no longer exists would be its
    // first broken promise.
    expect(
      fabricDeepLink({
        environmentId: "env-1",
        workSessionId: "ws-scheduler",
        activeThreadId: null,
      }),
    ).toBe("t3code://fabric/env-1/ws-scheduler");
  });

  it("reads its own links back, and leaves everyone else's alone", () => {
    expect(parseFabricDeepLink("t3code://fabric/env-1/ws-scheduler")).toEqual({
      environmentId: "env-1",
      workSessionId: "ws-scheduler",
    });
    expect(parseFabricDeepLink("t3code-dev://fabric/env-1/ws-scheduler")).not.toBeNull();
    // The thread links belong to the existing routing; claiming them would be
    // taking over navigation this parser does not understand.
    expect(parseFabricDeepLink("t3code://threads/env-1/thread-a")).toBeNull();
    expect(parseFabricDeepLink("t3code://fabric/env-1")).toBeNull();
  });

  it("survives an id with a slash or a space in it", () => {
    const url = fabricDeepLink({
      environmentId: "env one",
      workSessionId: "ws/scheduler",
      activeThreadId: null,
    });
    expect(parseFabricDeepLink(url)).toEqual({
      environmentId: "env one",
      workSessionId: "ws/scheduler",
    });
  });
});
