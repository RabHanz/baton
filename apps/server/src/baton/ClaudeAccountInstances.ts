/**
 * Instance id to cswap slot: `BATON_CLAUDE_ACCOUNT_INSTANCES` (JSON) wins. Settings hold no slot, so the
 * Director's own instances keep theirs through LEGACY_SLOTS, used only where those exact ids exist (D135).
 */
import * as Schema from "effect/Schema";

const LEGACY_SLOTS: Readonly<Record<string, string>> = {
  claudeAgent_rabee: "4",
  claudeAgent_optima: "5",
  claudeAgent_signzart: "6",
};

const decodeEnv = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.String)),
);

export const claudeAccountInstances = (
  env: string | undefined,
  existingInstanceIds: ReadonlyArray<string>,
): Readonly<Record<string, string>> => {
  const fromEnv = env === undefined ? null : decodeEnv(env);
  if (fromEnv !== null && fromEnv._tag === "Some") return fromEnv.value;
  return Object.fromEntries(
    Object.entries(LEGACY_SLOTS).filter(([id]) => existingInstanceIds.includes(id)),
  );
};
