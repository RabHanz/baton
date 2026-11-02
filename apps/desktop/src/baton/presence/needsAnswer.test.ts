import type { BatonJob, WatchFinding } from "@t3tools/baton-contracts";
import { describe, expect, it } from "vite-plus/test";

import { answerNeeds } from "./needsAnswer.ts";

describe("answering what needs me", () => {
  it("lists the failed session first and says a source it could not read", async () => {
    const text = await answerNeeds({
      jobs: [] as ReadonlyArray<BatonJob>,
      sessions: [],
      findings: [
        { workSessionId: "w1", title: "Deploy", kind: "failed", minutes: 20 },
      ] as unknown as ReadonlyArray<WatchFinding>,
      config: { repos: ["o/r"], deadlinesFile: null },
      now: Date.parse("2026-11-02T12:00:00Z"),
      run: async () => {
        throw new Error("offline");
      },
    });
    expect(text).toBe("1. Deploy: failed (20 min) [id: w1]\nI could not read: the ledger o/r.");
  });
});
