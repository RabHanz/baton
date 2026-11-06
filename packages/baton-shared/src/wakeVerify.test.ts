import { describe, expect, it } from "vite-plus/test";

import { wakeWordHeard } from "./wakeVerify.ts";

describe("the second check before a wake", () => {
  it("accepts the wake word and the ways recognition spells it", () => {
    // The clip ends where the model fired, just after the name.
    expect(wakeWordHeard("Sebastian.", "Sebastian")).toBe(true);
    expect(wakeWordHeard("hey alfred", "Alfred")).toBe(true);
    expect(wakeWordHeard("okay, Fraya", "Freya")).toBe(true);
    expect(wakeWordHeard("al fred", "Alfred")).toBe(true);
    expect(wakeWordHeard("Tessaia", "Tessaya")).toBe(true);
  });

  it("hears Tessaya in the words a British voice comes back as, and not in near misses", () => {
    const heard = ["To say yeah.", "Tessa yeah.", "tess a ya", "the saya"];
    for (const text of heard) expect([text, wakeWordHeard(text, "Tessaya")]).toEqual([text, true]);
    // The wake lane's near misses (tessaya-ops/wake/gb_test.py).
    const near = [
      "Tessa, what time is it?",
      "Vanessa said it was fine.",
      "I wanted to say a few words.",
      "Tess, are you there?",
      "The essay is due on Friday.",
      "Teresa will call you back.",
      "Is this a test?",
      "Did you just say yeah?",
      "Thessaly lies in central Greece.",
      "Let me say a thing or two.",
      "Tessie left her umbrella on the train.",
      // Found in review: a sound match inside a sentence, or ending on "you".
      "Nice to see you",
      "Good to see you again",
      "I was going to say yeah",
      "I just wanted to say you were right",
      "Tessa, you there?",
      "To say you can see that.",
      "I desire nothing",
      "the desired outcome",
      "Desiree called",
    ];
    for (const text of near) expect([text, wakeWordHeard(text, "Tessaya")]).toEqual([text, false]);
    for (const [text, word] of [
      ["Set them free, you know", "Freya"],
      ["Set them free, you", "Freya"],
      ["all fret", "Alfred"],
      ["I'll fret", "Alfred"],
    ] as const)
      expect([text, wakeWordHeard(text, word)]).toEqual([text, false]);
  });

  it("rejects speech that only sounds a little like it, and silence", () => {
    expect(wakeWordHeard("and the sixth of November", "Sebastian")).toBe(false);
    expect(wakeWordHeard("it was a nice day at the beach", "Alfred")).toBe(false);
    expect(wakeWordHeard("the weather in Norfolk is cold", "Onyx")).toBe(false);
    expect(wakeWordHeard("", "Freya")).toBe(false);
    expect(wakeWordHeard("   ", "Tessaya")).toBe(false);
  });
});
