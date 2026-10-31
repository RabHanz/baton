// Layout, header, per-thread account and detached windows on a running Baton (D93, D95, D96).
//   node panes-proof.mjs <pairUrlFile|state:file.json> <frameDir> [--send]     Playwright from $PLAYWRIGHT_DIR
// Takes the first four threads in the sidebar. --send also spends one small turn after a move.
import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";

const require = NodeModule.createRequire(`${process.env.PLAYWRIGHT_DIR}/`);
const { chromium } = require("playwright");
const [target, frames, ...flags] = process.argv.slice(2);
const base = process.env.BASE_URL ?? "http://localhost:3773/";
const fromState = target.startsWith("state:");
const results = [];
const check = (name, ok, detail = "") => {
  results.push([ok, name]);
  console.log(`${ok ? "PASS" : "FAIL"} ${name} ${detail}`);
};

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  storageState: fromState ? target.slice(6) : undefined,
});
const page = await context.newPage();
await page.goto(fromState ? base : NodeFS.readFileSync(target, "utf8").trim(), {
  waitUntil: "domcontentloaded",
});
// This repository is public: blur thread titles and chat text, keep the layout and controls sharp.
const BLUR =
  "li[data-thread-item], [data-timeline-root], [data-chat-header] h2, [data-chat-header] [title], section[data-focused] > div:last-of-type span.truncate { filter: blur(5px); }";
const shot = async (name, on = page) => {
  await on.addStyleTag({ content: BLUR });
  await on.screenshot({ path: `${frames}/${name}.png` });
};
const rows = page.locator("li[data-thread-item]");
await rows.first().waitFor({ timeout: 60_000 });
await page.waitForTimeout(3000);
await context.storageState({ path: `${frames}/../proof-state.json` });

const rect = (id, on = page) =>
  on.locator(`[data-testid="baton-pane-${id}"]`).evaluate((el) => {
    const box = el.getBoundingClientRect();
    return { x: box.x, y: box.y, w: box.width, h: box.height };
  });
const near = (a, b, by = 3) => Math.abs(a - b) <= by;

// 1. Three columns, four a grid.
await rows.nth(0).click();
await page.waitForSelector('[data-testid="baton-pane-a"]');
await page.waitForTimeout(2000);
await rows.nth(1).click({ modifiers: ["Alt"] });
await page.waitForTimeout(1500);
await rows.nth(2).click({ modifiers: ["Alt"] });
await page.waitForTimeout(2500);
const [a, c] = [await rect("a"), await rect("c")];
check("three panes are three columns", near(a.y, c.y) && near(a.h, c.h) && near(a.w, c.w, 6));
const columnDividers = page.locator('[data-testid="baton-pane-divider-column"]');
check("three columns have two dividers", (await columnDividers.count()) === 2);
await shot("01-three-columns-1440");

