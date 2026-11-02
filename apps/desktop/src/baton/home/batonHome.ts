/* oxlint-disable t3code/no-global-process-runtime -- Baton file predating the rule (D82) */
/* oxlint-disable t3code/no-low-value-comments -- Baton file predating upstream's rule (D82) */
/**
 * Baton's own window: a settings home with a few plain choices up front and the raw ones behind
 * "More" (D130). It is not T3's web app. The page is local, built from a string like the pill and
 * the ask box, and talks to the main process over three IPC channels. Every control is described
 * by data (`HomeControl`), so the tray, the voice side and the companion each own their settings and
 * this file owns only how they look.
 */
// @effect-diagnostics nodeBuiltinImport:off globalTimers:off
import * as Electron from "electron";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { markCompanionWindow } from "../lastAppWindow.ts";
import { homeDocumentFor } from "./homeDocument.ts";
import { THEME_GROUND, resolveTheme, type Appearance } from "./theme.ts";
import { tabOf, type TabId } from "./tabs.ts";
import {
  applyLookScript,
  effectiveGlass,
  effectiveMotion,
  lookClasses,
  materialFor,
  type Glass,
  type Motion,
} from "./look.ts";
import { shouldSplash } from "./splash.ts";
import { startSplash } from "./splashWindow.ts";

export interface HomeOption {
  readonly value: string;
  readonly label: string;
  /** One line saying what choosing it does. */
  readonly note?: string;
}

interface HomeControlBase {
  readonly id: string;
  readonly section: string;
  readonly label: string;
  readonly hint?: string;
  /** Behind "More" in its section. */
  readonly more?: boolean;
  readonly disabled?: boolean;
  /** What the closed section's button says ("Show all"), when it is not "More options". */
  readonly moreLabel?: string;
  /** Which tab it is drawn on; filled in here from its id. */
  readonly tab?: TabId;
  /** Its section goes first: what he should do before anything else. */
  readonly lead?: boolean;
}

