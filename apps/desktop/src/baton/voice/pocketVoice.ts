// @effect-diagnostics globalDate:off globalFetch:off globalRandom:off globalTimers:off nodeBuiltinImport:off
/**
 * Pocket TTS (Kyutai, MIT code, CC-BY-4.0 weights and voices, D113): their standalone binary kept
 * loaded and asked over loopback HTTP, so a sentence starts in a third of a second on the i7-8550U.
 * Files come down on first use, hash-checked by voiceModels.ts. It stops after ten quiet minutes,
 * because it holds 700 MB.
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import { POCKET_CONFIG_FULL, POCKET_CONFIG_QUICK } from "./pocketConfigs.ts";
import type { Synthesise } from "./voiceSpeaker.ts";
import { ensureModel, type DownloadableModel } from "./voiceModels.ts";

export const POCKET_VOICES = ["anna", "vera", "charles", "paul"] as const;
/** A chosen voice: the full model's four, or the small model for a tight machine. */
export type PocketVoice = (typeof POCKET_VOICES)[number] | "quick";

const RELEASE = "https://github.com/kyutai-labs/pocket-tts/releases/download/v4.0.1";
const HF = "https://huggingface.co/kyutai/pocket-tts-without-voice-cloning/resolve";
const MODELS = "a7056f505a4a8ca72d8b5fb1440071d6f1a35739";
const TOKENIZER = "00eac05ed3d16bdc3f6b5d598874019c34a89214";
const TOKENIZER_QUICK = "08ffc58775e62aad9409511b9591c9af626270f3";
const VOICES = "a3055dcb533cf2ec90458008a01e7cef550bae2a";

/** Only the Windows build has run here; the others are queued (TEST_MATRIX). */
const BINARIES: Record<string, { readonly asset: string; readonly sha256: string }> = {
  "win32-x64": {
    asset: "pocket-tts-3.3.0-x86_64-pc-windows-msvc.zip",
    sha256: "98753041f2e65744b989776f87bccb93f1f574a08afe1890c5427ec94cd6309c",
  },
};

const model = (
  file: string,
  path: string,
  rev: string,
  size: number,
  sha256: string,
): DownloadableModel => ({ file, url: `${HF}/${rev}/languages/${path}`, size, sha256 });

const VOICE_FILES: Record<(typeof POCKET_VOICES)[number], DownloadableModel> = {
  anna: model(
    "anna.safetensors",
    "english/embeddings/anna.safetensors",
    VOICES,
    7620408,
    "4f1a928fc92ae04367324cc5d880745c1e6680bd56bf99e5d26a1e80c2cff421",
  ),
  vera: model(
    "vera.safetensors",
    "english/embeddings/vera.safetensors",
    VOICES,
    6686520,
    "6deb7eb7606810edbba1c9639376d6750a8f441e464e279c43341debf5c29765",
  ),
  charles: model(
    "charles.safetensors",
    "english/embeddings/charles.safetensors",
    VOICES,
    6195000,
    "21806203b56a8ee954b66a33fcdea636c67cd54760f20f12f7586062d9455337",
  ),
  paul: model(
    "paul.safetensors",
    "english/embeddings/paul.safetensors",
    VOICES,
    6833976,
    "02b77e48b791c7ece818d7f85b98459bc8dc035104e6327635053ffb56898050",
  ),
};

const FULL_FILES = [
  model(
    "model.safetensors",
    "english/model.safetensors",
    MODELS,
    219029196,
    "4c56cbd171c63e8a26ea61f5d48b8a0cd8f3c51f4652c0ab9a19bfcced8c931d",
  ),
  model(
    "tokenizer.json",
    "english/tokenizer.json",
    TOKENIZER,
    245020,
    "f498428e1eafee50492f7be13dc9bfafcfc12e508cd0eb1b01c92ecd5d8c6687",
  ),
];

const QUICK_FILES = [
  model(
    "model.safetensors",
    "english_7m_2026-10/model.safetensors",
    MODELS,
    66482920,
    "aea704a2989277c1a700abc16fb1442cb6baa2fa9ad32251ef7a5f91e4eb7d58",
  ),
  model(
    "tokenizer.model",
    "english_7m_2026-10/tokenizer.model",
    TOKENIZER_QUICK,
    59339,
    "d461765ae179566678c93091c5fa6f2984c31bbe990bf1aa62d92c64d91bc3f6",
  ),
  model(
    "anna.safetensors",
    "english_7m_2026-10/embeddings/anna.safetensors",
    VOICES,
    1272208,
    "2834123280d7de036c9c3414b76732e58c0d10f17ab7e99e1ec63cf334f53317",
  ),
];

export interface PocketPlan {
  readonly dir: string;
  readonly files: ReadonlyArray<DownloadableModel>;
  readonly config: string;
  readonly voiceFile: string;
}

/** Which files a voice needs and the config that points at them. */
export const pocketPlan = (root: string, voice: PocketVoice): PocketPlan => {
  const quick = voice === "quick";
  const dir = NodePath.join(root, quick ? "quick" : "english");
  const slash = dir.replaceAll("\\", "/");
  return {
    dir,
    files: quick ? QUICK_FILES : [...FULL_FILES, VOICE_FILES[voice]],
    config: (quick ? POCKET_CONFIG_QUICK : POCKET_CONFIG_FULL).replaceAll("{dir}", slash),
    voiceFile: quick ? "anna.safetensors" : `${voice}.safetensors`,
  };
};

const IDLE_STOP_MS = 10 * 60_000;
const READY_MS = 30_000;
/** Two threads gave the same first audio as four at a third less memory. */
const THREADS = "2";

