import * as Schema from "effect/Schema";

import { IsoDateTime, TrimmedNonEmptyString } from "../baseSchemas.ts";
import { ProviderDriverKind } from "../providerInstance.ts";
import { WorkSessionId } from "./workSession.ts";

/**
 * The accounts one config directory can run as (§6.1, corrected).
 *
 * A provider thread is bound to its **config directory**, not to an account:
 * the credential file inside that directory can be replaced while the session
 * id, the transcript and the resume cursor stay exactly where they were. That
 * is what the Director already does by hand between his three Claude logins,
 * and it is why rotation — not a handoff capsule — is the primary way work
 * continues past a limit. The capsule path remains for the cases rotation
 * genuinely cannot serve: a different config directory, or another provider.
 */

export const FABRIC_ACCOUNT_WS_METHODS = {
  /** Read the pool. A read: it changes nothing and costs one process. */
  accountPool: "fabric.account.pool",
  /** Swap the credential in the config directory, between turns. */
  accountUse: "fabric.account.use",
} as const;

/** Identifies an account inside a pool. Opaque: the adapter chooses the form. */
export const FabricAccountKey = TrimmedNonEmptyString;
export type FabricAccountKey = typeof FabricAccountKey.Type;

/** Why an account cannot be rotated to right now. */
export const FabricAccountUnusableReason = Schema.Literals([
  "signed-out",
  "limits-unknown",
  "disabled",
  "spent",
]);
export type FabricAccountUnusableReason = typeof FabricAccountUnusableReason.Type;

export const FabricAccountWindow = Schema.Struct({
  id: TrimmedNonEmptyString,
  label: TrimmedNonEmptyString,
  usedPercent: Schema.Number,
  resetsAt: Schema.NullOr(IsoDateTime),
});
export type FabricAccountWindow = typeof FabricAccountWindow.Type;

export const FabricAccount = Schema.Struct({
  key: FabricAccountKey,
  /** What a person calls it: the alias they set, else the address's local part. */
  label: TrimmedNonEmptyString,
  email: Schema.NullOr(Schema.String),
  organizationName: Schema.NullOr(Schema.String),
  active: Schema.Boolean,
  usable: Schema.Boolean,
  unusableReason: Schema.NullOr(FabricAccountUnusableReason),
  /**
   * Percent of the **tightest** window still free. An account at 4% of its
   * five-hour window and 99% of its weekly one has 1% of headroom, and moving
   * work onto it buys minutes.
   */
  headroomPercent: Schema.NullOr(Schema.Number),
  windows: Schema.Array(FabricAccountWindow),
  usageCheckedAt: Schema.NullOr(IsoDateTime),
});
export type FabricAccount = typeof FabricAccount.Type;

/** Where the pool comes from, so a surface can say what it is driving. */
export const FabricAccountPoolSource = Schema.Literals(["cswap", "fabric"]);
export type FabricAccountPoolSource = typeof FabricAccountPoolSource.Type;

export const FabricAccountPool = Schema.Struct({
  driver: ProviderDriverKind,
  source: FabricAccountPoolSource,
  /** The directory whose credential is swapped. One pool per directory. */
  configDir: TrimmedNonEmptyString,
  accounts: Schema.Array(FabricAccount),
  checkedAt: IsoDateTime,
});
export type FabricAccountPool = typeof FabricAccountPool.Type;

export const FabricAccountRotationReason = Schema.Literals(["manual", "limit", "policy"]);
export type FabricAccountRotationReason = typeof FabricAccountRotationReason.Type;

export const FabricAccountRotation = Schema.Struct({
  fromKey: Schema.NullOr(FabricAccountKey),
  fromLabel: Schema.NullOr(TrimmedNonEmptyString),
  toKey: FabricAccountKey,
  toLabel: TrimmedNonEmptyString,
  reason: FabricAccountRotationReason,
  /** The work session this was done for, when it was done for one. */
  workSessionId: Schema.NullOr(WorkSessionId),
  /** Free in the tightest window of the account moved to, at the time. */
  toHeadroomPercent: Schema.NullOr(Schema.Number),
  rotatedAt: IsoDateTime,
});
export type FabricAccountRotation = typeof FabricAccountRotation.Type;

export const FabricAccountPoolInput = Schema.Struct({
  driver: Schema.optional(ProviderDriverKind),
});
export type FabricAccountPoolInput = typeof FabricAccountPoolInput.Type;

export const FabricAccountUseInput = Schema.Struct({
  key: FabricAccountKey,
  reason: Schema.optional(FabricAccountRotationReason),
  /** Named so the rotation lands on that work's timeline. */
  workSessionId: Schema.optional(WorkSessionId),
  driver: Schema.optional(ProviderDriverKind),
});
export type FabricAccountUseInput = typeof FabricAccountUseInput.Type;

export const FabricAccountUseResult = Schema.Struct({
  rotation: FabricAccountRotation,
  pool: FabricAccountPool,
});
export type FabricAccountUseResult = typeof FabricAccountUseResult.Type;

export class FabricAccountPoolUnavailableError extends Schema.TaggedError<FabricAccountPoolUnavailableError>()(
  "FabricAccountPoolUnavailableError",
  { driver: ProviderDriverKind, detail: TrimmedNonEmptyString },
) {
  override get message(): string {
    return `No account pool for ${this.driver} on this machine: ${this.detail}`;
  }
}

export class FabricAccountRotationRefusedError extends Schema.TaggedError<FabricAccountRotationRefusedError>()(
  "FabricAccountRotationRefusedError",
  {
    key: FabricAccountKey,
    reason: Schema.Literals(["unknown-account", "unusable", "already-active", "turn-in-flight"]),
    detail: Schema.NullOr(TrimmedNonEmptyString),
  },
) {
  override get message(): string {
    switch (this.reason) {
      case "unknown-account":
        return `No account '${this.key}' in this pool.`;
      case "unusable":
        return `Account '${this.key}' cannot be used: ${this.detail ?? "it is signed out or its limits cannot be read"}.`;
      case "already-active":
        return `Account '${this.key}' is already the one in use.`;
      case "turn-in-flight":
        return `A turn is running. The account changes between turns, never inside one.`;
    }
  }
}

export class FabricAccountRotationFailedError extends Schema.TaggedError<FabricAccountRotationFailedError>()(
  "FabricAccountRotationFailedError",
  { key: FabricAccountKey, detail: TrimmedNonEmptyString },
) {
  override get message(): string {
    return `Could not switch to account '${this.key}': ${this.detail}`;
  }
}