// 2. Every divider drags.
for (const index of [0, 1]) {
  const handle = await columnDividers.nth(index).boundingBox();
  const before = [await rect("a"), await rect("b"), await rect("c")].map((box) => box.w);
  await page.mouse.move(handle.x + 4, 400);
  await page.mouse.down();
  await page.mouse.move(handle.x - 60, 400, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const after = [await rect("a"), await rect("b"), await rect("c")].map((box) => box.w);
  const untouched = index === 0 ? 2 : 0;
  check(
    `column divider ${index + 1} moves only its two panes`,
    near(after[index], before[index] - 64, 14) && near(after[untouched], before[untouched]),
    `${before.map(Math.round)} -> ${after.map(Math.round)}`,
  );
}
await shot("02-resized-1440");

await rows.nth(3).click({ modifiers: ["Alt"] });
await page.waitForTimeout(2500);
const [ga, gd] = [await rect("a"), await rect("d")];
check("four panes are a two by two grid", gd.x > ga.x + 50 && gd.y > ga.y + 50);
await shot("03-grid-1440");
await page.setViewportSize({ width: 2560, height: 1440 });
await page.waitForTimeout(1200);
await shot("04-grid-2560");
await page.setViewportSize({ width: 1440, height: 900 });
await page.waitForTimeout(800);
const rowDividers = page.locator('[data-testid="baton-pane-divider-row"]');
check("the grid has a row divider per column", (await rowDividers.count()) === 2);
{
  const handle = await rowDividers.first().boundingBox();
  const before = (await rect("a")).h;
  await page.mouse.move(handle.x + 100, handle.y + 4);
  await page.mouse.down();
  await page.mouse.move(handle.x + 100, handle.y - 80, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  check("row divider drags", near((await rect("a")).h, before - 84, 14));
}

// 3. Drag a pane onto another, then the keyboard, then reload.
const dragBar = async (from, to, zone) => {
  const bar = await page.locator(`[data-testid="baton-pane-bar-${from}"]`).boundingBox();
  const box = await rect(to);
  const point = {
    center: [box.x + box.w / 2, box.y + box.h / 2],
    left: [box.x + 12, box.y + box.h / 2],
    right: [box.x + box.w - 12, box.y + box.h / 2],
    top: [box.x + box.w / 2, box.y + 12],
    bottom: [box.x + box.w / 2, box.y + box.h - 12],
  }[zone];
  await page.mouse.move(bar.x + bar.width / 2, bar.y + bar.height / 2);
  await page.mouse.down();
  await page.mouse.move(bar.x + bar.width / 2 + 20, bar.y - 30, { steps: 4 });
  await page.mouse.move(point[0], point[1], { steps: 10 });
  await page.waitForTimeout(250);
  if (from === "d") await shot("05-drop-hint-1440");
  await page.mouse.up();
  await page.waitForTimeout(700);
};
const beforeSwap = await rect("a");
await dragBar("a", "d", "center");
const afterSwap = await rect("a");
check(
  "dragging onto the middle swaps",
  afterSwap.x > beforeSwap.x + 50 && afterSwap.y > beforeSwap.y,
);
await dragBar("d", "c", "bottom");
check("dragging onto an edge docks there", (await rect("d")).y > (await rect("c")).y);
await shot("06-rearranged-1440");
const beforeKey = await rect("b");
await page.locator('[data-testid="baton-pane-move-b"]').focus();
await page.keyboard.press("Shift+ArrowUp");
await page.waitForTimeout(500);
const afterKey = await rect("b");
check(
  "Shift and an arrow gives a pane that whole side",
  near(afterKey.w, 1440 - afterKey.x, 8) || afterKey.w > beforeKey.w,
);
const arranged = JSON.stringify([
  await rect("a"),
  await rect("b"),
  await rect("c"),
  await rect("d"),
]);
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="baton-pane-d"]', { timeout: 60_000 });
await page.waitForTimeout(2500);
const reloaded = JSON.stringify([
  await rect("a"),
  await rect("b"),
  await rect("c"),
  await rect("d"),
]);
check("the layout survives a reload", arranged === reloaded);
await shot("07-after-reload-1440");

// 4. The window-level controls act on the focused pane, whichever it is.
const windowControls = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('[aria-label="Toggle terminal drawer"]')].flatMap((toggle) =>
      toggle.getBoundingClientRect().width === 0
        ? []
        : [toggle.closest("[data-focused]")?.dataset.focused],
    ),
  );
for (const id of ["a", "c"]) {
  await page.locator(`[data-testid="baton-pane-${id}"] [data-chat-header]`).click({
    position: { x: 40, y: 12 },
  });
  await page.waitForTimeout(1200);
  const controls = await windowControls();
  check(
    `one set of window controls, the focused pane's, with pane ${id} focused`,
    controls.length === 1 && controls[0] === "true",
    JSON.stringify(controls),
  );
  const focused = page.locator(`[data-testid="baton-pane-${id}"]`);
  check(`pane ${id} is the focused pane`, (await focused.getAttribute("data-focused")) === "true");
  const terminal = page.locator('[aria-label="Toggle terminal drawer"]:visible').last();
  const pressed = await terminal.getAttribute("aria-pressed");
  await terminal.click();
  await page.waitForTimeout(1500);
  check(`Terminal acts on pane ${id}`, (await terminal.getAttribute("aria-pressed")) !== pressed);
  await shot(`08-terminal-pane-${id}-1440`);
  await terminal.click();
  await page.waitForTimeout(700);
  const details = page.locator('[aria-label="Toggle thread details panel"]').last();
  await details.click();
  await page.waitForTimeout(1000);
  await shot(`09-details-pane-${id}-1440`);
  await page.keyboard.press("Escape");
  await details.click({ force: true }).catch(() => {});
  await page.waitForTimeout(500);
  const right = page.locator('[aria-label="Toggle right panel"]:visible').last();
  await right.click();
  await page.waitForTimeout(1000);
  await shot(`10-right-panel-pane-${id}-1440`);
  await right.click({ force: true }).catch(() => {});
  await page.waitForTimeout(500);
}

