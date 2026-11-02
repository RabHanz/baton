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
const CUSTOM = /^(?:type something|other)\.?$/i;
const DROPPED = /^chat about this$/i;
const clean = (text) =>
  text
    .replace(/^[\s│┃|]+/, "")
    .replace(/\s+/g, " ")
    .trim();

/** The tab bar of a multi-question form: each question's name and whether it is answered (☒). */
const tabsOf = (line) =>
  [...line.matchAll(/([☐☒✔])\s+(.+?)(?=\s+[☐☒✔]|\s*→|\s*$)/g)]
    .map((m) => ({ label: m[2].trim(), answered: m[1] !== "☐", submit: m[1] === "✔" }))
    .filter((tab) => tab.label.length > 0);

/**
 * The last screen of a multi-question form: "Review your answers", each question with its answer, then
 * "Ready to submit your answers?" over Submit and Cancel. It has no Esc footer, which is why it was not
 * read: a session sat waiting on it with nothing to show. Going back one question is the left arrow.
 */
export function parseReviewScreen(lines) {
  let ask = -1;
  for (let i = lines.length - 1; i >= 0 && i >= lines.length - 40; i -= 1)
    if (/^\s*Ready to submit your answers\?\s*$/.test(lines[i])) {
      ask = i;
      break;
    }
  if (ask < 0) return null;
  const options = [];
  for (let i = ask + 1; i < lines.length && i <= ask + 8; i += 1) {
    const m = NUMBERED.exec(lines[i]);
    if (m === null) {
      if (options.length > 0 && lines[i].trim() === "") break;
      continue;
    }
    options.push({ number: Number(m[3]), label: m[4], selected: m[2] !== undefined });
  }
  if (options.length < 2 || options.filter((o) => o.selected).length !== 1) return null;
  let top = ask - 1;
  while (top >= 0 && ask - top < 40 && !/Review your answers/.test(lines[top])) top -= 1;
  const answers = [];
  for (let i = Math.max(0, top); i < ask; i += 1) {
    const q = /^[\s│┃]*●\s*(.*)$/.exec(lines[i]);
    if (q !== null) answers.push({ question: clean(q[1]), answer: "" });
    else if (answers.length > 0) {
      const a = /^\s*→\s*(.*)$/.exec(lines[i]);
      if (a !== null && answers.at(-1).answer === "") answers.at(-1).answer = clean(a[1]);
      else if (/^[\s│┃]/.test(lines[i]) && lines[i].trim() !== "" && answers.at(-1).answer === "")
        answers.at(-1).question = `${answers.at(-1).question} ${clean(lines[i])}`.trim();
    }
  }
  const tabLine = lines.slice(Math.max(0, top - 2), top + 1).find((l) => /^\s*←/.test(l));
  const question = "Ready to submit your answers?";
  const context = answers
    .map((a) => `${a.question} → ${a.answer}`)
    .join(" · ")
    .slice(0, 600);
  return {
    question,
    header: "Review your answers",
    ...(tabLine === undefined ? {} : { tabs: tabsOf(tabLine.trim()) }),
    context,
    options: [
      ...options.map((o) => ({ index: o.number - 1, label: o.label, description: "" })),
      { index: -1, label: "Go back", description: "Back to the last question", keys: ["left"] },
    ],
    selected: options.findIndex((o) => o.selected),
    customIndex: null,
    review: true,
    key: [question, ...options.map((o) => o.label), context].join("\u0000"),
  };
}

/**
 * The prompt on a Claude Code screen, or null when none can be read. Options keep their screen
 * order (`index`), so an answer is arrows from the highlighted one plus Enter.
 */
