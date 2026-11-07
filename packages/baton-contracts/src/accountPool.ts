/* oxlint-disable t3code/no-low-value-comments -- Baton file predating upstream's rule (D82) */
import * as Schema from "effect/Schema";

import { IsoDateTime, ThreadId, TrimmedNonEmptyString } from "@t3tools/contracts";
import { ProviderDriverKind } from "@t3tools/contracts";
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

// Legacy names (D71): every Baton RPC method keeps its "fabric." wire name, so installed clients keep working.
export const BATON_ACCOUNT_WS_METHODS = {
  /** Read the pool. A read: it changes nothing and costs one process. */
  accountPool: "fabric.account.pool",
  /** Swap the credential in the config directory, between turns. */
  accountUse: "fabric.account.use",
  /** Move one thread to an account's provider instance (D95). Nothing else moves. */
  threadAccountUse: "fabric.account.useForThread",
  /** Whether a thread moves to another account by itself when its account nears its limit. */
  onLimit: "fabric.account.onLimit",
  setOnLimit: "fabric.account.setOnLimit",
  /** Whether automatic rotation leaves this thread on its account, and setting that. */
  threadKept: "fabric.account.threadKept",
  threadKeep: "fabric.account.threadKeep",
} as const;

export const BATON_DEFAULT_CLAUDE_INSTANCE = "claudeAgent";

/**
 * cswap slots of the token instances, by provider instance id. Empty until a machine says which it
 * has: the server reads `BATON_CLAUDE_ACCOUNT_INSTANCES` (JSON, `{"claudeAgent_work":"4"}`) at start.
 */
export const BATON_CLAUDE_ACCOUNT_INSTANCES: Record<string, string> = {};

export const setClaudeAccountInstances = (map: Readonly<Record<string, string>>): void => {
  for (const key of Object.keys(BATON_CLAUDE_ACCOUNT_INSTANCES))
    delete BATON_CLAUDE_ACCOUNT_INSTANCES[key];
  Object.assign(BATON_CLAUDE_ACCOUNT_INSTANCES, map);
};

/** Identifies an account inside a pool. Opaque: the adapter chooses the form. */
export const BatonAccountKey = TrimmedNonEmptyString;
export type BatonAccountKey = typeof BatonAccountKey.Type;

/** Why an account cannot be rotated to right now. */
export const BatonAccountUnusableReason = Schema.Literals([
  "signed-out",
  "limits-unknown",
  "disabled",
  "spent",
]);
export type BatonAccountUnusableReason = typeof BatonAccountUnusableReason.Type;

export const BatonAccountWindow = Schema.Struct({
  id: TrimmedNonEmptyString,
  label: TrimmedNonEmptyString,
  usedPercent: Schema.Number,
  resetsAt: Schema.NullOr(IsoDateTime),
});
export type BatonAccountWindow = typeof BatonAccountWindow.Type;

export const BatonAccount = Schema.Struct({
  key: BatonAccountKey,
  /** What a person calls it: the alias they set, else the address's local part. */
  label: TrimmedNonEmptyString,
  email: Schema.NullOr(Schema.String),
  organizationName: Schema.NullOr(Schema.String),
  active: Schema.Boolean,
  usable: Schema.Boolean,
  unusableReason: Schema.NullOr(BatonAccountUnusableReason),
  /**
   * Percent of the **tightest** window still free. An account at 4% of its
   * five-hour window and 99% of its weekly one has 1% of headroom, and moving
   * work onto it buys minutes.
   */
  headroomPercent: Schema.NullOr(Schema.Number),
  windows: Schema.Array(BatonAccountWindow),
  usageCheckedAt: Schema.NullOr(IsoDateTime),
});
export type BatonAccount = typeof BatonAccount.Type;

/** Where the pool comes from, so a surface can say what it is driving. */
// Legacy name (D71): "fabric" is a stored source value, so it is kept.
export const BatonAccountPoolSource = Schema.Literals(["cswap", "fabric", "instances"]);
export type BatonAccountPoolSource = typeof BatonAccountPoolSource.Type;

export const BatonAccountPool = Schema.Struct({
  driver: ProviderDriverKind,
  source: BatonAccountPoolSource,
  /** The directory whose credential is swapped. One pool per directory. */
  configDir: TrimmedNonEmptyString,
  accounts: Schema.Array(BatonAccount),
  checkedAt: IsoDateTime,
});
export type BatonAccountPool = typeof BatonAccountPool.Type;

export const BatonAccountRotationReason = Schema.Literals(["manual", "limit", "policy"]);
export type BatonAccountRotationReason = typeof BatonAccountRotationReason.Type;

export const BatonAccountRotation = Schema.Struct({
  fromKey: Schema.NullOr(BatonAccountKey),
  fromLabel: Schema.NullOr(TrimmedNonEmptyString),
  toKey: BatonAccountKey,
  toLabel: TrimmedNonEmptyString,
  reason: BatonAccountRotationReason,
  /** The work session this was done for, when it was done for one. */
  workSessionId: Schema.NullOr(WorkSessionId),
  /** Free in the tightest window of the account moved to, at the time. */
  toHeadroomPercent: Schema.NullOr(Schema.Number),
  rotatedAt: IsoDateTime,
});
export type BatonAccountRotation = typeof BatonAccountRotation.Type;

export const BatonAccountPoolInput = Schema.Struct({
  driver: Schema.optional(ProviderDriverKind),
});
export type BatonAccountPoolInput = typeof BatonAccountPoolInput.Type;

