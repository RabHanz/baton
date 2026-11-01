import { describe, expect, it } from "vitest";
import { appendMentionedMedia } from "./mediaMentions.ts";

describe("appendMentionedMedia", () => {
  it("appends named images and videos once, in order", () => {
    expect(appendMentionedMedia("Saved shot.png and `out/clip.mp4`, then shot.png again.")).toBe(
      "Saved shot.png and `out/clip.mp4`, then shot.png again.\n\n![shot.png](<shot.png>)\n\n![clip.mp4](<out/clip.mp4>)",
    );
  });

  it("leaves shown media, code fences, URLs and non-media alone", () => {
    for (const text of [
      "![a](a.png) and a.png",
      "```\ncat a.png\n```",
      "see https://x.dev/a.png and [b](b.mp4)",
      "edit index.ts and notes.md",
    ]) {
      expect(appendMentionedMedia(text)).toBe(text);
    }
  });
});

it("treats a copy the server attached (named by its alt text) as shown", () => {
  const text = "Saved shot.png\n\n![shot.png](</data/attachments/ab12.png>)";
  expect(appendMentionedMedia(text)).toBe(text);
});
