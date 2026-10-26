/* oxlint-disable t3code/no-low-value-comments -- Baton file predating upstream's rule (D82) */
/**
 * The capability plane (§23) and the policy that governs it (§24).
 *
 * §23's objective in one line: Claude A, Claude B, Codex and Hermes reach the
 * same governed capabilities rather than each carrying its own. Its own
 * instruction is equally clear — *do not implement every capability during the
 * first Baton milestone; build the registration/policy abstraction first, then
 * migrate tools incrementally.* So this module is the abstraction and the
 * policy, and it deliberately implements none of the capabilities.
 *
 * What that buys immediately, before a single tool moves: a place where "may
 * this session deploy?" has one answer, computed from the environment's mode
 * and the risk class, instead of being a decision each provider's tool
 * configuration makes on its own.
 *
 * @module baton/capability
 */
import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString, TrimmedString } from "@t3tools/contracts";

/**
 * §23's list. A closed union rather than a string: a capability nobody declared
 * is a capability nobody reviewed, and the point of a plane is that the set is
 * knowable.
 */
export const BatonCapability = Schema.Literals([
  "source_control",
  "browser",
  "machines",
  "files",
  "deployment",
  "email",
  "calendar",
  "internal_apis",
  "databases",
  "artifacts",
  "memory",
  "notifications",
]);
export type BatonCapability = typeof BatonCapability.Type;

/**
 * §24.1's classes.
 *
 * The same three words the intent surface uses for a sentence's risk, and
 * deliberately the same scale: "high" has to mean one thing across the system,
 * or a policy and a refusal can disagree about the same action. A test pins the
 * two literal sets together.
 */
export const BatonRiskClass = Schema.Literals(["low", "medium", "high"]);
export type BatonRiskClass = typeof BatonRiskClass.Type;

/**
 * What an environment is for. §24.2: *production environments default to
 * supervised/strict behaviour*, so the mode is a property of the environment
 * rather than a per-action choice somebody can forget.
 */
export const BatonEnvironmentMode = Schema.Literals(["development", "supervised", "production"]);
export type BatonEnvironmentMode = typeof BatonEnvironmentMode.Type;

/**
 * One capability, as this environment grants it.
 *
 * `requiresConfirmation` is separate from `enabled` on purpose: §24.2's
 * high-risk rule is not "off", it is "not without an explicit confirmation
 * surface", and collapsing the two would lose the difference between a thing
 * you may not do and a thing you must be asked about.
 */
export const BatonCapabilityGrant = Schema.Struct({
  capability: BatonCapability,
  risk: BatonRiskClass,
  enabled: Schema.Boolean,
  requiresConfirmation: Schema.Boolean,
  /** Why it is off or gated, in words a person can act on. */
  reason: TrimmedString,
});
export type BatonCapabilityGrant = typeof BatonCapabilityGrant.Type;

export const BatonCapabilityPolicy = Schema.Struct({
  /** Which template this started from, so a drifted policy is visible. */
  template: BatonEnvironmentMode,
  mode: BatonEnvironmentMode,
  grants: Schema.Array(BatonCapabilityGrant),
});
export type BatonCapabilityPolicy = typeof BatonCapabilityPolicy.Type;

/** The answer to "may this happen?", with the reason when it may not. */
export const BatonCapabilityDecision = Schema.Union([
  Schema.Struct({ outcome: Schema.Literal("allowed") }),
  Schema.Struct({
    /** Allowed, once somebody says yes. §24.2's confirmation surface. */
    outcome: Schema.Literal("needs_confirmation"),
    prompt: TrimmedNonEmptyString,
  }),
  Schema.Struct({
    outcome: Schema.Literal("refused"),
    reason: TrimmedNonEmptyString,
  }),
]);
export type BatonCapabilityDecision = typeof BatonCapabilityDecision.Type;

// ---------------------------------------------------------------------------
// Retention (§26)
// ---------------------------------------------------------------------------

/**
 * How long Baton keeps what it wrote down.
 *
 * §26's defaults are about voice, and the principle generalises: keep what
 * became a command, not the stream it arrived on. Baton's own logs — every
 * sentence, every rule firing — are useful for days and are a liability for
 * ever, so they have a horizon and it is a setting rather than a habit.
 */
export const BatonRetentionPolicy = Schema.Struct({
  /** Days to keep the intent log. Zero means keep nothing beyond today. */
  intentDays: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 3650 })),
  /** Days to keep orchestration firings. */
  firingDays: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 3650 })),
  /**
   * Whether refused intents are kept as long as the rest. On by default: a log
   * that keeps only what worked cannot show a grammar its own blind spots.
   */
  keepRefusals: Schema.Boolean,
});
export type BatonRetentionPolicy = typeof BatonRetentionPolicy.Type;

export const DEFAULT_RETENTION: BatonRetentionPolicy = {
  intentDays: 30,
  firingDays: 90,
  keepRefusals: true,
};
