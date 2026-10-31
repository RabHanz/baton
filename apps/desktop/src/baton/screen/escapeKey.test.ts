import { describe, expect, it } from "vite-plus/test";

import { createEscapeKey } from "./escapeKey.ts";

describe("the shared Esc key", () => {
  it("goes to the newest of equals and frees the key when the last lets go", () => {
    const calls: string[] = [];
    let press: (() => void) | null = null;
    const hold = createEscapeKey({
      register: (_, callback) => {
        calls.push("register");
        press = callback;
      },
      unregister: () => calls.push("unregister"),
    });
    const heard: string[] = [];
    const first = hold(() => heard.push("first"));
    const second = hold(() => heard.push("second"));
    press!();
    second();
    press!();
    first();
    first();
    expect(heard).toEqual(["second", "first"]);
    expect(calls).toEqual(["register", "unregister"]);
  });

  it("takes the drive first, then the recording, then the card, past one that throws", () => {
    let press: (() => void) | null = null;
    const hold = createEscapeKey({
      register: (_, callback) => (press = callback),
      unregister: () => {},
    });
    const heard: string[] = [];
    const recording = hold(() => heard.push("recording"), "recording");
    const card = hold(() => heard.push("card"));
    const drive = hold(() => {
      throw new Error("broken");
    }, "drive");
    press!();
    expect(heard).toEqual(["recording"]);
    drive();
    recording();
    press!();
    card();
    expect(heard).toEqual(["recording", "card"]);
  });
});
