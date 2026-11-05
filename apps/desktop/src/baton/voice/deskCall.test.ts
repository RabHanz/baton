import { describe, expect, it } from "vite-plus/test";

import { deskCall } from "./deskCall.ts";

describe("a request answered by this machine's server while T3 is closed", () => {
  it("shapes job and memory calls as the sidebar does, and leaves the window's own requests alone", () => {
    expect(deskCall({ kind: "job", op: "watch", args: {} })).toEqual({
      method: "baton.watch.get",
      input: {},
    });
    expect(deskCall({ kind: "job", op: "refine", args: { id: "w1", text: "smaller" } })).toEqual({
      method: "baton.job.refine",
      input: { id: "w1", text: "smaller", via: "voice", widens: false },
    });
    expect(deskCall({ kind: "memory", op: "search", args: { query: "tea" } })).toEqual({
      method: "baton.memory.search",
      input: { query: "tea" },
    });
    expect(deskCall({ kind: "job", op: "start", args: {} })).toBeNull();
    expect(deskCall({ kind: "memory", op: "sync", args: {} })).toBeNull();
    expect(deskCall({ kind: "run" })).toBeNull();
  });
});
