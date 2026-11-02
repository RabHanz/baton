/* oxlint-disable t3code/no-low-value-comments -- Baton file predating the rule (D82) */
// @effect-diagnostics globalTimers:off
/**
 * Models load on first use: the wake scorer and the speech detector on the first frames, the recogniser on
 * the first transcription. Armed cold, the first phrase after launch waits behind that load and is lost.
 * So before the microphone opens, a second of silence goes through all three; a failure here only means
 * the first real phrase pays for the load, as it did. A starved CPU can take far longer than a healthy one
 * (about a second there), so the limit is generous and the caller shows each stage as it finishes.
 */
const FRAME_SAMPLES = 320;
const WARM_FRAMES = 100;
/** The microphone opens after this at the latest, however the models are doing. */
export const WARM_LIMIT_MS = 45_000;

/**
 * A second of quiet noise, not digital silence: a recogniser may decline to answer for silence at all,
 * and then there is nothing to wait for. Deterministic, so a run is repeatable.
 */
const warmClip = (): Int16Array => {
  const out = new Int16Array(16_000);
  let seed = 12_345;
  for (let i = 0; i < out.length; i += 1) {
    seed = (seed * 1_103_515_245 + 12_345) & 0x7fffffff;
    out[i] = (seed % 4_001) - 2_000;
  }
  return out;
};

export interface WarmUpInput {
  readonly pushFrame: (frame: Int16Array) => void;
  readonly transcribe: (pcm: Int16Array) => Promise<string>;
  /** Resolves once every frame pushed so far has been scored. */
  readonly settled: () => Promise<void>;
  /** Called as each of the two stages finishes (frames scored; recogniser answered), so the start can show progress. */
  readonly onStage?: (ready: number, total: number) => void;
  /** Resolves after the limit. Real time by default; a test passes its own. */
  readonly limit?: () => Promise<void>;
}

/**
 * `result` settles at the first of: both models ready (true), a failure or the limit (false). `complete` settles when the
 * models really are ready, however long that takes on this computer (never rejects; a failed load settles it too, since
 * nothing more can be waited for), so audio heard in the meantime can be held and played in, not lost.
 */
export const startWarmUp = (
  input: WarmUpInput,
): { readonly result: Promise<boolean>; readonly complete: Promise<void> } => {
  const limit =
    input.limit ??
    (() => new Promise<void>((resolve) => setTimeout(resolve, WARM_LIMIT_MS).unref()));
  let ready = 0;
  const stage = () => input.onStage?.((ready += 1), 2);
  let complete: Promise<void>;
  try {
    for (let i = 0; i < WARM_FRAMES; i += 1) input.pushFrame(new Int16Array(FRAME_SAMPLES));
    complete = Promise.all([
      input.settled().then(stage),
      input.transcribe(warmClip()).then(stage),
    ]).then(() => undefined);
  } catch {
    complete = Promise.reject(new Error("warm-up failed to start"));
  }
  const done = complete.then(
    () => true,
    () => false,
  );
  return {
    // Never wait on it for good: the recogniser may not answer for silence at all (0.1.30 hung here).
    result: Promise.race([done, limit().then(() => false)]),
    complete: done.then(() => undefined),
  };
};

export const warmUpVoice = (input: WarmUpInput): Promise<boolean> => startWarmUp(input).result;

/**
 * The core, except that audio arriving before `ready` is kept (the newest `maxFrames`, about 30 s) and given to it in order
 * the moment it is ready: a phrase said while the models are still loading is heard late, not dropped.
 */
export const holdFramesUntil = <T extends { pushAudio: (frame: Int16Array) => void }>(
  core: T,
  ready: Promise<unknown>,
  maxFrames = 1_500,
): T => {
  let open = false;
  const held: Int16Array[] = [];
  void ready.then(() => {
    open = true;
    for (const frame of held.splice(0)) core.pushAudio(frame);
  });
  const pushAudio = (frame: Int16Array) => {
    if (open) return core.pushAudio(frame);
    held.push(frame);
    if (held.length > maxFrames) held.shift();
  };
  return new Proxy(core, {
    get: (target, prop) => {
      if (prop === "pushAudio") return pushAudio;
      const value = Reflect.get(target, prop, target) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
};