// 5. The account menu.
const accountMenu = page.locator('[data-testid="baton-pane-a"] [data-testid="thread-account"]');
if (await accountMenu.count()) {
  await accountMenu.click();
  await page.waitForTimeout(800);
  const items = await page.locator('[role="menuitem"]').allInnerTexts();
  console.log("account menu:", JSON.stringify(items));
  check(
    "a spent account says when it returns",
    items.some((text) => /out until/.test(text)),
  );
  await shot("11-account-menu-1440");
  const rabee = page.locator('[role="menuitem"]', { hasText: /rabee/i }).first();
  if (
    (await rabee.getAttribute("aria-disabled")) === "true" ||
    (await rabee.getAttribute("data-disabled")) !== null
  ) {
    console.log("rabee row is the thread's account already; nothing to move");
    await page.keyboard.press("Escape");
  } else {
    await rabee.click();
    await page.waitForTimeout(2000);
  }
  await shot("12-account-after-1440");
  if (flags.includes("--send")) {
    const composer = page.locator('[data-testid="baton-pane-a"] [data-testid="composer-editor"]');
    await composer.click();
    await page.keyboard.type(
      "Reply with the single word MOVED and the topic of this thread in three words.",
    );
    await page.keyboard.press("Enter");
    await page.waitForTimeout(45_000);
    await shot("13-account-turn-1440");
  }
}

// 6. Two real windows.
const paneCountBefore = await page.locator("section[data-focused]").count();
const [popup] = await Promise.all([
  context.waitForEvent("page", { timeout: 15_000 }),
  page.locator('[data-testid="baton-pane-detach-c"]').click(),
]);
await popup.waitForLoadState("domcontentloaded");
await popup.waitForSelector('[data-testid="baton-pane-a"]', { timeout: 60_000 });
await popup.waitForTimeout(3500);
const windowName = await popup.evaluate(() => window.name);
check("the thread opened in its own window", windowName.startsWith("baton-window-"), windowName);
check(
  "the pane left the main window",
  (await page.locator("section[data-focused]").count()) === paneCountBefore - 1,
);
await page.bringToFront();
await shot("14-main-after-detach-1440");
await popup.bringToFront();
await shot("15-detached-window-1440", popup);
const keys = await page.evaluate(() =>
  Object.keys(localStorage).filter((key) => key.startsWith("t3code:baton-panes")),
);
check("each window has its own layout", keys.length >= 2, JSON.stringify(keys));

// The same thread opened in the main window is taken from the detached one.
await page.bringToFront();
const detachedTitle = await popup
  .locator('section[data-focused="true"]')
  .getAttribute("aria-label");
const row = page
  .locator("li[data-thread-item]")
  .filter({ hasText: detachedTitle.slice(0, 20) })
  .first();
await row.click({ modifiers: ["Alt"] });
await page.waitForTimeout(2500);
check(
  "a thread lives in one window",
  (await popup.locator('[data-testid="baton-pane-bring-here"]').count()) === 1,
);
await popup.bringToFront();
await shot("16-held-elsewhere-1440", popup);
await popup.locator('[data-testid="baton-pane-bring-here"]').click();
await popup.waitForTimeout(2500);
check(
  "Bring it here takes it back",
  (await page.locator('[data-testid="baton-pane-bring-here"]').count()) === 1,
);
await popup.reload({ waitUntil: "domcontentloaded" });
await popup.waitForSelector('[data-testid="baton-pane-a"]', { timeout: 60_000 });
await popup.waitForTimeout(2500);
check(
  "a detached window keeps its id over a reload",
  (await popup.evaluate(() => window.name)) === windowName,
);
check(
  "a reload does not take the thread from anyone",
  (await popup.locator('[data-testid="baton-pane-bring-here"]').count()) === 0,
);

const closed = popup.waitForEvent("close", { timeout: 15_000 });
await popup.locator('[data-testid^="baton-pane-attach-"]').first().click();
await closed;
await page.waitForTimeout(2000);
check(
  "Attach puts it back and closes the window",
  (await page.locator('[data-testid="baton-pane-bring-here"]').count()) === 0,
);
await page.bringToFront();
await shot("17-reattached-1440");

await browser.close();
const failed = results.filter(([ok]) => !ok);
console.log(`\n${results.length - failed.length} of ${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);
