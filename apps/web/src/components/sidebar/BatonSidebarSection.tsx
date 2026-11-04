/**
 * Baton's block in upstream's sidebar, mounted by one line in `Sidebar.tsx`
 * (`vendor-patches/t3code/0006-web-sidebar.patch`). Everything the block needs is resolved here
 * from upstream's own state, so the hook passes only what the sidebar alone knows: which thread
 * the route has open, and how to open one.
 */
import { useAtomValue } from "@effect/atom-react";
import {
  batonDesktopBridge,
  type BatonFleetEntry,
  type BatonJobBridgeRequest,
  type BatonCommitmentBridgeRequest,
  type BatonPhoneBridgeRequest,
  type BatonCloudBridgeRequest,
  type BatonWeaveBridgeRequest,
  type BatonMemoryBridgeRequest,
  type EnvironmentId,
  type ProjectId,
  type ScopedThreadRef,
} from "@t3tools/baton-contracts";
import { homeOf, resolveRunOn } from "@t3tools/baton-shared/runOn";
import type { ThreadId } from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useEffect, useRef, type ReactNode } from "react";
import { batonUsageSummaries } from "../../batonUsage";

import { focusedWorkSessionFromThreads } from "../../batonContextView";
import { useBatonFleet } from "../../batonFleetResolvers";
import {
  deriveProviderEntriesByEnvironment,
  isProviderInstancePickerReady,
} from "../../providerInstances";
import { useProjects } from "../../state/entities";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { environmentServerConfigsAtom } from "../../state/server";
import { useBatonFleets } from "../../state/batonWorkSessions";
import { batonWorkSessions } from "../../state/batonWorkSessions";
import { useAtomCommand } from "../../state/use-atom-command";
import { BatonIntentBar } from "./BatonIntentBar";
import { BatonProjectsBlock } from "./BatonProjectsBlock";

/** D72: a project's key is its repository's canonical key, else its folder name. */
export function batonProjectKey(project: EnvironmentProject): { key: string; label: string } {
  const identity = project.repositoryIdentity;
  if (identity != null) {
    return {
      key: identity.canonicalKey,
      label: identity.name ?? identity.displayName ?? project.title,
    };
  }
  const leaf = project.workspaceRoot.split("/").filter(Boolean).pop() ?? project.title;
  return { key: `dir:${leaf.toLowerCase()}`, label: leaf };
}

