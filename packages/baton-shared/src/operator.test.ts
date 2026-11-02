import { describe, expect, it } from "vite-plus/test";

import { decide, guardDecision, parseBrainReply } from "./brain.ts";
import { describeToolCall, judgeToolCall, keyIsNavigation, type ToolCall } from "./operator.ts";
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

describe("Baton's own tools (D143)", () => {
  const typed = (text: string, why = "type his reply into the chat box"): ToolCall => ({
    tool: "mcp__baton__type_text",
    input: { text, why },
  });
  it("types plain text into a named box with no Run it, whatever the setting", () => {
    expect(judgeToolCall(typed("Here is the answer I gave you."), off).verdict).toBe("allow");
    expect(judgeToolCall(typed("Here is the answer I gave you."), on).verdict).toBe("allow");
  });
  it("asks for a yes, default no, when the text is high risk or the window is a command line", () => {
    expect(judgeToolCall(typed("git push --force origin main"), on)).toMatchObject({
      verdict: "ask",
      risky: true,
    });
    expect(judgeToolCall(typed("hello"), { ...on, focusedShell: true }).verdict).toBe("ask");
  });
  it("asks when the text follows something it read, unless the text is his own", () => {
    const read = { ...on, tainted: true };
    expect(judgeToolCall(typed("buy this now"), read).verdict).toBe("ask");
    expect(judgeToolCall(typed("what I just told you"), { ...read, textIsHis: true }).verdict).toBe(
      "allow",
    );
  });
  it("lets a job start and be agreed to with his words, asks after a read, and always asks for a standing permission", () => {
    const start = {
      tool: "mcp__baton__job_start",
      input: { title: "Site", goal: "rebuild the site", project: "Site" },
    };
    const split = {
      tool: "mcp__baton__job_split",
      input: { id: "j1", parts: [{ title: "A", goal: "do a" }] },
    };
    expect(judgeToolCall(split, off).verdict).toBe("allow");
    expect(judgeToolCall(split, { ...off, tainted: true }).verdict).toBe("ask");
    const agree = { tool: "mcp__baton__job_agree", input: { id: "j1" } };
    expect(judgeToolCall(start, off).verdict).toBe("allow");
    expect(judgeToolCall(agree, off).verdict).toBe("allow");
    const read = { ...off, tainted: true };
    expect(judgeToolCall(start, read).verdict).toBe("ask");
    expect(judgeToolCall(start, { ...read, textIsHis: true }).verdict).toBe("allow");
    expect(judgeToolCall(agree, { ...read, textIsHis: true }).verdict).toBe("ask");
    expect(judgeToolCall({ tool: "mcp__baton__job_stop", input: { id: "j1" } }, off).verdict).toBe(
      "allow",
    );
    expect(
      judgeToolCall(
        { tool: "mcp__baton__job_schedule", input: { id: "j1", every_minutes: 60 } },
        off,
      ).verdict,
    ).toBe("ask");
    const note = { tool: "mcp__baton__memory_remember", input: { text: "likes tea" } };
    expect(judgeToolCall(note, off).verdict).toBe("allow");
    expect(judgeToolCall(note, read).verdict).toBe("ask");
    const commit = { tool: "mcp__baton__commit_add", input: { text: "check the deploy" } };
    expect(judgeToolCall(commit, off).verdict).toBe("allow");
    expect(judgeToolCall(commit, read).verdict).toBe("ask");
    const weave = {
      tool: "mcp__baton__weave_send",
      input: { session: "build", text: "rerun the tests", job: "j1" },
    };
    expect(judgeToolCall(weave, off).verdict).toBe("ask");
    expect(judgeToolCall(weave, { ...off, weaveStanding: true }).verdict).toBe("allow");
    expect(judgeToolCall(weave, { ...off, weaveStanding: true, tainted: true }).verdict).toBe(
      "ask",
    );
    expect(
      judgeToolCall(
        { ...weave, input: { ...weave.input, text: "my password is hunter22x" } },
        { ...off, weaveStanding: true },
      ).verdict,
    ).toBe("deny");
    expect(judgeToolCall({ tool: "mcp__baton__weave_list", input: {} }, off).verdict).toBe("allow");
    expect(judgeToolCall({ tool: "mcp__baton__commit_list", input: {} }, read).verdict).toBe(
      "allow",
    );
    expect(
      judgeToolCall({ tool: "mcp__baton__memory_forget", input: { id: "a" } }, off).verdict,
    ).toBe("ask");
    expect(judgeToolCall({ tool: "mcp__baton__vault_use", input: { name: "x" } }, off).verdict).toBe("allow");
    expect(judgeToolCall({ tool: "mcp__baton__vault_use", input: { name: "x" } }, read).verdict).toBe("allow"); // the vault asks, naming the secret, when the turn read something
    expect(judgeToolCall({ tool: "mcp__baton__vault_save_pending", input: { name: "x" } }, off).verdict).toBe("ask");
    const grant = judgeToolCall(
      { tool: "mcp__baton__job_grant", input: { id: "j1", channel: "email" } },
      off,
    );
    expect(grant).toMatchObject({ verdict: "ask", risky: true });
  });
  it("lets it look and click, but not send, drag or press Enter on its own", () => {
    for (const tool of [
      "screen_capture",
      "ui_tree",
      "sessions_list",
      "fleet_status",
      "memory_search",
      "memory_used",
      "vault_list",
      "memory_pin",
      "dictation_start",
      "jobs_list",
      "job_revoke",
    ]) {
      expect(judgeToolCall({ tool: `mcp__baton__${tool}`, input: {} }, off).verdict).toBe("allow");
    }
    expect(
      judgeToolCall({ tool: "mcp__baton__click", input: { x: 1, y: 2, why: "the text box" } }, off)
        .verdict,
    ).toBe("allow");
    expect(
      judgeToolCall(
        { tool: "mcp__baton__click", input: { x: 1, y: 2, why: "the Send button" } },
        off,
      ).verdict,
    ).toBe("ask");
    expect(
      judgeToolCall(
        { tool: "mcp__baton__click_element", input: { label: "Save", why: "save the note" } },
        off,
      ).verdict,
    ).toBe("allow");
    expect(
      judgeToolCall(
        { tool: "mcp__baton__click_element", input: { label: "Send", why: "send it" } },
        off,
      ).verdict,
    ).toBe("ask");
    expect(
      judgeToolCall({ tool: "mcp__baton__wait_for", input: { label: "Save", seconds: 3 } }, off)
        .verdict,
    ).toBe("allow");
    expect(
      judgeToolCall({ tool: "mcp__baton__press_keys", input: { keys: ["enter"] } }, on).verdict,
    ).toBe("ask");
    expect(judgeToolCall({ tool: "mcp__baton__drag", input: {} }, on).verdict).toBe("ask");
  });
  it("keeps the harness's own tools exactly as they were", () => {
    expect(judgeToolCall(bash("npm test"), off).verdict).toBe("ask");
    expect(judgeToolCall({ tool: "mcp__baton__unknown_tool", input: {} }, on).verdict).toBe("ask");
  });
});

