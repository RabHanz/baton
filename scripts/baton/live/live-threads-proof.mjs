/* oxlint-disable t3code/no-low-value-comments -- Baton proof script */
// Prove D83 through T3's own web client: live Claude Code sessions are ordinary threads, and the
// composer reaches them.
//
//   node scripts/baton/live/live-threads-proof.mjs <pairUrlFile> <outPrefix> \
//     [--send "<thread title>=<message>=<expected reply text>"]... [--width 390]
//
// Pairs from a URL kept in a file (never on the command line or in a log), opens the sidebar,
// screenshots it, then for each --send opens that thread, types into the composer, presses Enter,
// and waits for the expected text to appear in the thread. Playwright comes from $PLAYWRIGHT_DIR.
import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";

const require = NodeModule.createRequire(`${process.env.PLAYWRIGHT_DIR ?? process.cwd()}/`);
const { chromium } = require("playwright");

const [pairFile, out, ...rest] = process.argv.slice(2);
const sends = [];
const opens = [];
let width = 390;
for (let i = 0; i < rest.length; i++) {
  if (rest[i] === "--send") sends.push(rest[++i].split("="));
  else if (rest[i] === "--open") opens.push(rest[++i].split("="));
  else if (rest[i] === "--width") width = Number(rest[++i]);
}
const pairUrl = NodeFS.readFileSync(pairFile, "utf8").trim();
const phone = width < 768;

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width, height: phone ? 844 : 900 },
  deviceScaleFactor: 2,
});
const page = await context.newPage();
await page.goto(pairUrl, { waitUntil: "domcontentloaded" });

const openSidebar = async () => {
  if (!phone) return;
  const trigger = page.locator('[data-sidebar="trigger"]').first();
  if (await trigger.isVisible().catch(() => false)) await trigger.click().catch(() => {});
};

// The sidebar is ready when a thread title we expect is in it.
const firstTitle = sends[0]?.[0] ?? opens[0]?.[0];
let ready = false;
for (let waited = 0; waited < 90_000 && !ready; waited += 1000) {
  await openSidebar();
  // The official sidebar folds active threads under "Working" until it is opened.
  const working = page.getByText("Working", { exact: true }).first();
  if (await working.isVisible().catch(() => false)) await working.click().catch(() => {});
  await page.waitForTimeout(500);
  ready = firstTitle
    ? await page
        .getByText(firstTitle, { exact: false })
        .first()
        .isVisible()
        .catch(() => false)
    : true;
  if (!ready) await page.waitForTimeout(1000);
}
await page.screenshot({ path: `${out}-sidebar.png` });
if (!ready) {
  console.log(`FAIL no thread titled "${firstTitle}" in the sidebar`);
  await browser.close();
  process.exit(1);
}

let failed = false;
// --open "<title>=<text>": open the thread and wait for the text (a state, a reply) to show.
for (const [title, expected] of opens) {
  await openSidebar();
  await page.mouse.move(380, 120); // hover shows row actions in place of the status pill
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}-${title}-sidebar.png` });
  await page.locator("li[data-thread-item]", { hasText: title }).first().click();
  let seen = false;
  for (let waited = 0; waited < 120_000 && !seen; waited += 2000) {
    await page.waitForTimeout(2000);
    seen = (await page.getByText(expected, { exact: false }).count()) > 0;
  }
  await page.screenshot({ path: `${out}-${title}-open.png` });
  console.log(`${seen ? "OK" : "FAIL"} ${title}: "${expected}" ${seen ? "shown" : "not shown"}`);
  failed ||= !seen;
}
for (const [title, message, expected] of sends) {
  await openSidebar();
  await page.locator("li[data-thread-item]", { hasText: title }).first().click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}-${title}-opened.png` });
  const composer = page.locator('[data-testid="composer-editor"]').last();
  // On a phone the composer is a compact bar that expands into the editor when tapped.
  if (!(await composer.isVisible().catch(() => false))) {
    await page
      .getByText("Ask anything", { exact: false })
      .first()
      .click()
      .catch(() => {});
  }
  await composer.waitFor({ timeout: 30_000 });
  await composer.click();
  await page.keyboard.type(message);
  await page.screenshot({ path: `${out}-${title}-typed.png` });
  await page.keyboard.press("Enter");
  const started = Date.now();
  let seen = false;
  for (let waited = 0; waited < 240_000 && !seen; waited += 2000) {
    await page.waitForTimeout(2000);
    seen = (await page.getByText(expected, { exact: false }).count()) > 0;
  }
  await page.screenshot({ path: `${out}-${title}-reply.png`, fullPage: false });
  console.log(
    `${seen ? "OK" : "FAIL"} ${title}: "${expected}" ${seen ? "appeared" : "did not appear"} after ${Date.now() - started} ms`,
  );
  failed ||= !seen;
}
await browser.close();
process.exit(failed ? 1 : 0);
