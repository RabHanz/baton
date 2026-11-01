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

  it("rejects speech that only sounds a little like it, and silence", () => {
    expect(wakeWordHeard("and the sixth of November", "Sebastian")).toBe(false);
    expect(wakeWordHeard("it was a nice day at the beach", "Alfred")).toBe(false);
    expect(wakeWordHeard("the weather in Norfolk is cold", "Onyx")).toBe(false);
    expect(wakeWordHeard("", "Freya")).toBe(false);
    expect(wakeWordHeard("   ", "Tessaya")).toBe(false);
  });
});
