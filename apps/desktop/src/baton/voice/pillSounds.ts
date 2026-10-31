/**
 * The pill's three sounds as data: played in the page by Web Audio and rendered here so
 * scripts/baton/voice-lab/sound-score.ts can put the same waves through the wake models and Silero.
 * Warm, short and low on purpose. D112 has the numbers and what they replaced.
 */
export interface PillNote {
  readonly hz: number;
  /** Seconds after the sound starts. */
  readonly at: number;
  readonly len: number;
  readonly gain: number;
}

export type PillSound = "wake" | "end" | "error";

export const PILL_SOUNDS: Record<PillSound, ReadonlyArray<PillNote>> = {
  wake: [
    { hz: 523.25, at: 0, len: 0.11, gain: 0.05 },
    { hz: 783.99, at: 0.055, len: 0.16, gain: 0.045 },
  ],
  end: [
    { hz: 659.25, at: 0, len: 0.1, gain: 0.04 },
    { hz: 440, at: 0.06, len: 0.17, gain: 0.04 },
  ],
  error: [
    { hz: 349.23, at: 0, len: 0.1, gain: 0.045 },
    { hz: 349.23, at: 0.13, len: 0.15, gain: 0.04 },
  ],
};

/** Share of the second harmonic: enough to sound like a struck thing rather than a test tone. */
export const PILL_PARTIAL = 0.22;
const ATTACK = 0.004;

/** The same wave Web Audio makes, as samples. */
export const renderSound = (notes: ReadonlyArray<PillNote>, sampleRate: number): Float32Array => {
  const end = Math.max(...notes.map((n) => n.at + n.len)) + 0.02;
  const out = new Float32Array(Math.ceil(end * sampleRate));
  for (const { hz, at, len, gain } of notes) {
    const start = Math.floor(at * sampleRate);
    const count = Math.ceil(len * sampleRate);
    for (let i = 0; i < count && start + i < out.length; i++) {
      const t = i / sampleRate;
      const envelope = Math.min(t / ATTACK, 1) * Math.exp((-6.2 * t) / len);
      const wave = Math.sin(2 * Math.PI * hz * t) + PILL_PARTIAL * Math.sin(4 * Math.PI * hz * t);
      out[start + i]! += gain * envelope * wave;
    }
  }
  return out;
};
