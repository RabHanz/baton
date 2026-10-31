// @effect-diagnostics globalTimers:off
/**
 * The two windows of the companion that take his hands: the ask box and the prompt that replaced
 * the system dialogs (D111). Both are inline pages of ours that never navigate, node is how they
 * hand back an answer, and words from a model only ever reach them as textContent.
 */
import * as Electron from "electron";

import { COMPANION_CSS } from "./companionStyle.ts";

export type AnswerOutput = "spoken" | "written";

const ASK_WIDTH = 640;
const ASK_HEIGHT = 124;
const PROMPT_WIDTH = 500;

export const ASK_DOCUMENT = (
  output: AnswerOutput,
) => `<!doctype html><html><head><meta charset="utf-8"><style>${COMPANION_CSS}
html,body{overflow:hidden;height:100%}
body{display:flex;padding:12px;box-sizing:border-box}
form{flex:1;display:flex;flex-direction:column;gap:9px;padding:13px 16px 11px;border-radius:16px;box-sizing:border-box}
input{all:unset;color:var(--text);font-size:17px;line-height:26px;-webkit-user-select:text;user-select:text;cursor:text}
input::placeholder{color:var(--faint)}
footer{display:flex;align-items:center;gap:12px;color:var(--soft);font-size:12.5px}
kbd{font:600 11.5px var(--sans);color:var(--text);padding:1px 6px;border-radius:5px;background:rgba(255,255,255,.1)}
.seg{margin-left:auto;display:flex;padding:2px;border-radius:8px;background:rgba(255,255,255,.08)}
.seg button{all:unset;padding:3px 10px;border-radius:6px;color:var(--soft);font-size:12.5px;cursor:default}
.seg button[aria-pressed=true]{background:rgba(255,255,255,.17);color:var(--text)}
.seg button:focus-visible{outline:2px solid var(--blue-soft)}
</style></head><body><form id="f" class="glass"><input id="q" autofocus placeholder="Ask Baton anything" aria-label="Ask Baton anything" spellcheck="false">
<footer><span><kbd>Enter</kbd> ask</span><span><kbd>Esc</kbd> close</span>
<div class="seg" role="group" aria-label="How Baton answers"><button type="button" data-v="spoken">Spoken and written</button><button type="button" data-v="written">Written only</button></div></footer></form>
<script>const {ipcRenderer}=require('electron');const q=document.getElementById('q');
const marks=(v)=>document.querySelectorAll('.seg button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.v===v)));
marks(${JSON.stringify(output)});
document.querySelectorAll('.seg button').forEach(b=>b.onclick=()=>{marks(b.dataset.v);ipcRenderer.send('baton-screen:output',b.dataset.v);q.focus();});
document.getElementById('f').onsubmit=e=>{e.preventDefault();ipcRenderer.send('baton-screen:ask',q.value);};
addEventListener('keydown',e=>{if(e.key==='Escape')ipcRenderer.send('baton-screen:ask','');});</script></body></html>`;

export const PROMPT_DOCUMENT = `<!doctype html><html><head><meta charset="utf-8"><style>${COMPANION_CSS}
html,body{overflow:hidden}
body{padding:12px;box-sizing:border-box}
#b{padding:15px 18px 14px;border-radius:16px}
h1{margin:0;font-size:15.5px;font-weight:600;line-height:1.35}
p{margin:6px 0 0;color:var(--soft);font-size:13.5px;line-height:1.5;white-space:pre-line;max-height:320px;overflow:auto}
nav{display:flex;flex-wrap:wrap;gap:8px;margin-top:13px}
button{all:unset;padding:6px 14px;border-radius:999px;font-size:13.5px;font-weight:600;color:var(--text);background:rgba(255,255,255,.1);cursor:default}
button.main{background:#fff;color:#111}
button:hover{background:rgba(255,255,255,.18)}
button.main:hover{background:#e8e8ec}
button:focus-visible{outline:2px solid var(--blue-soft);outline-offset:2px}
</style></head><body><div id="b" class="glass" role="alertdialog" aria-labelledby="h" aria-describedby="d"><h1 id="h"></h1><p id="d"></p><nav id="n"></nav></div>
<script>const {ipcRenderer}=require('electron');
window.fill=(o)=>{document.getElementById('h').textContent=o.title;document.getElementById('d').textContent=o.detail;const n=document.getElementById('n');
 o.buttons.forEach((text,i)=>{const b=document.createElement('button');b.textContent=text;if(i===0)b.className='main';b.onclick=()=>ipcRenderer.send('baton-screen:prompt',i);n.appendChild(b);});
 addEventListener('keydown',e=>{if(e.key==='Escape')ipcRenderer.send('baton-screen:prompt',o.cancel);});
 n.firstChild.focus();return document.body.scrollHeight;};</script></body></html>`;

export interface PromptInput {
  readonly title: string;
  readonly detail: string;
  /** The first is the default. */
  readonly buttons: ReadonlyArray<string>;
  /** Esc, the box being closed some other way, or running out of time. */
  readonly cancel: number;
  readonly expiresMs?: number;
}

/** A prompt nobody answers must not block the next one, and an old yes must not stand ready. */
const PROMPT_EXPIRY_MS = 60_000;

