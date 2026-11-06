import { describe, expect, it } from "vite-plus/test";

import { isAddressedFollowUp } from "./followUp.ts";

describe("a follow-up after an answer", () => {
  it.each([
    "What about Rome?",
    "and in Paris?",
    "Tell me more about that",
    "show me the last one",
    "Can you read it again",
    "I want the one from Tuesday",
    // 0.1.61: said 2 s after her reply, and dropped.
    "I wanted to test the dictation feature.",
    "yes please",
    "Tessaya, stop",
    "how long does it take",
  ])("is taken: %j", (said) => expect(isAddressedFollowUp(said)).toBe(true));

  it.each([
    "Alfonso thinks the festival starts at eight",
    "The government announced new measures today",
    "That sounds like a statement rather than a question",
    "Sabrina is coming over later",
    "it was raining all weekend",
    "Sebastopol fell after eleven months",
    "",
    "   ",
  ])("is let go in silence: %j", (said) => expect(isAddressedFollowUp(said)).toBe(false));
});
