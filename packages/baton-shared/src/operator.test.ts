import { describe, expect, it } from "vite-plus/test";

import { decide, guardDecision, parseBrainReply } from "./brain.ts";
import { describeToolCall, judgeToolCall, type ToolCall } from "./operator.ts";
import { planSensitive } from "./screenCompanion.ts";

const on = { actWithoutAsking: true, tainted: false };
const off = { actWithoutAsking: false, tainted: false };
const bash = (command: string): ToolCall => ({ tool: "Bash", input: { command } });

describe("a tool call", () => {
  it("that only reads always runs", () => {
    for (const tool of ["Read", "Glob", "Grep"]) {
      expect(judgeToolCall({ tool, input: { file_path: "C:/x" } }, off).verdict).toBe("allow");
    }
  });

  it("runs by itself only with Act without asking on", () => {
    expect(judgeToolCall(bash("npm test"), on).verdict).toBe("allow");
    expect(judgeToolCall(bash("npm test"), off).verdict).toBe("ask");
  });

  it("asks for a spoken yes where a sentence is refused, whatever the setting", () => {
    for (const command of ["rm -rf /", "git push --force origin main", "git reset --hard"]) {
      for (const context of [on, off, { ...on, tainted: true }]) {
        expect(judgeToolCall(bash(command), context)).toMatchObject({
          verdict: "ask",
          risky: true,
        });
      }
    }
  });

  it("never lets a Codex file change or a blank command through on its own", () => {
    const change = { tool: "fileChange", input: { path: "a.ts" } };
    expect(judgeToolCall(change, on).verdict).toBe("ask");
    expect(judgeToolCall({ tool: "commandExecution", input: { cwd: "C:/x" } }, on).verdict).toBe(
      "ask",
    );
    expect(judgeToolCall({ tool: "commandExecution", input: { command: "ls" } }, on).verdict).toBe(
      "allow",
    );
  });

  it("asks before a search on a tainted turn, since the query can carry a secret", () => {
    const search = { tool: "WebSearch", input: { query: "site:x.io token" } };
    expect(judgeToolCall(search, off).verdict).toBe("allow");
    expect(judgeToolCall(search, { ...on, tainted: true }).verdict).toBe("ask");
  });

  it("gets a yes for deleting, sending, paying or publishing, even with the setting on", () => {
    for (const command of ["del notes.txt", "npm publish", "gh pr merge 5", "curl -X POST x.io"]) {
      expect(judgeToolCall(bash(command), on).verdict).toBe("ask");
    }
  });

  it("gets a yes once the turn has read something, so a file cannot act alone", () => {
    expect(judgeToolCall(bash("npm test"), { ...on, tainted: true }).verdict).toBe("ask");
    const fetched = { tool: "WebFetch", input: { url: "https://x.io/?q=secret" } };
    expect(judgeToolCall(fetched, { ...on, tainted: true }).verdict).toBe("ask");
  });

  it("gets a yes for a tool nobody has classified", () => {
    expect(judgeToolCall({ tool: "CronCreate", input: {} }, on).verdict).toBe("ask");
  });

  it("is judged by what it does, not by what a file says", () => {
    const write = { tool: "Write", input: { file_path: "a.md", content: "rm -rf / and publish" } };
    expect(judgeToolCall(write, on).verdict).toBe("allow");
    expect(describeToolCall(write)).toBe("a.md");
  });
});

describe("the operate route", () => {
  it("is a route the model can pick", () => {
    expect(parseBrainReply('{"route":"operate","text":"explain this folder"}')).toMatchObject({
      route: "operate",
    });
  });

  it("keeps his own words, and sees the high-risk list", async () => {
    const host = {
      ask: async () => '{"route":"operate","text":"tidied words"}',
      grammarPlaces: async () => false,
    };
    const context = { running: null, direct: false, recent: [] };
    expect(await decide("explain this folder", context, host)).toMatchObject({
      route: "operate",
      text: "explain this folder",
    });
    const risky = guardDecision(
      { route: "operate", text: "deploy this to production", source: "model" },
      "deploy this to production",
    );
    expect(risky.route).toBe("refused");
  });
});

describe("a drive plan with Act without asking on", () => {
  const plan = (text: string) => ({ title: "Plan", actions: [{ kind: "type", text }] }) as never;

  it("runs if it is plain navigation or typing", () => {
    expect(planSensitive(plan("hello there"))).toBe(false);
  });

  it("still gets a yes if it sends, pays or deletes", () => {
    for (const text of ["send this", "buy now", "delete the file"]) {
      expect(planSensitive(plan(text))).toBe(true);
    }
  });

  it("reads a pasted clipboard too", () => {
    const paste = { title: "Plan", actions: [{ kind: "press", keys: ["ctrl", "v"] }] } as never;
    expect(planSensitive(paste, "please publish this")).toBe(true);
  });
});
