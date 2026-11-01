/* oxlint-disable t3code/no-low-value-comments -- Baton file predating upstream's rule (D82) */
// @effect-diagnostics globalTimers:off nodeBuiltinImport:off
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
import { PILL_PARTIAL, PILL_SOUNDS, type PillSound } from "./pillSounds.ts";
import { markSvg, type MarkOptions } from "./trayMark.ts";
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
const LEVEL_MS = 80;
/** Below this the microphone is dead rather than quiet. */
const DEAD_LEVEL = 0.03;
/** The closing sound plays out before the window hides. */
const CLOSE_MS = 280;

/** Baton's window palette (home/homeDocument.ts), so the pill reads as part of the same app. */
const TILE = {
  accent: "#1f6f5b",
  quiet: "#6b675e",
  bad: "#b3423a",
  faint: "#9a958a",
  warn: "#b4691f",
} as const;

/** The state glyph is the capability mark: its colour is the state, its lit bars say what is on. */
const GLYPHS = {
  listening: { color: TILE.accent, caps: [true, true, true], muted: false },
  speaking: { color: TILE.accent, caps: [true, true, true], muted: false },
  dictating: { color: TILE.accent, caps: [false, true, true], muted: false },
  done: { color: TILE.accent, caps: [true, true, true], muted: false },
  thinking: { color: TILE.quiet, caps: [false, true, false], muted: false },
  working: { color: TILE.quiet, caps: [true, true, false], muted: false },
  muted: { color: TILE.bad, caps: [true, true, true], muted: true },
  ended: { color: TILE.faint, caps: [false, false, false], muted: false },
  error: { color: TILE.warn, caps: [false, false, false], muted: false },
} as const satisfies Record<string, MarkOptions>;

export const PILL_GLYPHS: Record<string, string> = Object.fromEntries(
  Object.entries(GLYPHS).map(([phase, mark]) => [phase, markSvg(mark)]),
);

