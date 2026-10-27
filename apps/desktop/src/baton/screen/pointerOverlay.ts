// @effect-diagnostics globalTimers:off
/**
 * The click-through layer the companion draws on (D84): farzaa/clicky's blue pointer and its
 * bezier flight, a step card, and numbered drive markers. One window per display, kept out of
 * screenshots by content protection (Windows, macOS) or hidden for the capture (Linux).
 */
import * as Electron from "electron";

export const OVERLAY_DOCUMENT = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;width:100%;height:100%;background:transparent;overflow:hidden;font:14px system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-user-select:none;user-select:none}
#ptr{position:absolute;left:0;top:0;width:22px;height:22px;margin:-4px 0 0 -11px;opacity:0;transition:opacity .25s;filter:drop-shadow(0 0 8px #3380FF)}
#ptr.on{opacity:1}
#tag{position:absolute;left:0;top:0;padding:4px 9px;border-radius:9px;background:#3380FF;color:#fff;font-weight:600;font-size:13px;white-space:nowrap;opacity:0;transition:opacity .3s;box-shadow:0 0 10px rgba(51,128,255,.5)}
#tag.on{opacity:1}
#card{position:absolute;left:50%;bottom:48px;transform:translateX(-50%);max-width:min(640px,80vw);padding:12px 16px;border-radius:14px;background:rgba(17,17,20,.9);color:#f4f4f5;line-height:1.4;box-shadow:0 8px 28px rgba(0,0,0,.4);display:none}
#card.on{display:block}
#card .k{color:#8db8ff;font-size:12px;font-weight:600;letter-spacing:.02em;margin-bottom:3px}
#card .h{color:#a1a1aa;font-size:12px;margin-top:6px}
#t{white-space:pre-line}
.mk{position:absolute;width:24px;height:24px;margin:-12px 0 0 -12px;border-radius:50%;background:#3380FF;color:#fff;font:600 12px/24px system-ui,sans-serif;text-align:center;box-shadow:0 0 0 3px rgba(51,128,255,.35)}
.mk.done{background:#22c55e;box-shadow:0 0 0 3px rgba(34,197,94,.35)}
.mk.now{animation:pulse 1s ease-in-out infinite}
@keyframes pulse{50%{box-shadow:0 0 0 9px rgba(51,128,255,.15)}}
@media (prefers-reduced-motion:reduce){.mk.now{animation:none}}
</style></head><body>
<svg id="ptr" viewBox="0 0 22 22"><path d="M11 1 L20.5 20 L11 15.5 L1.5 20 Z" fill="#3380FF" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>
<div id="tag"></div><div id="card"><div class="k" id="k"></div><div id="t"></div><div class="h" id="h"></div></div><div id="mks"></div>
<script>
const ptr=document.getElementById('ptr'),tag=document.getElementById('tag');
let at={x:innerWidth/2,y:innerHeight/2},anim=0;
const place=(x,y,deg,s)=>{ptr.style.transform='translate('+x+'px,'+y+'px) rotate('+deg+'deg) scale('+s+')';tag.style.transform='translate('+(x+18)+'px,'+(y+10)+'px)';};
window.fly=(from,to,label)=>{cancelAnimationFrame(anim);if(from)at=from;ptr.classList.add('on');tag.classList.remove('on');
 const d=Math.hypot(to.x-at.x,to.y-at.y),dur=Math.min(Math.max(d/800,.6),1.4)*1000,
 c={x:(at.x+to.x)/2,y:(at.y+to.y)/2-Math.min(d*.2,80)},s0={...at},t0=performance.now();
 const step=(now)=>{const t=Math.min((now-t0)/dur,1),u=1-t,
  x=u*u*s0.x+2*u*t*c.x+t*t*to.x,y=u*u*s0.y+2*u*t*c.y+t*t*to.y,
  tx=2*u*(c.x-s0.x)+2*t*(to.x-c.x),ty=2*u*(c.y-s0.y)+2*t*(to.y-c.y);
  place(x,y,t<1?Math.atan2(ty,tx)*180/Math.PI+90:-35,1+.3*Math.sin(Math.PI*t));
  if(t<1)anim=requestAnimationFrame(step);else{at={...to};tag.textContent=label||'';if(label)tag.classList.add('on');}};
 anim=requestAnimationFrame(step);};
window.card=(kicker,text,hint)=>{const c=document.getElementById('card');document.getElementById('k').textContent=kicker||'';document.getElementById('t').textContent=text||'';document.getElementById('h').textContent=hint||'';c.classList.toggle('on',!!(text||kicker));};
window.marks=(list)=>{const box=document.getElementById('mks');box.innerHTML='';for(const m of list){const e=document.createElement('div');e.className='mk'+(m.state?' '+m.state:'');e.style.left=m.x+'px';e.style.top=m.y+'px';e.textContent=m.n;box.appendChild(e);}};
window.clearAll=()=>{cancelAnimationFrame(anim);ptr.classList.remove('on');tag.classList.remove('on');window.card('','','');window.marks([]);};
</script></body></html>`;

export interface OverlayMarker {
  readonly x: number;
  readonly y: number;
  readonly n: number;
  readonly state?: "done" | "now";
}

export interface PointerOverlay {
  /** Fly to a global desktop point and show a label there. */
  readonly point: (to: { x: number; y: number }, label: string | null) => Promise<void>;
  /** The step card at the bottom of the cursor's display; empty text hides it. */
  readonly card: (kicker: string, text: string, hint: string) => Promise<void>;
  /** Numbered markers in global desktop coordinates. */
  readonly markers: (list: ReadonlyArray<OverlayMarker>) => Promise<void>;
  readonly clear: () => Promise<void>;
  /** Run `fn` with the layer out of the picture where content protection cannot do it. */
  readonly hiddenFor: <T>(fn: () => Promise<T>) => Promise<T>;
  readonly dispose: () => void;
}

export const createPointerOverlay = (platform: string): PointerOverlay => {
  const windows = new Map<number, { win: Electron.BrowserWindow; ready: Promise<void> }>();
  const forDisplay = (display: Electron.Display) => {
    const existing = windows.get(display.id);
    if (existing !== undefined && !existing.win.isDestroyed()) return existing;
    const win = new Electron.BrowserWindow({
      ...display.bounds,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      focusable: false,
      skipTaskbar: true,
      hasShadow: false,
      alwaysOnTop: true,
      show: false,
      enableLargerThanScreen: true,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    win.setAlwaysOnTop(true, "screen-saver");
    win.setIgnoreMouseEvents(true);
    win.setContentProtection(true);
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    const ready = win
      .loadURL(`data:text/html,${encodeURIComponent(OVERLAY_DOCUMENT)}`)
      .then(() => win.showInactive());
    const entry = { win, ready };
    windows.set(display.id, entry);
    return entry;
  };
  const run = async (display: Electron.Display, script: string) => {
    const { win, ready } = forDisplay(display);
    await ready;
    if (!win.isDestroyed()) await win.webContents.executeJavaScript(script);
  };
  const local = (display: Electron.Display, p: { x: number; y: number }) => ({
    x: p.x - display.bounds.x,
    y: p.y - display.bounds.y,
  });
  const each = (script: string) =>
    Promise.all(
      [...windows.values()].map(({ win, ready }) =>
        ready.then(() =>
          win.isDestroyed() ? undefined : win.webContents.executeJavaScript(script),
        ),
      ),
    ).then(() => undefined);

  return {
    point: async (to, label) => {
      const target = Electron.screen.getDisplayNearestPoint(to);
      const cursor = Electron.screen.getCursorScreenPoint();
      const from =
        Electron.screen.getDisplayNearestPoint(cursor).id === target.id
          ? local(target, cursor)
          : null;
      // The pointer lives on one display at a time.
      for (const [id, { win }] of windows)
        if (id !== target.id && !win.isDestroyed())
          void win.webContents.executeJavaScript("window.clearAll()");
      await run(
        target,
        `window.fly(${JSON.stringify(from)},${JSON.stringify(local(target, to))},${JSON.stringify(label)})`,
      );
    },
    card: async (kicker, text, hint) => {
      const display = Electron.screen.getDisplayNearestPoint(
        Electron.screen.getCursorScreenPoint(),
      );
      await run(
        display,
        `window.card(${JSON.stringify(kicker)},${JSON.stringify(text)},${JSON.stringify(hint)})`,
      );
    },
    markers: async (list) => {
      const byDisplay = new Map<number, { display: Electron.Display; marks: OverlayMarker[] }>();
      for (const m of list) {
        const display = Electron.screen.getDisplayNearestPoint(m);
        const slot = byDisplay.get(display.id) ?? { display, marks: [] };
        slot.marks.push({ ...m, ...local(display, m) });
        byDisplay.set(display.id, slot);
      }
      await each("window.marks([])");
      for (const { display, marks } of byDisplay.values())
        await run(display, `window.marks(${JSON.stringify(marks)})`);
    },
    clear: () => each("window.clearAll()"),
    hiddenFor: async (fn) => {
      if (platform === "win32" || platform === "darwin") return fn();
      const shown = [...windows.values()].filter(
        ({ win }) => !win.isDestroyed() && win.isVisible(),
      );
      for (const { win } of shown) win.hide();
      try {
        await new Promise((r) => setTimeout(r, 120));
        return await fn();
      } finally {
        for (const { win } of shown) if (!win.isDestroyed()) win.showInactive();
      }
    },
    dispose: () => {
      for (const { win } of windows.values()) if (!win.isDestroyed()) win.destroy();
      windows.clear();
    },
  };
};
