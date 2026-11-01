import { describe, expect, it, vi } from "vite-plus/test";

import { createPaster } from "./inputDriver.ts";

const fakeTimers = () => {
  vi.useFakeTimers();
  return { [Symbol.dispose]: () => vi.useRealTimers() };
};

describe("typing by the clipboard", () => {
  it("does not put his clipboard back under the next step's paste", async () => {
    let clip = "his";
    const pasted: string[] = [];
    const paste = createPaster(
      { readText: () => clip, writeText: (text) => void (clip = text) },
      40,
    );
    await paste("one", async () => void pasted.push(clip));
    await paste("two", async () => void pasted.push(clip));
    await vi.waitFor(() => expect(clip).toBe("his"));
    expect(pasted).toEqual(["one", "two"]);
  });

  it("presses nothing when the clipboard cannot be written", async () => {
    let pressed = false;
    const paste = createPaster({ readText: () => "old password", writeText: () => undefined }, 40);
    await expect(paste("npm test", async () => void (pressed = true))).rejects.toThrow("clipboard");
    expect(pressed).toBe(false);
  });

  it("puts his clipboard back only while the clipboard is still what it pasted, so a copy made right after is kept", async () => {
    using _timers = fakeTimers();
    let clip = "his";
    const paste = createPaster(
      { readText: () => clip, writeText: (text) => void (clip = text) },
      40,
    );
    const pasted = paste("typed words", async () => undefined);
    await vi.advanceTimersByTimeAsync(160);
    await pasted;
    // Ctrl+C in the app lands before the restore.
    clip = "copied from the app";
    await vi.advanceTimersByTimeAsync(200);
    expect(clip).toBe("copied from the app");
  });
});
