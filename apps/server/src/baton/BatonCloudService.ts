// @effect-diagnostics globalDate:off nodeBuiltinImport:off
/**
 * Cloud tasks on the computer that holds the logins (the hub, transport 2): other computers ask through
 * `baton.cloud.read` and `baton.cloud.act`; this runs the harness's own program here, with this
 * computer's own login, and keeps the waiting requests in a small file beside the server's state.
 * The rules live in `@t3tools/baton-shared/cloud`; this is only the door.
 */
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as NodePath from "node:path";

import {
  BATON_CLOUD_ACT_OPS,
  BATON_CLOUD_APPROVE_OPS,
  BATON_CLOUD_READ_OPS,
  type BatonCloudCallInput,
  type BatonCloudCallResult,
  instancesWeekly,
} from "@t3tools/baton-contracts";
import { buildLocalProviders, settingsFromEnv } from "@t3tools/baton-shared/cloud/build";
import { serveCloudCall } from "@t3tools/baton-shared/cloud/hub";
import { fileStores, nodeExec } from "@t3tools/baton-shared/cloud/nodeExec";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ServerConfig from "../config.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import { BatonRecordService } from "./BatonRecordService.ts";

/** What a decision on a cloud task did, as the Record's outcome. */
const DONE: Readonly<Record<string, string>> = {
  dispatch: "requested",
  cancel: "cancelled",
  approve: "approved",
  deny: "denied",
  apply: "applied",
};

export class BatonCloudService extends Context.Service<
  BatonCloudService,
  {
    readonly call: (
      input: BatonCloudCallInput,
      kind: "read" | "act" | "approve",
    ) => Effect.Effect<BatonCloudCallResult>;
  }
>()("t3/baton/BatonCloudService") {}

export const layer = Layer.effect(
  BatonCloudService,
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    // This computer's own instances, for each login's weekly figure (D2).
    const registry = yield* Effect.serviceOption(ProviderRegistry.ProviderRegistry);
    const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
    const providers = buildLocalProviders(
      nodeExec,
      fileStores(NodePath.join(NodePath.dirname(config.dbPath), "cloud")),
      {
        ...settingsFromEnv((yield* HostProcess.Environment)["BATON_CLOUD_CONFIG"]),
        ...(registry._tag === "None"
          ? {}
          : {
              weekly: (driver: string) =>
                runPromise(
                  registry.value.getProviders.pipe(
                    Effect.map((list) => instancesWeekly(list, driver)),
                  ),
                ),
            }),
      },
    );
    const record = yield* Effect.serviceOption(BatonRecordService);
    return BatonCloudService.of({
      call: Effect.fn("BatonCloudService.call")(function* (
        input: BatonCloudCallInput,
        kind: "read" | "act" | "approve",
      ) {
        const allowed: ReadonlyArray<string> =
          kind === "read"
            ? BATON_CLOUD_READ_OPS
            : kind === "approve"
              ? BATON_CLOUD_APPROVE_OPS
              : BATON_CLOUD_ACT_OPS;
        // A read method never changes anything, whatever op it is sent.
        if (!allowed.includes(input.op))
          return { ok: false, error: "That request is not allowed here." } as BatonCloudCallResult;
        const out = yield* Effect.promise(() =>
          serveCloudCall(providers, {
            op: input.op,
            ...(input.provider === undefined ? {} : { provider: input.provider }),
            ...(input.args === undefined ? {} : { args: input.args }),
          }),
        );
        // Every decision on a cloud task is a Record row; only he holds the approve door.
        if (kind !== "read" && record._tag === "Some") {
          const args = input.args ?? {};
          const said = (key: string) => (typeof args[key] === "string" ? args[key] : null);
          yield* record.value.append({
            kind: "cloud",
            actor: kind === "approve" ? "him" : "assistant",
            project: said("repo"),
            ref: said("id"),
            subject: `${input.op}${input.provider === undefined ? "" : ` on ${input.provider}`}${said("label") === null ? "" : `: ${said("label")}`}`,
            outcome: out.ok ? (DONE[input.op] ?? input.op) : "failed",
            detail: out.ok ? "" : out.error,
          });
        }
        return (
          out.ok ? { ok: true, value: out.value } : { ok: false, error: out.error }
        ) as BatonCloudCallResult;
      }),
    });
  }),
);
