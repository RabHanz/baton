#!/usr/bin/env node
/* oxlint-disable t3code/no-low-value-comments -- Baton file (D82) */
/**
 * Baton live-session agent (D83): an ACP agent that T3 runs through its own "ACP Registry → Local
 * command" provider, so a message typed into T3's ordinary composer reaches a Claude Code session
 * that is already running in a terminal.
 *
 * It does not run a model. `session/resume <claude session id>` binds to the live session found
 * in Claude Code's own `~/.claude/sessions/<pid>.json`; `session/prompt` types the text into that
 * session's Herdr pane (moving an idle plain-terminal session into Herdr first, the same
 * `baton --resume` adoption as D74) and ends the turn once Herdr has delivered the text (D85).
 * The reply reaches the thread through Baton's transcript mirror, so there is one writer of the
 * conversation and nothing is shown twice.
 *
 * Node built-ins only: T3 spawns it with whichever Node the box has.
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeReadline from "node:readline";
import * as NodeURL from "node:url";

const HERDR =
  process.env.BATON_HERDR_BIN ?? NodePath.join(NodeOS.homedir(), ".local", "bin", "herdr");
const BATON = process.env.BATON_BIN ?? NodePath.join(NodeOS.homedir(), ".local", "bin", "baton");
const ATTACHMENT_ENTER_MS = Number(process.env.BATON_LIVE_ATTACHMENT_ENTER_MS ?? 1_500);
const UNBOUND = "baton-unbound";

// ---------------------------------------------------------------------------------------------
// Pure parts (tested in baton-live-acp.test.ts)

/** The user's words from T3's prompt blocks: T3's own instruction wrappers are not for Claude. */
export function promptText(blocks) {
  const texts = (Array.isArray(blocks) ? blocks : [])
    .filter((block) => block && block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .filter((text) => !text.trimStart().startsWith("<runtime_info>"));
  const first = texts.join("\n\n");
  const wrapped = /<user_request>\n?([\s\S]*?)\n?<\/user_request>/.exec(first);
  const text = wrapped === null ? first : wrapped[1];
  // T3 prefixes a context handoff (and restart notes) as "<context>\n\nUser message:\n<text>".
  // The live session already holds its own history, so only the user's words go through.
  const marker = "\n\nUser message:\n";
  const at = text.lastIndexOf(marker);
  return (at < 0 ? text : text.slice(at + marker.length)).trim();
}

/** The explicit request to move a plain-terminal session into Herdr. */
export const isAdoptRequest = (text) => /^\s*bring (it )?into herdr\s*\.?\s*$/i.test(text);

/** What a send to a plain-terminal session says instead of being delivered. */
export const notSentNote = (live) =>
  [
    "Not sent. This session runs in a plain terminal" +
      (live.remoteControl ? " with Remote Control on" : "") +
      ", and Baton can only type into sessions inside Herdr.",
    "Moving it into Herdr restarts it with the same conversation" +
      (live.remoteControl
        ? " (Remote Control on claude.ai disconnects until you turn it on again)"
        : "") +
      (live.status === "busy" ? ", and it is working right now, so wait until it is idle." : "."),
    "To move it, send exactly: bring into Herdr",
  ].join("\n\n");

/** T3's own restart continuation: not the user's words, so never typed into the session. */
export const isAppContinuation = (text) => text.trim() === "Continue where you left off.";

/** Every Claude config directory's sessions folder (same list as ClaudeLiveSessions.ts). */
export function sessionsDirs() {
  if (process.env.BATON_CLAUDE_SESSIONS_DIR) return [process.env.BATON_CLAUDE_SESSIONS_DIR];
  const home = NodeOS.homedir();
  const dirs = [NodePath.join(home, ".claude")];
  const add = (parent, filter) => {
    try {
      for (const name of NodeFS.readdirSync(parent))
        if (filter(name)) dirs.push(NodePath.join(parent, name));
    } catch {}
  };
  add(NodePath.join(home, ".local", "share", "claude-swap", "sessions"), () => true);
  add(home, (name) => name.startsWith(".claude-"));
  for (const extra of (process.env.BATON_CLAUDE_CONFIG_DIRS ?? "").split(":"))
    if (extra) dirs.push(extra);
  return [...new Set(dirs)].map((dir) => NodePath.join(dir, "sessions"));
}

/** T3 lists each attachment as `[Attached <type> "<name>" is saved at: <path>...]`. */
export function splitAttachments(text) {
  const paths = [];
  const kept = text.replace(
    /\[Attached [^\]"]* "[^"]*" is saved at: ([^\]\s]+)(?: \(text extracted to: [^)]*\))?\]/g,
    (_match, path) => {
      paths.push(path);
      return "";
    },
  );
  return { text: kept.replace(/\n{3,}/g, "\n\n").trim(), paths };
}

