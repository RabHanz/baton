// A stand-in for `claude` on a CI runner (no model login exists there): it speaks the same stream-json lines the
// companion reads and answers teach and drive turns from a script, finding Notepad's controls through UI Automation
// at answer time so the pointer lands on the real control. Also `node fake-claude.mjs --locate "<name>"` for the harness.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeReadline from "node:readline";

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

// Notepad is moved to 120,90 on a 1024x768 runner desktop: where its menu bar sits when UI Automation cannot say.
const FALLBACK = { Format: { x: 219, y: 130, w: 40, h: 20, sw: 1024, sh: 768 } };

export const locate = (name) => {
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
  } catch (error) {
    process.stderr.write(
      `locate ${name} failed: ${String(error.stderr ?? error.message).slice(0, 300)}\n`,
    );
    return FALLBACK[name] ?? null;
  }
};

if (process.argv[2] === "--locate") {
  console.log(JSON.stringify(locate(process.argv[3] ?? "")));
  process.exit(0);
}

const flag = (name) => process.argv[process.argv.indexOf(name) + 1];
const system = NodeFS.readFileSync(flag("--system-prompt-file"), "utf8");
const mode = /drive mode/i.test(system) ? "drive" : "teach";
const SIZE = process.env["PROOF_TEACH_SIZE"] ?? "16";
const DRIVE_SIZE = process.env["PROOF_DRIVE_SIZE"] ?? "20";

const toShot = (spot, text) => {
  const dims = /image dimensions:\s*(\d+)x(\d+)/i.exec(text);
  const scale = dims && spot ? Number(dims[1]) / spot.sw : 1;
  return spot ? { x: Math.round(spot.x * scale), y: Math.round(spot.y * scale) } : null;
};
const point = (name, label, text) => {
  const at = toShot(locate(name), text);
  return at ? `[POINT:${at.x},${at.y}:${label}:0.95]` : "[POINT:none]";
};

let turn = 0;
const answer = (text) => {
  turn += 1;
  const imageText = text;
  if (mode === "teach") {
    if (turn === 1) return `Open the Format menu. ${point("Format", "Format", imageText)}`;
    if (turn === 2) return `Choose Font. ${point("Font...", "Font", imageText)}`;
    if (turn === 3)
      return `Set the size to ${SIZE}, then press Enter. ${point("Size:", "Size", imageText)}`;
    return `All done, the text is now ${SIZE} point. [DONE]`;
  }
  if (/just ran/i.test(text)) return "[OK]";
  const format = toShot(locate("Format"), imageText) ?? { x: 100, y: 60 };
  const plan = {
    title: `Set the font size to ${DRIVE_SIZE}`,
    actions: [
      { kind: "click", ...format, why: "Format menu", expect: "The Format menu is open" },
      { kind: "press", keys: ["f"], why: "Font", expect: "The Font dialog is open" },
      { kind: "wait", seconds: 1 },
      { kind: "press", keys: ["alt", "s"], why: "Size box" },
      { kind: "type", text: DRIVE_SIZE, why: `Size ${DRIVE_SIZE}` },
      { kind: "press", keys: ["enter"], why: "OK", expect: "The Font dialog is closed" },
    ],
  };
  return `I can see Notepad's Format menu. I'll set the font size to ${DRIVE_SIZE}.\n\n\`\`\`baton-drive\n${JSON.stringify(plan)}\n\`\`\``;
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
