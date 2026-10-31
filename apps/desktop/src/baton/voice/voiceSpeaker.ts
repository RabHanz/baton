// @effect-diagnostics nodeBuiltinImport:off
/**
 * One voice for everything Baton says, one sentence after another. A local neural voice when its
 * files are there (free, D113); the OS voice otherwise, and after any failure. Each sentence starts
 * generating as soon as the one before has finished generating and plays as it arrives, so a gap
 * between two is only what has not been generated yet. Written only is enforced here, so nothing
 * can reach the speakers.
 */
import type { TtsProvider } from "@t3tools/baton-voice";

/** Plays a WAV as its bytes arrive; resolves false if there was nothing to play. */
export interface VoicePlayer {
  readonly play: (wav: AsyncIterable<Buffer>) => Promise<boolean>;
  readonly stop: () => void;
  readonly dispose: () => void;
}

/** Text to streaming WAV bytes. The engines differ only here. */
export type Synthesise = (text: string) => {
  readonly stream: AsyncIterable<Buffer>;
  readonly cancel: () => void;
};

/** Off the screen and free of markup a synthesiser would read out. */
export const speakableText = (text: string): string =>
  text
    .replace(/[`*_#>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Rate and where samples begin, from the header at the start of a stream. */
export const wavFormat = (head: Buffer): { readonly rate: number; readonly start: number } | null => {
  const data = head.indexOf("data", 12, "latin1");
  return data < 0 || head.length < 28
    ? null
    : { rate: head.readUInt32LE(24), start: data + 8 };
};

/** Loudness of a run of mono 16-bit samples, 0..1. */
export const pcmLevel = (pcm: Buffer): number => {
  let sum = 0;
  let count = 0;
  for (let i = 0; i + 2 <= pcm.length; i += 16) {
    const v = pcm.readInt16LE(i) / 32768;
    sum += v * v;
    count += 1;
  }
  return count === 0 ? 0 : Math.min(1, Math.sqrt(sum / count) * 3.2);
};

/** Reads ahead into memory, so generation runs on while the sentence before is still playing. */
const readAhead = (
  source: AsyncIterable<Buffer>,
): { stream: AsyncIterable<Buffer>; finished: Promise<void> } => {
  const chunks: Buffer[] = [];
  let ended = false;
  let failure: unknown = null;
  let wake: (() => void) | null = null;
  const poke = () => {
    wake?.();
    wake = null;
  };
  const finished = (async () => {
    try {
      for await (const chunk of source) {
        chunks.push(chunk);
        poke();
      }
    } catch (error) {
      failure = error;
    }
    ended = true;
    poke();
  })();
  return {
    finished,
    stream: (async function* () {
      for (;;) {
        while (chunks.length > 0) yield chunks.shift()!;
        if (ended) {
          if (failure !== null) throw failure;
          return;
        }
        await new Promise<void>((resolve) => (wake = resolve));
      }
    })(),
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
  let generating: Promise<void> = Promise.resolve();

  const speak = (raw: string): Promise<void> => {
    if (input.silent?.() === true) return Promise.resolve();
    const text = speakableText(raw);
    if (text.length === 0) return Promise.resolve();
    const mine = generation;
    const voice = input.voice();
    const previous = generating;
    // The engine takes one sentence at a time.
    const source =
      voice === null
        ? null
        : readAhead(
            (async function* () {
              await previous;
              if (mine !== generation) return;
              const job = voice(text);
              running.add(job.cancel);
              try {
                yield* job.stream;
              } finally {
                running.delete(job.cancel);
              }
            })(),
          );
    if (source !== null) generating = source.finished;
    if (queued === 0) input.onActive?.(true);
    queued += 1;
    const turn = tail.then(async () => {
      if (mine !== generation) return;
      const played = source === null ? false : await input.player.play(source.stream).catch(() => false);
      if (mine !== generation) return;
      if (!played) await input.os.speak(text).catch(() => undefined);
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
