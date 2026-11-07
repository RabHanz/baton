// @effect-diagnostics nodeBuiltinImport:off
/** His own standing jobs (KIRO-1), in user-jobs.json beside the built-ins' state; on this computer, as theirs are. */
import * as NodePath from "node:path";

import { MAX_USER_JOBS, type UserJob } from "@t3tools/baton-shared/userJobs";

import { createJsonStore } from "../writing/jsonStore.ts";

interface Saved {
  readonly next: number;
  readonly jobs: ReadonlyArray<UserJob>;
}
const isSaved = (value: unknown): value is Saved =>
  typeof value === "object" &&
  value !== null &&
  Array.isArray((value as Saved).jobs) &&
  typeof (value as Saved).next === "number";

export const createUserJobStore = (dir: string) => {
  const store = createJsonStore<Saved>(
    NodePath.join(dir, "user-jobs.json"),
    { next: 1, jobs: [] },
    isSaved,
  );
  return {
    list: (): ReadonlyArray<UserJob> => store.read().jobs,
    get: (id: string): UserJob | undefined => store.read().jobs.find((j) => j.id === id),
    /** The id the next job gets. */
    nextId: (): string => `user:${store.read().next}`,
    add: (job: UserJob): { readonly ok: true } | { readonly ok: false; readonly why: string } => {
      const saved = store.read();
      if (saved.jobs.length >= MAX_USER_JOBS)
        return {
          ok: false,
          why: `There are already ${MAX_USER_JOBS} of your own jobs; remove one first.`,
        };
      store.write({ next: saved.next + 1, jobs: [...saved.jobs, job] });
      return { ok: true };
    },
    update: (
      id: string,
      patch: Partial<Pick<UserJob, "on" | "proposed" | "instruction" | "title" | "missed">>,
    ): UserJob | null => {
      const saved = store.read();
      const found = saved.jobs.find((j) => j.id === id);
      if (found === undefined) return null;
      const next = { ...found, ...patch };
      store.write({ ...saved, jobs: saved.jobs.map((j) => (j.id === id ? next : j)) });
      return next;
    },
    remove: (id: string): boolean => {
      const saved = store.read();
      if (!saved.jobs.some((j) => j.id === id)) return false;
      store.write({ ...saved, jobs: saved.jobs.filter((j) => j.id !== id) });
      return true;
    },
  };
};
export type UserJobStore = ReturnType<typeof createUserJobStore>;
