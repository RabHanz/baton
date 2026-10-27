// @effect-diagnostics nodeBuiltinImport:off globalTimers:off
/**
 * Drive's mouse and keyboard without a native module (D84): a long-lived PowerShell calling
 * user32 on Windows, xdotool on Linux X11; macOS refuses by name. Windows text is pasted, so
 * every keyboard layout types the right characters.
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeReadline from "node:readline";

export interface InputDriver {
  /** Global desktop point in Electron DIPs. */
  readonly moveTo: (point: { readonly x: number; readonly y: number }) => Promise<void>;
  readonly click: (button: "left" | "right", count: 1 | 2) => Promise<void>;
  readonly mouseDown: () => Promise<void>;
  readonly mouseUp: () => Promise<void>;
  readonly scroll: (amount: number) => Promise<void>;
  readonly press: (keys: ReadonlyArray<string>) => Promise<void>;
  readonly type: (text: string) => Promise<void>;
  readonly dispose: () => void;
}

const VK: Record<string, number> = {
  ctrl: 0x11,
  alt: 0x12,
  shift: 0x10,
  enter: 0x0d,
  tab: 0x09,
  escape: 0x1b,
  backspace: 0x08,
  delete: 0x2e,
  left: 0x25,
  up: 0x26,
  right: 0x27,
  down: 0x28,
  home: 0x24,
  end: 0x23,
  pageup: 0x21,
  pagedown: 0x22,
  space: 0x20,
};

/** Windows virtual-key codes for a chord, in press order. */
export const virtualKeys = (keys: ReadonlyArray<string>): ReadonlyArray<number> =>
  keys.map((key) => {
    const k = key.toLowerCase();
    if (k in VK) return VK[k]!;
    const f = /^f([1-9]|1[0-2])$/.exec(k);
    if (f !== null) return 0x6f + Number(f[1]);
    if (/^[a-z0-9]$/.test(k)) return k.toUpperCase().charCodeAt(0);
    throw new Error(`Baton does not press "${key}".`);
  });

const XDO: Record<string, string> = {
  ctrl: "ctrl",
  alt: "alt",
  shift: "shift",
  enter: "Return",
  tab: "Tab",
  escape: "Escape",
  backspace: "BackSpace",
  delete: "Delete",
  left: "Left",
  right: "Right",
  up: "Up",
  down: "Down",
  home: "Home",
  end: "End",
  pageup: "Prior",
  pagedown: "Next",
  space: "space",
};

/** An xdotool key chord ("ctrl+l"). */
export const xdotoolChord = (keys: ReadonlyArray<string>): string =>
  keys
    .map((key) => {
      const k = key.toLowerCase();
      return XDO[k] ?? (/^f([1-9]|1[0-2])$/.test(k) ? k.toUpperCase() : k);
    })
    .join("+");

