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
  pointable,
  parseVerify,
  planFromReply,
  runDrivePlan,
  screensDifference,
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

import { holdAfterSpeechMs, pageText, readingMs } from "@t3tools/baton-shared/companionPacing";

import { startVisionSession, type VisionContent, type VisionSession } from "./claudeVision.ts";
import { createCompanionWindows, type AnswerOutput } from "./companionWindows.ts";
import { createInputDriver } from "./inputDriver.ts";
import { POCKET_VOICES, type PocketVoice } from "../voice/pocketVoice.ts";
import { createPointerOverlay, type OverlayCard, type OverlayMarker } from "./pointerOverlay.ts";
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
  /** Written only shows everything and plays nothing. */
  readonly output: AnswerOutput;
  /** "system" is the OS voice, for a machine that should fetch nothing. */
  readonly voice: PocketVoice | "system";
}

const DEFAULTS: ScreenSettings = {
  captureApproval: "ask",
  claudeBinary: "claude",
  model: "sonnet",
  routerModel: "haiku",
  output: "spoken",
  voice: "anna",
};

const settingsFrom = (saved: Partial<ScreenSettings> & { speak?: boolean }): ScreenSettings => ({
  ...DEFAULTS,
  // The old checkbox, for a settings file written before Written only.
  ...(saved.speak === false ? { output: "written" as const } : {}),
  ...saved,
});

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
/** The window he is using. */
export interface AssistantFocus {
  /** "notepad.exe: notes.txt", for the model. */
  readonly label: string;
  /** Its middle in desktop coordinates, which picks the display. */
  readonly centre: { readonly x: number; readonly y: number } | null;
}

export interface AssistantActions {
  /** Which window has the keyboard right now. */
  readonly focus?: () => Promise<AssistantFocus | null>;
  /** The real element for a label near a point, from the accessibility tree. */
  readonly locate?: (
    label: string,
    near: { readonly x: number; readonly y: number },
  ) => Promise<{ readonly x: number; readonly y: number; readonly name: string } | null>;
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
  /** A reply from outside the assistant, shown in full when answers are written only. */
  readonly notice: (text: string) => void;
  /** Spoken answers are off. */
  readonly writtenOnly: () => boolean;
  readonly voice: () => PocketVoice | "system";
  readonly stop: () => void;
  /** The one look for a yes or no, for the voice side's confirmations too. */
  readonly ask: ReturnType<typeof createCompanionWindows>["ask"];
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
      release: (() => void) | null;
    };

const LOOK_REPLY = "[LOOK]";

