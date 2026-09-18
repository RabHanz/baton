/**
 * Dictation: the one thing that never reaches the environment.
 *
 * §12.3 keeps dictation and agent routing as different intents, and §18 makes
 * dictation a local act — text goes into whatever field the user is looking
 * at. Putting the two together gives a rule this module exists to enforce:
 *
 * > **Dictated words are resolved on the client and are never sent to an
 * > environment.**
 *
 * The reason is not architectural tidiness. "Dictate: thanks, I'll send the
 * revised contract tomorrow" is an email to someone else; it is not work, it
 * is not a prompt, and a Fabric environment has no business receiving it,
 * logging it, or keeping it in an intent log. So the client runs this pass
 * first and only forwards what is left.
 *
 * The grammar is the same shape as the rest of §13: deterministic, refuses by
 * name, no model.
 *
 * @module fabricDictation
 */

export type DictationCommand =
  | {
      readonly kind: "start";
      /** Text said in the same breath — "dictate: thanks, I'll send it". */
      readonly text: string | null;
    }
  | { readonly kind: "stop" }
  /** Ordinary speech while dictation mode is on. */
  | { readonly kind: "text"; readonly text: string }
  /** Not a dictation sentence at all; the caller sends it to the environment. */
  | { readonly kind: "not_dictation" };

const normalise = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();

/** "hey jarvis, " and friends, stripped before anything is decided. */
const WAKE = /^(?:hey |ok |okay )?(?:jarvis|fabric)[,:]?\s+/;

const START = /^(?:start\s+)?dictat(?:e|ing|ion)\b\s*[:,-]?\s*(.*)$/;
const STOP = /^(?:stop|end|finish|quit)\s+dictat(?:e|ing|ion)\b/;

/**
 * Classify one utterance.
 *
 * `dictating` is the mode the client is already in, and it changes the answer:
 * while dictation is on, ordinary words are text rather than instructions.
 * That is §12.3's conversation-mode rule, and it is why the caller owns the
 * mode and this function only reads it.
 */
export const classifyDictation = (
  utterance: string,
  input: { readonly dictating: boolean },
): DictationCommand => {
  const raw = utterance.trim();
  const text = normalise(raw).replace(WAKE, "").trim();
  if (text.length === 0) {
    return input.dictating ? { kind: "text", text: raw } : { kind: "not_dictation" };
  }

  // "Stop dictating" is checked first and works in both modes: a user who says
  // it when dictation is already off has still made themselves clear.
  if (STOP.test(text)) return { kind: "stop" };

  const start = START.exec(text);
  if (start !== null) {
    const tail = (start[1] ?? "").trim();
    // Give the tail its original characters back: this text is going into
    // somebody's email, and lower-casing it would be rude.
    const spoken = tail.length === 0 ? null : restoreCase(raw, tail);
    return { kind: "start", text: spoken };
  }

  return input.dictating ? { kind: "text", text: raw } : { kind: "not_dictation" };
};

/**
 * Give a lower-cased fragment its original characters back.
 *
 * The grammar works on normalised text; what reaches the field should be what
 * the user actually said.
 */
const restoreCase = (source: string, fragment: string): string => {
  const index = source.toLowerCase().indexOf(fragment.toLowerCase());
  return index === -1 ? fragment : source.slice(index, index + fragment.length).trim();
};

/**
 * True when this utterance must be handled locally and must not be sent to an
 * environment. The caller's gate, in one function, so the rule is enforced in
 * one place rather than remembered in several.
 */
export const staysLocal = (command: DictationCommand): boolean => command.kind !== "not_dictation";
