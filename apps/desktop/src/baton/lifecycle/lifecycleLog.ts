// @effect-diagnostics nodeBuiltinImport:off globalDate:off
/**
 * Why Baton went down (D139). One line each in `baton-lifecycle.ndjson`, written synchronously so a
 * crash still leaves its record, kept across restarts and rotated by size. A start with no clean
 * exit before it is itself a finding: the last run was killed, crashed or lost power.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

const MAX_BYTES = 2 * 1024 * 1024;
const KEEP = 3;

export type ExitReason = "update" | "quit" | "system" | "crash";

export interface LifecycleLog {
  /** Say why the next exit is happening, before it does. */
  readonly willExitFor: (reason: ExitReason, detail?: string) => void;
  readonly note: (event: string, detail?: Record<string, unknown>) => void;
  /** Who was running before this one ended badly, or null. */
  readonly previousRunEndedBadly: () => boolean;
}

const appendRotating = (file: string, line: string): void => {
  try {
    NodeFS.mkdirSync(NodePath.dirname(file), { recursive: true });
    if (NodeFS.existsSync(file) && NodeFS.statSync(file).size + line.length > MAX_BYTES) {
      for (let i = KEEP - 1; i >= 1; i -= 1) {
        if (NodeFS.existsSync(`${file}.${i}`))
          NodeFS.renameSync(`${file}.${i}`, `${file}.${i + 1}`);
      }
      NodeFS.renameSync(file, `${file}.1`);
    }
    NodeFS.appendFileSync(file, line);
  } catch {
    // Logging must never be the thing that takes Baton down.
  }
};

export const createLifecycleLog = (input: {
  readonly file: string;
  /** A small file that exists only while a run is alive. */
  readonly runningFile: string;
  readonly version: string;
}): LifecycleLog => {
  const write = (event: string, detail: Record<string, unknown> = {}) =>
    appendRotating(
      input.file,
      `${JSON.stringify({ at: new Date().toISOString(), pid: process.pid, event, ...detail })}\n`,
    );
  let intended: { reason: ExitReason; detail?: string } | null = null;

  const left = NodeFS.existsSync(input.runningFile)
    ? (() => {
        try {
          return JSON.parse(NodeFS.readFileSync(input.runningFile, "utf8")) as {
            at?: string;
            pid?: number;
          };
        } catch {
          return {};
        }
      })()
    : null;
  if (left !== null) {
    write("previous-run-ended-badly", {
      startedAt: left.at ?? null,
      previousPid: left.pid ?? null,
      meaning: "no clean exit was recorded: a crash, a kill or a power loss",
    });
  }
  NodeFS.mkdirSync(NodePath.dirname(input.runningFile), { recursive: true });
  NodeFS.writeFileSync(
    input.runningFile,
    JSON.stringify({ at: new Date().toISOString(), pid: process.pid, version: input.version }),
  );
  write("start", { version: input.version });

  const cleanExit = (fallback: ExitReason) => {
    write("exit", {
      reason: intended?.reason ?? fallback,
      ...(intended?.detail ? { detail: intended.detail } : {}),
    });
    try {
      NodeFS.rmSync(input.runningFile, { force: true });
    } catch {
      // A leftover file only makes the next start report an unclean exit.
    }
  };
  process.once("exit", () => cleanExit("quit"));
  // Observes without taking over: Electron still shows its own error and ends the process.
  process.on("uncaughtExceptionMonitor", (error, origin) => {
    intended = { reason: "crash", detail: origin };
    write("uncaught-exception", { origin, message: error.message, stack: error.stack ?? null });
  });
  process.on("unhandledRejection", (reason) => {
    write("unhandled-rejection", {
      message: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? (reason.stack ?? null) : null,
    });
  });

  return {
    willExitFor: (reason, detail) => {
      intended = detail === undefined ? { reason } : { reason, detail };
      write("exiting", { reason, ...(detail === undefined ? {} : { detail }) });
    },
    note: write,
    previousRunEndedBadly: () => left !== null,
  };
};
