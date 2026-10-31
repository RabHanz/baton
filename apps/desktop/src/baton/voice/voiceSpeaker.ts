// @effect-diagnostics globalDate:off nodeBuiltinImport:off
/**
 * One voice for everything Baton says, one sentence after another. A local neural voice when its
 * files are there (free, D113); the OS voice otherwise, and after any failure. Sentences are
 * synthesised as they arrive and played in order, so a gap between two is only the part of
 * synthesis still running. Written only is enforced here, so nothing can reach the speakers.
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import type { TtsProvider } from "@t3tools/baton-voice";

/** Plays one WAV to its end; the page that does it lives in voicePlayer.ts. */
export interface VoicePlayer {
  readonly play: (wav: Buffer) => Promise<void>;
  readonly stop: () => void;
  readonly dispose: () => void;
}

/** Text to WAV bytes. The engines differ only here. */
export type Synthesise = (text: string) => { result: Promise<Buffer>; cancel: () => void };

/** Off the screen and free of markup a synthesiser would read out. */
export const speakableText = (text: string): string =>
  text
    .replace(/[`*_#>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const ENVELOPE_MS = 40;

/** The speech's loudness every 40 ms, 0..1, read out of 16-bit PCM WAV bytes. */
export const wavEnvelope = (wav: Buffer): ReadonlyArray<number> => {
  const data = wav.indexOf("data", 12, "latin1");
  if (data < 0 || wav.length < 44) return [];
  const channels = wav.readUInt16LE(22);
  const rate = wav.readUInt32LE(24);
  const start = data + 8;
  const step = Math.max(1, Math.round((rate * ENVELOPE_MS) / 1000)) * channels * 2;
  const out: number[] = [];
  for (let at = start; at + step <= wav.length; at += step) {
    let sum = 0;
    let count = 0;
    for (let i = at; i < at + step; i += 8 * channels) {
      const v = wav.readInt16LE(i) / 32768;
      sum += v * v;
      count += 1;
    }
    out.push(Math.min(1, Math.sqrt(sum / count) * 3.2));
  }
  return out;
};

export interface PiperFiles {
  readonly binary: string;
  readonly voice: string;
}

export const piperFilesIn = (dir: string, voice: string, platform: string): PiperFiles | null => {
  const binary = NodePath.join(dir, "piper", platform === "win32" ? "piper.exe" : "piper");
  const model = NodePath.join(dir, `${voice}.onnx`);
  return NodeFS.existsSync(binary) && NodeFS.existsSync(model) ? { binary, voice: model } : null;
};

/** Piper to a temp file: its stdout mode has no WAV header, and this is the one call site. */
export const piperSynthesiser = (files: PiperFiles): Synthesise => {
  let serial = 0;
  return (text) => {
    serial += 1;
    const file = NodePath.join(
      NodeOS.tmpdir(),
      `baton-say-${process.pid}-${Date.now()}-${serial}.wav`,
    );
    const proc = NodeChildProcess.spawn(
      files.binary,
      ["--model", files.voice, "--output_file", file],
      { windowsHide: true, stdio: ["pipe", "ignore", "ignore"] },
    );
    proc.stdin.on("error", () => {});
    proc.stdin.end(text);
    const result = new Promise<Buffer>((resolve, reject) => {
      proc.on("error", reject);
      proc.on("exit", (code) => {
        if (code !== 0) return reject(new Error(`piper exited ${code}`));
        void NodeFSP.readFile(file)
          .then(resolve, reject)
          .finally(() => void NodeFSP.rm(file, { force: true }).catch(() => undefined));
      });
    });
    return { result, cancel: () => proc.kill() };
  };
};

export interface Speaker extends TtsProvider {
  readonly cancel: () => void;
  readonly dispose: () => void;
}

export const createSpeaker = (input: {
  readonly os: TtsProvider;
  /** The chosen voice, or null for the OS voice. Asked per sentence, so a change applies at once. */
  readonly voice: () => Synthesise | null;
  readonly player: VoicePlayer;
  /** Written only: nothing is synthesised and nothing plays. */
  readonly silent?: () => boolean;
  readonly onActive?: (active: boolean) => void;
}): Speaker => {
  const running = new Set<() => void>();
  let generation = 0;
  let queued = 0;
  let tail: Promise<void> = Promise.resolve();

  const speak = (raw: string): Promise<void> => {
    if (input.silent?.() === true) return Promise.resolve();
    const text = speakableText(raw);
    if (text.length === 0) return Promise.resolve();
    const mine = generation;
    // Started now, not in the queue: the next sentence is ready when this one ends.
    const job = input.voice()?.(text) ?? null;
    if (job !== null) running.add(job.cancel);
    const wav = job === null ? null : job.result.catch(() => null);
    if (queued === 0) input.onActive?.(true);
    queued += 1;
    const turn = tail.then(async () => {
      if (mine !== generation) return;
      const bytes = wav === null ? null : await wav;
      if (job !== null) running.delete(job.cancel);
      if (mine !== generation) return;
      if (bytes === null) await input.os.speak(text).catch(() => undefined);
      else await input.player.play(bytes).catch(() => undefined);
    });
    tail = turn.finally(() => {
      queued -= 1;
      if (queued === 0) input.onActive?.(false);
    });
    return tail;
  };

  const cancel = () => {
    generation += 1;
    for (const stop of running) stop();
    running.clear();
    input.player.stop();
  };

  return {
    name: "baton",
    speak,
    cancel,
    dispose: () => {
      cancel();
      input.player.dispose();
    },
  };
};
