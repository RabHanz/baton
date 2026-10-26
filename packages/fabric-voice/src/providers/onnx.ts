/**
 * openWakeWord (wake) and Silero (VAD) on onnxruntime-node. Both are
 * synchronous per frame from the pipeline's point of view: ORT's `run` is
 * async, so each provider queues frames and resolves them in order, exposing
 * the latest answer. The pipeline polls `process`/`isSpeech` per frame and
 * tolerates one 80 ms chunk of latency.
 *
 * openWakeWord's streaming feature extraction is ported from
 * openwakeword/utils.py (v0.6.0): 1280-sample chunks → melspectrogram over the
 * chunk plus 480 samples of history (x/10 + 2) → embedding over the last 76
 * mel frames → the wake model over the last 16 embeddings.
 *
 * @module fabric-voice/providers/onnx
 */
import * as ort from "onnxruntime-node";

import type { VadProvider, WakeProvider } from "../types.ts";

const OWW_CHUNK = 1280;
const MEL_HISTORY = 480;
const MEL_WINDOW = 76;
const EMBED_WINDOW = 16;

const open = (path: string) =>
  ort.InferenceSession.create(path, {
    intraOpNumThreads: 1,
    interOpNumThreads: 1,
    executionMode: "sequential",
  });

const first = (output: ort.InferenceSession.OnnxValueMapType): Float32Array => {
  const value = Object.values(output)[0];
  if (value === undefined) throw new Error("model returned no output");
  return value.data as Float32Array;
};

export interface OpenWakeWordPaths {
  readonly melspectrogram: string;
  readonly embedding: string;
  /** e.g. hey_jarvis_v0.1.onnx */
  readonly wake: string;
}

/**
 * Feature pipeline as an async step function, testable on its own. Returns the
 * wake score for each 1280-sample chunk fed in.
 */
export const createOpenWakeWordScorer = async (paths: OpenWakeWordPaths) => {
  const [mel, embed, wake] = await Promise.all([
    open(paths.melspectrogram),
    open(paths.embedding),
    open(paths.wake),
  ]);
  const melIn = mel.inputNames[0]!;
  const embedIn = embed.inputNames[0]!;
  const wakeIn = wake.inputNames[0]!;

  let raw = new Float32Array(0);
  let melFrames: Float32Array[] = [];
  let embeddings: Float32Array[] = [];

  const reset = () => {
    raw = new Float32Array(0);
    melFrames = Array.from({ length: MEL_WINDOW }, () => new Float32Array(32).fill(1));
    embeddings = [];
  };
  reset();

  const score = async (chunk: Int16Array): Promise<number> => {
    const joined = new Float32Array(raw.length + chunk.length);
    joined.set(raw);
    for (let i = 0; i < chunk.length; i++) joined[raw.length + i] = chunk[i]!;
    raw = joined.slice(-(OWW_CHUNK + MEL_HISTORY));

    const melOut = first(
      await mel.run({ [melIn]: new ort.Tensor("float32", raw, [1, raw.length]) }),
    );
    const frames = melOut.length / 32;
    // The newest 8 frames belong to this chunk; earlier ones overlap history.
    for (let f = Math.max(0, frames - 8); f < frames; f++) {
      const row = new Float32Array(32);
      for (let b = 0; b < 32; b++) row[b] = melOut[f * 32 + b]! / 10 + 2;
      melFrames.push(row);
    }
    melFrames = melFrames.slice(-MEL_WINDOW * 2);

    const window = new Float32Array(MEL_WINDOW * 32);
    melFrames.slice(-MEL_WINDOW).forEach((row, i) => window.set(row, i * 32));
    const emb = first(
      await embed.run({ [embedIn]: new ort.Tensor("float32", window, [1, MEL_WINDOW, 32, 1]) }),
    );
    embeddings.push(emb.slice(0, 96));
    if (embeddings.length > EMBED_WINDOW) embeddings.shift();
    if (embeddings.length < EMBED_WINDOW) return 0;

    const feats = new Float32Array(EMBED_WINDOW * 96);
    embeddings.forEach((e, i) => feats.set(e, i * 96));
    return (
      first(
        await wake.run({ [wakeIn]: new ort.Tensor("float32", feats, [1, EMBED_WINDOW, 96]) }),
      )[0] ?? 0
    );
  };

  return { score, reset, chunkSamples: OWW_CHUNK };
};

