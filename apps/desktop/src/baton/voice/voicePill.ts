/* oxlint-disable t3code/no-low-value-comments -- Baton file predating upstream's rule (D82) */
// @effect-diagnostics globalTimers:off
/**
 * The pill: small dark glass above the taskbar of the active display, up only while something is
 * happening (D112). It never takes focus or the mouse and stays out of screenshots. The bars read a
 * live level, his voice or Baton's; the sounds are made in the page from pillSounds.ts. The window
 * is built ahead and hidden so a wake shows at once, and goes as soon as it would be the last one
 * open, because a window left open stops "last window closed" quitting the app.
 */
import * as Electron from "electron";

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
#p.rest{height:9px;width:44px;padding:0;border-radius:6px}
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
window.pill={
 show(v){$('t').textContent=v.label;$('c').textContent=v.caption||'';const p=$('p'),g=$('g');p.dataset.phase=v.phase;p.className='on';
  if(shown!==v.phase){shown=v.phase;g.innerHTML=GLYPHS[v.phase]||'';g.style.transform='';g.classList.remove('swap');void g.offsetWidth;g.classList.add('swap');}
  live=v.wave==='live';if(!live)g.style.transform='';},
 rest(){const p=$('p');p.className='on rest';delete p.dataset.phase;shown='';},
 level(n){if(live&&!calm)$('g').style.transform='scale('+(1+Math.min(1,n)*.16).toFixed(3)+')';},
 hide(){$('p').className='';shown='';},
 sound(name){ctx??=new AudioContext();const t=ctx.currentTime+.01;for(const n of SOUNDS[name])note(n,t);},
};
</script></body></html>`;

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
  readonly setEdge: (edge: "bottom" | "top") => void;
  readonly state: () => TurnState;
  readonly dispose: () => void;
}

export const createVoicePill = (input: {
  readonly sounds: () => boolean;
  readonly rest: () => boolean;
  readonly edge: () => "bottom" | "top";
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
      webPreferences: { autoplayPolicy: "no-user-gesture-required", backgroundThrottling: false },
    });
    created.setAlwaysOnTop(true, "screen-saver");
    markCompanionWindow(created);
    created.setIgnoreMouseEvents(true);
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
    const area = Electron.screen.getDisplayNearestPoint(
      Electron.screen.getCursorScreenPoint(),
    ).workArea;
    void ready.then(() => {
      if (target === null || target.isDestroyed() || target.isVisible()) return;
      target.setBounds({
        x: Math.round(area.x + (area.width - WIDTH) / 2),
        y:
          input.edge() === "top"
            ? area.y + TOP_MARGIN
            : area.y + area.height - HEIGHT - ABOVE_WORK_AREA,
        width: WIDTH,
        height: HEIGHT,
      });
      target.showInactive();
    });
  };

  const lower = () => {
    if (window === null || window.isDestroyed()) return;
    if (input.rest()) {
      raise();
      call("window.pill.rest()");
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
        call("window.pill.rest()");
      } else lower();
    },
    setEdge: () => {
      if (window !== null && !window.isDestroyed()) window.hide();
      if (input.rest() && state.phase === "idle") {
        raise();
        call("window.pill.rest()");
      }
    },
    state: () => state,
    dispose: () => {
      if (timer !== null) clearTimeout(timer);
      if (silentTimer !== null) clearTimeout(silentTimer);
      Electron.app.removeListener("browser-window-created", follow);
      setEscape(false);
      if (window !== null && !window.isDestroyed()) window.destroy();
      window = null;
    },
  };
};
