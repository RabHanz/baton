// A stand-in for `claude` on a CI runner (no model login exists there): it speaks the same stream-json lines the
// companion reads and answers teach turns from a script (scenarios.json, picked by PROOF_SCENARIO; with
// none, the single Notepad font-size script below). Controls are found by name through the real UI Automation
// sidecar (SIDECAR) at answer time, so the pointer lands on the real control.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeReadline from "node:readline";

const SCREEN_W = Number(process.env["PROOF_SCREEN_W"] ?? 1024);

const LOCATE = `$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes,System.Windows.Forms
$root=[System.Windows.Automation.AutomationElement]::RootElement
$cond=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty,$env:LOC_NAME)
for($i=0;$i -lt 20;$i++){
  $e=$root.FindFirst([System.Windows.Automation.TreeScope]::Descendants,$cond)
  if($e -ne $null){$r=$e.Current.BoundingRectangle;if(-not $r.IsEmpty -and $r.Width -gt 0){
    $b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    @{x=[int]($r.X+$r.Width/2);y=[int]($r.Y+$r.Height/2);w=[int]$r.Width;h=[int]$r.Height;sw=$b.Width;sh=$b.Height}|ConvertTo-Json -Compress;exit 0}}
  Start-Sleep -Milliseconds 300}
exit 1`;

// Notepad is moved to 120,90 on a 1024x768 runner desktop: where its menu bar sits when nothing else can say.
const FALLBACK = { Format: { x: 219, y: 130, w: 40, h: 20, sw: 1024, sh: 768 } };

const psLocate = (name) => {
  try {
    const out = NodeChildProcess.execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-STA", "-Command", LOCATE],
      {
        env: { ...process.env, LOC_NAME: name },
        encoding: "utf8",
        timeout: 20_000,
        windowsHide: true,
      },
    );
    return JSON.parse(out.trim());
  } catch {
    return FALLBACK[name] ?? null;
  }
};

/** The sidecar looks in the window with the keyboard, and in the menus and dialogs of the same process. */
const sidecarLocate = (name, attempts = 3) => {
  const exe = process.env["SIDECAR"];
  if (!exe) return null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const out = NodeChildProcess.execFileSync(
        exe,
        ["locate", "--label", name, "--x", "0", "--y", "0", "--foreground"],
        {
          encoding: "utf8",
          timeout: 20_000,
          windowsHide: true,
        },
      );
      const found = JSON.parse(out.trim().split("\n").at(-1));
      if (found.found)
        return { x: found.x, y: found.y, w: found.width, h: found.height, sw: SCREEN_W };
    } catch {
      /* try again */
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 700);
  }
  return null;
};

/** "A|B|C": the first name the window has; Calculator's buttons are named differently on different Windows. */
export const locate = (names) => {
  const list = names.split("|");
  for (const [i, name] of list.entries()) {
    // Only the last name is worth waiting for: the others are guesses at what this Windows calls the control.
    const found =
      sidecarLocate(name, i === list.length - 1 ? 3 : 1) ??
      (process.env["SIDECAR"] ? null : psLocate(name));
    if (found !== null) return found;
  }
  return null;
};

if (process.argv[2] === "--locate") {
  console.log(JSON.stringify(locate(process.argv[3] ?? "")));
  process.exit(0);
}

const scenario =
  (process.env["PROOF_SCENARIO"] ?? "") === ""
    ? null
    : JSON.parse(NodeFS.readFileSync(new URL("./scenarios.json", import.meta.url), "utf8")).find(
        (x) => x.id === process.env["PROOF_SCENARIO"],
      );
const SIZE = process.env["PROOF_TEACH_SIZE"] ?? "16";

const toShot = (spot, text) => {
  const dims = /image dimensions:\s*(\d+)x(\d+)/i.exec(text);
  const scale = dims && spot ? Number(dims[1]) / spot.sw : 1;
  return spot ? { x: Math.round(spot.x * scale), y: Math.round(spot.y * scale) } : null;
};
const point = (name, label, text) => {
  const at = name === null ? null : toShot(locate(name), text);
  return at ? `[POINT:${at.x},${at.y}:${label}:0.95]` : "[POINT:none]";
};

let turn = 0;
const answerScenario = (text) => {
  const step = scenario.steps[turn - 1];
  if (step === undefined) return `${scenario.done} [DONE]`;
  return `${step.say} ${point(step.point, step.point ?? "here", text)}`;
};

const answer = (text) => {
  turn += 1;
  if (scenario !== null) return answerScenario(text);
  if (turn === 1) return `Open the Format menu. ${point("Format", "Format", text)}`;
  if (turn === 2) return `Choose Font. ${point("Font...", "Font", text)}`;
  if (turn === 3)
    return `Set the size to ${SIZE}, then press Enter. ${point("Size:", "Size", text)}`;
  return `All done, the text is now ${SIZE} point. [DONE]`;
};

NodeReadline.createInterface({ input: process.stdin }).on("line", (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (message.type !== "user") return;
  const text = (message.message?.content ?? [])
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");
  const result = answer(text);
  process.stdout.write(
    `${JSON.stringify({ type: "result", subtype: "success", is_error: false, result })}\n`,
  );
});
