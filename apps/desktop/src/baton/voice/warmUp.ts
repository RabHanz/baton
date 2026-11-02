// @effect-diagnostics globalTimers:off
/**
 * Models load on first use: the wake scorer and the speech detector on the first frames, the recogniser on
 * the first transcription. Armed cold, the first phrase after launch waits behind that load and is lost.
 * So before the microphone opens, a second of silence goes through all three; a failure here only means
 * the first real phrase pays for the load, as it did.
 */
const FRAME_SAMPLES = 320;
const WARM_FRAMES = 100;
/** The microphone opens after this at the latest, however the models are doing. */
export const WARM_LIMIT_MS = 8_000;

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

export const warmUpVoice = async (input: {
  readonly pushFrame: (frame: Int16Array) => void;
  readonly transcribe: (pcm: Int16Array) => Promise<string>;
  /** Resolves once every frame pushed so far has been scored. */
  readonly settled: () => Promise<void>;
  /** Resolves after the limit. Real time by default; a test passes its own. */
  readonly limit?: () => Promise<void>;
}): Promise<boolean> => {
  const limit =
    input.limit ??
    (() => new Promise<void>((resolve) => setTimeout(resolve, WARM_LIMIT_MS).unref()));
  try {
    for (let i = 0; i < WARM_FRAMES; i += 1) input.pushFrame(new Int16Array(FRAME_SAMPLES));
    // Never wait on it for good: the recogniser may not answer for silence at all, and a start that waits
    // for that never opens the microphone (0.1.30).
    return await Promise.race([
      Promise.all([input.settled(), input.transcribe(warmClip())]).then(() => true),
      limit().then(() => false),
    ]);
  } catch {
    // Not fatal: see above.
    return false;
  }
};
