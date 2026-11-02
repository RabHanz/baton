// @effect-diagnostics globalDate:off nodeBuiltinImport:off
/** The session catalog as a service, so the RPC door, agents and MCP all reach the same methods. */
import type {
  BatonCatalogSession,
  BatonCatalogState,
} from "@t3tools/baton-contracts";
import { CommandId, ProjectId, ProviderDriverKind, defaultInstanceIdForDriver } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as NodeCrypto from "node:crypto";
import * as NodePath from "node:path";

import { AgentSessionImporter } from "../project/AgentSessionImporter.ts";
import { ProjectService } from "../project/ProjectService.ts";

import { AdoptedSessionService } from "./AdoptedSessionService.ts";
import { herdrSend } from "./HerdrSend.ts";
import { createSessionCatalog, type CatalogPorts } from "./SessionCatalog.ts";
import { realCatalogPorts } from "./SessionCatalogLive.ts";

export class BatonSessionCatalogService extends Context.Service<
  BatonSessionCatalogService,
  {
    readonly list: (input: { query?: string; limit?: number; before?: string }) => Effect.Effect<{
      readonly machine: string;
      readonly sessions: ReadonlyArray<BatonCatalogSession>;
      readonly more: boolean;
    }>;
    readonly folders: (input: { query?: string }) => Effect.Effect<{
      readonly folders: ReadonlyArray<{ cwd: string; project: string; lastActivityAt: string | null }>;
    }>;
    readonly resume: (input: { sessionId: string; cwd?: string }) => Effect.Effect<{
      readonly state: BatonCatalogState;
      readonly pane: string | null;
      readonly detail: string | null;
      readonly threadId?: string;
    }>;
    readonly create: (input: { cwd: string }) => Effect.Effect<{
      readonly state: BatonCatalogState;
      readonly sessionId: string | null;
      readonly pane: string | null;
      readonly detail: string | null;
    }>;
    readonly send: (input: { sessionId: string; text: string; cwd?: string }) => Effect.Effect<{
      readonly state: BatonCatalogState;
      readonly delivered: boolean;
      readonly detail: string | null;
    }>;
  }
>()("t3/baton/BatonSessionCatalogService") {}

export const layer = Layer.effect(
  BatonSessionCatalogService,
  Effect.gen(function* () {
    const adopted = yield* AdoptedSessionService;
    const services = yield* Effect.context<never>();
    const projects = yield* Effect.serviceOption(ProjectService);
    const importer = yield* Effect.serviceOption(AgentSessionImporter);
    // No Herdr on Windows: the session comes back as a T3 thread on the Claude provider (the importer's resume cursor).
    const thread: CatalogPorts["thread"] =
      NodePath.sep !== "\\" || Option.isNone(projects) || Option.isNone(importer)
        ? undefined
        : (sessionId, cwd) =>
            Effect.runPromiseWith(services)(
              Effect.gen(function* () {
                const found = yield* projects.value.getByWorkspaceRoot(cwd);
                const project = Option.isSome(found)
                  ? found.value
                  : yield* projects.value.create({
                      commandId: CommandId.make(`baton:resume-project:${NodeCrypto.randomUUID()}`),
                      projectId: ProjectId.make(NodeCrypto.randomUUID()),
                      title: NodePath.basename(cwd) || cwd,
                      workspaceRoot: cwd,
                    });
                yield* importer.value.importRecentAgentThreads({ projectId: project.id });
                return {
                  threadId: `import:${defaultInstanceIdForDriver(ProviderDriverKind.make("claudeAgent"))}:${sessionId}`,
                };
              }),
            ).catch(() => ({ detail: "Tessaya could not bring that conversation back as a thread here." }));
    const catalog = createSessionCatalog({
      ...realCatalogPorts((pane, text) =>
        Effect.runPromiseWith(services)(herdrSend(adopted, { pane, text, submit: true })).then((r) => r.delivered),
      ),
      ...(thread === undefined ? {} : { thread }),
    });
    return BatonSessionCatalogService.of({
      list: Effect.fn("BatonSessionCatalogService.list")(function* (input: { query?: string; limit?: number; before?: string }) {
        return yield* Effect.promise(() => catalog.list(input));
      }),
      folders: Effect.fn("BatonSessionCatalogService.folders")(function* (input: { query?: string }) {
        return yield* Effect.promise(() => catalog.folders(input));
      }),
      resume: Effect.fn("BatonSessionCatalogService.resume")(function* (input: { sessionId: string; cwd?: string }) {
        return yield* Effect.promise(() => catalog.resume(input));
      }),
      create: Effect.fn("BatonSessionCatalogService.create")(function* (input: { cwd: string }) {
        return yield* Effect.promise(() => catalog.create(input));
      }),
      send: Effect.fn("BatonSessionCatalogService.send")(function* (input: { sessionId: string; text: string; cwd?: string }) {
        return yield* Effect.promise(() => catalog.send(input));
      }),
    });
  }),
);
