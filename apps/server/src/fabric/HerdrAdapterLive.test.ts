import { describe, expect, it } from "vite-plus/test";

import { paneCandidate, parseHerdrJson } from "./HerdrAdapterLive.ts";

/**
 * The fixture below is copied from the installed binary's own output — `herdr
 * pane list` on herdr 0.9.1, protocol 22 — rather than from a plausible idea of
 * what a CLI prints. The version of this file it replaces tested a
 * tab-separated `herdr list` that does not exist in 0.9.1, and it passed every
 * run while the adapter behind it could never have found a single pane.
 */
const PANE_LIST_OUTPUT = `{"id":"cli:pane:list","result":{"panes":[{"agent_status":"unknown","cwd":"/mnt/HC_Volume_106652742/tmp/lanes","focused":true,"foreground_cwd":"/mnt/HC_Volume_106652742/tmp/lanes","pane_id":"w1:p1","revision":0,"tab_id":"w1:t1","terminal_id":"term_65bc9925e17c11","workspace_id":"w1"}],"type":"pane_list"}}`;

describe("reading what Herdr prints", () => {
  it("takes the JSON object out of a command's output", () => {
    const parsed = parseHerdrJson(PANE_LIST_OUTPUT) as {
      readonly result: { readonly panes: ReadonlyArray<{ readonly pane_id: string }> };
    };
    expect(parsed.result.panes[0]?.pane_id).toBe("w1:p1");
  });

  it("takes the last object when something is printed before it", () => {
    const parsed = parseHerdrJson(`warning: stale config\n${PANE_LIST_OUTPUT}`) as {
      readonly result: { readonly panes: ReadonlyArray<unknown> };
    };
    expect(parsed.result.panes).toHaveLength(1);
  });

  it("returns null rather than guessing when nothing parses", () => {
    expect(parseHerdrJson("herdr: no server running")).toBeNull();
    expect(parseHerdrJson("")).toBeNull();
    expect(parseHerdrJson("{not json")).toBeNull();
  });
});

describe("turning a pane into a candidate", () => {
  it("maps a state Fabric knows and names the agent first", () => {
    const candidate = paneCandidate({
      paneId: "w1:p1",
      workspaceLabel: "proof",
      cwd: "/home/onnyx/VentureOS",
      agentKind: "claude",
      runtimeState: "blocked",
    });

    expect(candidate).toMatchObject({
      runtime: "herdr",
      label: "claude · proof",
      location: { workspace: "proof", pane: "w1:p1", host: null },
      agentKind: "claude",
      runtimeState: "blocked",
      // §9: Herdr can tell that a pane is waiting for a human and cannot tell
      // whether it wants an answer or permission, so the weaker of the two is
      // what Fabric claims.
      state: "needs_input",
    });
  });

  it("names a bare pane by the directory it is sitting in", () => {
    // A terminal somebody opened by hand has no agent, which is a normal answer
    // rather than a gap to fill in — and the directory is the only thing that
    // tells two otherwise identical panes apart.
    expect(
      paneCandidate({
        paneId: "w1:p2",
        workspaceLabel: "proof",
        cwd: "/mnt/HC_Volume_106652742/tmp/lanes",
        agentKind: null,
        runtimeState: "idle",
      }),
    ).toMatchObject({
      label: "proof · /mnt/HC_Volume_106652742/tmp/lanes",
      agentKind: null,
      state: "idle",
    });
  });

  it("still shows a pane whose state Fabric does not know", () => {
    // `unknown` is in Herdr's own status enum and is not a state Fabric can act
    // on. The candidate is listed — it exists, and hiding it would be worse —
    // and carries a null state, which is the thing that stops it being adopted.
    const candidate = paneCandidate({
      paneId: "w1:p1",
      workspaceLabel: "proof",
      cwd: null,
      agentKind: "claude",
      runtimeState: "unknown",
    });
    expect(candidate.runtimeState).toBe("unknown");
    expect(candidate.state).toBeNull();
  });
});
