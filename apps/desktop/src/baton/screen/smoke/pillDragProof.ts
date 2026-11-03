// @effect-diagnostics globalDate:off globalRandom:off globalTimers:off nodeBuiltinImport:off globalConsole:off
/**
 * Drags the real pill window with the real mouse (SendInput through the input driver): press on the capsule, move in
 * steps, release. The window must end up where the pointer left it, and a second pill built over the same state
 * folder (a restart) must come up in that place. Records the desktop and writes results.md.
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as Electron from "electron";

import { createInputDriver } from "../inputDriver.ts";
import { createVoicePill } from "../../voice/voicePill.ts";

const out = process.env["PROOF_OUT"] ?? NodePath.join(process.cwd(), "pill-drag-out");
NodeFS.mkdirSync(out, { recursive: true });
const progress = (m: string) => NodeFS.appendFileSync(NodePath.join(out, "progress.log"), `${new Date().toISOString()} ${m}\n`);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
setTimeout(() => (progress("timed out"), Electron.app.exit(3)), 4 * 60_000).unref();

const clip = NodeChildProcess.spawn(
  "ffmpeg",
  ["-y", "-f", "gdigrab", "-framerate", "15", "-i", "desktop", "-vf", "scale=-2:720", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "26", "-pix_fmt", "yuv420p", NodePath.join(out, "drag.mp4")],
  { stdio: ["pipe", "ignore", "ignore"], windowsHide: true },
);
clip.on("error", () => undefined);
clip.stdin.on("error", () => undefined);
const stopClip = () =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(() => (clip.kill(), resolve()), 15_000);
    clip.on("exit", () => (clearTimeout(timer), resolve()));
    clip.stdin.write("q");
  });

const stateDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "pill-drag-"));
const makePill = () =>
  createVoicePill({
    cueGain: () => 0,
    rest: () => false,
    edge: () => "bottom",
    captureDir: out,
    stateDir,
    holdEscape: () => () => undefined,
    onDismiss: () => undefined,
    onDrag: (o) => progress(`drag outcome ${JSON.stringify(o)}`),
  });

const pillWindow = async () => {
  for (const win of Electron.BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    const isPill = await win.webContents.executeJavaScript("typeof window.pill==='object'").catch(() => false);
    if (isPill === true) return win;
  }
  throw new Error("the pill window is not there");
};
const capsuleCentre = async (win: Electron.BrowserWindow) => {
  const r = (await win.webContents.executeJavaScript(
    "(()=>{const r=document.getElementById('p').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()",
  )) as { x: number; y: number };
  const b = win.getBounds();
  return { x: b.x + r.x, y: b.y + r.y };
};

setInterval(() => progress("beat"), 1000);
void Electron.app.whenReady().then(async () => {
  const driver = createInputDriver({
    platform: "win32",
    toPhysical: (p) => Electron.screen.dipToScreenPoint(p),
    clipboard: Electron.clipboard,
  });
  // The app always has a main window; without one the pill's own close-with-the-last-window rule would end the run.
  const main = new Electron.BrowserWindow({ show: false });
  Electron.app.on("window-all-closed", () => undefined);
  void main;
  const lines: string[] = [];
  let pill = makePill();
  pill.warm();
  await sleep(2500);
  pill.showMove();
  await sleep(1500);
  let win = await pillWindow();
  const before = win.getBounds();
  const from = await capsuleCentre(win);
  const to = { x: from.x - 260, y: from.y - 140 };
  await driver.moveAt(from);
  await sleep(500);
  await driver.pressAt(from);
  await sleep(200);
  for (let i = 1; i <= 24; i += 1) {
    await driver.moveAt({ x: from.x + ((to.x - from.x) * i) / 24, y: from.y + ((to.y - from.y) * i) / 24 });
    await sleep(40);
  }
  await sleep(200);
  await driver.releaseAt(to);
  progress("dragged");
  await sleep(1200);
  progress("slept");
  const after = win.getBounds();
  const moved = Math.hypot(after.x - before.x, after.y - before.y);
  lines.push(`- before ${JSON.stringify(before)}`, `- after the drag ${JSON.stringify(after)}`, `- moved ${Math.round(moved)} px (needs more than 100)`);

  // A restart: the same folder, a new pill.
  progress("before dispose");
  pill.dispose();
  await sleep(800);
  progress("restarted");
  pill = makePill();
  pill.warm();
  await sleep(2500);
  pill.showMove();
  await sleep(1500);
  win = await pillWindow();
  const again = win.getBounds();
  const kept = Math.hypot(again.x - after.x, again.y - after.y);
  lines.push(`- after a restart ${JSON.stringify(again)}, ${Math.round(kept)} px from where it was left (needs under 4)`);
  progress("before stopClip");
  await stopClip();
  const ok = moved > 100 && kept < 4;
  const text = [`### Pill drag with the real mouse: ${ok ? "works and the place is kept" : "FAILED"}`, ...lines].join("\n");
  NodeFS.writeFileSync(NodePath.join(out, "results.md"), text);
  console.log(text);
  Electron.app.exit(ok ? 0 : 1);
});
