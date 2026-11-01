import { describe, expect, it } from "vite-plus/test";
import { appendMentionedMedia, mentionedMediaPaths } from "./mediaMentions.ts";

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

describe("which names count as paths", () => {
  const rows: ReadonlyArray<readonly [string, ReadonlyArray<string>]> = [
    // Another machine's paths are only text: never lifted down to a bare file name.
    ["I saved C:\\Users\\rabee\\Desktop\\baton-logo-concepts.png for you.", []],
    ["see C:\\My Pictures\\a b.png now", []],
    ["see C:/Users/rabee/a.png now", []],
    ["on \\\\server\\share\\a.png", []],
    ["at ~\\Desktop\\a.png", []],
    ["Windows C:\\x\\a.png but Linux /tmp/z/a.png", ["/tmp/z/a.png"]],
    // Relative, dotted-relative and absolute Linux paths, quoted or in code.
    ["the file shots/a.png here", ["shots/a.png"]],
    ["./a.png and ../b.jpg", ["./a.png", "../b.jpg"]],
    ["/home/onnyx/VentureOS/.baton/outbox/baton-logo-concepts.png", ["/home/onnyx/VentureOS/.baton/outbox/baton-logo-concepts.png"]],
    ['"out/a.png" and \'b.png\' and `.baton/outbox/c.mp4`', ["out/a.png", "b.png", ".baton/outbox/c.mp4"]],
    // A bare name is a candidate only: the server keeps it only if the file is really there.
    ["it is baton-logo-concepts.png", ["baton-logo-concepts.png"]],
  ];
  it.each(rows)("%j", (text, expected) => {
    expect(mentionedMediaPaths(text)).toEqual(expected);
  });
});
