import { describe, expect, it } from "vite-plus/test";

import { createEscapeKey } from "./escapeKey.ts";

describe("the shared Esc key", () => {
  it("reaches every holder and frees the key when the last lets go", () => {
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
    expect(heard).toEqual(["first", "second", "first"]);
    expect(calls).toEqual(["register", "unregister"]);
  });
});
