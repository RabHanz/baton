// @effect-diagnostics globalTimers:off
/**
 * Baton's speech out of a hidden page, so playback is one code path everywhere and there is no
 * process per sentence. Samples are scheduled as they arrive, a little ahead so a slow chunk does
 * not click, and the pill's level is read from the same samples at the moment they sound. The page
 * goes after a short idle, so it never keeps the app alive.
 */
import * as Electron from "electron";

import { pcmLevel, wavFormat, type VoicePlayer } from "./voiceSpeaker.ts";

const IDLE_CLOSE_MS = 30_000;
const HEADER_BYTES = 256;

const PLAYER_DOCUMENT = `<!doctype html><meta charset="utf-8"><script>
let ctx=null,next=0,rate=24000,live=[],done=null;const LEAD=.12;
window.open_=async(r)=>{ctx??=new AudioContext();if(ctx.state==='suspended')await ctx.resume();rate=r;next=ctx.currentTime+LEAD;live=[];done=null;};
window.push=(b64)=>{const bin=atob(b64),n=bin.length>>1,buf=ctx.createBuffer(1,n,rate),o=buf.getChannelData(0);
 for(let i=0;i<n;i++){const v=(bin.charCodeAt(i*2)|bin.charCodeAt(i*2+1)<<8)<<16>>16;o[i]=v/32768;}
 const s=ctx.createBufferSource();s.buffer=buf;s.connect(ctx.destination);if(next<ctx.currentTime+.02)next=ctx.currentTime+.02;
 s.start(next);const at=next;next+=buf.duration;live.push(s);s.onended=()=>{live=live.filter(x=>x!==s);if(!live.length&&done)done();};return Math.max(0,(at-ctx.currentTime)*1000);};
window.finish=()=>new Promise(r=>{if(!live.length)return r();done=r;});
window.halt=()=>{for(const s of live){try{s.onended=null;s.stop();}catch{}}live=[];done&&done();};
</script>`;

export const createVoicePlayer = (onLevel: (level: number) => void): VoicePlayer => {
  let win: Electron.BrowserWindow | null = null;
  let ready: Promise<void> = Promise.resolve();
  let idle: ReturnType<typeof setTimeout> | null = null;
  let stamp = 0;

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
      const mine = ++stamp;
      const target = open();
      await ready;
      const run = (code: string): Promise<number> => target.webContents.executeJavaScript(code);
      let head = Buffer.alloc(0);
      let odd = Buffer.alloc(0);
      let opened = false;
      let bytes = 0;
      const pulses = new Set<ReturnType<typeof setTimeout>>();
      try {
        for await (const chunk of wav) {
          if (mine !== stamp || target.isDestroyed()) return true;
          let pcm = chunk;
          if (!opened) {
            head = Buffer.concat([head, chunk]);
            const format = wavFormat(head);
            if (format === null && head.length < HEADER_BYTES) continue;
            if (format === null) return false;
            await run(`window.open_(${format.rate})`);
            opened = true;
            pcm = head.subarray(format.start);
          }
          const joined = Buffer.concat([odd, pcm]);
          const even = joined.length & ~1;
          odd = joined.subarray(even);
          if (even === 0) continue;
          const samples = joined.subarray(0, even);
          bytes += even;
          const delay = await run(`window.push("${samples.toString("base64")}")`);
          const pulse = setTimeout(() => {
            pulses.delete(pulse);
            onLevel(pcmLevel(samples));
          }, delay);
          pulses.add(pulse);
        }
        if (bytes === 0) return false;
        if (!target.isDestroyed()) await run("window.finish()");
        return true;
      } finally {
        for (const pulse of pulses) clearTimeout(pulse);
        onLevel(0);
        idle = setTimeout(close, IDLE_CLOSE_MS);
      }
    },
    stop: () => {
      stamp += 1;
      if (win !== null && !win.isDestroyed()) {
        void win.webContents.executeJavaScript("window.halt()").catch(() => undefined);
      }
    },
    dispose: close,
  };
};
