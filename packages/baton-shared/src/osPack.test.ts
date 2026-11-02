import { describe, expect, it } from "vite-plus/test";

import { DEFAULT_OS_PACK, mergePack, packPrompt, PACK_PROMPT_CHARS } from "./osPack.ts";

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
});
