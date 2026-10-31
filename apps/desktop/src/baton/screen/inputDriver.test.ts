import { describe, expect, it, vi } from "vite-plus/test";

import { createPaster } from "./inputDriver.ts";

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
});
