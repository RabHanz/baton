/**
 * The adapter, driven by output captured from `herdr 0.9.1` on the box.
 *
 * Every fixture in `__fixtures__/herdr-0.9.1/` is a real CLI response rather
 * than a hand-written approximation of one, and that distinction already paid:
 * an invented `process-info` would have had an empty `foreground_processes` for
 * an idle pane. The real one reports the shell itself, so "the list is not
 * empty" read every idle terminal as busy.
 */
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import * as Effect from "effect/Effect";
import type * as Layer from "effect/Layer";
import { describe, expect, it } from "vite-plus/test";

import { AdoptedRuntimeAdapter } from "./AdoptedSessionService.ts";
import {
  layerWith,
  paneLabel,
  parseHerdrError,
  parseHerdrForeground,
  parseHerdrSnapshot,
  toCandidate,
  type HerdrCommandResult,
} from "./HerdrAdapterLive.ts";

const fixture = (name: string): string =>
  NodeFS.readFileSync(
    NodePath.join(import.meta.dirname, "__fixtures__", "herdr-0.9.1", name),
    "utf8",
  );

const SNAPSHOT = fixture("api-snapshot.json");
const PROCESS_RUNNING = fixture("pane-process-info-running.json");
const PROCESS_IDLE = fixture("pane-process-info-idle.json");
const ERROR_NO_SERVER = fixture("error-server-not-running.json");
const ERROR_NO_PANE = fixture("error-pane-not-found.json");
const PANE_READ = fixture("pane-read.txt");

const ok = (stdout: string): HerdrCommandResult => ({
  stdout,
  stderr: "",
  exitCode: 0,
  notInstalled: false,
});
const failed = (stderr: string): HerdrCommandResult => ({
  stdout: "",
  stderr,
  exitCode: 1,
  notInstalled: false,
});
/** What the runner reports on a machine with no `herdr` binary: ENOENT. */
const missing = (): HerdrCommandResult => ({
  stdout: "",
  stderr: "",
  exitCode: 1,
  notInstalled: true,
});

/** A fake `herdr` that answers from the fixtures, keyed on the argv. */
const scriptedCli = (
  answers: ReadonlyArray<readonly [string, HerdrCommandResult]>,
  calls?: Array<ReadonlyArray<string>>,
): Layer.Layer<AdoptedRuntimeAdapter> =>
  layerWith((args) => {
    calls?.push(args);
    const key = args.join(" ");
    const match = answers.find(([prefix]) => key.startsWith(prefix));
    return Effect.succeed(
      match?.[1] ?? failed(`{"error":{"code":"unexpected_call","message":"${key}"}}`),
    );
  });

const runAdapter = <A>(
  layer: Layer.Layer<AdoptedRuntimeAdapter>,
  use: (adapter: AdoptedRuntimeAdapter["Service"]) => Effect.Effect<A>,
): Promise<A> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const adapter = yield* AdoptedRuntimeAdapter;
      return yield* use(adapter);
    }).pipe(Effect.provide(layer)),
  );

describe("the error envelope herdr prints", () => {
  it("takes apart a real server_not_running", () => {
    const parsed = parseHerdrError(ERROR_NO_SERVER);
    expect(parsed?.code).toBe("server_not_running");
    expect(parsed?.message).toContain("no herdr server is running");
  });

  it("takes apart a real pane_not_found", () => {
    expect(parseHerdrError(ERROR_NO_PANE)?.code).toBe("pane_not_found");
  });

  it("returns null for stderr that is not the envelope, so the caller quotes it whole", () => {
    // A panic or a missing shared library is still a failure worth showing, and
    // pretending it parsed would drop the only text that explains it.
    expect(parseHerdrError("herdr: error while loading shared libraries")).toBeNull();
    expect(parseHerdrError("")).toBeNull();
    expect(parseHerdrError("{}")).toBeNull();
  });
});

describe("the snapshot herdr prints", () => {
  it("reads the real one", () => {
    const snapshot = parseHerdrSnapshot(SNAPSHOT);
    expect(snapshot).not.toBeNull();
    expect(snapshot?.panes.length).toBeGreaterThanOrEqual(2);
    const pane = snapshot?.panes.find((entry) => entry.paneId === "w1:p1");
    expect(pane?.workspaceId).toBe("w1");
    expect(pane?.agentStatus).toBe("unknown");
    expect(snapshot?.workspaceLabels.get("w1")).toBe("proof");
  });

  it("refuses output it cannot read rather than reporting an empty server", () => {
    // "no panes" and "I could not read the answer" are different facts, and the
    // first would read as "nothing is running".
    expect(parseHerdrSnapshot("not json")).toBeNull();
    expect(parseHerdrSnapshot("{}")).toBeNull();
    expect(parseHerdrSnapshot('{"result":{}}')).toBeNull();
  });

  it("skips an entry that cannot identify itself", () => {
    const snapshot = parseHerdrSnapshot(
      JSON.stringify({
        result: { snapshot: { panes: [{ pane_id: "w1:p1" }, { workspace_id: "w1" }], agents: [] } },
      }),
    );
    expect(snapshot?.panes).toEqual([]);
  });
});

