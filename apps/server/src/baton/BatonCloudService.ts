// @effect-diagnostics globalDate:off nodeBuiltinImport:off
/**
 * Cloud tasks on the computer that holds the logins (the hub, transport 2): other computers ask through
 * `baton.cloud.read` and `baton.cloud.act`; this runs the harness's own program here, with this
 * computer's own login, and keeps the waiting requests in a small file beside the server's state.
 * The rules live in `@t3tools/baton-shared/cloud`; this is only the door.
 */
import * as NodePath from "node:path";

import { BATON_CLOUD_ACT_OPS, BATON_CLOUD_READ_OPS, type BatonCloudCallInput, type BatonCloudCallResult } from "@t3tools/baton-contracts";
import { buildLocalProviders, settingsFromEnv } from "@t3tools/baton-shared/cloud/build";
import { serveCloudCall } from "@t3tools/baton-shared/cloud/hub";
import { fileStores, nodeExec } from "@t3tools/baton-shared/cloud/nodeExec";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ServerConfig from "../config.ts";

export class BatonCloudService extends Context.Service<
  BatonCloudService,
  {
    readonly call: (
      input: BatonCloudCallInput,
      kind: "read" | "act",
    ) => Effect.Effect<BatonCloudCallResult>;
  }
>()("t3/baton/BatonCloudService") {}

export const layer = Layer.effect(
  BatonCloudService,
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const providers = buildLocalProviders(
      nodeExec,
      fileStores(NodePath.join(NodePath.dirname(config.dbPath), "cloud")),
      settingsFromEnv(process.env["BATON_CLOUD_CONFIG"]),
    );
    return BatonCloudService.of({
      call: Effect.fn("BatonCloudService.call")(function* (input: BatonCloudCallInput, kind: "read" | "act") {
        const allowed: ReadonlyArray<string> = kind === "read" ? BATON_CLOUD_READ_OPS : BATON_CLOUD_ACT_OPS;
        // A read method never changes anything, whatever op it is sent.
        if (!allowed.includes(input.op)) return { ok: false, error: "That request is not allowed here." } as BatonCloudCallResult;
        const out = yield* Effect.promise(() =>
          serveCloudCall(providers, {
            op: input.op,
            ...(input.provider === undefined ? {} : { provider: input.provider }),
            ...(input.args === undefined ? {} : { args: input.args }),
          }),
        );
        return (out.ok ? { ok: true, value: out.value } : { ok: false, error: out.error }) as BatonCloudCallResult;
      }),
    });
  }),
);
