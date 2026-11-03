// @effect-diagnostics globalDate:off nodeBuiltinImport:off
/** The session catalog as a service, so the RPC door, agents and MCP all reach the same methods. */
import type { BatonCatalogSession, BatonCatalogState } from "@t3tools/baton-contracts";
import {
  CommandId,
  DEFAULT_MODEL_BY_PROVIDER,
  DEFAULT_RUNTIME_MODE,
  ProjectId,
  ProviderDriverKind,
  ThreadId,
  defaultInstanceIdForDriver,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as NodeCrypto from "node:crypto";
import * as NodePath from "node:path";

import { AgentSessionImporter } from "../project/AgentSessionImporter.ts";
import { ProjectService } from "../project/ProjectService.ts";

import { AdoptedSessionService } from "./AdoptedSessionService.ts";
import { BatonEngine } from "./BatonEngine.ts";
import { isTessayaOwnFolder } from "./ClaudeLiveSessions.ts";
import { classifyHelperThread } from "./HelperThreads.ts";
import * as ProviderInstanceRegistryModule from "../provider/ProviderInstanceRegistry.ts";
import { isProviderAvailable } from "@t3tools/baton-contracts";
import { herdrSend } from "./HerdrSend.ts";
import { createSessionCatalog, type CatalogPorts } from "./SessionCatalog.ts";
import { realCatalogPorts } from "./SessionCatalogLive.ts";

export class BatonSessionCatalogService extends Context.Service<
  BatonSessionCatalogService,
  {
    readonly list: (input: {
      query?: string;
      limit?: number;
      before?: string;
      background?: boolean;
    }) => Effect.Effect<{
      readonly machine: string;
      readonly sessions: ReadonlyArray<BatonCatalogSession>;
      readonly more: boolean;
    }>;
    readonly folders: (input: { query?: string }) => Effect.Effect<{
      readonly folders: ReadonlyArray<{
        cwd: string;
        project: string;
        lastActivityAt: string | null;
      }>;
    }>;
    readonly resume: (input: { sessionId: string; cwd?: string }) => Effect.Effect<{
      readonly state: BatonCatalogState;
      readonly pane: string | null;
      readonly detail: string | null;
      readonly threadId?: string;
    }>;
    readonly create: (input: {
      cwd: string;
      model?: string;
      effort?: string;
      message?: string;
    }) => Effect.Effect<{
      readonly state: BatonCatalogState;
      readonly sessionId: string | null;
      readonly pane: string | null;
      readonly detail: string | null;
      readonly threadId?: string;
    }>;
    readonly cleanup: (input: { apply: boolean }) => Effect.Effect<{
      readonly found: ReadonlyArray<{ id: string; title: string; project: string; reason: string }>;
      readonly archived: ReadonlyArray<string>;
      readonly left: ReadonlyArray<{ id: string; title: string; reason: string }>;
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
    const engine = yield* Effect.serviceOption(BatonEngine);
    const registry = yield* Effect.serviceOption(
      ProviderInstanceRegistryModule.ProviderInstanceRegistry,
    );
    // No Herdr here (Windows): a missing piece must say so, not fall through to a Herdr program that is not there.
    const noHerdr = NodePath.sep === "\\";
    const OWN_FOLDER =
      "That folder belongs to Tessaya's own data, not to a project, so no session is started there.";
    const MISSING =
      "This server could not reach the part that starts threads, so it cannot start a session here.";
    // No Herdr on Windows: the session comes back as a T3 thread on the Claude provider (the importer's resume cursor).
    // The thread must exist before it is offered: a thread id that does not exist opens a blank thread in T3.
    const thread: CatalogPorts["thread"] = !noHerdr
      ? undefined
      : Option.isNone(projects) || Option.isNone(importer) || Option.isNone(engine)
        ? async () => ({ detail: MISSING })
        : (sessionId, cwd) =>
            Effect.runPromiseWith(services)(
              Effect.gen(function* () {
                if (isTessayaOwnFolder(cwd)) return { detail: OWN_FOLDER };
                const found = yield* projects.value.getByWorkspaceRoot(cwd);
                const project = Option.isSome(found)
                  ? found.value
                  : yield* projects.value.create({
                      commandId: CommandId.make(`baton:resume-project:${NodeCrypto.randomUUID()}`),
                      projectId: ProjectId.make(NodeCrypto.randomUUID()),
                      title: NodePath.basename(cwd) || cwd,
                      workspaceRoot: cwd,
                    });
                const result = yield* importer.value.importRecentAgentThreads({
                  projectId: project.id,
                  preferSessionId: sessionId,
                });
                const threadId = ThreadId.make(
                  `import:${defaultInstanceIdForDriver(ProviderDriverKind.make("claudeAgent"))}:${sessionId}`,
                );
                // The import commits events before it returns, but the thread's own record can trail them a moment.
                for (let attempt = 0; attempt < 10; attempt += 1) {
                  if ((yield* engine.value.threadShell(threadId)) !== null)
                    return { threadId: String(threadId) };
                  yield* Effect.sleep("500 millis");
                }
                return {
                  detail: `Tessaya read ${cwd} but could not bring that conversation in as a thread (imported ${result.importedCount}, skipped ${result.skippedCount}). Only conversations from the last 30 days are imported.`,
                };
              }),
            ).catch((cause) => ({
              detail: `Tessaya could not bring that conversation back as a thread here: ${String(
                cause instanceof Error ? cause.message : cause,
              )
                .replace(/\s+/g, " ")
                .slice(0, 160)}`,
            }));
    // A new session on a machine with no Herdr: a T3 thread in that folder's project, on the Claude provider, with the
    // model, effort and first message asked for. The project is found by its exact folder, so no other project is touched.
    const claudeInstance = defaultInstanceIdForDriver(ProviderDriverKind.make("claudeAgent"));
    const launch: CatalogPorts["launch"] = !noHerdr
      ? undefined
      : Option.isNone(projects) || Option.isNone(engine)
        ? async () => ({ detail: MISSING })
        : (input) =>
            Effect.runPromiseWith(services)(
              Effect.gen(function* () {
                if (isTessayaOwnFolder(input.cwd)) return { detail: OWN_FOLDER };
                if (Option.isSome(registry)) {
                  const instance = yield* registry.value.getInstance(claudeInstance);
                  const snapshot =
                    instance === undefined ? null : yield* instance.snapshot.getSnapshot;
                  if (
                    instance === undefined ||
                    !instance.enabled ||
                    snapshot === null ||
                    !snapshot.installed ||
                    !isProviderAvailable(snapshot)
                  )
                    return {
                      detail:
                        "Claude Code is not installed or not signed in on this machine, so a session cannot start here.",
                    };
                }
                const found = yield* projects.value.getByWorkspaceRoot(input.cwd);
                const project = Option.isSome(found)
                  ? found.value
                  : yield* projects.value.create({
                      commandId: CommandId.make(
                        `baton:new-session-project:${NodeCrypto.randomUUID()}`,
                      ),
                      projectId: ProjectId.make(NodeCrypto.randomUUID()),
                      title: NodePath.basename(input.cwd) || input.cwd,
                      workspaceRoot: input.cwd,
                    });
                const family = (input.model ?? "").trim().toLowerCase();
                const model =
                  family === "" || family === "opus"
                    ? (DEFAULT_MODEL_BY_PROVIDER[ProviderDriverKind.make("claudeAgent")] ??
                      "claude-opus-5-5")
                    : input.model!.trim();
                const effort = (input.effort ?? "").trim().toLowerCase();
                const threadId = yield* engine.value.launchThread({
                  tag: "new-session",
                  projectId: project.id,
                  title: NodePath.basename(input.cwd) || "New session",
                  modelSelection: {
                    instanceId: claudeInstance,
                    model,
                    ...(effort === "" ? {} : { options: [{ id: "effort", value: effort }] }),
                  },
                  runtimeMode: DEFAULT_RUNTIME_MODE,
                  worktreePath: null,
                  branch: null,
                  text: input.message ?? "",
                });
                return threadId === null
                  ? { detail: "Tessaya could not start that session." }
                  : { threadId: String(threadId) };
              }),
            ).catch((cause) => ({
              detail: `Tessaya could not start that session here: ${String(
                cause instanceof Error ? cause.message : cause,
              )
                .replace(/\s+/g, " ")
                .slice(0, 160)}`,
            }));
    const catalog = createSessionCatalog({
      ...realCatalogPorts((pane, text) =>
        Effect.runPromiseWith(services)(herdrSend(adopted, { pane, text, submit: true })).then(
          (r) => r.delivered,
        ),
      ),
      ...(thread === undefined ? {} : { thread }),
      ...(launch === undefined ? {} : { launch }),
    });
    return BatonSessionCatalogService.of({
      list: Effect.fn("BatonSessionCatalogService.list")(function* (input: {
        query?: string;
        limit?: number;
        before?: string;
        background?: boolean;
      }) {
        return yield* Effect.promise(() => catalog.list(input));
      }),
      folders: Effect.fn("BatonSessionCatalogService.folders")(function* (input: {
        query?: string;
      }) {
        return yield* Effect.promise(() => catalog.folders(input));
      }),
      resume: Effect.fn("BatonSessionCatalogService.resume")(function* (input: {
        sessionId: string;
        cwd?: string;
      }) {
        return yield* Effect.promise(() => catalog.resume(input));
      }),
      create: Effect.fn("BatonSessionCatalogService.create")(function* (input: {
        cwd: string;
        model?: string;
        effort?: string;
        message?: string;
      }) {
        return yield* Effect.promise(() => catalog.create(input));
      }),
      cleanup: Effect.fn("BatonSessionCatalogService.cleanup")(function* (input: {
        apply: boolean;
      }) {
        if (Option.isNone(engine)) return { found: [], archived: [], left: [] };
        const e = engine.value;
        const shells = yield* e.threadShells;
        const projects = yield* e.projects;
        const root = new Map(projects.map((p) => [String(p.id), p.workspaceRoot] as const));
        const found: Array<{ id: string; title: string; project: string; reason: string }> = [];
        const left: Array<{ id: string; title: string; reason: string }> = [];
        const archived: string[] = [];
        for (const shell of shells) {
          const projectRoot = root.get(String(shell.projectId)) ?? null;
          const title = String(shell.title ?? "");
          const looks =
            isTessayaOwnFolder(projectRoot) ||
            /^(userdata-[0-9a-f]+ · |Add sentence punctuation|shell in .*\(deleted\))/i.test(title);
          if (!looks) continue;
          const messages = (yield* e.recentMessages(shell.id, 2)).length;
          const verdict = classifyHelperThread({
            title,
            projectRoot,
            running: shell.activeRunId !== null && shell.activeRunId !== undefined,
            messages,
          });
          if (verdict === null) continue;
          if (verdict.kind === "leave") {
            left.push({ id: String(shell.id), title, reason: verdict.reason });
            continue;
          }
          found.push({
            id: String(shell.id),
            title,
            project: projectRoot ?? "",
            reason: verdict.reason,
          });
          if (
            input.apply &&
            (yield* e.archiveThread({ tag: "helper-cleanup", threadId: shell.id }))
          )
            archived.push(String(shell.id));
        }
        return { found, archived, left };
      }),
      send: Effect.fn("BatonSessionCatalogService.send")(function* (input: {
        sessionId: string;
        text: string;
        cwd?: string;
      }) {
        return yield* Effect.promise(() => catalog.send(input));
      }),
    });
  }),
);
