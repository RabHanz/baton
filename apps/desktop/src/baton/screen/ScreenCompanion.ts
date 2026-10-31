// @effect-diagnostics globalDate:off globalTimers:off nodeBuiltinImport:off
/**
 * The assistant (D84, D100): answers, look, teach and drive, by voice or from the ask box. The one
 * brain decides which; every capture still needs his yes (once, an hour, this lesson, or always)
 * and every drive plan its own Run it. How each mode runs is in docs/baton/DECISIONS.md.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import {
  ASSISTANT_PROMPT_INTRO,
  BRAIN_ROUTER_PROMPT,
  decide,
  makeSentenceStream,
  type BrainDecision,
} from "@t3tools/baton-shared/brain";
import {
  DRIVE_PROMPT,
  LOOK_PROMPT,
  TEACH_PROMPT,
  describeAction,
  describeDrivePlan,
  needsCaptureApproval,
  parseReply,
  parseVerify,
  planFromReply,
  runDrivePlan,
  screenDifference,
  screenLabel,
  shotFor,
  teachTurn,
  toDesktop,
  verifyQuestion,
  type CaptureApproval,
  type DrivePlan,
  type ScreenMode,
  type ScreenShot,
} from "@t3tools/baton-shared/screenCompanion";
import * as Electron from "electron";

import { startVisionSession, type VisionContent, type VisionSession } from "./claudeVision.ts";
import { createInputDriver } from "./inputDriver.ts";
import { createPointerOverlay, type OverlayMarker } from "./pointerOverlay.ts";
import { captureScreens, screenFingerprint, type CapturedScreen } from "./screenCapture.ts";

// F5 to F8 are voice and dictation, and Airdeck has F9 to F12.
export const ASK_HOTKEY = "Control+Alt+Shift+B";

interface ScreenSettings {
  readonly captureApproval: CaptureApproval;
  /** His `claude` binary; on PATH by default. */
  readonly claudeBinary: string;
  /** A family alias, so it follows the newest model he has. Answers, teaching and driving. */
  readonly model: string;
  /** The alias that routes: every sentence, so the fast one. */
  readonly routerModel: string;
  readonly speak: boolean;
}

const DEFAULTS: ScreenSettings = {
  captureApproval: "ask",
  claudeBinary: "claude",
  model: "sonnet",
  routerModel: "haiku",
  speak: true,
};

const LOOK_MEMORY_MS = 15 * 60_000;
const ROUTER_IDLE_MS = 15 * 60_000;
/** A router this slow has already lost; the word rules answer instead. */
const ROUTER_TIMEOUT_MS = 20_000;
const RECENT_LINES = 8;
const TEACH_MAX_STEPS = 30;
const TEACH_IDLE_MS = 10 * 60_000;
/**
 * Share of a 320 px thumbnail that must change for a step to count as done. Measured under Xvfb:
 * a typed name 0.05 %, a line of result text 0.15 %, the text caret blinking 0.006 %.
 */
const CHANGED = 0.00025;
/** ...and the most two polls may differ for the screen to count as settled. */
const SETTLED = 0.0001;
/** Grey-level change that counts at thumbnail scale, where a line of text is a faint smudge. */
const PIXEL = 8;
/** A drive plan made from a screen that has since changed this much is refused. */
const STALE = 0.06;

/** What Baton can do beyond talking, supplied by the voice side. */
export interface AssistantActions {
  /** A command through the intent path and all its guards; the reply to speak. */
  readonly act: (command: string) => Promise<string>;
  readonly grammarPlaces: (said: string) => Promise<boolean>;
}

/** One turn's timings in ms, for the report. Words are never written here. */
export interface TurnTimings {
  readonly route: string;
  readonly source: string;
  readonly decideMs: number;
  readonly firstSentenceMs: number | null;
  readonly totalMs: number;
}

