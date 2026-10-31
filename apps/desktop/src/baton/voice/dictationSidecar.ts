// @effect-diagnostics globalDate:off globalTimers:off nodeBuiltinImport:off
/**
 * `baton-dictation` (native/baton-dictation): Handy's engine stack as a child process. It owns
 * the hold and toggle keys, the recording, Parakeet and the paste; this file is the line protocol.
 * The same binary is the wake path's microphone (`makeSidecarAudioInput`), so what voice-lab
 * measures is exactly what the product hears.
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeReadline from "node:readline";

import { encodeWav, type SttProvider } from "@t3tools/baton-voice";

import { makeFramer } from "./pcm.ts";
import type { AudioInputDevice, AudioInputProvider } from "./voiceTypes.ts";

export type PasteMethod = "ctrl_v" | "shift_insert" | "ctrl_shift_v";

export interface DictationConfig {
  readonly model: string | null;
  /** null while Wispr is the chosen engine: Baton then holds no global key at all. */
  readonly hold: string | null;
  readonly toggle: string | null;
  readonly device: string | null;
  readonly channel: number | null;
  readonly paste: PasteMethod;
  readonly language: string | null;
  /** The sidecar leaves the paste to the desktop, which cleans the text up first. */
  readonly cleanup: boolean;
}

export interface FocusedApp {
  readonly exe: string;
  readonly title: string;
  readonly window?: number;
  /** Physical pixels; null when the OS would not say. */
  readonly rect?: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  } | null;
}

/** The accessibility tree's element for a label, in physical pixels. */
export interface LocatedElement {
  readonly found: boolean;
  readonly name?: string;
  readonly x?: number;
  readonly y?: number;
  readonly error?: string;
}

export type DictationEvent =
  | { readonly ev: "ready" }
  | { readonly ev: "configured" }
  | { readonly ev: "recording"; readonly app?: string; readonly title?: string }
  | { readonly ev: "transcribing" }
  | { readonly ev: "idle" }
  | { readonly ev: "error"; readonly message: string }
  /** The paste chord went out and nothing read the clipboard. */
  | { readonly ev: "unread"; readonly text: string }
  | {
      readonly ev: "text";
      readonly id: number | null;
      readonly text?: string;
      readonly error?: string;
      readonly pasteError?: string | null;
      readonly dictated?: boolean;
      readonly pasted?: boolean;
      /** The window it was spoken for; null when it must not be pasted. */
      readonly target?: number | null;
      readonly releaseMs?: number | null;
    };

export interface SidecarDevice {
  readonly name: string;
  readonly channels: number | null;
}

export interface DictationSidecar {
  readonly configure: (config: DictationConfig) => void;
  readonly toggle: () => void;
  readonly cancel: () => void;
  readonly devices: () => Promise<ReadonlyArray<SidecarDevice>>;
  readonly transcribe: (wavPath: string) => Promise<string>;
  readonly paste: (text: string) => Promise<void>;
  /** False when that window is no longer the focused one, and nothing was pasted. */
  readonly pasteInto: (text: string, target: number) => Promise<boolean>;
  readonly foreground: () => Promise<FocusedApp>;
  /** The top-level window under a physical point. */
  readonly windowAt: (point: {
    readonly x: number;
    readonly y: number;
  }) => Promise<{ readonly window: number; readonly label: string } | null>;
  /** Lab only (BATON_LAB): real mouse input from inside the sidecar. */
  readonly nudge: (dx: number, dy: number) => void;
  readonly locate: (input: {
    readonly label: string;
    readonly x: number;
    readonly y: number;
  }) => Promise<LocatedElement>;
  readonly dispose: () => void;
}

/** Packaged next to the app; BATON_DICTATION points a dev build at a local binary. */
export const resolveDictationBinary = (input: {
  readonly resourcesPath: string;
  readonly platform: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly exists?: (path: string) => boolean;
}): string | null => {
  const exists = input.exists ?? NodeFS.existsSync;
  const candidates = [
    input.env["BATON_DICTATION"],
    NodePath.join(
      input.resourcesPath,
      "baton-voice",
      input.platform === "win32" ? "baton-dictation.exe" : "baton-dictation",
    ),
  ];
  return candidates.find((path): path is string => path !== undefined && exists(path)) ?? null;
};