export type HomeControl =
  | (HomeControlBase & { readonly kind: "toggle"; readonly on: boolean })
  | (HomeControlBase & {
      readonly kind: "choice";
      readonly value: string;
      readonly options: ReadonlyArray<HomeOption>;
    })
  | (HomeControlBase & {
      readonly kind: "action";
      readonly button: string;
      /** A second button beside it; its action id is `<id>:later`. */
      readonly secondary?: string;
    })
  /** One of several, each with a note; "soon" rows are shown and cannot be picked. */
  | (HomeControlBase & {
      readonly kind: "brain";
      readonly value: string;
      readonly options: ReadonlyArray<{
        readonly value: string;
        readonly label: string;
        readonly note: string;
        readonly state: "ready" | "unavailable" | "soon";
      }>;
    })
  /** One live session: open its thread, or type to it. */
  | (HomeControlBase & {
      readonly kind: "session";
      readonly project: string;
      readonly box: string;
      readonly state: "working" | "waiting" | "idle";
      readonly stateLabel: string;
      readonly urgent: boolean;
      readonly masked?: string;
      readonly revealed?: string;
      readonly canOpen: boolean;
      readonly canSend: boolean;
    })
  /** One line of the Check area: how it is, and what to do. */
  | (HomeControlBase & {
      readonly kind: "check";
      readonly status: "ok" | "warn" | "bad";
      readonly detail: string;
      readonly fix?: string;
    })
  /** A text he edits in the window. Ids: `<id>:save` (the text) and `<id>:reset` (back to the default). */
  | (HomeControlBase & {
      readonly kind: "editor";
      readonly text: string;
      /** His own file exists, so "Use default" does something. */
      readonly mine: boolean;
    })
  /** A calendar of days as a grid, oldest first, one column per week: level 0 to 4, or -1 for a blank. */
  | (HomeControlBase & {
      readonly kind: "heat";
      readonly cells: ReadonlyArray<{ readonly label: string; readonly level: number }>;
    })
  /** A list he edits: each item with Remove, and a line to add one. Ids: `<id>:add` (the text) and `<id>:rm` (the item). */
  | (HomeControlBase & {
      readonly kind: "list";
      readonly items: ReadonlyArray<string>;
      readonly placeholder: string;
      readonly addLabel?: string;
    })
  /** One memory (D150): its text is the label, `hint` says where it came from. Edit, pin and forget are the page's. */
  | (HomeControlBase & {
      readonly kind: "memory";
      readonly pinned: boolean;
      /** A proposal waiting for his yes. */
      readonly held: boolean;
      /** The plain answer to "why do you remember this". */
      readonly why: string;
    })
  /** The Sessions browser's bar: search, machine and state filters, New session. */
  | (HomeControlBase & {
      readonly kind: "catalogBar";
      readonly query: string;
      readonly machine: string;
      readonly stateFilter: string;
      readonly machines: ReadonlyArray<HomeOption>;
      readonly states: ReadonlyArray<HomeOption>;
      /** Every word the bar shows, so the page script holds none. */
      readonly words: Readonly<Record<string, string>>;
      readonly creating: boolean;
      readonly newMachine: string;
      readonly folders: ReadonlyArray<string>;
      readonly models: ReadonlyArray<HomeOption>;
      readonly efforts: ReadonlyArray<HomeOption>;
      readonly status: string;
      /** Rows past the page, behind Show more. */
      readonly remaining: number;
    })
  /** One session in the browser: running or stopped, on a machine, with Resume when it is stopped. */
  | (HomeControlBase & {
      readonly kind: "catalogRow";
      readonly project: string;
      readonly machine: string;
      readonly when: string;
      readonly state: "running" | "stopped" | "resuming" | "failed";
      readonly stateLabel: string;
      readonly resumeLabel: string | null;
      readonly source: string;
    })
  /** The Memory area's bar: search, the kinds to browse, export, import and sync. */
  | (HomeControlBase & {
      readonly kind: "memoryBar";
      readonly query: string;
      readonly filter: string;
      readonly kinds: ReadonlyArray<{
        readonly value: string;
        readonly label: string;
        readonly count: number;
      }>;
      readonly usedOnly: boolean;
      readonly usedCount: number;
      readonly syncOn: boolean;
      /** The daily pull of learnings from the history index (held for his yes). */
      readonly pullOn: boolean;
      readonly status: string;
    })
  /** The Vault area's header: make, unlock, lock, add, export, import, and the activity log (D151). */
  | (HomeControlBase & {
      readonly kind: "vaultBar";
      readonly state: "none" | "locked" | "unlocked";
      readonly status: string;
      /** Shown once after the vault is made, until he says it is saved. */
      readonly recovery: string | null;
      /** Windows Hello is there to confirm it is him. */
      readonly hello: boolean;
      readonly activity: ReadonlyArray<string>;
    })
  /** One secret: its name and rules; the value only while he has asked to see it. */
  | (HomeControlBase & {
      readonly kind: "vaultItem";
      readonly policy: string;
      /** Financial: the policy cannot be changed. */
      readonly locked: boolean;
      readonly revealed: string | null;
    })
  /** Shown masked until he clicks it. */
  | (HomeControlBase & {
      readonly kind: "secret";
      readonly masked: string;
      readonly revealed: string;
    });

export interface HomeActivity {
  readonly at: string;
  readonly text: string;
  readonly kind: string;
  readonly dim?: boolean;
}

