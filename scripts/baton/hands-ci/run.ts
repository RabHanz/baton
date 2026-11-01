// @effect-diagnostics nodeBuiltinImport:off globalTimers:off
// The hands loop on real apps (issue #52). Runs on a Windows desktop (CI: windows-2022) with the same
// tools the assistant has. The PLANNER IS SCRIPTED: no model login exists on a runner, so each task's
// steps are written here, and what is being measured is the tool path (see, act, check, wait, re-plan
// after an error, stop after two identical failures), not a model's planning. Writes results.json.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { changedPixels, makeHost, ps, sleep, type Host } from "./host.ts";

process.on("unhandledRejection", (error) =>
  console.log(`unhandled: ${(error as Error).message.split("\n")[0]}`),
);

const OUT = process.env["HANDS_OUT"] ?? NodePath.join(process.cwd(), "hands-out");
const host: Host = makeHost(OUT);
const WORK = NodePath.join(NodeOS.tmpdir(), `hands-${Date.now()}`);
NodeFS.mkdirSync(WORK, { recursive: true });

interface Step {
  readonly kind: "see" | "act" | "check" | "replan";
  readonly text: string;
  readonly ms: number;
}
interface Result {
  id: string;
  goal: string;
  result: "pass" | "fail";
  seconds: number;
  evidence: string;
  cause: string;
  steps: Step[];
}

class Task {
  readonly steps: Step[] = [];
  readonly pids: number[] = [];
  /** The apps these tests open; the ones that were not running before are closed after, by name from this list only. */
  static readonly APPS = [
    "notepad",
    "CalculatorApp",
    "Calculator",
    "calc",
    "win32calc",
    "mspaint",
    "SystemSettings",
    "ApplicationFrameHost",
  ];
  before: number[] = [];
  evidence = "";
  readonly id: string;
  constructor(id: string) {
    this.id = id;
  }

  private log(kind: Step["kind"], text: string, started: number) {
    this.steps.push({ kind, text: text.slice(0, 240), ms: Date.now() - started });
  }

  /** One tool call, logged as a see (ui_tree, screenshot) or an act. */
  async tool(name: string, args: Record<string, unknown> = {}): Promise<string> {
    const started = Date.now();
    const kind = name === "ui_tree" || name === "screen_capture" ? "see" : "act";
    const label = `${name} ${JSON.stringify(args).slice(0, 120)}`;
    try {
      const out = await host.call(name, args);
      this.log(kind, `${label} -> ${out.split("\n")[0]?.slice(0, 100) ?? ""}`, started);
      return out;
    } catch (error) {
      this.log(kind, `${label} FAILED ${(error as Error).message.slice(0, 120)}`, started);
      throw error;
    }
  }

  /** A tool call that may fail; the loop goes on with another route. */
  async tryTool(name: string, args: Record<string, unknown> = {}): Promise<string | null> {
    try {
      return await this.tool(name, args);
    } catch {
      return null;
    }
  }

  replan(text: string) {
    this.steps.push({ kind: "replan", text, ms: 0 });
  }

  check(ok: boolean, what: string) {
    this.steps.push({
      kind: "check",
      text: `${ok ? "ok" : "NOT ok"}: ${what}`.slice(0, 240),
      ms: 0,
    });
    if (!ok) throw new Error(what);
    this.evidence = what;
  }

  /** Polls ui_tree until a line matches. */
  async waitTree(re: RegExp, seconds = 10): Promise<string> {
    const until = Date.now() + seconds * 1000;
    let tree = "";
    do {
      tree = await this.tool("ui_tree");
      if (re.test(tree)) return tree;
      await sleep(500);
    } while (Date.now() < until);
    throw new Error(
      `The window never showed ${re}. Last tree: ${tree.split("\n").slice(0, 12).join(" | ")}`,
    );
  }

  async launch(command: string, args: string[] = [], title = ""): Promise<number> {
    const list = args.map((a) => `'${a.replaceAll("'", "''")}'`).join(",");
    const pid = Number(
      await ps(
        `$p = Start-Process -FilePath '${command}' ${list ? `-ArgumentList ${list}` : ""} -PassThru; $p.Id`,
      ),
    );
    this.pids.push(pid);
    this.steps.push({ kind: "act", text: `launch ${command} (pid ${pid})`, ms: 0 });
    await sleep(2500);
    if (title !== "") await this.activate(title);
    return pid;
  }

