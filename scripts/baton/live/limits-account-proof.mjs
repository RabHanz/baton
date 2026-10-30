// D92 proof, read-only: the account label, its menu and the limits age on a paired server.
//   node limits-account-proof.mjs <pair-url-file> <frame-dir>     Playwright from $PLAYWRIGHT_DIR
import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";

const require = NodeModule.createRequire(`${process.env.PLAYWRIGHT_DIR}/`);
const { chromium } = require("playwright");
const [pairFile, frames] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await page.goto(NodeFS.readFileSync(pairFile, "utf8").trim());
await page.waitForSelector("li[data-thread-item]", { timeout: 60_000 });
await page.locator("li[data-thread-item]").first().click();
const account = page.getByTestId("thread-account");
await account.waitFor({ timeout: 30_000 });
console.log("label:", (await account.innerText()).trim());
await page.screenshot({ path: `${frames}/header-1440.png` });
await account.click();
await page.waitForTimeout(500);
console.log("menu:", (await page.getByRole("menu").innerText()).replace(/\n+/g, " | "));
await page.screenshot({ path: `${frames}/menu-1440.png` });
await page.keyboard.press("Escape");
const details = page.getByRole("button", { name: /thread details/i }).first();
if (await details.count()) await details.click().catch(() => {});
await page.waitForTimeout(1_000);
const age = page.getByTestId("limits-age").first();
console.log("age:", (await age.count()) ? await age.innerText() : "not on screen");
await page.screenshot({ path: `${frames}/details-1440.png` });
await browser.close();
