/* oxlint-disable t3code/no-low-value-comments, t3code/no-real-time-wait-in-tests -- Baton proof script */
// Prove D85 through T3's own web client, read-only on the thread it is pointed at:
//
//   node scripts/baton/live/media-notify-proof.mjs <pairUrlFile> <outPrefix> <width> <step>...
//
// Steps (run in order, each screenshots `<outPrefix>-<n>-<name>.png`):
//   find=<thread title part>=<img alt part>   open the thread and scroll until that image renders
//   burst=<thread title part>=<m1>|<m2>|<m3>  send the messages back to back; none may queue in T3
//   image=<thread title part>=<file>=<message>=<expected reply text>  attach a file and send
//   wait=<thread title part>=<text>           open the thread and wait for the text
//   away                                       go to the home view (so completions alert here)
//   hold=<seconds>                             stay, recording T3's completion toasts
//
// Every "Thread completed" toast seen is printed as `TOAST <thread title>` at the end.
// Playwright comes from $PLAYWRIGHT_DIR.
import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";

const require = NodeModule.createRequire(`${process.env.PLAYWRIGHT_DIR ?? process.cwd()}/`);
const { chromium } = require("playwright");

const [pairFile, out, widthArg, ...steps] = process.argv.slice(2);
const width = Number(widthArg);
const phone = width < 768;
const pairUrl = NodeFS.readFileSync(pairFile, "utf8").trim();

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width, height: phone ? 844 : 900 },
  deviceScaleFactor: 2,
});
await context.addInitScript(() => {
  window.__toasts = [];
  new MutationObserver(() => {
    for (const el of document.querySelectorAll("[data-sonner-toast], [role=status], li, div")) {
      if (el.__seen || !/^Thread completed/.test(el.textContent ?? "")) continue;
      if (el.childElementCount > 6) continue;
      el.__seen = true;
      window.__toasts.push({ at: new Date().toISOString(), text: el.textContent });
    }
  }).observe(document, { childList: true, subtree: true });
});
const page = await context.newPage();
await page.goto(pairUrl, { waitUntil: "domcontentloaded" });
const origin = new URL(page.url()).origin;
await page.waitForTimeout(8000);

let n = 0;
const shot = async (name) => {
  n += 1;
  await page.screenshot({ path: `${out}-${n}-${name}.png` });
};
const openSidebar = async () => {
  if (!phone) return;
  const trigger = page.locator('[data-sidebar="trigger"]').first();
  if (await trigger.isVisible().catch(() => false)) await trigger.click().catch(() => {});
  await page.waitForTimeout(600);
};
const openThread = async (title) => {
  for (let waited = 0; waited < 90_000; waited += 2000) {
    await openSidebar();
    const row = page.locator("li[data-thread-item]", { hasText: title }).first();
    if (await row.isVisible().catch(() => false)) {
      await row.click();
      await page.waitForTimeout(2500);
      return true;
    }
    const working = page.getByText("Working", { exact: true }).first();
    if (await working.isVisible().catch(() => false)) await working.click().catch(() => {});
    await page.waitForTimeout(2000);
  }
  console.log(`FAIL no thread "${title}"`);
  return false;
};
const composer = async () => {
  const editor = page.locator('[data-testid="composer-editor"]').last();
  if (!(await editor.isVisible().catch(() => false))) {
    await page
      .getByText("Ask anything", { exact: false })
      .first()
      .click()
      .catch(() => {});
  }
  await editor.waitFor({ timeout: 30_000 });
  await editor.click();
  return editor;
};
const queuedCount = () =>
  page
    .getByText(/queued/i)
    .count()
    .catch(() => 0);

