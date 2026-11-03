import * as NodeVM from "node:vm";
import { expect, it } from "vite-plus/test";

import { markPhase, WATCH_SOURCE } from "./mainStall.ts";

it("the watcher program is valid and markers are harmless before the watch starts", () => {
  expect(() => new NodeVM.Script(WATCH_SOURCE)).not.toThrow();
  expect(() => markPhase("anything", { a: 1 })).not.toThrow();
});