describe("what is running in a pane", () => {
  it("names the command in a busy pane", () => {
    expect(parseHerdrForeground(PROCESS_RUNNING)).toContain("ticker.sh");
  });

  it("reports nothing for a pane at its prompt, where the shell IS the foreground process", () => {
    // The fixture's foreground_processes is [{ "/bin/bash" }] — not empty.
    expect(parseHerdrForeground(PROCESS_IDLE)).toBeNull();
  });
});

describe("naming a pane", () => {
  it("prefers the agent, then the command, then the directory", () => {
    expect(
      paneLabel({
        agentName: "reviewer",
        agentKind: "claude",
        foreground: "x",
        cwd: "/a/b",
        paneId: "w1:p1",
      }),
    ).toBe("reviewer (claude)");
    expect(
      paneLabel({
        agentName: null,
        agentKind: null,
        foreground: "pnpm test",
        cwd: "/a/b",
        paneId: "w1:p1",
      }),
    ).toBe("pnpm test");
    expect(
      paneLabel({ agentName: null, agentKind: null, foreground: null, cwd: "/a/b", paneId: "w1:p1" }),
    ).toBe("shell in b");
    expect(
      paneLabel({ agentName: null, agentKind: null, foreground: null, cwd: null, paneId: "w1:p1" }),
    ).toBe("w1:p1");
  });
});

describe("turning a pane into a candidate", () => {
  const pane = {
    paneId: "w1:p1",
    workspaceId: "w1",
    tabId: "w1:t1",
    cwd: "/work",
    agentStatus: "unknown",
  };

  it("maps a recognised agent's state by §9's table", () => {
    const candidate = toCandidate({
      pane,
      agent: { paneId: "w1:p1", name: "hermes-1", kind: "hermes", state: "blocked" },
      workspaceLabel: "ops",
      foreground: null,
    });
    expect(candidate.runtimeState).toBe("blocked");
    expect(candidate.state).toBe("needs_input");
    expect(candidate.agentKind).toBe("hermes");
    expect(candidate.location.workspace).toBe("ops");
  });

  it("calls an unclassified pane with something running 'monitoring', never 'needs_input'", () => {
    const candidate = toCandidate({
      pane,
      agent: null,
      workspaceLabel: "ops",
      foreground: "bash ticker.sh",
    });
    expect(candidate.state).toBe("monitoring");
    expect(candidate.label).toBe("bash ticker.sh");
  });

  it("calls an unclassified pane at its prompt 'idle'", () => {
    const candidate = toCandidate({ pane, agent: null, workspaceLabel: "ops", foreground: null });
    expect(candidate.state).toBe("idle");
  });

  it("still shows a pane whose state word Fabric does not know, with no state (D38)", () => {
    const candidate = toCandidate({
      pane,
      agent: { paneId: "w1:p1", name: "a", kind: "claude", state: "compacting" },
      workspaceLabel: "ops",
      foreground: null,
    });
    expect(candidate.state).toBeNull();
    expect(candidate.runtimeState).toBe("compacting");
  });
});