let failed = false;
for (const step of steps) {
  const [verb, ...args] = step.split("=");
  if (verb === "find") {
    const [title, alt] = args;
    if (!(await openThread(title))) {
      failed = true;
      continue;
    }
    // `alt` is an image alt, or `text:<words>` near the image.
    const img = alt.startsWith("text:")
      ? page.getByText(alt.slice(5), { exact: false }).first()
      : page.locator(`img[alt*="${alt}"]`).first();
    let seen = false;
    for (let i = 0; i < 240 && !seen; i += 1) {
      seen = (await img.count()) > 0;
      if (!seen) {
        // Earlier turns page in, and a turn's earlier replies fold under "Worked for…".
        const earlier = page.getByText("Load earlier turns", { exact: false }).first();
        if (await earlier.isVisible().catch(() => false)) await earlier.click().catch(() => {});
        const folds = page.locator('[aria-expanded="false"]', { hasText: /Worked for / });
        for (const fold of await folds.all()) {
          if (await fold.isVisible().catch(() => false)) await fold.click().catch(() => {});
        }
        await page.mouse.move(width / 2, 400);
        await page.mouse.wheel(0, -400);
        await page.waitForTimeout(400);
      }
    }
    if (seen) {
      await img.scrollIntoViewIfNeeded().catch(() => {});
      await page.waitForTimeout(2500);
      const loaded = await img
        .evaluate((el) => {
          let box = el;
          for (let i = 0; i < 6 && box.parentElement; i += 1) box = box.parentElement;
          const images = el.tagName === "IMG" ? [el] : [...box.querySelectorAll("img")];
          window.__imgInfo = images.map((i) => `${i.alt}|${i.naturalWidth}`);
          return images.some((i) => i.complete && i.naturalWidth > 0);
        })
        .catch(() => false);
      console.log("images:", JSON.stringify(await page.evaluate(() => window.__imgInfo)));
      console.log(
        `${loaded ? "OK" : "FAIL"} ${title}: image "${alt}" ${loaded ? "rendered" : "not loaded"}`,
      );
      failed ||= !loaded;
    } else {
      console.log(`FAIL ${title}: no image "${alt}"`);
      failed = true;
    }
    await shot(`find-${alt.replace(/[^a-z0-9]+/gi, "-")}`);
  } else if (verb === "burst") {
    const [title, list] = args;
    if (!(await openThread(title))) {
      failed = true;
      continue;
    }
    for (const message of list.split("|")) {
      await composer();
      await page.keyboard.type(message);
      await page.keyboard.press("Enter");
      await page.waitForTimeout(1500);
    }
    await page.waitForTimeout(2500);
    const queued = await queuedCount();
    console.log(`${queued === 0 ? "OK" : "FAIL"} burst: ${queued} queued in T3`);
    failed ||= queued !== 0;
    await shot("burst");
  } else if (verb === "image") {
    const [title, file, message, expected] = args;
    if (!(await openThread(title))) {
      failed = true;
      continue;
    }
    await composer();
    await page.locator('input[type="file"]').first().setInputFiles(file);
    await page.waitForTimeout(1500);
    await composer();
    await page.keyboard.type(message);
    await page.keyboard.press("Enter");
    let seen = false;
    for (let waited = 0; waited < 180_000 && !seen; waited += 2000) {
      await page.waitForTimeout(2000);
      seen = (await page.getByText(expected, { exact: false }).count()) > 0;
    }
    console.log(
      `${seen ? "OK" : "FAIL"} image send: "${expected}" ${seen ? "answered" : "missing"}`,
    );
    failed ||= !seen;
    await shot("image-send");
  } else if (verb === "wait") {
    const [title, expected] = args;
    if (!(await openThread(title))) {
      failed = true;
      continue;
    }
    let seen = false;
    for (let waited = 0; waited < 240_000 && !seen; waited += 2000) {
      await page.waitForTimeout(2000);
      seen = (await page.getByText(expected, { exact: false }).count()) > 0;
    }
    console.log(`${seen ? "OK" : "FAIL"} ${title}: "${expected}" ${seen ? "shown" : "missing"}`);
    failed ||= !seen;
    await shot(`wait-${expected.replace(/[^a-z0-9]+/gi, "-")}`);
  } else if (verb === "answer") {
    // answer=<thread>=<question>=<option>=<expected>: tap a relayed terminal prompt's option (D88).
    const [title, question, option, expected] = args;
    if (!(await openThread(title))) {
      failed = true;
      continue;
    }
    let shown = false;
    for (let waited = 0; waited < 120_000 && !shown; waited += 2000) {
      shown = await page
        .getByText(question, { exact: false })
        .last()
        .isVisible()
        .catch(() => false);
      if (!shown) await page.waitForTimeout(2000);
    }
    await shot("question");
    if (!shown) {
      console.log(`FAIL ${title}: question "${question}" not shown`);
      failed = true;
      continue;
    }
    await page.getByText(option, { exact: true }).last().click();
    await page.waitForTimeout(800);
    await shot("picked");
    const submit = page.getByRole("button", { name: /^(Submit|Send)/ }).last();
    if (await submit.isVisible().catch(() => false))
      await submit.click({ timeout: 3000 }).catch(() => {});
    let seen = false;
    for (let waited = 0; waited < 180_000 && !seen; waited += 2000) {
      await page.waitForTimeout(2000);
      seen = (await page.getByText(expected, { exact: false }).count()) > 0;
    }
    await shot("answered");
    console.log(
      `${seen ? "OK" : "FAIL"} ${title}: "${expected}" ${seen ? "after the answer" : "missing"}`,
    );
    failed ||= !seen;
  } else if (verb === "resize") {
    // resize=<width>=<text>: the same view at another width, scrolled back to that text.
    const [to, anchor] = args;
    await page.setViewportSize({ width: Number(to), height: Number(to) < 768 ? 844 : 900 });
    await page.waitForTimeout(3000);
    await page
      .getByText(anchor, { exact: false })
      .first()
      .scrollIntoViewIfNeeded()
      .catch(() => {});
    await page.waitForTimeout(2500);
    await shot(`resize-${to}`);
  } else if (verb === "away") {
    await page.goto(`${origin}/`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);
  } else if (verb === "hold") {
    await page.waitForTimeout(Number(args[0]) * 1000);
    await shot("hold");
  }
}
for (const toast of await page.evaluate(() => window.__toasts)) {
  console.log(`TOAST ${toast.at} ${toast.text}`);
}
await browser.close();
process.exit(failed ? 1 : 0);
