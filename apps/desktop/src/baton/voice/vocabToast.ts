// @effect-diagnostics globalTimers:off
/**
 * The small black toast that says a word was added to his vocabulary, near the pill: Keep (the default,
 * and what happens by itself after six seconds), Discard, or close. It never takes focus, its window is
 * exactly its own size so every click outside it goes through, and it stays out of screen sharing.
 * Several words arriving together are one toast.
 */
import { protectFromCapture } from "../captureProtection.ts";
import * as Electron from "electron";

import { markCompanionWindow } from "../lastAppWindow.ts";

const WIDTH = 470;
const HEIGHT = 40;
const GAP = 10;
const LEAVE_MS = 6_000;
const BATCH_MS = 1_200;

/** One line: “Kowalczyk”, or “A”, “B” and 2 more. */
export const toastText = (words: ReadonlyArray<string>): string => {
  const quoted = words.slice(0, 2).map((w) => `\u201c${w}\u201d`);
  const list = words.length <= 2 ? quoted.join(", ") : `${words.length} words`;
  return `Added ${list} to your vocabulary`;
};

const esc = (text: string) =>
  text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export const toastDocument = (
  words: ReadonlyArray<string>,
): string => `<!doctype html><html><head><meta charset="utf-8"><style>
:root{--ink:#0d0d11;--line:rgba(255,255,255,.14);--text:#f6f6f8;--soft:#9d9da8;--green:#3fce8e;
--sans:"Segoe UI Variable Text","Segoe UI",-apple-system,BlinkMacSystemFont,system-ui,sans-serif}
html,body{height:100%;margin:0;overflow:hidden;background:transparent;font:500 12px/1 var(--sans);-webkit-font-smoothing:antialiased;-webkit-user-select:none;user-select:none;cursor:default}
#t{box-sizing:border-box;display:flex;align-items:center;gap:8px;height:${HEIGHT}px;padding:0 6px 0 14px;border-radius:12px;background:var(--ink);border:1px solid var(--line);box-shadow:0 0 0 1px rgba(0,0,0,.5);color:var(--text);animation:in .16s cubic-bezier(.2,.8,.2,1) both}
@keyframes in{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
#t span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
button{font:inherit;color:var(--soft);background:transparent;border:0;border-radius:8px;padding:6px 10px;cursor:pointer}
button:hover{background:rgba(255,255,255,.08);color:var(--text)}
button:focus-visible{outline:2px solid var(--green);outline-offset:1px}
#keep{color:var(--green);font-weight:600}
#x{padding:6px 8px}
@media (prefers-reduced-motion:reduce){#t{animation:none}}
</style></head><body><div id="t" role="status" aria-live="polite"><span>${esc(toastText(words))}</span><button id="keep">Keep</button><button id="discard">Discard</button><button id="x" aria-label="Close">×</button></div>
<script>
const {ipcRenderer}=typeof require==='function'?require('electron'):{ipcRenderer:{send(){}}};
for(const [id,act] of [['keep','keep'],['discard','discard'],['x','close']]) document.getElementById(id).onclick=()=>ipcRenderer.send('baton-toast:act',act);
</script></body></html>`;

export interface VocabToast {
  /** A word was added; words arriving close together share one toast. */
  readonly add: (word: string) => void;
  readonly dispose: () => void;
}

export const createVocabToast = (input: {
  /** Where the pill is (or would be): the toast sits just above it. */
  readonly anchor: () => Electron.Rectangle;
  /** He chose Discard: take these out and never add them again. */
  readonly onDiscard: (words: ReadonlyArray<string>) => void;
}): VocabToast => {
  let pending: string[] = [];
  let shown: string[] = [];
  let window: Electron.BrowserWindow | null = null;
  let batchTimer: ReturnType<typeof setTimeout> | null = null;
  let leaveTimer: ReturnType<typeof setTimeout> | null = null;

  const close = () => {
    if (leaveTimer !== null) clearTimeout(leaveTimer);
    leaveTimer = null;
    if (window !== null && !window.isDestroyed()) window.destroy();
    window = null;
    shown = [];
  };
  const show = () => {
    const words = [...shown, ...pending];
    pending = [];
    if (words.length === 0) return;
    shown = words;
    const at = input.anchor();
    const display = Electron.screen.getDisplayMatching(at);
    const area = display.workArea;
    const x = Math.min(
      Math.max(Math.round(at.x + at.width / 2 - WIDTH / 2), area.x),
      area.x + area.width - WIDTH,
    );
    const above = at.y - HEIGHT - GAP;
    const y =
      above >= area.y ? above : Math.min(at.y + at.height + GAP, area.y + area.height - HEIGHT);
    close();
    shown = words;
    const win = new Electron.BrowserWindow({
      x,
      y,
      width: WIDTH,
      height: HEIGHT,
      frame: false,
      transparent: true,
      resizable: false,
      focusable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      show: false,
      webPreferences: { nodeIntegration: true, contextIsolation: false },
    });
    win.setAlwaysOnTop(true, "screen-saver");
    markCompanionWindow(win);
    protectFromCapture(win);
    window = win;
    void win
      .loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(toastDocument(words))}`)
      .then(() => {
        if (!win.isDestroyed()) win.showInactive();
      });
    leaveTimer = setTimeout(close, LEAVE_MS);
    leaveTimer.unref();
  };

  Electron.ipcMain.on("baton-toast:act", (event, act: unknown) => {
    if (window === null || event.sender !== window.webContents) return;
    const words = shown;
    close();
    if (act === "discard") input.onDiscard(words);
  });

  return {
    add: (word) => {
      pending.push(word);
      if (batchTimer !== null) clearTimeout(batchTimer);
      batchTimer = setTimeout(show, BATCH_MS);
      batchTimer.unref();
    },
    dispose: () => {
      if (batchTimer !== null) clearTimeout(batchTimer);
      close();
    },
  };
};
