/**
 * §12.1: pin a microphone, remember it, fall back to the OS default, and pick
 * the pinned one again when it comes back.
 *
 * Matched by name, not id. Chromium's deviceId is salted per origin and Windows
 * re-numbers a USB receiver on every replug ("Microphone (2- DJI MIC MINI)"
 * becomes "(3- …)"), so an id pin forgets the DJI receiver the first time it is
 * unplugged. The name, with Windows' decorations stripped, survives.
 */
import type { AudioInputDevice } from "./voiceTypes.ts";

/** Chromium's pseudo-devices; they mirror a real one and are never pinned. */
const PSEUDO_DEVICE_IDS = new Set(["default", "communications"]);

/**
 * "Default - Microphone (2- DJI MIC MINI)" → "microphone (dji mic mini)".
 * Strips Chromium's role prefix, Windows' "N- " replug counter and the
 * "(1234:abcd)" USB id suffix Linux adds.
 */
export const normalizeDeviceName = (label: string): string =>
  label
    .replace(/^(default|communications)\s*-\s*/i, "")
    .replace(/\(\d+-\s*/g, "(")
    .replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

export interface DevicePreference {
  /** The label the user pinned, as it was shown; null means "OS default". */
  readonly pinnedLabel: string | null;
}

export type DeviceChoice =
  | { readonly kind: "pinned"; readonly device: AudioInputDevice }
  | { readonly kind: "default"; readonly deviceId: string | null; readonly reason: string };

export const realDevices = (
  devices: ReadonlyArray<AudioInputDevice>,
): ReadonlyArray<AudioInputDevice> => devices.filter((d) => !PSEUDO_DEVICE_IDS.has(d.deviceId));

export const selectInputDevice = (
  devices: ReadonlyArray<AudioInputDevice>,
  preference: DevicePreference,
): DeviceChoice => {
  // Chromium's own "default" entry follows the OS setting live; null asks
  // getUserMedia for the same thing when the list is empty (no permission yet).
  const osDefault = devices.some((d) => d.deviceId === "default") ? "default" : null;
  if (preference.pinnedLabel === null) {
    return { kind: "default", deviceId: osDefault, reason: "No microphone is pinned." };
  }
  const wanted = normalizeDeviceName(preference.pinnedLabel);
  const candidates = realDevices(devices);
  const exact = candidates.find((d) => normalizeDeviceName(d.label) === wanted);
  // A receiver can come back under a slightly different product string
  // ("DJI MIC MINI" vs "DJI Mic Mini Wireless"); containment catches that.
  const loose =
    exact ??
    candidates.find((d) => {
      const name = normalizeDeviceName(d.label);
      return name.length > 0 && (name.includes(wanted) || wanted.includes(name));
    });
  if (loose !== undefined) return { kind: "pinned", device: loose };
  return {
    kind: "default",
    deviceId: osDefault,
    reason: `${preference.pinnedLabel} is not connected. Using the system microphone.`,
  };
};

/** The id a choice captures from; null lets getUserMedia pick the OS default. */
export const choiceDeviceId = (choice: DeviceChoice): string | null =>
  choice.kind === "pinned" ? choice.device.deviceId : choice.deviceId;

/**
 * A device list changed (hot-plug). Returns the new choice when capture must
 * move — the pinned mic left, or came back — and null when it should stay put.
 */
export const reconcileDeviceChange = (input: {
  readonly current: DeviceChoice;
  readonly devices: ReadonlyArray<AudioInputDevice>;
  readonly preference: DevicePreference;
}): DeviceChoice | null => {
  const next = selectInputDevice(input.devices, input.preference);
  return choiceDeviceId(next) === choiceDeviceId(input.current) && next.kind === input.current.kind
    ? null
    : next;
};
