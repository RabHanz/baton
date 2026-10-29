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
const PROMPT_CLEAR_TRIES = Number(process.env.BATON_LIVE_PROMPT_CLEAR_TRIES ?? 30);
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
// Terminal prompts (D88): a permission dialog, an AskUserQuestion or a mod's ui.ask, read from
// the pane's screen so T3 can show it with its options and answer it with keystrokes.

const FOOTER = /Esc to cancel|Enter to (confirm|select)|↑\/↓ to navigate/;
const RULE = /^\s*[─━╌]{8,}\s*$/;
const SOLID = /^\s*[─━]{8,}\s*$/;
const NUMBERED = /^(\s*)(❯\s*)?(\d+)\.\s+(.+?)\s*$/;
const CUSTOM = /^type something\.?$/i;
const DROPPED = /^chat about this$/i;
const clean = (text) => text.replace(/^[\s│┃|]+/, "").replace(/\s+/g, " ").trim();

/**
 * The prompt on a Claude Code screen, or null when none can be read. Options keep their screen
 * order (`index`), so an answer is arrows from the highlighted one plus Enter.
 */
export function parsePanePrompt(screen) {
  const lines = String(screen ?? "").replace(/\r/g, "").split("\n");
  let footer = -1;
  for (let i = lines.length - 1; i >= 0 && i >= lines.length - 40; i -= 1)
    if (FOOTER.test(lines[i])) {
      footer = i;
      break;
    }
  if (footer < 0) return null;
  const options = [];
  let first = -1;
  // Numbered options (permission dialogs, AskUserQuestion), read upward to option 1.
  for (let i = footer - 1; i >= 0 && i >= footer - 60; i -= 1) {
    const m = NUMBERED.exec(lines[i]);
    if (m === null) continue;
    options.unshift({ number: Number(m[3]), label: m[4], selected: m[2] !== undefined, line: i });
    if (m[3] === "1") {
      first = i;
      break;
    }
  }
  const ordered = options.every((option, index) => option.number === index + 1);
  if (first < 0 || !ordered) {
    // Unnumbered options (the folder-trust dialog): the highlighted line and its neighbours.
    options.length = 0;
    const marked = lines.slice(Math.max(0, footer - 20), footer).findLastIndex((l) => /^\s*❯\s/.test(l));
    if (marked < 0) return null;
    const at = Math.max(0, footer - 20) + marked;
    const indent = lines[at].indexOf("❯");
    const isOption = (l) =>
      l.trim().length > 0 && (l.slice(indent).startsWith("❯ ") || l.slice(0, indent + 2).trim() === "");
    let top = at;
    while (top - 1 >= 0 && isOption(lines[top - 1]) && /^\s+$/.test(lines[top - 1].slice(0, indent + 2)))
      top -= 1;
    let bottom = at;
    while (bottom + 1 < footer && isOption(lines[bottom + 1]) && /^\s+$/.test(lines[bottom + 1].slice(0, indent + 2)))
      bottom += 1;
    for (let i = top; i <= bottom; i += 1)
      options.push({
        number: i - top + 1,
        label: clean(lines[i].replace("❯", "")),
        selected: i === at,
        line: i,
      });
    first = top;
  }
  if (options.length < 2 || options.filter((o) => o.selected).length !== 1) return null;
  // Lines under an option, before the next one, describe it.
  for (let k = 0; k < options.length; k += 1) {
    const end = k + 1 < options.length ? options[k + 1].line : footer;
    const text = lines
      .slice(options[k].line + 1, end)
      .filter((l) => !RULE.test(l))
      .map(clean)
      .filter((l) => l.length > 0)
      .join(" ");
    options[k].description = text;
  }
  // The question is the nearest text above the options; what it asks about runs up to a rule.
  let q = first - 1;
  while (q >= 0 && clean(lines[q]).length === 0) q -= 1;
  if (q < 0 || RULE.test(lines[q])) return null;
  const question = clean(lines[q]);
  let top = q - 1;
  while (top >= 0 && q - top < 30 && !SOLID.test(lines[top])) top -= 1;
  const context = lines
    .slice(top + 1, q)
    .filter((l) => !RULE.test(l))
    .map(clean)
    .filter((l) => l.length > 0);
  const header = context.length > 0 && /^[☐☒✔]/.test(context[0]) ? context.shift().slice(1).trim() : null;
  const visible = options.filter((o) => !CUSTOM.test(o.label) && !DROPPED.test(o.label));
  const custom = options.find((o) => CUSTOM.test(o.label));
  return {
    question,
    header,
    context: context.join(" · ").slice(0, 600),
    options: visible.map((o) => ({
      index: o.number - 1,
      label: o.label,
      description: o.description,
    })),
    selected: options.findIndex((o) => o.selected),
    customIndex: custom === undefined ? null : custom.number - 1,
    key: [question, ...options.map((o) => o.label)].join("\u0000"),
  };
}

