/**
 * The first-run guide for someone who has never seen Tessaya: seven short steps, each reusing a
 * control the window already has, so nothing here is a second copy of a setting. No step is
 * required; Skip finishes it. It is shown once on a fresh install and can be run again from Settings.
 */
import type { HomeControl } from "../home/batonHome.ts";

export interface SetupStep {
  readonly id: string;
  readonly title: string;
  readonly text: string;
  /** Controls of the window drawn in the step; `v.wake:` matches every wake word. */
  readonly controls: ReadonlyArray<string>;
  /** Draw the live microphone level. */
  readonly meter?: boolean;
  /** Draw a box to try dictation in. */
  readonly tryBox?: boolean;
}

export const SETUP_STEPS: ReadonlyArray<SetupStep> = [
  {
    id: "assistant",
    title: "Choose your assistant",
    text: "Tessaya works through a coding assistant you already pay for and are signed in to. Pick one that says Ready. Listening and speaking stay on this computer.",
    controls: ["s.brain", "s.brainCheck"],
  },
  {
    id: "mic",
    title: "Check your microphone",
    text: "Turn listening on, then say something. The bar should move. If it stays flat, pick another microphone.",
    controls: ["v.enabled", "v.mic"],
    meter: true,
  },
  {
    id: "wake",
    title: "Pick the words that wake it",
    text: "Say one of these and Tessaya starts listening. Keep the ones you like; switch off the rest.",
    controls: ["v.wake:"],
  },
  {
    id: "key",
    title: "Choose your dictation key",
    text: "Hold this key and speak: the words are typed into whatever app you are in. You can add more keys, or a mouse button, later under Settings, Keyboard and mouse.",
    controls: ["setup.hold"],
  },
  {
    id: "try",
    title: "Say one sentence",
    text: "Click the box, hold your dictation key, say a sentence, and let go.",
    controls: [],
    tryBox: true,
  },
  {
    id: "pill",
    title: "Where should the pill sit?",
    text: "The pill is the small bar that shows when Tessaya is listening. It stays out of the way when it has nothing to say.",
    controls: ["v.pillPlace"],
  },
  {
    id: "privacy",
    title: "Your privacy choices",
    text: "Both are off until you turn them on. Recording keeps your voice on this computer only. Awareness lets the assistant know which window you are in, and nothing more.",
    controls: ["v.keepVoice", "pr.awWindow", "pr.awIdle", "pr.awFocus", "pr.awJobs"],
  },
];

/** F-keys are safe alone; the first is the default chord. */
export const HOLD_KEY_CHOICES: ReadonlyArray<string> = [
  "Ctrl+Alt+Space",
  "F9",
  "F8",
  "Ctrl+Shift+Space",
  "Pause",
];

export const setupHoldControl = (current: string): HomeControl => ({
  id: "setup.hold",
  section: "Setup",
  label: "Hold to dictate",
  kind: "choice",
  value: HOLD_KEY_CHOICES.includes(current) ? current : "",
  options: [
    ...(HOLD_KEY_CHOICES.includes(current)
      ? []
      : [{ value: "", label: `${current} (your own)` }]),
    ...HOLD_KEY_CHOICES.map((k) => ({ value: k, label: k })),
  ],
});

/** True only on a fresh install that has not finished or skipped the guide. */
export const setupShouldShow = (freshInstall: boolean, done: boolean | undefined): boolean =>
  freshInstall && done !== true;

/** A level from 0 to 1 for the meter; quiet speech still moves it. */
export const meterWidth = (level: number): number =>
  Math.round(Math.min(1, Math.max(0, Math.sqrt(level) * 1.6)) * 100);
