/* oxlint-disable t3code/no-low-value-comments, t3code/prefer-effect-fn -- Baton file predating upstream's rule (D82) */
// @effect-diagnostics effectFnOpportunity:off flatMapConditionalToFilterOrFail:off preferSchemaOverJson:off instanceOfSchema:off preferSucceedSomeOrNone:off
/**
 * A structured one-shot to Claude Code (`claude -p --json-schema`), for the two places Baton
 * asks a model: reading a sentence the grammar refused (D50) and writing the synopsis (D51).
 *
 * Upstream's text generation only exposes its own operations (commit message, PR, branch,
 * title, review guide), so Baton runs the CLI itself, with the same isolation upstream's runner
 * uses: no tools, no slash commands, no MCP, no hooks, `dontAsk`. It runs as the box's primary
 * Claude home, which is the account cswap has active (D79).
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import { toJsonSchemaObject } from "@t3tools/provider-core/server/textGenerationUtils";

const TIMEOUT = "90 seconds";

export class BatonOneShotError extends Schema.TaggedError<BatonOneShotError>()(
  "BatonOneShotError",
  { detail: Schema.String },
) {}

export class BatonOneShot extends Context.Service<
  BatonOneShot,
  {
    readonly run: <S extends Schema.Top>(input: {
      readonly prompt: string;
      readonly outputSchema: S;
      /** A Claude Code model alias or id, e.g. `haiku`, `sonnet`. */
      readonly model: string;
    }) => Effect.Effect<S["Type"], BatonOneShotError, S["DecodingServices"]>;
  }
>()("t3/baton/BatonOneShot") {}

/** Claude Code's `--output-format json` result: one envelope, or the message list ending in one. */
export function structuredOutputOf(stdout: string): unknown {
  const parsed: unknown = JSON.parse(stdout);
  const envelope = Array.isArray(parsed)
    ? parsed.findLast((message: { type?: unknown }) => message?.type === "result")
    : parsed;
  return (envelope as { structured_output?: unknown } | undefined)?.structured_output;
}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

  const run: BatonOneShot["Service"]["run"] = ({ prompt, outputSchema, model }) =>
    Effect.gen(function* () {
      const jsonSchema = JSON.stringify(toJsonSchemaObject(outputSchema));
      const command = ChildProcess.make(
        "claude",
        [
          "-p",
          "--output-format",
          "json",
          "--json-schema",
          jsonSchema,
          "--model",
          model,
          "--settings",
          JSON.stringify({ disableAllHooks: true }),
          "--tools",
          "",
          "--disable-slash-commands",
          "--strict-mcp-config",
          "--permission-mode",
          "dontAsk",
        ],
        { stdin: { stream: Stream.encodeText(Stream.make(prompt)) }, forceKillAfter: "1 second" },
      );
      const stdout = yield* Effect.scoped(
        Effect.gen(function* () {
          const child = yield* spawner.spawn(command);
          const [out, err, code] = yield* Effect.all(
            [
              Stream.mkString(Stream.decodeText(child.stdout)),
              Stream.mkString(Stream.decodeText(child.stderr)),
              child.exitCode,
            ],
            { concurrency: "unbounded" },
          );
          if (code !== 0) {
            return yield* new BatonOneShotError({
              detail: `claude exited ${code}: ${(err.trim() || out.trim()).slice(0, 400)}`,
            });
          }
          return out;
        }),
      ).pipe(
        Effect.timeout(TIMEOUT),
        Effect.mapError((cause) =>
          cause instanceof BatonOneShotError
            ? cause
            : new BatonOneShotError({ detail: String(cause) }),
        ),
      );
      const structured = yield* Effect.try({
        try: () => structuredOutputOf(stdout),
        catch: () => new BatonOneShotError({ detail: "claude returned output that is not JSON" }),
      });
      return yield* Schema.decodeUnknownEffect(outputSchema)(structured).pipe(
        Effect.mapError(
          () => new BatonOneShotError({ detail: "claude returned invalid structured output" }),
        ),
      );
    });

  return { run } satisfies BatonOneShot["Service"];
});

export const layer = Layer.effect(BatonOneShot, make);
