/**
 * Words the desktop's voice service heard, as the sentence the intent bar runs.
 *
 * Direct-session mode is §12.3's replacement for push-to-talk: ordinary speech
 * is a message to the session on screen. Said through the grammar's own colon
 * form, so it goes through the same gates as typing it would.
 */
export const voiceUtteranceSentence = (utterance: {
  readonly route: "focused_session" | "fabric_intent";
  readonly text: string;
}): string | null => {
  const text = utterance.text.trim();
  if (text.length === 0) return null;
  return utterance.route === "focused_session" ? `Tell it: ${text}` : text;
};
