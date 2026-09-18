import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import type { FleetAccount } from "@t3tools/shared/fabricFleetView";
import { useCallback, useMemo } from "react";

import { deriveProviderEntriesByEnvironment } from "./providerInstances";
import { useProjects } from "./state/entities";
import { useEnvironments } from "./state/environments";
import { environmentServerConfigsAtom } from "./state/server";
import { useClientSettings } from "./hooks/useSettings";

/**
 * The environments whose fleet can be read, and the three lookups a fleet row
 * needs to name itself: the machine, the account, the project.
 *
 * Two gates, answering different questions. The capability says the server
 * understands `fabric.*` at all — an older one has no such tables and would
 * reject the call, so a client must not probe. The client setting says whether
 * this user wants the fleet.
 */
export function useFabricFleet(): {
  readonly environmentIds: readonly EnvironmentId[];
  readonly resolveEnvironmentLabel: (environmentId: EnvironmentId) => string | null;
  readonly resolveProviderAccount: (
    environmentId: EnvironmentId,
    providerInstanceId: string,
  ) => FleetAccount | null;
  readonly resolveProjectLabel: (
    environmentId: EnvironmentId,
    projectId: ProjectId,
  ) => string | null;
} {
  const { environments } = useEnvironments();
  const serverConfigs = useAtomValue(environmentServerConfigsAtom);
  const projects = useProjects();
  const enabled = useClientSettings((settings) => settings.fabricWorkSessionsEnabled);

  const environmentIds = useMemo(
    () =>
      enabled
        ? environments
            .map((environment) => environment.environmentId)
            .filter(
              (environmentId) =>
                serverConfigs.get(environmentId)?.environment.capabilities.fabricWorkSessions ===
                true,
            )
        : [],
    [enabled, environments, serverConfigs],
  );

  const labelByEnvironment = useMemo(
    () =>
      new Map(environments.map((environment) => [environment.environmentId, environment.label])),
    [environments],
  );

  const providerEntries = useMemo(
    () =>
      deriveProviderEntriesByEnvironment(
        [...serverConfigs].map(([environmentId, config]) => [environmentId, config.providers]),
      ),
    [serverConfigs],
  );

  const projectTitleByKey = useMemo(
    () =>
      new Map(projects.map((project) => [`${project.environmentId}:${project.id}`, project.title])),
    [projects],
  );

  const resolveEnvironmentLabel = useCallback(
    (environmentId: EnvironmentId) => labelByEnvironment.get(environmentId) ?? null,
    [labelByEnvironment],
  );

  const resolveProviderAccount = useCallback(
    (environmentId: EnvironmentId, providerInstanceId: string) => {
      const entry = providerEntries.get(environmentId)?.get(providerInstanceId);
      if (entry === undefined) return null;
      const label = entry.displayName?.trim();
      if (label === undefined || label.length === 0) return null;
      // The address is redacted where it renders, the same treatment the
      // settings card gives it.
      return { label, email: entry.snapshot.auth.email?.trim() || null };
    },
    [providerEntries],
  );

  const resolveProjectLabel = useCallback(
    (environmentId: EnvironmentId, projectId: ProjectId) =>
      projectTitleByKey.get(`${environmentId}:${projectId}`) ?? null,
    [projectTitleByKey],
  );

  return {
    environmentIds,
    resolveEnvironmentLabel,
    resolveProviderAccount,
    resolveProjectLabel,
  };
}
