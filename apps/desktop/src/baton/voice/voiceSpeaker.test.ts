import { describe, expect, it } from "vite-plus/test";

import { createSpeaker, speakableText } from "./voiceSpeaker.ts";

describe("speakableText", () => {
  it("drops markup a voice would read out", () => {
    expect(speakableText("**Done**, see `file`\n# next")).toBe("Done , see file next");
  });
});

describe("createSpeaker on the OS voice", () => {
  it("plays in order and reports active once for the whole run", async () => {
    const said: string[] = [];
    const active: boolean[] = [];
    const speaker = createSpeaker({
      os: { name: "os", speak: async (text) => void said.push(text) },
      piper: () => null,
      onActive: (value) => active.push(value),
    });
    await Promise.all([speaker.speak("one."), speaker.speak("two.")]);
    expect(said).toEqual(["one.", "two."]);
    expect(active).toEqual([true, false]);
  });

  it("drops what is queued on cancel", async () => {
    const said: string[] = [];
    const speaker = createSpeaker({
      os: { name: "os", speak: async (text) => void said.push(text) },
      piper: () => null,
    });
    const run = Promise.all([speaker.speak("one."), speaker.speak("two.")]);
    speaker.cancel();
    await run;
    expect(said).toEqual([]);
  });
});
