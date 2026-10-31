import { describe, expect, it } from "vite-plus/test";

import {
  accountForInstance,
  accountRefusal,
  accountReturnsAt,
  instanceForAccount,
} from "./accountPool.ts";

const spent = {
  label: "Optima",
  unusableReason: null,
  headroomPercent: 0,
  windows: [
    { id: "five_hour", label: "5h", usedPercent: 0, resetsAt: null },
    {
      id: "seven_day",
      label: "7d",
      usedPercent: 100,
      resetsAt: "2026-11-02T13:00:00.000Z",
    },
  ],
} as const;

describe("accountRefusal", () => {
  it("names when a spent account returns", () => {
    expect(accountReturnsAt(spent)).toBe("2026-11-02T13:00:00.000Z");
    expect(accountRefusal(spent)).toBe("Optima has no quota left until 2026-11-02 13:00 UTC");
  });

  it("refuses a signed-out account and lets an unread or roomy one through", () => {
    expect(accountRefusal({ ...spent, unusableReason: "signed-out" })).toBe("Optima is signed out");
    expect(accountRefusal({ ...spent, headroomPercent: 40 })).toBeNull();
    expect(accountRefusal({ ...spent, headroomPercent: null })).toBeNull();
  });
});

describe("instance and account mapping", () => {
  it("uses a token instance when it exists, else the default for the active account", () => {
    expect(instanceForAccount({ key: "5", active: false }, () => true)).toBe("claudeAgent_optima");
    expect(instanceForAccount({ key: "4", active: true }, () => false)).toBe("claudeAgent");
    expect(instanceForAccount({ key: "5", active: false }, () => false)).toBeNull();
  });

  it("reads a pinned instance's account, and the active one for the default", () => {
    const accounts = [
      { key: "4", active: true },
      { key: "6", active: false },
    ];
    expect(accountForInstance("claudeAgent_signzart", accounts)?.key).toBe("6");
    expect(accountForInstance("claudeAgent", accounts)?.key).toBe("4");
  });
});
