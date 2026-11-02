import { describe, expect, it } from "vite-plus/test";

import { loginItemOn, setLoginItem } from "./loginItem.ts";

const ENTRY = "app.id.example";

const registry = (initial: ReadonlyArray<string>) => {
  const entries = new Set(initial);
  return {
    entries,
    api: {
      getLoginItemSettings: () => ({ openAtLogin: entries.has("default") }),
      setLoginItemSettings: (s: { openAtLogin: boolean; name?: string }) => {
        const name = s.name ?? "default";
        if (s.openAtLogin) entries.add(name);
        else entries.delete(name);
      },
    },
  };
};

describe("the sign-in switch", () => {
  it("reads on when the installer's entry under the app's id exists, though the settings file never said so", () => {
    expect(loginItemOn(registry([ENTRY]).api, ENTRY, (name) => name === ENTRY)).toBe(true);
    expect(loginItemOn(registry([]).api, ENTRY, () => false)).toBe(false);
  });
  it("reads on for Electron's default-named entry too", () => {
    expect(loginItemOn(registry(["default"]).api, ENTRY, () => false)).toBe(true);
  });
  it("keeps exactly one entry, under the app's id, and none when switched off", () => {
    const r = registry(["default"]);
    setLoginItem(r.api, ENTRY, true);
    expect([...r.entries]).toEqual([ENTRY]);
    setLoginItem(r.api, ENTRY, false);
    expect([...r.entries]).toEqual([]);
  });
});
