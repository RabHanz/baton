// @effect-diagnostics globalTimers:off
/**
 * The catalog service against the real thing: Baton's window asks the T3 sidebar, which asks every connected
 * environment's server (the `baton.sessions.*` methods), and answers with plain JSON. A resume can take most of a
 * minute on the machine, so it waits longer than a click does and, when the server says "resuming", watches the list
 * until the session is running.
 */
import type { CatalogRow, CatalogService, CatalogState } from "./catalogRows.ts";
import type { SessionsBridge } from "./sessionsBridge.ts";

const RESUME_WAIT_MS = 70_000;
const LIST_WAIT_MS = 15_000;
const WATCH_MS = 3_000;
const WATCH_FOR_MS = 60_000;

const STATES: ReadonlyArray<CatalogState> = ["running", "stopped", "resuming", "failed"];
const asString = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** Rows from the sidebar's JSON; anything malformed is dropped rather than shown as "undefined". */
export const rowsFromAnswer = (json: string): ReadonlyArray<CatalogRow> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const rows: CatalogRow[] = [];
  for (const raw of parsed as ReadonlyArray<Record<string, unknown>>) {
    const sessionId = asString(raw["id"]);
    const environmentId = asString(raw["environmentId"]);
    const state = raw["state"] as CatalogState;
    if (sessionId === null || environmentId === null || !STATES.includes(state)) continue;
    const cwd = asString(raw["cwd"]) ?? "";
    rows.push({
      id: `${environmentId}:${sessionId}`,
      sessionId,
      environmentId,
      machine: asString(raw["machine"]) ?? environmentId,
      project: asString(raw["project"]) ?? cwd.split(/[\\/]/).at(-1) ?? "",
      cwd,
      title: asString(raw["title"]) ?? sessionId,
      lastActivityAt: asString(raw["lastActivityAt"]),
      account: asString(raw["account"]),
      state,
      source: raw["source"] === "history" ? "history" : "thread",
      canResume: raw["canResume"] === true,
      detail: asString(raw["detail"]),
    });
  }
  return rows;
};

export const createBridgeCatalogService = (input: {
  readonly bridge: SessionsBridge;
  readonly openMainWindow: () => void;
  readonly wait?: (ms: number) => Promise<void>;
}): CatalogService => {
  const wait = input.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const list = async (query: string) => {
    const answer = await input.bridge.request({ kind: "catalogList", query }, LIST_WAIT_MS);
    if (answer === null) throw new Error("The sessions view did not answer.");
    return rowsFromAnswer(answer.detail);
  };
  return {
    list,
    resume: async (row) => {
      const answer = await input.bridge.request(
        {
          kind: "catalogResume",
          environmentId: row.environmentId,
          sessionId: row.sessionId,
          cwd: row.cwd || null,
        },
        RESUME_WAIT_MS,
      );
      if (answer === null || !answer.ok) throw new Error("not resumed");
      // "resuming" means the server is still bringing it back: watch the list until it is running.
      let state: unknown;
      try {
        state = (JSON.parse(answer.detail) as { state?: unknown }).state;
      } catch {
        state = "running";
      }
      for (let waited = 0; state === "resuming" && waited < WATCH_FOR_MS; waited += WATCH_MS) {
        await wait(WATCH_MS);
        const now = (await list("")).find((r) => r.id === row.id);
        state = now?.state ?? "running";
      }
      if (state === "failed" || state === "resuming") throw new Error("not resumed");
    },
    create: async ({ environmentId, cwd }) => {
      const answer = await input.bridge.request(
        { kind: "catalogCreate", environmentId, cwd },
        RESUME_WAIT_MS,
      );
      if (answer === null || !answer.ok) throw new Error("not started");
    },
    folders: async (environmentId) => {
      const answer = await input.bridge.request(
        { kind: "catalogFolders", environmentId },
        LIST_WAIT_MS,
      );
      try {
        const parsed: unknown = JSON.parse(answer?.detail ?? "[]");
        return Array.isArray(parsed)
          ? parsed.filter((f): f is string => typeof f === "string")
          : [];
      } catch {
        return [];
      }
    },
    // The thread opens in T3's own window; the sidebar selects it from there.
    open: () => input.openMainWindow(),
  };
};
