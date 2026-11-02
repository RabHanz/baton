// @effect-diagnostics globalDate:off globalRandom:off globalTimers:off nodeBuiltinImport:off globalConsole:off
/**
 * Clicks every control of the real Home window on a Windows desktop, with the real mouse (SendInput through the input
 * driver), and records whether each one did something visible: the sidebar items, the header controls, and the tabs of
 * every settings dialog they open. The rectangles come from the page; the click is the system's, so the window's drag
 * regions and hit-testing are exercised, which a fake DOM cannot do. Writes results.md (a table) and a recording.
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import * as Electron from "electron";

import { createBatonHome } from "../../home/batonHome.ts";
import { STATES } from "../../home/pageStates.ts";
import { createInputDriver } from "../inputDriver.ts";

const out = process.env["PROOF_OUT"] ?? NodePath.join(process.cwd(), "home-click-out");
NodeFS.mkdirSync(out, { recursive: true });
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

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

setTimeout(() => Electron.app.exit(3), 15 * 60_000).unref();

interface Row {
  readonly group: string;
  readonly control: string;
  readonly result: "ok" | "no effect" | "not found" | "off screen";
  readonly effect: string;
}

void Electron.app.whenReady().then(async () => {
  const driver = createInputDriver({
    platform: "win32",
    toPhysical: (p) => Electron.screen.dipToScreenPoint(p),
    clipboard: Electron.clipboard,
  });
  const base = STATES["empty"]!;
  const state = {
    status: { label: "Listening", tone: "good", device: "", mark: "", brandMark: "" },
    controls: base.controls,
    ...(base.extra === undefined ? {} : { extra: base.extra }),
  };
  createBatonHome({
    stateDir: out,
    state: () => state as never,
    apply: () => undefined,
    openSessions: () => undefined,
    appearance: () => "dark",
  }).open();
  await sleep(4000);
  const win = Electron.BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
  if (win === undefined) throw new Error("the Home window did not open");
  win.setBounds({ x: 0, y: 0, width: 1024, height: 740 });
  win.show();
  win.focus();
  await sleep(1500);
  const js = (code: string) => win.webContents.executeJavaScript(code) as Promise<unknown>;
  await js(
    "window.__mut=0;new MutationObserver(m=>{window.__mut+=m.length}).observe(document.body,{subtree:true,childList:true,attributes:true,characterData:true});0",
  );
  const sig = () =>
    js(
      "JSON.stringify([typeof cur==='undefined'?'':cur, typeof modal==='undefined'?'':modal, (document.getElementById('page')||{}).innerText?.length, !!document.getElementById('modal'), document.activeElement&&document.activeElement.tagName+':'+document.activeElement.id, window.__mut])",
    ) as Promise<string>;
  interface Found {
    name: string;
    x: number;
    y: number;
    ok: boolean;
  }
  const find = (selector: string) =>
    js(
      `[...document.querySelectorAll(${JSON.stringify(selector)})].map(e=>{const r=e.getBoundingClientRect();const name=(e.getAttribute('aria-label')||e.textContent||e.id||e.tagName).trim().slice(0,32);return {name,x:r.x+r.width/2,y:r.y+r.height/2,ok:r.width>2&&r.height>2&&r.x>=0&&r.y>=0&&r.x<innerWidth&&r.y<innerHeight}})`,
    ) as Promise<Found[]>;
  const rows: Row[] = [];
  const press = async (group: string, c: Found) => {
    if (!c.ok) return rows.push({ group, control: c.name, result: "off screen", effect: "" });
    const before = await sig();
    const bounds = win.getContentBounds();
    await driver.clickAt({ x: bounds.x + c.x, y: bounds.y + c.y }, "left", 1);
    await sleep(900);
    const after = await sig();
    rows.push({
      group,
      control: c.name,
      result: before === after ? "no effect" : "ok",
      effect: before === after ? "" : "page changed",
    });
  };

  const stopClip = startClip("home-click");
  const began = Date.now();
  await sleep(1500);

  // The sidebar: each item opens its page.
  for (const c of await find("#side button, #side a")) await press("sidebar", c);
  await js("go('home')");
  await sleep(500);

  // The header: each control does something; one that opens a dialog gets every dialog tab clicked, then is closed.
  const header = await find("#top button, #top a, #top input, #top select");
  for (let i = 0; i < header.length; i += 1) {
    const c = (await find("#top button, #top a, #top input, #top select"))[i];
    if (c === undefined) {
      rows.push({ group: "header", control: header[i]!.name, result: "not found", effect: "" });
      continue;
    }
    await press("header", c);
    if (await js("!!document.getElementById('modal')")) {
      for (const tab of await find("#mnav button")) await press("dialog tab", tab);
      await js("closeModal()");
      await sleep(500);
    }
    await js("go('home')");
    await sleep(300);
  }
  // The dialogs that no header control opens in this state.
  for (const m of ["general", "system", "keys", "account", "updates", "about"]) {
    await js(`modal=${JSON.stringify(m)};render();0`);
    await sleep(500);
    for (const tab of await find("#mnav button")) await press(`dialog ${m}`, tab);
    await js("closeModal()");
    await sleep(300);
  }
  const seconds = (Date.now() - began) / 1000;
  await stopClip(seconds);

  const dead = rows.filter((r) => r.result !== "ok");
  NodeFS.writeFileSync(NodePath.join(out, "results.json"), JSON.stringify(rows, null, 2));
  NodeFS.writeFileSync(
    NodePath.join(out, "results.md"),
    [
      `### Home click-through: ${rows.length} controls, ${rows.length - dead.length} with a visible effect`,
      "| group | control | result | effect |",
      "| --- | --- | --- | --- |",
      ...rows.map(
        (r) => `| ${r.group} | ${r.control.replaceAll("|", "/")} | ${r.result} | ${r.effect} |`,
      ),
    ].join("\n"),
  );
  console.log(`controls ${rows.length}, without effect ${dead.length}`);
  Electron.app.exit(0);
});
