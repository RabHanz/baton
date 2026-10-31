// @effect-diagnostics globalDate:off globalTimers:off nodeBuiltinImport:off globalConsole:off
/**
 * Real requests through the real assistant on his real displays: real capture, real `claude`,
 * the real overlay and accessibility lookup, with nothing scripted. A scripted model must never
 * run where he can watch it: it pointed at an Export button that did not exist. One JSON line per
 * turn; a drive plan is shown and never run, because the approval box is answered Cancel.
 */
/* oxlint-disable t3code/no-global-process-runtime -- standalone lab harness, no Effect runtime */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { fallbackDecision } from "@t3tools/baton-shared/brain";
import * as Electron from "electron";

import { startDictationSidecar } from "../../voice/dictationSidecar.ts";
import { startScreenCompanion } from "../ScreenCompanion.ts";

const out = process.env["LAB_OUT"] ?? process.cwd();
const stateDir = NodePath.join(out, "state");
NodeFS.mkdirSync(stateDir, { recursive: true });
NodeFS.writeFileSync(
  NodePath.join(stateDir, "baton-screen.json"),
  JSON.stringify({ captureApproval: "always", output: "written" }),
);
const report = NodeFS.createWriteStream(NodePath.join(out, "timeline.jsonl"));
const write = (value: unknown) => report.write(`${JSON.stringify(value)}\n`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const REQUESTS = (process.env["LAB_REQUESTS"] ?? "")
  .split("|")
  .map((text) => text.trim())
  .filter(Boolean);

const main = async () => {
  await Electron.app.whenReady();
  void fallbackDecision;
  Electron.dialog.showMessageBox = (async () => ({ response: 1, checkboxChecked: false })) as never;
  const sidecar = startDictationSidecar({
    binary: process.env["LAB_SIDECAR"]!,
    onEvent: () => {},
  });
  let ended: (() => void) | null = null;
  const companion = startScreenCompanion({
    stateDir,
    platform: process.platform,
    env: process.env,
    speak: async () => {},
    onTrace: (entry: unknown) => write(entry),
    onTurnEnd: () => ended?.(),
    holdEscape: () => {},
  } as never);
  companion.setActions({
    grammarPlaces: async () => false,
    act: async (command) => `(would run: ${command})`,
    focus: async () => {
      const app = await sidecar.foreground();
      if (app.exe.length === 0) return null;
      const rect = app.rect == null ? null : Electron.screen.screenToDipRect(null, app.rect);
      return {
        label: `${app.exe}: ${app.title}`,
        centre: rect === null ? null : { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 },
      };
    },
    locate: async (label, near) => {
      const physical = Electron.screen.dipToScreenPoint(near);
      const found = await sidecar.locate({ label, x: physical.x, y: physical.y }).catch(() => null);
      write({ locate: label, near, found });
      if (found?.found !== true || found.x === undefined || found.y === undefined) return null;
      const real = Electron.screen.screenToDipPoint({ x: found.x, y: found.y });
      if (Math.hypot(real.x - near.x, real.y - near.y) > 160) return null;
      return { ...real, name: found.name ?? label };
    },
  });
  for (const said of REQUESTS) {
    const started = Date.now();
    write({ said });
    const done = new Promise<void>((resolve) => {
      ended = resolve;
    });
    const result = await companion.said(said, { direct: false });
    if (result.kind === "handled") {
      await Promise.race([done, sleep(45_000)]);
      await sleep(1_500);
    }
    write({ said, result: result.kind, ms: Date.now() - started });
  }
  sidecar.dispose();
  companion.dispose();
  report.end(() => Electron.app.exit(0));
};

void main().catch((error: unknown) => {
  write({ error: String(error) });
  report.end(() => Electron.app.exit(1));
});