/**
 * Wrap a streaming async scorer so the pipeline can feed it frame by frame.
 * Frames are buffered into the scorer's chunk size and scored in order; a
 * fire is reported on the next frame after the score crosses `threshold`, then
 * suppressed for `refractoryChunks` so one phrase fires once.
 */
export const streamingScorer = (input: {
  readonly name: string;
  readonly chunkSamples: number;
  readonly score: (chunk: Int16Array) => Promise<number>;
  readonly reset: () => void;
  readonly threshold: number;
  readonly refractoryChunks?: number;
}) => {
  let pending = new Int16Array(0);
  let queue: Promise<void> = Promise.resolve();
  let fired: number | null = null;
  let cooldown = 0;
  let last = 0;
  const feed = (frame: Int16Array) => {
    const joined = new Int16Array(pending.length + frame.length);
    joined.set(pending);
    joined.set(frame, pending.length);
    pending = joined;
    while (pending.length >= input.chunkSamples) {
      const chunk = pending.slice(0, input.chunkSamples);
      pending = pending.slice(input.chunkSamples);
      queue = queue.then(async () => {
        const s = await input.score(chunk);
        last = s;
        if (cooldown > 0) {
          cooldown -= 1;
          return;
        }
        if (s >= input.threshold) {
          fired = s;
          cooldown = input.refractoryChunks ?? 12;
        }
      });
    }
  };
  return {
    feed,
    /** Wait for every queued chunk — tests and end-of-file use this. */
    drain: () => queue,
    take: (): number | null => {
      const f = fired;
      fired = null;
      return f;
    },
    last: () => last,
    reset: () => {
      pending = new Int16Array(0);
      fired = null;
      cooldown = 0;
      input.reset();
    },
  };
};

export const createOpenWakeWordProvider = async (
  paths: OpenWakeWordPaths,
  threshold = 0.5,
): Promise<WakeProvider & { readonly drain: () => Promise<void> }> => {
  const scorer = await createOpenWakeWordScorer(paths);
  const s = streamingScorer({ name: "openwakeword", ...scorer, threshold });
  return {
    name: "openwakeword",
    process: (frame) => {
      s.feed(frame);
      return s.take();
    },
    reset: s.reset,
    drain: s.drain,
  };
};

/**
 * Silero VAD (v5/v6 ONNX): 512-sample windows at 16 kHz with 64 samples of
 * context prepended, recurrent state [2,1,128].
 */
export const createSileroVad = async (
  modelPath: string,
  threshold = 0.5,
): Promise<VadProvider & { readonly drain: () => Promise<void> }> => {
  const session = await open(modelPath);
  const WINDOW = 512;
  const CONTEXT = 64;
  let state = new Float32Array(2 * 128);
  let context = new Float32Array(CONTEXT);
  const sr = new ort.Tensor("int64", BigInt64Array.from([16000n]), []);

  const score = async (chunk: Int16Array): Promise<number> => {
    const x = new Float32Array(CONTEXT + WINDOW);
    x.set(context);
    for (let i = 0; i < WINDOW; i++) x[CONTEXT + i] = chunk[i]! / 32768;
    context = x.slice(-CONTEXT);
    const out = await session.run({
      input: new ort.Tensor("float32", x, [1, CONTEXT + WINDOW]),
      state: new ort.Tensor("float32", state, [2, 1, 128]),
      sr,
    });
    state = new Float32Array(out["stateN"]!.data as Float32Array);
    return (out["output"]!.data as Float32Array)[0] ?? 0;
  };
  const s = streamingScorer({
    name: "silero",
    chunkSamples: WINDOW,
    score,
    reset: () => {
      state = new Float32Array(2 * 128);
      context = new Float32Array(CONTEXT);
    },
    threshold,
    refractoryChunks: 0,
  });
  return {
    name: "silero",
    isSpeech: (frame) => {
      s.feed(frame);
      return s.last() >= threshold;
    },
    reset: s.reset,
    drain: s.drain,
  };
};