export const BatonAccountUseInput = Schema.Struct({
  key: BatonAccountKey,
  reason: Schema.optional(BatonAccountRotationReason),
  /** Named so the rotation lands on that work's timeline. */
  workSessionId: Schema.optional(WorkSessionId),
  driver: Schema.optional(ProviderDriverKind),
});
export type BatonAccountUseInput = typeof BatonAccountUseInput.Type;

/** "auto" moves a working thread to the instance with the most room; "ask" leaves it where it is. */
export const BatonOnLimitSetting = Schema.Literals(["auto", "ask"]);
export type BatonOnLimitSetting = typeof BatonOnLimitSetting.Type;

export const BatonOnLimitInput = Schema.Struct({});
export const BatonOnLimitResult = Schema.Struct({ policy: BatonOnLimitSetting });
export type BatonOnLimitResult = typeof BatonOnLimitResult.Type;
export const BatonSetOnLimitInput = Schema.Struct({ policy: BatonOnLimitSetting });
export type BatonSetOnLimitInput = typeof BatonSetOnLimitInput.Type;

export const BatonThreadKeptInput = Schema.Struct({ threadId: ThreadId });
export const BatonThreadKeepInput = Schema.Struct({ threadId: ThreadId, keep: Schema.Boolean });
export type BatonThreadKeepInput = typeof BatonThreadKeepInput.Type;
export const BatonThreadKeepResult = Schema.Struct({ keep: Schema.Boolean });

export const BatonAccountUseResult = Schema.Struct({
  rotation: BatonAccountRotation,
  pool: BatonAccountPool,
});
export type BatonAccountUseResult = typeof BatonAccountUseResult.Type;

export const BatonThreadAccountUseInput = Schema.Struct({
  threadId: ThreadId,
  /** Null puts the thread back on whatever cswap has active on this machine. */
  key: Schema.NullOr(BatonAccountKey),
});
export type BatonThreadAccountUseInput = typeof BatonThreadAccountUseInput.Type;

export const BatonThreadAccountUseResult = Schema.Struct({
  instanceId: TrimmedNonEmptyString,
  /** `next-turn` when a turn is running: it is never cut, and the move waits for it to end. */
  timing: Schema.Literals(["now", "next-turn"]),
});
export type BatonThreadAccountUseResult = typeof BatonThreadAccountUseResult.Type;

/** The instance that runs as this account: its token instance, else the default if it is active. */
export function instanceForAccount(
  account: Pick<BatonAccount, "key" | "active">,
  isAvailable: (instanceId: string) => boolean,
): string | null {
  const pinned = Object.keys(BATON_CLAUDE_ACCOUNT_INSTANCES).find(
    (instanceId) => BATON_CLAUDE_ACCOUNT_INSTANCES[instanceId] === account.key,
  );
  if (pinned !== undefined && isAvailable(pinned)) return pinned;
  return account.active ? BATON_DEFAULT_CLAUDE_INSTANCE : null;
}

/**
 * The cswap account an instance runs as: its token's slot, or whatever cswap has active for the default
 * instance. Any other instance is unknown, so a token instance with no slot never borrows the active login's limits.
 */
export function accountForInstance<A extends Pick<BatonAccount, "key" | "active">>(
  instanceId: string,
  accounts: ReadonlyArray<A>,
): A | undefined {
  const key = BATON_CLAUDE_ACCOUNT_INSTANCES[instanceId];
  if (key !== undefined) return accounts.find((account) => account.key === key);
  return instanceId === BATON_DEFAULT_CLAUDE_INSTANCE
    ? accounts.find((account) => account.active)
    : undefined;
}

/** When a spent account has quota again: the last of its full windows to reset. */
export function accountReturnsAt(
  account: Pick<BatonAccount, "headroomPercent" | "windows">,
): string | null {
  if (account.headroomPercent !== 0) return null;
  return (
    account.windows
      .filter((window) => window.usedPercent >= 100 && window.resetsAt !== null)
      .map((window) => window.resetsAt as string)
      .toSorted()
      .at(-1) ?? null
  );
}

/** Why no thread may move to this account now, or null when it may. */
export function accountRefusal(
  account: Pick<BatonAccount, "label" | "unusableReason" | "headroomPercent" | "windows">,
): string | null {
  if (account.unusableReason === "signed-out") return `${account.label} is signed out`;
  if (account.headroomPercent !== 0) return null;
  const returnsAt = accountReturnsAt(account);
  return returnsAt === null
    ? `${account.label} has no quota left`
    : `${account.label} has no quota left until ${returnsAt.slice(0, 16).replace("T", " ")} UTC`;
}

export class BatonAccountPoolUnavailableError extends Schema.TaggedError<BatonAccountPoolUnavailableError>()(
  "FabricAccountPoolUnavailableError",
  { driver: ProviderDriverKind, detail: TrimmedNonEmptyString },
) {
  override get message(): string {
    return `No account pool for ${this.driver} on this machine: ${this.detail}`;
  }
}

export class BatonAccountRotationRefusedError extends Schema.TaggedError<BatonAccountRotationRefusedError>()(
  "FabricAccountRotationRefusedError",
  {
    key: BatonAccountKey,
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

export class BatonAccountRotationFailedError extends Schema.TaggedError<BatonAccountRotationFailedError>()(
  "FabricAccountRotationFailedError",
  { key: BatonAccountKey, detail: TrimmedNonEmptyString },
) {
  override get message(): string {
    return `Could not switch to account '${this.key}': ${this.detail}`;
  }
}