export interface ScreenCompanion {
  /** Decide what was said and carry it out. "act" comes back for the caller's own guards. */
  readonly said: (
    text: string,
    input: { readonly direct: boolean },
  ) => Promise<
    | { readonly kind: "act"; readonly text: string }
    | { readonly kind: "handled" }
    | { readonly kind: "refused"; readonly reply: string }
  >;
  readonly setActions: (actions: AssistantActions) => void;
  /** A lesson or a drive is running. */
  readonly active: () => boolean;
  readonly openAskBox: () => void;
  readonly stop: () => void;
  readonly menuItems: () => ReadonlyArray<Electron.MenuItemConstructorOptions>;
  readonly dispose: () => void;
}

type Run =
  | { readonly mode: "look"; readonly vision: VisionSession; lastAt: number }
  | {
      readonly mode: "teach";
      readonly vision: VisionSession;
      readonly goal: string;
      step: number;
      lastSpoken: string;
      watcher: ReturnType<typeof setInterval> | null;
      idle: ReturnType<typeof setTimeout> | null;
      busy: boolean;
    }
  | {
      readonly mode: "drive";
      readonly vision: VisionSession;
      cancelled: boolean;
      lastSpoken: string;
    };

const LOOK_REPLY = "[LOOK]";

const ASK_DOCUMENT = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;background:transparent;font:15px system-ui,-apple-system,"Segoe UI",sans-serif}
form{display:flex;flex-direction:column;gap:6px;margin:8px;padding:12px 14px;border-radius:14px;background:rgba(17,17,20,.94);box-shadow:0 10px 30px rgba(0,0,0,.45)}
input{all:unset;color:#f4f4f5;font-size:16px;padding:4px 0}
input::placeholder{color:#71717a}
small{color:#a1a1aa;font-size:12px}
b{color:#8db8ff;font-weight:600}
</style></head><body><form id="f"><input id="q" autofocus placeholder="Ask Baton anything…" aria-label="Ask Baton anything"><small><b>Enter</b> ask · <b>Esc</b> close</small></form>
<script>const {ipcRenderer}=require('electron');const q=document.getElementById('q');
document.getElementById('f').onsubmit=e=>{e.preventDefault();ipcRenderer.send('baton-screen:ask',q.value);};
addEventListener('keydown',e=>{if(e.key==='Escape')ipcRenderer.send('baton-screen:ask','');});</script></body></html>`;

export const startScreenCompanion = (input: {
  readonly stateDir: string;
  readonly platform: string;
  readonly env: NodeJS.ProcessEnv;
  /** Baton's one voice, injected so this module never loads the voice models. */
  readonly speak: (text: string) => Promise<void>;
  /** A turn finished with nothing further coming, for the cue after a wake word. */
  readonly onTurnEnd?: () => void;
  readonly onTimings?: (timings: TurnTimings) => void;
  /** Lets the voice tray show the companion's own entries. */
  readonly onChange?: () => void;
}): ScreenCompanion => {
  const settingsPath = NodePath.join(input.stateDir, "baton-screen.json");
  const read = (): ScreenSettings => {
    try {
      return { ...DEFAULTS, ...JSON.parse(NodeFS.readFileSync(settingsPath, "utf8")) };
    } catch {
      return DEFAULTS;
    }
  };
  let settings = read();
  const save = (next: Partial<ScreenSettings>) => {
    settings = { ...settings, ...next };
    NodeFS.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    input.onChange?.();
  };

  const overlay = createPointerOverlay(input.platform);
  let speaking: Promise<void> = Promise.resolve();
  const say = (text: string) => {
    if (!settings.speak || text.trim().length === 0) return;
    speaking = speaking.then(() => input.speak(text).catch(() => undefined));
  };
  let driver: ReturnType<typeof createInputDriver> | null = null;
  let run: Run | null = null;
  let allowedUntil = 0;
  let clearTimer: ReturnType<typeof setTimeout> | null = null;

  let actions: AssistantActions | null = null;
  const recent: string[] = [];
  const remember = (line: string) => {
    recent.push(line.slice(0, 300));
    recent.splice(0, Math.max(0, recent.length - RECENT_LINES));
  };

  const session = (model: string, systemPrompt: string, timeoutMs?: number): VisionSession =>
    startVisionSession({
      claudeBinary: settings.claudeBinary,
      model,
      systemPrompt,
      workDir: NodePath.join(input.stateDir, "screen"),
      env: input.env,
      platform: input.platform,
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    });

  // Kept warm between sentences: a cold start costs 2 s more, and it holds no conversation of use.
  let router: VisionSession | null = null;
  let routerIdle: ReturnType<typeof setTimeout> | null = null;
  const dropRouter = () => {
    router?.dispose();
    router = null;
  };
  const routerAsk = async (turn: string): Promise<string> => {
    router ??= session(settings.routerModel, BRAIN_ROUTER_PROMPT, ROUTER_TIMEOUT_MS);
    if (routerIdle !== null) clearTimeout(routerIdle);
    routerIdle = setTimeout(dropRouter, ROUTER_IDLE_MS);
    try {
      return await router.ask([{ type: "text", text: turn }]);
    } catch (error) {
      dropRouter();
      throw error;
    }
  };

  const visionFor = (mode: ScreenMode): VisionSession =>
    startVisionSession({
      claudeBinary: settings.claudeBinary,
      model: settings.model,
      systemPrompt:
        mode === "look"
          ? `${ASSISTANT_PROMPT_INTRO}\n\n${LOOK_PROMPT}`
          : mode === "teach"
            ? TEACH_PROMPT
            : DRIVE_PROMPT,
      workDir: NodePath.join(input.stateDir, "screen"),
      env: input.env,
      platform: input.platform,
    });

  const clearLater = (ms: number) => {
    if (clearTimer !== null) clearTimeout(clearTimer);
    clearTimer = setTimeout(() => void overlay.clear(), ms);
  };
  const show = async (kicker: string, text: string, hint = "") => {
    if (clearTimer !== null) clearTimeout(clearTimer);
    await overlay.card(kicker, text, hint);
  };

  /** His yes for a capture, or false. `forWhat` names the lesson or drive the yes covers. */
  const approveCapture = async (question: string, forWhat: string | null): Promise<boolean> => {
    if (
      !needsCaptureApproval({
        policy: settings.captureApproval,
        allowedUntil,
        sessionApproved: false,
        now: Date.now(),
      })
    )
      return true;
    const { response } = await Electron.dialog.showMessageBox({
      type: "question",
      title: "Baton",
      message: "Let Baton see your screen?",
      detail: `To answer: “${question}”\n\n${forWhat === null ? "One screenshot of each display goes to Claude on your subscription." : `Screenshots are taken during this ${forWhat}, after each step, until it ends.`} Nothing is stored after the answer.`,
      buttons: [
        forWhat === null ? "Allow" : `Allow for this ${forWhat}`,
        "Allow for an hour",
        "Always allow",
        "Cancel",
      ],
      defaultId: 0,
      cancelId: 3,
      noLink: true,
    });
    if (response === 1) allowedUntil = Date.now() + 60 * 60_000;
    if (response === 2) save({ captureApproval: "always" });
    // The box must be off the screen before the screenshot is taken.
    await new Promise((r) => setTimeout(r, 300));
    return response !== 3;
  };

  const capture = (): Promise<ReadonlyArray<CapturedScreen>> => overlay.hiddenFor(captureScreens);
  const fingerprint = (): Promise<Uint8Array> => overlay.hiddenFor(screenFingerprint);

  const content = (
    captured: ReadonlyArray<CapturedScreen>,
    text: string,
  ): ReadonlyArray<VisionContent> => [
    ...captured.flatMap(({ shot, jpeg }): VisionContent[] => [
      { type: "text", text: screenLabel(shot, captured.length) },
      { type: "image", mediaType: "image/jpeg", data: jpeg },
    ]),
    { type: "text", text },
  ];

  const pointAt = async (
    point: ReturnType<typeof parseReply>["point"],
    shots: ReadonlyArray<ScreenShot>,
  ): Promise<void> => {
    if (point === null) return;
    const shot = shotFor(shots, point.screen);
    if (shot !== null) await overlay.point(toDesktop(point, shot), point.label);
  };

  const fail = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    void show("Baton", message);
    say(message);
    clearLater(8000);
    end();
  };

  const end = () => {
    const current = run;
    run = null;
    if (current === null) return;
    if (current.mode === "teach") {
      if (current.watcher !== null) clearInterval(current.watcher);
      if (current.idle !== null) clearTimeout(current.idle);
    }
    if (current.mode === "drive") {
      current.cancelled = true;
      Electron.globalShortcut.unregister("Escape");
    }
    current.vision.dispose();
    input.onChange?.();
  };

  /** One conversation for answers and looks, so a follow-up keeps its thread either way. */
  const answer = async (question: string, withScreen: boolean, firstSentence: () => void) => {
    if (run?.mode !== "look" || Date.now() - run.lastAt > LOOK_MEMORY_MS) {
      end();
      run = { mode: "look", vision: visionFor("look"), lastAt: Date.now() };
    }
    const current = run;
    const stream = makeSentenceStream();
    let spoken = 0;
    const speakAsItComes = (delta: string) => {
      for (const sentence of stream.feed(delta)) {
        if (spoken === 0) firstSentence();
        spoken += 1;
        say(sentence);
      }
    };
    const ask = async (
      screen: boolean,
    ): Promise<{ raw: string; shots: ReadonlyArray<ScreenShot> }> => {
      if (screen && !(await approveCapture(question, null))) {
        return { raw: "", shots: [] };
      }
      await show(screen ? "Looking…" : "Thinking…", question);
      const captured = screen ? await capture() : [];
      const raw = await current.vision.ask(content(captured, question), speakAsItComes);
      return { raw, shots: captured.map((c) => c.shot) };
    };
    let turn = await ask(withScreen);
    // The model found it needs to see the screen after all.
    if (!withScreen && turn.raw.trim() === LOOK_REPLY) turn = await ask(true);
    current.lastAt = Date.now();
    if (turn.raw.length === 0) {
      say("All right, I won't look.");
      return void (await overlay.clear());
    }
    const reply = parseReply(turn.raw);
    const rest = stream.flush();
    if (rest.length > 0) {
      if (spoken === 0) firstSentence();
      say(rest);
    }
    remember(`He said: ${question}`);
    remember(`You answered: ${reply.spoken}`);
    await show("Baton", reply.spoken);
    await pointAt(reply.point, turn.shots);
    clearLater(Math.max(8000, reply.spoken.length * 70));
  };

  const teachStep = async (note?: string) => {
    if (run?.mode !== "teach" || run.busy) return;
    const lesson = run;
    lesson.busy = true;
    if (lesson.watcher !== null) clearInterval(lesson.watcher);
    lesson.watcher = null;
    try {
      if (lesson.step >= TEACH_MAX_STEPS) {
        say("That's a long lesson. Let's stop here; ask again to pick it up.");
        return end();
      }
      lesson.step += 1;
      await show(`Step ${lesson.step}`, "Looking at your screen…");
      const captured = await capture();
      // What this step was judged against: any change from here on is his doing.
      const baseline = await fingerprint();
      const shots = captured.map((c) => c.shot);
      const reply = parseReply(
        await lesson.vision.ask(
          content(
            captured,
            teachTurn({ goal: lesson.goal, step: lesson.step, ...(note ? { note } : {}) }),
          ),
        ),
      );
      if (run !== lesson) return;
      lesson.lastSpoken = reply.spoken;
      if (reply.done) {
        await overlay.clear();
        await show("Done", reply.spoken);
        say(reply.spoken);
        clearLater(10_000);
        return end();
      }
      await show(
        `Step ${lesson.step}`,
        reply.spoken,
        "Do it and I'll notice, or say “next”. “Stop” ends the lesson.",
      );
      await pointAt(reply.point, shots);
      say(reply.spoken);
      watch(lesson, baseline);
    } finally {
      lesson.busy = false;
    }
  };

  /** Waits for the screen to change and settle, then checks it and gives the next step. */
  const watch = (lesson: Extract<Run, { mode: "teach" }>, baseline: Uint8Array) => {
    if (lesson.idle !== null) clearTimeout(lesson.idle);
    lesson.idle = setTimeout(() => {
      if (run === lesson) {
        say("I'll stop the lesson here. Ask again whenever you want to carry on.");
        end();
      }
    }, TEACH_IDLE_MS);
    let previous: Uint8Array | null = null;
    let moved = false;
    let still = 0;
    let polling = false;
    // The pointer's flight and the speech settle first.
    const startAt = Date.now() + 1500;
    lesson.watcher = setInterval(() => {
      if (polling || Date.now() < startAt || run !== lesson || lesson.busy) return;
      polling = true;
      void fingerprint()
        .then((now) => {
          if (!moved && screenDifference(baseline, now, PIXEL) > CHANGED) moved = true;
          else if (moved && previous !== null) {
            // Two quiet polls (~2 s), so a pause between typed words is not "done".
            still = screenDifference(previous, now, PIXEL) < SETTLED ? still + 1 : 0;
            if (still >= 2) void teachStep("the screen just changed.").catch(fail);
          }
          previous = now;
        })
        .catch(() => undefined)
        .finally(() => (polling = false));
    }, 900);
  };

  const teach = async (goal: string) => {
    if (!(await approveCapture(goal, "lesson"))) return;
    end();
    run = {
      mode: "teach",
      vision: visionFor("teach"),
      goal,
      step: 0,
      lastSpoken: "",
      watcher: null,
      idle: null,
      busy: false,
    };
    input.onChange?.();
    await teachStep();
  };

  const drive = async (goal: string) => {
    if (!(await approveCapture(goal, "drive"))) return;
    end();
    const current: Extract<Run, { mode: "drive" }> = {
      mode: "drive",
      vision: visionFor("drive"),
      cancelled: false,
      lastSpoken: "",
    };
    run = current;
    input.onChange?.();
    await show("Planning…", goal);
    const captured = await capture();
    const shots = captured.map((c) => c.shot);
    const before = await fingerprint();
    const reply = parseReply(await current.vision.ask(content(captured, goal)));
    if (run !== current) return;
    const parsed = planFromReply(reply, shots);
    if ("error" in parsed) {
      await show("Baton", parsed.error);
      say(parsed.error);
      clearLater(10_000);
      return end();
    }
    const plan = parsed.plan;
    current.lastSpoken = reply.spoken;
    const marks = planMarkers(plan, shots);
    await overlay.markers(marks);
    await show(plan.title, describeDrivePlan(plan), "Waiting for your approval.");
    say(reply.spoken);
    const { response } = await Electron.dialog.showMessageBox({
      type: "question",
      title: "Baton Drive",
      message: plan.title,
      detail: `${reply.spoken}\n\n${describeDrivePlan(plan)}\n\nThe numbered dots on screen are where it will click. Esc, “stop”, or moving the mouse stops it.`,
      buttons: ["Run it", "Cancel"],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    if (response !== 0 || run !== current) {
      await overlay.clear();
      return end();
    }
    await new Promise((r) => setTimeout(r, 350)); // the dialog leaves the screen first
    if (screenDifference(before, await fingerprint()) > STALE) {
      const message = "The screen changed since I made the plan, so I didn't run it. Ask again.";
      await show("Baton Drive", message);
      say(message);
      clearLater(8000);
      return end();
    }
    Electron.globalShortcut.register("Escape", () => (current.cancelled = true));
    driver ??= createInputDriver({
      platform: input.platform,
      toPhysical: (p) => (input.platform === "win32" ? Electron.screen.dipToScreenPoint(p) : p),
      clipboard: Electron.clipboard,
    });
    const d = driver;
    const result = await runDrivePlan(plan, shots, {
      moveTo: d.moveTo,
      click: d.click,
      mouseDown: d.mouseDown,
      mouseUp: d.mouseUp,
      scroll: d.scroll,
      type: d.type,
      press: d.press,
      cursor: () => Electron.screen.getCursorScreenPoint(),
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      cancelled: () => current.cancelled || run !== current,
      progress: (i, action) => {
        void overlay.markers(
          marks.map((m): OverlayMarker =>
            m.n - 1 < i ? { ...m, state: "done" } : m.n - 1 === i ? { ...m, state: "now" } : m,
          ),
        );
        void show(
          `Step ${i + 1} of ${plan.actions.length}`,
          describeAction(action),
          "Esc stops it.",
        );
      },
      verify: async (action, i) => {
        const now = await capture();
        return parseVerify(
          await current.vision.ask(content(now, verifyQuestion(action, i, plan.actions.length))),
        );
      },
    }).catch((error: unknown) => ({
      kind: "stopped" as const,
      step: -1,
      reason: (error as Error).message,
    }));
    const message = result.kind === "finished" ? "Done. Have a look." : result.reason;
    await overlay.markers([]);
    await show("Baton Drive", message);
    say(message);
    clearLater(8000);
    end();
  };

  const planMarkers = (plan: DrivePlan, shots: ReadonlyArray<ScreenShot>) =>
    plan.actions.flatMap((action, i) => {
      if (!("x" in action)) return [];
      const shot = shotFor(shots, action.screen ?? null);
      return shot === null ? [] : [{ ...toDesktop(action, shot), n: i + 1 }];
    });

  const runningMode = (): string | null => (run !== null && run.mode !== "look" ? run.mode : null);

  const decideSaid = (text: string, direct: boolean): Promise<BrainDecision> =>
    decide(
      text,
      { running: runningMode(), direct, recent },
      {
        ask: routerAsk,
        grammarPlaces: (said) => actions?.grammarPlaces(said) ?? Promise.resolve(false),
      },
    );

  const perform = (decision: BrainDecision, started: number, decidedAt: number) => {
    let firstAt: number | null = null;
    const finished = () => {
      input.onTimings?.({
        route: decision.route,
        source: decision.source,
        decideMs: decidedAt - started,
        firstSentenceMs: firstAt === null ? null : firstAt - started,
        totalMs: Date.now() - started,
      });
      input.onTurnEnd?.();
    };
    const go = (): Promise<void> => {
      switch (decision.route) {
        case "answer":
          return answer(decision.text, false, () => (firstAt ??= Date.now()));
        case "look":
          return answer(decision.text, true, () => (firstAt ??= Date.now()));
        case "teach":
          return teach(decision.text);
        case "drive":
          return drive(decision.text);
        case "clarify":
          firstAt = Date.now();
          remember(`You asked him: ${decision.text}`);
          say(decision.text);
          void show("Baton", decision.text);
          clearLater(8000);
          return Promise.resolve();
        case "control":
          if (decision.control === "next") {
            return run?.mode === "teach" ? teachStep("he says he did it.") : Promise.resolve();
          }
          if (decision.control === "repeat") {
            if (run?.mode === "teach" || run?.mode === "drive") say(run.lastSpoken);
            return Promise.resolve();
          }
          void overlay.clear();
          say("Stopped.");
          end();
          return Promise.resolve();
        case "refused":
        case "act":
          return Promise.resolve();
      }
    };
    void go().catch(fail).finally(finished);
  };

  const said: ScreenCompanion["said"] = async (text, { direct }) => {
    const started = Date.now();
    const decision = await decideSaid(text, direct);
    const decidedAt = Date.now();
    if (decision.route === "act") {
      input.onTimings?.({
        route: "act",
        source: decision.source,
        decideMs: decidedAt - started,
        firstSentenceMs: null,
        totalMs: decidedAt - started,
      });
      return { kind: "act", text: decision.text };
    }
    if (decision.route === "refused") return { kind: "refused", reply: decision.text };
    perform(decision, started, decidedAt);
    return { kind: "handled" };
  };

  /** Typed asks: the same decision, with the card and the voice standing in for the voice side. */
  const typed = async (text: string) => {
    const result = await said(text, { direct: false });
    if (result.kind === "handled") return;
    const reply =
      result.kind === "refused"
        ? result.reply
        : actions === null
          ? "Baton's sessions aren't reachable from here yet."
          : await actions.act(result.text);
    await show("Baton", reply);
    say(reply);
    clearLater(Math.max(8000, reply.length * 70));
  };

  let askBox: Electron.BrowserWindow | null = null;
  const onAsk = (event: Electron.IpcMainEvent, text: unknown) => {
    if (askBox === null || event.sender !== askBox.webContents) return;
    askBox.destroy();
    askBox = null;
    if (typeof text === "string" && text.trim().length > 0) {
      void typed(text.trim()).catch(fail);
    }
  };
  Electron.ipcMain.on("baton-screen:ask", onAsk);
  const openAskBox = () => {
    if (askBox !== null && !askBox.isDestroyed()) return askBox.focus();
    const area = Electron.screen.getDisplayNearestPoint(
      Electron.screen.getCursorScreenPoint(),
    ).workArea;
    const width = 560;
    askBox = new Electron.BrowserWindow({
      width,
      height: 96,
      x: Math.round(area.x + (area.width - width) / 2),
      y: Math.round(area.y + area.height * 0.18),
      frame: false,
      transparent: true,
      resizable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      show: false,
      // An inline page of ours that never navigates; node is how it hands the text back.
      webPreferences: { nodeIntegration: true, contextIsolation: false },
    });
    const box = askBox;
    box.on("blur", () => {
      if (!box.isDestroyed()) box.destroy();
      if (askBox === box) askBox = null;
    });
    void box.loadURL(`data:text/html,${encodeURIComponent(ASK_DOCUMENT)}`).then(() => {
      box.show();
      box.focus();
    });
  };

  Electron.globalShortcut.register(ASK_HOTKEY, openAskBox);

  const stop = () => perform({ route: "control", control: "stop", source: "instant" }, 0, 0);

  return {
    said,
    setActions: (next) => {
      actions = next;
    },
    active: () => runningMode() !== null,
    openAskBox,
    stop,
    menuItems: () => [
      { label: "Ask Baton…", accelerator: ASK_HOTKEY, click: openAskBox },
      ...(run !== null && run.mode !== "look"
        ? [
            {
              label: run.mode === "teach" ? "Stop the lesson" : "Stop driving",
              click: stop,
            },
          ]
        : []),
      {
        label: "Always allow screen capture",
        type: "checkbox" as const,
        checked: settings.captureApproval === "always",
        click: (item: Electron.MenuItem) =>
          save({ captureApproval: item.checked ? "always" : "ask" }),
      },
      {
        label: "Speak screen answers",
        type: "checkbox" as const,
        checked: settings.speak,
        click: (item: Electron.MenuItem) => save({ speak: item.checked }),
      },
    ],
    dispose: () => {
      end();
      dropRouter();
      if (routerIdle !== null) clearTimeout(routerIdle);
      Electron.globalShortcut.unregister(ASK_HOTKEY);
      Electron.ipcMain.removeListener("baton-screen:ask", onAsk);
      driver?.dispose();
      overlay.dispose();
    },
  };
};
