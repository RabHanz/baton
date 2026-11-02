import { describe, expect, it } from "vite-plus/test";

import { createSilenceWatch } from "./silenceWatch.ts";

const S = 1000;

describe("the silent microphone watch", () => {
  it("warns once after the set quiet time, not again for an hour, and not at all when something is heard", () => {
    const w = createSilenceWatch({ seconds: () => 90 });
    expect(w.feed(0, 0)).toBeNull();
    expect(w.feed(0, 89 * S)).toBeNull();
    expect(w.feed(0, 90 * S)).toBe("warn");
    expect(w.feed(0, 200 * S)).toBeNull();
    expect(w.feed(0, 90 * S + 60 * 60_000)).toBe("warn");
    const heard = createSilenceWatch({ seconds: () => 90 });
    heard.feed(0, 0);
    heard.feed(0.02, 80 * S);
    expect(heard.feed(0, 100 * S)).toBeNull();
    expect(heard.feed(0, 190 * S)).toBe("warn");
  });
  it("is off at zero seconds", () => {
    const w = createSilenceWatch({ seconds: () => 0 });
    w.feed(0, 0);
    expect(w.feed(0, 10_000 * S)).toBeNull();
  });
});
