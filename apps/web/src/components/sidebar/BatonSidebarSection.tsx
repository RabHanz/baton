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
  type EnvironmentId,
  type ProjectId,
  type ScopedThreadRef,
} from "@t3tools/baton-contracts";
import type { ThreadId } from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { useEffect, type ReactNode } from "react";
import { batonUsageSummaries } from "../../batonUsage";

import { focusedWorkSessionFromThreads } from "../../batonContextView";
import { useBatonFleet } from "../../batonFleetResolvers";
import {
  deriveProviderEntriesByEnvironment,
  isProviderInstancePickerReady,
} from "../../providerInstances";
import { useProjects } from "../../state/entities";
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
    const env = { environmentId: primary };
    const text = (key: string) => (typeof args[key] === "string" ? args[key] : "");
    const done = <V,>(result: { _tag: string; value?: V }): V => {
      if (result._tag !== "Success") throw new Error("That job request failed. Nothing changed.");
      return result.value as V;
    };
    switch (op) {
      case "list":
        return done(await jobList({ ...env, input: {} }));
      case "watch":
        return done(await watchGet({ ...env, input: {} }));
      case "start": {
        const wanted = text("project").trim().toLowerCase();
        const mine = projects.filter((p) => p.environmentId === primary);
        const project = mine.find((p) => {
          const label = batonProjectKey(p).label.toLowerCase();
          return label === wanted || p.title.toLowerCase() === wanted;
        });
        if (project === undefined) {
          throw new Error(
            `No project is called "${text("project")}". Projects: ${mine.map((p) => batonProjectKey(p).label).join(", ")}.`,
          );
        }
        const worker = [...(providerEntries.get(primary)?.values() ?? [])].find(
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
        return done(
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
              modelSelection: { instanceId: worker.instanceId, model: model.slug },
              // Anything the worker would ask permission for becomes a card that needs him.
              runtimeMode: "approval-required",
            },
          }),
        );
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