  async activate(title: string) {
    await ps(`$s = New-Object -ComObject WScript.Shell; [void]$s.AppActivate('${title}')`).catch(
      () => undefined,
    );
    await sleep(500);
  }

  async snapshot() {
    const ids = await ps(
      `@(Get-Process -Name ${Task.APPS.join(",")} -ErrorAction SilentlyContinue | ForEach-Object { $_.Id }) -join ','`,
    ).catch(() => "");
    this.before = ids.split(",").filter(Boolean).map(Number);
  }

  async cleanup() {
    const open = await ps("Get-Process | Where-Object { $_.MainWindowTitle } | ForEach-Object { \"$($_.Name)#$($_.Id)='$($_.MainWindowTitle)'\" }").catch(() => "");
    console.log(`  windows before cleanup: ${open.replaceAll("\n", " ").slice(0, 300)}`);
    await ps(
      `Get-Process -Name ${Task.APPS.join(",")} -ErrorAction SilentlyContinue | Where-Object { @(${this.before.join(",") || "0"}) -notcontains $_.Id } | Stop-Process -Force -ErrorAction SilentlyContinue; ` +
        `(New-Object -ComObject Shell.Application).Windows() | Where-Object { $_.LocationName -like 'explore*' } | ForEach-Object { $_.Quit() }`,
    ).catch(() => undefined);
    for (const pid of this.pids)
      await ps(`Stop-Process -Id ${pid} -Force -ErrorAction SilentlyContinue`).catch(
        () => undefined,
      );
    await sleep(500);
  }
}

const results: Result[] = [];
const only = process.env["HANDS_ONLY"];
const task = async (id: string, goal: string, body: (t: Task) => Promise<void>) => {
  if (only !== undefined && only !== "" && only !== id) return;
  const t = new Task(id);
  await t.snapshot();
  const started = Date.now();
  let result: Result["result"] = "pass";
  let cause = "";
  try {
    await body(t);
  } catch (error) {
    result = "fail";
    cause = (error as Error).message.replaceAll("\n", " ").slice(0, 400);
    try {
      const dump = await host.call("ui_tree", {});
      NodeFS.writeFileSync(NodePath.join(OUT, `${id}-failure-tree.txt`), dump);
      await host.shot(`${id}-failure`);
    } catch {
      // the dump is a courtesy
    }
  }
  await t.cleanup();
  const r: Result = {
    id,
    goal,
    result,
    seconds: Math.round((Date.now() - started) / 100) / 10,
    evidence: t.evidence,
    cause,
    steps: t.steps,
  };
  results.push(r);
  console.log(
    `${result.toUpperCase()} ${id} (${r.seconds}s) ${result === "pass" ? t.evidence : cause}`,
  );
  NodeFS.writeFileSync(NodePath.join(OUT, "results.json"), JSON.stringify(results, null, 2));
};

const SENTENCE = "The quick brown fox jumps over the lazy dog.";

// 1. Type a sentence in Notepad, Save As to a named file (the dialog appears late), verify the file.
await task(
  "notepad-save-as",
  "Type a sentence in Notepad and Save As to a named file, then read the file back",
  async (t) => {
    const file = NodePath.join(WORK, "fox.txt");
    await t.launch("notepad.exe", [], "Notepad");
    await t.waitTree(/notepad/i);
    await t.tool("type_text", { text: SENTENCE, why: "the sentence" });
    await t.tool("press_keys", { keys: ["ctrl", "s"], why: "save" });
    const waited = await t.tool("wait_for", { label: "File name", seconds: 10 });
    t.check(/is there/.test(waited), "the Save As dialog showed up (waited for its File name box)");
    await t.tool("type_text", { text: file, why: "the file name" });
    await t.tool("press_keys", { keys: ["enter"], why: "confirm" });
    for (let i = 0; i < 20 && !NodeFS.existsSync(file); i += 1) await sleep(400);
    t.check(
      NodeFS.existsSync(file) && NodeFS.readFileSync(file, "utf8").trim() === SENTENCE,
      `fox.txt holds exactly the sentence (${NodeFS.existsSync(file) ? NodeFS.readFileSync(file, "utf8").trim().slice(0, 60) : "no file"})`,
    );
  },
);

