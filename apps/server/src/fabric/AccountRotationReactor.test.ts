import type { FabricAccount, FabricAccountPool } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { respawnPlan } from "./HerdrRespawn.ts";
import { limitReached, rotationTick, sourceWindowResetsAt } from "./AccountRotationReactor.ts";

const now = "2026-10-26T12:00:00.000Z";
const resets = "2026-10-26T15:00:00.000Z";

const account = (key: string, active: boolean, used: number): FabricAccount =>
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
  }) as unknown as FabricAccount;

const pool = (activeUsed: number, otherUsed = 10): FabricAccountPool =>
  ({
    driver: "claudeAgent",
    source: "cswap",
    configDir: "/home/dev/.claude",
    accounts: [account("a", true, activeUsed), account("b", false, otherUsed)],
    checkedAt: now,
  }) as unknown as FabricAccountPool;

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

describe("the respawn plan after a rotation (D67)", () => {
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