/** The sidecar's foreground event. Without `window` a drive cannot see the keyboard move. */
export const focusedFrom = (event: Readonly<Record<string, unknown>>): FocusedApp => {
  const { app, title, rect, window } = event as {
    app?: string;
    title?: string;
    rect?: FocusedApp["rect"];
    window?: number;
  };
  return {
    exe: app ?? "",
    title: title ?? "",
    rect: rect ?? null,
    ...(typeof window === "number" && window !== 0 ? { window } : {}),
  };
};

const CALL_TIMEOUT_MS = 120_000;
/** A process that lived this long was working, so its next failure starts the backoff again. */
export const HEALTHY_RUN_MS = 30_000;

/** Seconds, not a hot loop: 1, 2, 4 … up to a minute. */
export const restartDelayMs = (failures: number): number =>
  Math.min(60_000, 1_000 * 2 ** Math.max(0, failures - 1));

const lastLine = (text: string): string | null => {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  return lines.length === 0 ? null : lines[lines.length - 1]!.slice(0, 200);
};

export const startDictationSidecar = (input: {
  readonly binary: string;
  readonly onEvent: (event: DictationEvent) => void;
}): DictationSidecar => {
  let child: NodeChildProcess.ChildProcessWithoutNullStreams | null = null;
  let disposed = false;
  let lastConfig: DictationConfig | null = null;
  let nextId = 0;
  type Pending = { resolve: (value: never) => void; reject: (error: Error) => void };
  const pending = new Map<number, Pending>();
  let deviceWaiters: Array<(devices: ReadonlyArray<SidecarDevice>) => void> = [];
  let failures = 0;

  const send = (message: unknown) => {
    if (child?.stdin.writable === true) child.stdin.write(`${JSON.stringify(message)}\n`);
  };
  const settle = (id: number | null | undefined, result: { value?: unknown; error?: string }) => {
    const entry = id === null || id === undefined ? undefined : pending.get(id);
    if (entry === undefined) return;
    pending.delete(id as number);
    if (result.error !== undefined) entry.reject(new Error(result.error));
    else entry.resolve(result.value as never);
  };
  const call = <T>(message: Record<string, unknown>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve: resolve as (value: never) => void, reject });
      send({ ...message, id });
      setTimeout(() => settle(id, { error: "Dictation did not answer." }), CALL_TIMEOUT_MS);
    });

  const spawn = () => {
    const proc = NodeChildProcess.spawn(input.binary, ["serve"], { windowsHide: true });
    child = proc;
    const startedAt = Date.now();
    let stderr = "";
    proc.stderr.on("data", (data: Buffer) => {
      stderr = (stderr + data.toString()).slice(-2_000);
    });
    // The exit handler restarts it; a write in the gap after it died must not throw.
    proc.stdin.on("error", () => {});
    proc.on("error", (error) => input.onEvent({ ev: "error", message: error.message }));
    NodeReadline.createInterface({ input: proc.stdout }).on("line", (line) => {
      let event: Record<string, unknown>;
      try {
        event = JSON.parse(line) as Record<string, unknown>;
      } catch {
        return;
      }
      if (event["ev"] === "devices") {
        const devices = (event["devices"] as ReadonlyArray<SidecarDevice>) ?? [];
        deviceWaiters.forEach((resolve) => resolve(devices));
        deviceWaiters = [];
        return;
      }
      if (event["ev"] === "pasted") {
        const error = typeof event["error"] === "string" ? event["error"] : undefined;
        return settle(
          event["id"] as number,
          error === undefined ? { value: event["moved"] !== true } : { error },
        );
      }
      if (event["ev"] === "foreground") {
        return settle(event["id"] as number, { value: focusedFrom(event) });
      }
      if (event["ev"] === "window_at") {
        const { window, app, title } = event as { window?: number; app?: string; title?: string };
        return settle(event["id"] as number, {
          value:
            typeof window === "number" && window !== 0
              ? { window, label: `${app ?? ""}: ${title ?? ""}` }
              : null,
        });
      }
      if (event["ev"] === "located") {
        return settle(event["id"] as number, { value: event });
      }
      if (event["ev"] === "text" && event["dictated"] !== true) {
        const error = typeof event["error"] === "string" ? event["error"] : undefined;
        return settle(
          event["id"] as number,
          error === undefined ? { value: event["text"] } : { error },
        );
      }
      input.onEvent(event as unknown as DictationEvent);
    });
    proc.on("exit", () => {
      child = null;
      for (const entry of pending.values()) entry.reject(new Error("Dictation stopped."));
      pending.clear();
      deviceWaiters.forEach((resolve) => resolve([]));
      deviceWaiters = [];
      if (disposed) return;
      failures = Date.now() - startedAt >= HEALTHY_RUN_MS ? 1 : failures + 1;
      const delay = restartDelayMs(failures);
      const reason = lastLine(stderr) ?? "it exited";
      input.onEvent({
        ev: "error",
        message: `Dictation stopped (${reason}). Trying again in ${Math.round(delay / 1000)} s.`,
      });
      setTimeout(() => {
        if (disposed) return;
        spawn();
        if (lastConfig !== null) send({ cmd: "configure", ...lastConfig });
      }, delay);
    });
  };
  spawn();

  return {
    configure: (config) => {
      lastConfig = config;
      send({ cmd: "configure", ...config });
    },
    toggle: () => send({ cmd: "toggle" }),
    cancel: () => send({ cmd: "cancel" }),
    devices: () =>
      new Promise((resolve) => {
        deviceWaiters.push(resolve);
        send({ cmd: "devices" });
      }),
    transcribe: (wav) => call<string>({ cmd: "transcribe", wav }),
    paste: (text) => call<void>({ cmd: "paste", text }),
    pasteInto: (text, target) => call<boolean>({ cmd: "paste", text, target }),
    foreground: () => call<FocusedApp>({ cmd: "foreground" }),
    windowAt: ({ x, y }) =>
      call<{ window: number; label: string } | null>({ cmd: "window_at", x, y }),
    nudge: (dx, dy) => send({ cmd: "nudge", dx, dy }),
    locate: (input) => call<LocatedElement>({ cmd: "locate", ...input }),
    dispose: () => {
      disposed = true;
      child?.stdin.end();
      child?.kill();
    },
  };
};

