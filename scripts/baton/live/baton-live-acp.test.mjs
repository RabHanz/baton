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
  readableInboxName,
  parsePanePrompt,
  parseReviewScreen,
  answerKeys,
  answerFrom,
  enqueue,
  readQueue,
  drainSession,
  deliveredNote,
  lostNote,
  queuedNote,
} from "./baton-live-acp.mjs";

const AGENT = NodePath.join(
  NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)),
  "baton-live-acp.mjs",
);

const fixture = (name) =>
  NodeFS.readFileSync(
    NodePath.join(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)), "__fixtures__", name),
    "utf8",
  );

NodeTest.test("a permission dialog on the screen is read with its options (D88)", () => {
  const prompt = parsePanePrompt(fixture("pane-permission.txt"));
  NodeAssert.equal(prompt.question, "Do you want to proceed?");
  NodeAssert.match(prompt.context, /echo PERM-TEST/);
  NodeAssert.deepEqual(
    prompt.options.map((o) => o.label),
    ["Yes", "No"],
  );
  NodeAssert.deepEqual(answerKeys(prompt, "No"), { keys: ["down", "enter"], text: null });
  NodeAssert.deepEqual(answerKeys(prompt, "1"), { keys: ["enter"], text: null });
  NodeAssert.equal(answerKeys(prompt, "maybe"), null, "no free text where none is offered");
});

NodeTest.test("an AskUserQuestion is read with its header, descriptions and free-text slot", () => {
  const prompt = parsePanePrompt(fixture("pane-question.txt"));
  NodeAssert.equal(prompt.header, "Colour");
  NodeAssert.equal(prompt.question, "Which colour do you prefer?");
  NodeAssert.deepEqual(
    prompt.options.map((o) => [o.label, o.description]),
    [
      ["Red", "The colour red"],
      ["Green", "The colour green"],
      ["Blue", "The colour blue"],
    ],
  );
  NodeAssert.equal(prompt.customIndex, 3);
  NodeAssert.deepEqual(answerKeys(prompt, "green"), { keys: ["down", "enter"], text: null });
  NodeAssert.deepEqual(answerKeys(prompt, "Purple"), {
    keys: ["down", "down", "down"],
    text: "Purple",
  });
  NodeAssert.equal(answerFrom("Colour. Which colour do you prefer?\nBlue", prompt), "Blue");
  NodeAssert.equal(answerFrom("Blue", prompt), "Blue");
});

NodeTest.test("unnumbered options are read too, and a plain screen has no prompt", () => {
  const trust = parsePanePrompt(fixture("pane-trust.txt"));
  NodeAssert.deepEqual(
    trust.options.map((o) => o.label),
    ["No, exit", "Yes, I trust this folder"],
  );
  NodeAssert.deepEqual(answerKeys(trust, "Yes, I trust this folder"), {
    keys: ["down", "enter"],
    text: null,
  });
  NodeAssert.equal(parsePanePrompt("❯ hello\n───────\n  ⏵⏵ bypass permissions on"), null);
});

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
        BATON_LIVE_ATTACHMENT_ENTER_MS: "10",
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
        /^--session fab-x agent prompt p1 say ALPHA\nHe attached image shot\.png:\n@.*\/work\/\.baton\/inbox\/\d{4}-\d\d-\d\d\/shot-[0-9a-f]{4}\.png\n--session fab-x agent send-keys p1 enter\n--session fab-x agent send-keys p1 esc\n$/s,
      );
      const day = NodeFS.readdirSync(NodePath.join(cwd, ".baton", "inbox"))[0];
      const inbox = NodeFS.readdirSync(NodePath.join(cwd, ".baton", "inbox", day));
      NodeAssert.equal(
        NodeFS.readFileSync(NodePath.join(cwd, ".baton", "inbox", day, inbox[0]), "utf8"),
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

const queueDir = () => NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "baton-queue-"));
const msg = (text) => ({ text, shown: text, at: "2026-11-01T20:34:35.000Z" });
const harness = (state) => {
  const said = [];
  const typed = [];
  return {
    said,
    typed,
    deps: {
      findLive: () => state.live,
      typeInto: async (_pane, text) => {
        if (state.failure !== null) return state.failure;
        typed.push(text);
        return null;
      },
      say: (_id, text) => said.push(text),
    },
  };
};

NodeTest.test("a message sent while the session waits on a question is kept, then sent in order once it clears", async () => {
  const dir = queueDir();
  const state = { live: { pane: "p", status: "waiting" }, failure: null };
  const { deps, said, typed } = harness(state);
  NodeAssert.equal(enqueue(dir, "s1", msg("first thing")), 1);
  NodeAssert.equal(enqueue(dir, "s1", msg("second thing")), 2);
  NodeAssert.match(queuedNote("the session is waiting on a question.", 2), /Not delivered yet: .*question\. 2 messages queued; they send when you answer it\./);
  await drainSession(dir, "s1", deps);
  NodeAssert.deepEqual(typed, [], "nothing is typed over a question");
  NodeAssert.equal(readQueue(dir, "s1").length, 2);
  state.live = { pane: "p", status: "idle" };
  await drainSession(dir, "s1", deps);
  NodeAssert.deepEqual(typed, ["first thing", "second thing"]);
  NodeAssert.deepEqual(said, [deliveredNote("first thing"), deliveredNote("second thing")]);
  NodeAssert.equal(readQueue(dir, "s1").length, 0);
});

NodeTest.test("the queue is on disk, so a restart finds what was waiting", () => {
  const dir = queueDir();
  enqueue(dir, "s2", msg("keep me"));
  NodeAssert.deepEqual(
    readQueue(dir, "s2").map((item) => item.text),
    ["keep me"],
  );
  NodeAssert.deepEqual(NodeFS.readdirSync(dir), ["s2.json"]);
});