export const WINDOWS_INPUT_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type @"
using System; using System.Runtime.InteropServices;
public static class BatonInput {
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr v);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, int d, UIntPtr e);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint f, UIntPtr e);
}
"@
try { [void][BatonInput]::SetProcessDpiAwarenessContext([IntPtr](-4)) } catch {}
$z = [UIntPtr]::Zero
while (($line = [Console]::In.ReadLine()) -ne $null) {
  $p = $line.Split(' ')
  try {
    switch ($p[0]) {
      'move'  { [void][BatonInput]::SetCursorPos([int]$p[1], [int]$p[2]) }
      'down'  { [BatonInput]::mouse_event(0x0002,0,0,0,$z) }
      'up'    { [BatonInput]::mouse_event(0x0004,0,0,0,$z) }
      'rdown' { [BatonInput]::mouse_event(0x0008,0,0,0,$z) }
      'rup'   { [BatonInput]::mouse_event(0x0010,0,0,0,$z) }
      'wheel' { [BatonInput]::mouse_event(0x0800,0,0,[int]$p[1],$z) }
      'keys'  {
        $vks = $p[1].Split(',') | ForEach-Object { [byte][int]$_ }
        foreach ($k in $vks) { [BatonInput]::keybd_event($k,0,0,$z) }
        [array]::Reverse($vks)
        foreach ($k in $vks) { [BatonInput]::keybd_event($k,0,2,$z) }
      }
    }
    [Console]::Out.WriteLine('ok')
  } catch { [Console]::Out.WriteLine('err ' + $_.Exception.Message) }
}
`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A line protocol over a child's stdin/stdout: one command, one "ok". */
const lineProcess = (file: string, args: ReadonlyArray<string>) => {
  const child = NodeChildProcess.spawn(file, [...args], {
    stdio: ["pipe", "pipe", "ignore"],
    windowsHide: true,
  });
  const waiting: Array<(line: string) => void> = [];
  let failure: Error | null = null;
  child.on("error", (e) => (failure = e));
  child.on("exit", () => {
    failure ??= new Error("The input helper stopped.");
    for (const w of waiting.splice(0)) w(`err ${failure.message}`);
  });
  NodeReadline.createInterface({ input: child.stdout }).on("line", (line) =>
    waiting.shift()?.(line),
  );
  let chain: Promise<unknown> = Promise.resolve();
  const send = (command: string): Promise<void> => {
    const turn = chain.then(
      () =>
        new Promise<void>((resolve, reject) => {
          if (failure !== null) return reject(failure);
          waiting.push((line) =>
            line === "ok" ? resolve() : reject(new Error(line.replace(/^err /, ""))),
          );
          child.stdin.write(`${command}\n`);
        }),
    );
    chain = turn.catch(() => undefined);
    return turn;
  };
  return { send, dispose: () => (child.stdin.end(), child.kill()) };
};

const runOnce = (file: string, args: ReadonlyArray<string>): Promise<void> =>
  new Promise((resolve, reject) =>
    NodeChildProcess.execFile(file, [...args], { windowsHide: true }, (error) =>
      error ? reject(error) : resolve(),
    ),
  );

export interface Clipboard {
  readonly readText: () => string | Promise<string>;
  readonly writeText: (text: string) => void | Promise<void>;
}

export const createInputDriver = (input: {
  readonly platform: string;
  /** Electron's `screen.dipToScreenPoint` on Windows; identity elsewhere. */
  readonly toPhysical: (p: { x: number; y: number }) => { x: number; y: number };
  readonly clipboard: Clipboard;
}): InputDriver => {
  const paste = async (text: string, chord: () => Promise<void>) => {
    const previous = await input.clipboard.readText();
    await input.clipboard.writeText(text);
    try {
      await chord();
      await sleep(150);
    } finally {
      // The target reads the clipboard on its own schedule (clipboardInjection.ts: 400 ms).
      setTimeout(() => void input.clipboard.writeText(previous), 400);
    }
  };

  if (input.platform === "win32") {
    const ps = lineProcess("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      WINDOWS_INPUT_SCRIPT,
    ]);
    const keys = (list: ReadonlyArray<string>) => ps.send(`keys ${virtualKeys(list).join(",")}`);
    return {
      moveTo: async (p) => {
        const at = input.toPhysical(p);
        await ps.send(`move ${Math.round(at.x)} ${Math.round(at.y)}`);
      },
      click: async (button, count) => {
        for (let i = 0; i < count; i++) {
          await ps.send(button === "right" ? "rdown" : "down");
          await ps.send(button === "right" ? "rup" : "up");
          if (count > 1) await sleep(60);
        }
      },
      mouseDown: () => ps.send("down"),
      mouseUp: () => ps.send("up"),
      scroll: (amount) => ps.send(`wheel ${Math.round(amount * 120)}`),
      press: keys,
      type: (text) => paste(text, () => keys(["ctrl", "v"])),
      dispose: ps.dispose,
    };
  }

  if (input.platform === "linux") {
    const xdo = (...args: string[]) =>
      runOnce("xdotool", args).catch((error: NodeJS.ErrnoException) => {
        throw error.code === "ENOENT"
          ? new Error("Drive on Linux needs xdotool (and an X11 session).")
          : error;
      });
    return {
      moveTo: (p) => xdo("mousemove", String(Math.round(p.x)), String(Math.round(p.y))),
      click: (button, count) =>
        xdo("click", "--repeat", String(count), "--delay", "60", button === "right" ? "3" : "1"),
      mouseDown: () => xdo("mousedown", "1"),
      mouseUp: () => xdo("mouseup", "1"),
      scroll: async (amount) => {
        for (let i = 0; i < Math.abs(Math.round(amount)); i++)
          await xdo("click", amount > 0 ? "4" : "5");
      },
      press: (list) => xdo("key", "--clearmodifiers", xdotoolChord(list)),
      type: (text) => xdo("type", "--delay", "8", "--", text),
      dispose: () => undefined,
    };
  }

  const refuse = () =>
    Promise.reject(new Error("Drive is built for Windows and Linux; macOS is not wired yet."));
  return {
    moveTo: refuse,
    click: refuse,
    mouseDown: refuse,
    mouseUp: refuse,
    scroll: refuse,
    press: refuse,
    type: refuse,
    dispose: () => undefined,
  };
};
