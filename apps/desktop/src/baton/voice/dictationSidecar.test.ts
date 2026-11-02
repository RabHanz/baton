import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { describe, expect, it } from "vite-plus/test";

import {
  runDrivePlan,
  type DriveHost,
  type DrivePlan,
} from "@t3tools/baton-shared/screenCompanion";

import {
  focusedFrom,
  resolveDictationBinary,
  restartDelayMs,
  startDictationSidecar,
  type DictationEvent,
  type FocusedApp,
} from "./dictationSidecar.ts";

describe("restartDelayMs", () => {
  it("backs off to a minute and no further", () => {
    expect([1, 2, 3, 7, 50].map(restartDelayMs)).toEqual([1_000, 2_000, 4_000, 60_000, 60_000]);
  });
});

describe("resolveDictationBinary", () => {
  it("is null where it was not built", () => {
    expect(
      resolveDictationBinary({
        resourcesPath: "/r",
        platform: "linux",
        env: {},
        exists: () => false,
      }),
    ).toBe(null);
  });

  it("names the binary for the platform", () => {
    const found = (platform: string) =>
      resolveDictationBinary({ resourcesPath: "/r", platform, env: {}, exists: () => true });
    expect(found("win32")?.endsWith("baton-dictation.exe")).toBe(true);
    expect(found("darwin")?.endsWith("baton-dictation")).toBe(true);
  });
});

describe("the keyboard's window, through the real parser", () => {
  const reading = (window: number) =>
    focusedFrom({ ev: "foreground", app: "notepad.exe", title: "a", rect: null, window });

  it("keeps the window and drops a zero", () => {
    expect(reading(7).window).toBe(7);
    expect(reading(0).window).toBeUndefined();
  });

  const shot = {
    screen: 1,
    width: 100,
    height: 100,
    cursorHere: true,
    bounds: { x: 0, y: 0, width: 100, height: 100 },
  };
  const plan = {
    title: "t",
    actions: [
      { kind: "type", text: "a" },
      { kind: "type", text: "b" },
    ],
  } as DrivePlan;
  const host = (next: () => FocusedApp | null, typed: string[]): DriveHost => ({
    clickAt: async () => undefined,
    pressAt: async () => undefined,
    releaseAt: async () => undefined,
    scrollAt: async () => undefined,
    type: async (t) => void typed.push(t),
    press: async () => undefined,
    sleep: async () => undefined,
    cancelled: () => false,
    verify: async () => ({ ok: true }),
    foreground: async () => {
      const app = next();
      return app?.window === undefined
        ? null
        : { window: app.window, label: `${app.exe}: ${app.title}` };
    },
  });

  it("stops the type after he switches during the one before", async () => {
    const seen = [1, 1, 2];
    const typed: string[] = [];
    const result = await runDrivePlan(
      plan,
      [shot],
      host(() => reading(seen.shift() ?? 2), typed),
    );
    expect(result).toMatchObject({ kind: "stopped", step: 1 });
    expect(typed).toEqual(["a"]);
  });

  it("treats no reading as a stop, not a pass", async () => {
    const typed: string[] = [];
    const result = await runDrivePlan(
      plan,
      [shot],
      host(() => null, typed),
    );
    expect(result).toMatchObject({ kind: "stopped", step: 0 });
    expect(typed).toEqual([]);
  });

  it("stops on reaching a command line nobody agreed to", async () => {
    const typed: string[] = [];
    const shell = focusedFrom({ app: "powershell.exe", title: "PS", window: 3 });
    const result = await runDrivePlan(
      plan,
      [shot],
      host(() => shell, typed),
    );
    expect(result).toMatchObject({ kind: "stopped", step: 0 });
  });
});

describe("a slow model load, through a real child process", () => {
  // A stand-in for baton-dictation: it answers `load` with a few "loading" lines and then model_ready, and answers a
  // `transcribe` that arrived during the load only after it, as the real engine thread does.
  const fake = () => {
    const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "fake-sidecar-"));
    const file = NodePath.join(dir, "fake.mjs");
    NodeFS.writeFileSync(
      file,
      `#!/usr/bin/env node
import readline from "node:readline";
const out = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
let queue = [];
let loaded = false;
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const m = JSON.parse(line);
  if (m.cmd === "load") {
    let n = 0;
    const t = setInterval(() => {
      out({ ev: "loading", elapsedMs: ++n * 100 });
      if (n === 4) { clearInterval(t); loaded = true; out({ ev: "model_ready", id: m.id, loadMs: 400 }); for (const q of queue) out({ ev: "text", id: q, text: "heard it" }); queue = []; }
    }, 100);
  } else if (m.cmd === "transcribe") { if (loaded) out({ ev: "text", id: m.id, text: "heard it" }); else queue.push(m.id); }
});
`,
      { mode: 0o755 },
    );
    return file;
  };

  it("tells loading from a hang, loads on request, and answers a phrase that arrived mid-load", async () => {
    const events: DictationEvent[] = [];
    const sidecar = startDictationSidecar({ binary: fake(), onEvent: (e) => void events.push(e) });
    try {
      const early = sidecar.transcribe("x.wav");
      const ready = sidecar.preload();
      expect(await ready).toBe(400);
      expect(await early).toBe("heard it");
      expect(events.filter((e) => e.ev === "loading").length).toBeGreaterThanOrEqual(3);
      expect(await sidecar.transcribe("y.wav")).toBe("heard it");
    } finally {
      sidecar.dispose();
    }
  });
});
