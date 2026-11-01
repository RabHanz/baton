import { describe, expect, it } from "vite-plus/test";

import {
  effortCommand,
  modelCommand,
  readBack,
  setLiveModel,
  type LiveModelDeps,
} from "./liveModel.ts";

const said = (text: string) =>
  `{"type":"user","message":{"role":"user","content":"<local-command-stdout>${text}</local-command-stdout>"}}\n`;

const deps = (over: Partial<LiveModelDeps> & { transcript?: () => string }): LiveModelDeps => {
  let written = "";
  return {
    session: { herdrPane: "s~1", status: "idle" },
    send: async () => true,
    mark: () => 0,
    since: () => over.transcript?.() ?? written,
    wait: async () => undefined,
    ...over,
  };
};

describe("slash commands", () => {
  it("types only a model alias or id made of safe characters, and a known effort", () => {
    expect(modelCommand("claude-opus-5-5")).toBe("/model claude-opus-5-5");
    expect(modelCommand("opus")).toBe("/model opus");
    expect(modelCommand("opus; rm -rf /")).toBeNull();
    expect(modelCommand("")).toBeNull();
    expect(effortCommand("medium")).toBe("/effort medium");
    expect(effortCommand("ultra")).toBeNull();
  });
});

describe("reading the session's answer back", () => {
  it("finds the newest model or effort line in what was written after the command", () => {
    const text =
      said("Set model to `Opus 5.5 (1M context)` and saved as your default for new sessions") +
      said("Set effort level to medium");
    expect(readBack(text, "model")).toMatch(/^Set model to `Opus 5\.5/);
    expect(readBack(text, "effort")).toBe("Set effort level to medium");
    expect(readBack("{}\n", "model")).toBeNull();
  });
});

describe("setLiveModel", () => {
  it("applies the model and the effort only once the session has said so", async () => {
    const sent: string[] = [];
    let log = "";
    const result = await setLiveModel(
      deps({
        send: async (_pane, text) => {
          sent.push(text);
          log += text.startsWith("/model")
            ? said("Set model to `Opus 5.5`")
            : said("Set effort level to medium");
          return true;
        },
        since: () => log,
      }),
      { model: "claude-opus-5-5", effort: "medium" },
    );
    expect(sent).toEqual(["/model claude-opus-5-5", "/effort medium"]);
    expect(result).toMatchObject({
      state: "applied",
      confirmed: expect.arrayContaining([expect.stringContaining("Opus 5.5")]),
    });
  });

  it("says it was not confirmed when the session stays silent, never that it was applied", async () => {
    const result = await setLiveModel(deps({}), { model: "opus" });
    expect(result.state).toBe("not_confirmed");
  });

  it("offers to bring a session that is not in Herdr in, and sends nothing", async () => {
    const sent: string[] = [];
    const result = await setLiveModel(
      deps({ session: { herdrPane: null, status: "idle" }, send: async (_p, t) => !!sent.push(t) }),
      { effort: "high" },
    );
    expect(result.state).toBe("not_in_herdr");
    expect(sent).toEqual([]);
  });

  it("waits for a busy session, and refuses a bad model or effort before typing anything", async () => {
    expect(
      (await setLiveModel(deps({ session: { herdrPane: "p", status: "busy" } }), { effort: "low" }))
        .state,
    ).toBe("busy");
    expect((await setLiveModel(deps({}), { model: "x; y" })).state).toBe("refused");
    expect((await setLiveModel(deps({}), { effort: "ultra" })).state).toBe("refused");
    expect((await setLiveModel(deps({ session: null }), { effort: "low" })).state).toBe(
      "not_running",
    );
  });
});
