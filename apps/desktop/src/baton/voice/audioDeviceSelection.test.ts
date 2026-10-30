import { describe, expect, it } from "vite-plus/test";

import {
  normalizeDeviceName,
  reconcileDeviceChange,
  selectInputDevice,
} from "./audioDeviceSelection.ts";

// What Chromium reports on Windows with a DJI receiver plugged in.
const withDji = [
  { deviceId: "default", label: "Default - Microphone (Realtek(R) Audio)" },
  { deviceId: "communications", label: "Communications - Microphone (Realtek(R) Audio)" },
  { deviceId: "a1", label: "Microphone (Realtek(R) Audio)" },
  { deviceId: "d1", label: "Microphone (2- DJI MIC MINI)" },
];
const withoutDji = withDji.slice(0, 3);
const pinned = { pinnedLabel: "Microphone (2- DJI MIC MINI)" };

describe("normalizeDeviceName", () => {
  it("strips Windows' replug counter and Chromium's role prefix", () => {
    expect(normalizeDeviceName("Microphone (3- DJI MIC MINI)")).toBe("microphone (dji mic mini)");
    expect(normalizeDeviceName("Default - Microphone (DJI MIC MINI)")).toBe(
      "microphone (dji mic mini)",
    );
    expect(normalizeDeviceName("DJI MIC MINI Mono (2ca3:0026)")).toBe("dji mic mini mono");
  });
});

describe("selectInputDevice", () => {
  it("uses the OS default when nothing is pinned", () => {
    expect(selectInputDevice(withDji, { pinnedLabel: null })).toMatchObject({
      kind: "default",
      deviceId: "default",
    });
  });

  it("finds the pinned receiver again after Windows renumbers it", () => {
    const replugged = [...withoutDji, { deviceId: "d2", label: "Microphone (3- DJI MIC MINI)" }];
    const choice = selectInputDevice(replugged, pinned);
    expect(choice.kind).toBe("pinned");
    if (choice.kind === "pinned") expect(choice.device.deviceId).toBe("d2");
  });

  it("never pins Chromium's pseudo-devices, even when their label matches", () => {
    const choice = selectInputDevice(withoutDji, { pinnedLabel: "Microphone (Realtek(R) Audio)" });
    expect(choice.kind === "pinned" && choice.device.deviceId).toBe("a1");
  });

  it("falls back to the OS default, and says which mic is missing", () => {
    const choice = selectInputDevice(withoutDji, pinned);
    expect(choice).toMatchObject({ kind: "default", deviceId: "default" });
    if (choice.kind === "default") expect(choice.reason).toContain("DJI MIC MINI");
  });

  it("asks getUserMedia for its default when the list is empty (no permission yet)", () => {
    expect(selectInputDevice([], pinned)).toMatchObject({ kind: "default", deviceId: null });
  });
});

describe("the microphone order", () => {
  const scarlett = {
    deviceId: "Microphone (Scarlett Solo USB)",
    label: "Microphone (Scarlett Solo USB)",
  };
  const dji = { deviceId: "Microphone (Wireless Mic Rx)", label: "Microphone (Wireless Mic Rx)" };
  const remote = { deviceId: "Microphone (USBAudio2.0)", label: "Microphone (USBAudio2.0)" };
  const order = { pinnedLabel: null, micOrder: ["Scarlett Solo", "Wireless Mic Rx"] };

  it("takes the AT2020's interface first, the DJI next, by part of the name", () => {
    expect(selectInputDevice([remote, dji, scarlett], order)).toMatchObject({ device: scarlett });
    expect(selectInputDevice([remote, dji], order)).toMatchObject({ device: dji });
  });

  it("falls back to the system microphone when neither is there", () => {
    expect(selectInputDevice([remote], order)).toMatchObject({ kind: "default" });
  });

  it("moves when the first mic vanishes, and back when it returns", () => {
    const current = selectInputDevice([scarlett, dji], order);
    const gone = reconcileDeviceChange({ current, devices: [dji], preference: order });
    expect(gone).toMatchObject({ device: dji });
    const back = reconcileDeviceChange({
      current: gone!,
      devices: [scarlett, dji],
      preference: order,
    });
    expect(back).toMatchObject({ device: scarlett });
  });

  it("lets an explicit pin outrank the order", () => {
    const pin = { ...order, pinnedLabel: dji.label };
    expect(selectInputDevice([scarlett, dji], pin)).toMatchObject({ device: dji });
  });
});

describe("reconcileDeviceChange (hot-plug)", () => {
  const onDji = selectInputDevice(withDji, pinned);
  const onDefault = selectInputDevice(withoutDji, pinned);

  it("moves to the default when the pinned receiver is unplugged", () => {
    expect(
      reconcileDeviceChange({ current: onDji, devices: withoutDji, preference: pinned }),
    ).toMatchObject({ kind: "default" });
  });

  it("moves back when it is plugged in again", () => {
    const next = reconcileDeviceChange({
      current: onDefault,
      devices: withDji,
      preference: pinned,
    });
    expect(next?.kind === "pinned" && next.device.deviceId).toBe("d1");
  });

  it("stays put when an unrelated device comes or goes", () => {
    const more = [...withDji, { deviceId: "w1", label: "Headset (WH-1000XM4)" }];
    expect(reconcileDeviceChange({ current: onDji, devices: more, preference: pinned })).toBeNull();
  });
});
