// D94 proof, read-only: the Claude tiles at three widths, across every environment passed, the tile's
// switch rows, and Open in split plus Alt+click. It never presses Switch.
//   node limits-tiles-proof.mjs <frame-dir> <base-url> <pair-url-file> [<extra-pair-url-file>...]
// Playwright from $PLAYWRIGHT_DIR. The first pair URL signs in; each extra one is added as an
// environment through Settings > Connections.
import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";

const require = NodeModule.createRequire(`${process.env.PLAYWRIGHT_DIR}/`);
const { chromium } = require("playwright");
const [frames, base, pairFile, ...extraPairs] = process.argv.slice(2);
const read = (file) => NodeFS.readFileSync(file, "utf8").trim();
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(String(error).slice(0, 200)));

await page.goto(read(pairFile), { waitUntil: "domcontentloaded" });
await page.waitForURL((url) => url.pathname !== "/pair", { timeout: 120_000 });
await page.waitForTimeout(5_000);
await page.screenshot({ path: `${frames}/after-pair.png` });
console.log("after pair:", page.url().replace(/#.*/, ""));

for (const file of extraPairs) {
  await page.goto(`${base}/settings/connections`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Add environment" }).first().click({ timeout: 30_000 });
  await page.waitForTimeout(800);
  await page.getByPlaceholder("backend.example.com").fill(read(file));
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "Add environment" }).last().click();
  await page.waitForTimeout(12_000);
}
await page.goto(`${base}/settings/connections`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(5_000);
await page.screenshot({ path: `${frames}/connections.png` });

const claude = page
  .locator("section")
  .filter({ hasText: /^Claude/ })
  .first();
const openUsage = async () => {
  await page.goto(`${base}/usage`, { waitUntil: "domcontentloaded" });
  await claude.waitFor({ timeout: 60_000 });
  await page.waitForTimeout(8_000);
};
await openUsage();

await page.setViewportSize({ width: 1440, height: 900 });
await page.waitForTimeout(1_000);
const tiles = claude.locator("button[aria-label*='% left']");
console.log("tiles:", await tiles.count());
for (let index = 0; index < (await tiles.count()) / 2; index += 1) {
  await tiles.nth(index).hover();
  await page.waitForTimeout(1_500);
  const dialog = page.getByRole("dialog").first();
  const text = (await dialog.count()) ? await dialog.innerText() : "no popover";
  console.log(`popover ${index}:`, text.replace(/\n+/g, " | "));
  await page.screenshot({ path: `${frames}/popover-${index}.png` });
  await page.mouse.move(5, 5);
  await page.waitForTimeout(600);
}

await page.goto(base, { waitUntil: "domcontentloaded" });
const rows = page.locator("li[data-thread-item]");
await rows.first().waitFor({ timeout: 60_000 });
await rows.nth(0).click();
await page.waitForTimeout(4_000);
await rows.nth(1).click({ button: "right" });
await page.waitForTimeout(800);
const split = page.getByRole("menuitem", { name: "Open in split" });
console.log("Open in split in menu:", await split.count());
await page.screenshot({ path: `${frames}/split-menu.png` });
await split.click();
await page.waitForTimeout(5_000);
await page.screenshot({ path: `${frames}/split-open.png` });
const panes = () => page.locator('[data-testid^="baton-pane-"][data-focused]').count();
console.log("panes after Open in split:", await panes());
await rows.nth(2).click({ modifiers: ["Alt"] });
await page.waitForTimeout(5_000);
await page.screenshot({ path: `${frames}/split-alt-click.png` });
console.log("panes after Alt+click:", await panes());
await openUsage();
for (const [name, width, height] of [
  ["1440", 1440, 900],
  ["2560", 2560, 1440],
  ["1775", 1775, 900],
]) {
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(1_500);
  await page.screenshot({ path: `${frames}/tiles-${name}.png` });
  console.log(name, (await claude.innerText()).replace(/\n+/g, " | "));
}
console.log("page errors:", errors.length ? errors : "none");
await browser.close();