/** The keys that answer `prompt` with `answer` (an option's label or number, or free text). */
export function answerKeys(prompt, answer) {
  const wanted = String(answer ?? "").trim();
  const byLabel = prompt.options.find((o) => o.label.toLowerCase() === wanted.toLowerCase());
  const byNumber = /^\d+$/.test(wanted)
    ? prompt.options.find((o) => o.index === Number(wanted) - 1)
    : undefined;
  const option = byLabel ?? byNumber;
  const target = option?.index ?? (wanted.length > 0 ? prompt.customIndex : null);
  if (target === null || target === undefined) return null;
  const delta = target - prompt.selected;
  const arrows = Array.from({ length: Math.abs(delta) }, () => (delta > 0 ? "down" : "up"));
  return option === undefined ? { keys: arrows, text: wanted } : { keys: [...arrows, "enter"], text: null };
}

/** What T3 sends back for an answered question: "<question>\n<answer>". */
export function answerFrom(text, prompt) {
  const body = String(text ?? "").trim();
  const asked = prompt.question;
  const at = body.indexOf("\n");
  if (at > 0 && body.slice(0, at).trim().endsWith(asked)) return body.slice(at + 1).trim();
  return body;
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

const BLOCKED_NOTE =
  "Claude Code is waiting on a question or an approval in its terminal; answer it there first.";

/** The prompt on the pane's screen now, or null. */
export async function readPanePrompt(paneRef) {
  const read = await run(HERDR, herdrArgs(paneRef, "read", ["--source", "visible", "--lines", "80"]));
  return read.ok ? parsePanePrompt(read.out) : null;
}

/**
 * D88: answer the prompt showing in the pane with keystrokes, then wait until it is gone. Returns
 * what to tell the thread, or null when `text` is not an answer to it (nothing was pressed).
 */
async function answerPrompt(sessionId, paneRef, text) {
  const shown = await readPanePrompt(paneRef);
  if (shown === null) return null;
  const answer = answerFrom(text, shown);
  const plan = answerKeys(shown, answer);
  if (plan === null) return null;
  if (plan.keys.length > 0) await run(HERDR, herdrArgs(paneRef, "send-keys", plan.keys));
  if (plan.text !== null) {
    const at = paneRef.indexOf("~");
    const session = at < 0 ? [] : ["--session", paneRef.slice(0, at)];
    await sleep(300);
    await run(HERDR, [...session, "pane", "send-text", at < 0 ? paneRef : paneRef.slice(at + 1), plan.text]);
    await run(HERDR, herdrArgs(paneRef, "send-keys", ["enter"]));
  }
  for (let i = 0; i < PROMPT_CLEAR_TRIES; i += 1) {
    await sleep(500);
    const now = await readPanePrompt(paneRef);
    if (now === null || now.key !== shown.key) {
      const status = findLiveSession(sessionId)?.status ?? "gone";
      return `Answered in the terminal: ${plan.text ?? answer}. The session is ${status === "waiting" ? "asking again" : status} now.`;
    }
  }
  return `The answer "${plan.text ?? answer}" was pressed, but the terminal still shows the question.`;
}

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
    ? BLOCKED_NOTE
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
    // A question or approval on the screen takes the message as its answer (D88).
    if (live.status === "waiting") {
      const answered = await answerPrompt(sessionId, live.pane, promptText(params.prompt));
      say(sessionId, answered ?? BLOCKED_NOTE);
      return { stopReason: "end_turn" };
    }
    const failure = await typeInto(live.pane, text);
    if (failure === BLOCKED_NOTE) {
      say(sessionId, (await answerPrompt(sessionId, live.pane, promptText(params.prompt))) ?? failure);
      return { stopReason: "end_turn" };
    }
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

if (process.argv[1] && NodeURL.fileURLToPath(import.meta.url) === NodePath.resolve(process.argv[1])) {
  // `--pane-prompt <pane>`: the server's mirror reads a waiting session's prompt through this (D88).
  if (process.argv[2] === "--pane-prompt" && process.argv[3])
    readPanePrompt(process.argv[3]).then((found) => process.stdout.write(`${JSON.stringify(found)}\n`));
  else main();
}