// 2. Open a menu item by name, in two clicks, and see its dialog.
await task(
  "menu-by-name",
  "Open Help > About Notepad by name and confirm the dialog",
  async (t) => {
    await t.launch("notepad.exe", [], "Notepad");
    await t.waitTree(/notepad/i);
    await t.tool("click_element", { label: "Help", why: "open the menu" });
    await t.tool("click_element", { label: "About Notepad", why: "the menu item" });
    const tree = await t.waitTree(/about notepad/i, 8);
    t.check(
      /about notepad/i.test(tree),
      "the About Notepad dialog is the window with the keyboard",
    );
  },
);

// 3. Change a setting and verify it where it is stored.
await task(
  "notepad-word-wrap",
  "Turn on Word Wrap from the Format menu and verify the saved setting",
  async (t) => {
    const key = "HKCU:\\Software\\Microsoft\\Notepad";
    const before = await ps(
      `(Get-ItemProperty -Path '${key}' -Name fWrap -ErrorAction SilentlyContinue).fWrap`,
    );
    const pid = await t.launch("notepad.exe", [], "Notepad");
    await t.waitTree(/notepad/i);
    await t.tool("click_element", { label: "Format", why: "open the menu" });
    const tree = await t.tool("ui_tree");
    t.replan(
      `looked at the menu: ${
        tree
          .split("\n")
          .filter((l) => /word wrap/i.test(l))
          .join(" | ") || "no Word Wrap line"
      }`,
    );
    await t.tool("click_element", { label: "Word Wrap", why: "the setting" });
    await t.tool("press_keys", { keys: ["alt", "f4"], why: "close so it saves its settings" });
    await sleep(1500);
    await ps(`Stop-Process -Id ${pid} -Force -ErrorAction SilentlyContinue`).catch(() => undefined);
    const after = await ps(
      `(Get-ItemProperty -Path '${key}' -Name fWrap -ErrorAction SilentlyContinue).fWrap`,
    );
    t.check(after !== "" && after !== before, `fWrap went from "${before}" to "${after}"`);
  },
);

// 4. Calculator: 12 * 34, read the result.
await task(
  "calculator",
  "Compute 12 x 34 in Calculator by clicking its buttons, and read the result",
  async (t) => {
    await t.launch("calc.exe", [], "Calculator");
    await t.waitTree(/calculator/i, 15);
    const names: ReadonlyArray<ReadonlyArray<string>> = [
      ["One", "1"],
      ["Two", "2"],
      ["Multiply by", "Multiply", "×", "*"],
      ["Three", "3"],
      ["Four", "4"],
      ["Equals", "=", "Equal"],
    ];
    for (const candidates of names) {
      let done = false;
      for (const name of candidates) {
        if (
          (await t.tryTool("click_element", { label: name, why: "a calculator button" })) !== null
        ) {
          done = true;
          break;
        }
        t.replan(`no control called "${name}"; trying the next name`);
      }
      if (!done) throw new Error(`no button for ${candidates.join(" / ")}`);
    }
    const tree = await t.tool("ui_tree");
    const read = tree.split("\n").find((l) => /408/.test(l)) ?? "";
    t.check(read !== "", `the display reads: ${read || "(nothing with 408)"}`);
  },
);