/** A file name that cannot leave the inbox or hide (same rule as LiveActions.safeInboxName). */
export function safeInboxName(fileName, stamp) {
  const base = NodePath.basename(fileName)
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[.-]+/, "");
  return `${stamp}-${base.length === 0 ? "file" : base.slice(0, 120)}`;
}

export function herdrPaneRef(env) {
  const pane = env.get("HERDR_PANE_ID");
  if (!pane) return null;
  const session = env.get("HERDR_SESSION");
  return !session || session === "default" ? pane : `${session}~${pane}`;
}

// ---------------------------------------------------------------------------------------------
// The live session

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const herdrEnvOf = (pid) => {
  const map = new Map();
  try {
    for (const entry of NodeFS.readFileSync(`/proc/${pid}/environ`, "utf8").split("\0")) {
      const at = entry.indexOf("=");
      if (at > 0 && entry.startsWith("HERDR_")) map.set(entry.slice(0, at), entry.slice(at + 1));
    }
  } catch {}
  return map;
};

/** The running interactive process for a Claude conversation id, or null. */
export function findLiveSession(sessionId) {
  for (const dir of sessionsDirs()) {
    const found = findIn(sessionId, dir);
    if (found !== null) return found;
  }
  return null;
}

function findIn(sessionId, dir) {
  let names = [];
  try {
    names = NodeFS.readdirSync(dir).filter((name) => /^\d+\.json$/.test(name));
  } catch {
    return null;
  }
  for (const name of names) {
    let d;
    try {
      d = JSON.parse(NodeFS.readFileSync(NodePath.join(dir, name), "utf8"));
    } catch {
      continue;
    }
    if (d?.sessionId !== sessionId || d.kind !== "interactive" || typeof d.pid !== "number")
      continue;
    if (!alive(d.pid)) continue;
    const env = herdrEnvOf(d.pid);
    const pane = process.env.BATON_TEST_HERDR_PANE ?? herdrPaneRef(env);
    return {
      pid: d.pid,
      cwd: d.cwd,
      status: d.status ?? null,
      pane,
      remoteControl: typeof d.bridgeSessionId === "string" && d.bridgeSessionId.length > 0,
    };
  }
  return null;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const run = (file, args, timeout = 15_000) =>
  new Promise((resolve) =>
    NodeChildProcess.execFile(file, args, { timeout }, (error, stdout, stderr) =>
      resolve({ ok: error === null, out: `${stdout}${stderr}`.trim() }),
    ),
  );

/** `herdr [--session S] agent <verb> <pane> ...` for a `<session>~<pane>` ref. */
const herdrArgs = (paneRef, verb, rest) => {
  const at = paneRef.indexOf("~");
  return at < 0
    ? ["agent", verb, paneRef, ...rest]
    : ["--session", paneRef.slice(0, at), "agent", verb, paneRef.slice(at + 1), ...rest];
};

/** Herdr's `agent prompt` pastes with the terminal's bracketed-paste mode, then presses Enter. */
async function typeInto(paneRef, text) {
  const sent = await run(HERDR, herdrArgs(paneRef, "prompt", [text]));
  if (sent.ok) {
    // Claude Code reads a pasted @image while the paste's Enter arrives and drops that Enter,
    // so the message sat unsent in its input (D85). A second Enter on an empty input is a no-op.
    if (/^@\//m.test(text)) {
      await sleep(ATTACHMENT_ENTER_MS);
      await run(HERDR, herdrArgs(paneRef, "send-keys", ["enter"]));
    }
    return null;
  }
  return /agent_blocked/.test(sent.out)
    ? "Claude Code is waiting on a question or an approval in its terminal; answer it there first."
    : `Herdr did not take the message: ${sent.out.slice(0, 200)}`;
}

/** D74 adoption: an idle plain-terminal session is reopened in Herdr with the same conversation. */
async function adopt(sessionId, live) {
  if (live.status === "busy") {
    return {
      error:
        "It is working in a plain terminal right now. Send again when it is idle and Baton will move it into Herdr.",
    };
  }
  process.kill(live.pid, "SIGTERM");
  for (let i = 0; i < 40 && alive(live.pid); i += 1) await sleep(250);
  if (alive(live.pid)) return { error: "It did not exit, so it was left as it was." };
  const out = await run(BATON, ["--resume", sessionId, live.cwd], 30_000);
  if (!/running in (\S+) pane (\S+)/.test(out.out))
    return { error: `baton --resume said: ${out.out.slice(0, 200)}` };
  for (let i = 0; i < 60; i += 1) {
    const next = findLiveSession(sessionId);
    if (next?.pane && next.status !== "busy") return { live: next };
    await sleep(500);
  }
  return { error: "It reopened in Herdr but did not report ready in 30 s." };
}

function saveToInbox(cwd, name, bytes) {
  const inbox = NodePath.join(cwd, ".baton", "inbox");
  NodeFS.mkdirSync(inbox, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const path = NodePath.join(inbox, safeInboxName(name, stamp));
  NodeFS.writeFileSync(path, bytes, { mode: 0o600 });
  return path;
}

/** The text Claude Code receives: the words, then `@path` for every file, copied into its inbox. */
function composeForSession(blocks, cwd) {
  const { text, paths } = splitAttachments(promptText(blocks));
  const refs = [];
  for (const path of paths) {
    try {
      refs.push(saveToInbox(cwd, path, NodeFS.readFileSync(path)));
    } catch {}
  }
  if (paths.length === 0) {
    for (const block of Array.isArray(blocks) ? blocks : []) {
      if (block?.type === "image" && typeof block.data === "string") {
        const ext = String(block.mimeType ?? "image/png").split("/")[1] ?? "png";
        refs.push(saveToInbox(cwd, `image.${ext}`, Buffer.from(block.data, "base64")));
      }
    }
  }
  return [text, ...refs.map((ref) => `@${ref}`)].filter((part) => part.length > 0).join("\n");
}

// ---------------------------------------------------------------------------------------------
// ACP over stdio (newline-delimited JSON-RPC 2.0, protocol v1)

const write = (message) =>
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
const say = (sessionId, text) =>
  write({
    method: "session/update",
    params: {
      sessionId,
      update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } },
    },
  });

