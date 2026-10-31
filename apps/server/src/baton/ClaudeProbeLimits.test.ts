import { accountForInstance, type BatonAccount } from "@t3tools/baton-contracts";
import { describe, expect, it } from "vite-plus/test";

import { limitsFromAccount } from "./ClaudeProbeLimits.ts";

const account = (overrides: Partial<BatonAccount>): BatonAccount => ({
  key: "4",
  label: "rabee",
  email: null,
  organizationName: null,
  active: false,
  usable: true,
  unusableReason: null,
  headroomPercent: 77,
  windows: [
    { id: "five_hour", label: "5h", usedPercent: 4, resetsAt: "2026-10-30T20:50:00.000Z" },
    { id: "seven_day", label: "7d", usedPercent: 23, resetsAt: null },
    { id: "seven_day_opus", label: "7d (large model)", usedPercent: 10, resetsAt: null },
  ],
  usageCheckedAt: "2026-10-30T17:42:49.000Z",
  ...overrides,
});

describe("accountForInstance", () => {
  const pool = [
    account({ active: true }),
    account({ key: "5", label: "optima" }),
    account({ key: "6", label: "signzart" }),
  ];

  it("gives a token instance its own slot, whoever is active", () => {
    expect(accountForInstance("claudeAgent_optima", pool)?.label).toBe("optima");
    expect(accountForInstance("claudeAgent_signzart", pool)?.label).toBe("signzart");
  });

  it("gives the default instance the active account", () => {
    expect(accountForInstance("claudeAgent", pool)?.label).toBe("rabee");
  });
});

describe("limitsFromAccount", () => {
  it("keeps the reading's own time and T3's session and weekly windows", () => {
    const limits = limitsFromAccount(account({}));
    expect(limits?.checkedAt).toBe("2026-10-30T17:42:49.000Z");
    expect(limits?.unavailable).toBeUndefined();
    expect(limits?.windows.map((window) => [window.id, window.usedPercent])).toEqual([
      ["five_hour", 4],
      ["seven_day", 23],
    ]);
    expect(limits?.windows[0]?.resetsAt).toBe("2026-10-30T20:50:00.000Z");
    expect(limits?.windows[1]).not.toHaveProperty("resetsAt");
  });

  it("offers nothing rather than an empty reading", () => {
    expect(limitsFromAccount(undefined)).toBeUndefined();
    expect(limitsFromAccount(account({ usageCheckedAt: null }))).toBeUndefined();
    expect(limitsFromAccount(account({ windows: [] }))).toBeUndefined();
  });
});