export const startScreenCompanion = (input: {
  readonly stateDir: string;
  readonly platform: string;
  readonly env: NodeJS.ProcessEnv;
  /** Baton's one voice, injected so this module never loads the voice models. */
  readonly speak: (text: string) => Promise<void>;
  /** A turn finished with nothing further coming, for the cue after a wake word. */
  readonly onTurnEnd?: () => void;
  readonly onTimings?: (timings: TurnTimings) => void;
  /** What each turn was given and did, for the lab's trace table. */
  readonly onTrace?: (entry: Readonly<Record<string, unknown>>) => void;
  /** Lets the voice tray show the companion's own entries. */
  readonly onChange?: () => void;
  /** Stop speech at once: he has moved on. */
  readonly stopSpeech?: () => void;
  readonly holdEscape: (onPress: () => void) => () => void;
  /** Tells the pill what is going on; null when it stops. */
  readonly onActivity?: (label: string | null, caption?: string) => void;
  /** The answer's words were cancelled by him: the pill goes too. */
  readonly onDismissed?: () => void;
}): ScreenCompanion => {
  const settingsPath = NodePath.join(input.stateDir, "baton-screen.json");
  const read = (): ScreenSettings => {
    try {
      return settingsFrom(JSON.parse(NodeFS.readFileSync(settingsPath, "utf8")));
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
  /** When the current speech began, for how much reading it has already covered. */
  let spokenFrom: number | null = null;
  const say = (text: string) => {
    if (settings.output === "written" || text.trim().length === 0) return;
    spokenFrom ??= Date.now();
    speaking = speaking.then(() => input.speak(text).catch(() => undefined));
  };
  let driver: ReturnType<typeof createInputDriver> | null = null;
  let run: Run | null = null;
  let allowedUntil = 0;
  /** Bumped by anything new on screen; a hold that finds it moved quietly gives up. */
  let showing = 0;

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

  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  const wipe = async () => {
    showing += 1;
    spokenFrom = null;
    await overlay.clear();
  };
  /** Takes down whatever is up, and the voice with it. Esc stays his: this is the tray's. */
  const dismiss = () => {
    input.stopSpeech?.();
    input.onDismissed?.();
    if (run !== null && run.mode !== "look") {
      say("Stopped.");
      end();
    }
    void wipe();
  };

  /** A card that stays until something replaces it: a step, a plan, a thought. */
  const show = async (
    kicker: string,
    text: string,
    hint = "",
    extra: Partial<OverlayCard> = {},
  ) => {
    showing += 1;
    await overlay.card({ kicker, text, hint, ...extra });
  };

  /**
   * Shows text until it has been read, then leaves. Every page gets its reading time, the last
   * waits for the voice, and then the readable hold runs on a line he can see (D111). Started
   * without waiting: the turn is over, only the words remain.
   */
  const linger = (kicker: string, text: string, hint = ""): void => {
    const mine = ++showing;
    const pages = pageText(text);
    const current = () => mine === showing;
    void (async () => {
      for (const [i, page] of pages.entries()) {
        const label = pages.length > 1 ? `${i + 1} of ${pages.length}` : undefined;
        await overlay.card({ kicker, text: page, hint, ...(label ? { page: label } : {}) });
        if (i === pages.length - 1) break;
        const ms = readingMs(page);
        await overlay.timer(ms);
        await sleep(ms);
        if (!current()) return;
      }
      await speaking;
      if (!current()) return;
      const lastPage = pages.at(-1)!;
      const spokenMs = spokenFrom === null ? 0 : Date.now() - spokenFrom;
      const hold = holdAfterSpeechMs(lastPage, spokenMs);
      await overlay.timer(hold);
      await sleep(hold);
      if (!current()) return;
      showing += 1;
      spokenFrom = null;
      await overlay.retreat();
    })().catch(() => undefined);
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
    const response = await windows.ask({
      title: "Let Baton see your screen?",
      detail: `To answer: “${question}”\n\n${forWhat === null ? "One screenshot of each display goes to Claude on your subscription." : `Screenshots are taken during this ${forWhat}, after each step, until it ends.`} Nothing is stored after the answer.`,
      buttons: [
        forWhat === null ? "Allow" : `Allow for this ${forWhat}`,
        "Allow for an hour",
        "Always allow",
        "Not now",
      ],
      cancel: 3,
    });
    if (response === 1) allowedUntil = Date.now() + 60 * 60_000;
    if (response === 2) save({ captureApproval: "always" });
    // The box must be off the screen before the screenshot is taken.
    await new Promise((r) => setTimeout(r, 300));
    return response !== 3;
  };

  /** The window he meant, taken when he spoke or pressed the key, before Baton took focus. */
  let focus: AssistantFocus | null = null;
  const capture = (): Promise<ReadonlyArray<CapturedScreen>> =>
    overlay.hiddenFor(() => captureScreens(focus?.centre ?? null));
  const fingerprint = () => overlay.hiddenFor(screenFingerprint);

  const content = (
    captured: ReadonlyArray<CapturedScreen>,
    text: string,
  ): ReadonlyArray<VisionContent> => [
    ...captured.flatMap(({ shot, jpeg }): VisionContent[] => [
      {
        type: "text",
        text: `${screenLabel(shot, captured.length)}, image ${shot.width}x${shot.height}`,
      },
      { type: "image", mediaType: "image/jpeg", data: jpeg },
    ]),
    { type: "text", text },
  ];

  const pointAt = async (
    point: ReturnType<typeof parseReply>["point"],
    shots: ReadonlyArray<ScreenShot>,
  ): Promise<void> => {
    if (!pointable(point)) return;
    const shot = shotFor(shots, point.screen);
    if (shot === null) return;
    const guess = toDesktop(point, shot);
    // The accessibility tree has the real rectangle; the model's pixels only say where to look.
    const found = point.label === null ? null : await actions?.locate?.(point.label, guess);
    input.onTrace?.({ pointedAt: found ?? guess, snapped: found != null });
    const here = await overlay.point(found ?? guess, found?.name ?? point.label);
    if (!here) input.onActivity?.("Pointing", "on your other screen");
  };

  const fail = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    // He stopped it, and that ended the conversation under the question in flight.
    if (run === null && message.startsWith("Claude stopped")) return;
    say(message);
    linger("Baton", message);
    input.onActivity?.(null);
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
      current.release?.();
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
    let soFar = "";
    const speakAsItComes = (delta: string) => {
      for (const sentence of stream.feed(delta)) {
        if (spoken === 0) firstSentence();
        spoken += 1;
        say(sentence);
        soFar = `${soFar} ${sentence}`.trim();
        // Text keeps pace with the voice instead of waiting for the end of the answer.
        void show("Baton", soFar);
      }
    };
    const ask = async (
      screen: boolean,
    ): Promise<{ raw: string; shots: ReadonlyArray<ScreenShot> }> => {
      if (screen && !(await approveCapture(question, null))) {
        return { raw: "", shots: [] };
      }
      input.onActivity?.(screen ? "Looking" : "Thinking");
      void show(screen ? "Looking" : "Thinking", question);
      const captured = screen ? await capture() : [];
      const window = focus === null ? "" : `\n\n(the window he is using: ${focus.label})`;
      const raw = await current.vision.ask(
        content(captured, `${question}${window}`),
        speakAsItComes,
      );
      return { raw, shots: captured.map((c) => c.shot) };
    };
    let turn = await ask(withScreen);
    // The model found it needs to see the screen after all.
    if (!withScreen && turn.raw.trim() === LOOK_REPLY) turn = await ask(true);
    current.lastAt = Date.now();
    if (turn.raw.length === 0) {
      say("All right, I won't look.");
      input.onActivity?.(null);
      return void (await wipe());
    }
    const reply = parseReply(turn.raw);
    input.onTrace?.({
      images: turn.shots.map((s) => [s.screen, s.width, s.height, s.cursorHere]),
      point: reply.point,
      reply: reply.spoken,
    });
    const rest = stream.flush();
    if (rest.length > 0) {
      if (spoken === 0) firstSentence();
      say(rest);
    }
    remember(`He said: ${question}`);
    remember(`You answered: ${reply.spoken}`);
    // A retry after [LOOK] streamed nothing, so the whole answer is spoken here.
    if (spoken === 0 && rest.length === 0) say(reply.spoken);
    input.onActivity?.(null);
    await pointAt(reply.point, turn.shots);
    linger("Baton", reply.spoken);
  };

  const teachStep = async (note?: string) => {
    if (run?.mode !== "teach" || run.busy) return;
    const lesson = run;
    lesson.busy = true;
    if (lesson.watcher !== null) clearInterval(lesson.watcher);
    lesson.watcher = null;
    try {
      if (lesson.step >= TEACH_MAX_STEPS) {
        const message = "That's a long lesson. Let's stop here. Ask again to pick it up.";
        say(message);
        linger("Lesson", message);
        return end();
      }
      lesson.step += 1;
      // The step on screen stays readable while the next one is worked out.
      if (lesson.step === 1) void show("Lesson", "Looking at your screen");
      input.onActivity?.("Checking", `Step ${lesson.step}`);
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
      input.onActivity?.(null);
      if (run !== lesson) return;
      lesson.lastSpoken = reply.spoken;
      input.onTrace?.({ teachStep: lesson.step, note: note ?? null, reply: reply.spoken, at: Date.now() });
      if (reply.done) {
        say(reply.spoken);
        linger("Done", reply.spoken);
        return end();
      }
      say(reply.spoken);
      await pointAt(reply.point, shots);
      await show(
        `Step ${lesson.step}`,
        reply.spoken,
        "Do it and I'll notice, or say next. Stop ends the lesson.",
      );
      watch(lesson, baseline, reply.spoken);
    } finally {
      lesson.busy = false;
    }
  };

  /** Waits for the screen to change and settle, then checks it and gives the next step. */
  const watch = (lesson: Extract<Run, { mode: "teach" }>, baseline: Uint8Array, step: string) => {
    if (lesson.idle !== null) clearTimeout(lesson.idle);
    lesson.idle = setTimeout(() => {
      if (run === lesson) {
        const message = "I'll stop the lesson here. Ask again whenever you want to carry on.";
        say(message);
        linger("Lesson", message);
        end();
      }
    }, TEACH_IDLE_MS);
    let previous: Uint8Array | null = null;
    let moved = false;
    let still = 0;
    let polling = false;
    // A step is never replaced under him: it has been said and could have been read first.
    let armed = false;
    void Promise.all([speaking, sleep(readingMs(step))]).then(() => (armed = true));
    lesson.watcher = setInterval(() => {
      if (polling || !armed || run !== lesson || lesson.busy) return;
      polling = true;
      void fingerprint()
        .then((now) => {
          // shortcut: a video playing on either display reads as change and never settles, so that
          // lesson waits for "next"; judge only the step's own display if he hits it.
          if (!moved && screensDifference(baseline, now, PIXEL) > CHANGED) moved = true;
          else if (moved && previous !== null) {
            // Two quiet polls (~2 s), so a pause between typed words is not "done".
            still = screensDifference(previous, now, PIXEL) < SETTLED ? still + 1 : 0;
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
      release: null,
    };
    run = current;
    input.onChange?.();
    input.onActivity?.("Planning");
    void show("Planning", goal);
    const captured = await capture();
    const shots = captured.map((c) => c.shot);
    const before = await fingerprint();
    let reply = parseReply(await current.vision.ask(content(captured, goal)));
    if (run !== current) return;
    let parsed = planFromReply(reply, shots);
    // A plan the rules refused gets one more try, told why. The rules still read the new one.
    if ("error" in parsed && reply.planText !== null) {
      reply = parseReply(
        await current.vision.ask([
          { type: "text", text: `that plan was refused: ${parsed.error} propose one that avoids it.` },
        ]),
      );
      if (run !== current) return;
      parsed = planFromReply(reply, shots);
    }
    input.onTrace?.({
      driveReply: reply.spoken,
      plan: "plan" in parsed ? parsed.plan : parsed.error,
    });
    if ("error" in parsed) {
      say(parsed.error);
      input.onActivity?.(null);
      linger("Baton", parsed.error);
      return end();
    }
    const plan = parsed.plan;
    current.lastSpoken = reply.spoken;
    const marks = planMarkers(plan, shots);
    await overlay.markers(marks);
    input.onActivity?.("Waiting for you", plan.title);
    say(reply.spoken);
    const response = await windows.ask({
      title: plan.title,
      detail: `${reply.spoken}\n\n${describeDrivePlan(plan)}\n\nThe numbered dots on screen are where it will click. Esc, saying stop, or moving the mouse stops it.`,
      buttons: ["Run it", "Not now"],
      cancel: 1,
    });
    if (response !== 0 || run !== current) {
      input.onActivity?.(null);
      await wipe();
      return end();
    }
    await sleep(350); // the prompt leaves the screen first
    const afterPrompt = await fingerprint();
    input.onTrace?.({
      staleCheck: screensDifference(before, afterPrompt),
    });
    if (screensDifference(before, afterPrompt) > STALE) {
      const message = "The screen changed since I made the plan, so I didn't run it. Ask again.";
      say(message);
      input.onActivity?.(null);
      linger("Drive", message);
      return end();
    }
    const releaseDrive = input.holdEscape(() => (current.cancelled = true));
    current.release = releaseDrive;
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
        input.onActivity?.("Driving", `Step ${i + 1} of ${plan.actions.length}`);
        void show(
          `Step ${i + 1} of ${plan.actions.length}`,
          describeAction(action),
          "Esc stops it.",
          {
            dots: { at: i, of: plan.actions.length },
          },
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
    input.onTrace?.({ driveResult: result });
    await overlay.markers([]);
    input.onActivity?.(null);
    say(message);
    linger("Drive", message);
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
      { running: runningMode(), direct, recent, focused: focus?.label ?? null },
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
          linger("Baton", decision.text);
          return Promise.resolve();
        case "control":
          if (decision.control === "next") {
            return run?.mode === "teach" ? teachStep("he says he did it.") : Promise.resolve();
          }
          if (decision.control === "repeat") {
            if (run?.mode === "teach" || run?.mode === "drive") say(run.lastSpoken);
            return Promise.resolve();
          }
          input.stopSpeech?.();
          void wipe();
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
    focus = askFocus ?? (await actions?.focus?.().catch(() => null)) ?? null;
    askFocus = null;
    const decision = await decideSaid(text, direct);
    const decidedAt = Date.now();
    input.onTrace?.({ said: text, focused: focus?.label ?? null, decision, recent: recent.length });
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
    say(reply);
    linger("Baton", reply);
  };

  const windows = createCompanionWindows({
    output: () => settings.output,
    setOutput: (output) => save({ output }),
    onAsk: (text) => void typed(text).catch(fail),
  });

  // Taken first: once the box is up, it is the focused window.
  let askFocus: AssistantFocus | null = null;
  const openAskBox = () => {
    void (actions?.focus?.() ?? Promise.resolve(null))
      .catch(() => null)
      .then((window) => {
        askFocus = window;
        windows.openAsk();
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
    notice: (text) => {
      if (text.trim().length > 0) linger("Baton", text);
    },
    writtenOnly: () => settings.output === "written",
    voice: () => settings.voice,
    ask: windows.ask,
    stop,
    menuItems: () => [
      { label: "Ask Baton…", accelerator: ASK_HOTKEY, click: openAskBox },
      { label: "Clear the screen", click: dismiss },
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
        label: "Voice",
        submenu: [
          ...POCKET_VOICES.map((voice) => ({
            label: `${voice[0]!.toUpperCase()}${voice.slice(1)}`,
            type: "radio" as const,
            checked: settings.voice === voice,
            click: () => save({ voice }),
          })),
          { type: "separator" as const },
          {
            label: "Quick (smaller, less accurate)",
            type: "radio" as const,
            checked: settings.voice === "quick",
            click: () => save({ voice: "quick" }),
          },
          {
            label: "System voice",
            type: "radio" as const,
            checked: settings.voice === "system",
            click: () => save({ voice: "system" }),
          },
        ],
      },
      {
        label: "Answers",
        submenu: [
          {
            label: "Spoken and written",
            type: "radio" as const,
            checked: settings.output === "spoken",
            click: () => save({ output: "spoken" }),
          },
          {
            label: "Written only",
            type: "radio" as const,
            checked: settings.output === "written",
            click: () => {
              input.stopSpeech?.();
              save({ output: "written" });
            },
          },
        ],
      },
    ],
    dispose: () => {
      end();
      dropRouter();
      if (routerIdle !== null) clearTimeout(routerIdle);
      Electron.globalShortcut.unregister(ASK_HOTKEY);
      windows.dispose();
      driver?.dispose();
      overlay.dispose();
    },
  };
};
