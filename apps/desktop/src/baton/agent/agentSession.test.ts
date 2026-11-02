// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { describe, expect, it } from "vite-plus/test";

import { createConversationLog } from "../conversation/conversationLog.ts";
import type { VisionSession } from "../screen/claudeVision.ts";
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
});