NodeTest.test("a message Herdr keeps refusing is handed back quoted, and the ones behind it still go", async () => {
  const dir = queueDir();
  const state = { live: { pane: "p", status: "idle" }, failure: "Herdr did not take the message: no pane" };
  const { deps, said, typed } = harness(state);
  enqueue(dir, "s3", msg("my important words"));
  enqueue(dir, "s3", msg("and these"));
  for (let i = 0; i < 6; i += 1) await drainSession(dir, "s3", deps);
  NodeAssert.ok(said.some((line) => line.includes('Your message was: "my important words"')), said.join("|"));
  state.failure = null;
  await drainSession(dir, "s3", deps);
  NodeAssert.deepEqual(typed, ["and these"]);
  NodeAssert.equal(readQueue(dir, "s3").length, 0);
});

NodeTest.test("when the session is gone for good every queued message is quoted back", async () => {
  const dir = queueDir();
  const { deps, said } = harness({ live: null, failure: null });
  enqueue(dir, "s4", msg("one"));
  enqueue(dir, "s4", msg("two"));
  for (let i = 0; i < 10; i += 1) await drainSession(dir, "s4", deps);
  NodeAssert.deepEqual(said, [
    lostNote("the session is no longer running here.", "one"),
    lostNote("the session is no longer running here.", "two"),
  ]);
  NodeAssert.equal(readQueue(dir, "s4").length, 0);
});

NodeTest.test("the review screen of a multi-question form is read, with its answers, Submit, Cancel and a way back", () => {
  const prompt = parsePanePrompt(fixture("pane-review.txt"));
  NodeAssert.equal(prompt.question, "Ready to submit your answers?");
  NodeAssert.equal(prompt.header, "Review your answers");
  NodeAssert.deepEqual(
    prompt.tabs?.map((t) => [t.label, t.answered]),
    [
      ["Browser", true],
      ["Connectors", true],
      ["Submit", true],
    ],
  );
  NodeAssert.match(prompt.context, /Which browser profile should that happen in\? → My main profile/);
  NodeAssert.match(prompt.context, /should those connectors be removed\? → Remove after \(Recommended\)/);
  NodeAssert.deepEqual(
    prompt.options.map((o) => o.label),
    ["Submit answers", "Cancel", "Go back"],
  );
  NodeAssert.equal(prompt.selected, 0);
  NodeAssert.deepEqual(answerKeys(prompt, "Submit answers"), { keys: ["enter"], text: null });
  NodeAssert.deepEqual(answerKeys(prompt, "cancel"), { keys: ["down", "enter"], text: null });
  NodeAssert.deepEqual(answerKeys(prompt, "Go back"), { keys: ["left"], text: null });
  NodeAssert.equal(answerKeys(prompt, "banana"), null, "no free text on the review screen");
});

NodeTest.test("a question in a real multi-question form has its tabs, and free text goes to the last option", () => {
  // Read from a throwaway Claude Code session asked for two questions in one AskUserQuestion call.
  const prompt = parsePanePrompt(fixture("pane-form-tabs.txt"));
  NodeAssert.equal(prompt.question, "Which colour do you prefer?");
  NodeAssert.deepEqual(
    prompt.tabs?.map((t) => [t.label, t.answered]),
    [
      ["Colour", false],
      ["Size", false],
      ["Submit", true],
    ],
  );
  NodeAssert.deepEqual(
    prompt.options.map((o) => o.label),
    ["Red", "Green"],
  );
  NodeAssert.equal(prompt.header, "Colour · Size");
  NodeAssert.equal(prompt.customIndex, 2);
  NodeAssert.deepEqual(answerKeys(prompt, "green"), { keys: ["down", "enter"], text: null });
  NodeAssert.deepEqual(answerKeys(prompt, "Extra large, please"), {
    keys: ["down", "down"],
    text: "Extra large, please",
  });
});

NodeTest.test("a free-text option called Other is the custom slot too", () => {
  const screen = fixture("pane-form-tabs.txt").replace("3. Type something.", "3. Other");
  NodeAssert.equal(parsePanePrompt(screen).customIndex, 2);
});

NodeTest.test("the permission dialog and the single question still read as before", () => {
  NodeAssert.equal(parsePanePrompt(fixture("pane-permission.txt")).question, "Do you want to proceed?");
  NodeAssert.equal(parsePanePrompt(fixture("pane-question.txt")).question, "Which colour do you prefer?");
  NodeAssert.equal(parseReviewScreen(["nothing here"]), null);
});

NodeTest.test("a note from weaving is shown in the thread at once, even with no pane", async () => {
  const dir = queueDir();
  const { deps, said, typed } = harness({ live: null, failure: null });
  enqueue(dir, "s5", { text: "Sent to build: hi", shown: "Sent to build: hi", kind: "note" });
  await drainSession(dir, "s5", deps);
  NodeAssert.deepEqual(said, ["Sent to build: hi"]);
  NodeAssert.deepEqual(typed, []);
  NodeAssert.equal(readQueue(dir, "s5").length, 0);
});

NodeTest.test("inbox names a person can read", () => {
  const now = new Date("2026-11-02T11:13:47Z");
  NodeAssert.equal(readableInboxName("IMG_9489.png", now, "a3f9"), "IMG_9489-a3f9.png");
  NodeAssert.equal(
    readableInboxName(
      "baton-live4-5ab4ae0c-3cf4-4d50-aae3-94117d982204-6c567ac6-f2d7-4b0c-9541-41a0a052d316.png",
      now,
      "a3f9",
    ),
    "image-11-13-a3f9.png",
  );
});
