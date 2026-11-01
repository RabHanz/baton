/**
 * Models load on first use: the wake scorer and the speech detector on the first frames, the recogniser on
 * the first transcription. Armed cold, the first phrase after launch waits behind that load and is lost.
 * So before the microphone opens, a second of silence goes through all three; a failure here only means
 * the first real phrase pays for the load, as it did.
 */
const FRAME_SAMPLES = 320;
const WARM_FRAMES = 100;

export const warmUpVoice = async (input: {
  readonly pushFrame: (frame: Int16Array) => void;
  readonly transcribe: (pcm: Int16Array) => Promise<string>;
  /** Resolves once every frame pushed so far has been scored. */
  readonly settled: () => Promise<void>;
}): Promise<void> => {
  try {
    for (let i = 0; i < WARM_FRAMES; i += 1) input.pushFrame(new Int16Array(FRAME_SAMPLES));
    await Promise.all([input.settled(), input.transcribe(new Int16Array(16_000))]);
  } catch {
    // Not fatal: see above.
  }
};
