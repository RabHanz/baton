/* oxlint-disable t3code/no-low-value-comments -- Baton file predating upstream's rule (D82) */
// @effect-diagnostics globalTimers:off globalDate:off nodeBuiltinImport:off
/**
 * The pill: small dark glass above the taskbar of the active display, up only while something is
 * happening (D112). It never takes focus or the mouse and stays out of screenshots. The bars read a
 * live level, his voice or Baton's; the sounds are made in the page from pillSounds.ts. The window
 * is built ahead and hidden so a wake shows at once, and goes as soon as it would be the last one
 * open, because a window left open stops "last window closed" quitting the app.
 */
import * as Electron from "electron";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import {
  PLACES,
  defaultPosition,
  parseSpots,
  placePosition,
  positionOf,
  snapPosition,
  spotFrom,
  type PlaceId,
  type Spot,
} from "./pillPlacement.ts";
import { markCompanionWindow } from "../lastAppWindow.ts";
import { loadDocument } from "./loadDocument.ts";
import { LISTENING_WEBP, MARK_STILL_PNG, STING_WEBP } from "./pillMotionArt.ts";
import { isPillClick } from "./pillGesture.ts";
import {
  CUE_TAIL_MS,
  PILL_PARTIAL,
  PILL_SOUNDS,
  THINKING_AFTER_MS,
  THINKING_EVERY_MS,
  soundMs,
  type PillSound,
} from "./pillSounds.ts";
import {
  IDLE_TURN,
  SILENT_AFTER_MS,
  reduceTurn,
  turnHoldsEscape,
  turnLimitMs,
  turnView,
  type TurnEvent,
  type TurnState,
} from "@t3tools/baton-shared/voiceTurn";

const WIDTH = 420;
const HEIGHT = 52;
/** Clear of a dictation bar in Wispr's place at the bottom edge, so both can show. */
const ABOVE_WORK_AREA = 44;
const TOP_MARGIN = 10;
const DRAG_MS = 16;
/** No heartbeat from the page for this long means the release was lost. */
const BEAT_TIMEOUT_MS = 700;
const LEVEL_MS = 80;
/** Below this the microphone is dead rather than quiet. */
const DEAD_LEVEL = 0.03;
/** The closing sound plays out before the window hides. */
const CLOSE_MS = 280;

/** The phases that show a waveform and no word: his voice or Baton's, live. */
const WAVE_PHASES = ["listening", "speaking", "dictating"];

/**
 * The pill: black in every theme, 24 px tall, nothing it does not need. A live waveform while he or
 * Baton is speaking; otherwise one short word; soft text only for an error or where words go. No
 * icon, no button, no shadow beyond a hairline. The bars move when a level arrives, not on a timer.
 */