// 5. File Explorer: new folder, then rename it; verify on disk.
await task(
  "explorer-folder",
  "Create a folder in File Explorer and rename it, then check the disk",
  async (t) => {
    const dir = NodePath.join(WORK, "explore");
    NodeFS.mkdirSync(dir, { recursive: true });
    await t.launch("explorer.exe", [dir]);
    await t.activate("explore");
    await t.waitTree(/explore/i, 15);
    // The keyboard shortcut needs the file list focused, which a new window does not have; the tree names
  // a "New folder" button, so the loop uses that.
  const tree = await t.tool("ui_tree");
  t.replan(`read the tree; it has ${tree.split("\n").find((l) => /new folder/i.test(l)) ?? "no New folder button"}`);
  await t.tool("click_element", { label: "New folder", why: "make the folder" });
  await sleep(1200);
  await t.tool("type_text", { text: "reports", why: "the folder name" });
  await t.tool("press_keys", { keys: ["enter"], why: "name it" });
  await sleep(1000);
  t.check(NodeFS.existsSync(NodePath.join(dir, "reports")), "the folder reports exists on disk");
    await t.tool("click_element", { label: "reports", why: "select the folder to rename" });
  await t.tool("press_keys", { keys: ["f2"], why: "rename the selected folder" });
    await sleep(600);
    await t.tool("type_text", { text: "reports-2026", why: "the new name" });
    await t.tool("press_keys", { keys: ["enter"], why: "rename" });
    await sleep(1000);
    t.check(
      NodeFS.existsSync(NodePath.join(dir, "reports-2026")) &&
        !NodeFS.existsSync(NodePath.join(dir, "reports")),
      "reports became reports-2026 on disk",
    );
  },
);

// 6. Paint: draw a stroke, and check with screenshots that the canvas changed.
await task(
  "paint-draw",
  "Draw a line in Paint and check, from screenshots, that the picture changed",
  async (t) => {
    await t.launch("mspaint.exe", [], "Paint");
    await t.waitTree(/paint/i, 15);
    const before = await host.shot("paint-before");
    await t.tool("drag", { x: 400, y: 380, to_x: 620, to_y: 460, why: "draw a line" });
    await sleep(500);
    const after = await host.shot("paint-after");
    const changed = await changedPixels(before, after);
    t.check(changed > 40, `${changed} sampled pixels changed after the stroke`);
  },
);

// 7. A wrong first try, then re-plan from the tree.
await task(
  "replan-after-wrong-name",
  "Click a menu that does not exist, then re-plan from the tree and open Edit",
  async (t) => {
    await t.launch("notepad.exe", [], "Notepad");
    await t.waitTree(/notepad/i);
    const first = await t.tryTool("click_element", { label: "Modify", why: "guess at the menu" });
    t.check(first === null, "the wrong name was refused rather than clicked");
    const tree = await t.tool("ui_tree");
    const menu =
      tree.split("\n").find((l) => /^menu item: edit\b/i.test(l)) ??
      tree.split("\n").find((l) => /\bedit\b/i.test(l) && /menu/i.test(l));
    t.replan(`read the tree; the menu is called ${menu ?? "(not found)"}`);
    await t.tool("click_element", { label: "Edit", why: "the real menu" });
    const after = await t.tool("ui_tree");
    t.check(/select all|undo|cut/i.test(after), "the Edit menu opened (its items are listed)");
  },
);

// 8. Stop after two identical failures.
await task(
  "stop-after-two-failures",
  "Refuse a third identical failing action, without clicking anything",
  async (t) => {
    await t.launch("notepad.exe", [], "Notepad");
    await t.waitTree(/notepad/i);
    const outcomes: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      try {
        await t.tool("click_element", { label: "Frobnicate", why: "a control that is not there" });
        outcomes.push("clicked");
      } catch (error) {
        outcomes.push((error as Error).message.startsWith("Stopped") ? "stopped" : "no control");
      }
    }
    t.check(
      outcomes.join(",") === "no control,no control,stopped,stopped",
      `outcomes: ${outcomes.join(", ")}`,
    );
  },
);

// 9. A dialog that appears late: close with unsaved text, wait for it, answer it by name.
await task(
  "late-dialog",
  "Close Notepad with unsaved text, wait for the save question, and answer Don't Save",
  async (t) => {
    const pid = await t.launch("notepad.exe", [], "Notepad");
    await t.waitTree(/notepad/i);
    await t.tool("type_text", { text: "unsaved words", why: "something to lose" });
    await t.tool("press_keys", { keys: ["alt", "f4"], why: "close it" });
    const waited = await t.tool("wait_for", { label: "Don't Save", seconds: 10 });
    t.check(
      /is there/.test(waited),
      "the save question appeared and was found by its button's name",
    );
    await t.tool("click_element", { label: "Don't Save", why: "discard" });
    await sleep(1500);
    const alive = await ps(
      `if (Get-Process -Id ${pid} -ErrorAction SilentlyContinue) { 'yes' } else { 'no' }`,
    );
    t.check(alive === "no", "Notepad exited after the answer");
  },
);

