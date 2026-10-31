// @effect-diagnostics globalTimers:off
/**
 * The click-through layer the companion draws on (D84, D111): farzaa/clicky's pointer and bezier
 * flight, its label, the answer card riding beside the pointer, and numbered drive markers. Pointer
 * and card share one display at a time, the stage, so neither can wipe the other. One window per
 * display, kept out of screenshots by content protection (Windows, macOS) or hidden for the
 * capture (Linux). Windows go after two idle minutes, so this layer never stops the app quitting.
 */
import * as Electron from "electron";

import { COMPANION_CSS } from "./companionStyle.ts";

export const OVERLAY_DOCUMENT = `<!doctype html><html><head><meta charset="utf-8"><style>${COMPANION_CSS}
html,body{width:100%;height:100%;overflow:hidden;font-size:15px}
#ptr{position:absolute;left:0;top:0;width:20px;height:22px;margin:-11px 0 0 -10px;opacity:0;transition:opacity .22s;filter:drop-shadow(0 0 7px var(--blue)) drop-shadow(0 1px 2px rgba(0,0,0,.45));will-change:transform}
#ptr.on{opacity:1}
#ring{position:absolute;left:0;top:0;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;border:2px solid var(--blue);opacity:0;pointer-events:none}
#ring.on{animation:ring 1.5s cubic-bezier(.2,.7,.3,1) 2}
@keyframes ring{0%{opacity:.85;scale:.45}100%{opacity:0;scale:1.5}}
#tag{position:absolute;left:0;top:0;padding:4px 9px;border-radius:7px;background:var(--blue);color:#fff;font-weight:600;font-size:13px;line-height:18px;white-space:nowrap;opacity:0;box-shadow:0 0 12px rgba(51,128,255,.55),0 0 0 1px rgba(255,255,255,.28) inset;transition:opacity .3s}
#tag.on{opacity:1}
#card{position:absolute;left:0;top:0;box-sizing:border-box;width:560px;max-width:calc(100vw - 32px);padding:13px 16px 14px;border-radius:14px;opacity:0;line-height:1.48;overflow:hidden;transition:opacity .2s,left .28s cubic-bezier(.2,.8,.3,1),top .28s cubic-bezier(.2,.8,.3,1)}
#card.on{opacity:1}
#card.beside{width:400px}
#top{display:flex;align-items:center;gap:8px;min-height:18px;margin-bottom:4px;color:var(--blue-soft);font-size:12.5px;font-weight:600}
#dots{display:flex;gap:4px;margin-left:auto}
#dots i{width:6px;height:6px;border-radius:50%;background:rgba(255,255,255,.2)}
#dots i.done{background:var(--blue-soft)}
#dots i.now{background:#fff}
#pg{color:var(--faint);font-weight:500;font-variant-numeric:tabular-nums}
#t{white-space:pre-line}
#h{margin-top:7px;color:var(--soft);font-size:12.5px}
#h:empty{display:none}
#bar{position:absolute;left:0;bottom:0;height:2px;width:100%;background:var(--blue-soft);opacity:.55;transform-origin:0 0;transform:scaleX(0)}
.mk{position:absolute;width:26px;height:26px;margin:-13px 0 0 -13px;border-radius:50%;background:var(--blue);color:#fff;font:600 13px/26px var(--sans);text-align:center;box-shadow:0 0 0 2px #fff,0 2px 10px rgba(0,0,0,.45)}
.mk.done{background:var(--green);color:#06281a}
.mk.now{animation:pulse 1.1s ease-in-out infinite}
@keyframes pulse{50%{box-shadow:0 0 0 2px #fff,0 0 0 10px rgba(51,128,255,.28)}}
@media (prefers-reduced-motion:reduce){#card,#ptr,#tag{transition:none}#ring.on,.mk.now{animation:none}}
</style></head><body>
<svg id="ptr" viewBox="0 0 20 22"><path d="M10 1.6 18.4 20 10 15.7 1.6 20Z" fill="#3380FF" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>
<div id="ring"></div><div id="tag"></div>
<div id="card" class="glass" role="status" aria-live="polite"><div id="top"><span id="k"></span><span id="pg"></span><span id="dots"></span></div><div id="t"></div><div id="h"></div><i id="bar"></i></div><div id="mks"></div>
<script>
const $=i=>document.getElementById(i),ptr=$('ptr'),tag=$('tag'),ring=$('ring'),card=$('card');
const calm=matchMedia('(prefers-reduced-motion:reduce)').matches;
let at={x:innerWidth/2,y:innerHeight/2},anim=0,typing=0,landed=null,inset=72;
const place=(x,y,deg,s)=>{ptr.style.transform='translate('+x+'px,'+y+'px) rotate('+deg+'deg) scale('+s+')';};
const clamp=(v,a,b)=>Math.max(a,Math.min(v,b));
const placeTag=()=>{const r=tag.getBoundingClientRect(),x=at.x+15+r.width>innerWidth-12?at.x-r.width-15:at.x+15;tag.style.transform='translate('+x+'px,'+clamp(at.y+11,8,innerHeight-40)+'px)';};
const placeCard=()=>{const beside=landed!==null;card.classList.toggle('beside',beside);const w=card.offsetWidth,h=card.offsetHeight;let x,y;
 if(beside){x=clamp(landed.x+15,16,innerWidth-w-16);y=landed.y+50;if(y+h>innerHeight-inset)y=Math.max(16,landed.y-h-30);}
 else{x=(innerWidth-w)/2;y=innerHeight-inset-h;}
 card.style.left=x+'px';card.style.top=y+'px';};
const flight=(to,done)=>{cancelAnimationFrame(anim);const s0={...at},d=Math.hypot(to.x-s0.x,to.y-s0.y);
 if(calm||d<1){at={...to};place(to.x,to.y,-35,1);return done();}
 const dur=clamp(d/800,.6,1.4)*1000,c={x:(s0.x+to.x)/2,y:(s0.y+to.y)/2-Math.min(d*.2,80)},t0=performance.now();
 const step=(now)=>{const p=Math.min((now-t0)/dur,1),t=p*p*(3-2*p),u=1-t,
  x=u*u*s0.x+2*u*t*c.x+t*t*to.x,y=u*u*s0.y+2*u*t*c.y+t*t*to.y,
  tx=2*u*(c.x-s0.x)+2*t*(to.x-c.x),ty=2*u*(c.y-s0.y)+2*t*(to.y-c.y);
  at={x,y};place(x,y,p<1?Math.atan2(ty,tx)*180/Math.PI+90:-35,1+.3*Math.sin(Math.PI*p));
  if(p<1)anim=requestAnimationFrame(step);else{at={...to};done();}};
 anim=requestAnimationFrame(step);};
const label=(text)=>{clearTimeout(typing);tag.textContent='';if(!text)return tag.classList.remove('on');
 if(calm){tag.textContent=text;placeTag();return tag.classList.add('on');}
 let i=0;tag.classList.add('on');
 const next=()=>{tag.textContent=text.slice(0,++i);placeTag();if(i<text.length)typing=setTimeout(next,30+Math.random()*30);};next();
 tag.animate([{scale:.5},{scale:1}],{duration:260,easing:'cubic-bezier(.3,1.6,.5,1)'});};
window.inset=(n)=>{inset=n;};
window.fly=(from,to,text)=>{clearTimeout(typing);landed=null;if(from)at=from;ptr.classList.add('on');tag.classList.remove('on');ring.classList.remove('on');place(at.x,at.y,-35,1);
 const spot={x:clamp(to.x+8,20,innerWidth-20),y:clamp(to.y+12,20,innerHeight-20)};
 flight(spot,()=>{landed=spot;ring.style.left=to.x+'px';ring.style.top=to.y+'px';void ring.offsetWidth;if(!calm)ring.classList.add('on');label(text);placeCard();});};
window.card=(c)=>{const on=!!(c&&(c.text||c.kicker));card.classList.toggle('on',on);if(!on)return;
 $('k').textContent=c.kicker||'';$('t').textContent=c.text||'';$('h').textContent=c.hint||'';$('pg').textContent=c.page||'';
 const dots=$('dots');dots.replaceChildren();if(c.dots)for(let i=0;i<c.dots.of;i++){const d=document.createElement('i');d.className=i<c.dots.at?'done':i===c.dots.at?'now':'';dots.appendChild(d);}
 $('bar').getAnimations().forEach(a=>a.cancel());placeCard();};
window.timer=(ms)=>{const b=$('bar');b.getAnimations().forEach(a=>a.cancel());b.animate([{transform:'scaleX(1)'},{transform:'scaleX(0)'}],{duration:ms,easing:'linear',fill:'forwards'});};
window.marks=(list)=>{const box=$('mks');box.replaceChildren();for(const m of list){const e=document.createElement('div');e.className='mk'+(m.state?' '+m.state:'');e.style.left=m.x+'px';e.style.top=m.y+'px';e.textContent=m.n;box.appendChild(e);}};
window.back=(to)=>{card.classList.remove('on');tag.classList.remove('on');ring.classList.remove('on');landed=null;if(to&&!calm)flight(to,()=>ptr.classList.remove('on'));else ptr.classList.remove('on');};
window.clearAll=()=>{cancelAnimationFrame(anim);clearTimeout(typing);landed=null;ptr.classList.remove('on');tag.classList.remove('on');ring.classList.remove('on');window.card(null);window.marks([]);};
</script></body></html>`;

