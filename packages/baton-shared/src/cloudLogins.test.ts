import { describe, expect, it } from "vite-plus/test";

import { cloudLoginsNeeds, cloudLoginsRow, parseCloudLogins } from "./cloudLogins.ts";

const NOW = Date.parse("2026-11-03T12:00:00Z");
const file = (accounts: unknown[], checkedAt = Math.floor(NOW / 1000) - 3 * 3600) => JSON.stringify({ checkedAt, accounts });
const ok = { account: "alpha", state: "ok", accessTokenExpiresInDays: 20 };

describe("cloud login health", () => {
  it("reads the box's file, in seconds, and drops what it does not know", () => {
    const parsed = parseCloudLogins(file([ok, { account: "x", state: "weird" }, { state: "ok" }]));
    expect(parsed?.accounts).toEqual([{ account: "alpha", state: "ok", accessTokenExpiresInDays: 20 }]);
    expect(parsed?.checkedAt).toBe(Math.floor(NOW / 1000) * 1000 - 3 * 3600_000);
    expect(parseCloudLogins("{}")).toBeNull();
    expect(parseCloudLogins("nope")).toBeNull();
  });

  it("says unknown without a report, works when all are good, and limited when one is not", () => {
    expect(cloudLoginsRow(null, NOW).state).toBe("unknown");
    expect(cloudLoginsRow(parseCloudLogins(file([ok])), NOW)).toMatchObject({ state: "works" });
    const bad = cloudLoginsRow(parseCloudLogins(file([ok, { account: "beta", state: "expired", accessTokenExpiresInDays: -1 }])), NOW);
    expect(bad.state).toBe("limited");
    expect(bad.why).toContain("beta: expired");
    expect(cloudLoginsRow(parseCloudLogins(file([ok], Math.floor(NOW / 1000) - 4 * 86400)), NOW).state).toBe("limited");
    expect(cloudLoginsRow(parseCloudLogins(file([])), NOW).state).toBe("unknown");
  });

  it("needs him, by account name, when a login will lapse or has", () => {
    const rows = cloudLoginsNeeds(
      parseCloudLogins(file([ok, { account: "beta", state: "renew-soon", accessTokenExpiresInDays: 2 }, { account: "gamma", state: "expired", accessTokenExpiresInDays: -3 }, { account: "delta", state: "not-logged-in" }])),
      NOW,
    );
    expect(rows.map((r) => r.title)).toEqual([
      "Renew the cloud login for beta: it needs you at a browser",
      "Renew the cloud login for gamma: it needs you at a browser",
    ]);
    expect(rows[0]!.why).toContain("2 days");
    expect(cloudLoginsNeeds(null, NOW)).toEqual([]);
  });
});
