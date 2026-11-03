// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalTimers:off
/**
 * A hung Electron main thread cannot report itself, so a worker watches it. The main thread bumps a shared counter
 * every half second; if the counter stands still for `limitMs` the worker writes `main-stalled` to the lifecycle log
 * with the startup phases it was told about, and the main JS stack when the inspector can get one. A stall that
 * ends writes `main-recovered` with how long it lasted. (A thread blocked inside a native call gives no JS stack;
 * the last phase marker then names the blocker.)
 */
import * as NodeWorker from "node:worker_threads";

const BEAT_MS = 500;
export const STALL_LIMIT_MS = 5_000;

/** The worker's whole program: it only knows a file, a shared counter, and the phases posted to it. */
export const WATCH_SOURCE = `
const { parentPort, workerData } = require("node:worker_threads");
const fs = require("node:fs");
const path = require("node:path");
const { file, counter, limitMs, version } = workerData;
const beats = new Int32Array(counter);
let phases = [];
let last = Atomics.load(beats, 0);
let changedAt = Date.now();
let stalledAt = 0;
const write = (event, detail) => {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), event, version, pid: workerData.pid, ...detail }) + "\\n");
  } catch {}
};
parentPort.on("message", (m) => {
  phases.push(m);
  if (phases.length > 40) phases = phases.slice(-40);
});
const lastPhases = () => phases.slice(-12);
const grabStack = () => {
  try {
    const inspector = require("node:inspector");
    const session = new inspector.Session();
    session.connectToMainThread();
    session.on("Debugger.paused", (e) => {
      const frames = e.params.callFrames.slice(0, 10).map((f) => (f.functionName || "(anonymous)") + " " + f.url.split(/[\\\\/]/).slice(-2).join("/") + ":" + (f.location.lineNumber + 1));
      write("main-stack", { frames });
      session.post("Debugger.resume");
      session.post("Debugger.disable");
    });
    session.post("Debugger.enable", () => session.post("Debugger.pause"));
  } catch (error) {
    write("main-stack-unavailable", { error: String(error) });
  }
};
setInterval(() => {
  const now = Date.now();
  const seen = Atomics.load(beats, 0);
  if (seen !== last) {
    last = seen;
    if (stalledAt !== 0) write("main-recovered", { stalledMs: now - stalledAt, phases: lastPhases() });
    stalledAt = 0;
    changedAt = now;
  } else if (stalledAt === 0 && now - changedAt >= limitMs) {
    stalledAt = changedAt;
    write("main-stalled", { stalledForMs: now - changedAt, phases: lastPhases() });
    grabStack();
  }
}, 1000);
`;

export interface StallWatch {
  readonly phase: (name: string, detail?: Record<string, unknown>) => void;
  readonly stop: () => void;
}

let current: StallWatch | null = null;

/** Mark the start or end of a startup step. Harmless before the watch exists. */
export const markPhase = (name: string, detail?: Record<string, unknown>): void =>
  current?.phase(name, detail);

export const startStallWatch = (input: {
  readonly file: string;
  readonly version: string;
  readonly limitMs?: number;
}): StallWatch => {
  const counter = new SharedArrayBuffer(4);
  const beats = new Int32Array(counter);
  const beat = setInterval(() => Atomics.add(beats, 0, 1), BEAT_MS);
  beat.unref();
  let worker: NodeWorker.Worker | null = null;
  try {
    worker = new NodeWorker.Worker(WATCH_SOURCE, {
      eval: true,
      workerData: {
        file: input.file,
        counter,
        limitMs: input.limitMs ?? STALL_LIMIT_MS,
        version: input.version,
        pid: process.pid,
      },
    });
    worker.on("error", () => {});
    worker.unref();
  } catch {
    // A watchdog must never stop the app from starting.
    worker = null;
  }
  const watch: StallWatch = {
    phase: (name, detail) => {
      try {
        worker?.postMessage({ at: Date.now(), name, ...detail });
      } catch {
        // diagnostics only
      }
    },
    stop: () => {
      clearInterval(beat);
      void worker?.terminate();
    },
  };
  current = watch;
  return watch;
};
