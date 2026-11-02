// @effect-diagnostics globalTimers:off globalDate:off
/**
 * The Sessions browser (the Director's "resume and continue any claude session in any folder on any environment"):
 * one list of every session on every connected environment, running or stopped, with search and filters, a one-tap
 * Resume, and New session in a folder on a machine. The rows come from a CatalogService (the server's session
 * catalog); this file holds the shape the window needs, the pure rows, and the small state machine for a resume.
 */
import type { HomeControl, HomeOption } from "../home/batonHome.ts";

export type CatalogState = "running" | "stopped" | "resuming" | "failed";

export interface CatalogRow {
  readonly id: string;
  /** The Claude session id on that machine (`id` is unique across machines). */
  readonly sessionId: string;
  /** Why it cannot be resumed, or why it failed, in plain words. */
  readonly detail: string | null;
  readonly environmentId: string;
  /** The machine's display name. */
  readonly machine: string;
  readonly project: string;
  readonly cwd: string;
  readonly title: string;
  readonly lastActivityAt: string | null;
  readonly account: string | null;
  readonly state: CatalogState;
  /** A live thread, or an old session found in the history index. */
  readonly source: "thread" | "history";
  readonly canResume: boolean;
}

export interface CatalogService {
  readonly list: (query: string) => Promise<ReadonlyArray<CatalogRow>>;
  /** Makes the thread live; resolves when it is. */
  readonly resume: (row: CatalogRow) => Promise<void>;
  readonly create: (target: { environmentId: string; cwd: string }) => Promise<void>;
  /** Recent folders on a machine, for the New session box. */
  readonly folders: (environmentId: string) => Promise<ReadonlyArray<string>>;
  /** Opens a live session's thread. */
  readonly open: (row: CatalogRow) => void;
}

export interface CatalogView {
  readonly query: string;
  readonly machine: string;
  readonly state: "all" | "running" | "stopped";
  readonly shown: number;
  readonly creating: boolean;
  readonly newMachine: string;
}

export const CATALOG_PAGE = 25;

export const INITIAL_VIEW: CatalogView = {
  query: "",
  machine: "all",
  state: "all",
  shown: CATALOG_PAGE,
  creating: false,
  newMachine: "",
};

const STATE_WORDS: Readonly<Record<CatalogState, string>> = {
  running: "Running",
  stopped: "Stopped",
  resuming: "Resuming...",
  failed: "Could not resume",
};

