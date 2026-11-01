/* oxlint-disable t3code/no-low-value-comments -- Baton file predating upstream's rule (D82) */
/**
 * Baton's own window: a settings home with a few plain choices up front and the raw ones behind
 * "More" (D130). It is not T3's web app. The page is local, built from a string like the pill and
 * the ask box, and talks to the main process over three IPC channels. Every control is described
 * by data (`HomeControl`), so the tray, the voice side and the companion each own their settings and
 * this file owns only how they look.
 */
import * as Electron from "electron";

import { HOME_DOCUMENT } from "./homeDocument.ts";

export interface HomeOption {
  readonly value: string;
  readonly label: string;
}

interface HomeControlBase {
  readonly id: string;
  readonly section: string;
  readonly label: string;
  readonly hint?: string;
  /** Behind "More" in its section. */
  readonly more?: boolean;
  readonly disabled?: boolean;
}

export type HomeControl =
  | (HomeControlBase & { readonly kind: "toggle"; readonly on: boolean })
  | (HomeControlBase & {
      readonly kind: "choice";
      readonly value: string;
      readonly options: ReadonlyArray<HomeOption>;
    })
  | (HomeControlBase & { readonly kind: "action"; readonly button: string });

export interface HomeState {
  readonly status: {
    readonly label: string;
    readonly tone: string;
    readonly device: string;
    /** The mark in the state's colour, made by the main process. */
    readonly mark: string;
  };
  readonly controls: ReadonlyArray<HomeControl>;
}

export interface BatonHomeInput {
  readonly state: () => HomeState;
  readonly apply: (id: string, value: string | boolean | null) => void;
  readonly openSessions: () => void;
}

export interface BatonHome {
  readonly open: () => void;
  /** Push fresh state if the window is up. */
  readonly refresh: () => void;
}

const GET = "baton-home:get";
const SET = "baton-home:set";
const SESSIONS = "baton-home:sessions";
const PUSH = "baton-home:state";

export const createBatonHome = (input: BatonHomeInput): BatonHome => {
  let win: Electron.BrowserWindow | null = null;
  const live = () => (win !== null && !win.isDestroyed() ? win : null);

  Electron.ipcMain.handle(GET, () => input.state());
  Electron.ipcMain.handle(SET, (_event, id: unknown, value: unknown) => {
    if (
      typeof id === "string" &&
      (value === null || ["string", "boolean"].includes(typeof value))
    ) {
      input.apply(id, value as string | boolean | null);
    }
    return input.state();
  });
  Electron.ipcMain.on(SESSIONS, () => input.openSessions());

  return {
    refresh: () => live()?.webContents.send(PUSH, input.state()),
    open: () => {
      const existing = live();
      if (existing !== null) {
        if (existing.isMinimized()) existing.restore();
        existing.show();
        existing.focus();
        return;
      }
      const created = new Electron.BrowserWindow({
        width: 640,
        height: 760,
        minWidth: 480,
        minHeight: 520,
        title: "Baton",
        backgroundColor: "#f5f2ec",
        autoHideMenuBar: true,
        show: false,
        webPreferences: { nodeIntegration: true, contextIsolation: false },
      });
      created.removeMenu();
      // The page is ours alone: it never navigates, and a link opens nothing.
      created.webContents.on("will-navigate", (event) => event.preventDefault());
      created.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      created.once("ready-to-show", () => created.show());
      created.on("closed", () => {
        if (win === created) win = null;
      });
      void created.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(HOME_DOCUMENT)}`);
      win = created;
    },
  };
};
