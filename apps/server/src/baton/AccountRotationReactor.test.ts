import type { BatonAccount, BatonAccountPool } from "@t3tools/baton-contracts";
import { ProviderInstanceId, ThreadId, type ServerProvider } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { at, v2Shell } from "./__fixtures__/v2ThreadShell.ts";
import { respawnPlan } from "./HerdrRespawn.ts";
import {
  limitReached,
  planThreadMoves,
  rotationTick,
  sourceWindowResetsAt,
} from "./AccountRotationReactor.ts";

const now = "2026-10-26T12:00:00.000Z";
const resets = "2026-10-26T15:00:00.000Z";

const account = (key: string, active: boolean, used: number): BatonAccount =>
  ({
    key,
    label: key,
    email: null,
    organizationName: null,
    active,
    usable: true,
    unusableReason: null,
    headroomPercent: 100 - used,
    windows: [
      { id: "five_hour", label: "5h", usedPercent: used, resetsAt: resets },
      { id: "weekly", label: "week", usedPercent: 10, resetsAt: null },
    ],
    usageCheckedAt: now,
  }) as unknown as BatonAccount;

const pool = (activeUsed: number, otherUsed = 10): BatonAccountPool =>
  ({
    driver: "claudeAgent",
    source: "cswap",
    configDir: "/home/dev/.claude",
    accounts: [account("a", true, activeUsed), account("b", false, otherUsed)],
    checkedAt: now,
  }) as unknown as BatonAccountPool;

describe("the automatic rotation trigger (D63)", () => {
  it("reads the spent window as a reported limit and its reset as the window", () => {
    expect(limitReached(pool(100))).toBe(true);
    expect(limitReached(pool(50))).toBe(false);
    expect(sourceWindowResetsAt(pool(100))).toBe(resets);
  });

  it("rotates to the account with room when the active one is spent", () => {
    const decision = rotationTick({
      pool: pool(100),
      policy: "auto",
      lastAutoRotationAt: null,
      now,
    });
    expect(decision.outcome).toBe("rotate");
    if (decision.outcome === "rotate") {
      expect(decision.target.key).toBe("b");
      expect(decision.reason).toBe("limit");
    }
  });

  it("does nothing while the account still has room, or when the machine says ask", () => {
    expect(
      rotationTick({ pool: pool(40), policy: "auto", lastAutoRotationAt: null, now }).outcome,
    ).toBe("hold");
    expect(
      rotationTick({ pool: pool(100), policy: "ask", lastAutoRotationAt: null, now }).outcome,
    ).toBe("hold");
  });

  it("rotates once per limit window, never back and forth", () => {
    const decision = rotationTick({
      pool: pool(100),
      policy: "auto",
      lastAutoRotationAt: "2026-10-26T11:00:00.000Z",
      now,
    });
    expect(decision).toEqual({ outcome: "hold", reason: "already-rotated-this-window" });
  });
});

const GROUP = "claude:home:/home/dev/.claude";
const instance = (
  id: string,
  used: number | null,
  extra: Partial<Record<string, unknown>> = {},
): ServerProvider =>
  ({
    instanceId: ProviderInstanceId.make(id),
    driver: "claudeAgent",
    displayName: id,
    enabled: true,
    installed: true,
    auth: { status: "authenticated" },
    continuation: { groupKey: GROUP },
    ...(used === null
      ? {}
      : {
          usageLimits: {
            checkedAt: now,
            windows: [
              {
                id: "five_hour",
                kind: "session",
                label: "Session",
                usedPercent: used,
                resetsAt: resets,
              },
            ],
          },
        }),
    ...extra,
  }) as unknown as ServerProvider;

const thread = (id: string, instanceId: string, status: "running" | "idle") =>
  v2Shell({
    id: ThreadId.make(id),
    status,
    providerInstanceId: ProviderInstanceId.make(instanceId),
    createdAt: at(now),
  });

describe("native rotation of T3 threads (L-76)", () => {
  const plan = (providers: ReadonlyArray<ServerProvider>, last = new Map<string, string>()) =>
    planThreadMoves({
      providers,
      shells: [
        thread("busy", "a", "running"),
        thread("idle", "a", "idle"),
        thread("ok", "b", "running"),
      ],
      lastAutoRotationAt: last,
      now,
    });

  it("moves the working threads of a spent instance to the one with most room, and leaves idle ones", () => {
    const moves = plan([instance("a", 97), instance("b", 40), instance("c", 10)]);
    expect(moves.map((move) => [move.from?.key, move.target.key, move.threadIds])).toEqual([
      ["a", "c", ["busy"]],
    ]);
  });

  it("never moves onto an instance with unread limits, signed out, or with other transcripts", () => {
    expect(
      plan([
        instance("a", 100),
        instance("b", 40, { usageLimits: undefined, displayName: "b" }),
        instance("c", null),
        instance("d", 0, { auth: { status: "unauthenticated" } }),
        instance("e", 0, { continuation: { groupKey: "claude:home:/elsewhere" } }),
      ]).filter((move) => move.from?.key === "a"),
    ).toEqual([]);
  });

  it("holds a second move inside the same limit window", () => {
    const last = new Map([["a", "2026-10-26T11:00:00.000Z"]]);
    expect(plan([instance("a", 100), instance("c", 10)], last)).toEqual([]);
  });
});

describe("the respawn plan after a rotation (D69)", () => {
  it("exits, waits for the shell, and resumes the same conversation in the same pane", () => {
    const plan = respawnPlan("fab-api~w1:p2", "cc828d1b-2b64");
    expect(plan.exit[0]).toEqual(["--session", "fab-api", "pane", "send-text", "w1:p2", "/exit"]);
    expect(plan.resume).toEqual([
      "--session",
      "fab-api",
      "pane",
      "run",
      "w1:p2",
      "claude --resume cc828d1b-2b64",
    ]);
    expect(respawnPlan("w1:p1", "x").prefix).toEqual([]);
  });
});
