/** Instance id to cswap slot, from `BATON_CLAUDE_ACCOUNT_INSTANCES` (JSON). Unset or unreadable means none. */
import * as Schema from "effect/Schema";

const decodeEnv = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.String)),
);

export const claudeAccountInstances = (
  env: string | undefined,
): Readonly<Record<string, string>> => {
  const fromEnv = env === undefined ? null : decodeEnv(env);
  return fromEnv !== null && fromEnv._tag === "Some" ? fromEnv.value : {};
};