export interface OverlayMarker {
  readonly x: number;
  readonly y: number;
  readonly n: number;
  readonly state?: "done" | "now";
}

export interface OverlayCard {
  readonly kicker: string;
  readonly text: string;
  readonly hint?: string;
  /** "2 of 3" when an answer runs to pages. */
  readonly page?: string;
  /** Plan or lesson progress. */
  readonly dots?: { readonly at: number; readonly of: number };
}

export interface PointerOverlay {
  /** Fly to a global desktop point and label it. False when that is not the display he is on. */
  readonly point: (to: { x: number; y: number }, label: string | null) => Promise<boolean>;
  /** The card: beside the pointer once it lands, otherwise low on the stage display. */
  readonly card: (card: OverlayCard | null) => Promise<void>;
  /** Run the card's countdown line, so a hold is something he can see. */
  readonly timer: (ms: number) => Promise<void>;
  /** Numbered markers in global desktop coordinates. */
  readonly markers: (list: ReadonlyArray<OverlayMarker>) => Promise<void>;
  /** Clicky's exit: the words fade and the pointer flies home to his cursor. */
  readonly retreat: () => Promise<void>;
  readonly clear: () => Promise<void>;
  /** Run `fn` with the layer out of the picture where content protection cannot do it. */
  readonly hiddenFor: <T>(fn: () => Promise<T>) => Promise<T>;
  readonly dispose: () => void;
}

