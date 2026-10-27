// node --test scripts/baton/live/baton-live-acp.test.mjs
import * as assert from "node:assert/strict";
import * as ChildProcess from "node:child_process";
import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";
import * as Readline from "node:readline";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { promptText, splitAttachments, safeInboxName } from "./baton-live-acp.mjs";

const AGENT = Path.join(Path.dirname(fileURLToPath(import.meta.url)), "baton-live-acp.mjs");

test("only the user's words reach Claude, never T3's instruction wrappers", () => {
  const first =
    "<t3_code_instructions>\nbe nice\n</t3_code_instructions>\n\n<user_request>\nsay ALPHA\n</user_request>";
  assert.equal(
    promptText([
      { type: "text", text: first },
      { type: "text", text: "<runtime_info>T3</runtime_info>" },
    ]),
    "say ALPHA",
  );
  assert.equal(
    promptText([
      { type: "text", text: "plain" },
      { type: "image", data: "x" },
    ]),
    "plain",
  );
});

test("attachment notes become paths", () => {
  const out = splitAttachments(
    'look\n\n[Attached image "a b.png" is saved at: /t3/attachments/x.png]\n\n[Attached file "n.pdf" is saved at: /t3/n.pdf (text extracted to: /t3/n.txt)]',
  );
  assert.deepEqual(out, { text: "look", paths: ["/t3/attachments/x.png", "/t3/n.pdf"] });
  assert.equal(safeInboxName("../../etc/pa ss", "S"), "S-pa-ss");
});

test("a prompt is typed into the session's pane and the turn ends when Claude is idle again", async () => {
  const dir = FS.mkdtempSync(Path.join(process.env.TMPDIR ?? OS.tmpdir(), "baton-live-acp-"));
  const sessions = Path.join(dir, "sessions");
  const cwd = Path.join(dir, "work");
  FS.mkdirSync(sessions);
  FS.mkdirSync(cwd);
  const log = Path.join(dir, "herdr.log");
  const herdr = Path.join(dir, "herdr");
  FS.writeFileSync(herdr, `#!/bin/sh\nprintf '%s\\n' "$*" >> ${log}\n`, { mode: 0o755 });
  const sid = "11111111-2222-4333-8444-555555555555";
  const descriptor = (status) =>
    FS.writeFileSync(
      Path.join(sessions, `${process.pid}.json`),
      JSON.stringify({ pid: process.pid, sessionId: sid, cwd, kind: "interactive", status }),
    );
  descriptor("idle");
  const attachment = Path.join(dir, "shot.png");
  FS.writeFileSync(attachment, "png-bytes");

  const child = ChildProcess.spawn(process.execPath, [AGENT], {
    env: {
      ...process.env,
      BATON_CLAUDE_SESSIONS_DIR: sessions,
      BATON_HERDR_BIN: herdr,
      BATON_TEST_HERDR_PANE: "fab-x~p1",
      BATON_LIVE_POLL_MS: "50",
    },
    stdio: ["pipe", "pipe", "inherit"],
  });
  const replies = new Map();
  Readline.createInterface({ input: child.stdout }).on("line", (line) => {
    const message = JSON.parse(line);
    if (message.id !== undefined) replies.get(message.id)?.(message);
  });
  const call = (id, method, params) =>
    new Promise((resolve) => {
      replies.set(id, resolve);
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });

  try {
    const init = await call(1, "initialize", { protocolVersion: 2 });
    assert.equal(init.result.protocolVersion, 1);
    assert.deepEqual(init.result.agentCapabilities.sessionCapabilities, { resume: {} });
    assert.match(
      (await call(2, "session/new", { cwd, mcpServers: [] })).result.sessionId,
      /^baton-unbound/,
    );
    assert.deepEqual(
      (await call(3, "session/resume", { sessionId: sid, cwd, mcpServers: [] })).result,
      {},
    );

    const turn = call(4, "session/prompt", {
      sessionId: sid,
      prompt: [
        {
          type: "text",
          text: `say ALPHA\n\n[Attached image "shot.png" is saved at: ${attachment}]`,
        },
      ],
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    descriptor("busy");
    let ended = false;
    void turn.then(() => (ended = true));
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(ended, false, "the turn stays open while Claude Code is busy");
    descriptor("idle");
    assert.equal((await turn).result.stopReason, "end_turn");

    const calls = FS.readFileSync(log, "utf8");
    assert.match(
      calls,
      /^--session fab-x agent prompt p1 say ALPHA\n@.*\/work\/\.baton\/inbox\/.*shot\.png\n$/s,
    );
    const inbox = FS.readdirSync(Path.join(cwd, ".baton", "inbox"));
    assert.equal(FS.readFileSync(Path.join(cwd, ".baton", "inbox", inbox[0]), "utf8"), "png-bytes");

    const unbound = await call(5, "session/prompt", { sessionId: "baton-unbound-1", prompt: [] });
    assert.equal(unbound.result.stopReason, "end_turn");
  } finally {
    child.kill();
    FS.rmSync(dir, { recursive: true, force: true });
  }
});
