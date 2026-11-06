/* oxlint-disable t3code/no-low-value-comments -- Baton file predating upstream's rule (D82) */
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
  /** Tried in order after the pin, by part of the name: "Scarlett Solo", "Wireless Mic Rx". */
  readonly micOrder?: ReadonlyArray<string>;
}

export type DeviceChoice =
  | {
      readonly kind: "pinned";
      readonly device: AudioInputDevice;
      /** The pin, the order, or the mic he was on when a Bluetooth headset took the default. */
      readonly by: "pin" | "order" | "kept";
    }
  | {
      readonly kind: "default";
      readonly deviceId: string | null;
      readonly reason: string;
      /** The system default's name, when the list says which it is. */
      readonly label: string | null;
    };

export const realDevices = (
  devices: ReadonlyArray<AudioInputDevice>,
): ReadonlyArray<AudioInputDevice> => devices.filter((d) => !PSEUDO_DEVICE_IDS.has(d.deviceId));

/** A Bluetooth headset's call-quality mic: Windows names it "Headset (… Hands-Free)". */
export const isHandsFree = (label: string): boolean => /hands-?free|bluetooth/i.test(label);

export const selectInputDevice = (
  devices: ReadonlyArray<AudioInputDevice>,
  preference: DevicePreference,
  /** The mic in use before this choice; kept when a hands-free headset takes the default. */
  previous: string | null = null,
): DeviceChoice => {
  // Chromium's own "default" entry follows the OS setting live; null asks
  // getUserMedia for the same thing when the list is empty (no permission yet).
  const osDefault = devices.some((d) => d.deviceId === "default") ? "default" : null;
  const candidates = realDevices(devices);
  const systemDefault = (reason: string): DeviceChoice => {
    const label = candidates.find((d) => d.isDefault === true)?.label ?? null;
    const kept =
      label !== null && isHandsFree(label) && previous !== null && !isHandsFree(previous)
        ? candidates.find((d) => d.label === previous)
        : undefined;
    return kept === undefined
      ? { kind: "default", deviceId: osDefault, reason, label }
      : { kind: "pinned", device: kept, by: "kept" };
  };
  const wants = [
    ...(preference.pinnedLabel === null ? [] : [preference.pinnedLabel]),
    ...(preference.micOrder ?? []),
  ];
  if (wants.length === 0) return systemDefault("No microphone is pinned.");
  for (const label of wants) {
    const wanted = normalizeDeviceName(label);
    const exact = candidates.find((d) => normalizeDeviceName(d.label) === wanted);
    // A receiver can come back under a slightly different product string
    // ("DJI MIC MINI" vs "DJI Mic Mini Wireless"); containment catches that.
    const loose =
      exact ??
      candidates.find((d) => {
        const name = normalizeDeviceName(d.label);
        return name.length > 0 && (name.includes(wanted) || wanted.includes(name));
      });
    if (loose !== undefined) {
      return {
        kind: "pinned",
        device: loose,
        by: label === preference.pinnedLabel ? "pin" : "order",
      };
    }
  }
  return systemDefault(`${wants[0]} is not connected. Using the system microphone.`);
};

/** The mic a choice captures from, by name, and why: for the record and the tray. */
export const choiceSummary = (
  choice: DeviceChoice,
): { readonly mic: string | null; readonly why: "pin" | "order" | "kept" | "default" } =>
  choice.kind === "pinned"
    ? { mic: choice.device.label, why: choice.by }
    : { mic: choice.label, why: "default" };

/** The id a choice captures from; null lets getUserMedia pick the OS default. */
export const choiceDeviceId = (choice: DeviceChoice): string | null =>
  choice.kind === "pinned" ? choice.device.deviceId : choice.deviceId;

/**
 * A device list changed (hot-plug). Returns the new choice when capture must
 * move — the pinned mic left or came back, the system default moved — and null
 * when it should stay put.
 */
export const reconcileDeviceChange = (input: {
  readonly current: DeviceChoice;
  readonly devices: ReadonlyArray<AudioInputDevice>;
  readonly preference: DevicePreference;
  readonly previous?: string | null;
}): DeviceChoice | null => {
  const next = selectInputDevice(input.devices, input.preference, input.previous ?? null);
  const was = choiceSummary(input.current);
  const now = choiceSummary(next);
  return choiceDeviceId(next) === choiceDeviceId(input.current) &&
    now.mic === was.mic &&
    now.why === was.why
    ? null
    : next;
};

/** The input to read for a device: only a device with more than one has anything to choose. */
export const micChannel = (
  device: string,
  channels: number | null,
  micOrder: ReadonlyArray<{ readonly name: string; readonly channel: number | null }>,
): number | null => {
  if (channels !== null && channels < 2) return null;
  const wanted = device.toLowerCase();
  return micOrder.find((mic) => wanted.includes(mic.name.toLowerCase()))?.channel ?? null;
};
