import { describe, expect, it } from "vite-plus/test";

import { createCpuLoad } from "./cpuLoad.ts";

describe("how busy the machine was", () => {
  it("is the share of every core's time spent working since the last reading", () => {
    let t = { user: 100, sys: 0, idle: 100 };
    const load = createCpuLoad(() => [{ times: t }, { times: t }]);
    t = { user: 175, sys: 0, idle: 125 };
    expect(load()).toBe(75);
    expect(load()).toBe(null);
  });
});
