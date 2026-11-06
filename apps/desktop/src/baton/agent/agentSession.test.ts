// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { describe, expect, it, vi } from "vite-plus/test";

import { createConversationLog } from "../conversation/conversationLog.ts";
import { SessionClosed, type VisionSession } from "../screen/claudeVision.ts";
import { createAssistantAgent, shouldRecycle } from "./agentSession.ts";

const fakeSession = (log: string[]): VisionSession => {
  let alive = true;
  return {
    ask: async (content) => {
      const text = content.map((c) => (c.type === "text" ? c.text : "[image]")).join("\n");
      log.push(text);
      return "I typed it.";
    },
    alive: () => alive,
    dispose: () => void (alive = false),
  };
};

describe("the one assistant's session", () => {
  it("is seeded with the last reply in full, so 'type what you said' has the words", async () => {
    const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "baton-agent-"));
    const conversation = createConversationLog({ file: NodePath.join(dir, "c.ndjson") });
    const long = `The plan has three parts. ${"Detail. ".repeat(80)}Ship it on Friday.`;
    conversation.add({ route: "answer", said: "what is the plan", reply: long });

    const prompts: string[] = [];
    const asked: string[] = [];
    const agent = createAssistantAgent({
      start: async (prompt) => (prompts.push(prompt), fakeSession(asked)),
      conversation,
      clockLine: () => "Sunday 10:00",
      beginTurn: () => undefined,
    });
    await agent.say("type exactly what you just said into the T3 chat input", {
      window: "T3 Code: chat",
      session: null,
    });
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("Ship it on Friday.");
    expect(prompts[0]).toContain("type_text");
    expect(asked[0]).toContain("the window he is using (data): T3 Code: chat");
    expect(asked[0]).toContain("he says: type exactly what you just said");
    // The turn goes back into the file, so the next session starts where this one left off.
    expect(conversation.recent(1)[0]).toMatchObject({
      said: "type exactly what you just said into the T3 chat input",
      reply: "I typed it.",
    });
    // A wake word changes the face, not the session: same conversation, a name and a line for the turn.
    await agent.say("what time is it", {
      window: null,
      session: null,
      persona: { name: "Freya", role: "his day; warm.", introduce: true },
    });
    expect(prompts).toHaveLength(1);
    expect(asked[1]).toContain(
      "you answer this turn as Freya: his day; warm. start your reply by saying you are Freya.",
    );
    NodeFS.rmSync(dir, { recursive: true, force: true });
  });

  it("puts memory in the first prompt and the sentence, and hands the turn to the learning loop", async () => {
    const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "baton-agent-"));
    const conversation = createConversationLog({ file: NodePath.join(dir, "c.ndjson") });
    const prompts: string[] = [];
    const asked: string[] = [];
    const learned: string[] = [];
    const agent = createAssistantAgent({
      start: async (prompt) => (prompts.push(prompt), fakeSession(asked)),
      conversation,
      clockLine: () => "Sunday 10:00",
      beginTurn: () => undefined,
      notes: async () => "what you remember about him:\n- he likes tea",
      recall: async (text, project) => `remembered for: ${text} in ${project}`,
      learn: (said, reply, project) => void learned.push(`${said} => ${reply} (${project})`),
    });
    await agent.say("make the tea", { window: null, session: "s1", project: "kitchen" });
    expect(prompts[0]).toContain("he likes tea");
    expect(asked[0]).toContain("remembered for: make the tea in kitchen");
    expect(learned).toEqual(["make the tea => I typed it. (kitchen)"]);
    NodeFS.rmSync(dir, { recursive: true, force: true });
  });

  it("starts a new session, seeded again, when the old one dies or has run long", async () => {
    expect(shouldRecycle({ alive: true, turns: 3, idleMs: 1000 })).toBe(false);
    expect(shouldRecycle({ alive: false, turns: 0, idleMs: 0 })).toBe(true);
    expect(shouldRecycle({ alive: true, turns: 40, idleMs: 0 })).toBe(true);
    expect(shouldRecycle({ alive: true, turns: 1, idleMs: 7 * 3_600_000 })).toBe(true);
    expect(shouldRecycle({ alive: true, turns: 1, idleMs: 0, images: 11 })).toBe(false);
    expect(shouldRecycle({ alive: true, turns: 1, idleMs: 0, images: 12 })).toBe(true);

    const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "baton-agent-"));
    const conversation = createConversationLog({ file: NodePath.join(dir, "c.ndjson") });
    const sessions: VisionSession[] = [];
    const started: string[] = [];
    const agent = createAssistantAgent({
      start: async (prompt, brain) => {
        const s = fakeSession([]);
        sessions.push(s);
        started.push(`${brain?.model}/${brain?.effort}: ${prompt.includes("zebra")}`);
        return s;
      },
      conversation,
      clockLine: () => "now",
      beginTurn: () => undefined,
    });
    const opus = { model: "opus", effort: "medium" };
    await agent.say("hello", { window: null, session: null, brain: opus });
    sessions[0]!.dispose();
    await agent.say("zebra", { window: null, session: null, brain: opus });
    expect(sessions).toHaveLength(2);
    // A persona on another model gets a session on its own model, seeded with the same conversation.
    const sonnet = { model: "sonnet", effort: "medium" };
    await agent.say("Freya, what is on today", { window: null, session: null, brain: sonnet });
    await agent.say("and tomorrow", { window: null, session: null, brain: sonnet });
    expect(started).toEqual(["opus/medium: false", "opus/medium: false", "sonnet/medium: true"]);
    NodeFS.rmSync(dir, { recursive: true, force: true });
  });

  it("hears about turns answered without it, once, and keeps a sentence it was stopped on", async () => {
    const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "baton-agent-"));
    const conversation = createConversationLog({ file: NodePath.join(dir, "c.ndjson") });
    const asked: string[] = [];
    let stop = false;
    const session: VisionSession = {
      ask: async (content, onDelta) => {
        asked.push(content.map((c) => (c.type === "text" ? c.text : "")).join("\n"));
        if (!stop) return "Done.";
        onDelta?.("Here is the long");
        throw new SessionClosed("Claude session closed.");
      },
      alive: () => true,
      dispose: () => undefined,
    };
    const agent = createAssistantAgent({
      start: async () => session,
      conversation,
      clockLine: () => "now",
      beginTurn: () => undefined,
    });
    await agent.say("hello", { window: null, session: null });
    conversation.add({ route: "refusal", said: "delete it all", reply: "I won't delete that." });
    await agent.say("why not", { window: null, session: null });
    await agent.say("ok", { window: null, session: null });
    expect(asked[1]).toContain("I won't delete that.");
    expect(asked[1]).not.toContain("he said: hello");
    expect(asked[2]).not.toContain("I won't delete that.");

    stop = true;
    await expect(
      agent.say("tell me the long story", { window: null, session: null }),
    ).rejects.toThrow();
    expect(conversation.recent(1)[0]).toMatchObject({
      said: "tell me the long story",
      reply: "Here is the long",
      note: "he stopped it before the end",
    });
    NodeFS.rmSync(dir, { recursive: true, force: true });
  });

  it("seeds a recycled session with every turn the old one held, not only the last six", async () => {
    const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "baton-agent-"));
    const conversation = createConversationLog({ file: NodePath.join(dir, "c.ndjson") });
    conversation.add({ route: "answer", said: "the wifi box is the white one", reply: "Noted." });
    for (let i = 0; i < 20; i += 1)
      conversation.add({ route: "answer", said: `t${i}`, reply: "ok" });
    const prompts: string[] = [];
    const agent = createAssistantAgent({
      start: async (prompt) => (prompts.push(prompt), fakeSession([])),
      conversation,
      clockLine: () => "now",
      beginTurn: () => undefined,
    });
    await agent.say("which box was it", { window: null, session: null });
    expect(prompts[0]).toContain("the wifi box is the white one");
    NodeFS.rmSync(dir, { recursive: true, force: true });
  });

  it("starts a second sentence only after the first has finished", async () => {
    const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "baton-agent-"));
    const conversation = createConversationLog({ file: NodePath.join(dir, "c.ndjson") });
    const events: string[] = [];
    let release = () => undefined as void;
    const first = new Promise<void>((resolve) => (release = resolve));
    let n = 0;
    const agent = createAssistantAgent({
      start: async () => ({
        ask: async () => {
          n += 1;
          if (n === 1) await first;
          events.push(`answered ${n}`);
          return "ok";
        },
        alive: () => true,
        dispose: () => undefined,
      }),
      conversation,
      clockLine: () => "now",
      beginTurn: () => void events.push("begin"),
    });
    const a = agent.say("read the page", { window: null, session: null });
    const b = agent.say("type it", { window: null, session: null });
    await Promise.resolve();
    release();
    await Promise.all([a, b]);
    expect(events).toEqual(["begin", "answered 1", "begin", "answered 2"]);
    NodeFS.rmSync(dir, { recursive: true, force: true });
  });

  it("never replaces a live session when it warms, even one on another persona's model", async () => {
    const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "baton-agent-"));
    const conversation = createConversationLog({ file: NodePath.join(dir, "c.ndjson") });
    const started: string[] = [];
    let disposed = 0;
    let release = () => undefined as void;
    const asking = new Promise<void>((resolve) => (release = resolve));
    let answering = () => undefined as void;
    const inAsk = new Promise<void>((resolve) => (answering = resolve));
    const agent = createAssistantAgent({
      start: async (_prompt, brain) => {
        started.push(brain?.model ?? "none");
        return {
          ask: async () => (answering(), await asking, "ok"),
          alive: () => true,
          dispose: () => void (disposed += 1),
        };
      },
      conversation,
      clockLine: () => "now",
      beginTurn: () => undefined,
    });
    const sonnet = { model: "sonnet", effort: "medium" };
    const freya = agent.say("Freya, what is on today", {
      window: null,
      session: null,
      brain: sonnet,
    });
    await inAsk;
    // A wake word warms the lead while Freya is still answering.
    agent.warm({ model: "opus", effort: "medium" });
    release();
    expect(await freya).toBe("ok");
    await agent.say("and tomorrow", { window: null, session: null, brain: sonnet });
    expect(started).toEqual(["sonnet"]);
    expect(disposed).toBe(0);
    NodeFS.rmSync(dir, { recursive: true, force: true });
  });

  it("drops the sentences still queued when he says stop", async () => {
    const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "baton-agent-"));
    const conversation = createConversationLog({ file: NodePath.join(dir, "c.ndjson") });
    const asked: string[] = [];
    let release = () => undefined as void;
    const first = new Promise<void>((resolve) => (release = resolve));
    const agent = createAssistantAgent({
      start: async () => ({
        ask: async (content) => {
          asked.push(content.map((c) => (c.type === "text" ? c.text : "")).join(""));
          if (asked.length === 1) await first;
          return "ok";
        },
        alive: () => true,
        dispose: () => undefined,
      }),
      conversation,
      clockLine: () => "now",
      beginTurn: () => undefined,
    });
    const a = agent.say("type hello", { window: null, session: null });
    const b = agent.say("and press enter", { window: null, session: null });
    await vi.waitFor(() => expect(asked).toHaveLength(1));
    agent.dispose();
    release();
    await a;
    await expect(b).rejects.toBeInstanceOf(SessionClosed);
    expect(asked).toHaveLength(1);
    const after = await agent.say("what's the time", { window: null, session: null });
    expect(after).toBe("ok");
    NodeFS.rmSync(dir, { recursive: true, force: true });
  });
});