/** What the tabs show beyond the controls: all data, nothing the page decides. */
export interface HomeExtra {
  /** The first-run guide: shown on its own when `show`, and run again from Settings. */
  readonly setup?: {
    readonly show: boolean;
    readonly steps: ReadonlyArray<{
      readonly id: string;
      readonly title: string;
      readonly text: string;
      readonly controls: ReadonlyArray<string>;
      readonly meter?: boolean;
      readonly tryBox?: boolean;
    }>;
    readonly hold: string;
  };
  readonly wakeWords: ReadonlyArray<string>;
  readonly activity: ReadonlyArray<HomeActivity>;
  readonly stats: {
    readonly turns: number;
    readonly dictations: number;
    readonly sessions: number;
    readonly needYou: number;
  };
  readonly insights: {
    readonly wordsToday: number;
    readonly wpm: number | null;
    readonly streak: number;
    readonly topApps: ReadonlyArray<{ readonly app: string; readonly count: number }>;
  };
  readonly vocabulary: ReadonlyArray<{
    readonly phrase: string;
    readonly replacement: string | null;
  }>;
  readonly hotkeys: ReadonlyArray<{
    readonly label: string;
    readonly keys: string;
    readonly tab: string;
    readonly hint?: string;
  }>;
  readonly usage: ReadonlyArray<{
    readonly account: string;
    readonly box: string;
    readonly windows: ReadonlyArray<{
      readonly label: string;
      readonly usedPercent: number | null;
      readonly resetsAt: string | null;
    }>;
  }>;
  readonly bindings: ReadonlyArray<{
    readonly action: string;
    readonly label: string;
    readonly hint: string;
    /** Up to four ways to do it; empty is off on purpose. */
    readonly inputs: ReadonlyArray<
      | { readonly type: "key"; readonly accelerator: string }
      | { readonly type: "mouse"; readonly button: string }
    >;
    readonly isDefault: boolean;
    readonly conflictsWith: ReadonlyArray<string>;
    /** Per input who else has it, to say so beside the chip. */
    readonly conflicts: ReadonlyArray<{
      readonly index: number;
      readonly with: ReadonlyArray<string>;
    }>;
  }>;
  /** Why the last change to a binding was refused, in plain words; null when it was not. */
  readonly bindingsNote: string | null;
  /** Whether Baton can act on a mouse button yet; until then they are saved and say so. */
  readonly mouseReady: boolean;
  readonly lifecycle: ReadonlyArray<{ readonly at: string; readonly text: string }>;
  readonly paths: ReadonlyArray<{
    readonly id: string;
    readonly label: string;
    readonly path: string;
  }>;
  readonly about: {
    readonly version: string;
    readonly source: string;
    readonly licence: string;
    readonly notices: string;
  };
}

export interface HomeState {
  readonly status: {
    readonly label: string;
    readonly tone: string;
    readonly device: string;
    /** The mark in the state's colour, made by the main process. */
    readonly mark: string;
    /** The same mark in Baton's own colour, for the sidebar. */
    readonly brandMark?: string;
  };
  readonly controls: ReadonlyArray<HomeControl>;
  readonly extra?: HomeExtra;
}

export interface BatonHomeInput {
  /** Where the window remembers its size. */
  readonly stateDir: string;
  readonly state: () => HomeState;
  readonly apply: (id: string, value: string | boolean | null) => void;
  readonly openSessions: () => void;
  /** The window moved to this tab. */
  readonly onTab?: (tab: string) => void;
  /** System, Light or Dark, as he chose it in Settings. */
  readonly appearance: () => Appearance;
  /** The motion and glass he chose; the system's own asks are read here. */
  readonly look?: () => { readonly motion: Motion; readonly glass: Glass };
  /** Whether this run was started quietly (at sign-in, or hidden): no splash then. */
  readonly quietLaunch?: () => boolean;
  /** The microphone's level now, 0 to 1, for the guide's meter. */
  readonly level?: () => number;
}

export interface BatonHome {
  readonly open: () => void;
  /** Re-reads Motion and Glass and applies them to the open window now. */
  readonly applyLook: () => void;
  /** Push fresh state if the window is up. */
  readonly refresh: () => void;
}

const DEFAULT_WIDTH = 1100;
const DEFAULT_HEIGHT = 740;

/** The last size and place, or null: a missing or odd file is the default size. */
const readBounds = (file: string) => {
  try {
    const parsed: unknown = JSON.parse(NodeFS.readFileSync(file, "utf8"));
    if (typeof parsed !== "object" || parsed === null) return null;
    const { x, y, width, height } = parsed as Record<string, unknown>;
    if (typeof width !== "number" || typeof height !== "number") return null;
    if (width < 860 || height < 580 || width > 6000 || height > 4000) return null;
    return {
      width,
      height,
      ...(typeof x === "number" ? { x } : {}),
      ...(typeof y === "number" ? { y } : {}),
    };
  } catch {
    return null;
  }
};

const GET = "baton-home:get";
const SET = "baton-home:set";
const SESSIONS = "baton-home:sessions";
const PUSH = "baton-home:state";
const THEME = "baton-home:theme";
const LEVEL = "baton-home:level";