const IDLE_CLOSE_MS = 120_000;
/** The card clears the taskbar and the pill beneath it. */
const CARD_ABOVE_WORK_AREA = 72;
const RETREAT_MS = 900;

export const createPointerOverlay = (platform: string): PointerOverlay => {
  const windows = new Map<number, { win: Electron.BrowserWindow; ready: Promise<void> }>();
  let stage: Electron.Display | null = null;
  let shown: OverlayCard | null = null;
  let idle: ReturnType<typeof setTimeout> | null = null;

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
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        // A transparent layer can read as occluded, and that would stop the flight mid-air.
        backgroundThrottling: false,
      },
    });
    win.setAlwaysOnTop(true, "screen-saver");
    win.setIgnoreMouseEvents(true);
    win.setContentProtection(true);
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    const bottom = display.bounds.y + display.bounds.height;
    const inset = bottom - (display.workArea.y + display.workArea.height) + CARD_ABOVE_WORK_AREA;
    const ready = win
      .loadURL(`data:text/html,${encodeURIComponent(OVERLAY_DOCUMENT)}`)
      .then(() => win.webContents.executeJavaScript(`window.inset(${inset})`))
      .then(() => win.showInactive());
    const entry = { win, ready };
    windows.set(display.id, entry);
    return entry;
  };
  const closeWindows = () => {
    for (const { win } of windows.values()) if (!win.isDestroyed()) win.destroy();
    windows.clear();
  };
  const stopIdle = () => {
    if (idle !== null) clearTimeout(idle);
    idle = null;
  };
  const run = async (display: Electron.Display, script: string) => {
    stopIdle();
    const { win, ready } = forDisplay(display);
    await ready;
    if (!win.isDestroyed()) await win.webContents.executeJavaScript(script);
  };
  const local = (display: Electron.Display, p: { x: number; y: number }) => ({
    x: p.x - display.bounds.x,
    y: p.y - display.bounds.y,
  });
  const cursorDisplay = () =>
    Electron.screen.getDisplayNearestPoint(Electron.screen.getCursorScreenPoint());
  const each = (script: string) =>
    Promise.all(
      [...windows.values()].map(({ win, ready }) =>
        ready.then(() =>
          win.isDestroyed() ? undefined : win.webContents.executeJavaScript(script),
        ),
      ),
    ).then(() => undefined);
  const showCard = (display: Electron.Display, card: OverlayCard | null) =>
    run(display, `window.card(${JSON.stringify(card)})`);

  const clear = async () => {
    stage = null;
    shown = null;
    await each("window.clearAll()");
    stopIdle();
    idle = setTimeout(closeWindows, IDLE_CLOSE_MS);
  };

  return {
    point: async (to, label) => {
      const target = Electron.screen.getDisplayNearestPoint(to);
      const cursor = Electron.screen.getCursorScreenPoint();
      const here = Electron.screen.getDisplayNearestPoint(cursor).id === target.id;
      // Coming from another display it enters at the edge nearest his cursor.
      const raw = local(target, cursor);
      const from = {
        x: Math.max(0, Math.min(raw.x, target.bounds.width)),
        y: Math.max(0, Math.min(raw.y, target.bounds.height)),
      };
      if (stage !== null && stage.id !== target.id) {
        const left = windows.get(stage.id);
        if (left !== undefined && !left.win.isDestroyed()) {
          void left.win.webContents.executeJavaScript("window.clearAll()");
        }
      }
      stage = target;
      await run(
        target,
        `window.fly(${JSON.stringify(from)},${JSON.stringify(local(target, to))},${JSON.stringify(label)})`,
      );
      // The card moves with the pointer, or the answer is left behind on the other display.
      if (shown !== null) await showCard(target, shown);
      return here;
    },
    card: async (card) => {
      shown = card;
      stage ??= cursorDisplay();
      await showCard(stage, card);
    },
    timer: async (ms) => {
      if (stage !== null) await run(stage, `window.timer(${Math.round(ms)})`);
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
    retreat: async () => {
      if (stage === null) return clear();
      const display = stage;
      const cursor = Electron.screen.getCursorScreenPoint();
      const home =
        cursorDisplay().id === display.id
          ? { x: cursor.x - display.bounds.x + 35, y: cursor.y - display.bounds.y + 25 }
          : null;
      shown = null;
      await run(display, `window.back(${JSON.stringify(home)})`);
      await new Promise((r) => setTimeout(r, RETREAT_MS));
      await clear();
    },
    clear,
    hiddenFor: async (fn) => {
      if (platform === "win32" || platform === "darwin") return fn();
      const visible = [...windows.values()].filter(
        ({ win }) => !win.isDestroyed() && win.isVisible(),
      );
      for (const { win } of visible) win.hide();
      try {
        await new Promise((r) => setTimeout(r, 120));
        return await fn();
      } finally {
        for (const { win } of visible) if (!win.isDestroyed()) win.showInactive();
      }
    },
    dispose: () => {
      stopIdle();
      closeWindows();
    },
  };
};
