// Renders the logo kit's sting and listening compositions to small frame sequences, the way HyperFrames
// seeks them (draw(t) is a pure function of time), at a pill-sized square, then packs them into
// apps/desktop/src/baton/voice/pillMotionArt.ts (animated WebP, lossless, on the pill's own #0B0B0C).
//   KIT=<logo kit>/motion PLAYWRIGHT=<path to playwright-core> node scripts/baton/render-pill-motion.cjs
const { chromium } = require(process.env.PLAYWRIGHT ?? "playwright-core");
const fs = require("fs");
const KIT = process.env.KIT;
const OUT = process.env.OUT ?? "pill-motion-frames";
const SIZE = Number(process.env.SIZE || 64);
const jobs = [
  { name: "sting", seconds: 2, fps: 24 },
  { name: "listening", seconds: 2.4, fps: 12 },
];
(async () => {
  const b = await chromium.launch();
  for (const j of jobs) {
    const page = await b.newPage({ viewport: { width: SIZE, height: SIZE } });
    await page.route("**/gsap*", (r) => r.fulfill({ contentType: "text/javascript", body: "window.gsap={timeline:()=>({to(){return this}})};" }));
    await page.goto(`file://${KIT}/${j.name}/index.html`);
    await page.addStyleTag({ content: `html,body,#root{width:${SIZE}px!important;height:${SIZE}px!important}` });
    fs.mkdirSync(`${OUT}/${j.name}`, { recursive: true });
    const n = Math.round(j.seconds * j.fps);
    for (let i = 0; i < n; i += 1) {
      await page.evaluate((t) => draw(t), i / j.fps);
      await page.screenshot({ path: `${OUT}/${j.name}/f${String(i).padStart(3, "0")}.png` });
    }
    console.log(j.name, n, "frames");
    await page.close();
  }
  await b.close();
})();
