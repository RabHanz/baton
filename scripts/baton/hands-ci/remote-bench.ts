// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalDate:off
// Remote hands latency on a real Windows desktop: the remote tool table over ONE long-lived sidecar (as the app runs it), called
// through the broker exactly as a remote session's call would be (call, take, run, reply). No network hop is included: add the
// round trip of the connection. Prints a table and writes remote-bench.json.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeReadline from "node:readline";

import { createHandsBroker } from "../../../packages/baton-shared/src/remoteHands.ts";
import { buildRemoteHandsTools } from "../../../apps/desktop/src/baton/agent/remoteHandsTools.ts";

const OUT = process.env["HANDS_OUT"] ?? NodePath.join(process.cwd(), "remote-out");
NodeFS.mkdirSync(OUT, { recursive: true });
const sidecar = NodeChildProcess.spawn(process.env["SIDECAR"] ?? "baton-dictation.exe", ["serve"], {
  windowsHide: true,
  stdio: ["pipe", "pipe", "ignore"],
});
const waiting = new Map<number, (v: Record<string, unknown>) => void>();
NodeReadline.createInterface({ input: sidecar.stdout }).on("line", (line) => {
  try {
    const e = JSON.parse(line) as Record<string, unknown>;
    if (typeof e["id"] === "number") waiting.get(e["id"])?.(e);
  } catch {
    // other events
  }
});
let nextId = 0;
const call = <T>(message: Record<string, unknown>): Promise<T> =>
  new Promise((resolve, reject) => {
    const id = (nextId += 1);
    const timer = setTimeout(
      () => reject(new Error(`sidecar silent for ${JSON.stringify(message).slice(0, 80)}`)),
      20_000,
    );
    waiting.set(id, (v) => (clearTimeout(timer), waiting.delete(id), resolve(v as T)));
    sidecar.stdin.write(`${JSON.stringify({ ...message, id })}\n`);
  });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ps = (script: string) =>
  NodeChildProcess.execFileSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    { encoding: "utf8" },
  ).trim();

const tools = new Map(
  buildRemoteHandsTools({
    sidecar: {
      locate: (i) => call({ cmd: "locate", ...i }),
      uiTree: (window) => call({ cmd: "ui_tree", ...(window === undefined ? {} : { window }) }),
      captureWindow: (i) => call({ cmd: "capture_window", ...i }),
    },
    scratchDir: NodeOS.tmpdir(),
    ops: {
      version: () => "bench",
      logs: {},
      processes: async () => [],
      stop: async () => {},
      update: async () => "n/a",
      pages: ["home"],
      openPage: async () => "n/a",
    },
  }).map((t) => [t.name, t]),
);

// The same path a remote call takes: broker.call, then the desktop's take, run and reply.
const broker = createHandsBroker({ now: () => Date.now(), newId: () => String(Math.random()) });
const serve = async () => {
  for (;;) {
    const c = await broker.take(1_000);
    if (c === null) continue;
    void tools
      .get(c.tool)!
      .run(c.args)
      .then(
        (out) =>
          broker.reply(c.id, {
            ok: true,
            ...(out.text === undefined ? {} : { text: out.text }),
            ...(out.images === undefined ? {} : { images: out.images }),
          }),
        (e: Error) => broker.reply(c.id, { ok: false, error: e.message }),
      );
  }
};
void serve();
await sleep(300);

const rows: Array<{ step: string; n: number; p50: number; p90: number; max: number; ok: number }> =
  [];
const measure = async (step: string, n: number, args: () => [string, Record<string, unknown>]) => {
  const times: number[] = [];
  let ok = 0;
  for (let i = 0; i < n; i += 1) {
    const [tool, a] = args();
    const t0 = performance.now();
    const r = await broker.call("bench", tool, a);
    times.push(performance.now() - t0);
    if (r.ok) ok += 1;
    else if (i === 0) console.log(`  ${step}: ${r.error}`);
  }
  const s = [...times].sort((x, y) => x - y);
  const q = (p: number) => Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))]!);
  rows.push({ step, n, p50: q(0.5), p90: q(0.9), max: q(1), ok });
};

ps("Start-Process calc.exe; Start-Sleep -Seconds 4");
await measure("ui_tree (named window, Calculator)", 20, () => [
  "ui_tree",
  { window: "Calculator" },
]);
await measure("click_element by pattern (Calculator, no focus)", 20, () => [
  "click_element",
  { label: "1", window: "Calculator", why: "bench" },
]);
await measure("act_batch of 3 clicks (one call)", 10, () => [
  "act_batch",
  {
    steps: ["1", "2", "3"].map((label) => ({
      tool: "click_element",
      args: { label, window: "Calculator", why: "bench" },
    })),
  },
]);
// Put another window in front, so Calculator is covered, then take its picture.
ps("Start-Process notepad.exe; Start-Sleep -Seconds 2");
await measure("window_capture of a covered window (Calculator)", 10, () => [
  "window_capture",
  { window: "Calculator" },
]);
await measure("window_capture of the front window (Notepad)", 10, () => [
  "window_capture",
  { window: "Notepad" },
]);
const pic = await broker.call("bench", "window_capture", { window: "Calculator" });
if (pic.images?.[0] !== undefined)
  NodeFS.writeFileSync(
    NodePath.join(OUT, "covered-calculator.png"),
    Buffer.from(pic.images[0].data, "base64"),
  );

console.log(
  "| Step | Calls | OK | p50 ms | p90 ms | max ms |\n| --- | --- | --- | --- | --- | --- |",
);
for (const r of rows)
  console.log(`| ${r.step} | ${r.n} | ${r.ok} | ${r.p50} | ${r.p90} | ${r.max} |`);
NodeFS.writeFileSync(NodePath.join(OUT, "remote-bench.json"), JSON.stringify(rows, null, 2));
ps(
  "Get-Process -Name CalculatorApp,Calculator,win32calc,calc,notepad -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue",
);
sidecar.kill();
process.exit(0);