const withTabs = (state: HomeState): HomeState => ({
  ...state,
  controls: state.controls.map((c) => ({ ...c, tab: c.tab ?? tabOf(c.id) })),
});

export const createBatonHome = (input: BatonHomeInput): BatonHome => {
  let win: Electron.BrowserWindow | null = null;
  const live = () => (win !== null && !win.isDestroyed() ? win : null);

  Electron.ipcMain.handle(GET, () => withTabs(input.state()));
  Electron.ipcMain.handle(SET, (_event, id: unknown, value: unknown) => {
    if (
      typeof id === "string" &&
      (value === null || ["string", "boolean"].includes(typeof value))
    ) {
      input.apply(id, value as string | boolean | null);
    }
    return withTabs(input.state());
  });
  Electron.ipcMain.handle(LEVEL, () => input.level?.() ?? 0);
  Electron.ipcMain.on(SESSIONS, () => input.openSessions());
  // BATON_TEST_DIR: a PNG of the window's own page at each tab change, from inside the app; otherwise nothing.
  let tabShots = 0;
  Electron.ipcMain.on("baton-home:tab", (_event, tab: unknown) => {
    if (typeof tab === "string") input.onTab?.(tab);
    const dir = process.env["BATON_TEST_DIR"] ?? "";
    const open = live();
    if (dir === "" || open === null || typeof tab !== "string") return;
    const n = (tabShots += 1);
    setTimeout(() => {
      if (open.isDestroyed()) return;
      void open.webContents
        .capturePage()
        .then((image) => {
          NodeFS.mkdirSync(dir, { recursive: true });
          NodeFS.writeFileSync(
            NodePath.join(dir, `home-${tab.replace(/[^a-z]/g, "")}-${n}.png`),
            image.toPNG(),
          );
        })
        .catch(() => undefined);
    }, 500).unref();
  });

  const systemAsks = () => ({
    reducedMotion:
      Electron.systemPreferences.getAnimationSettings?.().prefersReducedMotion === true,
    reducedTransparency:
      (Electron.nativeTheme as { prefersReducedTransparency?: boolean })
        .prefersReducedTransparency === true,
  });
  const look = () => {
    const chosen = input.look?.() ?? { motion: "full" as const, glass: "on" as const };
    return {
      motion: effectiveMotion(chosen.motion, systemAsks()),
      glass: effectiveGlass(chosen.glass, systemAsks()),
    };
  };
  const material = () => materialFor(process.platform, NodeOS.release(), look().glass);
  const overlayFor = (t: "light" | "dark") => ({
    // With a material behind it the strip stays clear, so the glass shows through to the window controls.
    color: material().backgroundMaterial === "mica" ? "#00000000" : THEME_GROUND[t],
    symbolColor: t === "dark" ? "#e9e6df" : "#1c1b18",
    height: 50,
  });
  const boundsFile = NodePath.join(input.stateDir, "baton-window.json");
  /** The page for a theme, written next to the other state only when it differs from what is there. */
  const documentFile = (t: "light" | "dark"): string | null => {
    const file = NodePath.join(input.stateDir, `baton-window-${t}.html`);
    try {
      const html = homeDocumentFor(t);
      if (!NodeFS.existsSync(file) || NodeFS.readFileSync(file, "utf8") !== html) {
        NodeFS.mkdirSync(input.stateDir, { recursive: true });
        NodeFS.writeFileSync(file, html);
      }
      return file;
    } catch {
      return null;
    }
  };
  const theme = () => resolveTheme(input.appearance(), Electron.nativeTheme.shouldUseDarkColors);
  /** The page and the window's own colour, set live: no reload, no flicker. */
  const applyTheme = () => {
    const open = live();
    if (open === null) return;
    open.setBackgroundColor(THEME_GROUND[theme()]);
    // The window controls follow the page, both ways, live.
    if (process.platform !== "darwin") {
      try {
        open.setTitleBarOverlay(overlayFor(theme()));
      } catch {
        // A platform without the overlay keeps its own frame.
      }
    }
    open.webContents.send(THEME, theme());
  };
  Electron.nativeTheme.on("updated", applyTheme);
  /** The classes on the page's root, and the window's material: live, no reload. */
  const applyLook = () => {
    const open = live();
    if (open === null) return;
    const now = look();
    void open.webContents
      .executeJavaScript(applyLookScript(lookClasses(now.motion, now.glass)))
      .catch(() => undefined);
    if (process.platform === "win32") {
      try {
        open.setBackgroundMaterial(material().backgroundMaterial ?? "none");
        open.setBackgroundColor(
          material().backgroundMaterial === "mica" ? "#00000000" : THEME_GROUND[theme()],
        );
        open.setTitleBarOverlay(overlayFor(theme()));
      } catch {
        // Windows 10 and older builds keep a plain background.
      }
    } else if (process.platform === "darwin") {
      try {
        open.setVibrancy(material().vibrancy ?? null);
      } catch {
        // No vibrancy: plain.
      }
    }
  };
  let opened = false;
  return {
    applyLook,
    refresh: () => {
      live()?.webContents.send(PUSH, withTabs(input.state()));
      applyTheme();
      applyLook();
    },
    open: () => {
      const existing = live();
      if (existing !== null) {
        if (existing.isMinimized()) existing.restore();
        existing.show();
        existing.focus();
        return;
      }
      const remembered = readBounds(boundsFile);
      const created = new Electron.BrowserWindow({
        width: remembered?.width ?? DEFAULT_WIDTH,
        height: remembered?.height ?? DEFAULT_HEIGHT,
        ...(remembered?.x === undefined || remembered.y === undefined
          ? {}
          : { x: remembered.x, y: remembered.y }),
        minWidth: 860,
        minHeight: 580,
        title: "Tessaya",
        backgroundColor:
          material().backgroundMaterial === "mica" ? "#00000000" : THEME_GROUND[theme()],
        ...material(),
        autoHideMenuBar: true,
        // Our own title strip, so the window controls take the page's theme, not Windows'.
        ...(process.platform === "darwin"
          ? {}
          : { titleBarStyle: "hidden" as const, titleBarOverlay: overlayFor(theme()) }),
        show: false,
        webPreferences: { nodeIntegration: true, contextIsolation: false },
      });
      // Baton's own window is not T3's: without this "Open sessions" reveals this window and T3 never opens.
      markCompanionWindow(created);
      let saveTimer: ReturnType<typeof setTimeout> | null = null;
      const saveBounds = () => {
        if (saveTimer !== null) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
          if (created.isDestroyed() || created.isMinimized() || created.isMaximized()) return;
          try {
            NodeFS.writeFileSync(boundsFile, JSON.stringify(created.getBounds()));
          } catch {
            // The size is a nicety; losing it must never matter.
          }
        }, 400);
        saveTimer.unref();
      };
      created.on("resized", saveBounds);
      created.on("moved", saveBounds);
      created.removeMenu();
      // The page is ours alone: it never navigates, and a link opens nothing.
      created.webContents.on("will-navigate", (event) => event.preventDefault());
      created.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      // The splash plays on a cold start the person made; it never holds the window past its own 2.5 s cap.
      const coldStart = !opened && process.uptime() < 20;
      opened = true;
      const wanted = shouldSplash({
        coldStart,
        quietLaunch: input.quietLaunch?.() ?? false,
        reducedMotion: look().motion !== "full",
      });
      const splash = wanted
        ? startSplash(
            (() => {
              const b = created.getBounds();
              return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
            })(),
            theme(),
          )
        : null;
      created.webContents.on("did-finish-load", applyLook);
      created.once("ready-to-show", () => {
        if (splash === null) return created.show();
        splash.whenToShow(() => {
          created.setOpacity(0);
          created.show();
          splash.fade((o) => created.isDestroyed() || created.setOpacity(o), 0, 1);
        });
      });
      created.on("closed", () => {
        if (win === created) win = null;
      });
      // A file, not a 600 KB data: URL that is percent-encoded and parsed on every open; the URL is the fallback.
      const file = documentFile(theme());
      if (file !== null) void created.loadFile(file);
      else {
        void created.loadURL(
          `data:text/html;charset=utf-8,${encodeURIComponent(homeDocumentFor(theme()))}`,
        );
      }
      win = created;
    },
  };
};