export const PILL_DOCUMENT = `<!doctype html><html><head><meta charset="utf-8"><style>
:root{--ink:#0d0d11;--line:rgba(255,255,255,.14);--text:#f6f6f8;--soft:#9d9da8;--blue:#9dc1ff;--green:#3fce8e;--amber:#ffb454;--red:#ff7b7b;
--sans:"Segoe UI Variable Text","Segoe UI",-apple-system,BlinkMacSystemFont,system-ui,sans-serif}
html,body{height:100%;margin:0;overflow:hidden;background:transparent;font:600 12px/1 var(--sans);-webkit-font-smoothing:antialiased;-webkit-user-select:none;user-select:none;cursor:default}
body{display:flex;align-items:center;justify-content:center}
#p{box-sizing:border-box;display:flex;align-items:center;gap:7px;height:24px;max-width:${WIDTH - 16}px;padding:0 11px;border-radius:999px;background:var(--ink);border:1px solid var(--line);box-shadow:0 0 0 1px rgba(0,0,0,.5);color:var(--text);position:relative;touch-action:none;opacity:0;transform:translateY(4px);transition:opacity .12s,transform .16s cubic-bezier(.2,.8,.2,1),border-color .15s;cursor:grab}
#p.on{opacity:1;transform:none}
#p.drag{cursor:grabbing}
#p.drag::before{content:"";position:absolute;inset:-10px}
#p.rest{height:6px;width:36px;padding:0;gap:0;border-color:rgba(255,255,255,.4);background:rgba(13,13,17,.78)}
#p.rest[data-rest=muted]{border-color:var(--red)}
#p.rest[data-rest=off]{border-style:dashed;border-color:rgba(255,255,255,.3);background:rgba(13,13,17,.4);box-shadow:none}
#p.rest>*{display:none}
#mk{display:none;width:16px;height:16px;flex:none}
#p[data-mark=on] #mk{display:block}
#w{display:none;align-items:center;gap:2px;height:14px;flex:none}
#w i{display:block;width:2px;height:12px;border-radius:1px;background:var(--bar,#fff);transform:scaleY(.17);transition:transform .09s linear;will-change:transform}
#p[data-wave=on] #w{display:flex}
#d{display:none;align-items:center;gap:4px;height:14px;flex:none}
#d b{display:block;width:4px;height:4px;border-radius:50%;background:#fff;opacity:.25;animation:step 1350ms steps(1,end) infinite}
#d b:nth-child(2){animation-delay:450ms}
#d b:nth-child(3){animation-delay:900ms}
@keyframes step{0%{opacity:1}33.33%{opacity:.25}100%{opacity:.25}}
#p[data-dots=on] #d{display:flex}
#p[data-phase=speaking] #w{gap:3px}
#p[data-phase=speaking] #w i{width:3px;border-radius:2px}
#t{white-space:nowrap}
#t:empty,#c:empty{display:none}
#c{color:var(--soft);font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
#p[data-tone=voice]{--bar:var(--blue)}
#p[data-tone=write],#p[data-tone=good]{--bar:var(--green)}
#p[data-tone=good] #t{color:var(--green)}
#p[data-tone=off] #t{color:var(--red)}
#p[data-tone=warn]{border-color:var(--amber)}
@media (prefers-reduced-motion:reduce){#p,#w i{transition:none}#d b{animation:none;opacity:.7}}
</style></head><body><div id="p" role="status" aria-live="polite"><img id="mk" alt="" width="16" height="16"><span id="w"></span><span id="d"><b></b><b></b><b></b></span><span id="t"></span><span id="c"></span></div>
<script>
const $=i=>document.getElementById(i),BARS=8,SOUNDS=${JSON.stringify(PILL_SOUNDS)},PARTIAL=${PILL_PARTIAL},WAVE=${JSON.stringify(WAVE_PHASES)};
const calm=matchMedia('(prefers-reduced-motion:reduce)').matches;
const ART={sting:'data:image/webp;base64,${STING_WEBP}',listening:'data:image/webp;base64,${LISTENING_WEBP}',still:'data:image/png;base64,${MARK_STILL_PNG}'};
const MARKED=['listening','thinking','speaking','working','dictating'];
let shown='none',stinging=false,want='still',stingTimer=0;
// One image at a time, swapped for a new element so an animation starts from its first frame; gone when nothing is up.
const setMark=name=>{if(name===shown)return;shown=name;const m=$('mk'),n=m.cloneNode();if(name==='none')n.removeAttribute('src');else n.src=ART[name];m.replaceWith(n);};
const bars=Array.from({length:BARS},()=>{const b=document.createElement('i');$('w').appendChild(b);return b;});
const shape=bars.map((_,i)=>{const h=Math.abs((BARS-1)/2-i);return Math.max(.25,1-h*h/18);});
let ctx=null,live=false,tick=0;
const draw=n=>{tick+=1;bars.forEach((b,i)=>{const wobble=calm?1:.7+.3*Math.sin(tick*1.9+i*1.3);b.style.transform='scaleY('+((2+10*shape[i]*n*wobble)/12).toFixed(3)+')';});};
const note=(n,start)=>{for(const[f,g]of[[n.hz,n.gain],[n.hz*2,n.gain*PARTIAL]]){const o=ctx.createOscillator(),a=ctx.createGain(),t=start+n.at;o.type='sine';o.frequency.value=f;a.gain.setValueAtTime(0,t);a.gain.linearRampToValueAtTime(g,t+.004);a.gain.exponentialRampToValueAtTime(g*.002,t+n.len);o.connect(a).connect(ctx.destination);o.start(t);o.stop(t+n.len+.02);}};
const {ipcRenderer}=typeof require==='function'?require('electron'):{ipcRenderer:{send(){}}};
const isClick=${isPillClick.toString()};
let drag=false,beat=0,down=null;
const grab=$('p');
// Only the capsule takes the mouse; everything around it in this window stays click-through.
grab.addEventListener('mouseenter',()=>ipcRenderer.send('baton-pill:hover',true));
grab.addEventListener('mouseleave',()=>{if(!drag)ipcRenderer.send('baton-pill:hover',false);});
// A drag is a captured pointer: it ends when the pointer is released, cancelled or lost, never because the cursor left the capsule.
const endDrag=why=>{if(!drag)return;drag=false;clearInterval(beat);grab.classList.remove('drag');ipcRenderer.send('baton-pill:drag',false,why);};
// A press only becomes a drag after 4 px of movement; released sooner it is a click, which dismisses.
grab.addEventListener('pointerdown',e=>{if(e.button!==0||drag)return;down={x:e.screenX,y:e.screenY,t:performance.now()};try{grab.setPointerCapture(e.pointerId);}catch(_){}});
grab.addEventListener('pointermove',e=>{if(down===null||drag)return;if(isClick(e.screenX-down.x,e.screenY-down.y,0))return;drag=true;grab.classList.add('drag');ipcRenderer.send('baton-pill:drag',true);beat=setInterval(()=>ipcRenderer.send('baton-pill:beat'),120);});
grab.addEventListener('pointerup',e=>{const d=down;down=null;if(drag)return endDrag('up');if(d===null||grab.classList.contains('rest'))return;
 const dx=e.screenX-d.x,dy=e.screenY-d.y,ms=performance.now()-d.t;if(isClick(dx,dy,ms))ipcRenderer.send('baton-pill:click',dx,dy,ms);});
grab.addEventListener('pointercancel',()=>{down=null;endDrag('cancel');});
grab.addEventListener('lostpointercapture',()=>{down=null;endDrag('lost');});
grab.addEventListener('dblclick',()=>{if(grab.classList.contains('rest'))ipcRenderer.send('baton-pill:reset');});
grab.addEventListener('contextmenu',e=>{e.preventDefault();ipcRenderer.send('baton-pill:menu');});
let bypass=false;const setBypass=e=>{const b=e.altKey||e.shiftKey;if(b!==bypass){bypass=b;ipcRenderer.send('baton-pill:bypass',b);}};
addEventListener('pointermove',setBypass);addEventListener('pointerdown',setBypass);addEventListener('keydown',setBypass);addEventListener('keyup',setBypass);
window.pill={
 show(v){const p=$('p'),wave=WAVE.includes(v.phase);const marked=MARKED.includes(v.phase);p.dataset.mark=marked?'on':'off';want=!marked?'none':calm||v.phase!=='listening'?'still':'listening';if(!stinging)setMark(want);p.dataset.tone=v.tone;p.dataset.phase=v.phase;p.className='on';p.dataset.wave=wave?'on':'off';p.dataset.dots=v.phase==='thinking'||v.phase==='working'?'on':'off';p.setAttribute('aria-label',v.label);
  live=wave&&v.wave==='live';if(wave)draw(live?.15:.1);
  // A word only when the waveform does not say it; soft text only for where words go or an error.
  $('t').textContent=wave||v.phase==='ended'||v.phase==='thinking'?'':v.label;
  $('c').textContent=v.phase==='ended'?'Say the wake word':(v.caption&&/^to /.test(v.caption)?v.caption:'');},
 rest(why){const p=$('p');p.className='on rest';clearTimeout(stingTimer);stinging=false;setMark('none');delete p.dataset.phase;delete p.dataset.tone;p.dataset.wave='off';p.dataset.dots='off';p.dataset.rest=why||'sleeping';live=false;},
 level(n){if(live&&!calm)draw(Math.min(1,n));},
 hide(){$('p').className='';live=false;clearTimeout(stingTimer);stinging=false;setMark('none');},
 sting(){if(calm)return;clearTimeout(stingTimer);stinging=true;shown='';setMark('sting');stingTimer=setTimeout(()=>{stinging=false;setMark(want);},2050);},
 why(w){const p=$('p');if(p.classList.contains('rest'))p.dataset.rest=w;},
 sound(name,gain){ctx??=new AudioContext();const t=ctx.currentTime+.01;for(const n of SOUNDS[name])note({...n,gain:n.gain*gain},t);},
};
</script></body></html>`;

