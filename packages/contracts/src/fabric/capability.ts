/**
 * The capability plane (§23) and the policy that governs it (§24).
 *
 * §23's objective in one line: Claude A, Claude B, Codex and Hermes reach the
 * same governed capabilities rather than each carrying its own. Its own
 * instruction is equally clear — *do not implement every capability during the
 * first Fabric milestone; build the registration/policy abstraction first, then
 * migrate tools incrementally.* So this module is the abstraction and the
 * policy, and it deliberately implements none of the capabilities.
 *
 * What that buys immediately, before a single tool moves: a place where "may
 * this session deploy?" has one answer, computed from the environment's mode
 * and the risk class, instead of being a decision each provider's tool
 * configuration makes on its own.
 *
 * @module fabric/capability
 */
import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString, TrimmedString } from "../baseSchemas.ts";

/**
 * §23's list. A closed union rather than a string: a capability nobody declared
 * is a capability nobody reviewed, and the point of a plane is that the set is
 * knowable.
 */
export const FabricCapability = Schema.Literals([
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
export type FabricCapability = typeof FabricCapability.Type;

/**
 * §24.1's classes.
 *
 * The same three words the intent surface uses for a sentence's risk, and
 * deliberately the same scale: "high" has to mean one thing across the system,
 * or a policy and a refusal can disagree about the same action. A test pins the
 * two literal sets together.
 */
export const FabricRiskClass = Schema.Literals(["low", "medium", "high"]);
export type FabricRiskClass = typeof FabricRiskClass.Type;

/**
 * What an environment is for. §24.2: *production environments default to
 * supervised/strict behaviour*, so the mode is a property of the environment
 * rather than a per-action choice somebody can forget.
 */
export const FabricEnvironmentMode = Schema.Literals(["development", "supervised", "production"]);
export type FabricEnvironmentMode = typeof FabricEnvironmentMode.Type;

/**
 * One capability, as this environment grants it.
 *
 * `requiresConfirmation` is separate from `enabled` on purpose: §24.2's
 * high-risk rule is not "off", it is "not without an explicit confirmation
 * surface", and collapsing the two would lose the difference between a thing
 * you may not do and a thing you must be asked about.
 */
export const FabricCapabilityGrant = Schema.Struct({
  capability: FabricCapability,
  risk: FabricRiskClass,
  enabled: Schema.Boolean,
  requiresConfirmation: Schema.Boolean,
  /** Why it is off or gated, in words a person can act on. */
  reason: TrimmedString,
});
export type FabricCapabilityGrant = typeof FabricCapabilityGrant.Type;

export const FabricCapabilityPolicy = Schema.Struct({
  /** Which template this started from, so a drifted policy is visible. */
  template: FabricEnvironmentMode,
  mode: FabricEnvironmentMode,
  grants: Schema.Array(FabricCapabilityGrant),
});
export type FabricCapabilityPolicy = typeof FabricCapabilityPolicy.Type;

/** The answer to "may this happen?", with the reason when it may not. */
export const FabricCapabilityDecision = Schema.Union([
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
export type FabricCapabilityDecision = typeof FabricCapabilityDecision.Type;

// ---------------------------------------------------------------------------
// Retention (§26)
// ---------------------------------------------------------------------------

/**
 * How long Fabric keeps what it wrote down.
 *
 * §26's defaults are about voice, and the principle generalises: keep what
 * became a command, not the stream it arrived on. Fabric's own logs — every
 * sentence, every rule firing — are useful for days and are a liability for
 * ever, so they have a horizon and it is a setting rather than a habit.
 */
export const FabricRetentionPolicy = Schema.Struct({
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
export type FabricRetentionPolicy = typeof FabricRetentionPolicy.Type;

export const DEFAULT_RETENTION: FabricRetentionPolicy = {
  intentDays: 30,
  firingDays: 90,
  keepRefusals: true,
};