// 10. Read back: copy the text out of the app and compare.
await task(
  "clipboard-readback",
  "Type text, select all and copy in Notepad, and read the clipboard back",
  async (t) => {
    await t.launch("notepad.exe", [], "Notepad");
    await t.waitTree(/notepad/i);
    await t.tool("type_text", { text: "alpha beta gamma", why: "the text" });
    await ps("Set-Clipboard -Value 'SENTINEL'");
    await t.tool("press_keys", { keys: ["ctrl", "a"], why: "select all" });
    await t.tool("press_keys", { keys: ["ctrl", "c"], why: "copy" });
  await sleep(1000);
  let clip = await ps("Get-Clipboard -Raw");
  if (clip !== "alpha beta gamma") {
    // The chord did not put the text on the clipboard (it reads "${clip}"): use the menu, by name.
    t.replan(`the clipboard reads "${clip}" after Ctrl+C; copying from the Edit menu instead`);
    await t.tool("click_element", { label: "Edit", why: "open the menu" });
    await t.tool("click_element", { label: "Copy", why: "copy the selection" });
    await sleep(1000);
    clip = await ps("Get-Clipboard -Raw");
  }
  t.check(clip === "alpha beta gamma", `the clipboard holds "${clip}"`);
  },
);

// 11. See: the tree names the control that has the keyboard.
await task(
  "tree-shows-focus",
  "Read the window's controls and find the one with the keyboard",
  async (t) => {
    await t.launch("notepad.exe", [], "Notepad");
    await t.waitTree(/notepad/i);
    const tree = await t.tool("ui_tree");
    const focused = tree.split("\n").find((l) => /\(focused\)/.test(l)) ?? "";
    t.check(focused !== "", `focused line: ${focused || "(none)"}`);
  },
);

// 12. Settings: open a page and read a value from it.
await task(
  "settings-read",
  "Open Settings > About and read the Windows edition name from the page",
  async (t) => {
    await ps("Start-Process 'ms-settings:about'");
    t.steps.push({ kind: "act", text: "start ms-settings:about", ms: 0 });
    await sleep(4000);
    const tree = await t.waitTree(/windows|edition|device/i, 20);
    const line = tree.split("\n").find((l) => /windows (server|10|11)/i.test(l) && !/specification/i.test(l)) ?? "";
    t.check(line !== "", `read from the page: ${line || tree.split("\n").slice(0, 3).join(" | ")}`);
  },
);

// Diagnostic: why did Ctrl+C not copy? Poll the clipboard after each way of asking for a copy.
const poll = (n: number) => ps(`$o = @(); 1..${n} | ForEach-Object { Start-Sleep -Milliseconds 250; $o += '[' + (Get-Clipboard -Raw) + ']' }; $o -join ' '`);
await task("diag-copy", "Diagnose Ctrl+C", async (t) => {
  await t.launch("notepad.exe", [], "Notepad");
  await t.waitTree(/notepad/i);
  await t.tool("type_text", { text: "alpha beta gamma", why: "the text" });
  await sleep(2500);
  const notes: string[] = [];
  const attempt = async (name: string, act: () => Promise<unknown>) => {
    await ps("Set-Clipboard -Value 'SENTINEL'");
    await t.tool("press_keys", { keys: ["ctrl", "a"], why: "select all" });
    await act();
    notes.push(`${name}: ${await poll(8)}`);
  };
  await attempt("ctrl+c", () => t.tool("press_keys", { keys: ["ctrl", "c"], why: "copy" }));
  await attempt("ctrl+c again", () => t.tool("press_keys", { keys: ["ctrl", "c"], why: "copy" }));
  await attempt("ctrl+insert", () => t.tool("press_keys", { keys: ["ctrl", "insert"], why: "copy" }).catch((e) => String(e)));
  await attempt("sendkeys ^c", () => ps("Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^c')"));
  await attempt("ctrl+x", () => t.tool("press_keys", { keys: ["ctrl", "x"], why: "cut" }));
  t.evidence = notes.join(" || ");
  console.log(`DIAG ${t.evidence}`);
});

host.dispose();
const passed = results.filter((r) => r.result === "pass").length;
console.log(`hands-loop: ${passed}/${results.length} passed`);
