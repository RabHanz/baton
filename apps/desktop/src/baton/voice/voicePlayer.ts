// @effect-diagnostics globalTimers:off
/**
 * Baton's speech out of a hidden page, so playback is one code path on Windows, macOS and Linux and
 * there is no process per sentence. The page goes after a short idle, so it never keeps the app
 * alive. Its level comes from the WAV itself, which gives the pill the voice's real envelope.
 */
import * as Electron from "electron";

import { wavEnvelope, ENVELOPE_MS } from "./voiceSpeaker.ts";
import type { VoicePlayer } from "./voiceSpeaker.ts";

const IDLE_CLOSE_MS = 30_000;

const PLAYER_DOCUMENT = `<!doctype html><meta charset="utf-8"><script>
let ctx=null,src=null,done=null;
window.play=async(b64)=>{ctx??=new AudioContext();if(ctx.state==='suspended')await ctx.resume();
 const bin=atob(b64),bytes=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);
 const buf=await ctx.decodeAudioData(bytes.buffer);
 await new Promise(r=>{src=ctx.createBufferSource();src.buffer=buf;src.connect(ctx.destination);done=r;src.onended=()=>r();src.start();});
 src=null;done=null;};
window.halt=()=>{try{src&&src.stop()}catch{}done&&done();};
</script>`;

export const createVoicePlayer = (onLevel: (level: number) => void): VoicePlayer => {
  let win: Electron.BrowserWindow | null = null;
  let ready: Promise<void> = Promise.resolve();
  let idle: ReturnType<typeof setTimeout> | null = null;

  const close = () => {
    if (win !== null && !win.isDestroyed()) win.destroy();
    win = null;
  };
  const open = () => {
    if (idle !== null) clearTimeout(idle);
    idle = null;
    if (win !== null && !win.isDestroyed()) return win;
    const created = new Electron.BrowserWindow({
      show: false,
      focusable: false,
      skipTaskbar: true,
      webPreferences: { autoplayPolicy: "no-user-gesture-required", backgroundThrottling: false },
    });
    win = created;
    ready = created.loadURL(`data:text/html,${encodeURIComponent(PLAYER_DOCUMENT)}`);
    return created;
  };

  return {
    play: async (wav) => {
      const target = open();
      await ready;
      const envelope = wavEnvelope(wav);
      const started = performance.now();
      const pulse = setInterval(() => {
        const at = Math.floor((performance.now() - started) / ENVELOPE_MS);
        onLevel(envelope[at] ?? 0);
      }, ENVELOPE_MS);
      try {
        if (!target.isDestroyed()) {
          await target.webContents.executeJavaScript(`window.play("${wav.toString("base64")}")`);
        }
      } finally {
        clearInterval(pulse);
        onLevel(0);
        idle = setTimeout(close, IDLE_CLOSE_MS);
      }
    },
    stop: () => {
      if (win !== null && !win.isDestroyed()) {
        void win.webContents.executeJavaScript("window.halt()").catch(() => undefined);
      }
    },
    dispose: close,
  };
};
