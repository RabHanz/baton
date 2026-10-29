// node --test scripts/baton/live/baton-live-acp.test.mjs
import * as NodeAssert from "node:assert/strict";
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeReadline from "node:readline";
import * as NodeTest from "node:test";
import * as NodeURL from "node:url";

import {
  isAdoptRequest,
  notSentNote,
  isAppContinuation,
  promptText,
  splitAttachments,
  safeInboxName,
} from "./baton-live-acp.mjs";

const AGENT = NodePath.join(
  NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)),
  "baton-live-acp.mjs",
);

NodeTest.test("only the user's words reach Claude, never T3's instruction wrappers", () => {
  const first =
    "<t3_code_instructions>\nbe nice\n</t3_code_instructions>\n\n<user_request>\nsay ALPHA\n</user_request>";
  NodeAssert.equal(
    promptText([
      { type: "text", text: first },
      { type: "text", text: "<runtime_info>T3</runtime_info>" },
    ]),
    "say ALPHA",
  );
  NodeAssert.equal(
    promptText([
      { type: "text", text: "plain" },
      { type: "image", data: "x" },
    ]),
    "plain",
  );
});

NodeTest.test("a context handoff T3 prepends never reaches the live session", () => {
  const text =
    "Context handoff (manual_context):\nProvider context handoff. Thread: baton-live:x.\n\nUser message:\nsay ALPHA";
  NodeAssert.equal(promptText([{ type: "text", text }]), "say ALPHA");
  const wrapped = `<t3_code_instructions>\nx\n</t3_code_instructions>\n\n<user_request>\n${text}\n</user_request>`;
  NodeAssert.equal(promptText([{ type: "text", text: wrapped }]), "say ALPHA");
  NodeAssert.equal(isAppContinuation(" Continue where you left off. "), true);
  NodeAssert.equal(isAppContinuation("continue the refactor"), false);
});

NodeTest.test("a plain-terminal session is only moved into Herdr when asked", () => {
  NodeAssert.equal(isAdoptRequest("bring into Herdr"), true);
  NodeAssert.equal(isAdoptRequest(" Bring it into herdr. "), true);
  NodeAssert.equal(isAdoptRequest("please fix the build"), false);
  const note = notSentNote({ remoteControl: true, status: "idle" });
  NodeAssert.match(note, /^Not sent\./);
  NodeAssert.match(note, /Remote Control/);
  NodeAssert.match(note, /bring into Herdr/);
});

NodeTest.test("attachment notes become paths", () => {
  const out = splitAttachments(
    'look\n\n[Attached image "a b.png" is saved at: /t3/attachments/x.png]\n\n[Attached file "n.pdf" is saved at: /t3/n.pdf (text extracted to: /t3/n.txt)]',
  );
  NodeAssert.deepEqual(out, { text: "look", paths: ["/t3/attachments/x.png", "/t3/n.pdf"] });
  NodeAssert.equal(safeInboxName("../../etc/pa ss", "S"), "S-pa-ss");
});

NodeTest.test(
  "a prompt is typed into a busy session's pane and the turn ends once it is delivered",
  async () => {
    const dir = NodeFS.mkdtempSync(
      NodePath.join(process.env.TMPDIR ?? NodeOS.tmpdir(), "baton-live-acp-"),
    );
    const sessions = NodePath.join(dir, "sessions");
    const cwd = NodePath.join(dir, "work");
    NodeFS.mkdirSync(sessions);
    NodeFS.mkdirSync(cwd);
    const log = NodePath.join(dir, "herdr.log");
    const herdr = NodePath.join(dir, "herdr");
    NodeFS.writeFileSync(herdr, `#!/bin/sh\nprintf '%s\\n' "$*" >> ${log}\n`, { mode: 0o755 });
    const sid = "11111111-2222-4333-8444-555555555555";
    const descriptor = (status) =>
      NodeFS.writeFileSync(
        NodePath.join(sessions, `${process.pid}.json`),
        JSON.stringify({ pid: process.pid, sessionId: sid, cwd, kind: "interactive", status }),
      );
    descriptor("idle");
    const attachment = NodePath.join(dir, "shot.png");
    NodeFS.writeFileSync(attachment, "png-bytes");

    const child = NodeChildProcess.spawn(process.execPath, [AGENT], {
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
    NodeReadline.createInterface({ input: child.stdout }).on("line", (line) => {
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
      NodeAssert.equal(init.result.protocolVersion, 1);
      NodeAssert.deepEqual(init.result.agentCapabilities.sessionCapabilities, { resume: {} });
      NodeAssert.match(
        (await call(2, "session/new", { cwd, mcpServers: [] })).result.sessionId,
        /^baton-unbound/,
      );
      NodeAssert.deepEqual(
        (await call(3, "session/resume", { sessionId: sid, cwd, mcpServers: [] })).result,
        {},
      );

      // Busy the whole time: the send must not wait for idle, or T3 queues the next message.
      descriptor("busy");
      const turn = await call(4, "session/prompt", {
        sessionId: sid,
        prompt: [
          {
            type: "text",
            text: `say ALPHA\n\n[Attached image "shot.png" is saved at: ${attachment}]`,
          },
        ],
      });
      NodeAssert.equal(turn.result.stopReason, "end_turn");
      // Stop still reaches the pane after the send has ended.
      NodeAssert.equal((await call(6, "session/cancel", { sessionId: sid })).result ?? null, null);

      const calls = NodeFS.readFileSync(log, "utf8");
      NodeAssert.match(
        calls,
        /^--session fab-x agent prompt p1 say ALPHA\n@.*\/work\/\.baton\/inbox\/.*shot\.png\n--session fab-x agent send-keys p1 esc\n$/s,
      );
      const inbox = NodeFS.readdirSync(NodePath.join(cwd, ".baton", "inbox"));
      NodeAssert.equal(
        NodeFS.readFileSync(NodePath.join(cwd, ".baton", "inbox", inbox[0]), "utf8"),
        "png-bytes",
      );

      const unbound = await call(5, "session/prompt", { sessionId: "baton-unbound-1", prompt: [] });
      NodeAssert.equal(unbound.result.stopReason, "end_turn");
    } finally {
      child.kill();
      NodeFS.rmSync(dir, { recursive: true, force: true });
    }
  },
);