describe("keys after a read", () => {
  it("are free only when they are navigation or editing, with no Windows key and no Alt", () => {
    for (const keys of [
      ["up"],
      ["tab"],
      ["shift", "tab"],
      ["home"],
      ["pagedown"],
      ["backspace"],
      ["delete"],
      ["escape"],
      ["ctrl", "a"],
      ["ctrl", "c"],
      ["ctrl", "v"],
      ["ctrl", "z"],
      ["ctrl", "f"],
      ["ctrl", "shift", "left"],
      ["shift", "end"],
    ]) {
      expect(keyIsNavigation(keys)).toBe(true);
    }
  });
  it("ask when they open, close, navigate, send or are not sure", () => {
    for (const keys of [
      ["win", "r"],
      ["alt", "f4"],
      ["alt", "tab"],
      ["alt", "space"],
      ["ctrl", "alt", "delete"],
      ["ctrl", "shift", "escape"],
      ["ctrl", "w"],
      ["ctrl", "t"],
      ["ctrl", "n"],
      ["ctrl", "q"],
      ["ctrl", "r"],
      ["ctrl", "l"],
      ["enter"],
      ["f5"],
      ["ctrl", "s"],
      ["ctrl", "shift", "delete"],
      ["a"],
      ["ctrl", "k", "j"],
    ]) {
      expect(keyIsNavigation(keys)).toBe(false);
    }
  });
  it("is judged by that after a read, and left alone before one", () => {
    const press = (keys: string[]): ToolCall => ({
      tool: "mcp__baton__press_keys",
      input: { keys, why: "a key" },
    });
    expect(judgeToolCall(press(["ctrl", "a"]), { ...on, tainted: true }).verdict).toBe("allow");
    expect(judgeToolCall(press(["win", "r"]), { ...on, tainted: true }).verdict).toBe("ask");
    expect(judgeToolCall(press(["alt", "f4"]), { ...on, tainted: true }).verdict).toBe("ask");
    expect(judgeToolCall(press(["win", "r"]), on).verdict).toBe("allow");
  });
});
