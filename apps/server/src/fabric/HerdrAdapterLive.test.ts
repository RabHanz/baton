import { describe, expect, it } from "vite-plus/test";

import { parseHerdrListLine, toCandidate } from "./HerdrAdapterLive.ts";

describe("reading what Herdr prints", () => {
  it("takes a pane line apart", () => {
    const parsed = parseHerdrListLine("ops\t1\themes\tworking\thermes");
    expect(parsed).toEqual({
      workspace: "ops",
      pane: "1",
      label: "hemes",
      runtimeState: "working",
      agentKind: "hermes",
    });
  });

  it("treats a missing agent kind as unknown rather than as a name", () => {
    // A terminal somebody opened by hand has no agent, and that is a normal
    // answer rather than a gap to fill in.
    expect(parseHerdrListLine("ops\t2\tlogs\tidle")?.agentKind).toBeNull();
    expect(parseHerdrListLine("ops\t2\tlogs\tidle\t")?.agentKind).toBeNull();
  });

  it("skips a line it cannot read instead of guessing at it", () => {
    expect(parseHerdrListLine("ops\t1")).toBeNull();
    expect(parseHerdrListLine("")).toBeNull();
    expect(parseHerdrListLine("ops\t\thermes\tworking")).toBeNull();
  });
});

describe("turning a pane into a candidate", () => {
  it("maps the state Fabric knows", () => {
    const candidate = toCandidate("ops\t1\themes\tblocked\thermes");
    expect(candidate?.runtime).toBe("herdr");
    expect(candidate?.runtimeState).toBe("blocked");
    expect(candidate?.state).toBe("needs_input");
  });

  it("still shows a pane whose state Fabric does not know", () => {
    // The user can see it exists — hiding it would be worse — and it cannot be
    // adopted until the mapping learns the word.
    const candidate = toCandidate("ops\t1\themes\tcompacting\thermes");
    expect(candidate).not.toBeNull();
    expect(candidate?.state).toBeNull();
    expect(candidate?.runtimeState).toBe("compacting");
  });
});