export const markersDocument = (
  dots: ReadonlyArray<{ id: string; label: string; x: number; y: number }>,
): string =>
  `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;overflow:hidden;background:transparent;font:600 12px "Segoe UI Variable Text","Segoe UI",system-ui,sans-serif}
.d{position:absolute;width:12px;height:12px;margin:-6px 0 0 -6px;border-radius:50%;background:rgba(31,111,91,.35);border:2px solid #1f6f5b;box-sizing:border-box}
.d.on{background:#1f6f5b;transform:scale(1.5)}
.l{position:absolute;transform:translate(-50%,14px);color:#1f6f5b;background:rgba(255,253,249,.92);padding:2px 8px;border-radius:6px;border:1px solid #e6e1d6;white-space:nowrap;opacity:0}
.l.on{opacity:1}</style><body></body><script>
const dots=${JSON.stringify(dots)};
for(const d of dots){const e=document.createElement('div');e.className='d';e.id='d-'+d.id;e.style.left=d.x+'px';e.style.top=d.y+'px';document.body.appendChild(e);
const l=document.createElement('div');l.className='l';l.id='l-'+d.id;l.textContent=d.label;l.style.left=d.x+'px';l.style.top=d.y+'px';document.body.appendChild(l);}
window.hi=id=>{for(const d of dots){document.getElementById('d-'+d.id).classList.toggle('on',d.id===id);document.getElementById('l-'+d.id).classList.toggle('on',d.id===id);}};
</script>`;

