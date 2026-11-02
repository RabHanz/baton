import { describe, expect, it } from "vite-plus/test";

import { buildNightly, nightlyRow, parseNightly, resultOf } from "./nightly.ts";

const NOW = Date.parse("2026-11-03T06:00:00Z");
const status = (outcomes: Record<string, string | undefined>) =>
  buildNightly({
    now: "2026-11-03T03:30:00Z",
    runUrl: "https://example.test/run/1",
    main: "abc1234",
    release: "baton-v0.1.40",
    checks: Object.entries(outcomes).map(([key, outcome]) => ({ name: key.split("@")[0]!, ref: key.endsWith("@release") ? "release" : "main", outcome })),
  });

describe("the nightly status file", () => {
  it("maps job outcomes to pass, fail or skipped, and round-trips through the file", () => {
    expect([resultOf("success"), resultOf("failure"), resultOf("cancelled"), resultOf("skipped"), resultOf(undefined)]).toEqual(["pass", "fail", "fail", "skipped", "skipped"]);
    const built = status({ "memory evals": "success", "voice proof@release": "failure" });
    expect(parseNightly(JSON.stringify(built))).toEqual(built);
    expect(parseNightly("{}")).toBeNull();
    expect(parseNightly("not json")).toBeNull();
    expect(parseNightly(JSON.stringify({ ...built, checks: [{ name: "x", ref: "main", result: "maybe" }] }))).toBeNull();
  });

  it("tells the Now page what works, what failed on which build, and when it does not know", () => {
    expect(nightlyRow(status({ "memory evals": "success", "intent harness": "success", "hands loop": "skipped" }), NOW)).toMatchObject({ state: "works", why: "All 2 checks passed 2 h ago." });
    const bad = nightlyRow(status({ "memory evals": "success", "voice proof@release": "failure" }), NOW);
    expect(bad).toMatchObject({ state: "limited" });
    expect(bad.why).toContain("1 of 2 checks failed");
    expect(bad.why).toContain("voice proof on baton-v0.1.40");
    expect(nightlyRow(null, NOW).state).toBe("unknown");
    expect(nightlyRow(status({ "memory evals": "success" }), NOW + 3 * 86_400_000)).toMatchObject({ state: "limited" });
  });
});
