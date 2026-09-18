/**
 * §24.2's policy, as a function, and §23's templates.
 *
 * One place answers "may this happen here?", and its answer depends on two
 * facts and nothing else: what the environment is for, and what class the
 * action is. Every provider, every rule and every sentence goes through the
 * same evaluation, which is the entire point of a plane — the alternative is
 * each provider's tool configuration deciding on its own and nobody being able
 * to say what the system as a whole permits.
 *
 * §24.2's rules, in the order they bite:
 *
 *   - low-risk follows the provider's normal permission mode;
 *   - medium-risk respects the provider's approvals;
 *   - **high-risk needs an explicit confirmation on top**, unless a narrowly
 *     scoped preauthorisation exists;
 *   - production defaults to supervised behaviour;
 *   - global "full access" is never turned on for convenience.
 *
 * @module fabricCapabilityPolicy
 */
import type {
  FabricCapability,
  FabricCapabilityDecision,
  FabricCapabilityGrant,
  FabricCapabilityPolicy,
  FabricEnvironmentMode,
  FabricRiskClass,
} from "@t3tools/contracts";

/**
 * §24.1's list, mapped onto capabilities.
 *
 * Deployment and databases are high because §24.1 says production deploys and
 * destructive database operations are; source control is medium because pushing
 * a branch and opening a pull request are; reading files and taking screenshots
 * are low.
 */
const DEFAULT_RISK: Readonly<Record<FabricCapability, FabricRiskClass>> = {
  source_control: "medium",
  browser: "medium",
  machines: "medium",
  files: "low",
  deployment: "high",
  email: "high",
  calendar: "medium",
  internal_apis: "medium",
  databases: "high",
  artifacts: "low",
  memory: "low",
  notifications: "low",
};

export const defaultRiskFor = (capability: FabricCapability): FabricRiskClass =>
  DEFAULT_RISK[capability];

const grant = (
  capability: FabricCapability,
  overrides?: Partial<Omit<FabricCapabilityGrant, "capability">>,
): FabricCapabilityGrant => ({
  capability,
  risk: DEFAULT_RISK[capability],
  enabled: true,
  requiresConfirmation: DEFAULT_RISK[capability] === "high",
  reason: "",
  ...overrides,
});

const ALL: ReadonlyArray<FabricCapability> = Object.keys(DEFAULT_RISK) as FabricCapability[];

/**
 * A machine somebody is developing on. Everything on, high risk still asks.
 *
 * "Asks even here" is deliberate: a confirmation the user sees every day is a
 * confirmation they recognise when it appears somewhere that matters.
 */
export const DEVELOPMENT_POLICY: FabricCapabilityPolicy = {
  template: "development",
  mode: "development",
  grants: ALL.map((capability) => grant(capability)),
};

/** Shared or staging: medium asks too, because somebody else is watching it. */
export const SUPERVISED_POLICY: FabricCapabilityPolicy = {
  template: "supervised",
  mode: "supervised",
  grants: ALL.map((capability) =>
    grant(capability, {
      requiresConfirmation: DEFAULT_RISK[capability] !== "low",
    }),
  ),
};

/**
 * Production. Deployment, databases and email are **off**, not gated.
 *
 * §24.2 allows a confirmation surface for high-risk work; this template does
 * not use it, because the confirmation would be a click on a phone in a taxi.
 * Turning one of these on is a deliberate, visible edit to the policy rather
 * than an answer to a prompt.
 */
export const PRODUCTION_POLICY: FabricCapabilityPolicy = {
  template: "production",
  mode: "production",
  grants: ALL.map((capability) =>
    DEFAULT_RISK[capability] === "high"
      ? grant(capability, {
          enabled: false,
          requiresConfirmation: true,
          reason:
            "this environment is production; high-risk capabilities are off until somebody turns them on deliberately.",
        })
      : grant(capability, { requiresConfirmation: true }),
  ),
};

export const policyTemplate = (mode: FabricEnvironmentMode): FabricCapabilityPolicy =>
  mode === "production"
    ? PRODUCTION_POLICY
    : mode === "supervised"
      ? SUPERVISED_POLICY
      : DEVELOPMENT_POLICY;

/**
 * May this capability be used here, and on what terms?
 *
 * `preauthorised` is §24.2's narrowly scoped exception, and it is narrow on
 * purpose: it lifts the confirmation, never the grant. A capability the policy
 * has switched off stays off however the caller asks.
 */
export const evaluateCapability = (input: {
  readonly policy: FabricCapabilityPolicy;
  readonly capability: FabricCapability;
  /** A narrowly scoped preauthorisation the user already gave. */
  readonly preauthorised?: boolean;
}): FabricCapabilityDecision => {
  const found = input.policy.grants.find((entry) => entry.capability === input.capability);
  if (found === undefined) {
    // A capability nobody declared is a capability nobody reviewed.
    return {
      outcome: "refused",
      reason: `${input.capability} is not part of this environment's capability policy.`,
    };
  }
  if (!found.enabled) {
    return {
      outcome: "refused",
      reason:
        found.reason.length > 0
          ? found.reason
          : `${found.capability} is switched off on this environment.`,
    };
  }
  if (found.requiresConfirmation && input.preauthorised !== true) {
    return {
      outcome: "needs_confirmation",
      prompt: `${found.capability} is a ${found.risk}-risk capability on a ${input.policy.mode} environment. Confirm before it runs.`,
    };
  }
  return { outcome: "allowed" };
};

/** One line for the UI or a spoken answer. Never a bare "no". */
export const describeDecision = (decision: FabricCapabilityDecision): string => {
  switch (decision.outcome) {
    case "allowed":
      return "Allowed here.";
    case "needs_confirmation":
      return decision.prompt;
    case "refused":
      return decision.reason;
  }
};
