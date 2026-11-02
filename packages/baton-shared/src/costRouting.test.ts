import { describe, expect, it } from "vite-plus/test";

import { DEFAULT_ROUTING, modelFor, parseRouting } from "./costRouting.ts";

describe("cost routing", () => {
  it("gives planning and judgment the strong model and routine work the cheap one", () => {
    expect(modelFor("planning", DEFAULT_ROUTING)).toBe("opus");
    expect(modelFor("judgment", DEFAULT_ROUTING)).toBe("opus");
    expect(modelFor("routine", DEFAULT_ROUTING)).toBe("haiku");
  });
  it("reads his table over the default and ignores anything that is not a model name", () => {
    expect(parseRouting('{"strong":"sonnet","cheap":"x y"}')).toEqual({
      strong: "sonnet",
      cheap: "haiku",
    });
    expect(parseRouting("not json")).toEqual(DEFAULT_ROUTING);
    expect(parseRouting(undefined)).toEqual(DEFAULT_ROUTING);
  });
});
