/**
 * Wake words a settings file starts with (D135). A fresh install gets the public set. A settings
 * file that already exists but has no wake-word list was written before the list was saved, when
 * Freya was on, so it keeps that set: an update never turns a word off for someone who had it.
 */
import type { WakeWordSetting } from "./desktopVoiceCore.ts";

// Thresholds measured on 6.6 hours of real speech and held-out en-GB voices (D98).
const SEBASTIAN = { word: "Sebastian", enabled: true, threshold: 0.97 };
const ALFRED = { word: "Alfred", enabled: true, threshold: 0.9 };
// Off: as an ordinary word in speech it wakes too easily (D98).
const ONYX = { word: "Onyx", enabled: false, threshold: 0.9 };

// The fewer words are listened for, the fewer false wakes. A fresh install wakes to Sebastian and Alfred until
// Tessaya's own model ships; then Tessaya replaces Alfred (the model's PR flips the two). Alfred and Freya
// and Onyx carry stricter thresholds than before for when they are on.
export const FRESH_WAKE_WORDS: ReadonlyArray<WakeWordSetting> = [
  { word: "Tessaya", enabled: false, threshold: 0.95 },
  SEBASTIAN,
  { word: "Alfred", enabled: true, threshold: 0.95 },
  { word: "Freya", enabled: false, threshold: 0.95 },
  { word: "Onyx", enabled: false, threshold: 0.95 },
];

const LEGACY_WAKE_WORDS: ReadonlyArray<WakeWordSetting> = [
  SEBASTIAN,
  ALFRED,
  { word: "Freya", enabled: true, threshold: 0.95 },
  ONYX,
];

/** Which wake words have a model in the app. A word that is not here is shipped. Flip Tessaya the day its model is wired. */
export const MODEL_SHIPPED: Readonly<Record<string, boolean>> = { Tessaya: false };
export const modelShipped = (word: string): boolean => MODEL_SHIPPED[word] !== false;
/** A word with no model can never be on: it could not wake anything. Same list back when nothing changes. */
export const withShippedModels = (
  words: ReadonlyArray<WakeWordSetting>,
): ReadonlyArray<WakeWordSetting> =>
  words.some((w) => w.enabled && !modelShipped(w.word))
    ? words.map((w) => (w.enabled && !modelShipped(w.word) ? { ...w, enabled: false } : w))
    : words;

/** `saved` is the parsed settings file, or null when there is none. */
export const wakeWordsFor = (saved: unknown): ReadonlyArray<WakeWordSetting> => {
  if (typeof saved !== "object" || saved === null) return FRESH_WAKE_WORDS;
  return withShippedModels(
    Array.isArray((saved as { wakeWords?: unknown }).wakeWords)
      ? (saved as { wakeWords: ReadonlyArray<WakeWordSetting> }).wakeWords
      : LEGACY_WAKE_WORDS,
  );
};
