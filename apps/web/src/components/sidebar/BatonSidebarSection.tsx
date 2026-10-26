/**
 * Baton's block in upstream's sidebar, mounted by one line in `Sidebar.tsx`
 * (`vendor-patches/t3code/0006-web-sidebar.patch`). Everything the block needs is resolved here
 * from upstream's own state, so the hook passes only what the sidebar alone knows: which thread
 * the route has open, and how to open one.
 */
import { useAtomValue } from "@effect/atom-react";
import type {
  BatonFleetEntry,
  EnvironmentId,
  ProjectId,
  ScopedThreadRef,
} from "@t3tools/baton-contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { ReactNode } from "react";

import { focusedWorkSessionFromThreads } from "../../batonContextView";
import { useBatonFleet } from "../../batonFleetResolvers";
import {
  deriveProviderEntriesByEnvironment,
  isProviderInstancePickerReady,
} from "../../providerInstances";
import { useProjects } from "../../state/entities";
import { environmentServerConfigsAtom } from "../../state/server";
import { useBatonFleets } from "../../state/batonWorkSessions";
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
      />
      <BatonProjectsBlock
        environmentIds={fleet.environmentIds}
        resolveEnvironmentLabel={fleet.resolveEnvironmentLabel}
        resolveWorkProject={resolveWorkProject}
        resolveWorkAccount={resolveWorkAccount}
        resolveProjectForKey={(key) => projectByKey.get(key) ?? null}
        onOpenWorkSession={openWorkSession}
        listHandoffTargets={listHandoffTargets}
      />
    </div>
  );
}