describe("discovery against the captured CLI", () => {
  it("returns the real panes, with the busy one and the idle one told apart", async () => {
    const calls: Array<ReadonlyArray<string>> = [];
    const result = await runAdapter(
      scriptedCli(
        [
          ["api snapshot", ok(SNAPSHOT)],
          ["pane process-info --pane w1:p1", ok(PROCESS_RUNNING)],
          ["pane process-info --pane w1:p2", ok(PROCESS_IDLE)],
        ],
        calls,
      ),
      (adapter) => adapter.discover,
    );

    expect(result.available).toBe(true);
    expect(result.reason).toBe("");
    const busy = result.candidates.find((entry) => entry.location.pane === "w1:p1");
    const idle = result.candidates.find((entry) => entry.location.pane === "w1:p2");
    expect(busy?.state).toBe("monitoring");
    expect(busy?.label).toContain("ticker.sh");
    expect(idle?.state).toBe("idle");
    // One snapshot call first, then one enrichment per agent-less pane — never
    // four list calls that can disagree with each other.
    expect(calls[0]).toEqual(["api", "snapshot"]);
  });

  it("says the server is not running, which is not the same as not installed", async () => {
    const result = await runAdapter(
      scriptedCli([["api snapshot", failed(ERROR_NO_SERVER)]]),
      (adapter) => adapter.discover,
    );
    expect(result.available).toBe(false);
    expect(result.candidates).toEqual([]);
    expect(result.reason).toContain("herdr is installed here, but no server is running");
    expect(result.reason).not.toContain("not installed on this environment");
  });

  it("quotes a refusal it did not expect, by code", async () => {
    const result = await runAdapter(
      scriptedCli([["api snapshot", failed('{"error":{"code":"forbidden","message":"nope"}}')]]),
      (adapter) => adapter.discover,
    );
    expect(result.reason).toContain("forbidden");
    expect(result.reason).toContain("nope");
  });

  it("refuses unreadable output rather than reporting an empty server", async () => {
    const result = await runAdapter(
      scriptedCli([["api snapshot", ok("<html>proxy error</html>")]]),
      (adapter) => adapter.discover,
    );
    expect(result.available).toBe(false);
    expect(result.reason).toContain("not a shape Fabric reads");
  });

  it("says 'not installed' only when the binary really is absent", async () => {
    // The distinction the whole result shape exists for: this is a different
    // fact from "no server", and it has a different fix.
    const result = await runAdapter(scriptedCli([["api snapshot", missing()]]), (adapter) =>
      adapter.discover,
    );
    expect(result.available).toBe(false);
    expect(result.reason).toContain("herdr is not installed on this environment");
  });
});

const session: Parameters<AdoptedRuntimeAdapter["Service"]["sendInput"]>[0]["session"] = {
  id: "herdr:w1:p1" as Parameters<
    AdoptedRuntimeAdapter["Service"]["sendInput"]
  >[0]["session"]["id"],
  runtime: "herdr",
  workSessionId: null,
  label: "ticker",
  location: { workspace: "proof", pane: "w1:p1", host: null },
  agentKind: null,
  state: "monitoring",
  capabilities: {
    readConversation: false,
    sendInput: true,
    approvals: false,
    diffs: false,
    stop: true,
    showTerminal: true,
  },
  observedAt: "2026-09-18T22:00:00.000Z",
  createdAt: "2026-09-18T22:00:00.000Z",
  detachedAt: null,
};

describe("typing into a pane", () => {
  it("sends the text and, when asked, return", async () => {
    const calls: Array<ReadonlyArray<string>> = [];
    const result = await runAdapter(
      scriptedCli(
        [
          ["pane send-text", ok("{}")],
          ["pane send-keys", ok("{}")],
        ],
        calls,
      ),
      (adapter) => adapter.sendInput({ session, text: "status", submit: true }),
    );
    expect(result.delivered).toBe(true);
    expect(calls).toEqual([
      ["pane", "send-text", "w1:p1", "status"],
      ["pane", "send-keys", "w1:p1", "enter"],
    ]);
  });

  it("does not press return unless asked", async () => {
    const calls: Array<ReadonlyArray<string>> = [];
    const result = await runAdapter(scriptedCli([["pane send-text", ok("{}")]], calls), (adapter) =>
      adapter.sendInput({ session, text: "status", submit: false }),
    );
    expect(result.delivered).toBe(true);
    expect(result.detail).toContain("without pressing return");
    expect(calls).toHaveLength(1);
  });

  it("says which half happened when the text lands and return does not", async () => {
    const result = await runAdapter(
      scriptedCli([
        ["pane send-text", ok("{}")],
        ["pane send-keys", failed('{"error":{"code":"pane_not_found","message":"gone"}}')],
      ]),
      (adapter) => adapter.sendInput({ session, text: "status", submit: true }),
    );
    expect(result.delivered).toBe(false);
    expect(result.detail).toContain("but return did not");
  });
});

describe("reading a pane", () => {
  it("returns the terminal's text, wraps joined", async () => {
    const calls: Array<ReadonlyArray<string>> = [];
    const result = await runAdapter(scriptedCli([["pane read", ok(PANE_READ)]], calls), (adapter) =>
      adapter.readOutput({ session, lines: 5 }),
    );
    expect(result.available).toBe(true);
    expect(result.output).toContain("tick");
    expect(calls[0]).toEqual([
      "pane",
      "read",
      "w1:p1",
      "--source",
      "recent-unwrapped",
      "--lines",
      "5",
    ]);
  });

  it("refuses by name when the pane has gone", async () => {
    const result = await runAdapter(scriptedCli([["pane read", failed(ERROR_NO_PANE)]]), (adapter) =>
      adapter.readOutput({ session, lines: 5 }),
    );
    expect(result.available).toBe(false);
    expect(result.detail).toContain("pane_not_found");
    expect(result.output).toBe("");
  });
});