export const PILL_DOCUMENT = `<!doctype html><html><head><meta charset="utf-8"><style>
:root{--card:#fffdf9;--ink:#1c1b18;--soft:#6b675e;--faint:#9a958a;--line:#e6e1d6;--bad:#b3423a;--warn:#b4691f;
--sans:"Segoe UI Variable Text","Segoe UI",-apple-system,BlinkMacSystemFont,system-ui,sans-serif;--ease:cubic-bezier(.2,.8,.2,1)}
html,body{height:100%;margin:0;overflow:hidden;background:transparent;font:13px/1.3 var(--sans);-webkit-font-smoothing:antialiased;-webkit-user-select:none;user-select:none;cursor:default}
body{display:flex;align-items:center;justify-content:center}
#p{box-sizing:border-box;display:flex;align-items:center;gap:10px;height:40px;max-width:${WIDTH - 16}px;padding:0 16px 0 8px;border-radius:14px;background:var(--card);border:1px solid var(--line);color:var(--ink);box-shadow:0 0 0 1px rgba(28,27,24,.08),0 10px 28px -10px rgba(28,27,24,.4);opacity:0;transform:translateY(6px);transition:opacity .14s,transform .22s var(--ease)}
#p.on{opacity:1;transform:none}
#p.rest{height:14px;width:64px;padding:0;border-radius:999px;border-style:solid}
#p.rest[data-rest=muted]{border-color:var(--bad);background:#f6e1de}
#p.rest[data-rest=off]{border:1px dashed var(--faint);background:rgba(255,253,249,.55);box-shadow:none}
#p{cursor:grab}
#p.drag{cursor:grabbing}
#p.rest>*{display:none}
#g{display:block;width:24px;height:24px;flex:none;transition:transform .09s linear}
#g svg{display:block;width:100%;height:100%}
#g.swap{animation:swap .18s var(--ease)}
@keyframes swap{from{transform:scale(.8);opacity:.4}to{transform:none;opacity:1}}
#t{font-weight:600;white-space:nowrap}
#c{color:var(--soft);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
#c:empty{display:none}
#p[data-phase=error]{border-color:var(--warn)}
#p[data-phase=muted] #t{color:var(--bad)}
#p[data-phase=ended] #t{color:var(--soft)}
@media (prefers-reduced-motion:reduce){#p,#g{transition:none}#g.swap{animation:none}}
</style></head><body><div id="p" role="status" aria-live="polite"><span id="g"></span><span id="t"></span><span id="c"></span></div>
<script>
const $=i=>document.getElementById(i),SOUNDS=${JSON.stringify(PILL_SOUNDS)},PARTIAL=${PILL_PARTIAL},GLYPHS=${JSON.stringify(PILL_GLYPHS)};
const calm=matchMedia('(prefers-reduced-motion:reduce)').matches;
let ctx=null,live=false,shown='';
const note=(n,start)=>{for(const[f,g]of[[n.hz,n.gain],[n.hz*2,n.gain*PARTIAL]]){const o=ctx.createOscillator(),a=ctx.createGain(),t=start+n.at;o.type='sine';o.frequency.value=f;a.gain.setValueAtTime(0,t);a.gain.linearRampToValueAtTime(g,t+.004);a.gain.exponentialRampToValueAtTime(g*.002,t+n.len);o.connect(a).connect(ctx.destination);o.start(t);o.stop(t+n.len+.02);}};
const {ipcRenderer}=typeof require==='function'?require('electron'):{ipcRenderer:{send(){}}};
let dragging=false;
const grab=$('p');
// Only the capsule takes the mouse; everything around it in this window stays click-through.
grab.addEventListener('mouseenter',()=>ipcRenderer.send('baton-pill:hover',true));
grab.addEventListener('mouseleave',()=>{if(dragging){dragging=false;grab.classList.remove('drag');ipcRenderer.send('baton-pill:drag',false);}ipcRenderer.send('baton-pill:hover',false);});
grab.addEventListener('mousedown',e=>{if(e.button!==0)return;dragging=true;grab.classList.add('drag');ipcRenderer.send('baton-pill:drag',true);});
addEventListener('mouseup',()=>{if(dragging){dragging=false;grab.classList.remove('drag');ipcRenderer.send('baton-pill:drag',false);}});
grab.addEventListener('dblclick',()=>ipcRenderer.send('baton-pill:reset'));
grab.addEventListener('contextmenu',e=>{e.preventDefault();ipcRenderer.send('baton-pill:menu');});
let bypass=false;const setBypass=e=>{const b=e.altKey||e.shiftKey;if(b!==bypass){bypass=b;ipcRenderer.send('baton-pill:bypass',b);}};
addEventListener('mousemove',setBypass);addEventListener('mousedown',setBypass);addEventListener('keydown',setBypass);addEventListener('keyup',setBypass);
window.pill={
 show(v){$('t').textContent=v.label;$('c').textContent=v.caption||'';const p=$('p'),g=$('g');p.dataset.phase=v.phase;p.className='on';
  if(shown!==v.phase){shown=v.phase;g.innerHTML=GLYPHS[v.phase]||'';g.style.transform='';g.classList.remove('swap');void g.offsetWidth;g.classList.add('swap');}
  live=v.wave==='live';if(!live)g.style.transform='';},
 rest(why){const p=$('p');p.className='on rest';delete p.dataset.phase;p.dataset.rest=why||'sleeping';shown='';},
 level(n){if(live&&!calm)$('g').style.transform='scale('+(1+Math.min(1,n)*.16).toFixed(3)+')';},
 hide(){$('p').className='';shown='';},
 why(w){const p=$('p');if(p.classList.contains('rest'))p.dataset.rest=w;},
 sound(name){ctx??=new AudioContext();const t=ctx.currentTime+.01;for(const n of SOUNDS[name])note(n,t);},
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
  readonly on: (event: TurnEvent) => void;
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
  readonly sounds: () => boolean;
  readonly rest: () => boolean;
  readonly edge: () => "bottom" | "top";
  /** Where `baton-pill.json` is kept: the places he dragged it to. */
  readonly stateDir: string;
  readonly holdEscape: (onPress: () => void) => () => void;
  readonly onChange?: (state: TurnState) => void;
  /** Esc while it is up. */
  readonly onDismiss: () => void;
  /** Each wake, from the event to the window on screen. */
  readonly onShown?: (ms: number) => void;
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
    void win.loadURL(`data:text/html,${encodeURIComponent(page)}`).then(() => {
      if (!win.isDestroyed()) win.showInactive();
    });
    markers = win;
    markerPlace = null;
  };
  const closeMarkers = () => {
    if (markers !== null && !markers.isDestroyed()) markers.destroy();
    markers = null;
  };
  const stopDrag = (save: boolean) => {
    if (dragTimer === null) return;
    clearInterval(dragTimer);
    dragTimer = null;
    closeMarkers();
    if (!save || window === null || window.isDestroyed()) return;
    const bounds = window.getBounds();
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
    created.setContentProtection(true);
    created.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    window = created;
    ready = created
      .loadURL(`data:text/html,${encodeURIComponent(PILL_DOCUMENT)}`)
      .then(() => undefined);
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
    if (input.sounds()) call(`window.pill.sound(${JSON.stringify(name)})`);
  };

  const on = (event: TurnEvent) => {
    const previous = state;
    state = reduceTurn(state, event);
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (silentTimer !== null) clearTimeout(silentTimer);
    silentTimer = null;
    const view = turnView(state);
    if (view === null) {
      setEscape(false);
      if (previous.phase !== "idle") {
        if (previous.phase !== "error" && previous.phase !== "done") sound("end");
        lower();
      }
    } else {
      raise();
      setEscape(turnHoldsEscape(state));
      call(`window.pill.show(${JSON.stringify({ ...view, phase: state.phase })})`);
      if (event.type === "wake") {
        loudest = 0;
        sound("wake");
        const at = performance.now();
        void ready.then(() => input.onShown?.(performance.now() - at));
      }
      if (state.phase === "error" && previous.phase !== "error") sound("error");
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
  Electron.ipcMain.on("baton-pill:drag", (event, on: unknown) => {
    if (!mine(event) || window === null || window.isDestroyed()) return;
    if (on !== true) return stopDrag(true);
    stopDrag(false);
    const start = Electron.screen.getCursorScreenPoint();
    const from = window.getBounds();
    const target = window;
    openMarkers(Electron.screen.getDisplayMatching(from));
    dragTimer = setInterval(() => {
      if (target.isDestroyed()) return stopDrag(false);
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