export interface VoicePill {
  readonly on: (event: TurnEvent, options?: { readonly silent?: boolean }) => void;
  /** His microphone, while listening or dictating. */
  readonly micLevel: (value: number) => void;
  /** Baton's own voice, while it speaks. */
  readonly speechLevel: (value: number) => void;
  /** Build the window now, so the first wake is as quick as the rest. */
  readonly warm: () => void;
  /** The small mark at rest, off unless he asks. */
  readonly setRest: (on: boolean) => void;
  /** Why it is not hearing him, so the rest bar can say so: asleep, muted, or off. */
  readonly setReason: (reason: "sleeping" | "muted" | "off") => void;
  readonly setEdge: (edge: "bottom" | "top") => void;
  /** Puts it on a named place of the display it is on and keeps it there. */
  readonly moveTo: (place: PlaceId) => void;
  /** Where the pill is, or would appear: what the vocabulary toast sits beside. */
  readonly anchor: () => Electron.Rectangle;
  readonly state: () => TurnState;
  readonly dispose: () => void;
}

const loadSpots = (file: string): Readonly<Record<string, Spot>> => {
  try {
    return parseSpots(JSON.parse(NodeFS.readFileSync(file, "utf8")));
  } catch {
    return {};
  }
};

export const createVoicePill = (input: {
  /** 0 off, 0.5 quiet, 1 normal. */
  readonly cueGain: () => number;
  /** Holds a cue until he is quiet (true), or says to drop it (false); then tells the mic path it will sound. */
  readonly cueGate?: {
    readonly quiet: () => Promise<boolean>;
    readonly playing: (ms: number) => void;
  };
  readonly rest: () => boolean;
  /** BATON_TEST_DIR: a PNG of the pill's own page at every state change, taken from inside the app. */
  readonly captureDir?: string;
  readonly edge: () => "bottom" | "top";
  /** Where `baton-pill.json` is kept: the places he dragged it to. */
  readonly stateDir: string;
  readonly holdEscape: (onPress: () => void) => () => void;
  readonly onChange?: (state: TurnState) => void;
  /** Esc while it is up. */
  readonly onDismiss: () => void;
  /** Each wake, from the event to the window on screen. */
  readonly onShown?: (ms: number) => void;
  /** How each drag ended, for the turn log: a drag that fails shows up there. */
  readonly onDrag?: (outcome: {
    readonly reason: string;
    readonly dx: number;
    readonly dy: number;
    readonly ms: number;
  }) => void;
}): VoicePill => {
  let state: TurnState = IDLE_TURN;
  let window: Electron.BrowserWindow | null = null;
  let ready: Promise<void> = Promise.resolve();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let silentTimer: ReturnType<typeof setTimeout> | null = null;
  let hideTimer: ReturnType<typeof setTimeout> | null = null;
  let lastLevel = 0;
  let loudest = 0;
  let releaseEscape: (() => void) | null = null;
  let why: "sleeping" | "muted" | "off" = "sleeping";
  const spotsFile = NodePath.join(input.stateDir, "baton-pill.json");
  let spots = loadSpots(spotsFile);
  let dragTimer: ReturnType<typeof setInterval> | null = null;
  let bypassSnap = false;
  let lastBeat = 0;
  let dragStarted: { readonly at: number; readonly x: number; readonly y: number } | null = null;
  let loadRetries = 0;
  let shots = 0;
  let markers: Electron.BrowserWindow | null = null;
  let markerPlace: PlaceId | null = null;
  const margins = () => ({ top: TOP_MARGIN, bottom: ABOVE_WORK_AREA });

  const displayKey = (display: Electron.Display) => String(display.id);
  /** Where it goes on this display: his place if he moved it, else the default. */
  const placeFor = (display: Electron.Display) => {
    const size = { width: WIDTH, height: HEIGHT };
    const spot = spots[displayKey(display)];
    return spot === undefined
      ? defaultPosition(display.workArea, size, input.edge(), {
          top: TOP_MARGIN,
          bottom: ABOVE_WORK_AREA,
        })
      : positionOf(display.workArea, size, spot);
  };
  const saveSpots = () => {
    try {
      NodeFS.writeFileSync(spotsFile, JSON.stringify(spots));
    } catch {
      // The place is a nicety; losing it must never matter.
    }
  };

  /** The named places and the grid, drawn on the display while it is dragged. */
  const openMarkers = (display: Electron.Display) => {
    closeMarkers();
    const area = display.workArea;
    const size = { width: WIDTH, height: HEIGHT };
    const dots = PLACES.map((place) => {
      const at = placePosition(area, size, place.id, margins());
      return {
        id: place.id,
        label: place.label,
        x: at.x - area.x + WIDTH / 2,
        y: at.y - area.y + HEIGHT / 2,
      };
    });
    const win = new Electron.BrowserWindow({
      ...area,
      frame: false,
      transparent: true,
      focusable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      show: false,
      resizable: false,
    });
    win.setIgnoreMouseEvents(true);
    win.setAlwaysOnTop(true, "screen-saver");
    markCompanionWindow(win);
    win.setContentProtection(true);
    const page = markersDocument(dots);
    void loadDocument(win, page).then((loaded) => {
      if (loaded && !win.isDestroyed()) win.showInactive();
    });
    markers = win;
    markerPlace = null;
  };
  const closeMarkers = () => {
    if (markers !== null && !markers.isDestroyed()) markers.destroy();
    markers = null;
  };
  const stopDrag = (save: boolean, reason = "up") => {
    if (dragTimer === null) return;
    clearInterval(dragTimer);
    dragTimer = null;
    closeMarkers();
    if (window === null || window.isDestroyed()) return;
    const bounds = window.getBounds();
    if (dragStarted !== null) {
      input.onDrag?.({
        reason,
        dx: bounds.x - dragStarted.x,
        dy: bounds.y - dragStarted.y,
        ms: Date.now() - dragStarted.at,
      });
      dragStarted = null;
    }
    if (!save) return;
    const display = Electron.screen.getDisplayMatching(bounds);
    spots = { ...spots, [displayKey(display)]: spotFrom(display.workArea, bounds, bounds) };
    saveSpots();
  };

  const call = (code: string) => {
    const target = window;
    void ready.then(() => {
      if (target !== null && !target.isDestroyed()) {
        void target.webContents.executeJavaScript(code).catch(() => undefined);
      }
    });
  };

  const build = () => {
    if (window !== null && !window.isDestroyed()) return;
    const created = new Electron.BrowserWindow({
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
      // Local page of ours only; node is for the drag messages below.
      webPreferences: {
        autoplayPolicy: "no-user-gesture-required",
        backgroundThrottling: false,
        nodeIntegration: true,
        contextIsolation: false,
      },
    });
    created.setAlwaysOnTop(true, "screen-saver");
    markCompanionWindow(created);
    created.setIgnoreMouseEvents(true, { forward: true });
    // Out of screenshots and recordings by design, which also hides it from OS-level capture tools; a test
    // run (BATON_TEST_DIR) lets them see it.
    created.setContentProtection(input.captureDir === undefined);
    created.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    window = created;
    ready = loadDocument(created, PILL_DOCUMENT).then((loaded) => {
      // A pill that failed to load would stay blank: build it again, and show what it should.
      if (loaded || window !== created) return;
      if (!created.isDestroyed()) created.destroy();
      window = null;
      if (loadRetries >= 2) return;
      loadRetries += 1;
      build();
      if (turnView(state) !== null) on({ type: "window_open" });
    });
  };

  const raise = () => {
    build();
    if (hideTimer !== null) clearTimeout(hideTimer);
    hideTimer = null;
    const target = window;
    const display = Electron.screen.getDisplayNearestPoint(Electron.screen.getCursorScreenPoint());
    void ready.then(() => {
      if (target === null || target.isDestroyed() || target.isVisible()) return;
      const at = placeFor(display);
      target.setBounds({ ...at, width: WIDTH, height: HEIGHT });
      target.showInactive();
    });
  };

  const lower = () => {
    if (window === null || window.isDestroyed()) return;
    if (input.rest()) {
      raise();
      call(`window.pill.rest(${JSON.stringify(why)})`);
      return;
    }
    call("window.pill.hide()");
    const closing = window;
    hideTimer = setTimeout(() => {
      if (!closing.isDestroyed()) closing.hide();
    }, CLOSE_MS);
  };

  const setEscape = (next: boolean) => {
    if (next === (releaseEscape !== null)) return;
    if (next) releaseEscape = input.holdEscape(input.onDismiss);
    else {
      releaseEscape?.();
      releaseEscape = null;
    }
  };

  const sound = (name: PillSound) => {
    const gain = input.cueGain();
    if (gain <= 0) return;
    const play = () => {
      input.cueGate?.playing(soundMs(name) + CUE_TAIL_MS);
      call(`window.pill.sound(${JSON.stringify(name)},${gain})`);
    };
    if (input.cueGate === undefined) return play();
    void input.cueGate.quiet().then((ok) => {
      if (ok) play();
    });
  };
  let thinkTimer: ReturnType<typeof setTimeout> | null = null;
  /** A quiet note after a long wait, then no more than one every eight seconds, until something else happens. */
  const thinkingCue = (after: number) => {
    if (thinkTimer !== null) clearTimeout(thinkTimer);
    thinkTimer = setTimeout(() => {
      if (state.phase !== "thinking" && state.phase !== "working") return;
      sound("thinking");
      thinkingCue(THINKING_EVERY_MS);
    }, after);
  };

  const on = (event: TurnEvent, options?: { readonly silent?: boolean }) => {
    const previous = state;
    state = reduceTurn(state, event);
    const mute = options?.silent === true;
    const sound_ = mute ? () => undefined : sound;
    const waiting = (phase: string) => phase === "thinking" || phase === "working";
    if (thinkTimer !== null && !waiting(state.phase)) {
      clearTimeout(thinkTimer);
      thinkTimer = null;
    }
    if (waiting(state.phase) && !waiting(previous.phase) && !mute) thinkingCue(THINKING_AFTER_MS);
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (silentTimer !== null) clearTimeout(silentTimer);
    silentTimer = null;
    const view = turnView(state);
    if (view === null) {
      setEscape(false);
      if (previous.phase !== "idle") {
        if (previous.phase !== "error" && previous.phase !== "done") sound_("end");
        lower();
      }
    } else {
      raise();
      setEscape(turnHoldsEscape(state));
      call(`window.pill.show(${JSON.stringify({ ...view, phase: state.phase })})`);
      if (event.type === "wake") {
        call("window.pill.sting()");
        loudest = 0;
        sound_("wake");
        const at = performance.now();
        void ready.then(() => input.onShown?.(performance.now() - at));
      }
      if (state.phase === "error" && previous.phase !== "error") sound_("error");
      if (state.phase === "listening" && !state.heard) {
        silentTimer = setTimeout(() => {
          if (loudest < DEAD_LEVEL) on({ type: "silent" });
        }, SILENT_AFTER_MS);
      }
      // The core ends an open window, so Listening and spoken dictation stay as long as it lasts.
      if (!(state.open && (state.phase === "dictating" || state.phase === "listening"))) {
        timer = setTimeout(() => on({ type: "dismissed" }), turnLimitMs(state.phase));
      }
    }
    if (previous !== state) input.onChange?.(state);
    if (input.captureDir !== undefined && previous.phase !== state.phase) {
      const dir = input.captureDir;
      const phase = state.phase;
      const n = (shots += 1);
      // After the page has had a moment to paint what it was just told.
      setTimeout(() => {
        const target = window;
        if (target === null || target.isDestroyed()) return;
        void target.webContents
          .capturePage()
          .then((image) => {
            NodeFS.mkdirSync(dir, { recursive: true });
            NodeFS.writeFileSync(NodePath.join(dir, `pill-${phase}-${n}.png`), image.toPNG());
          })
          .catch(() => undefined);
      }, 400).unref();
    }
  };

  const push = (value: number) => {
    const now = performance.now();
    if (now - lastLevel < LEVEL_MS) return;
    lastLevel = now;
    call(`window.pill.level(${value.toFixed(2)})`);
  };

  const closeIfLast = () => {
    const others = Electron.BrowserWindow.getAllWindows().filter(
      (w) => !w.isDestroyed() && w.isFocusable(),
    );
    if (others.length === 0 && window !== null && !window.isDestroyed()) {
      window.destroy();
      window = null;
    }
  };
  const follow = (_: unknown, win: Electron.BrowserWindow) => void win.once("closed", closeIfLast);
  Electron.app.on("browser-window-created", follow);
  for (const win of Electron.BrowserWindow.getAllWindows()) win.once("closed", closeIfLast);

  const mine = (event: Electron.IpcMainEvent) =>
    window !== null && event.sender === window.webContents;
  Electron.ipcMain.on("baton-pill:hover", (event, over: unknown) => {
    if (!mine(event) || window === null || window.isDestroyed()) return;
    // Over the capsule it takes the mouse; anywhere else in its window the mouse goes through.
    if (over === true) window.setIgnoreMouseEvents(false);
    else if (dragTimer === null) window.setIgnoreMouseEvents(true, { forward: true });
  });
  Electron.ipcMain.on("baton-pill:beat", (event) => {
    if (mine(event)) lastBeat = Date.now();
  });
  Electron.ipcMain.on("baton-pill:drag", (event, on: unknown, why: unknown) => {
    if (!mine(event) || window === null || window.isDestroyed()) return;
    if (on !== true) return stopDrag(why !== "cancel", typeof why === "string" ? why : "up");
    stopDrag(false);
    const start = Electron.screen.getCursorScreenPoint();
    const from = window.getBounds();
    lastBeat = Date.now();
    dragStarted = { at: Date.now(), x: from.x, y: from.y };
    const target = window;
    openMarkers(Electron.screen.getDisplayMatching(from));
    dragTimer = setInterval(() => {
      if (target.isDestroyed()) return stopDrag(false);
      // The page says it is still holding the pointer every 120 ms; a lost release cannot leave this stuck.
      if (Date.now() - lastBeat > BEAT_TIMEOUT_MS) return stopDrag(true, "timeout");
      const cursor = Electron.screen.getCursorScreenPoint();
      const display = Electron.screen.getDisplayNearestPoint(cursor);
      const area = display.workArea;
      const snapped = snapPosition(
        area,
        { width: from.width, height: from.height },
        { x: from.x + cursor.x - start.x, y: from.y + cursor.y - start.y },
        { bypass: bypassSnap, margins: margins() },
      );
      if (snapped.place !== markerPlace && markers !== null && !markers.isDestroyed()) {
        markerPlace = snapped.place;
        void markers.webContents
          .executeJavaScript(`window.hi(${JSON.stringify(snapped.place)})`)
          .catch(() => undefined);
      }
      target.setBounds({
        x: snapped.x,
        y: snapped.y,
        width: from.width,
        height: from.height,
      });
    }, DRAG_MS);
    dragTimer.unref();
  });
  Electron.ipcMain.on("baton-pill:click", (event, dx: unknown, dy: unknown, ms: unknown) => {
    if (!mine(event)) return;
    input.onDrag?.({
      reason: "click",
      dx: Number(dx) || 0,
      dy: Number(dy) || 0,
      ms: Number(ms) || 0,
    });
    input.onDismiss();
  });
  Electron.ipcMain.on("baton-pill:bypass", (event, on: unknown) => {
    if (mine(event)) bypassSnap = on === true;
  });
  const moveTo = (id: PlaceId) => {
    if (window === null || window.isDestroyed()) {
      build();
    }
    const target = window;
    if (target === null || target.isDestroyed()) return;
    const display = Electron.screen.getDisplayMatching(target.getBounds());
    const size = { width: WIDTH, height: HEIGHT };
    const at = placePosition(display.workArea, size, id, margins());
    spots = { ...spots, [displayKey(display)]: spotFrom(display.workArea, size, at) };
    saveSpots();
    target.setBounds({ ...at, ...size });
  };
  Electron.ipcMain.on("baton-pill:menu", (event) => {
    if (!mine(event) || window === null || window.isDestroyed()) return;
    Electron.Menu.buildFromTemplate([
      ...(["centre", "top", "bottom"] as const).map((id) => ({
        label: `Move to ${PLACES.find((p) => p.id === id)!.label.toLowerCase()}`,
        click: () => moveTo(id),
      })),
      { type: "separator" as const },
      { label: "Put it back", click: () => Electron.ipcMain.emit("baton-pill:reset", event) },
    ]).popup({ window });
  });
  Electron.ipcMain.on("baton-pill:reset", (event) => {
    if (!mine(event) || window === null || window.isDestroyed()) return;
    const display = Electron.screen.getDisplayMatching(window.getBounds());
    const { [displayKey(display)]: _gone, ...rest } = spots;
    spots = rest;
    saveSpots();
    window.setBounds({ ...placeFor(display), width: WIDTH, height: HEIGHT });
  });

  return {
    on,
    micLevel: (value) => {
      loudest = Math.max(loudest, value);
      if (state.phase === "listening" || state.phase === "dictating") push(value);
    },
    speechLevel: (value) => {
      if (state.phase === "speaking") push(value);
    },
    warm: build,
    setRest: (next) => {
      if (state.phase !== "idle") return;
      if (next) {
        raise();
        call(`window.pill.rest(${JSON.stringify(why)})`);
      } else lower();
    },
    setReason: (next) => {
      why = next;
      if (state.phase === "idle" && input.rest()) call(`window.pill.why(${JSON.stringify(next)})`);
    },
    setEdge: () => {
      if (window !== null && !window.isDestroyed()) window.hide();
      if (input.rest() && state.phase === "idle") {
        raise();
        call(`window.pill.rest(${JSON.stringify(why)})`);
      }
    },
    moveTo,
    anchor: () => {
      if (window !== null && !window.isDestroyed()) return window.getBounds();
      const display = Electron.screen.getDisplayNearestPoint(
        Electron.screen.getCursorScreenPoint(),
      );
      return { ...placeFor(display), width: WIDTH, height: HEIGHT };
    },
    state: () => state,
    dispose: () => {
      if (timer !== null) clearTimeout(timer);
      if (silentTimer !== null) clearTimeout(silentTimer);
      closeMarkers();
      Electron.app.removeListener("browser-window-created", follow);
      setEscape(false);
      stopDrag(false);
      if (window !== null && !window.isDestroyed()) window.destroy();
      window = null;
    },
  };
};
