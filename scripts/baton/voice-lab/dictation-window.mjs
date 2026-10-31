/**
 * Dictation's paste and stop paths against real Windows windows, on his desktop, with no microphone.
 * Only Notepad windows of its own are touched, and it closes them.
 *   node dictation-window.mjs --exe baton-dictation.exe --gguf model.gguf --wav clip.wav --dir workdir [--limit long.wav]
 */
import { execFileSync, spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

const flag = (name) => {
  const at = process.argv.indexOf(name);
  return at < 0 ? null : process.argv[at + 1];
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ps = (script) =>
  execFileSync("powershell.exe", ["-NoProfile", "-STA", "-Command", script], {
    encoding: "utf8",
  }).trim();
const setClip = (text) => ps(`Set-Clipboard -Value '${text}'`);
const getClip = () => ps("Get-Clipboard -Raw");

const sidecar = (env = {}) => {
  const child = spawn(flag("--exe"), [], {
    env: { ...process.env, ...env },
    stdio: ["pipe", "pipe", "ignore"],
  });
  const events = [];
  const waiting = [];
  createInterface({ input: child.stdout }).on("line", (line) => {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      return;
    }
    events.push(event);
    for (const wait of waiting.splice(0)) wait.check() || waiting.push(wait);
  });
  const send = (value) => child.stdin.write(`${JSON.stringify(value)}\n`);
  const until = (test, ms) =>
    new Promise((resolve) => {
      const found = () => events.find(test);
      const wait = {
        check: () => {
          const event = found();
          if (event) resolve(event);
          return event !== undefined;
        },
      };
      if (wait.check()) return;
      waiting.push(wait);
      setTimeout(() => resolve(null), ms);
    });
  send({
    cmd: "configure",
    model: flag("--gguf"),
    hold: null,
    toggle: null,
    device: null,
    channel: null,
    paste: "ctrl_v",
    language: null,
    cleanup: true,
  });
  return { child, events, send, until };
};

const opened = [];
const notepad = async (name) => {
  const file = join(flag("--dir"), name);
  writeFileSync(file, "");
  const child = spawn("notepad.exe", [file], { detached: true });
  opened.push(name);
  await sleep(2_500);
  return child;
};

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}  ${JSON.stringify(detail)}`);
};

const foreground = async (s, id) => {
  s.send({ cmd: "foreground", id });
  return s.until((e) => e.ev === "foreground" && e.id === id, 3_000);
};

const windows = async () => {
  const s = sidecar();
  await s.until((e) => e.ev === "configured", 5_000);
  await notepad("baton-paste-a.txt");
  const a = await foreground(s, 1);
  if (!/notepad/i.test(a?.app ?? "") || !/baton-paste-a/.test(a?.title ?? "")) {
    return check("foreground is our Notepad, nothing typed", false, a);
  }

  setClip("BATON-OLD-CLIP");
  s.send({ cmd: "paste", id: 2, text: "dictated into the right window", target: a.window });
  const right = await s.until((e) => e.ev === "pasted" && e.id === 2, 12_000);
  await sleep(1_000);
  const b = await foreground(s, 3);
  check(
    "pastes into the window it was spoken for",
    right?.error == null && right?.moved !== true && b.title.startsWith("*"),
    {
      right,
      title: b.title,
    },
  );
  check("clipboard comes back after a read", getClip() === "BATON-OLD-CLIP", { clip: getClip() });

  // Notepad opens a second file as a tab of the same window, so the other window is another app.
  // The About box also never reads the clipboard.
  spawn("winver.exe", [], { detached: true });
  await sleep(2_000);
  ps(`(New-Object -ComObject WScript.Shell).AppActivate('About Windows') | Out-Null`);
  await sleep(500);
  const other = await foreground(s, 4);
  if (other.window === a.window) return check("the About box took the keyboard", false, other);
  const before = a.title;
  s.send({ cmd: "paste", id: 5, text: "must not arrive", target: a.window });
  const moved = await s.until((e) => e.ev === "pasted" && e.id === 5, 5_000);
  await sleep(600);
  check("wrong window: refused", moved?.moved === true && other.window !== a.window, {
    moved,
    now: other.app,
    was: before,
  });
  check("wrong window: clipboard untouched", getClip() === "BATON-OLD-CLIP", { clip: getClip() });

  const started = Date.now();
  s.send({ cmd: "paste", id: 8, text: "nobody reads this", target: other.window });
  const unread = await s.until((e) => e.ev === "pasted" && e.id === 8, 12_000);
  let back = null;
  for (let i = 0; i < 40 && back === null; i += 1) {
    if (getClip() === "BATON-OLD-CLIP") back = Date.now() - started;
    else await sleep(300);
  }
  check("unread clipboard: his clipboard still comes back", back !== null, {
    unread,
    backAfterMs: back,
    app: other.app,
    unreadEvent: s.events.some((e) => e.ev === "unread"),
  });
  ps("Stop-Process -Name winver -Force -ea 0");
  s.send({ cmd: "quit" });
};

const stops = async () => {
  const s = sidecar({ BATON_FAKE_MIC: flag("--wav") });
  await s.until((e) => e.ev === "configured", 5_000);
  s.send({ cmd: "toggle" });
  await s.until((e) => e.ev === "recording", 10_000);
  await sleep(1_500);
  s.send({ cmd: "cancel" });
  const idle = await s.until((e) => e.ev === "idle", 3_000);
  await sleep(3_000);
  check(
    "cancel: back to idle and no text",
    idle !== null && !s.events.some((e) => e.ev === "text"),
    {
      events: s.events.map((e) => e.ev).filter((e) => e !== "ready"),
    },
  );
  s.send({ cmd: "quit" });
};

const limit = async () => {
  const long = flag("--limit");
  if (long === null) return;
  const s = sidecar({ BATON_FAKE_MIC: long });
  await s.until((e) => e.ev === "configured", 5_000);
  const started = Date.now();
  s.send({ cmd: "toggle" });
  await s.until((e) => e.ev === "recording", 10_000);
  const stopped = await s.until((e) => e.ev === "transcribing", 320_000);
  const text = await s.until((e) => e.ev === "text", 60_000);
  check(
    "five minutes stops it, keeps the text, pastes nothing",
    stopped !== null &&
      stopped.heldMs >= 299_000 &&
      stopped.heldMs < 302_000 &&
      text?.pasted === false &&
      text.text.length > 0,
    {
      heldMs: stopped?.heldMs,
      wallMs: Date.now() - started,
      chars: text?.text?.length ?? null,
      pasted: text?.pasted,
    },
  );
  s.send({ cmd: "quit" });
};

const closeOurs = () =>
  ps(
    `Get-CimInstance Win32_Process -Filter "Name='notepad.exe'" | Where-Object { $_.CommandLine -match 'baton-paste' } | ForEach-Object { $c = $_; Get-CimInstance Win32_Process -Filter "ParentProcessId=$($c.ProcessId)" | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ea 0 }; Stop-Process -Id $c.ProcessId -Force -ea 0 }`,
  );

const run = async () => {
  try {
    if (!process.argv.includes("--only-limit")) {
      await windows();
      await stops();
    }
    await limit();
  } finally {
    closeOurs();
    console.log(`${results.filter((r) => r.pass).length} of ${results.length} passed`);
    process.exit(0);
  }
};

await run();