export function parsePanePrompt(screen) {
  const lines = String(screen ?? "")
    .replace(/\r/g, "")
    .split("\n");
  const review = parseReviewScreen(lines);
  if (review !== null) return review;
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
    const marked = lines
      .slice(Math.max(0, footer - 20), footer)
      .findLastIndex((l) => /^\s*❯\s/.test(l));
    if (marked < 0) return null;
    const at = Math.max(0, footer - 20) + marked;
    const indent = lines[at].indexOf("❯");
    const isOption = (l) =>
      l.trim().length > 0 &&
      (l.slice(indent).startsWith("❯ ") || l.slice(0, indent + 2).trim() === "");
    let top = at;
    while (
      top - 1 >= 0 &&
      isOption(lines[top - 1]) &&
      /^\s+$/.test(lines[top - 1].slice(0, indent + 2))
    )
      top -= 1;
    let bottom = at;
    while (
      bottom + 1 < footer &&
      isOption(lines[bottom + 1]) &&
      /^\s+$/.test(lines[bottom + 1].slice(0, indent + 2))
    )
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
  // A multi-question form puts its tabs on one line: ← ☐ Chrome ☒ Connectors ✔ Submit →
  const tabs = context.length > 0 && /^←/.test(context[0]) ? tabsOf(context.shift()) : null;
  const tabbed =
    context.length > 0 && /^[☐☒✔]/.test(context[0]) ? context.shift().slice(1).trim() : null;
  // A tabbed form's header is its tabs, so the card says which question of how many this is.
  const header =
    tabs !== null && tabs.length > 1
      ? tabs
          .filter((tab) => !tab.submit)
          .map((tab) => (tab.answered ? `${tab.label} ✓` : tab.label))
          .join(" · ")
      : tabbed;
  const visible = options.filter((o) => !CUSTOM.test(o.label) && !DROPPED.test(o.label));
  const custom = options.find((o) => CUSTOM.test(o.label));
  return {
    question,
    header,
    ...(tabs === null ? {} : { tabs }),
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
  if (option?.keys !== undefined) return { keys: option.keys, text: null };
  const target = option?.index ?? (wanted.length > 0 ? prompt.customIndex : null);
  if (target === null || target === undefined) return null;
  const delta = target - prompt.selected;
  const arrows = Array.from({ length: Math.abs(delta) }, () => (delta > 0 ? "down" : "up"));
  return option === undefined
    ? { keys: arrows, text: wanted }
    : { keys: [...arrows, "enter"], text: null };
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

// ---------------------------------------------------------------------------------------------
// The message queue. A message that cannot be delivered now is kept, in order, in a small file per
// session under ~/.t3/baton/live-queue, so a restart does not lose it; a drainer delivers it when the
// pane takes input. The turn never waits for it (T3 would queue every later send behind it).

const QUEUE_DIR =
  process.env.BATON_LIVE_QUEUE_DIR ?? NodePath.join(NodeOS.homedir(), ".t3", "baton", "live-queue");
const QUEUE_TRIES = Number(process.env.BATON_LIVE_QUEUE_TRIES ?? 6);
const QUEUE_EVERY_MS = Number(process.env.BATON_LIVE_QUEUE_EVERY_MS ?? 3_000);
/** A session gone this long with messages waiting is not coming back soon: they are handed back. */
const QUEUE_GONE_TRIES = Number(process.env.BATON_LIVE_QUEUE_GONE_TRIES ?? 10);

const queueFile = (dir, sessionId) =>
  NodePath.join(dir, `${sessionId.replace(/[^A-Za-z0-9_-]/g, "_")}.json`);

export function readQueue(dir, sessionId) {
  try {
    const parsed = JSON.parse(NodeFS.readFileSync(queueFile(dir, sessionId), "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeQueue(dir, sessionId, items) {
  const file = queueFile(dir, sessionId);
  if (items.length === 0) return void NodeFS.rmSync(file, { force: true });
  NodeFS.mkdirSync(dir, { recursive: true });
  const temp = `${file}.tmp`;
  NodeFS.writeFileSync(temp, JSON.stringify(items), { mode: 0o600 });
  NodeFS.renameSync(temp, file);
}

/** Adds one message at the end; returns how many are now waiting. */
export function enqueue(dir, sessionId, item) {
  const items = [...readQueue(dir, sessionId), { tries: 0, ...item }];
  writeQueue(dir, sessionId, items);
  return items.length;
}

export const queuedSessions = (dir) => {
  try {
    return NodeFS.readdirSync(dir).filter((name) => name.endsWith(".json"));
  } catch {
    return [];
  }
};

const preview = (text) => (text.length > 60 ? `${text.slice(0, 60)}…` : text);

export const queuedNote = (reason, count) =>
  `Not delivered yet: ${reason} ${count} message${count === 1 ? "" : "s"} queued; they send ${
    reason.includes("question") ? "when you answer it" : "as soon as it can take them"
  }.`;

export const deliveredNote = (shown) => `Delivered: ${preview(shown)}`;

/** The words are never lost: a message that cannot be delivered comes back, quoted. */
export const lostNote = (reason, shown) => `Not delivered: ${reason} Your message was: "${shown}"`;

/**
 * One pass over one session's queue, oldest first. Stops at the first message that cannot go yet, so
 * the order is kept. `deps` are the live session, the pane and the thread, injected for tests.
 */
/** Messages held back (a resume is under way or failed): kept, in order, never handed back or dropped. */
export function holdQueue(dir, sessionId, reason) {
  const items = readQueue(dir, sessionId);
  if (items.length > 0) writeQueue(dir, sessionId, items.map((item) => ({ ...item, held: reason })));
}

export function releaseQueue(dir, sessionId) {
  const items = readQueue(dir, sessionId);
  if (items.some((item) => item.held)) writeQueue(dir, sessionId, items.map(({ held: _gone, ...item }) => item));
}

export async function drainSession(dir, sessionId, deps) {
  // A note (weaving: "sent to X") is only shown in this thread; it never waits on the pane.
  const all = readQueue(dir, sessionId);
  if (all.some((item) => item.kind === "note")) {
    for (const item of all) if (item.kind === "note") deps.say(sessionId, String(item.text));
    writeQueue(
      dir,
      sessionId,
      all.filter((item) => item.kind !== "note"),
    );
  }
  const items = readQueue(dir, sessionId);
  if (items.length === 0) return;
  if (items[0].held) return;
  const live = deps.findLive(sessionId);
  if (live === null || live.pane === null) {
    const gone = items.map((item) => ({ ...item, gone: (item.gone ?? 0) + 1 }));
    if (gone[0].gone >= QUEUE_GONE_TRIES) {
      for (const item of items) {
        deps.say(sessionId, lostNote("the session is no longer running here.", item.shown));
      }
      return writeQueue(dir, sessionId, []);
    }
    return writeQueue(dir, sessionId, gone);
  }
  if (live.status === "waiting") return;
  while (true) {
    const [head, ...rest] = readQueue(dir, sessionId);
    if (head === undefined) return;
    const failure = await deps.typeInto(live.pane, head.text);
    if (failure === null) {
      writeQueue(dir, sessionId, rest);
      deps.say(sessionId, deliveredNote(head.shown));
      continue;
    }
    if (failure === BLOCKED_NOTE) return;
    const tries = head.tries + 1;
    if (tries >= QUEUE_TRIES) {
      writeQueue(dir, sessionId, rest);
      deps.say(sessionId, lostNote(failure, head.shown));
      continue;
    }
    return writeQueue(dir, sessionId, [{ ...head, tries }, ...rest]);
  }
}

/**
 * A send to a stopped session: the message is queued and visible at once, the session is resumed, and the
 * queue is released and drained when it is ready. A failure keeps the message, held, with the reason.
 */
export async function sendToStopped(dir, sessionId, item, deps) {
  enqueue(dir, sessionId, item);
  holdQueue(dir, sessionId, "resuming");
  deps.say(sessionId, resumingNote(item.shown));
  const result = await resumeSession(sessionId, deps);
  if (result.error !== undefined) {
    holdQueue(dir, sessionId, result.error);
    deps.say(sessionId, resumeFailedNote(result.error, ""));
    return { state: "failed", error: result.error };
  }
  releaseQueue(dir, sessionId);
  deps.say(sessionId, "Resumed in Herdr with its history. Sending now.");
  await drainSession(dir, sessionId, deps);
  return { state: "resumed" };
}

/** The prompt on the pane's screen now, or null. */
export async function readPanePrompt(paneRef) {
  const read = await run(
    HERDR,
    herdrArgs(paneRef, "read", ["--source", "visible", "--lines", "80"]),
  );
  return read.ok ? parsePanePrompt(read.out) : null;
}

/**
 * D88: answer the prompt showing in the pane with keystrokes, then wait until it is gone. Returns
 * what to tell the thread, or null when `text` is not an answer to it (nothing was pressed).
 */
export async function answerPrompt(sessionId, paneRef, text) {
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
    await run(HERDR, [
      ...session,
      "pane",
      "send-text",
      at < 0 ? paneRef : paneRef.slice(at + 1),
      plan.text,
    ]);
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

/** A request to bring a stopped session back without sending anything: just "resume". */
export const isResumeRequest = (text) => /^\s*resume( it| this session)?\s*\.?\s*$/i.test(text);

export const resumingNote = (shown) =>
  `Resuming this session in Herdr. Your message is kept and goes when it is ready: "${shown}"`;

export const resumeFailedNote = (reason, shown) =>
  `Could not resume: ${reason} Your message is kept${shown ? `: "${shown}"` : ""}. Send again, or say "resume", to try again.`;

const READY_MS = Number(process.env.BATON_LIVE_RESUME_READY_MS ?? 45_000);

/**
 * Brings a stopped Claude conversation back in Herdr with its history: `baton --resume <id> <folder>` on this
 * machine (the live agent runs on the thread's own box), then waits until it is in a pane and not mid-turn.
 * Returns the live session, or why not in words for a person. `deps` are the outside world, for tests.
 */
export async function resumeSession(sessionId, deps) {
  const cwd = deps.cwdOf(sessionId);
  if (cwd === null) return { error: "I do not know which folder this conversation was in, and its transcript is not on this machine." };
  if (!deps.dirExists(cwd)) return { error: `The folder ${cwd} is not on this machine.` };
  const out = await deps.baton(["--resume", sessionId, cwd]);
  if (!/running in (\S+) pane (\S+)/.test(out.out))
    return { error: `Herdr would not start it: ${out.out.replace(/\s+/g, " ").slice(0, 160) || "no answer"}.` };
  const started = deps.now();
  for (;;) {
    const live = deps.findLive(sessionId);
    if (live !== null && live.pane !== null && live.status !== "busy") return { live };
    if (deps.now() - started >= READY_MS) {
      const at = /running in (\S+) pane (\S+)/.exec(out.out);
      const screen = at === null || deps.screenOf === undefined ? "" : await deps.screenOf(at[1], at[2]).catch(() => "");
      return {
        error: /Is this a project you created or one you trust|trust this folder|Do you trust the files/i.test(screen)
          ? `Claude Code is asking whether to trust this folder, and waits for you to choose in Herdr (herdr --session ${at[1]}). Choose, then resume again.`
          : "It was started in Herdr but did not become ready within 45 seconds.",
      };
    }
    await deps.sleep(500);
  }
}

/** The folder a stopped conversation ran in, from its transcript in any Claude config folder. */
export function cwdFromTranscript(sessionId) {
  for (const sessions of sessionsDirs()) {
    const projects = NodePath.join(NodePath.dirname(sessions), "projects");
    let slugs = [];
    try {
      slugs = NodeFS.readdirSync(projects);
    } catch {
      continue;
    }
    for (const slug of slugs) {
      const file = NodePath.join(projects, slug, `${sessionId}.jsonl`);
      if (!NodeFS.existsSync(file)) continue;
      try {
        const fd = NodeFS.openSync(file, "r");
        const buf = Buffer.alloc(32 * 1024);
        const head = buf.subarray(0, NodeFS.readSync(fd, buf, 0, buf.length, 0)).toString("utf8");
        NodeFS.closeSync(fd);
        const m = /"cwd":"((?:[^"\\]|\\.)*)"/.exec(head);
        if (m !== null) return JSON.parse(`"${m[1]}"`);
      } catch {}
    }
  }
  return null;
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

/**
 * A name a person can read: the file's own, or `image-HH-MM.ext` when it is one of T3's generated
 * attachment names (thread id and uuid), plus a short suffix so two of the same name never collide.
 */
export function readableInboxName(fileName, now, suffix) {
  const clean = safeInboxName(fileName, "x").slice(2);
  const generated = /^baton-live|[0-9a-f]{8}-[0-9a-f]{4}-/.test(clean);
  const dot = clean.lastIndexOf(".");
  const ext = dot > 0 ? clean.slice(dot) : "";
  const hhmm = now.toISOString().slice(11, 16).replace(":", "-");
  const base = generated
    ? `${/^\.(png|jpe?g|gif|webp|heic)$/i.test(ext) ? "image" : "file"}-${hhmm}`
    : clean.slice(0, dot > 0 ? dot : clean.length);
  return `${base}-${suffix}${ext}`;
}

function saveToInbox(cwd, name, bytes) {
  const now = new Date();
  const day = NodePath.join(cwd, ".baton", "inbox", now.toISOString().slice(0, 10));
  NodeFS.mkdirSync(day, { recursive: true });
  const suffix = Math.random().toString(16).slice(2, 6);
  const path = NodePath.join(day, readableInboxName(name, now, suffix));
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
  // A plain sentence first, so the session (and the thread's echo) reads as a person would.
  const attached = refs.map((ref) => {
    const kind = /\.(png|jpe?g|gif|webp|heic)$/i.test(ref) ? "image" : "file";
    return `He attached ${kind} ${NodePath.basename(ref)}:\n@${ref}`;
  });
  return [text, ...attached].filter((part) => part.length > 0).join("\n");
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
    // Stopped: it is resumed and the message goes when it is ready. "Not delivered" is for nothing that can be fixed.
    const words = promptText(params.prompt);
    if (resumesInFlight.has(sessionId)) {
      const count = enqueue(QUEUE_DIR, sessionId, { text: words.trim(), shown: words.replace(/\s+/g, " ").trim().slice(0, 200), at: new Date().toISOString(), held: "resuming" });
      say(sessionId, `Still resuming. ${count} message${count === 1 ? "" : "s"} kept; they go when it is ready.`);
      return { stopReason: "end_turn" };
    }
    const cwd = cwdFromTranscript(sessionId);
    const body = cwd === null ? words.trim() : composeForSession(params.prompt, cwd);
    resumesInFlight.add(sessionId);
    try {
      const wantsOnlyResume = isResumeRequest(words);
      const item = { text: body, shown: words.replace(/\s+/g, " ").trim().slice(0, 200) || "(resume)", at: new Date().toISOString() };
      if (wantsOnlyResume) {
        say(sessionId, "Resuming this session in Herdr.");
        const result = await resumeSession(sessionId, resumeDeps);
        say(sessionId, result.error ?? "Resumed in Herdr with its history. Messages sent here now reach it.");
        if (result.error === undefined) releaseQueue(QUEUE_DIR, sessionId);
        if (result.error === undefined) startDrainer();
      } else {
        await sendToStopped(QUEUE_DIR, sessionId, item, { ...resumeDeps, ...drainDeps });
      }
    } finally {
      resumesInFlight.delete(sessionId);
    }
    return { stopReason: "end_turn" };
  }
  if (live.pane === null) {
    // A plain-terminal session (often one he drives through Remote Control) cannot take typed
    // input from outside, and moving it into Herdr restarts it. That only happens when asked.
    if (!isAdoptRequest(promptText(params.prompt))) {
      say(
        sessionId,
        `${notSentNote(live)}\n\nYour message was: "${promptText(params.prompt).trim()}"`,
      );
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
  const shown = promptText(params.prompt).replace(/\s+/g, " ").trim() || text.slice(0, 60);
  const turn = { cancelled: false, pane: live.pane };
  turns.set(sessionId, turn);
  try {
    // A question or approval on the screen takes the message as its answer (D88).
    if (live.status === "waiting") {
      const answered = await answerPrompt(sessionId, live.pane, promptText(params.prompt));
      if (answered !== null) {
        say(sessionId, answered);
        return { stopReason: "end_turn" };
      }
    }
    // Messages already waiting go first: this one joins the end so the order he typed is kept.
    if (live.status === "waiting" || readQueue(QUEUE_DIR, sessionId).length > 0) {
      const count = enqueue(QUEUE_DIR, sessionId, { text, shown, at: new Date().toISOString() });
      say(
        sessionId,
        queuedNote(
          live.status === "waiting"
            ? "the session is waiting on a question."
            : "earlier messages are still waiting.",
          count,
        ),
      );
      startDrainer();
      return { stopReason: "end_turn" };
    }
    const failure = await typeInto(live.pane, text);
    if (failure === BLOCKED_NOTE) {
      const answered = await answerPrompt(sessionId, live.pane, promptText(params.prompt));
      if (answered !== null) {
        say(sessionId, answered);
        return { stopReason: "end_turn" };
      }
    }
    if (failure !== null) {
      const count = enqueue(QUEUE_DIR, sessionId, { text, shown, at: new Date().toISOString() });
      say(
        sessionId,
        queuedNote(
          failure === BLOCKED_NOTE
            ? "the session is waiting on a question."
            : "Herdr did not take it yet.",
          count,
        ),
      );
      startDrainer();
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

const resumesInFlight = new Set();
const resumeDeps = {
  cwdOf: cwdFromTranscript,
  dirExists: (dir) => {
    try {
      return NodeFS.statSync(dir).isDirectory();
    } catch {
      return false;
    }
  },
  baton: (args) => run(BATON, args, 45_000).then((r) => ({ ok: r.ok, out: r.out })),
  findLive: findLiveSession,
  screenOf: async (session, pane) =>
    (await run("herdr", ["--session", session, "agent", "read", pane, "--source", "visible", "--lines", "25"], 8_000)).out,
  sleep,
  now: () => Date.now(),
};

let drainer = null;
const drainDeps = { findLive: findLiveSession, typeInto, say };
/** Delivers queued messages in the background; also at start-up, for what a restart left behind. */
function startDrainer() {
  if (drainer !== null) return;
  const tick = async () => {
    const names = queuedSessions(QUEUE_DIR);
    for (const name of names) {
      await drainSession(QUEUE_DIR, name.slice(0, -".json".length), drainDeps).catch(
        () => undefined,
      );
    }
    if (queuedSessions(QUEUE_DIR).length === 0) {
      clearInterval(drainer);
      drainer = null;
    }
  };
  drainer = setInterval(() => void tick(), QUEUE_EVERY_MS);
  drainer.unref?.();
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
  startDrainer();
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

if (
  process.argv[1] &&
  NodeURL.fileURLToPath(import.meta.url) === NodePath.resolve(process.argv[1])
) {
  // `--pane-prompt <pane>`: the server's mirror reads a waiting session's prompt through this (D88).
  if (process.argv[2] === "--pane-prompt" && process.argv[3])
    readPanePrompt(process.argv[3]).then((found) =>
      process.stdout.write(`${JSON.stringify(found)}\n`),
    );
  else main();
}
