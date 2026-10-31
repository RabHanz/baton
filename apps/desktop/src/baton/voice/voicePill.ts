// @effect-diagnostics globalTimers:off
/**
 * The pill: a small cue at the top of the active display, up only while a turn is live. It never
 * takes focus or the mouse, stays out of screenshots, and its two sounds are made inside the page,
 * so there are no files and no extra process.
 */
import * as Electron from "electron";

import {
  IDLE_TURN,
  TURN_ERROR_MS,
  TURN_LIMIT_MS,
  reduceTurn,
  turnView,
  type TurnEvent,
  type TurnState,
} from "./voiceTurn.ts";

const WIDTH = 300;
const HEIGHT = 64;
const TOP = 14;
const LEVEL_MS = 80;
/** The closing chime plays out before the window goes. */
const CLOSE_MS = 260;

// Quiet sine tones well above speech energy: the mix is -34 dBFS, and test/voice-pill measured the
// wake models and Silero on them through the real pipeline.
export const PILL_DOCUMENT = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;background:transparent;overflow:hidden;font:13px "Segoe UI",system-ui,sans-serif;-webkit-user-select:none;user-select:none}
#p{box-sizing:border-box;display:flex;align-items:center;gap:9px;width:max-content;max-width:${WIDTH - 12}px;margin:6px auto;padding:7px 14px;border-radius:999px;background:rgba(17,17,20,.92);color:#f4f4f5;box-shadow:0 4px 14px rgba(0,0,0,.35);opacity:0;transform:translateY(-4px);transition:opacity .12s,transform .12s}
#p.on{opacity:1;transform:none}
#d{width:9px;height:9px;border-radius:50%;flex:none}
#b{width:30px;height:4px;border-radius:2px;background:#3f3f46;overflow:hidden;flex:none}
#l{height:100%;width:0;background:#22c55e;transition:width 70ms linear}
#t{font-weight:600;white-space:nowrap}
#c{color:#d4d4d8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.pulse{animation:q 1.1s ease-in-out infinite}
@keyframes q{50%{opacity:.4}}
@media (prefers-reduced-motion:reduce){#p,#l{transition:none}.pulse{animation:none}}
</style></head><body><div id="p" role="status" aria-live="polite"><span id="d"></span><span id="b"><span id="l" style="display:block"></span></span><span id="t"></span><span id="c"></span></div>
<script>
const $=i=>document.getElementById(i);let ctx=null;
const tone=(f,at,len)=>{ctx??=new AudioContext();const o=ctx.createOscillator(),g=ctx.createGain(),t=ctx.currentTime+at;o.type='sine';o.frequency.value=f;g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(.02,t+.015);g.gain.exponentialRampToValueAtTime(.0005,t+len);o.connect(g).connect(ctx.destination);o.start(t);o.stop(t+len+.02);};
window.pill={
 show(v){$('d').style.background=v.color;$('d').className=v.pulse?'pulse':'';$('t').textContent=v.label;$('c').textContent=v.caption||'';$('b').style.display=v.level?'block':'none';if(!v.level)$('l').style.width='0';$('p').className='on';},
 level(n){$('l').style.width=Math.round(n*100)+'%';},
 hide(){$('p').className='';},
 wake(){tone(1320,0,.09);tone(1760,.07,.11);},
 end(){tone(1320,0,.09);tone(990,.07,.13);},
};
</script></body></html>`;

export interface VoicePill {
  readonly on: (event: TurnEvent) => void;
  readonly level: (value: number) => void;
  readonly state: () => TurnState;
  readonly dispose: () => void;
}

export const createVoicePill = (input: {
  readonly sounds: () => boolean;
  readonly onChange?: (state: TurnState) => void;
  /** Esc while it is up. */
  readonly onDismiss: () => void;
}): VoicePill => {
  let state: TurnState = IDLE_TURN;
  let window: Electron.BrowserWindow | null = null;
  let ready: Promise<void> = Promise.resolve();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastLevel = 0;
  let esc = false;

  const call = (code: string) => {
    const target = window;
    void ready.then(() => {
      if (target !== null && !target.isDestroyed()) {
        void target.webContents.executeJavaScript(code).catch(() => undefined);
      }
    });
  };

  const open = () => {
    if (window !== null && !window.isDestroyed()) return;
    const area = Electron.screen.getDisplayNearestPoint(
      Electron.screen.getCursorScreenPoint(),
    ).workArea;
    const created = new Electron.BrowserWindow({
      width: WIDTH,
      height: HEIGHT,
      x: Math.round(area.x + (area.width - WIDTH) / 2),
      y: area.y + TOP,
      frame: false,
      transparent: true,
      resizable: false,
      focusable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      show: false,
      webPreferences: { autoplayPolicy: "no-user-gesture-required" },
    });
    created.setAlwaysOnTop(true, "screen-saver");
    created.setIgnoreMouseEvents(true);
    created.setContentProtection(true);
    window = created;
    ready = created
      .loadURL(`data:text/html,${encodeURIComponent(PILL_DOCUMENT)}`)
      .then(() => created.showInactive());
  };

  const close = () => {
    const closing = window;
    window = null;
    if (closing === null || closing.isDestroyed()) return;
    void closing.webContents
      .executeJavaScript(`window.pill.hide();${input.sounds() ? "window.pill.end();" : ""}`)
      .catch(() => undefined);
    // Destroyed, not hidden: a window left open stops "last window closed" quitting the app.
    setTimeout(() => {
      if (!closing.isDestroyed()) closing.destroy();
    }, CLOSE_MS);
  };

  const setEsc = (next: boolean) => {
    if (next === esc) return;
    esc = next;
    if (next) Electron.globalShortcut.register("Escape", input.onDismiss);
    else Electron.globalShortcut.unregister("Escape");
  };

  const on = (event: TurnEvent) => {
    const previous = state;
    state = reduceTurn(state, event);
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (state.phase === "idle") {
      setEsc(false);
      close();
    } else {
      open();
      setEsc(true);
      const view = turnView(state.phase);
      call(
        `window.pill.show(${JSON.stringify({
          ...view,
          caption: state.caption,
          level: state.phase === "listening",
          pulse: state.phase === "listening" || state.phase === "thinking",
        })})`,
      );
      if (event.type === "wake" && input.sounds()) call("window.pill.wake()");
      timer = setTimeout(
        () => on({ type: "dismissed" }),
        state.phase === "error" ? TURN_ERROR_MS : TURN_LIMIT_MS,
      );
    }
    if (previous !== state) input.onChange?.(state);
  };

  return {
    on,
    level: (value) => {
      if (state.phase !== "listening") return;
      const now = performance.now();
      if (now - lastLevel < LEVEL_MS) return;
      lastLevel = now;
      call(`window.pill.level(${value.toFixed(2)})`);
    },
    state: () => state,
    dispose: () => {
      if (timer !== null) clearTimeout(timer);
      setEsc(false);
      if (window !== null && !window.isDestroyed()) window.destroy();
      window = null;
    },
  };
};
