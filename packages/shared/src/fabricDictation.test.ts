import { describe, expect, it } from "vite-plus/test";

import { classifyDictation, staysLocal } from "./fabricDictation.ts";

const idle = { dictating: false };
const on = { dictating: true };

describe("classifyDictation", () => {
  it("takes the specification's own dictation sentence", () => {
    // §14's worked example: the user is in Gmail compose and says this.
    const command = classifyDictation(
      "Dictate: Thanks, I'll send the revised version tomorrow.",
      idle,
    );
    expect(command.kind).toBe("start");
    if (command.kind !== "start") return;
    // The words go into somebody's email, so they keep their capitals.
    expect(command.text).toBe("Thanks, I'll send the revised version tomorrow.");
  });

  it("starts with no text when the user only asks for the mode", () => {
    const command = classifyDictation("Jarvis, dictate", idle);
    expect(command).toEqual({ kind: "start", text: null });
  });

  it("stops on the specification's phrase, in either mode", () => {
    expect(classifyDictation("stop dictating", on).kind).toBe("stop");
    expect(classifyDictation("Stop dictating.", idle).kind).toBe("stop");
  });

  it("treats ordinary speech as text while the mode is on, and as an instruction when it is off", () => {
    // §12.3: dictation and agent routing must stay distinguishable, and the
    // mode is what distinguishes them.
    expect(classifyDictation("what needs me", idle)).toEqual({ kind: "not_dictation" });
    expect(classifyDictation("What needs me", on)).toEqual({
      kind: "text",
      text: "What needs me",
    });
  });

  it("keeps dictated words on the client", () => {
    // The rule this module exists for: an environment has no business
    // receiving the contents of somebody's email.
    expect(staysLocal(classifyDictation("dictate: the contract is attached", idle))).toBe(true);
    expect(staysLocal(classifyDictation("hello there", on))).toBe(true);
    expect(staysLocal(classifyDictation("tell claude to run the tests", idle))).toBe(false);
  });

  it("does not mistake a sentence about dictation for dictation", () => {
    const command = classifyDictation("tell claude the dictation is broken", idle);
    expect(command.kind).toBe("not_dictation");
  });

  it("is case-insensitive and tolerates curly apostrophes", () => {
    const command = classifyDictation("DICTATE — I’ll be late", idle);
    expect(command.kind).toBe("start");
  });
});
