import { describe, expect, it } from "vite-plus/test";

import { wakeWordHeard } from "./wakeVerify.ts";

describe("the second check before a wake", () => {
  it("accepts the wake word and the ways recognition spells it", () => {
    expect(wakeWordHeard("Sebastian, what needs me?", "Sebastian")).toBe(true);
    expect(wakeWordHeard("hey alfred", "Alfred")).toBe(true);
    expect(wakeWordHeard("Fraya what time is it", "Freya")).toBe(true);
    expect(wakeWordHeard("al fred open the settings", "Alfred")).toBe(true);
    expect(wakeWordHeard("Tessaia, stop", "Tessaya")).toBe(true);
  });

  it("hears Tessaya in the words a British voice comes back as, and not in near misses", () => {
    const heard = [
      "To say yeah.",
      "To say you can see that.",
      "Tessa yeah, dictate",
      "tess a ya",
      "the saya",
      "Desire.",
      "Tess eye ah",
    ];
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
    ];
    for (const text of near) expect([text, wakeWordHeard(text, "Tessaya")]).toEqual([text, false]);
  });

  it("rejects speech that only sounds a little like it, and silence", () => {
    expect(wakeWordHeard("and the sixth of November", "Sebastian")).toBe(false);
    expect(wakeWordHeard("it was a nice day at the beach", "Alfred")).toBe(false);
    expect(wakeWordHeard("the weather in Norfolk is cold", "Onyx")).toBe(false);
    expect(wakeWordHeard("", "Freya")).toBe(false);
    expect(wakeWordHeard("   ", "Tessaya")).toBe(false);
  });
});
