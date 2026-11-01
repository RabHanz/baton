import * as NodeVm from "node:vm";

import { describe, expect, it } from "vite-plus/test";

import { APP_SCRIPT } from "./appScript.ts";

describe("APP_SCRIPT", () => {
  // The page script lives in a template literal, so a stray escape such as /\+/ turns into /+/ and
  // the whole window fails to parse at runtime, where no type check can see it.
  it("parses as a script", () => {
    expect(() => new NodeVm.Script(APP_SCRIPT)).not.toThrow();
  });
});
