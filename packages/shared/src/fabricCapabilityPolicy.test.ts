import {
  DEFAULT_RETENTION,
  FabricIntentRisk,
  FabricRiskClass,
  type FabricCapabilityPolicy,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { buildAuditTrail } from "./fabricAudit.ts";
import {
  DEVELOPMENT_POLICY,
  PRODUCTION_POLICY,
  SUPERVISED_POLICY,
  defaultRiskFor,
  describeDecision,
  evaluateCapability,
  policyTemplate,
} from "./fabricCapabilityPolicy.ts";
import { describeRetention, expiredRecords } from "./fabricRetention.ts";

describe("the capability policy", () => {
  it("uses one risk vocabulary across the system", () => {
    // "High" has to mean one thing, or a policy and a refusal can disagree
    // about the same action.
    expect(FabricRiskClass.literals).toEqual(FabricIntentRisk.literals);
  });

  it("puts §24.1's high-risk work where §24.1 put it", () => {
    expect(defaultRiskFor("deployment")).toBe("high");
    expect(defaultRiskFor("databases")).toBe("high");
    expect(defaultRiskFor("source_control")).toBe("medium");
    expect(defaultRiskFor("files")).toBe("low");
  });

  it("lets low-risk work run on a development machine without asking", () => {
    expect(evaluateCapability({ policy: DEVELOPMENT_POLICY, capability: "files" })).toEqual({
      outcome: "allowed",
    });
  });

  it("asks before high-risk work even where everything is on", () => {
    // A confirmation the user sees every day is one they recognise when it
    // appears somewhere that matters.
    const decision = evaluateCapability({
      policy: DEVELOPMENT_POLICY,
      capability: "deployment",
    });
    expect(decision.outcome).toBe("needs_confirmation");
    expect(describeDecision(decision)).toContain("high-risk");
  });

  it("asks about medium work too once somebody else is watching", () => {
    expect(
      evaluateCapability({ policy: SUPERVISED_POLICY, capability: "source_control" }).outcome,
    ).toBe("needs_confirmation");
    expect(evaluateCapability({ policy: SUPERVISED_POLICY, capability: "files" }).outcome).toBe(
      "allowed",
    );
  });

  it("switches production's high-risk capabilities off rather than gating them", () => {
    // §24.2 allows a confirmation surface; this template does not use one,
    // because the confirmation would be a click on a phone in a taxi.
    const decision = evaluateCapability({ policy: PRODUCTION_POLICY, capability: "deployment" });
    expect(decision.outcome).toBe("refused");
    expect(describeDecision(decision)).toContain("production");
  });

  it("lets a preauthorisation lift a confirmation and never a refusal", () => {
    expect(
      evaluateCapability({
        policy: DEVELOPMENT_POLICY,
        capability: "deployment",
        preauthorised: true,
      }),
    ).toEqual({ outcome: "allowed" });
    // §24.2's exception is narrow on purpose: it lifts the ask, not the grant.
    expect(
      evaluateCapability({
        policy: PRODUCTION_POLICY,
        capability: "deployment",
        preauthorised: true,
      }).outcome,
    ).toBe("refused");
  });

  it("refuses a capability nobody declared", () => {
    const empty: FabricCapabilityPolicy = {
      template: "development",
      mode: "development",
      grants: [],
    };
    const decision = evaluateCapability({ policy: empty, capability: "browser" });
    expect(decision.outcome).toBe("refused");
    expect(describeDecision(decision)).toContain(
      "not part of this environment's capability policy",
    );
  });

  it("picks the template an environment's mode implies", () => {
    expect(policyTemplate("production").template).toBe("production");
    expect(policyTemplate("supervised").template).toBe("supervised");
    expect(policyTemplate("development").template).toBe("development");
  });
});

describe("retention", () => {
  const now = Date.parse("2026-09-18T00:00:00.000Z");
  // Fixed dates rather than arithmetic on a clock: the repository routes date
  // handling through Effect's `DateTime`, and a fixture does not need one.
  const TWO_DAYS_AGO = "2026-09-16T00:00:00.000Z";
  const FORTY_DAYS_AGO = "2026-08-09T00:00:00.000Z";
  const NINETY_DAYS_AGO = "2026-06-20T00:00:00.000Z";

  it("deletes what is past the horizon and nothing else", () => {
    const expired = expiredRecords({
      records: [
        { id: "old", at: FORTY_DAYS_AGO, refused: false },
        { id: "fresh", at: TWO_DAYS_AGO, refused: false },
      ],
      days: 30,
      keepRefusals: true,
      now,
    });
    expect(expired).toEqual(["old"]);
  });

  it("keeps refusals when the policy says to", () => {
    // A log that keeps only what worked cannot show a grammar its blind spots.
    const records = [{ id: "refused", at: NINETY_DAYS_AGO, refused: true }];
    expect(expiredRecords({ records, days: 30, keepRefusals: true, now })).toEqual([]);
    expect(expiredRecords({ records, days: 30, keepRefusals: false, now })).toEqual(["refused"]);
  });

  it("keeps a row whose date it cannot read", () => {
    // Deleting something because its timestamp would not parse is the wrong
    // way round.
    expect(
      expiredRecords({
        records: [{ id: "broken", at: "not a date", refused: false }],
        days: 1,
        keepRefusals: true,
        now,
      }),
    ).toEqual([]);
  });

  it("says what it keeps, in words a settings screen can show", () => {
    expect(describeRetention(DEFAULT_RETENTION)).toBe(
      "Fabric keeps sentences for 30 days, rule firings for 90 days, and refusals are kept.",
    );
    expect(describeRetention({ intentDays: 0, firingDays: 0, keepRefusals: false })).toBe(
      "Fabric keeps sentences are not kept, rule firings are not kept.",
    );
  });
});

describe("the audit trail", () => {
  it("merges what a person said, what a rule did, and what the environment did", () => {
    const trail = buildAuditTrail({
      intents: [
        {
          at: "2026-09-18T05:00:00.000Z",
          text: "When Claude finishes this, have Codex review it",
          outcome: "resolved",
          reply: "Created 2 rules.",
          refusalReason: null,
        },
      ],
      firings: [
        {
          startedAt: "2026-09-18T05:10:00.000Z",
          ruleId: "rule-1",
          triggeredBy: "on_done:idle",
          outcome: "completed",
          detail: "Started codex as review.",
        },
      ],
      providerSessions: [
        {
          attachedAt: "2026-09-18T04:00:00.000Z",
          detachedAt: "2026-09-18T06:00:00.000Z",
          providerInstanceId: "claude-a",
          role: "implementation",
          origin: "created",
        },
      ],
    });

    expect(trail.map((entry) => entry.actor)).toEqual([
      "environment",
      "rule",
      "user",
      "environment",
    ]);
    expect(trail[0]?.summary).toBe("claude-a released");
    expect(trail[2]?.summary).toContain("Created 2 rules.");
  });

  it("reads a refusal as a refusal", () => {
    const trail = buildAuditTrail({
      intents: [
        {
          at: "2026-09-18T05:00:00.000Z",
          text: "Deploy to production",
          outcome: "refused",
          reply: "That asks for a production deploy.",
          refusalReason: "high_risk",
        },
      ],
      firings: [],
      providerSessions: [],
    });
    expect(trail[0]?.summary).toContain("refused (high_risk)");
  });

  it("puts a person above the rule they set off, at the same instant", () => {
    const at = "2026-09-18T05:00:00.000Z";
    const trail = buildAuditTrail({
      intents: [{ at, text: "yes", outcome: "resolved", reply: "Confirmed.", refusalReason: null }],
      firings: [
        {
          startedAt: at,
          ruleId: "rule-1",
          triggeredBy: "after_rule:idle",
          outcome: "completed",
          detail: "",
        },
      ],
      providerSessions: [],
    });
    // Cause reads above effect rather than in whatever order the tables came
    // back.
    expect(trail.map((entry) => entry.actor)).toEqual(["user", "rule"]);
  });
});