const turns = new Map(); // sessionId -> { cancelled: boolean, pane: string | null }

async function prompt(params) {
  const sessionId = params.sessionId;
  if (typeof sessionId !== "string" || sessionId.startsWith(UNBOUND)) {
    say(sessionId, "This thread is not bound to a running Claude Code session.");
    return { stopReason: "end_turn" };
  }
  if (isAppContinuation(promptText(params.prompt))) return { stopReason: "end_turn" };
  let live = findLiveSession(sessionId);
  if (live === null) {
    say(sessionId, "That Claude Code session is not running on this machine now.");
    return { stopReason: "end_turn" };
  }
  if (live.pane === null) {
    // A plain-terminal session (often one he drives through Remote Control) cannot take typed
    // input from outside, and moving it into Herdr restarts it. That only happens when asked.
    if (!isAdoptRequest(promptText(params.prompt))) {
      say(sessionId, notSentNote(live));
      return { stopReason: "end_turn" };
    }
    const adopted = await adopt(sessionId, live);
    say(
      sessionId,
      adopted.error ??
        "Moved into Herdr with the same conversation. Messages sent here now reach it.",
    );
    return { stopReason: "end_turn" };
  }
  const text = composeForSession(params.prompt, live.cwd);
  if (text.length === 0) return { stopReason: "end_turn" };
  const turn = { cancelled: false, pane: live.pane };
  turns.set(sessionId, turn);
  try {
    const failure = await typeInto(live.pane, text);
    if (failure !== null) {
      say(sessionId, failure);
      return { stopReason: "end_turn" };
    }
    // The turn ends once Herdr has delivered the text. Holding it open until Claude Code went idle
    // made T3 queue every later message behind a session that is busy most of the time; Claude
    // Code takes input mid-turn itself. The mirror shows the session working (D85).
    return turn.cancelled ? { stopReason: "cancelled" } : { stopReason: "end_turn" };
  } finally {
    turns.delete(sessionId);
  }
}

async function handle(message) {
  const { id, method, params = {} } = message;
  switch (method) {
    case "initialize":
      return {
        protocolVersion: 1,
        agentInfo: { name: "baton-live", title: "Baton live session", version: "1" },
        agentCapabilities: {
          loadSession: false,
          promptCapabilities: { image: true, audio: false, embeddedContext: false },
          sessionCapabilities: { resume: {} },
        },
        authMethods: [],
      };
    case "session/new":
      return { sessionId: `${UNBOUND}-${process.pid}-${id}` };
    case "session/resume":
      return {};
    case "session/prompt":
      return prompt(params);
    case "session/cancel": {
      // Stop reaches Claude Code as Esc in its pane, during a send or after it.
      const turn = turns.get(params.sessionId);
      if (turn) turn.cancelled = true;
      const pane = turn?.pane ?? findLiveSession(params.sessionId)?.pane ?? null;
      if (pane) await run(HERDR, herdrArgs(pane, "send-keys", ["esc"]));
      return undefined;
    }
    default:
      if (id === undefined) return undefined;
      throw Object.assign(new Error(`Method not found: ${method}`), { code: -32601 });
  }
}

function main() {
  const lines = NodeReadline.createInterface({ input: process.stdin });
  lines.on("line", (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (!message || typeof message.method !== "string") return; // responses to us: none expected
    handle(message).then(
      (result) => {
        if (message.id !== undefined) write({ id: message.id, result: result ?? null });
      },
      (error) => {
        if (message.id !== undefined)
          write({
            id: message.id,
            error: { code: error.code ?? -32603, message: String(error.message ?? error) },
          });
      },
    );
  });
  lines.on("close", () => process.exit(0));
}

if (process.argv[1] && NodeURL.fileURLToPath(import.meta.url) === NodePath.resolve(process.argv[1]))
  main();
