// Split-pane proof against the throwaway server. Args: <pairUrlFile> <frameDir>
import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";

const require = NodeModule.createRequire(`${process.env.PLAYWRIGHT_DIR}/`);
const { chromium } = require("playwright");
const [pairFile, frames] = process.argv.slice(2);
const pair = NodeFS.readFileSync(pairFile, "utf8").trim();

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text().slice(0, 200));
});
const shot = (name) => page.screenshot({ path: `${frames}/${name}.png` });
const log = (...a) => console.log(...a);
const row = (name) => page.locator("li[data-thread-item]").filter({ hasText: name }).first();
const pane = (id) => page.locator(`[data-testid="baton-pane-${id}"]`);
const composer = (id) => pane(id).locator('[data-testid="composer-editor"]');
const paneIds = () =>
  page
    .locator(
      '[data-testid^="baton-pane-"]:not([data-testid*="close"]):not([data-testid*="divider"])',
    )
    .evaluateAll((els) =>
      els.map((e) => `${e.dataset.testid.at(-1)}${e.dataset.focused === "true" ? "*" : ""}`),
    );

await page.goto(pair, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(6000);
await shot("00-start");
await row("alpha").click({ timeout: 30000 });
await page.waitForSelector('[data-testid="baton-pane-a"]', { timeout: 30000 });
await page.waitForTimeout(1500);
log("after alpha", await paneIds());
await row("bravo").click({ modifiers: ["Alt"] });
await page.waitForTimeout(2500);
log("after alt-click bravo", await paneIds(), page.url().slice(-50));
await shot("01-two-panes-1440");

// Independent composers, both streaming.
const essay = "Write a 250 word plain text story about a lighthouse. No tools.";
await composer("a").click();
await page.keyboard.type(essay);
await page.keyboard.press("Enter");
await page.waitForTimeout(300);
await composer("b").click();
await page.waitForTimeout(400);
log("focus follows click", await paneIds(), page.url().slice(-50));
await page.keyboard.type(essay.replace("lighthouse", "harbour"));
await page.keyboard.press("Enter");
const samples = [];
for (let i = 0; i < 24; i++) {
  await page.waitForTimeout(700);
  samples.push([
    await pane("a").evaluate((e) => e.innerText.length),
    await pane("b").evaluate((e) => e.innerText.length),
  ]);
  if (i === 6) await shot("02-both-streaming-1440");
}
log("a(unfocused) b(focused) text length over time", JSON.stringify(samples));
await shot("03-both-done-1440");

await row("charlie").click({ modifiers: ["Alt"] });
await page.waitForTimeout(1500);
log("three", await paneIds());
await shot("04-three-panes-1440");
await row("delta").click({ modifiers: ["Alt"] });
await page.waitForTimeout(2500);
log("four", await paneIds());
await shot("05-grid-1440");
await page.setViewportSize({ width: 2560, height: 1440 });
await page.waitForTimeout(1500);
await shot("06-grid-2560");
await page.setViewportSize({ width: 1440, height: 900 });
await page.waitForTimeout(800);

// Resize by dragging.
const divider = page.locator('[data-testid="baton-pane-divider-column"]');
const box = await divider.boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + 100);
await page.mouse.down();
await page.mouse.move(box.x - 180, box.y + 100, { steps: 6 });
await page.mouse.up();
await page.waitForTimeout(400);
log("divider value", await divider.getAttribute("aria-valuenow"));
await shot("07-resized-1440");

// Close loses nothing: a draft in pane c survives closing it and reopening the thread.
await composer("c").click();
await page.keyboard.type("draft that must survive");
await page.waitForTimeout(800);
await page.locator('[data-testid="baton-pane-close-c"]').click();
await page.waitForTimeout(1000);
log("closed c (was focused)", await paneIds(), page.url().slice(-50));
await shot("08-closed-one-1440");
await row("charlie").click({ modifiers: ["Alt"] });
await page.waitForTimeout(1500);
const reopened = (await paneIds())
  .map((p) => p[0])
  .find((id) => id !== "a" && id !== "b" && id !== "d");
log("reopened as", reopened, await paneIds());
log("draft after reopen:", JSON.stringify(await composer(reopened).innerText()));

// Reload keeps the layout.
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(6000);
log("after reload", await paneIds(), "divider", await divider.getAttribute("aria-valuenow"));
await shot("09-after-reload-1440");

// Phone: only the focused pane, no strip, slots kept.
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(1500);
log(
  "390",
  await paneIds(),
  "strip close buttons",
  await page.locator('[data-testid^="baton-pane-close"]').count(),
);
await shot("10-phone-390");
await page.setViewportSize({ width: 1440, height: 900 });
await page.waitForTimeout(1500);
log("back to 1440", await paneIds());

log("errors", errors.length, JSON.stringify([...new Set(errors)].slice(0, 12), null, 1));
await browser.close();
