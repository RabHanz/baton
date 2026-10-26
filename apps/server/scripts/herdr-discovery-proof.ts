/**
 * Run Fabric's Herdr adapter against the Herdr actually running on this
 * machine, and print what it found.
 *
 * Phase 8 could only ever be proven on a snapshot: the adapter refused with
 * "herdr is not installed on this environment" because it was not. This is the
 * run that refusal was standing in for. It is a script rather than a test
 * because it needs a live Herdr server with real panes — a test that depends on
 * that would be red on every machine that has not got one.
 *
 *   node apps/server/scripts/herdr-discovery-proof.ts
 */
import * as NodeServices from "@effect/platform-node/NodeServices";
import { AdoptedSessionId } from "@t3tools/contracts";
import { HERDR_CAPABILITIES } from "@t3tools/shared/fabricAdoptedSession";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { AdoptedRuntimeAdapter } from "../src/fabric/AdoptedSessionService.ts";
import * as HerdrAdapter from "../src/fabric/HerdrAdapterLive.ts";
import * as ProcessRunner from "../src/processRunner.ts";

/**
 * With `--send <pane> <text>`, type into that pane through the adapter's own
 * `sendInput` rather than by calling Herdr directly — the point is to prove the
 * path Fabric would actually use.
 */
const program = Effect.gen(function* () {
  const adapter = yield* AdoptedRuntimeAdapter;
  const discovered = yield* adapter.discover;
  console.log(JSON.stringify(discovered, null, 2));

  const sendIndex = process.argv.indexOf("--send");
  if (sendIndex === -1) return;
  const pane = process.argv[sendIndex + 1];
  const text = process.argv[sendIndex + 2];
  if (pane === undefined || text === undefined) {
    console.error("usage: --send <pane> <text>");
    return;
  }
  const result = yield* adapter.sendInput({
    session: {
      id: AdoptedSessionId.make("00000000-0000-4000-8000-000000000001"),
      runtime: "herdr",
      workSessionId: null,
      label: `proof ${pane}`,
      location: { workspace: "proof", pane, host: null },
      agentKind: null,
      state: "idle",
      capabilities: HERDR_CAPABILITIES,
      observedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      detachedAt: null,
    },
    text,
    submit: true,
  });
  console.log(JSON.stringify(result, null, 2));
});

const layer = HerdrAdapter.layer.pipe(
  Layer.provide(ProcessRunner.layer),
  Layer.provideMerge(NodeServices.layer),
);

Effect.runPromise(program.pipe(Effect.provide(layer))).catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
