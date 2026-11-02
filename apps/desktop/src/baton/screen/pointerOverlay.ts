/* oxlint-disable t3code/no-low-value-comments -- Baton file predating upstream's rule (D82) */
// @effect-diagnostics globalTimers:off
/**
 * The click-through layer the companion draws on (D84, D111): farzaa/clicky's pointer and bezier
 * flight, its label, the answer card riding beside the pointer, and numbered drive markers. Pointer
 * and card share one display at a time, the stage, so neither can wipe the other. One window per
 * display, kept out of screenshots by content protection (Windows, macOS) or hidden for the
 * capture (Linux). Windows go after two idle minutes, so this layer never stops the app quitting.
 */
import { protectFromCapture } from "../captureProtection.ts";
import * as Electron from "electron";

import { markCompanionWindow } from "../lastAppWindow.ts";

import { loadDocument } from "../voice/loadDocument.ts";
import { COMPANION_CSS } from "./companionStyle.ts";

export const OVERLAY_DOCUMENT = `<!doctype html><html><head><meta charset="utf-8"><style>${COMPANION_CSS}
html,body{width:100%;height:100%;overflow:hidden;font-size:15px}
:root{--tz-dye:#14505A;--tz-glow:#5FB3B3;--tz-ink:#0B2A30}
#ptr{position:absolute;left:0;top:0;width:24px;height:26px;margin:-13px 0 0 -12px;opacity:0;transition:opacity .22s;filter:drop-shadow(0 0 8px var(--tz-glow)) drop-shadow(0 1px 2px rgba(0,0,0,.5));will-change:transform}
#ptr.on{opacity:1}
/* The highlight is two-tone (white inside, near-black outside) so it reads on light and dark; the glow is only decoration. */
#ring{position:absolute;left:0;top:0;width:44px;height:44px;border-radius:50%;opacity:0;pointer-events:none;transition:opacity .18s;box-shadow:0 0 0 2px #fff,0 0 0 4px var(--tz-ink),0 0 18px 6px color-mix(in srgb,var(--tz-glow) 55%,transparent)}
#ring.box{border-radius:6px;background:transparent;border:2px dashed #fff;outline:2px solid var(--tz-ink);box-shadow:0 0 18px 4px color-mix(in srgb,var(--tz-glow) 50%,transparent)}
#ring.on{opacity:1}
#ring.pulse{animation:soft .9s ease-out 1}
@keyframes soft{0%{scale:1}40%{scale:1.07}100%{scale:1}}
#bd{position:absolute;left:0;top:0;width:26px;height:26px;border-radius:50%;background:var(--tz-dye);color:#fff;font:700 14px/26px var(--sans);text-align:center;box-shadow:0 0 0 2px #fff,0 2px 6px rgba(0,0,0,.4);opacity:0;transition:opacity .18s;pointer-events:none}
#bd.on{opacity:1}
#trail{position:absolute;left:0;top:0;height:3px;border-radius:2px;transform-origin:0 50%;background:linear-gradient(90deg,transparent,var(--tz-glow));opacity:0;pointer-events:none}
#trail.on{opacity:.55;transition:none}#trail.fade{opacity:0;transition:opacity .4s}
#tag{position:absolute;left:0;top:0;padding:4px 10px;border-radius:999px;background:var(--tz-dye);color:#fff;font-weight:600;font-size:13px;line-height:18px;white-space:nowrap;opacity:0;box-shadow:0 0 0 1px rgba(255,255,255,.35) inset,0 2px 8px rgba(0,0,0,.35);transition:opacity .3s}
#tag.on{opacity:1}
#card{position:absolute;left:0;top:0;box-sizing:border-box;width:560px;max-width:calc(100vw - 32px);padding:13px 16px 14px;border-radius:14px;opacity:0;line-height:1.48;overflow:hidden;transition:opacity .2s,left .28s cubic-bezier(.2,.8,.3,1),top .28s cubic-bezier(.2,.8,.3,1)}
#card.on{opacity:1}
#card.beside{width:400px}
#top{display:flex;align-items:center;gap:8px;min-height:18px;margin-bottom:4px;color:var(--blue-soft);font-size:12.5px;font-weight:600}
#dots{display:flex;gap:4px;margin-left:auto}
#cp{all:unset;margin-left:8px;padding:2px 9px;border-radius:999px;background:rgba(255,255,255,.12);color:var(--text);font-size:12px;font-weight:600;cursor:default}
#cp:hover{background:rgba(255,255,255,.22)}
#cp:focus-visible{outline:2px solid var(--blue-soft)}
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
.mk.now{animation:pulse 1.1s ease-in-out 2}
@keyframes pulse{50%{box-shadow:0 0 0 2px #fff,0 0 0 10px rgba(51,128,255,.28)}}
@media (prefers-reduced-motion:reduce){#card,#ptr,#tag,#ring,#bd{transition:none}#ring.pulse,.mk.now{animation:none}#trail{display:none}}
</style></head><body>
<div id="trail"></div>
<svg id="ptr" viewBox="0 0 24 26"><path d="M2.5 2.5 21 12 12 14 8.5 23.5Z" fill="#14505A" stroke="#fff" stroke-width="2" stroke-linejoin="round"/></svg>
<div id="ring"></div><div id="bd"></div><div id="tag"></div>
<div id="card" class="glass" role="status" aria-live="polite"><div id="top"><span id="k"></span><span id="pg"></span><span id="dots"></span><button id="cp" type="button" hidden>Copy</button></div><div id="t"></div><div id="h"></div><i id="bar"></i></div><div id="mks"></div>
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
const hide=()=>{ring.classList.remove('on','pulse');$('bd').classList.remove('on');tag.classList.remove('on');};
// The trail is one line from where the pointer was to where it is going, drawn once and faded once: nothing repaints while it waits.
const trail=(a,b)=>{const t=$('trail'),d=Math.hypot(b.x-a.x,b.y-a.y);if(calm||d<40)return t.classList.remove('on','fade');
 t.style.cssText='left:'+a.x+'px;top:'+a.y+'px;width:'+d+'px;transform:rotate('+Math.atan2(b.y-a.y,b.x-a.x)+'rad)';t.classList.remove('fade');t.classList.add('on');};
const fadeTrail=()=>{const t=$('trail');if(t.classList.contains('on')){t.classList.remove('on');t.classList.add('fade');}};
// opts: w,h = the control's size (from the accessibility tree), shape = ring or box, badge = the step number.
const mark=(to,o)=>{const w=o&&o.w?Math.min(o.w,innerWidth-24)+8:44,h=o&&o.h?Math.min(o.h,innerHeight-24)+8:44;
 ring.className=o&&o.shape==='box'?'box':'';ring.style.width=w+'px';ring.style.height=h+'px';ring.style.left=(to.x-w/2)+'px';ring.style.top=(to.y-h/2)+'px';
 if(!(o&&o.w))ring.style.borderRadius='50%';else ring.style.borderRadius=o.shape==='box'?'6px':'8px';
 void ring.offsetWidth;ring.classList.add('on');
 const bd=$('bd');if(o&&o.badge){bd.textContent=o.badge;bd.style.left=clamp(to.x-w/2-13,2,innerWidth-30)+'px';bd.style.top=clamp(to.y-h/2-13,2,innerHeight-30)+'px';bd.classList.add('on');}};
window.fly=(from,to,text,o)=>{clearTimeout(typing);landed=null;if(from)at=from;ptr.classList.add('on');hide();place(at.x,at.y,-35,1);
 const spot={x:clamp(to.x+8,20,innerWidth-20),y:clamp(to.y+12,20,innerHeight-20)};
 trail({...at},spot);
 flight(spot,()=>{landed=spot;mark(to,o);label(text);placeCard();setTimeout(fadeTrail,150);});};
// Waiting for him: one soft pulse on the highlight, once.
window.wait=()=>{if(calm||!ring.classList.contains('on'))return;ring.classList.remove('pulse');void ring.offsetWidth;ring.classList.add('pulse');};
window.card=(c)=>{const on=!!(c&&(c.text||c.kicker));card.classList.toggle('on',on);if(!on)return;
 $('k').textContent=c.kicker||'';$('t').textContent=c.text||'';$('h').textContent=c.hint||'';$('pg').textContent=c.page||'';$('cp').hidden=!c.text;
 const dots=$('dots');dots.replaceChildren();if(c.dots)for(let i=0;i<c.dots.of;i++){const d=document.createElement('i');d.className=i<c.dots.at?'done':i===c.dots.at?'now':'';dots.appendChild(d);}
 $('bar').getAnimations().forEach(a=>a.cancel());placeCard();};
// The page has no bridge to main: console lines are the message, and main answers by taking the mouse while it is over the card.
card.addEventListener('mouseenter',()=>console.log('baton:card:hover:1'));
card.addEventListener('mouseleave',()=>console.log('baton:card:hover:0'));
$('cp').onclick=()=>{console.log('baton:card:copy');$('cp').textContent='Copied';setTimeout(()=>{$('cp').textContent='Copy';},1200);};
window.timer=(ms)=>{const b=$('bar');b.getAnimations().forEach(a=>a.cancel());b.animate([{transform:'scaleX(1)'},{transform:'scaleX(0)'}],{duration:ms,easing:'linear',fill:'forwards'});};
window.marks=(list)=>{const box=$('mks');box.replaceChildren();for(const m of list){const e=document.createElement('div');e.className='mk'+(m.state?' '+m.state:'');e.style.left=m.x+'px';e.style.top=m.y+'px';e.textContent=m.n;box.appendChild(e);}};
window.back=(to)=>{card.classList.remove('on');hide();landed=null;if(to&&!calm)flight(to,()=>ptr.classList.remove('on'));else ptr.classList.remove('on');};
window.clearAll=()=>{cancelAnimationFrame(anim);clearTimeout(typing);landed=null;ptr.classList.remove('on');hide();$('trail').classList.remove('on','fade');window.card(null);window.marks([]);};
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

/** What is drawn at the target: the control's size from the accessibility tree, a ring or a dashed box, a step number. */
export interface PointOptions {
  readonly size?: { readonly width: number; readonly height: number };
  readonly shape?: "ring" | "box";
  readonly badge?: number;
}

/** A button or menu gets a ring; a field or an area gets a dashed box. */
export const shapeFor = (size: {
  readonly width: number;
  readonly height: number;
}): "ring" | "box" => (size.width > 160 || size.height > 80 ? "box" : "ring");

export interface PointerOverlay {
  /** Fly to a global desktop point and label it. False when that is not the display he is on. */
  readonly point: (
    to: { x: number; y: number },
    label: string | null,
    options?: PointOptions,
  ) => Promise<boolean>;
  /** Waiting for him: one soft pulse on the highlight, once. */
  readonly waiting: () => Promise<void>;
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
    markCompanionWindow(win);
    // Forwarded, so the page still sees the pointer over its card and can ask for the mouse.
    win.setIgnoreMouseEvents(true, { forward: true });
    win.webContents.on("console-message", (...args: ReadonlyArray<unknown>) => {
      const first = args[0] as { message?: unknown } | undefined;
      const message = typeof args[2] === "string" ? args[2] : first?.message;
      if (message === "baton:card:hover:1") win.setIgnoreMouseEvents(false);
      else if (message === "baton:card:hover:0") win.setIgnoreMouseEvents(true, { forward: true });
      else if (message === "baton:card:copy" && shown !== null)
        Electron.clipboard.writeText(shown.text);
    });
    // Made on the primary's scale; set again so a 125 % display's window is the display's size.
    win.setBounds(display.bounds);
    protectFromCapture(win);
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    const bottom = display.bounds.y + display.bounds.height;
    const inset = bottom - (display.workArea.y + display.workArea.height) + CARD_ABOVE_WORK_AREA;
    const ready = loadDocument(win, OVERLAY_DOCUMENT)
      .then((loaded) =>
        loaded ? win.webContents.executeJavaScript(`window.inset(${inset})`) : undefined,
      )
      .then(() => (win.isDestroyed() ? undefined : win.showInactive()))
      .catch(() => undefined);
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
    point: async (to, label, options) => {
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
        `window.fly(${JSON.stringify(from)},${JSON.stringify(local(target, to))},${JSON.stringify(label)},${JSON.stringify(options?.size === undefined ? { badge: options?.badge } : { w: Math.round(options.size.width), h: Math.round(options.size.height), shape: options.shape ?? shapeFor(options.size), badge: options.badge })})`,
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
    waiting: async () => {
      if (stage !== null) await run(stage, "window.wait()");
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
