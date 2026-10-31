/**
 * Screen-context eval on a real capture of his desktop, with the real prompts and his claude. It
 * scores whether the answer comes from what is on screen, whether a pointer lands on the thing,
 * and whether an absent thing is called absent. Keep it as a regression check.
 *   node screen-eval.mjs --image shot.jpg --width W --height H --arm after --out result.jsonl
 * Boxes are in the coordinates of a 1400 px wide view of the 3840x2160 capture.
 */
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { startVisionSession } from "../../../apps/desktop/src/baton/screen/claudeVision.ts";
import {
  ASSISTANT_PROMPT_INTRO,
  BRAIN_ROUTER_PROMPT,
  parseBrainReply,
  buildBrainTurn,
} from "../../../packages/baton-shared/src/brain.ts";
import {
  LOOK_PROMPT,
  parseReply,
  pointable,
} from "../../../packages/baton-shared/src/screenCompanion.ts";

interface Case {
  readonly said: string;
  /** "point": the box holds the target. "absent": must say it is not there. "read": answer holds text. */
  readonly kind: "point" | "absent" | "read";
  readonly box?: readonly [number, number, number, number];
  readonly contains?: string;
}

export const CASES: ReadonlyArray<Case> = [
  // Case 1 is the Director's: the word is on screen in a chat, the button is not.
  { said: "where is the export button", kind: "absent" },
  { said: "where's the print button", kind: "absent" },
  { said: "is there a save button on here", kind: "absent" },
  { said: "where's the dark mode toggle", kind: "absent" },
  { said: "show me the delete account option", kind: "absent" },
  { said: "where's the Open diff button", kind: "point", box: [950, 116, 1004, 130] },
  { said: "where's the search box", kind: "point", box: [6, 32, 100, 50] },
  { said: "where's the send button", kind: "point", box: [986, 717, 1012, 743] },
  { said: "where's the settings cog", kind: "point", box: [7, 737, 23, 753] },
  { said: "where's the Stop button", kind: "point", box: [702, 641, 726, 655] },
  { said: "where's Chrome on the taskbar", kind: "point", box: [452, 763, 472, 783] },
  { said: "where's VS Code on the taskbar", kind: "point", box: [480, 763, 500, 783] },
  { said: "where's the Windows start button", kind: "point", box: [367, 763, 387, 783] },
  { said: "where's the paperclip", kind: "point", box: [553, 722, 569, 738] },
  { said: "where's the waiting label", kind: "point", box: [94, 181, 142, 195] },
  { said: "which project is this thread in", kind: "read", contains: "ventureos" },
  { said: "how many projects does it say I've got", kind: "read", contains: "10" },
  { said: "what time does the clock say", kind: "read", contains: "6:12" },
  { said: "what's the date down in the corner", kind: "read", contains: "31" },
  { said: "which account am I on, top right", kind: "read", contains: "rabee" },
  { said: "what's the file name in that changed file box", kind: "read", contains: "auto-repair" },
  { said: "what's the second numbered heading say", kind: "read", contains: "coordinates" },
  { said: "what's the last sentence above the input box", kind: "read", contains: "polish" },
  { said: "what language does the taskbar show", kind: "read", contains: "eng" },
];

const flag = (name: string): string => process.argv[process.argv.indexOf(name) + 1]!;
const SAID_ABSENT = /\b(?:can'?t see|cannot see|don'?t see|do not see|isn'?t|is not|not (?:on|visible)|no\s+\w*\s*(?:button|option|toggle)|there'?s no|couldn'?t find)\b/i;

const main = async () => {
  const arm = flag("--arm");
  const width = Number(flag("--width"));
  const height = Number(flag("--height"));
  const image = NodeFS.readFileSync(flag("--image"));
  const workDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "baton-eval-"));
  const base = { claudeBinary: "claude", workDir, env: process.env, platform: process.platform };
  const after = arm === "after";
  const prompt = after
    ? `${ASSISTANT_PROMPT_INTRO}\n\n${LOOK_PROMPT}`
    : NodeFS.readFileSync(flag("--before-prompt"), "utf8");
  const focused = "baton.exe: Baton (Beta)";
  const out = NodeFS.createWriteStream(flag("--out"));
  let router = startVisionSession({ ...base, model: "haiku", systemPrompt: BRAIN_ROUTER_PROMPT });
  const scale = width / 1400;
  for (const test of CASES) {
    const turn = buildBrainTurn({
      said: test.said,
      running: null,
      direct: false,
      recent: [],
      focused: after ? focused : null,
    });
    const routed = await router
      .ask([{ type: "text", text: turn }])
      .then(parseBrainReply)
      .catch(() => {
        router = startVisionSession({
          ...base,
          model: "haiku",
          systemPrompt: BRAIN_ROUTER_PROMPT,
        });
        return null;
      });
    const vision = startVisionSession({ ...base, model: "sonnet", systemPrompt: prompt });
    const label = `user's screen (${after ? "the window he is using" : "cursor"} is here), image ${width}x${height}`;
    const started = Date.now();
    const raw = await vision
      .ask([
      { type: "text", text: label },
      { type: "image", mediaType: "image/jpeg", data: image },
      {
        type: "text",
        text: after ? `${test.said}\n\n(the window he is using: ${focused})` : test.said,
      },
    ])
      .catch((error: Error) => `[failed: ${error.message}]`);
    vision.dispose();
    const reply = parseReply(raw);
    const flies = after ? pointable(reply.point) : reply.point !== null;
    let good: boolean;
    let missPx: number | null = null;
    if (test.kind === "absent") good = !flies && SAID_ABSENT.test(reply.spoken);
    else if (test.kind === "read") good = reply.spoken.toLowerCase().includes(test.contains!);
    else {
      const [l, t, r, b] = test.box!.map((v) => v * scale) as [number, number, number, number];
      const p = reply.point;
      good = flies && p !== null && p.x >= l && p.x <= r && p.y >= t && p.y <= b;
      if (p !== null) {
        const toFull = 3840 / width;
        const dx = Math.max(l - p.x, 0, p.x - r) * toFull;
        const dy = Math.max(t - p.y, 0, p.y - b) * toFull;
        missPx = Math.round(Math.hypot(dx, dy));
      }
    }
    out.write(
      `${JSON.stringify({
        said: test.said,
        kind: test.kind,
        route: routed?.route ?? null,
        good,
        flies,
        confidence: reply.point?.confidence ?? null,
        label: reply.point?.label ?? null,
        missPx,
        ms: Date.now() - started,
        spoken: reply.spoken.slice(0, 160),
      })}\n`,
    );
  }
  router.dispose();
  out.end();
};

await main();
process.exit(0);
