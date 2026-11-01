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

// The fewer words are listened for, the fewer false wakes: a fresh install wakes to Tessaya and one
// spare, with a stricter threshold than before. A word with no model yet is skipped at start, so
// Sebastian carries it until Tessaya's model ships. Measured by scripts/baton/wake-train/false_wakes.py.
export const FRESH_WAKE_WORDS: ReadonlyArray<WakeWordSetting> = [
  { word: "Tessaya", enabled: true, threshold: 0.95 },
  SEBASTIAN,
  { word: "Alfred", enabled: false, threshold: 0.97 },
  { word: "Freya", enabled: false, threshold: 0.95 },
  { word: "Onyx", enabled: false, threshold: 0.95 },
];

const LEGACY_WAKE_WORDS: ReadonlyArray<WakeWordSetting> = [
  SEBASTIAN,
  ALFRED,
  { word: "Freya", enabled: true, threshold: 0.95 },
  ONYX,
];

/** `saved` is the parsed settings file, or null when there is none. */
export const wakeWordsFor = (saved: unknown): ReadonlyArray<WakeWordSetting> => {
  if (typeof saved !== "object" || saved === null) return FRESH_WAKE_WORDS;
  return Array.isArray((saved as { wakeWords?: unknown }).wakeWords)
    ? (saved as { wakeWords: ReadonlyArray<WakeWordSetting> }).wakeWords
    : LEGACY_WAKE_WORDS;
};
