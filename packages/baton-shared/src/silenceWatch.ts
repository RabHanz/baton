/**
 * The microphone is open but hears nothing (a muted or unplugged device, the wrong input chosen).
 * Fed the level of every frame; says "warn" once after the room has been dead quiet for a while, and
 * not again for an hour. A level is 0 to 1; a live mic's noise floor is well above the threshold.
 */
export const DEAD_LEVEL = 0.0005;
export const DEFAULT_SILENCE_SECONDS = 90;
export const WARN_AGAIN_MS = 60 * 60_000;

export const createSilenceWatch = (input: { readonly seconds: () => number }) => {
  let quietSince: number | null = null;
  let warnedAt = -Infinity;
  return {
    /** "warn" at most once an hour; 0 seconds turns the watch off. */
    feed: (level: number, now: number): "warn" | null => {
      const seconds = input.seconds();
      if (seconds <= 0 || level > DEAD_LEVEL) {
        quietSince = null;
        return null;
      }
      quietSince ??= now;
      if (now - quietSince >= seconds * 1000 && now - warnedAt >= WARN_AGAIN_MS) {
        warnedAt = now;
        return "warn";
      }
      return null;
    },
    reset: () => {
      quietSince = null;
    },
  };
};

export const SILENCE_MESSAGE =
  "Your microphone is open but hears nothing. Check that it is not muted or unplugged, and that the right one is chosen under Voice.";
