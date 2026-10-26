/**
 * Explicit activation: keys that wake Fabric without a wake word.
 *
 * These are also Airdeck's seam (D64, D65). Airdeck profiles already have a
 * `"keys"` action, so a remote button bound to one of these chords wakes,
 * toggles or mutes Fabric with no Airdeck code change. Chosen clear of
 * Airdeck's own Ctrl+Alt+Shift+F9…F12.
 */
import type { VoiceActivation } from "./voiceTypes.ts";

export const VOICE_HOTKEYS: ReadonlyArray<{
  readonly accelerator: string;
  /** The same chord in Airdeck's profile syntax. */
  readonly airdeckKeys: string;
  readonly activation: VoiceActivation;
}> = [
  { accelerator: "Control+Alt+Shift+F5", airdeckKeys: "ctrl+alt+shift+f5", activation: "wake" },
  {
    accelerator: "Control+Alt+Shift+F6",
    airdeckKeys: "ctrl+alt+shift+f6",
    activation: "toggle_direct_session",
  },
  {
    accelerator: "Control+Alt+Shift+F7",
    airdeckKeys: "ctrl+alt+shift+f7",
    activation: "toggle_mute",
  },
];
