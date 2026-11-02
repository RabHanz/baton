/**
 * The first-run guide for someone who has never seen Tessaya: seven short steps, each reusing a
 * control the window already has, so nothing here is a second copy of a setting. No step is
 * required; Skip finishes it. It is shown once on a fresh install and can be run again from Settings.
 */
import type { HomeControl } from "../home/batonHome.ts";
import { text } from "../home/strings.ts";

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

const STEPS: ReadonlyArray<Omit<SetupStep, "title" | "text">> = [
  {
    id: "assistant",
    controls: ["s.brain", "s.brainCheck"],
  },
  {
    id: "mic",
    controls: ["v.enabled", "v.mic"],
    meter: true,
  },
  {
    id: "wake",
    controls: ["v.wake:"],
  },
  {
    id: "key",
    controls: ["setup.hold"],
  },
  {
    id: "try",
    controls: [],
    tryBox: true,
  },
  {
    id: "pill",
    controls: ["v.pillPlace"],
  },
  {
    id: "cloud",
    controls: ["cl.set.on", "cl.det.", "cl.signin.", "cl.set.cap", "setup.cloud.github", "setup.cloud.always"],
  },
  {
    id: "privacy",
    controls: ["v.keepVoice", "pr.awWindow", "pr.awIdle", "pr.awFocus", "pr.awJobs"],
  },
];

export const SETUP_STEPS: ReadonlyArray<SetupStep> = STEPS.map((s) => ({
  ...s,
  title: text(`setup.${s.id}.title`),
  text: text(`setup.${s.id}.text`),
}));

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
  section: text("setup.section"),
  label: text("setup.hold.label"),
  kind: "choice",
  value: HOLD_KEY_CHOICES.includes(current) ? current : "",
  options: [
    ...(HOLD_KEY_CHOICES.includes(current)
      ? []
      : [{ value: "", label: text("setup.hold.own", { key: current }) }]),
    ...HOLD_KEY_CHOICES.map((k) => ({ value: k, label: k })),
  ],
});

/** True only on a fresh install that has not finished or skipped the guide. */
export const setupShouldShow = (freshInstall: boolean, done: boolean | undefined): boolean =>
  freshInstall && done !== true;

/** A level from 0 to 1 for the meter; quiet speech still moves it. */
export const meterWidth = (level: number): number =>
  Math.round(Math.min(1, Math.max(0, Math.sqrt(level) * 1.6)) * 100);
