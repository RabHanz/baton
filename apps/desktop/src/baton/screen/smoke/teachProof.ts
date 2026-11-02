// @effect-diagnostics globalDate:off globalRandom:off globalTimers:off nodeBuiltinImport:off globalConsole:off
/**
 * The CI proof of teach and drive (design: docs/baton/research/teach-mode-2026-11-02.md): the real companion and the
 * real overlay on a Windows desktop, a scripted `claude` (scripts/baton/teach-proof/fake-claude.mjs), and Notepad's
 * font size as the task. The harness is the "user": it clicks and types through the real input driver when the card
 * says it is waiting, and presses Go ahead on the real approval card. The desktop is recorded with ffmpeg.
 */
/* oxlint-disable t3code/no-global-process-runtime -- standalone proof harness, no Effect runtime */
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import * as Electron from "electron";

import { createVoicePill } from "../../voice/voicePill.ts";
import { createInputDriver } from "../inputDriver.ts";
import { startScreenCompanion } from "../ScreenCompanion.ts";

const out = process.env["PROOF_OUT"] ?? NodePath.join(process.cwd(), "teach-proof-out");
const fake = process.env["PROOF_FAKE"] ?? "";
const stateDir = NodePath.join(out, "state");
NodeFS.mkdirSync(stateDir, { recursive: true });
// The overlay windows are visible to capture only when this is set (captureProtection.ts).
process.env["BATON_TEST_DIR"] = out;

const shim = NodePath.join(out, "claude.cmd");
NodeFS.writeFileSync(shim, `@echo off\r\nnode "${fake}" %*\r\n`);
NodeFS.writeFileSync(
  NodePath.join(stateDir, "baton-screen.json"),
  JSON.stringify({ captureApproval: "always", claudeBinary: shim, speak: true }),
);

const timeline = NodeFS.createWriteStream(NodePath.join(out, "timeline.jsonl"));
const t0 = Date.now();
const note = (event: string, data: object = {}) =>
  timeline.write(`${JSON.stringify({ t: Date.now() - t0, event, ...data })}\n`);
// One clip per scenario, as the hands loop does (scripts/baton/hands-ci/record.ts): 10 fps, 720p, a six-frame sheet.
const startClip = (id: string) => {
  const file = NodePath.join(out, `${id}.mp4`);
  const child = NodeChildProcess.spawn(
    "ffmpeg",
    [
      "-y",
      "-f",
      "gdigrab",
      "-framerate",
      "10",
      "-i",
      "desktop",
      "-vf",
      "scale=-2:720",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-crf",
      "28",
      "-pix_fmt",
      "yuv420p",
      file,
    ],
    { stdio: ["pipe", "ignore", "ignore"], windowsHide: true },
  );
  child.on("error", () => undefined);
  child.stdin.on("error", () => undefined);
  return async (seconds: number) => {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => (child.kill(), resolve()), 15_000);
      child.on("exit", () => (clearTimeout(timer), resolve()));
      child.on("error", () => resolve());
      child.stdin.write("q");
    });
    await new Promise<void>((resolve) =>
      NodeChildProcess.execFile(
        "ffmpeg",
        [
          "-y",
          "-i",
          file,
          "-vf",
          `fps=${(6 / Math.max(seconds, 1)).toFixed(4)},scale=426:-2,tile=3x2`,
          "-frames:v",
          "1",
          NodePath.join(out, `${id}-sheet.png`),
        ],
        { windowsHide: true, timeout: 60_000 },
        () => resolve(),
      ),
    );
  };
};
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const ps = (script: string) =>
  new Promise<string>((resolve) =>
    NodeChildProcess.execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { windowsHide: true, timeout: 30_000 },
      (_e, stdout) => resolve(String(stdout).trim()),
    ),
  );
const locate = (name: string) =>
  new Promise<{ x: number; y: number } | null>((resolve) =>
    NodeChildProcess.execFile(
      "node",
      [fake, "--locate", name],
      { windowsHide: true, timeout: 30_000 },
      (_e, stdout) => {
        try {
          resolve(JSON.parse(String(stdout).trim()));
        } catch {
          resolve(null);
        }
      },
    ),
  );

/** What the overlay and the pill are showing now. */
const cardKicker = async (): Promise<string> => {
  for (const win of Electron.BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    const kicker = await win.webContents
      .executeJavaScript(
        "(()=>{const c=document.getElementById('card'),k=document.getElementById('k');return c&&c.classList.contains('on')&&k?k.textContent:''})()",
      )
      .catch(() => "");
    if (typeof kicker === "string" && kicker !== "") return kicker;
  }
  return "";
};
const until = async (test: (kicker: string) => boolean, ms: number): Promise<string> => {
  const end = Date.now() + ms;
  let last = "";
  while (Date.now() < end) {
    last = await cardKicker();
    if (test(last)) return last;
    await sleep(250);
  }
  return last;
};

