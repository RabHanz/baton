/**
 * The second check before a wake: the audio just before the wake model fired is recognised as speech,
 * and the wake word must be in what was heard. The model alone fires on TV, music and look-alike words;
 * the recogniser rarely hears "Sebastian" in those. Recognition spells a name in many ways, so the
 * match is by sound-alike spelling, not exact text.
 */

/** Other ways recognition writes a wake word, from how each one is said. */
const ALIASES: Readonly<Record<string, ReadonlyArray<string>>> = {
  tessaya: [
    "tessaia",
    "tesaya",
    "tessia",
    "tessa ya",
    "tesseya",
    "teh sayuh",
    "tessie a",
    "theresa",
    "tessa",
  ],
  sebastian: ["bastian", "sebastien", "sabastian", "sebastiane"],
  alfred: ["alfrid", "alfread", "al fred"],
  freya: ["fraya", "freia", "fria", "fray uh", "frayer", "freyer"],
  onyx: ["onix", "onyks", "onicks", "onyx"],
};

const letters = (text: string): string => text.toLowerCase().replace(/[^a-z ]/g, "");

const editDistance = (a: string, b: string): number => {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const above = row[j]!;
      row[j] = Math.min(above + 1, row[j - 1]! + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return row[b.length]!;
};

const similar = (heard: string, word: string): number =>
  1 - editDistance(heard, word) / Math.max(heard.length, word.length, 1);

/** True when `transcript` contains `word` or a close spelling of it. */
export const wakeWordHeard = (transcript: string, word: string): boolean => {
  const target = letters(word).trim();
  if (target === "") return true;
  const spoken = letters(transcript).split(/\s+/).filter(Boolean);
  if (spoken.length === 0) return false;
  const candidates = [target, ...(ALIASES[target] ?? []).map((alias) => letters(alias))];
  // Single words, and neighbouring pairs joined ("al fred", "tessa ya").
  const pieces = spoken.flatMap((token, i) =>
    i + 1 < spoken.length ? [token, `${token}${spoken[i + 1]}`] : [token],
  );
  return pieces.some((piece) =>
    candidates.some((c) => {
      const flat = c.replace(/ /g, "");
      return piece === flat || similar(piece, flat) >= 0.72;
    }),
  );
};