export function BatonSidebarSection(props: {
  /** The thread the route has open, as upstream's scoped thread key. */
  readonly activeThreadKey: string | null;
  readonly onOpenThread: (thread: ScopedThreadRef) => unknown;
}): ReactNode {
  const fleet = useBatonFleet();
  const fleets = useBatonFleets(fleet.environmentIds);
  const projects = useProjects();
  const serverConfigs = useAtomValue(environmentServerConfigsAtom);
  const primary = fleet.environmentIds[0];
  // His memory lives on this app's own server, not on whichever connection registered first.
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const memoryHome =
    fleet.environmentIds.find((id) => id === primaryEnvironmentId) ?? fleet.environmentIds[0];
  // Where each job was started, so a later stop or agree asks the server that holds it.
  const jobHomes = useRef(new Map<string, string>());
  const usage = JSON.stringify(
    batonUsageSummaries(
      [...serverConfigs].map(([environmentId, config]) => ({
        box: fleet.resolveEnvironmentLabel(environmentId) ?? environmentId,
        providers: config.providers,
      })),
    ),
  );
  // Baton's own window draws these; the push is by change, not on a timer.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- tells the desktop shell outside React
  useEffect(() => {
    batonDesktopBridge()?.setBatonUsage?.(JSON.parse(usage));
  }, [usage]);
  const quiet = { reportFailure: false } as const;
  const watchGet = useAtomCommand(batonWorkSessions.watchGet, quiet);
  const weaveSend = useAtomCommand(batonWorkSessions.weaveSend, quiet);
  const weaveList = useAtomCommand(batonWorkSessions.weaveList, quiet);
  const weaveTick = useAtomCommand(batonWorkSessions.weaveTick, quiet);
  const handoffJob = useAtomCommand(batonWorkSessions.handoff, quiet);
  const phoneCall = useAtomCommand(batonWorkSessions.phoneCall, quiet);
  const cloudRead = useAtomCommand(batonWorkSessions.cloudRead, quiet);
  const cloudAct = useAtomCommand(batonWorkSessions.cloudAct, quiet);
  const cloudApprove = useAtomCommand(batonWorkSessions.cloudApprove, quiet);
  const commitmentsList = useAtomCommand(batonWorkSessions.commitmentsList, quiet);
  const commitmentsUpsert = useAtomCommand(batonWorkSessions.commitmentsUpsert, quiet);
  const memoryList = useAtomCommand(batonWorkSessions.memoryList, quiet);
  const memorySearch = useAtomCommand(batonWorkSessions.memorySearch, quiet);
  const memoryAdd = useAtomCommand(batonWorkSessions.memoryAdd, quiet);
  const memoryEdit = useAtomCommand(batonWorkSessions.memoryEdit, quiet);
  const memoryPin = useAtomCommand(batonWorkSessions.memoryPin, quiet);
  const memoryForget = useAtomCommand(batonWorkSessions.memoryForget, quiet);
  const memoryAccept = useAtomCommand(batonWorkSessions.memoryAccept, quiet);
  const memoryRecall = useAtomCommand(batonWorkSessions.memoryRecall, quiet);
  const memoryUsed = useAtomCommand(batonWorkSessions.memoryUsed, quiet);
  const memoryExport = useAtomCommand(batonWorkSessions.memoryExport, quiet);
  const memoryLearn = useAtomCommand(batonWorkSessions.memoryLearn, quiet);
  const memoryImport = useAtomCommand(batonWorkSessions.memoryImport, quiet);
  const memoryPull = useAtomCommand(batonWorkSessions.memoryPull, quiet);
  const memorySyncHello = useAtomCommand(batonWorkSessions.memorySyncHello, quiet);
  const memorySyncPull = useAtomCommand(batonWorkSessions.memorySyncPull, quiet);
  const memorySyncPush = useAtomCommand(batonWorkSessions.memorySyncPush, quiet);
  const jobList = useAtomCommand(batonWorkSessions.jobList, quiet);
  const jobStart = useAtomCommand(batonWorkSessions.jobStart, quiet);
  const jobAgree = useAtomCommand(batonWorkSessions.jobAgree, quiet);
  const jobRefine = useAtomCommand(batonWorkSessions.jobRefine, quiet);
  const jobSplit = useAtomCommand(batonWorkSessions.jobSplit, quiet);
  const jobStop = useAtomCommand(batonWorkSessions.jobStop, quiet);
  const jobSchedule = useAtomCommand(batonWorkSessions.jobSchedule, quiet);
  const jobGrant = useAtomCommand(batonWorkSessions.jobGrant, quiet);
  const jobRevoke = useAtomCommand(batonWorkSessions.jobRevoke, quiet);
  if (primary === undefined) return null;

  const projectByEnvironmentId = new Map(
    projects.map((project) => [`${project.environmentId}:${project.id}`, project]),
  );
  const projectByKey = new Map(projects.map((project) => [batonProjectKey(project).key, project]));
  const providerEntries = deriveProviderEntriesByEnvironment(
    [...serverConfigs].map(([environmentId, config]) => [environmentId, config.providers]),
  );

  const resolveWorkProject = (environmentId: EnvironmentId, projectId: ProjectId) => {
    const project = projectByEnvironmentId.get(`${environmentId}:${projectId}`);
    return project === undefined ? null : batonProjectKey(project);
  };
  const resolveWorkAccount = (environmentId: EnvironmentId, entry: BatonFleetEntry) => {
    const instance = entry.threads.find(
      (thread) => thread.threadId === entry.activeThreadId,
    )?.providerInstanceId;
    return instance == null
      ? null
      : (fleet.resolveProviderAccount(environmentId, instance)?.label ?? null);
  };
  const listHandoffTargets = (environmentId: EnvironmentId) =>
    [...(providerEntries.get(environmentId)?.values() ?? [])].flatMap((entry) => {
      if (!isProviderInstancePickerReady(entry)) return [];
      const model = entry.models.find((candidate) => candidate.isDefault) ?? entry.models[0];
      return model === undefined
        ? []
        : [{ instanceId: entry.instanceId, label: entry.displayName, model: model.slug }];
    });
  // A work session opens the thread it runs through; with none live there is nothing to open.
  const openWorkSession = (environmentId: EnvironmentId, entry: BatonFleetEntry) => {
    const threadId = entry.activeThreadId ?? entry.threads[0]?.threadId ?? null;
    if (threadId !== null) void props.onOpenThread(scopeThreadRef(environmentId, threadId));
  };
  /** The desktop assistant's job tools: the project by the name he said, the first ready Claude as the worker. */
  const onJob = async (request: BatonJobBridgeRequest): Promise<unknown> => {
    const { op, args } = request;
    const text = (key: string) => (typeof args[key] === "string" ? args[key] : "");
    const targets = fleet.environmentIds.map((id) => ({
      id: id as string,
      label: fleet.resolveEnvironmentLabel(id) ?? (id as string),
    }));
    // "Run on": a job starts on the server he names; later calls about it go to the server that holds it.
    let target = primary;
    if (op === "start") {
      const choice = resolveRunOn(text("runOn"), targets, primary as string);
      if (!choice.ok) throw new Error(choice.why);
      target = choice.id as typeof primary;
    } else if (typeof args["id"] === "string") {
      target = homeOf(args["id"], jobHomes.current, primary as string) as typeof primary;
    }
    const env = { environmentId: target };
    const done = <V,>(result: { _tag: string; value?: V }): V => {
      if (result._tag !== "Success") throw new Error("That job request failed. Nothing changed.");
      return result.value as V;
    };
    switch (op) {
      case "list": {
        // Every connected server's jobs, each marked with where it runs.
        const all = await Promise.all(
          fleet.environmentIds.map(async (id) => {
            const result = await jobList({ environmentId: id, input: {} });
            if (result._tag !== "Success") return [];
            const label = fleet.resolveEnvironmentLabel(id) ?? (id as string);
            return (result.value as { jobs: ReadonlyArray<{ workSessionId: string }> }).jobs.map(
              (job) => {
                jobHomes.current.set(job.workSessionId, id as string);
                return { ...job, runOn: label };
              },
            );
          }),
        );
        return { jobs: all.flat() };
      }
      case "watch":
        return done(await watchGet({ ...env, input: {} }));
      case "start": {
        const wanted = text("project").trim().toLowerCase();
        const mine = projects.filter((p) => p.environmentId === target);
        const project = mine.find((p) => {
          const label = batonProjectKey(p).label.toLowerCase();
          return label === wanted || p.title.toLowerCase() === wanted;
        });
        if (project === undefined) {
          throw new Error(
            `No project is called "${text("project")}". Projects: ${mine.map((p) => batonProjectKey(p).label).join(", ")}.`,
          );
        }
        const worker = [...(providerEntries.get(target)?.values() ?? [])].find(
          (entry) => isProviderInstancePickerReady(entry) && entry.driverKind === "claudeAgent",
        );
        const model = worker?.models.find((m) => m.isDefault) ?? worker?.models[0];
        if (worker === undefined || model === undefined) {
          throw new Error("No signed-in Claude is ready to be the worker.");
        }
        const strings = (key: string) =>
          Array.isArray(args[key]) ? (args[key] as ReadonlyArray<string>) : [];
        const tools = strings("tools") as ReadonlyArray<
          "read" | "edit" | "shell" | "web" | "sessions"
        >;
        const started = done(
          await jobStart({
            ...env,
            input: {
              projectId: project.id,
              title: text("title"),
              goal: text("goal"),
              permissions: {
                folders: strings("folders"),
                projects: [batonProjectKey(project).label],
                tools: tools.length === 0 ? ["read"] : tools,
              },
              ...(typeof args["reportEveryMinutes"] === "number"
                ? { limits: { reportEveryMinutes: args["reportEveryMinutes"] } }
                : {}),
              modelSelection: { instanceId: worker.instanceId, model: model.slug },
              // Anything the worker would ask permission for becomes a card that needs him.
              runtimeMode: "approval-required",
            },
          }),
        );
        jobHomes.current.set(
          (started as { terms: { workSessionId: string } }).terms.workSessionId,
          target as string,
        );
        return started;
      }
      case "split":
        return done(
          await jobSplit({
            ...env,
            input: {
              id: text("id") as never,
              parts: (Array.isArray(args["parts"]) ? args["parts"] : []) as never,
            },
          }),
        );
      case "handoff": {
        const wanted = text("instance").trim().toLowerCase();
        const targets = listHandoffTargets(primary);
        const target = targets.find(
          (t) => t.instanceId.toLowerCase() === wanted || t.label.toLowerCase() === wanted,
        );
        if (target === undefined) {
          throw new Error(
            `No worker is called "${text("instance")}". Ready: ${targets.map((t) => t.label).join(", ") || "none"}.`,
          );
        }
        return done(
          await handoffJob({
            ...env,
            input: {
              id: text("id") as never,
              modelSelection: { instanceId: target.instanceId, model: target.model },
              ...(text("note") === "" ? {} : { note: text("note") }),
            } as never,
          }),
        );
      }
      case "stop":
        return done(await jobStop({ ...env, input: { id: text("id") as never } }));
      case "schedule":
        return done(
          await jobSchedule({
            ...env,
            input: {
              id: text("id") as never,
              everyMinutes: typeof args["everyMinutes"] === "number" ? args["everyMinutes"] : null,
            },
          }),
        );
      case "agree":
        return done(await jobAgree({ ...env, input: { id: text("id") as never } }));
      case "refine":
        return done(
          await jobRefine({
            ...env,
            input: {
              id: text("id") as never,
              text: text("text"),
              via: args["via"] === "text" ? "text" : "voice",
              widens: args["widens"] === true,
              ...(args["note"] === true ? { note: true } : {}),
            },
          }),
        );
      case "grant":
      case "revoke":
        return done(
          await (op === "grant" ? jobGrant : jobRevoke)({
            ...env,
            input: { id: text("id") as never, channel: text("channel") as never },
          }),
        );
    }
  };
  /** The desktop assistant's memory calls: the memory RPCs, with a refusal's reason kept in plain words. */
  /**
   * Memory between the servers this window is connected to (MEMORY.md section 6): for each pair, ask
   * the one what the other has not seen and hand it over. Last writer wins; the servers keep the cursors.
   */
  const syncMemory = async (): Promise<unknown> => {
    type Reply<V> = { readonly _tag: "Success"; readonly value: V } | { readonly _tag: "Failure" };
    const call = async <V,>(run: unknown, environmentId: EnvironmentId, input: unknown) =>
      await (run as (c: { environmentId: EnvironmentId; input: never }) => Promise<Reply<V>>)({
        environmentId,
        input: input as never,
      });
    const hellos = (
      await Promise.all(
        fleet.environmentIds.map(async (environmentId) => {
          const reply = await call<{ origin: string; cursors: Record<string, string> }>(
            memorySyncHello,
            environmentId,
            {},
          );
          return reply._tag === "Success" ? [{ environmentId, ...reply.value }] : [];
        }),
      )
    ).flat();
    // Two connections to the same server count once.
    const servers = hellos.filter((h, i) => hellos.findIndex((o) => o.origin === h.origin) === i);
    let applied = 0;
    for (const to of servers) {
      for (const from of servers) {
        if (to.origin === from.origin) continue;
        const pulled = await call<{
          origin: string;
          changes: ReadonlyArray<unknown>;
          upTo: string;
        }>(memorySyncPull, from.environmentId, { since: to.cursors[from.origin] ?? null });
        if (pulled._tag !== "Success") continue;
        const pushed = await call<{ applied: number }>(memorySyncPush, to.environmentId, {
          from: pulled.value.origin,
          changes: pulled.value.changes,
          upTo: pulled.value.upTo,
        });
        if (pushed._tag === "Success") applied += pushed.value.applied;
      }
    }
    return { servers: servers.length, applied };
  };
  const onWeave = async (request: BatonWeaveBridgeRequest): Promise<unknown> => {
    const commands = { send: weaveSend, list: weaveList, tick: weaveTick };
    const run = commands[request.op] as unknown as (call: {
      readonly environmentId: typeof primary;
      readonly input: never;
    }) => Promise<
      | { readonly _tag: "Success"; readonly value: unknown }
      | ({ readonly _tag: "Failure" } & Parameters<typeof squashAtomCommandFailure>[0])
    >;
    const result = await run({ environmentId: primary, input: request.args as never });
    if (result._tag === "Success") return result.value;
    const reason = (squashAtomCommandFailure(result) as { reason?: unknown } | null)?.reason;
    throw new Error(
      typeof reason === "string" ? reason : "Weaving did not answer. Nothing was sent.",
    );
  };
  const onCloud = async (request: BatonCloudBridgeRequest): Promise<unknown> => {
    if (request.op === "environments") {
      return fleet.environmentIds.map((id) => ({
        id,
        label: fleet.resolveEnvironmentLabel(id) ?? id,
      }));
    }
    // Only an environment this window is actually connected to can be asked.
    const target = fleet.environmentIds.find((id) => id === request.environmentId) ?? primary;
    const result = await (
      request.op === "read" ? cloudRead : request.op === "approve" ? cloudApprove : cloudAct
    )({ environmentId: target, input: request.args as never });
    if (result._tag === "Success") return result.value;
    const refused = JSON.stringify(result).includes("baton:cloud-approve");
    return {
      ok: false,
      error: refused
        ? "This connection is not allowed to approve cloud tasks. Pair this computer with the approval permission on the computer that runs them."
        : "The computer that runs cloud tasks did not answer.",
    };
  };
  const onPhone = async (request: BatonPhoneBridgeRequest): Promise<unknown> => {
    const result = await phoneCall({
      environmentId: primary,
      input: { op: request.op, args: request.args } as never,
    });
    if (result._tag === "Success") return (result.value as { value: unknown }).value;
    const reason = (squashAtomCommandFailure(result) as { reason?: unknown } | null)?.reason;
    throw new Error(typeof reason === "string" ? reason : "The phone relay did not answer.");
  };
  const onCommitments = async (request: BatonCommitmentBridgeRequest): Promise<unknown> => {
    const run = (request.op === "list" ? commitmentsList : commitmentsUpsert) as unknown as (call: {
      readonly environmentId: typeof primary;
      readonly input: never;
    }) => Promise<
      | { readonly _tag: "Success"; readonly value: unknown }
      | ({ readonly _tag: "Failure" } & Parameters<typeof squashAtomCommandFailure>[0])
    >;
    const result = await run({ environmentId: primary, input: request.args as never });
    if (result._tag === "Success") return result.value;
    const reason = (squashAtomCommandFailure(result) as { reason?: unknown } | null)?.reason;
    throw new Error(
      typeof reason === "string" ? reason : "The commitments did not answer. Nothing changed.",
    );
  };
  const onMemory = async (request: BatonMemoryBridgeRequest): Promise<unknown> => {
    if (request.op === "sync") return syncMemory();
    const commands = {
      list: memoryList,
      search: memorySearch,
      add: memoryAdd,
      edit: memoryEdit,
      pin: memoryPin,
      forget: memoryForget,
      accept: memoryAccept,
      recall: memoryRecall,
      used: memoryUsed,
      export: memoryExport,
      learn: memoryLearn,
      import: memoryImport,
      pull: memoryPull,
      syncPush: memorySyncPush,
    };
    type Settled =
      | { readonly _tag: "Success"; readonly value: unknown }
      | ({ readonly _tag: "Failure" } & Parameters<typeof squashAtomCommandFailure>[0]);
    const run = commands[request.op] as unknown as (call: {
      readonly environmentId: typeof primary;
      readonly input: never;
    }) => Promise<Settled>;
    const result = await run({ environmentId: memoryHome, input: request.args as never });
    if (result._tag === "Success") return result.value;
    const reason = (squashAtomCommandFailure(result) as { reason?: unknown } | null)?.reason;
    throw new Error(
      typeof reason === "string" ? reason : "Memory did not answer. Nothing changed.",
    );
  };
  const primaryEntries = fleets.find((entry) => entry.environmentId === primary)?.fleet?.entries;

  return (
    <div className="flex flex-col gap-1 pt-1">
      <BatonIntentBar
        environmentId={primary}
        // §14 rung 3: the work the open thread belongs to.
        focusedWorkSessionId={focusedWorkSessionFromThreads(
          primaryEntries ?? [],
          primary,
          props.activeThreadKey,
        )}
        onRan={() => undefined}
        onJob={onJob}
        onMemory={onMemory}
        onCommitments={onCommitments}
        onWeave={onWeave}
        onPhone={onPhone}
        onCloud={onCloud}
      />
      <BatonProjectsBlock
        environmentIds={fleet.environmentIds}
        resolveEnvironmentLabel={fleet.resolveEnvironmentLabel}
        resolveWorkProject={resolveWorkProject}
        resolveWorkAccount={resolveWorkAccount}
        resolveProjectForKey={(key) => projectByKey.get(key) ?? null}
        onOpenWorkSession={openWorkSession}
        onOpenThreadById={(environmentId, threadId) =>
          void props.onOpenThread(scopeThreadRef(environmentId, threadId as ThreadId))
        }
        listHandoffTargets={listHandoffTargets}
      />
    </div>
  );
}
