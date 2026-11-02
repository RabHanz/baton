import type { ClaudeLiveSession } from "@t3tools/baton-contracts";
import { describe, expect, it } from "vite-plus/test";

import { createSessionCatalog, type CatalogPorts, type TranscriptInfo } from "./SessionCatalog.ts";

const ID = "11111111-2222-3333-4444-555555555555";
const OLD = "99999999-2222-3333-4444-555555555555";
const live = (over: Partial<ClaudeLiveSession> = {}): ClaudeLiveSession =>
  ({
    pid: 1,
    sessionId: ID,
    cwd: "/work/shop",
    name: "Shop",
    status: "idle",
    entrypoint: "cli",
    herdrPane: "fab-shop~p1",
    tmux: null,
    account: "ann",
    updatedAt: "2026-11-02T10:00:00.000Z",
    ...over,
  }) as ClaudeLiveSession;
const transcript = (over: Partial<TranscriptInfo> = {}): TranscriptInfo => ({
  sessionId: ID,
  cwd: "/work/shop",
  title: "Fix the checkout",
  lastActivityAt: "2026-11-01T09:00:00.000Z",
  account: "ann",
  ...over,
});

/** A machine where the session is stopped, and `baton --resume` brings it up in a Herdr pane a moment later. */
const machine = (over: Partial<CatalogPorts> = {}) => {
  const typed: Array<[string, string]> = [];
  const batonCalls: ReadonlyArray<string>[] = [];
  let sessions: ReadonlyArray<ClaudeLiveSession> = [];
  let clock = 0;
  let upAt = Infinity;
  const ports: CatalogPorts = {
    machine: "box",
    live: async () => (clock >= upAt ? sessions : []),
    transcripts: async () => [
      transcript(),
      transcript({
        sessionId: OLD,
        title: "Old work",
        lastActivityAt: "2026-10-01T09:00:00.000Z",
        cwd: "/gone/folder",
      }),
    ],
    history: async () => [],
    dirExists: (d) => d === "/work/shop" || d === "/work/new",
    baton: async (args) => {
      batonCalls.push(args);
      upAt = clock + 1_500;
      sessions =
        args[0] === "--resume"
          ? [live()]
          : [live({ sessionId: "new-1", cwd: args[0]!, herdrPane: "fab-new~p9" })];
      return { ok: true, out: "baton: claude running in fab-shop pane p1" };
    },
    type: async (pane, text) => (typed.push([pane, text]), true),
    sleep: async (ms) => void (clock += ms),
    now: () => clock,
    ...over,
  };
  return { catalog: createSessionCatalog(ports), typed, batonCalls };
};

describe("sending to a stopped session", () => {
  it("on a machine with no Herdr it comes back as a thread and does not call baton", async () => {
    const { catalog, batonCalls } = machine({
      thread: async (id) => ({ threadId: `import:claudeAgent:${id}` }),
    });
    expect(await catalog.resume({ sessionId: ID })).toEqual({
      state: "running",
      pane: null,
      detail: null,
      threadId: `import:claudeAgent:${ID}`,
    });
    expect(batonCalls).toEqual([]);
    const sent = await catalog.send({ sessionId: ID, text: "hi" });
    expect(sent.delivered).toBe(false);
    expect(sent.detail).toContain("thread");
  });

  it("a new session on a machine with no Herdr is a thread with the model, effort and first message asked for, and no baton call", async () => {
    const launched: unknown[] = [];
    const { catalog, batonCalls } = machine({
      launch: async (input) => (launched.push(input), { threadId: "thread-1" }),
    });
    const made = await catalog.create({
      cwd: "/work/new",
      model: "opus",
      effort: "high",
      message: "Read BRIEF.md",
    });
    expect(made).toMatchObject({ state: "running", threadId: "thread-1", pane: null });
    expect(launched).toEqual([
      { cwd: "/work/new", model: "opus", effort: "high", message: "Read BRIEF.md" },
    ]);
    expect(batonCalls).toEqual([]);
    const missing = await catalog.create({ cwd: "/work/nope" });
    expect(missing.state).toBe("failed");
  });

  it("resumes it in the right folder, waits until it is ready, then delivers the message once", async () => {
    const { catalog, typed, batonCalls } = machine();
    const sent = await catalog.send({ sessionId: ID, text: "carry on with the tests" });
    expect(batonCalls).toEqual([["--resume", ID, "/work/shop"]]);
    expect(sent).toEqual({ state: "running", delivered: true, detail: null });
    expect(typed).toEqual([["fab-shop~p1", "carry on with the tests"]]);
  });

  it("keeps the message and says why when it cannot be resumed, and never reports 'not delivered' as final", async () => {
    const { catalog, typed } = machine({
      baton: async () => ({ ok: false, out: "herdr: no server" }),
    });
    const sent = await catalog.send({ sessionId: ID, text: "hello" });
    expect(sent.state).toBe("failed");
    expect(sent.delivered).toBe(false);
    expect(sent.detail).toContain("Herdr would not start it: herdr: no server");
    expect(sent.detail).toContain("Your message is kept.");
    expect(typed).toEqual([]);
    const row = (await catalog.list({})).sessions.find((r) => r.id === ID)!;
    expect(row).toMatchObject({ state: "failed", waiting: 1 });
  });

  it("names Claude's folder-trust question when that is what the session is waiting on", async () => {
    const { catalog, typed } = machine({
      live: async () => [],
      screen: async () =>
        " Quick safety check: Is this a project you created or one you trust?\n ❯ No, exit\n   Yes, I trust this folder",
    });
    const sent = await catalog.send({ sessionId: ID, text: "hello" });
    expect(sent.detail).toContain("asking whether to trust this folder");
    expect(sent.detail).toContain("herdr --session fab-shop");
    expect(sent.detail).toContain("Your message is kept.");
    expect(typed).toEqual([]);
  });

  it("times out with a readable reason when it starts but never becomes ready", async () => {
    const { catalog } = machine({ live: async () => [] });
    const sent = await catalog.send({ sessionId: ID, text: "hello" });
    expect(sent.detail).toContain("did not become ready within 45 seconds");
  });

  it("delivers a message sent while it is already resuming, in order, with one resume", async () => {
    const { catalog, typed, batonCalls } = machine();
    const first = catalog.send({ sessionId: ID, text: "one" });
    const second = await catalog.send({ sessionId: ID, text: "two" });
    expect(second.state).toBe("resuming");
    await first;
    expect(batonCalls).toHaveLength(1);
    expect(typed.map((t) => t[1])).toEqual(["one", "two"]);
  });

  it("types straight into a session that is already running in Herdr", async () => {
    const { catalog, typed, batonCalls } = machine({ live: async () => [live()] });
    expect((await catalog.send({ sessionId: ID, text: "now" })).delivered).toBe(true);
    expect(batonCalls).toEqual([]);
    expect(typed).toEqual([["fab-shop~p1", "now"]]);
  });

  it("does not pretend to reach a session in a plain terminal", async () => {
    const { catalog, typed } = machine({ live: async () => [live({ herdrPane: null })] });
    const sent = await catalog.send({ sessionId: ID, text: "now" });
    expect(sent.state).toBe("failed");
    expect(sent.detail).toContain("plain terminal");
    expect(typed).toEqual([]);
  });
});

