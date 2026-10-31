// @effect-diagnostics globalDate:off nodeBuiltinImport:off
/**
 * One voice for everything Baton says, one sentence after another. Piper's British voice when its
 * files are there (free and local, D102); the OS voice otherwise, and after any Piper failure.
 * Sentences are synthesised as they arrive and played in order, so a gap between two is only the
 * part of synthesis that is still running.
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import type { TtsProvider } from "@t3tools/baton-voice";

export interface PiperFiles {
  readonly binary: string;
  readonly voice: string;
}

/** Off the screen and free of markup a synthesiser would read out. */
export const speakableText = (text: string): string =>
  text
    .replace(/[`*_#>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const piperFilesIn = (dir: string): PiperFiles | null => {
  const binary = NodePath.join(dir, "piper", "piper.exe");
  const voice = NodePath.join(dir, "en_GB-cori-high.onnx");
  return NodeFS.existsSync(binary) && NodeFS.existsSync(voice) ? { binary, voice } : null;
};

// Synchronous playback in a long-lived shell: starting PowerShell per sentence costs half a second.
const PLAYER = `$ErrorActionPreference='Continue'; while($null -ne ($f=[Console]::In.ReadLine())){ try{ (New-Object Media.SoundPlayer $f).PlaySync() }catch{}; [Console]::Out.WriteLine('done'); [Console]::Out.Flush() }`;

export interface Speaker extends TtsProvider {
  readonly cancel: () => void;
  readonly dispose: () => void;
}

export const createSpeaker = (input: {
  readonly os: TtsProvider;
  readonly piper: () => PiperFiles | null;
  readonly onActive?: (active: boolean) => void;
}): Speaker => {
  let player: NodeChildProcess.ChildProcessWithoutNullStreams | null = null;
  let playing: (() => void) | null = null;
  let synth: Set<NodeChildProcess.ChildProcess> = new Set();
  let generation = 0;
  let queued = 0;
  let tail: Promise<void> = Promise.resolve();

  const finishPlay = () => {
    const done = playing;
    playing = null;
    done?.();
  };
  const ensurePlayer = () => {
    if (player !== null) return player;
    const proc = NodeChildProcess.spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", PLAYER],
      { windowsHide: true },
    );
    proc.stderr.resume();
    proc.stdin.on("error", () => {});
    proc.stdout.on("data", () => finishPlay());
    proc.on("error", () => finishPlay());
    proc.on("exit", () => {
      if (player === proc) player = null;
      finishPlay();
    });
    player = proc;
    return proc;
  };

  const synthesise = (files: PiperFiles, text: string): Promise<string> =>
    new Promise((resolve, reject) => {
      const file = NodePath.join(
        NodeOS.tmpdir(),
        `baton-say-${process.pid}-${Date.now()}-${generation}-${queued}.wav`,
      );
      const proc = NodeChildProcess.spawn(
        files.binary,
        ["--model", files.voice, "--output_file", file],
        { windowsHide: true, stdio: ["pipe", "ignore", "ignore"] },
      );
      synth.add(proc);
      proc.on("error", reject);
      proc.on("exit", (code) => {
        synth.delete(proc);
        if (code === 0) resolve(file);
        else reject(new Error(`piper exited ${code}`));
      });
      proc.stdin.on("error", () => {});
      proc.stdin.end(text);
    });

  const play = (file: string): Promise<void> =>
    new Promise((resolve) => {
      playing = resolve;
      ensurePlayer().stdin.write(`${file}\n`);
    });

  const speak = (raw: string): Promise<void> => {
    const text = speakableText(raw);
    if (text.length === 0) return Promise.resolve();
    const mine = generation;
    const files = input.piper();
    // Started now, not in the queue: the next sentence is ready when this one ends.
    const wav = files === null ? null : synthesise(files, text).catch(() => null);
    wav?.catch(() => undefined);
    if (queued === 0) input.onActive?.(true);
    queued += 1;
    const turn = tail.then(async () => {
      if (mine !== generation) return;
      const path = wav === null ? null : await wav;
      if (mine !== generation) return;
      if (path === null) await input.os.speak(text).catch(() => undefined);
      else {
        await play(path);
        await NodeFSP.rm(path, { force: true }).catch(() => undefined);
      }
    });
    tail = turn.finally(() => {
      queued -= 1;
      if (queued === 0) input.onActive?.(false);
    });
    return tail;
  };

  const cancel = () => {
    generation += 1;
    for (const proc of synth) proc.kill();
    synth = new Set();
    player?.kill();
    player = null;
    finishPlay();
  };

  return {
    name: "baton",
    speak,
    cancel,
    dispose: () => {
      cancel();
    },
  };
};
