// @effect-diagnostics globalDate:off globalRandom:off globalTimers:off nodeBuiltinImport:off globalConsole:off
/**
 * The sessions browser in the real Home window on a Windows desktop, driven with the real mouse: search, a one-tap Resume
 * on a stopped session ("Resuming..." then running), and New session in a folder on a machine. Each step is asserted from the
 * page; the run is recorded. The catalog is the mock service until the server's catalog is connected.
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import * as Electron from "electron";

import { createBatonHome } from "../../home/batonHome.ts";
import { createCatalog, mockCatalogService } from "../../sessions/catalogRows.ts";
import { createInputDriver } from "../inputDriver.ts";

const out = process.env["PROOF_OUT"] ?? NodePath.join(process.cwd(), "sessions-proof-out");
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

interface Step {
  readonly step: string;
  readonly ok: boolean;
  readonly detail: string;
}

void Electron.app.whenReady().then(async () => {
  const driver = createInputDriver({
    platform: "win32",
    toPhysical: (p) => Electron.screen.dipToScreenPoint(p),
    clipboard: Electron.clipboard,
  });
  let refresh = () => undefined as void;
  const catalog = createCatalog({ service: mockCatalogService(), onChange: () => refresh() });
  await catalog.refresh();
  const home = createBatonHome({
    stateDir: out,
    state: () =>
      ({
        status: { label: "Listening", tone: "good", device: "", mark: "", brandMark: "" },
        controls: catalog.controls().map((c) => ({ ...c, tab: "sessions" })),
      }) as never,
    apply: (id, value) => void catalog.apply(id, value),
    openSessions: () => undefined,
    appearance: () => "dark",
  });
  refresh = () => home.refresh();
  home.open();
  await sleep(4000);
  const win = Electron.BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
  if (win === undefined) throw new Error("the Home window did not open");
  win.setBounds({ x: 0, y: 0, width: 1024, height: 740 });
  win.show();
  win.focus();
  const js = (code: string) => win.webContents.executeJavaScript(code) as Promise<unknown>;
  await js("go('sessions');0");
  await sleep(1500);
  const text = () => js("document.getElementById('page').innerText") as Promise<string>;
  const click = async (selector: string, nth = 0) => {
    const at = (await js(
      `(()=>{const e=[...document.querySelectorAll(${JSON.stringify(selector)})][${nth}];if(!e)return null;e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`,
    )) as { x: number; y: number } | null;
    if (at === null) return false;
    const b = win.getContentBounds();
    await driver.clickAt({ x: b.x + at.x, y: b.y + at.y }, "left", 1);
    await sleep(600);
    return true;
  };
  const steps: Step[] = [];
  const check = (step: string, ok: boolean, detail = "") => steps.push({ step, ok, detail });

  const stopClip = startClip("sessions");
  const began = Date.now();
  await sleep(1500);

  check(
    "the browser lists sessions from two machines",
    /Laptop/.test(await text()) && /Build server/.test(await text()),
  );
  // Search, typed with the real keyboard.
  await click("#in-c-q");
  await driver.type("digest");
  await sleep(1200);
  const searched = await text();
  check(
    "search narrows to the digest session",
    /weekly digest/.test(searched) && !/launch post/.test(searched),
  );
  await click("#in-c-q");
  await driver.press(["ctrl", "a"]);
  await driver.press(["backspace"]);
  await sleep(1200);
  // Resume the stopped session.
  await js(
    "window.__seen=[];new MutationObserver(()=>{const t=document.getElementById('page').innerText;if(/Resuming/.test(t))window.__seen.push('resuming')}).observe(document.body,{subtree:true,childList:true,characterData:true});0",
  );
  const resumed = await click("button[aria-label^='Resume Write the launch post']");
  check("Resume is on the stopped session", resumed);
  await sleep(500);
  const during = await text();
  check("the row says Resuming... meanwhile", /Resuming/.test(during), during.slice(0, 0));
  await sleep(2500);
  const after = await text();
  check(
    "then it is running, with no Resume left on it",
    !/Resume Write the launch post/.test(after) &&
      /Write the launch post[\s\S]{0,120}Running/.test(after),
  );
  // New session in a folder on a machine.
  await click("#page button[aria-expanded]");
  await sleep(800);
  await click("#in-c-folder");
  await driver.type("/srv/new-project");
  await click("#page form.vocab button[type=submit]");
  await sleep(1500);
  check("New session starts a session in that folder", /new-project/.test(await text()));

  const seconds = (Date.now() - began) / 1000;
  await stopClip(seconds);
  NodeFS.writeFileSync(NodePath.join(out, "results.json"), JSON.stringify(steps, null, 2));
  NodeFS.writeFileSync(
    NodePath.join(out, "results.md"),
    [
      "### Sessions browser on Windows",
      "| step | result |",
      "| --- | --- |",
      ...steps.map((r) => `| ${r.step} | ${r.ok ? "pass" : "fail"} |`),
    ].join("\n"),
  );
  console.log(`steps ${steps.length}, failed ${steps.filter((r) => !r.ok).length}`);
  Electron.app.exit(steps.every((r) => r.ok) ? 0 : 1);
});
