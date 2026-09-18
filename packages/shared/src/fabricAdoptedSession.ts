/**
 * §9's mapping and §9's limits, as arithmetic.
 *
 * Two jobs, and both are about not pretending:
 *
 *   - **The state mapping.** Herdr says blocked, working, done or idle; §10
 *     says what Fabric calls those. A word Fabric does not know is refused
 *     rather than mapped to `idle`, because a session that needs the user
 *     sorted to the bottom of the fleet is the one wrong state that does real
 *     harm.
 *   - **The capability declaration.** An adopted session is a terminal
 *     somebody else started. Fabric cannot read its conversation, answer its
 *     approvals or show its diffs, and every one of those refusals says which
 *     capability is missing and why — before the button is pressed, not after.
 *
 * @module fabricAdoptedSession
 */
import type {
  AdoptedSessionCapabilities,
  AdoptedSessionCapability,
  FabricSessionState,
} from "@t3tools/contracts";

/**
 * §9's table, verbatim.
 *
 * `blocked → needs_input` rather than `needs_approval`: Herdr can tell that a
 * pane is waiting for a human, and cannot tell whether what it wants is an
 * answer or permission. Claiming the stronger of the two would put an approval
 * badge on a session nobody can approve from Fabric.
 */
const HERDR_STATES: Readonly<Record<string, FabricSessionState>> = {
  blocked: "needs_input",
  working: "working",
  done: "done_unseen",
  idle: "idle",
};

/** The mapped state, or null when the runtime used a word Fabric does not know. */
export const mapHerdrState = (runtimeState: string): FabricSessionState | null =>
  HERDR_STATES[runtimeState.trim().toLowerCase()] ?? null;

/** Every word this mapping understands, for a refusal that can list them. */
export const KNOWN_HERDR_STATES: ReadonlyArray<string> = Object.keys(HERDR_STATES);

/**
 * What Fabric assumes an adopted session can do when its runtime says nothing.
 *
 * Deliberately the least: a runtime has to claim a capability before Fabric
 * will offer it. Showing the raw terminal is the one thing every runtime worth
 * adopting can do, and it is the thing §21's "show X" needs.
 */
export const ADOPTED_MINIMUM_CAPABILITIES: AdoptedSessionCapabilities = {
  readConversation: false,
  sendInput: false,
  approvals: false,
  diffs: false,
  stop: false,
  showTerminal: true,
};

/**
 * What a Herdr-backed session can do, given what §9 says Herdr provides.
 *
 * Herdr exposes pane output, input, and state — so `sendInput` and
 * `showTerminal` are real. It does not reconstruct a provider's structured
 * conversation, so `readConversation`, `approvals` and `diffs` stay false: T3's
 * thread machinery owns those, and an adopted pane has none of it.
 */
export const HERDR_CAPABILITIES: AdoptedSessionCapabilities = {
  readConversation: false,
  sendInput: true,
  approvals: false,
  diffs: false,
  stop: true,
  showTerminal: true,
};

/** Why a capability is missing, in words a person can act on. */
const CAPABILITY_REASONS: Readonly<Record<AdoptedSessionCapability, string>> = {
  readConversation:
    "this session was not started by Fabric, so there is no structured conversation to read — only what is on the terminal.",
  sendInput: "its runtime does not allow Fabric to type into this pane.",
  approvals:
    "approvals belong to a provider session Fabric started; an adopted terminal has none to answer.",
  diffs: "diffs and checkpoints come from a thread Fabric owns, and this one it does not.",
  stop: "its runtime does not allow Fabric to stop it; stop it where it was started.",
  showTerminal: "its runtime cannot surface a terminal for this session.",
};

export const capabilityRefusal = (capability: AdoptedSessionCapability): string =>
  CAPABILITY_REASONS[capability];

/**
 * The check every adopted-session action runs first.
 *
 * Returns the refusal, or null when it may proceed. A function rather than a
 * boolean so the call site cannot forget to say why.
 */
export const refuseCapability = (input: {
  readonly capabilities: AdoptedSessionCapabilities;
  readonly capability: AdoptedSessionCapability;
}): string | null =>
  input.capabilities[input.capability] ? null : capabilityRefusal(input.capability);

/**
 * One line describing what an adopted session is, for a fleet row or a spoken
 * answer: what it is, where it runs, and what Fabric cannot do with it.
 */
export const describeAdoptedSession = (input: {
  readonly label: string;
  readonly runtime: string;
  readonly host: string | null;
  readonly capabilities: AdoptedSessionCapabilities;
}): string => {
  const where = input.host === null ? input.runtime : `${input.runtime} on ${input.host}`;
  const missing = (Object.keys(input.capabilities) as AdoptedSessionCapability[]).filter(
    (capability) => !input.capabilities[capability],
  );
  const limits = missing.length === 0 ? "" : ` — adopted, so no ${missing.slice(0, 3).join(", ")}`;
  return `${input.label} (${where})${limits}`;
};