const companionWindow = (bounds: Electron.Rectangle): Electron.BrowserWindow => {
  const win = new Electron.BrowserWindow({
    ...bounds,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    show: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  // These pages have Node: only the page written here may ever load in them.
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.setAlwaysOnTop(true, "screen-saver");
  win.setContentProtection(true);
  return win;
};

const cursorArea = () =>
  Electron.screen.getDisplayNearestPoint(Electron.screen.getCursorScreenPoint()).workArea;

/** One at a time: a second question waits for the first. */
export const createCompanionWindows = (input: {
  readonly output: () => AnswerOutput;
  readonly setOutput: (output: AnswerOutput) => void;
  readonly onAsk: (text: string) => void;
}) => {
  let askBox: Electron.BrowserWindow | null = null;
  let promptBox: {
    win: Electron.BrowserWindow;
    done: (index: number) => void;
    cancel: number;
  } | null = null;
  let queue: Promise<unknown> = Promise.resolve();

  const closeAsk = () => {
    if (askBox !== null && !askBox.isDestroyed()) askBox.destroy();
    askBox = null;
  };
  const ownedAsk = (event: Electron.IpcMainEvent) =>
    askBox !== null && event.sender === askBox.webContents;
  const onAskIpc = (event: Electron.IpcMainEvent, text: unknown) => {
    if (!ownedAsk(event)) return;
    closeAsk();
    if (typeof text === "string" && text.trim().length > 0) input.onAsk(text.trim());
  };
  const onOutputIpc = (event: Electron.IpcMainEvent, value: unknown) => {
    if (ownedAsk(event) && (value === "spoken" || value === "written")) input.setOutput(value);
  };
  const onPromptIpc = (event: Electron.IpcMainEvent, index: unknown) => {
    if (promptBox === null || event.sender !== promptBox.win.webContents) return;
    if (typeof index === "number") promptBox.done(index);
  };
  Electron.ipcMain.on("baton-screen:ask", onAskIpc);
  Electron.ipcMain.on("baton-screen:output", onOutputIpc);
  Electron.ipcMain.on("baton-screen:prompt", onPromptIpc);

  const openAsk = () => {
    if (askBox !== null && !askBox.isDestroyed()) return askBox.focus();
    const area = cursorArea();
    const box = companionWindow({
      x: Math.round(area.x + (area.width - ASK_WIDTH) / 2),
      y: Math.round(area.y + area.height * 0.26),
      width: ASK_WIDTH,
      height: ASK_HEIGHT,
    });
    askBox = box;
    box.on("blur", () => {
      if (!box.isDestroyed()) box.destroy();
      if (askBox === box) askBox = null;
    });
    void box
      .loadURL(`data:text/html,${encodeURIComponent(ASK_DOCUMENT(input.output()))}`)
      .then(() => {
        if (box.isDestroyed()) return;
        box.show();
        box.focus();
        box.webContents.focus();
      });
  };

  const ask = (options: PromptInput): Promise<number> => {
    const turn = queue.then(
      () =>
        new Promise<number>((resolve) => {
          const area = cursorArea();
          const win = companionWindow({
            x: Math.round(area.x + (area.width - PROMPT_WIDTH) / 2),
            y: area.y,
            width: PROMPT_WIDTH,
            height: 200,
          });
          const expiry = setTimeout(
            () => done(options.cancel),
            options.expiresMs ?? PROMPT_EXPIRY_MS,
          );
          const done = (index: number) => {
            clearTimeout(expiry);
            // First: destroying fires "closed", which would answer Cancel over his yes.
            resolve(index);
            if (promptBox?.win === win) promptBox = null;
            if (!win.isDestroyed()) win.destroy();
          };
          promptBox = { win, done, cancel: options.cancel };
          win.on("closed", () => done(options.cancel));
          void win
            .loadURL(`data:text/html,${encodeURIComponent(PROMPT_DOCUMENT)}`)
            .then(() =>
              win.webContents.executeJavaScript(`window.fill(${JSON.stringify(options)})`),
            )
            .then((height: number) => {
              if (win.isDestroyed()) return;
              // A long plan scrolls inside the box; the buttons stay on the screen.
              const tall = Math.min(Math.ceil(height), area.height - 120);
              win.setBounds({
                x: Math.round(area.x + (area.width - PROMPT_WIDTH) / 2),
                y: Math.round(area.y + area.height - tall - 96),
                width: PROMPT_WIDTH,
                height: tall,
              });
              win.show();
              win.focus();
              win.webContents.focus();
            })
            .catch(() => done(options.cancel));
        }),
    );
    queue = turn.catch(() => undefined);
    return turn;
  };

  return {
    openAsk,
    ask,
    /** The thing it was asking about has ended. */
    closePrompt: () => promptBox?.done(promptBox.cancel),
    dispose: () => {
      closeAsk();
      promptBox?.done(promptBox.cancel);
      Electron.ipcMain.removeListener("baton-screen:ask", onAskIpc);
      Electron.ipcMain.removeListener("baton-screen:output", onOutputIpc);
      Electron.ipcMain.removeListener("baton-screen:prompt", onPromptIpc);
    },
  };
};