/** Parakeet behind the core's `SttProvider`, in the sidecar that already holds the model. */
export const makeSidecarStt = (sidecar: DictationSidecar): SttProvider => ({
  name: "parakeet",
  transcribe: async (pcm) => {
    const dir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "baton-voice-"));
    const file = NodePath.join(dir, "utterance.wav");
    try {
      await NodeFSP.writeFile(file, encodeWav(pcm));
      return await sidecar.transcribe(file);
    } finally {
      await NodeFSP.rm(dir, { recursive: true, force: true });
    }
  },
});

/** Wake-word capture: `baton-dictation record` piped straight in, with no browser in the path. */
export const makeSidecarAudioInput = (input: {
  readonly binary: string;
  readonly listDevices: () => Promise<ReadonlyArray<AudioInputDevice>>;
  /** The input of a multi-input interface to read, for a device. */
  readonly channelFor: (device: string) => number | null;
  /** The recorder ended without being asked: the device probably left. */
  readonly onLost: (reason: string | null, ranMs: number) => void;
}): AudioInputProvider => {
  let proc: NodeChildProcess.ChildProcessWithoutNullStreams | null = null;
  return {
    listDevices: input.listDevices,
    start: async ({ deviceId, onFrame }) => {
      proc?.kill();
      const channel = deviceId === null ? null : input.channelFor(deviceId);
      const args = [
        "record",
        ...(deviceId === null ? [] : ["--device", deviceId]),
        ...(channel === null ? [] : ["--channel", String(channel)]),
      ];
      const started = NodeChildProcess.spawn(input.binary, args, { windowsHide: true });
      proc = started;
      const framer = makeFramer(onFrame);
      let odd: Buffer | null = null;
      started.stdout.on("data", (data: Buffer) => {
        const joined = odd === null ? data : Buffer.concat([odd, data]);
        const usable = joined.length - (joined.length % 2);
        odd = usable === joined.length ? null : joined.subarray(usable);
        // Copied: a Buffer's pool offset is not always aligned for Int16Array.
        const samples = new Int16Array(usable / 2);
        Buffer.from(samples.buffer).set(joined.subarray(0, usable));
        framer(samples);
      });
      const startedAt = Date.now();
      let stderr = "";
      started.stderr.on("data", (data: Buffer) => {
        stderr = (stderr + data.toString()).slice(-2_000);
      });
      // "exit" does not fire when the spawn itself failed, such as a quarantined exe.
      const lost = () => {
        if (proc !== started) return;
        proc = null;
        input.onLost(lastLine(stderr), Date.now() - startedAt);
      };
      started.on("error", (error) => {
        stderr += `\n${error.message}`;
        lost();
      });
      started.on("exit", lost);
    },
    stop: async () => {
      const running = proc;
      proc = null;
      running?.kill();
    },
  };
};
