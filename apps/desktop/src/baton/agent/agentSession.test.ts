// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { describe, expect, it } from "vite-plus/test";

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
      recall: async (text) => `remembered for: ${text}`,
      learn: (said, reply) => void learned.push(`${said} => ${reply}`),
    });
    await agent.say("make the tea", { window: null, session: null });
    expect(prompts[0]).toContain("he likes tea");
    expect(asked[0]).toContain("remembered for: make the tea");
    expect(learned).toEqual(["make the tea => I typed it."]);
    NodeFS.rmSync(dir, { recursive: true, force: true });
  });

  it("starts a new session, seeded again, when the old one dies or has run long", async () => {
    expect(shouldRecycle({ alive: true, turns: 3, idleMs: 1000 })).toBe(false);
    expect(shouldRecycle({ alive: false, turns: 0, idleMs: 0 })).toBe(true);
    expect(shouldRecycle({ alive: true, turns: 40, idleMs: 0 })).toBe(true);
    expect(shouldRecycle({ alive: true, turns: 1, idleMs: 7 * 3_600_000 })).toBe(true);

    const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "baton-agent-"));
    const conversation = createConversationLog({ file: NodePath.join(dir, "c.ndjson") });
    const sessions: VisionSession[] = [];
    const agent = createAssistantAgent({
      start: async () => {
        const s = fakeSession([]);
        sessions.push(s);
        return s;
      },
      conversation,
      clockLine: () => "now",
      beginTurn: () => undefined,
    });
    await agent.say("hello", { window: null, session: null });
    sessions[0]!.dispose();
    await agent.say("again", { window: null, session: null });
    expect(sessions).toHaveLength(2);
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
});