describe("resuming", () => {
  it("is one tap: the right folder, ready in Herdr, and a second tap while it works changes nothing", async () => {
    const { catalog, batonCalls } = machine();
    const first = catalog.resume({ sessionId: ID });
    expect(await catalog.resume({ sessionId: ID })).toMatchObject({ state: "resuming" });
    expect(await first).toMatchObject({ state: "running", pane: "fab-shop~p1" });
    expect(batonCalls).toHaveLength(1);
    expect(await catalog.resume({ sessionId: ID })).toMatchObject({ state: "running" });
    expect(batonCalls).toHaveLength(1);
  });

  it("says plainly when the folder is gone or unknown", async () => {
    const { catalog } = machine();
    expect(await catalog.resume({ sessionId: OLD })).toMatchObject({
      state: "failed",
      detail: "The folder /gone/folder is not on this machine.",
    });
    expect(await catalog.resume({ sessionId: "nope" })).toMatchObject({ state: "failed" });
    expect((await catalog.resume({ sessionId: "nope" })).detail).toContain("which folder");
  });
});

describe("browsing", () => {
  it("lists running and stopped sessions newest first with project, title, account and machine, and says why one cannot be resumed", async () => {
    const { catalog } = machine({
      live: async () => [
        live({
          sessionId: "run-1",
          cwd: "/work/api",
          name: "API",
          updatedAt: "2026-11-02T12:00:00.000Z",
          account: "bob",
        }),
      ],
    });
    const { sessions, machine: name } = await catalog.list({});
    expect(name).toBe("box");
    expect(sessions.map((s) => [s.id, s.state, s.project, s.account, s.canResume])).toEqual([
      ["run-1", "running", "api", "bob", false],
      [ID, "stopped", "shop", "ann", true],
      [OLD, "stopped", "folder", "ann", false],
    ]);
    expect(sessions[2]!.detail).toContain("not on this machine");
    expect(sessions[1]!.title).toBe("Fix the checkout");
  });

  it("finds older sessions through the history index when words are given, and marks them read-only when the transcript is gone", async () => {
    const { catalog } = machine({
      history: async (q) =>
        q.includes("invoice")
          ? [
              { sessionId: "hist-1", project: "-home-ann-books", at: "2026-09-01T10:00:00.000Z" },
              { sessionId: ID, project: "-work-shop", at: null },
            ]
          : [],
    });
    expect((await catalog.list({})).sessions.some((s) => s.source === "history")).toBe(false);
    const found = (await catalog.list({ query: "invoice" })).sessions;
    const hist = found.find((s) => s.id === "hist-1")!;
    expect(hist).toMatchObject({ source: "history", canResume: false, project: "ann-books" });
    expect(hist.detail).toContain("no longer on this machine");
    expect(found.filter((s) => s.id === ID)).toHaveLength(1);
  });

  it("pages by time and offers folders worth starting in", async () => {
    const { catalog } = machine();
    const page = await catalog.list({ limit: 1 });
    expect(page.sessions).toHaveLength(1);
    expect(page.more).toBe(true);
    const older = await catalog.list({ before: page.sessions[0]!.lastActivityAt! });
    expect(older.sessions.map((s) => s.id)).toEqual([OLD]);
    expect((await catalog.folders({})).folders.map((f) => f.cwd)).toEqual(["/work/shop"]);
  });
});

describe("starting a new session", () => {
  it("starts baton in the folder and returns the session once it reports in", async () => {
    const { catalog, batonCalls } = machine();
    const made = await catalog.create({ cwd: "/work/new" });
    expect(batonCalls).toEqual([["/work/new", "claude"]]);
    expect(made).toEqual({
      state: "running",
      sessionId: "new-1",
      pane: "fab-new~p9",
      detail: null,
    });
  });

  it("refuses a folder that is not here", async () => {
    const { catalog, batonCalls } = machine();
    expect(await catalog.create({ cwd: "/nowhere" })).toMatchObject({
      state: "failed",
      detail: "The folder /nowhere is not on this machine.",
    });
    expect(batonCalls).toEqual([]);
  });
});
