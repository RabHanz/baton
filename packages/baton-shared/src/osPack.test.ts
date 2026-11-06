import { describe, expect, it } from "vite-plus/test";

import {
  DEFAULT_OS_PACK,
  mergePack,
  modelOf,
  packPrompt,
  PACK_PROMPT_CHARS,
  personaFor,
} from "./osPack.ts";

describe("the operating-system pack", () => {
  it("lets a user's files win by name, ignores bad names and empty files, and keeps the rest", () => {
    const merged = mergePack({
      executive: "  My way.  ",
      roles: { research: "Mine.", "../evil": "x", legal: "A lawyer.", marketing: "   " },
    });
    expect(merged.executive).toBe("My way.");
    expect(merged.roles["research"]).toBe("Mine.");
    expect(merged.roles["legal"]).toBe("A lawyer.");
    expect(merged.roles["../evil"]).toBeUndefined();
    expect(merged.roles["marketing"]).toBe(DEFAULT_OS_PACK.roles["marketing"]);
    expect(mergePack({}).executive).toBe(DEFAULT_OS_PACK.executive);
  });
  it("frames the planning turn and stays within its cap", () => {
    expect(packPrompt(DEFAULT_OS_PACK)).toContain("job brief");
    expect(packPrompt(mergePack({ executive: "x".repeat(20_000) })).length).toBe(PACK_PROMPT_CHARS);
  });
  it("keeps the front-matter out of the briefs the planner reads", () => {
    expect(packPrompt(DEFAULT_OS_PACK)).not.toContain("voice:");
    expect(DEFAULT_OS_PACK.roles["research"]).toMatch(/^Persona:/);
  });
});

describe("the roster", () => {
  const who = (pack = DEFAULT_OS_PACK, wake: string | null = null, text = "what time is it") => {
    const p = personaFor(pack.personas, { wake, text });
    return `${p.name}/${p.voice}`;
  };
  it("answers a wake word with that persona's name and voice", () => {
    expect(who(DEFAULT_OS_PACK, "Freya")).toBe("Freya/vera");
    expect(who(DEFAULT_OS_PACK, "alfred")).toBe("Alfred/charles");
    expect(who(DEFAULT_OS_PACK, "Tessaya")).toBe("Tessaya/anna");
  });
  it("falls back to the lead for an unknown wake word, a hotkey or a typed ask", () => {
    expect(who(DEFAULT_OS_PACK, "Onyx")).toBe("Tessaya/anna");
    expect(who(DEFAULT_OS_PACK, null)).toBe("Tessaya/anna");
    // Sebastian has no wake word yet, so his word wakes the lead; his name in the sentence reaches him.
    expect(who(DEFAULT_OS_PACK, "Sebastian")).toBe("Tessaya/anna");
    expect(who(DEFAULT_OS_PACK, null, "Sebastian, compare these two")).toBe("Sebastian/paul");
  });
  it("lets his file override the default field by field, and add a face of his own", () => {
    const pack = mergePack({
      roles: {
        operations: "---\nvoice: anna\n---\nMy operator.",
        legal: "---\nname: Lex\nwake: Onyx\nvoice: paul\nrole: contracts\n---\nA lawyer.",
      },
    });
    expect(who(pack, "Freya")).toBe("Freya/anna");
    expect(pack.roles["operations"]).toBe("My operator.");
    expect(who(pack, "Onyx")).toBe("Lex/paul");
    // A file with no front-matter keeps the default face.
    expect(who(mergePack({ roles: { engineering: "Mine." } }), "Alfred")).toBe("Alfred/charles");
  });
  it("runs each persona on the model and effort its file names: the lead on Opus, specialists on Sonnet", () => {
    const opus = { model: "opus", effort: "medium" };
    const sonnet = { model: "sonnet", effort: "medium" };
    expect(modelOf(DEFAULT_OS_PACK, "executive")).toEqual(opus);
    expect(modelOf(DEFAULT_OS_PACK, "operations")).toEqual(sonnet);
    // A role with no face of its own is still a specialist.
    expect(modelOf(DEFAULT_OS_PACK, "marketing")).toEqual(sonnet);
    const pack = mergePack({
      executive: "---\neffort: high\n---\n",
      roles: {
        research: "---\nmodel: haiku\neffort: low\n---\nMine.",
        legal: "A lawyer.",
        operations: "---\nmodel: rm -rf /\neffort: brutal\n---\nMine.",
      },
    });
    expect(modelOf(pack, "executive")).toEqual({ model: "opus", effort: "high" });
    expect(modelOf(pack, "research")).toEqual({ model: "haiku", effort: "low" });
    expect(modelOf(pack, "legal")).toEqual(sonnet);
    expect(modelOf(pack, "operations")).toEqual(sonnet);
    expect(modelOf(pack, "nobody")).toEqual(sonnet);
  });
});
