/* oxlint-disable t3code/no-low-value-comments -- Baton file predating upstream's rule (D82) */
// Drive a live Baton web client at phone width and prove the sidebar, Send and a Herdr terminal.
//
//   node scripts/baton/live-proof.mjs <pairUrl|state:file.json> <outPrefix> [--send <rowText>=<message>]...
//
// Pair once with `t3 pair --base-dir ~/.t3 --ttl 10m` (write the URL to a file, never a log), then
// reuse the saved `<outPrefix>-state.json` as `state:<file>`. Prints the time the Baton block took
// to appear, which is the "first sidebar load" Phase C measures. Playwright comes from
// $PLAYWRIGHT_DIR (a directory holding node_modules/playwright), since Baton does not depend on it.
import * as NodeModule from "node:module";

const require = NodeModule.createRequire(`${process.env.PLAYWRIGHT_DIR ?? process.cwd()}/`);
const { chromium } = require("playwright");

const [target, out, ...rest] = process.argv.slice(2);
const sends = [];
for (let i = 0; i < rest.length; i++) if (rest[i] === "--send") sends.push(rest[++i]);
const base = process.env.BASE_URL ?? "http://localhost:3773/";
const fromState = target.startsWith("state:");

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  storageState: fromState ? target.slice(6) : undefined,
});
const page = await context.newPage();
const started = Date.now();
await page.goto(fromState ? base : target, { waitUntil: "domcontentloaded" });
const trigger = page.locator('[data-sidebar="trigger"]').first();
const block = page.locator('[data-testid="sidebar-baton-projects"]');
let opened = false;
for (
  let waited = 0;
  waited < 120_000 && !(await block.isVisible().catch(() => false));
  waited += 1000
) {
  // On a phone the sidebar is a sheet: open it once, when the trigger first renders.
  if (!opened && (await trigger.isVisible().catch(() => false))) {
    await trigger.click().catch(() => {});
    opened = true;
  }
  await page.waitForTimeout(1000);
}
const loadMs = Date.now() - started;
await context.storageState({ path: `${out}-state.json` });
if (!(await block.isVisible().catch(() => false))) {
  await page.screenshot({ path: `${out}-timeout.png` });
  console.log(
    `FAIL sidebar block not visible after ${loadMs} ms; testids:`,
    (
      await page
        .locator("[data-testid]")
        .evaluateAll((els) => [...new Set(els.map((e) => e.dataset.testid))])
    )
      .slice(0, 40)
      .join(" "),
  );
  await browser.close();
  process.exit(1);
}
console.log(`sidebar block visible after ${loadMs} ms`);
await block.scrollIntoViewIfNeeded();
await page.screenshot({ path: `${out}-1-list.png` });
const rows = page.locator('[data-testid="sidebar-baton-session"]');
console.log(`rows: ${await rows.count()}`);
for (const spec of sends) {
  const at = spec.indexOf("=");
  // The composer is labelled "Send to <session title>".
  const input = page
    .locator(`[data-testid="sidebar-baton-send-input"][aria-label*="${spec.slice(0, at)}"]`)
    .first();
  await input.fill(spec.slice(at + 1));
  await input.press("Enter");
  await page.getByText("Sent", { exact: true }).first().waitFor({ timeout: 20_000 });
  console.log(`sent to "${spec.slice(0, at)}"`);
}
await page.screenshot({ path: `${out}-2-sent.png` });
if (rest.includes("--terminal")) {
  // Open a thread and its terminal; with T3CODE_FABRIC_TERMINAL_RUNTIME=herdr it is a Herdr session
  // client, which `herdr session list` then shows (D61).
  await page.keyboard.press("Escape");
  // The newest thread in upstream's own list (expand the settled shelf if that is all there is).
  const shelf = page.getByRole("button", { name: /settled/i }).first();
  if (await shelf.isVisible().catch(() => false)) await shelf.click().catch(() => {});
  const thread = page.locator("[data-thread-item]").first();
  await thread.waitFor({ timeout: 60_000 });
  await thread.click();
  await page.waitForTimeout(4000);
  await page.keyboard.press("Control+j");
  await page.waitForTimeout(8000);
  await page.screenshot({ path: `${out}-3-terminal.png` });
  console.log("terminal toggled on", page.url());
}
await browser.close();
