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
});
