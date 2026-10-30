// @effect-diagnostics globalTimers:off nodeBuiltinImport:off
/**
 * `baton-dictation.exe` (native/baton-dictation): Handy's engine stack as a child process. It owns
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
}

export type DictationEvent =
  | { readonly ev: "ready" }
  | { readonly ev: "configured" }
  | { readonly ev: "recording" }
  | { readonly ev: "transcribing" }
  | { readonly ev: "idle" }
  | { readonly ev: "error"; readonly message: string }
  | {
      readonly ev: "text";
      readonly id: number | null;
      readonly text?: string;
      readonly error?: string;
      readonly pasteError?: string | null;
      readonly dictated?: boolean;
    };

export interface SidecarDevice {
  readonly name: string;
  readonly channels: number | null;
}

export interface DictationSidecar {
  readonly configure: (config: DictationConfig) => void;
  readonly toggle: () => void;
  readonly devices: () => Promise<ReadonlyArray<SidecarDevice>>;
  readonly transcribe: (wavPath: string) => Promise<string>;
  readonly paste: (text: string) => Promise<void>;
  readonly dispose: () => void;
}

/** Packaged next to the app; BATON_DICTATION points a dev build at a local exe. */
export const resolveDictationBinary = (input: {
  readonly resourcesPath: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly exists?: (path: string) => boolean;
}): string | null => {
  const exists = input.exists ?? NodeFS.existsSync;
  const candidates = [
    input.env["BATON_DICTATION"],
    NodePath.join(input.resourcesPath, "baton-voice", "baton-dictation.exe"),
  ];
  return candidates.find((path): path is string => path !== undefined && exists(path)) ?? null;
};

const RESTART_DELAY_MS = 3_000;
const CALL_TIMEOUT_MS = 120_000;

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

  const send = (message: unknown) => child?.stdin.write(`${JSON.stringify(message)}\n`);
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
    proc.stderr.resume();
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
        return settle(event["id"] as number, error === undefined ? {} : { error });
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
      if (disposed) return;
      input.onEvent({ ev: "error", message: "Dictation stopped. Restarting it." });
      setTimeout(() => {
        if (disposed) return;
        spawn();
        if (lastConfig !== null) send({ cmd: "configure", ...lastConfig });
      }, RESTART_DELAY_MS);
    });
  };
  spawn();

  return {
    configure: (config) => {
      lastConfig = config;
      send({ cmd: "configure", ...config });
    },
    toggle: () => send({ cmd: "toggle" }),
    devices: () =>
      new Promise((resolve) => {
        deviceWaiters.push(resolve);
        send({ cmd: "devices" });
      }),
    transcribe: (wav) => call<string>({ cmd: "transcribe", wav }),
    paste: (text) => call<void>({ cmd: "paste", text }),
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
  readonly sidecar: DictationSidecar;
  /** The input of a multi-input interface to read, for a device. */
  readonly channelFor: (device: string) => number | null;
  /** The recorder ended without being asked: the device probably left. */
  readonly onLost: () => void;
}): AudioInputProvider => {
  let proc: NodeChildProcess.ChildProcessWithoutNullStreams | null = null;
  return {
    listDevices: async (): Promise<ReadonlyArray<AudioInputDevice>> =>
      (await input.sidecar.devices()).map((d) => ({ deviceId: d.name, label: d.name })),
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
      started.stderr.resume();
      started.on("exit", () => {
        if (proc === started) {
          proc = null;
          input.onLost();
        }
      });
    },
    stop: async () => {
      const running = proc;
      proc = null;
      running?.kill();
    },
  };
};
