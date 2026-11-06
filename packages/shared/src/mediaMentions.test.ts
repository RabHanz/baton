import { describe, expect, it } from "vite-plus/test";
import { mentionedMediaPaths } from "./mediaMentions.ts";

describe("which names count as paths", () => {
  const rows: ReadonlyArray<readonly [string, ReadonlyArray<string>]> = [
    // Another machine's paths are only text: never lifted down to a bare file name.
    ["I saved C:\\Users\\robin\\Desktop\\baton-logo-concepts.png for you.", []],
    ["see C:\\My Pictures\\a b.png now", []],
    ["see C:/Users/robin/a.png now", []],
    ["on \\\\server\\share\\a.png", []],
    ["at ~\\Desktop\\a.png", []],
    ["Windows C:\\x\\a.png but Linux /tmp/z/a.png", ["/tmp/z/a.png"]],
    // Relative, dotted-relative and absolute Linux paths, quoted or in code.
    ["the file shots/a.png here", ["shots/a.png"]],
    ["./a.png and ../b.jpg", ["./a.png", "../b.jpg"]],
    [
      "/home/orbit/VantageOS/.baton/outbox/baton-logo-concepts.png",
      ["/home/orbit/VantageOS/.baton/outbox/baton-logo-concepts.png"],
    ],
    [
      "\"out/a.png\" and 'b.png' and `.baton/outbox/c.mp4`",
      ["out/a.png", "b.png", ".baton/outbox/c.mp4"],
    ],
    // A bare name is a candidate only: the server keeps it only if the file is really there.
    ["it is baton-logo-concepts.png", ["baton-logo-concepts.png"]],
  ];
  it.each(rows)("%j", (text, expected) => {
    expect(mentionedMediaPaths(text)).toEqual(expected);
  });
});