/** "5 min ago", "3 h ago", "yesterday", "12 d ago". */
export const agoWords = (iso: string | null, now: number): string => {
  const at = Date.parse(iso ?? "");
  if (!Number.isFinite(at)) return "";
  const minutes = Math.max(0, Math.round((now - at) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} d ago`;
};

const words = (text: string) => text.toLowerCase().split(/\s+/).filter(Boolean);

/** Every word typed is somewhere in the title, project, folder, machine or account. */
export const matches = (row: CatalogRow, query: string): boolean => {
  const hay =
    `${row.title} ${row.project} ${row.cwd} ${row.machine} ${row.account ?? ""}`.toLowerCase();
  return words(query).every((w) => hay.includes(w));
};

export const visibleRows = (
  rows: ReadonlyArray<CatalogRow>,
  view: CatalogView,
): ReadonlyArray<CatalogRow> =>
  rows
    .filter(
      (r) =>
        matches(r, view.query) &&
        (view.machine === "all" || r.environmentId === view.machine) &&
        (view.state === "all" || (view.state === "running") === (r.state === "running")),
    )
    .toSorted(
      (a, b) =>
        (Date.parse(b.lastActivityAt ?? "") || 0) - (Date.parse(a.lastActivityAt ?? "") || 0),
    );

const WORDS = {
  search: "Search sessions, folders and machines",
  new: "New session",
  machine: "Machine",
  folder: "Folder, for example C:\\work\\project",
  start: "Start",
  cancel: "Cancel",
  more: "Show more",
} as const;

export const catalogControls = (input: {
  readonly rows: ReadonlyArray<CatalogRow>;
  readonly view: CatalogView;
  readonly now: number;
  readonly folders: ReadonlyArray<string>;
  readonly status: string;
  readonly loaded: boolean;
}): ReadonlyArray<HomeControl> => {
  const { rows, view } = input;
  const machines: HomeOption[] = [{ value: "all", label: "All machines" }];
  for (const r of rows)
    if (!machines.some((m) => m.value === r.environmentId))
      machines.push({ value: r.environmentId, label: r.machine });
  const shownRows = visibleRows(rows, view);
  const states: HomeOption[] = [
    { value: "all", label: "All" },
    { value: "running", label: "Running" },
    { value: "stopped", label: "Stopped" },
  ];
  const bar: HomeControl = {
    id: "c.bar",
    section: "Sessions",
    label: input.loaded ? `${shownRows.length} of ${rows.length} sessions` : "Loading sessions",
    kind: "catalogBar",
    lead: true,
    query: view.query,
    machine: view.machine,
    stateFilter: view.state,
    machines,
    states,
    words: WORDS,
    creating: view.creating,
    newMachine: view.newMachine || machines[1]?.value || "",
    folders: input.folders,
    status: input.status,
    remaining: Math.max(0, shownRows.length - view.shown),
  };
  const list = shownRows.slice(0, view.shown).map((r): HomeControl => ({
    id: `c:${r.id}`,
    section: "Sessions",
    label: r.title,
    kind: "catalogRow",
    project: r.project,
    machine: r.machine,
    when: agoWords(r.lastActivityAt, input.now),
    state: r.state,
    stateLabel: STATE_WORDS[r.state],
    resumeLabel:
      r.state === "stopped" || r.state === "failed" ? (r.canResume ? "Resume" : null) : null,
    source: r.detail ?? (r.source === "history" ? "From history" : ""),
  }));
  return [bar, ...list];
};

/** The window's side of the catalog: the rows, the view, and a resume that shows "Resuming..." until it is live. */
export const createCatalog = (input: {
  readonly service: CatalogService;
  readonly onChange: () => void;
  readonly now?: () => number;
}) => {
  let rows: ReadonlyArray<CatalogRow> = [];
  let view = INITIAL_VIEW;
  let loaded = false;
  let status = "";
  let folders: ReadonlyArray<string> = [];
  const now = input.now ?? (() => Date.now());
  const set = (patch: Partial<CatalogRow> & { id: string }) => {
    rows = rows.map((r) => (r.id === patch.id ? { ...r, ...patch } : r));
    input.onChange();
  };
  const refresh = async () => {
    try {
      rows = await input.service.list("");
      status = "";
    } catch {
      status = "The session list is not reachable right now.";
    }
    loaded = true;
    input.onChange();
  };
  const loadFolders = async (environmentId: string) => {
    folders = await input.service.folders(environmentId).catch(() => []);
    input.onChange();
  };
  return {
    refresh,
    controls: () => catalogControls({ rows, view, now: now(), folders, status, loaded }),
    /** An action from the window; true when it was the catalog's. */
    apply: (id: string, value: string | boolean | null): boolean => {
      if (!id.startsWith("c.") && !id.startsWith("c:")) return false;
      const text = typeof value === "string" ? value : "";
      if (id === "c.query") {
        view = { ...view, query: text, shown: CATALOG_PAGE };
        // The history index is only searched with words, so a typed query asks the service for more rows.
        if (text.trim().length >= 3)
          void input.service
            .list(text)
            .then((found) => {
              const have = new Set(rows.map((r) => r.id));
              rows = [...rows, ...found.filter((r) => !have.has(r.id))];
              input.onChange();
            })
            .catch(() => undefined);
      } else if (id === "c.machine")
        view = { ...view, machine: text || "all", shown: CATALOG_PAGE };
      else if (id === "c.state")
        view = {
          ...view,
          state: text === "running" || text === "stopped" ? text : "all",
          shown: CATALOG_PAGE,
        };
      else if (id === "c.more") view = { ...view, shown: view.shown + CATALOG_PAGE };
      else if (id === "c.new") {
        view = { ...view, creating: !view.creating };
        if (view.creating) void loadFolders(view.newMachine || rows[0]?.environmentId || "");
      } else if (id === "c.newMachine") {
        view = { ...view, newMachine: text };
        void loadFolders(text);
      } else if (id === "c.start") {
        const folder = text.trim();
        const environmentId = view.newMachine || rows[0]?.environmentId || "";
        if (folder === "" || environmentId === "") return true;
        view = { ...view, creating: false };
        status = "Starting a session...";
        void input.service
          .create({ environmentId, cwd: folder })
          .then(() => {
            status = "";
            return refresh();
          })
          .catch(() => {
            status = "That session could not be started there.";
            input.onChange();
          });
      } else if (id.startsWith("c:")) {
        const row = rows.find((r) => `c:${r.id}` === id);
        if (row === undefined) return true;
        if (value === null && row.state === "running") input.service.open(row);
        else if (row.state === "stopped" || row.state === "failed") {
          set({ id: row.id, state: "resuming" });
          void input.service
            .resume(row)
            .then(() => {
              set({ id: row.id, state: "running" });
              input.service.open(row);
            })
            .catch(() => set({ id: row.id, state: "failed" }));
          return true;
        }
      }
      input.onChange();
      return true;
    },
  };
};

/** Sample rows for the proof recording and for a build whose server has no catalog yet (BATON_MOCK_CATALOG). */
export const sampleCatalogRows = (now: number): CatalogRow[] => {
  const ago = (min: number) => new Date(now - min * 60_000).toISOString();
  return [
    ["laptop", "Laptop", "C:\\work\\tessaya", "Wire the sessions browser", 4, "running"],
    ["laptop", "Laptop", "C:\\work\\notes", "Write the launch post", 190, "stopped"],
    ["server", "Build server", "/srv/digest-bot", "Fix the weekly digest", 60 * 30, "stopped"],
    ["server", "Build server", "/srv/baton", "Teach mode quality set", 12, "running"],
    ["server", "Build server", "/srv/old-site", "Old landing page", 60 * 24 * 12, "stopped"],
  ].map(([env, machine, cwd, title, min, state], i) => ({
    id: `s${i}`,
    sessionId: `s${i}`,
    detail: null,
    environmentId: String(env),
    machine: String(machine),
    project: String(cwd).split(/[\\/]/).at(-1) ?? "",
    cwd: String(cwd),
    title: String(title),
    lastActivityAt: ago(Number(min)),
    account: i % 2 === 0 ? "a@example.com" : null,
    state: state as CatalogState,
    source: i === 4 ? ("history" as const) : ("thread" as const),
    canResume: true,
  }));
};

export const mockCatalogService = (): CatalogService => {
  let rows = sampleCatalogRows(Date.now());
  return {
    list: async () => rows,
    resume: async (row) => {
      await new Promise((r) => setTimeout(r, 1500));
      rows = rows.map((x) => (x.id === row.id ? { ...x, state: "running" } : x));
    },
    create: async ({ environmentId, cwd }) => {
      rows = [
        {
          id: `n${rows.length}`,
          sessionId: `n${rows.length}`,
          detail: null,
          environmentId,
          machine: rows.find((r) => r.environmentId === environmentId)?.machine ?? environmentId,
          project: cwd.split(/[\\/]/).at(-1) ?? cwd,
          cwd,
          title: "New session",
          lastActivityAt: new Date().toISOString(),
          account: null,
          state: "running",
          source: "thread",
          canResume: true,
        },
        ...rows,
      ];
    },
    folders: async (environmentId) => [
      ...new Set(rows.filter((r) => r.environmentId === environmentId).map((r) => r.cwd)),
    ],
    open: () => undefined,
  };
};
