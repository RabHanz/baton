/**
 * What the phone's Fabric screen shows, as arithmetic.
 *
 * §29 Phase 7's exit criteria are six things the user must be able to do from
 * an iPhone: see all active work, ask what is happening, send an instruction,
 * approve or respond, hand off an account, and open the relevant work session.
 * Four of those are a list and a text field; one of them — handoff — is not
 * built anywhere yet, and this module is where that is said rather than shown
 * as a button that does nothing.
 *
 * The rows themselves come from `@t3tools/shared/fabricFleetView`, the same
 * builder the desktop uses. Two implementations of "does this need me" would
 * drift, and the phone is exactly where that drift would be discovered too
 * late.
 */
import type { EnvironmentId, FabricFleetEntry, ProjectId } from "@t3tools/contracts";
import {
  buildFleetRows,
  countFleetRows,
  filterFleetRows,
  type FleetRow,
} from "@t3tools/shared/fabricFleetView";

export interface FabricScreenInput {
  readonly entries: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly entry: FabricFleetEntry;
  }>;
  readonly resolveProjectLabel: (
    environmentId: EnvironmentId,
    projectId: ProjectId,
  ) => string | null;
  readonly resolveEnvironmentLabel: (environmentId: EnvironmentId) => string | null;
  readonly resolveProviderLabel: (
    environmentId: EnvironmentId,
    providerInstanceId: string,
  ) => string | null;
  readonly now: number;
  readonly needsUserOnly: boolean;
}

export interface FabricScreenModel {
  readonly rows: readonly FleetRow[];
  readonly total: number;
  readonly needsUserCount: number;
  /** What to show when the list is empty, which is different each time. */
  readonly emptyMessage: string | null;
}

export const buildFabricScreenModel = (input: FabricScreenInput): FabricScreenModel => {
  const all = buildFleetRows(input);
  const counts = countFleetRows(all);
  const rows = filterFleetRows(all, input.needsUserOnly);
  return {
    rows,
    total: counts.total,
    needsUserCount: counts.needsUser,
    emptyMessage:
      rows.length > 0
        ? null
        : input.needsUserOnly
          ? "Nothing needs you."
          : counts.total === 0
            ? "No work on this environment yet."
            : null,
  };
};

/**
 * The quick actions §29 Phase 7 asks for, as sentences the intent grammar
 * already understands.
 *
 * They are sentences rather than special-cased buttons on purpose: the phone
 * then goes through the same deterministic grammar as everything else, and a
 * button cannot drift from what the same words would do typed out.
 */
export const FABRIC_QUICK_ACTIONS: ReadonlyArray<{
  readonly label: string;
  readonly sentence: string;
}> = [
  { label: "What needs me?", sentence: "What needs me?" },
  { label: "What's running?", sentence: "What's running?" },
  { label: "What finished?", sentence: "What finished?" },
];

export type FabricActionAvailability =
  | { readonly available: true }
  | { readonly available: false; readonly reason: string };

/**
 * Whether the phone can hand a work session to another account.
 *
 * §29 Phase 7 lists it; Phase 3 has not built it and this deployment has one
 * Claude account logged in. A button that fails after being pressed is worse
 * than a line of text that says why it is not there — especially on a phone,
 * where the user is usually away from the machine that could fix it.
 */
export const handoffAvailability = (input: {
  readonly handoffImplemented: boolean;
  readonly accountCount: number;
}): FabricActionAvailability => {
  if (!input.handoffImplemented) {
    return {
      available: false,
      reason: "Handing work to another account is not built yet.",
    };
  }
  if (input.accountCount < 2) {
    return {
      available: false,
      reason: "Only one provider account is logged in on this environment.",
    };
  }
  return { available: true };
};

/**
 * Whether this environment understands `fabric.*` at all.
 *
 * A phone talks to several environments, and one of them being older must not
 * make the screen call something that will be rejected — it must say so.
 */
export const fabricAvailability = (input: {
  readonly capabilityAdvertised: boolean;
}): FabricActionAvailability =>
  input.capabilityAdvertised
    ? { available: true }
    : {
        available: false,
        reason: "This environment is running a version without Fabric work sessions.",
      };