export interface PocketEngine {
  /** The chosen voice, or null while its files are not here, which starts fetching them. */
  readonly synthesise: (voice: PocketVoice) => Synthesise | null;
  readonly dispose: () => void;
}

export const createPocketEngine = (input: {
  readonly root: string;
  readonly platform: string;
  readonly arch: string;
  readonly onProgress: (message: string | null) => void;
}): PocketEngine => {
  const build = BINARIES[`${input.platform}-${input.arch}`];
  const binary = NodePath.join(input.root, "bin", input.platform === "win32" ? "pocket-tts.exe" : "pocket-tts");
  let server: { proc: NodeChildProcess.ChildProcess; port: number; voice: PocketVoice; up: Promise<void> } | null = null;
  let fetching = false;
  const ready = new Set<PocketVoice>();
  let idle: ReturnType<typeof setTimeout> | null = null;

  const stop = () => {
    server?.proc.kill();
    server = null;
  };

  const fetchFiles = async (voice: PocketVoice) => {
    if (fetching || build === undefined) return;
    fetching = true;
    try {
      const plan = pocketPlan(input.root, voice);
      await NodeFSP.mkdir(plan.dir, { recursive: true });
      const total = plan.files.reduce((sum, file) => sum + file.size, 0);
      let done = 0;
      for (const file of plan.files) {
        await ensureModel({
          dir: plan.dir,
          model: file,
          onProgress: (fraction) =>
            input.onProgress(
              `Downloading the voice: ${Math.round(((done + file.size * fraction) / total) * 100)}%`,
            ),
        });
        done += file.size;
      }
      if (!NodeFS.existsSync(binary)) {
        const bin = NodePath.dirname(binary);
        const archive = NodePath.join(bin, build.asset);
        await NodeFSP.mkdir(bin, { recursive: true });
        const response = await fetch(`${RELEASE}/${build.asset}`);
        if (!response.ok) throw new Error(`Could not download the voice (${response.status}).`);
        const bytes = Buffer.from(await response.arrayBuffer());
        const { createHash } = await import("node:crypto");
        if (createHash("sha256").update(bytes).digest("hex") !== build.sha256) {
          throw new Error("The voice did not match its checksum.");
        }
        await NodeFSP.writeFile(archive, bytes);
        // tar ships with Windows 10 and later and reads zip.
        await new Promise<void>((resolve, reject) =>
          NodeChildProcess.execFile("tar", ["-xf", archive, "-C", bin], (error) =>
            error === null ? resolve() : reject(error),
          ),
        );
        await NodeFSP.rm(archive, { force: true });
      }
      await NodeFSP.writeFile(NodePath.join(plan.dir, "config.yaml"), plan.config, "utf8");
      ready.add(voice);
      input.onProgress(null);
    } catch (error) {
      input.onProgress(error instanceof Error ? error.message : "The voice download failed.");
    } finally {
      fetching = false;
    }
  };

  const present = (voice: PocketVoice): boolean => {
    if (ready.has(voice)) return true;
    const plan = pocketPlan(input.root, voice);
    const here =
      NodeFS.existsSync(binary) &&
      NodeFS.existsSync(NodePath.join(plan.dir, "config.yaml")) &&
      plan.files.every((file) => NodeFS.existsSync(NodePath.join(plan.dir, file.file)));
    if (here) ready.add(voice);
    return here;
  };

  const start = (voice: PocketVoice) => {
    if (server?.voice === voice) return server;
    stop();
    const plan = pocketPlan(input.root, voice);
    const port = 49_152 + Math.floor(Math.random() * 16_000);
    const proc = NodeChildProcess.spawn(
      binary,
      [
        "serve",
        "--host",
        "127.0.0.1",
        "--port",
        String(port),
        "--config",
        NodePath.join(plan.dir, "config.yaml"),
        "--default-voice",
        NodePath.join(plan.dir, plan.voiceFile),
      ],
      {
        windowsHide: true,
        stdio: "ignore",
        cwd: plan.dir,
        env: { ...process.env, RAYON_NUM_THREADS: THREADS },
      },
    );
    const up = (async () => {
      const deadline = Date.now() + READY_MS;
      for (;;) {
        if (proc.exitCode !== null) throw new Error("The voice stopped.");
        const ok = await fetch(`http://127.0.0.1:${port}/health`).then(
          (r) => r.ok,
          () => false,
        );
        if (ok) return;
        if (Date.now() > deadline) throw new Error("The voice took too long to start.");
        await new Promise((r) => setTimeout(r, 120));
      }
    })();
    const entry = { proc, port, voice, up };
    proc.on("exit", () => {
      if (server === entry) server = null;
    });
    proc.on("error", () => undefined);
    up.catch(() => undefined);
    server = entry;
    return entry;
  };

  return {
    synthesise: (voice) => {
      if (build === undefined) return null;
      if (!present(voice)) {
        void fetchFiles(voice);
        return null;
      }
      return (text) => {
        if (idle !== null) clearTimeout(idle);
        idle = setTimeout(stop, IDLE_STOP_MS);
        const abort = new AbortController();
        const stream = (async function* () {
          const { port, up } = start(voice);
          await up;
          const response = await fetch(`http://127.0.0.1:${port}/tts`, {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ text }).toString(),
            signal: abort.signal,
          });
          if (!response.ok || response.body === null) {
            throw new Error(`The voice answered ${response.status}.`);
          }
          for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
            yield Buffer.from(chunk);
          }
        })();
        return { stream, cancel: () => abort.abort() };
      };
    },
    dispose: () => {
      if (idle !== null) clearTimeout(idle);
      stop();
    },
  };
};
