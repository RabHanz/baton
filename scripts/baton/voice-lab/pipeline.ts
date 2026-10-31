/**
 * The whole voice path on real parts, from a WAV instead of the mic: openWakeWord, Silero, Parakeet
 * in the sidecar, the one brain on his claude, the real router and grammar. Nothing here opens a
 * microphone. Speech is logged instead of played.
 *   node pipeline.mjs --models DIR --gguf FILE --exe baton-dictation.exe --wavs DIR
 */
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { startVisionSession } from "../../../apps/desktop/src/baton/screen/claudeVision.ts";
import {
  makeSidecarStt,
  startDictationSidecar,
} from "../../../apps/desktop/src/baton/voice/dictationSidecar.ts";
import { withBrainRoutes } from "../../../apps/desktop/src/baton/voice/desktopVoiceCore.ts";
import { BRAIN_ROUTER_PROMPT, decide } from "../../../packages/baton-shared/src/brain.ts";
import { resolveBatonIntent } from "../../../packages/baton-shared/src/intentParser.ts";
import { createVoiceCore, DEFAULT_TIMINGS, createVoiceRouter } from "../../../packages/baton-voice/src/index.ts";
import { createOpenWakeWordProvider, createSileroVad } from "../../../packages/baton-voice/src/providers/onnx.ts";
import { fleet, grammarClient } from "../../../packages/baton-voice/test/grammarClient.ts";

const flag = (name: string): string => process.argv[process.argv.indexOf(name) + 1]!;
const FRAME = 512;

const readPcm = (file: string): Int16Array => {
  const wav = NodeFS.readFileSync(file);
  const data = wav.indexOf("data", 12) + 8;
  const copy = wav.subarray(data, data + ((wav.length - data) & ~1));
  const pcm = new Int16Array(copy.length / 2);
  Buffer.from(pcm.buffer).set(copy);
  return pcm;
};

const main = async () => {
  const models = flag("--models");
  const at = (file: string) => NodePath.join(models, file);
  const words = [
    { word: "Sebastian", path: at("sebastian.onnx"), threshold: 0.97 },
    { word: "Alfred", path: at("alfred.onnx"), threshold: 0.9 },
    { word: "Freya", path: at("freya.onnx"), threshold: 0.95 },
  ];
  const wake = await createOpenWakeWordProvider({
    melspectrogram: at("melspectrogram.onnx"),
    embedding: at("embedding_model.onnx"),
    wakes: words,
  });
  const vad = await createSileroVad(at("silero_vad.onnx"));
  const sidecar = startDictationSidecar({ binary: flag("--exe"), onEvent: () => {} });
  sidecar.configure({
    model: flag("--gguf"),
    hold: null,
    toggle: null,
    device: null,
    channel: null,
    paste: "ctrl_v",
    language: null,
  });
  const workDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "baton-pipe-"));
  const router = startVisionSession({
    claudeBinary: "claude",
    workDir,
    env: process.env,
    platform: process.platform,
    model: "haiku",
    systemPrompt: BRAIN_ROUTER_PROMPT,
  });
  let modelCalls = 0;
  const spoken: string[] = [];
  const log: string[] = [];
  let mark = Date.now();
  const stamp = (line: string) => {
    log.push(`${String(Date.now() - mark).padStart(6)} ms  ${line}`);
  };
  const { client, calls } = grammarClient();
  const brain = {
    said: async (text: string, { direct }: { direct: boolean }) => {
      const decision = await decide(
        text,
        { running: null, direct, recent: [] },
        {
          ask: (turn) => {
            modelCalls += 1;
            return router.ask([{ type: "text", text: turn }]);
          },
          grammarPlaces: async (said) => resolveBatonIntent(said, fleet).outcome === "resolved",
        },
      );
      stamp(`brain ${decision.route} (${decision.source})`);
      if (decision.route === "act") return { kind: "act" as const, text: decision.text };
      if (decision.route === "refused") return { kind: "refused" as const, reply: decision.text };
      return { kind: "handled" as const };
    },
  };
  const core = createVoiceCore({
    wake,
    vad,
    stt: makeSidecarStt(sidecar),
    tts: {
      name: "log",
      speak: async (text) => {
        spoken.push(text);
        stamp(`speaks: ${text.slice(0, 90)}`);
      },
    },
    router: withBrainRoutes(createVoiceRouter(client), brain),
    timings: { ...DEFAULT_TIMINGS, wakeWords: words.map((w) => w.word) },
  });
  core.subscribe((event) => {
    if (event.type === "wake") stamp(`wake (${wake.lastWord()})`);
    if (event.type === "thinking") stamp("to speech recognition");
    if (event.type === "transcript") stamp(`heard: ${event.text}`);
    if (event.type === "nothing") stamp("heard nothing");
    if (event.type === "state") stamp(`state ${event.state}`);
    if (event.type === "outcome") stamp(`outcome ${event.outcome.kind}`);
    if (event.type === "error") stamp(`error ${event.message}`);
  });

  const silence = new Int16Array(16_000 * 3);
  const feed = async (pcm: Int16Array) => {
    for (let i = 0; i + FRAME <= pcm.length; i += FRAME) {
      core.pushAudio(pcm.subarray(i, i + FRAME));
      if (i % (FRAME * 8) === 0) {
        await wake.drain();
        await vad.drain();
      }
    }
    await wake.drain();
    await vad.drain();
  };
  for (const file of flag("--wavs").split(",")) {
    const before = modelCalls;
    mark = Date.now();
    log.push(`\n== ${NodePath.basename(file)}`);
    await feed(readPcm(file));
    stamp("end of audio");
    mark = Date.now();
    await feed(silence);
    await new Promise((r) => setTimeout(r, 6_000));
    log.push(`   model calls this clip: ${modelCalls - before}`);
  }
  log.push(`\nleft the client: ${JSON.stringify(calls.map((c) => [c.kind, c.text]))}`);
  console.log(log.join("\n"));
  router.dispose();
  sidecar.dispose();
  core.dispose();
  process.exit(0);
};

await main();
