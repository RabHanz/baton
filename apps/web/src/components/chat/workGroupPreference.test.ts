import { expect, it } from "vite-plus/test";

import { getKeepWorkExpanded } from "./workGroupPreference";

it("Keep work groups expanded is off until he turns it on", () => {
  expect(getKeepWorkExpanded()).toBe(false);
});
