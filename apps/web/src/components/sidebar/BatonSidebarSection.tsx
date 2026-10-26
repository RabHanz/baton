/* oxlint-disable t3code/no-manual-memo -- Baton file predating upstream's rule (D82) */
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
import { useCallback, useMemo, useState, type ReactNode } from "react";

import { useBatonFleet } from "../../batonFleetResolvers";
import {
  deriveProviderEntriesByEnvironment,
  isProviderInstancePickerReady,
} from "../../providerInstances";
import { useProjects } from "../../state/entities";
import { environmentServerConfigsAtom } from "../../state/server";
import { BatonFleetSection } from "./BatonFleetSection";

export function BatonSidebarSection(props: {
  /** The thread the route has open, as upstream's scoped thread key. */
  readonly activeThreadKey: string | null;
  readonly onOpenThread: (thread: ScopedThreadRef) => unknown;
}): ReactNode {
  const fleet = useBatonFleet();
  const projects = useProjects();
  const serverConfigs = useAtomValue(environmentServerConfigsAtom);
  const [, setIntentRevision] = useState(0);

  const projectByKey = useMemo(
    () => new Map(projects.map((project) => [`${project.environmentId}:${project.id}`, project])),
    [projects],
  );
  const providerEntries = useMemo(
    () =>
      deriveProviderEntriesByEnvironment(
        [...serverConfigs].map(([environmentId, config]) => [environmentId, config.providers]),
      ),
    [serverConfigs],
  );

  // D72: the project a work session belongs to, keyed the way live sessions are (repository
  // canonical key, else folder name), so one project is one entry across boxes and accounts.
  const resolveWorkProject = useCallback(
    (environmentId: EnvironmentId, projectId: ProjectId) => {
      const project = projectByKey.get(`${environmentId}:${projectId}`);
      if (project === undefined) return null;
      const identity = project.repositoryIdentity;
      if (identity != null) {
        return {
          key: identity.canonicalKey,
          label: identity.name ?? identity.displayName ?? project.title,
        };
      }
      const leaf = project.workspaceRoot.split("/").filter(Boolean).pop() ?? project.title;
      return { key: `dir:${leaf.toLowerCase()}`, label: leaf };
    },
    [projectByKey],
  );

  const resolveWorkAccount = useCallback(
    (environmentId: EnvironmentId, entry: BatonFleetEntry) => {
      const instance = entry.threads.find(
        (thread) => thread.threadId === entry.activeThreadId,
      )?.providerInstanceId;
      if (instance == null) return null;
      return fleet.resolveProviderAccount(environmentId, instance)?.label ?? null;
    },
    [fleet],
  );

  const listHandoffTargets = useCallback(
    (environmentId: EnvironmentId) =>
      [...(providerEntries.get(environmentId)?.values() ?? [])].flatMap((entry) => {
        if (!isProviderInstancePickerReady(entry)) return [];
        const model = entry.models.find((candidate) => candidate.isDefault) ?? entry.models[0];
        return model === undefined
          ? []
          : [{ instanceId: entry.instanceId, label: entry.displayName, model: model.slug }];
      }),
    [providerEntries],
  );

  // A fleet row opens the thread the work runs through. With none live (the work is between
  // providers) there is nothing to open, and the route stays where it is.
  const { onOpenThread } = props;
  const selectWorkSession = useCallback(
    (environmentId: EnvironmentId, entry: BatonFleetEntry) => {
      const threadId = entry.activeThreadId ?? entry.threads[0]?.threadId ?? null;
      if (threadId !== null) void onOpenThread(scopeThreadRef(environmentId, threadId));
    },
    [onOpenThread],
  );

  return (
    <BatonFleetSection
      environmentIds={fleet.environmentIds}
      resolveEnvironmentLabel={fleet.resolveEnvironmentLabel}
      resolveProviderAccount={fleet.resolveProviderAccount}
      resolveProjectLabel={fleet.resolveProjectLabel}
      listHandoffTargets={listHandoffTargets}
      resolveWorkProject={resolveWorkProject}
      resolveWorkAccount={resolveWorkAccount}
      onSelectWorkSession={selectWorkSession}
      onIntentRan={() => setIntentRevision((revision) => revision + 1)}
      activeThreadKey={props.activeThreadKey}
    />
  );
}