const NOTEPAD = `$p=Start-Process notepad -PassThru;Start-Sleep 2;
Add-Type @'
using System;using System.Runtime.InteropServices;
public class W{[DllImport("user32.dll")]public static extern bool MoveWindow(IntPtr h,int x,int y,int w,int ht,bool r);[DllImport("user32.dll")]public static extern bool SetForegroundWindow(IntPtr h);}
'@
$p.Refresh();[W]::MoveWindow($p.MainWindowHandle,120,90,820,560,$true)|Out-Null;[W]::SetForegroundWindow($p.MainWindowHandle)|Out-Null;$p.Id`;

void Electron.app.whenReady().then(async () => {
  const driver = createInputDriver({
    platform: "win32",
    toPhysical: (p) => Electron.screen.dipToScreenPoint(p),
    clipboard: Electron.clipboard,
  });
  const clickOn = async (name: string) => {
    const at = await locate(name);
    if (at !== null) await driver.clickAt(Electron.screen.screenToDipPoint(at), "left", 1);
    else note("locate.failed", { name });
  };
  const pill = createVoicePill({
    cueGain: () => 0,
    rest: () => false,
    edge: () => "bottom",
    stateDir,
    holdEscape: () => () => undefined,
    onDismiss: () => undefined,
  });
  pill.warm();
  const companion = startScreenCompanion({
    holdEscape: () => () => undefined,
    onActivity: (label, caption) =>
      pill.on({ type: "activity", label, ...(caption === undefined ? {} : { caption }) }),
    stateDir,
    platform: process.platform,
    env: process.env,
    // Speech that takes as long as the real voice, with no sound: 13 characters a second.
    speak: async (text) => {
      note("speak", { text });
      pill.on({ type: "speaking", active: true });
      await sleep(text.length * 77);
      pill.on({ type: "speaking", active: false });
    },
    onNote: (kind, fields) => note(`note.${kind}`, fields),
    onTrace: (fields) => note("trace", fields),
    onCue: (cue) => note("cue", { cue }),
  });

  const results: Record<string, unknown> = {};
  const pid = await ps(NOTEPAD);
  note("notepad", { pid });
  await sleep(1500);
  // Something to look at: a line in the text area, which has the focus.
  await driver.type("Meeting notes: send the quarterly plan to the team on Friday.");
  await sleep(1000);

  // 1. Teach: he does each step when the card says it is waiting for him.
  {
    const stopClip = startClip("teach");
    const began = Date.now();
    await sleep(2500);
    note("scenario", { name: "teach" });
    void companion.said("teach: show me how to change the Notepad font size", { direct: false });
    const steps: string[] = [];
    for (let step = 1; step <= 3; step += 1) {
      const kicker = await until((k) => k.startsWith(`Step ${step}`) && /waiting/.test(k), 60_000);
      steps.push(kicker);
      await sleep(3500);
      if (step === 1) await clickOn("Format");
      else if (step === 2) await clickOn("Font...");
      else {
        await driver.press(["alt", "s"]);
        await driver.type("16");
        await driver.press(["enter"]);
      }
      // The companion should notice by itself; "next" is the fallback and is logged as one.
      const moved = await until((k) => !k.startsWith(`Step ${step} `), 20_000);
      if (moved.startsWith(`Step ${step} `) || moved === "") {
        note("noticed.not", { step });
        void companion.said("next", { direct: false });
      }
    }
    const end = await until((k) => /Finished|Stopped/.test(k), 60_000);
    note("teach.end", { kicker: end });
    await sleep(6000);
    results["teach"] = { steps, end };
    companion.stop();
    await sleep(1500);
    await stopClip((Date.now() - began) / 1000);
  }

  // 2. Drive: the approval card is pressed the way he would, then it works on its own.
  {
    const stopClip = startClip("drive");
    const began = Date.now();
    await sleep(2500);
    note("scenario", { name: "drive" });
    void companion.said("drive: set the Notepad font size to 20", { direct: false });
    let pressed = false;
    for (let i = 0; i < 240 && !pressed; i += 1) {
      await sleep(250);
      for (const win of Electron.BrowserWindow.getAllWindows()) {
        if (win.isDestroyed() || !win.isVisible()) continue;
        const rect = (await win.webContents
          .executeJavaScript(
            "(()=>{const b=document.querySelector('#n button');if(!b)return null;const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,t:b.textContent}})()",
          )
          .catch(() => null)) as { x: number; y: number; t: string } | null;
        if (rect === null) continue;
        note("approval", { button: rect.t });
        await sleep(3500);
        const bounds = win.getBounds();
        await driver.clickAt({ x: bounds.x + rect.x, y: bounds.y + rect.y }, "left", 1);
        pressed = true;
        break;
      }
    }
    const end = await until((k) => /Finished|Stopped/.test(k), 120_000);
    note("drive.end", { kicker: end });
    await sleep(6000);
    results["drive"] = { approvalPressed: pressed, end };
    await stopClip((Date.now() - began) / 1000);
  }

  NodeFS.writeFileSync(NodePath.join(out, "results.json"), JSON.stringify(results, null, 2));
  console.log("results", JSON.stringify(results));
  timeline.end(() => {
    companion.dispose();
    driver.dispose();
    Electron.app.exit(0);
  });
});
