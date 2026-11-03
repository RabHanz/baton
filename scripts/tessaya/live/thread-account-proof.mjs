// One thread moves between provider instances and keeps its conversation; a running turn is not cut (D95).
//   node thread-account-proof.mjs <state.json> <frameDir> <projectName>     Playwright from $PLAYWRIGHT_DIR
// Spends a few small turns on the active account. Prints the thread id for a look at the database.
import * as NodeModule from "node:module";

const require = NodeModule.createRequire(`${process.env.PLAYWRIGHT_DIR}/`);
const { chromium } = require("playwright");
const [state, frames, project] = process.argv.slice(2);
const word = `PELICAN-${Date.now() % 100000}`;
const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"} ${name} ${detail}`);
};

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  storageState: state,
});
const page = await context.newPage();
await page.goto(process.env.BASE_URL ?? "http://localhost:3773/", {
  waitUntil: "domcontentloaded",
});
await page.locator("li[data-thread-item]").first().waitFor({ timeout: 60_000 });
await page.waitForTimeout(2500);
const BLUR =
  "li[data-thread-item], [data-chat-header] h2, [data-chat-header] [title] { filter: blur(5px); }";
const shot = async (name) => {
  await page.addStyleTag({ content: BLUR });
  await page.screenshot({ path: `${frames}/${name}.png` });
};
const timeline = () => page.locator("[data-timeline-root]").last().innerText();
const composer = page.locator('[data-testid="composer-editor"]').last();
const send = async (text) => {
  await composer.click();
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
};
const waitForText = async (test, ms) => {
  for (let waited = 0; waited < ms; waited += 1000) {
    if (test(await timeline().catch(() => ""))) return true;
    await page.waitForTimeout(1000);
  }
  return false;
};
const toasts = () => page.locator('[data-slot="toast-title"], [role="status"]').allInnerTexts();
const account = page.locator('[data-testid="thread-account"]').last();

// The project of the row that names it; a Shift click starts a thread in the current project.
await page.locator("li[data-thread-item]").filter({ hasText: project }).first().click();
await page.waitForTimeout(3000);
await page
  .locator('button[aria-label^="New thread"]')
  .first()
  .click({ modifiers: ["Shift"] });
await page.waitForTimeout(2500);
// The plain tile is the default instance; the coloured one beside it is the pinned account.
const live = page.locator("button").filter({ hasText: /^live$/ });
if ((await live.count()) > 0) {
  await live.last().click();
  await page.waitForTimeout(800);
  await page.locator("[data-model-picker-provider]").nth(2).click();
  await page.waitForTimeout(800);
  await page.locator('[role="option"]', { hasText: /haiku/i }).first().click();
  await page.waitForTimeout(800);
}
await send(`Remember the word ${word}. Reply with only: noted`);
check(
  "the thread answered on the default instance",
  await waitForText((t) => /noted/i.test(t), 120_000),
);
await page.waitForTimeout(3000);
const threadId = decodeURIComponent(page.url().split("/").pop());
console.log("thread", threadId);
await shot("30-account-before-1440");

await account.click();
await page.waitForTimeout(800);
await page.locator('[role="menuitem"]', { hasText: /rabee/i }).first().click();
await page.waitForTimeout(2500);
console.log("toast:", JSON.stringify(await toasts()));
await shot("31-account-moved-1440");

await send("What word did I ask you to remember? Reply with only that word.");
check(
  "after the move the thread still knows the word",
  await waitForText((t) => t.slice(-120).includes(word), 120_000),
);
await shot("32-account-kept-context-1440");

await send(
  "Write a 1500 word plain text story about a lighthouse keeper. No tools. End with the word FINISHED.",
);
await page.waitForTimeout(2000);
await account.click();
await page.waitForTimeout(800);
await shot("33-account-menu-during-turn-1440");
await page
  .locator('[role="menuitem"]', { hasText: /Follow this machine/ })
  .first()
  .click();
await page.waitForTimeout(1500);
const during = JSON.stringify(await toasts());
console.log("toast:", during);
check("a move during a turn waits for it", /when the turn ends/.test(during));
await shot("34-account-waiting-1440");
check(
  "the running turn finished",
  await waitForText((t) => /FINISHED\s*$/.test(t.trim()), 180_000),
);
await page.waitForTimeout(4000);
await shot("35-account-turn-finished-1440");
await send("What word did I ask you to remember? Reply with only that word.");
check(
  "after the second move it still knows the word",
  await waitForText((t) => t.slice(-120).includes(word), 120_000),
);
await shot("36-account-moved-back-1440");

await browser.close();
console.log(`${results.filter(Boolean).length} of ${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
