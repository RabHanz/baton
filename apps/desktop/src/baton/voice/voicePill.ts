// @effect-diagnostics globalTimers:off
/**
 * The pill: small dark glass above the taskbar of the active display, up only while something is
 * happening (D112). It never takes focus or the mouse and stays out of screenshots. The bars read a
 * live level, his voice or Baton's; the sounds are made in the page from pillSounds.ts. The window
 * is built ahead and hidden so a wake shows at once, and goes as soon as it would be the last one
 * open, because a window left open stops "last window closed" quitting the app.
 */
import * as Electron from "electron";

import { COMPANION_CSS } from "../screen/companionStyle.ts";
import { PILL_PARTIAL, PILL_SOUNDS, type PillSound } from "./pillSounds.ts";
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
const LEVEL_MS = 40;
/** Below this the microphone is dead rather than quiet. */
const DEAD_LEVEL = 0.03;
/** The closing sound plays out before the window hides. */
const CLOSE_MS = 280;

export const PILL_DOCUMENT = `<!doctype html><html><head><meta charset="utf-8"><style>${COMPANION_CSS}
html,body{height:100%;overflow:hidden;font-size:13px}
body{display:flex;align-items:center;justify-content:center}
#p{box-sizing:border-box;display:flex;align-items:center;gap:9px;height:34px;max-width:${WIDTH - 16}px;padding:0 14px;border-radius:999px;opacity:0;transform:translateY(5px) scale(.96);transition:opacity .14s,transform .2s cubic-bezier(.2,.9,.3,1.2),border-color .2s}
#p.on{opacity:1;transform:none}
#p.rest{height:9px;width:44px;padding:0;background:rgba(0,0,0,.5);border-color:rgba(255,255,255,.5)}
#p.rest>*{display:none}
#w{display:flex;align-items:center;gap:2px;height:20px;flex:none}
#w i{display:block;width:2.5px;height:2.5px;border-radius:2px;background:var(--bar,#fff)}
#t{font-weight:600;white-space:nowrap}
#c{color:var(--soft);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
#c:empty{display:none}
#p[data-tone=voice]{--bar:var(--blue-soft)}
#p[data-tone=write]{--bar:var(--green)}
#p[data-tone=good]{--bar:var(--green)}
#p[data-tone=off]{--bar:var(--red);--soft:#ffb3b3}
#p[data-tone=warn]{--bar:var(--amber);border-color:var(--amber);border-width:1.5px}
@media (prefers-reduced-motion:reduce){#p{transition:none}}
</style></head><body><div id="p" class="glass" role="status" aria-live="polite"><span id="w"></span><span id="t"></span><span id="c"></span></div>
<script>
const $=i=>document.getElementById(i),BARS=10,SOUNDS=${JSON.stringify(PILL_SOUNDS)},PARTIAL=${PILL_PARTIAL};
const calm=matchMedia('(prefers-reduced-motion:reduce)').matches;
const bars=Array.from({length:BARS},()=>{const b=document.createElement('i');$('w').appendChild(b);return b;});
const shape=bars.map((_,i)=>{const h=Math.abs((BARS-1)/2-i);return Math.max(.2,1-h*h/26);});
let ctx=null,mode='flat',want=0,level=0,loop=0;
const note=(n,start)=>{for(const[f,g]of[[n.hz,n.gain],[n.hz*2,n.gain*PARTIAL]]){const o=ctx.createOscillator(),a=ctx.createGain(),t=start+n.at;o.type='sine';o.frequency.value=f;a.gain.setValueAtTime(0,t);a.gain.linearRampToValueAtTime(g,t+.004);a.gain.exponentialRampToValueAtTime(g*.002,t+n.len);o.connect(a).connect(ctx.destination);o.start(t);o.stop(t+n.len+.02);}};
const draw=(now)=>{level+=(want-level)*(want>level?.5:.16);const t=now/1000;
 bars.forEach((b,i)=>{let h=2.5;
  if(mode==='live')h+=15.5*shape[i]*level*(calm?1:.68+.32*Math.sin(t*8.5-i*.95));
  else if(mode==='sweep'&&!calm)h+=7*Math.max(0,Math.sin(t*4.6-i*.72))**2;
  b.style.height=h.toFixed(1)+'px';});
 loop=requestAnimationFrame(draw);};
window.pill={
 show(v){$('t').textContent=v.label;$('c').textContent=v.caption||'';const p=$('p');p.dataset.tone=v.tone;p.className='glass on';mode=v.wave;if(v.wave!=='live')want=0;cancelAnimationFrame(loop);loop=requestAnimationFrame(draw);},
 rest(){const p=$('p');p.className='glass on rest';delete p.dataset.tone;cancelAnimationFrame(loop);},
 level(n){want=Math.min(1,n);},
 hide(){$('p').className='glass';cancelAnimationFrame(loop);},
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
      setEscape(turnHoldsEscape(state.phase));
      call(`window.pill.show(${JSON.stringify(view)})`);
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
      timer = setTimeout(() => on({ type: "dismissed" }), turnLimitMs(state.phase));
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
