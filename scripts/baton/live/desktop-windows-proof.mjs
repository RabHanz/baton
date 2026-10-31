// Detached windows on the real desktop app (D96): detach, move, quit, relaunch, attach.
//   xvfb-run -a node desktop-windows-proof.mjs <t3Home> <frameDir>     Playwright from $PLAYWRIGHT_DIR
// Run it on a copy of a home, never the live one: it is a second backend.
import * as NodeModule from "node:module";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

const require = NodeModule.createRequire(`${process.env.PLAYWRIGHT_DIR}/`);
const { _electron: electron } = require("playwright");
const [home, frames] = process.argv.slice(2);
const desktop = NodePath.resolve("apps/desktop");
const electronPath = `${desktop}/node_modules/electron/dist/electron`;
const userData = `${home}/electron-user-data`;
const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"} ${name} ${detail}`);
};
const BLUR =
  "li[data-thread-item], [data-timeline-root], [data-chat-header] h2, [data-chat-header] [title] { filter: blur(5px); }";

async function launch() {
  const app = await electron.launch({
    executablePath: electronPath,
    args: [NodePath.join(desktop, "dist-electron/main.cjs"), "--no-sandbox", `--user-data-dir=${userData}`],
    cwd: desktop,
    env: { ...process.env, T3CODE_HOME: home, ELECTRON_RUN_AS_NODE: undefined },
    timeout: 120_000,
  });
  app.process().stderr?.on("data", (data) => {
    const line = String(data);
    if (/error/i.test(line)) console.log("stderr:", line.slice(0, 160));
  });
  return app;
}
async function mainPage(app) {
  for (let waited = 0; waited < 180; waited += 2) {
    for (const page of app.windows()) {
      if ((await page.locator("li[data-thread-item]").count().catch(() => 0)) > 0) return page;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(`no thread list; windows: ${app.windows().map((p) => p.url()).join(" ")}`);
}
const detachedPage = (app) => app.windows().find((page) => page.url().includes("batonWindow="));
const shot = async (page, name) => {
  await page.addStyleTag({ content: BLUR });
  await page.screenshot({ path: `${frames}/${name}.png` });
};

let app = await launch();
let page = await mainPage(app);
await page.waitForTimeout(3000);
const rows = page.locator("li[data-thread-item]");
await rows.nth(0).click();
await page.waitForSelector('[data-testid="baton-pane-a"]', { timeout: 60_000 });
await page.waitForTimeout(1500);
await rows.nth(1).click({ modifiers: ["Alt"] });
await page.waitForTimeout(2500);
await shot(page, "20-desktop-two-panes");

const opened = app.waitForEvent("window", { timeout: 30_000 });
await page.locator('[data-testid="baton-pane-detach-b"]').click();
const child = await opened;
await child.waitForLoadState("domcontentloaded");
await child.waitForTimeout(8000);
console.log("child", child.url().replace(/[0-9a-f-]{20,}/g, "<id>"));
await child.screenshot({ path: `${frames}/child-debug.png` });
await child.waitForSelector('[data-testid="baton-pane-a"]', { timeout: 60_000 });
await child.waitForTimeout(3000);
check("detach opens a second BrowserWindow", app.windows().length >= 2, child.url().slice(0, 60));
check("it has the desktop bridge", await child.evaluate(() => window.desktopBridge !== undefined));
check("it reads threads from the same backend", (await child.locator("li[data-thread-item]").count()) > 0);
const target = { x: 300, y: 120, width: 900, height: 640 };
await app.evaluate(({ BrowserWindow }, { url, bounds }) => {
  const window = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL() === url);
  window.setBounds(bounds);
}, { url: child.url(), bounds: target });
await child.waitForTimeout(1500);
await shot(page, "21-desktop-main-after-detach");
await shot(child, "22-desktop-detached");

await app.close();
const state = JSON.parse(NodeFS.readFileSync(`${userData}/baton-detached-windows.json`, "utf8"));
check("the window is saved", state.length === 1, JSON.stringify(state[0].bounds));

app = await launch();
page = await mainPage(app);
for (let waited = 0; waited < 40 && detachedPage(app) === undefined; waited += 1) {
  await page.waitForTimeout(1000);
}
const restored = detachedPage(app);
check("the window comes back after a restart", restored !== undefined);
if (restored !== undefined) {
  await restored.waitForSelector('[data-testid="baton-pane-a"]', { timeout: 60_000 });
  const bounds = await app.evaluate(({ BrowserWindow }, url) => {
    const window = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL() === url);
    return window.getBounds();
  }, restored.url());
  check(
    "in the place it was left",
    Math.abs(bounds.x - target.x) < 40 && Math.abs(bounds.width - target.width) < 40,
    JSON.stringify(bounds),
  );
  await shot(restored, "23-desktop-restored");
  const closed = restored.waitForEvent("close", { timeout: 15_000 });
  await restored.locator('[data-testid^="baton-pane-attach-"]').first().click();
  await closed;
  await page.waitForTimeout(2500);
  check("attach closes it and the main window holds the thread", (await page.locator("section[data-focused]").count()) === 2);
  await shot(page, "24-desktop-reattached");
  await page.waitForTimeout(800);
  const after = JSON.parse(NodeFS.readFileSync(`${userData}/baton-detached-windows.json`, "utf8"));
  check("a window closed by hand is forgotten", after.length === 0);
}
await app.close();
console.log(`${results.filter(Boolean).length} of ${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
