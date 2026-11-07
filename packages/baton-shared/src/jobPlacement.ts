/**
 * Where a job runs, from his words (GEN-6): the project he named and the worker that takes it. The server
 * places a job this way, so the desktop, the phone and an agent all start one the same, with T3's window closed.
 */
import type { ServerProvider } from "@t3tools/contracts";

export interface PlacementProject {
  readonly id: string;
  readonly title: string;
  readonly workspaceRoot: string;
  readonly repositoryIdentity?:
    | {
        readonly canonicalKey: string;
        readonly name?: string | null | undefined;
        readonly displayName?: string | null | undefined;
      }
    | null
    | undefined;
}

/** D72: a project's key is its repository's canonical key, else its folder name. */
export function batonProjectKey(project: PlacementProject): { key: string; label: string } {
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

export interface Worker {
  readonly instanceId: string;
  readonly label: string;
  readonly driver: string;
  readonly model: string;
}

/** Instances that can take work now, each on its default model, as the model picker would offer them. */
export const readyWorkers = (providers: ReadonlyArray<ServerProvider>): ReadonlyArray<Worker> =>
  providers.flatMap((provider) => {
    if (!provider.enabled || provider.availability === "unavailable" || provider.status !== "ready")
      return [];
    const model = provider.models.find((entry) => entry.isDefault === true) ?? provider.models[0];
    return model === undefined
      ? []
      : [
          {
            instanceId: provider.instanceId,
            label: provider.displayName ?? provider.instanceId,
            driver: provider.driver,
            model: model.slug,
          },
        ];
  });

export type Placement<A> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly why: string };

/** The project by the name he said, and the first ready Claude as the worker. */
export const placeJob = <P extends PlacementProject>(
  wanted: string,
  projects: ReadonlyArray<P>,
  providers: ReadonlyArray<ServerProvider>,
): Placement<{ readonly project: P; readonly label: string; readonly worker: Worker }> => {
  const name = wanted.trim().toLowerCase();
  const project = projects.find(
    (entry) =>
      batonProjectKey(entry).label.toLowerCase() === name || entry.title.toLowerCase() === name,
  );
  if (project === undefined) {
    const known = projects.map((entry) => batonProjectKey(entry).label).join(", ");
    return { ok: false, why: `No project is called "${wanted}". Projects: ${known}.` };
  }
  const worker = readyWorkers(providers).find((entry) => entry.driver === "claudeAgent");
  if (worker === undefined)
    return { ok: false, why: "No signed-in Claude is ready to be the worker." };
  return { ok: true, value: { project, label: batonProjectKey(project).label, worker } };
};

/** The worker he named for a handoff, by instance id or name. */
export const handoffTarget = (
  wanted: string,
  providers: ReadonlyArray<ServerProvider>,
): Placement<Worker> => {
  const name = wanted.trim().toLowerCase();
  const workers = readyWorkers(providers);
  const target = workers.find(
    (entry) => entry.instanceId.toLowerCase() === name || entry.label.toLowerCase() === name,
  );
  return target === undefined
    ? {
        ok: false,
        why: `No worker is called "${wanted}". Ready: ${workers.map((entry) => entry.label).join(", ") || "none"}.`,
      }
    : { ok: true, value: target };
};
