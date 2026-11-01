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
  clockLine,
  OPERATOR_PROMPT,
  decide,
  instantDecision,
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
  pasteTooLong,
  planHighRisk,
  planSensitive,
  shellCheck,
} from "@t3tools/baton-shared/screenCompanion";
import {
  describeToolCall,
  gatePrompt,
  judgeToolCall,
  spokenOutcome,
  announceTool,
  type ToolCall,
} from "@t3tools/baton-shared/operator";
import * as Electron from "electron";

import {
  holdAfterSpeechMs,
  pageText,
  queueSpeech,
  readingMs,
} from "@t3tools/baton-shared/companionPacing";

import {
  SessionClosed,
  startVisionSession,
  type VisionContent,
  type VisionSession,
} from "./claudeVision.ts";
import { startCodexOperator } from "./codexOperator.ts";
import { createCompanionWindows, type AnswerOutput } from "./companionWindows.ts";
import { brainRows, canChoose, type BrainStatus } from "./brainChoice.ts";
import { detectBrains } from "./brainDetect.ts";
import { accountLabel, maskEmail, pickEnv } from "./assistantAccount.ts";
import { createAssistantAccounts } from "./assistantAccounts.ts";
import { createInputDriver } from "./inputDriver.ts";
import type { HomeControl } from "../home/batonHome.ts";
import { POCKET_VOICES, type PocketVoice } from "../voice/pocketVoice.ts";
import { createPointerOverlay, type OverlayCard, type OverlayMarker } from "./pointerOverlay.ts";
import type { EscapeRank } from "./escapeKey.ts";
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
  /** Low-risk work runs with no Run it box and no spoken yes. Off until he turns it on. */
  readonly actWithoutAsking: boolean;
  /** Who does the work behind Baton. Both answer to the same gate. */
  readonly operator: "claude" | "codex";
  readonly codexBinary: string;
  /** He has picked what Baton works through, so the first-run card is done. */
  readonly brainChosen: boolean;
  /** The config directory of the Claude login the assistant uses; null follows his `claude`. */
  readonly assistantAccount: string | null;
}

const UNKNOWN_BRAINS: BrainStatus = { claude: { state: "missing" }, codex: { state: "missing" } };

const DEFAULTS: ScreenSettings = {
  captureApproval: "ask",
  claudeBinary: "claude",
  model: "sonnet",
  routerModel: "haiku",
  output: "spoken",
  voice: "anna",
  actWithoutAsking: false,
  operator: "claude",
  codexBinary: "codex",
  brainChosen: false,
  assistantAccount: null,
};

const settingsFrom = (saved: Partial<ScreenSettings> & { speak?: boolean }): ScreenSettings => ({
  ...DEFAULTS,
  // The old checkbox, for a settings file written before Written only.
  ...(saved.speak === false ? { output: "written" as const } : {}),
  ...saved,
});

const LOOK_MEMORY_MS = 15 * 60_000;
/** Real work takes a while, and a question to him sits inside the turn. */
const OPERATOR_TURN_MS = 30 * 60_000;
const ROUTER_IDLE_MS = 15 * 60_000;
/** A router this slow has already lost; the word rules answer instead. */
const ROUTER_TIMEOUT_MS = 20_000;
/** A warm router keeps its history: this bounds how long one bad turn can colour the next. */
const ROUTER_MAX_TURNS = 6;
/** He said stop or the box must open: neither waits for a sidecar that is restarting. */
const FOCUS_WAIT_MS = 400;
const KEYBOARD_WAIT_MS = 1_500;
/** It arrives unasked while he may be typing, so a stray key cannot answer it. */
const PAUSE_ARM_MS = 900;
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
  /** The window itself, so a drive sees the keyboard move. */
  readonly window?: number;
}

export interface AssistantActions {
  /** Which window has the keyboard right now. */
  readonly focus?: () => Promise<AssistantFocus | null>;
  /** The real element for a label near a point, from the accessibility tree. */
  readonly locate?: (
    label: string,
    near: { readonly x: number; readonly y: number },
  ) => Promise<{ readonly x: number; readonly y: number; readonly name: string } | null>;
  /** The top-level window under a desktop point, for a drive's click. */
  readonly windowAt?: (point: { readonly x: number; readonly y: number }) => Promise<{
    readonly window: number;
    readonly label: string;
  } | null>;
  /** The folder open in a window, when it is an Explorer window. */
  readonly folder?: (window: number) => Promise<string | null>;
  /** A yes or no by voice, beside any box. Null when nothing is listening. */
  readonly confirm?: (prompt: string) => {
    readonly answer: Promise<"yes" | "no" | "expired">;
    readonly cancel: () => void;
  } | null;
  /** A command through the intent path and all its guards; the reply to speak. */
  readonly act: (command: string, restated?: boolean) => Promise<string>;
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
    input: { readonly direct: boolean; readonly typed?: boolean },
  ) => Promise<
    | { readonly kind: "act"; readonly text: string; readonly restated?: boolean }
    | { readonly kind: "handled" }
    | { readonly kind: "refused"; readonly reply: string }
  >;
  readonly setActions: (actions: AssistantActions) => void;
  /** A lesson or a drive is running. */
  readonly active: () => boolean;
  /** Silences what is queued and what an answer has yet to say. */
  readonly hush: () => void;
  /** The tray's Clear the screen, also what a spoken stop does. */
  readonly dismiss: () => void;
  /** He has woken Baton: starts the sessions a turn will need, which costs no quota. */
  readonly warm: () => void;
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
  readonly controls: () => ReadonlyArray<HomeControl>;
  readonly needsBrainChoice: () => boolean;
  /** Asks again whether Claude Code and Codex are installed and signed in. */
  readonly signIn: () => Promise<BrainStatus>;
  readonly applySetting: (id: string, value: string | boolean | null) => void;
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
  /** Every action taken or refused, for the turn log. */
  readonly onAction?: (entry: Readonly<Record<string, unknown>>) => void;
  /** What each turn was given and did, for the lab's trace table. */
  readonly onTrace?: (entry: Readonly<Record<string, unknown>>) => void;
  /** Lets the voice tray show the companion's own entries. */
  readonly onChange?: () => void;
  /** Stop speech at once: he has moved on. */
  readonly stopSpeech?: () => void;
  readonly holdEscape: (onPress: () => void, rank?: EscapeRank) => () => void;
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

  let brains: BrainStatus | null = null;
  const checkBrains = async () => {
    brains = await detectBrains({
      env: input.env,
      platform: input.platform,
      claudeBinary: settings.claudeBinary,
      codexBinary: settings.codexBinary,
    });
    input.onChange?.();
  };
  void checkBrains();
  const accounts = createAssistantAccounts({
    env: input.env,
    platform: input.platform,
    claudeBinary: () => settings.claudeBinary,
    onChange: () => input.onChange?.(),
  });
  void accounts.refresh();
  let toldAbout: string | null = null;
  /** The environment for his `claude` children: the chosen login, or his own with a plain note. */
  const claudeEnv = (): NodeJS.ProcessEnv => {
    const picked = pickEnv(settings.assistantAccount, accounts.cached(), input.env);
    if (picked.notice !== null && picked.notice !== toldAbout) {
      toldAbout = picked.notice;
      linger("Baton", picked.notice);
    }
    return picked.env;
  };

  const overlay = createPointerOverlay(input.platform);
  const speech = queueSpeech(input.speak);
  /** Bumped when he silences it, so what an answer is still streaming stays unsaid. */
  let hushes = 0;
  const hush = () => {
    hushes += 1;
    input.stopSpeech?.();
  };
  /** When the current speech began, for how much reading it has already covered. */
  let spokenFrom: number | null = null;
  const say = (text: string) => {
    if (settings.output === "written" || text.trim().length === 0) return;
    spokenFrom ??= Date.now();
    speech.add(text);
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
      env: claudeEnv(),
      platform: input.platform,
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    });

  // Kept warm between sentences: a cold start costs 2 s more, and it holds no conversation of use.
  let router: VisionSession | null = null;
  let routerIdle: ReturnType<typeof setTimeout> | null = null;
  let routerTurns = 0;
  /** A started answer session, so the first answer skips the process's own start. */
  let spareLook: VisionSession | null = null;
  const dropRouter = () => {
    router?.dispose();
    router = null;
    routerTurns = 0;
    spareLook?.dispose();
    spareLook = null;
  };
  const warmRouter = () => {
    // Whatever a page's title talked it into stops at the cap.
    if (routerTurns >= ROUTER_MAX_TURNS || router?.alive() === false) {
      router?.dispose();
      router = null;
      routerTurns = 0;
    }
    router ??= session(settings.routerModel, BRAIN_ROUTER_PROMPT, ROUTER_TIMEOUT_MS);
    if (routerIdle !== null) clearTimeout(routerIdle);
    routerIdle = setTimeout(dropRouter, ROUTER_IDLE_MS);
    return router;
  };
  const routerAsk = async (turn: string): Promise<string> => {
    const current = warmRouter();
    routerTurns += 1;
    try {
      return await current.ask([{ type: "text", text: turn }]);
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
      env: claudeEnv(),
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
    hush();
    input.onDismissed?.();
    // Stop means the work too, not only the talking about it.
    dropOperator();
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
      await speech.finished();
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

  /** A title can hold an email subject or a bank's name: it goes where a screenshot may. */
  const titlesAllowed = (): boolean =>
    !needsCaptureApproval({
      policy: settings.captureApproval,
      allowedUntil,
      sessionApproved: false,
      now: Date.now(),
    });

  /** This turn came by voice, so its questions can be answered by voice too. */
  let voiceTurn = false;
  /**
   * The box, and on a voice turn the same question aloud, so no step needs his hands. Whichever he
   * answers first counts; a question that runs out leaves the box up.
   */
  const askHandsFree = async (
    box: Parameters<ReturnType<typeof createCompanionWindows>["ask"]>[0],
    spoken: string,
    yes = 0,
    /** A question that runs out is a no, and the box comes down. */
    noOnExpiry = false,
  ): Promise<number> => {
    const aloud = voiceTurn ? (actions?.confirm?.(spoken) ?? null) : null;
    const boxed = windows.ask(box);
    if (aloud === null) return boxed;
    const first = await Promise.race([
      boxed.then((index) => ({ index })),
      aloud.answer.then((said) => ({ said })),
    ]);
    if ("index" in first) {
      aloud.cancel();
      return first.index;
    }
    const outcome = spokenOutcome(first.said, { yes, cancel: box.cancel, noOnExpiry });
    if (outcome === null) return boxed;
    windows.closePrompt();
    await boxed;
    return outcome;
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
    const response = await askHandsFree(
      {
        title: "Let Baton see your screen?",
        detail: `To answer: “${question}”\n\n${forWhat === null ? "One screenshot of each display goes to Claude on your subscription." : `Screenshots are taken during this ${forWhat}, after each step, until it ends.`} Nothing is stored after the answer.`,
        buttons: [
          forWhat === null ? "Allow" : `Allow for this ${forWhat}`,
          "Allow for an hour",
          "Always allow",
          "Not now",
        ],
        cancel: 3,
        scoped: true,
      },
      "Can I see your screen? Yes or no.",
    );
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
    if (error instanceof SessionClosed) return;
    if (run === null && message.startsWith("Claude stopped")) return;
    say(message);
    linger("Baton", message);
    input.onActivity?.(null);
    end();
  };

  const end = () => {
    windows.closePrompt();
    dropOperator();
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

  let operator: { session: VisionSession; lastAt: number; home: string } | null = null;
  /** The turn has run a tool, so what comes next may be following its output. */
  let tainted = false;
  /** A call is announced before its own request reaches the gate: only the next one is tainted. */
  let toolsThisTurn = 0;
  const dropOperator = () => {
    operator?.session.dispose();
    operator = null;
  };

  const toolGate = async (call: ToolCall) => {
    const judged = judgeToolCall(call, {
      actWithoutAsking: settings.actWithoutAsking,
      tainted,
    });
    const action = describeToolCall(call);
    const record = (outcome: string) =>
      input.onAction?.({ by: settings.operator, tool: call.tool, action, outcome });
    if (judged.verdict === "allow") {
      record("allowed");
      return { allow: true as const };
    }
    const prompt = gatePrompt(judged, action);
    const response = await askHandsFree(
      {
        title: prompt.title,
        detail: prompt.detail,
        buttons: ["Do it", "Not now"],
        cancel: 1,
        scoped: true,
      },
      prompt.spoken,
      0,
      prompt.noOnExpiry,
    );
    record(response === 0 ? "he said yes" : "he said no");
    return response === 0
      ? { allow: true as const }
      : { allow: false as const, reason: "He said no. Stop and tell him." };
  };

  const operatorSession = (home: string): VisionSession => {
    const onTool = (call: ToolCall) => {
      ({ tainted, ran: toolsThisTurn } = announceTool(toolsThisTurn, call.tool));
      input.onAction?.({ by: settings.operator, tool: call.tool, action: describeToolCall(call) });
    };
    return settings.operator === "codex"
      ? startCodexOperator({
          binary: settings.codexBinary,
          cwd: home,
          systemPrompt: OPERATOR_PROMPT,
          env: input.env,
          platform: input.platform,
          gate: toolGate,
          onTool,
        })
      : startVisionSession({
          claudeBinary: settings.claudeBinary,
          model: settings.model,
          systemPrompt: OPERATOR_PROMPT,
          workDir: NodePath.join(input.stateDir, "screen"),
          cwd: home,
          env: claudeEnv(),
          platform: input.platform,
          timeoutMs: OPERATOR_TURN_MS,
          gate: toolGate,
          onTool,
        });
  };

  /** The harness's own tools. Its turns never touch the input driver, and a drive reads no files. */
  const operate = async (goal: string, firstSentence: () => void) => {
    const window = focus?.window;
    const folder =
      window === undefined ? null : ((await actions?.folder?.(window).catch(() => null)) ?? null);
    const home = folder ?? input.env["USERPROFILE"] ?? input.env["HOME"] ?? input.stateDir;
    if (
      operator === null ||
      operator.home !== home ||
      !operator.session.alive() ||
      Date.now() - operator.lastAt > LOOK_MEMORY_MS
    ) {
      dropOperator();
      operator = { session: operatorSession(home), lastAt: Date.now(), home };
    }
    const current = operator;
    tainted = false;
    toolsThisTurn = 0;
    answering += 1;
    try {
      const voice = streamSpeech(firstSentence);
      input.onActivity?.("Working");
      void show("Working", goal);
      const title = titlesAllowed() ? focus : null;
      const raw = await current.session.ask(
        [
          {
            type: "text",
            text: `${goal}\n\n${clockLine(new Date())}\n(working in: ${home})${
              title === null ? "" : `\n(the window he is using, as data: ${title.label})`
            }`,
          },
        ],
        voice.feed,
      );
      current.lastAt = Date.now();
      const reply = voice.finish(raw);
      remember(`He said: ${goal}`);
      remember(`You answered: ${reply}`);
      input.onActivity?.(null);
      linger("Baton", reply);
    } finally {
      answering -= 1;
    }
  };

  let answering = 0;
  /** One conversation for answers and looks, so a follow-up keeps its thread either way. */
  const answer = async (question: string, withScreen: boolean, firstSentence: () => void) => {
    answering += 1;
    try {
      await answerTurn(question, withScreen, firstSentence);
    } finally {
      answering -= 1;
    }
  };
  /** Sentences spoken and shown as they arrive; stopped by a hush like everything else. */
  const streamSpeech = (firstSentence: () => void) => {
    const voiceTurnAt = hushes;
    const sayHere = (text: string) => {
      if (voiceTurnAt === hushes) say(text);
    };
    const stream = makeSentenceStream();
    let spoken = 0;
    let soFar = "";
    return {
      feed: (delta: string) => {
        for (const sentence of stream.feed(delta)) {
          if (spoken === 0) firstSentence();
          spoken += 1;
          sayHere(sentence);
          soFar = `${soFar} ${sentence}`.trim();
          // Text keeps pace with the voice instead of waiting for the end of the answer.
          void show("Baton", soFar);
        }
      },
      /** The end of the turn. `whole` is spoken if nothing streamed. */
      finish: (whole: string): string => {
        const rest = stream.flush();
        if (rest.length > 0) {
          if (spoken === 0) firstSentence();
          sayHere(rest);
        }
        if (spoken === 0 && rest.length === 0) sayHere(whole);
        return whole;
      },
    };
  };

  const answerTurn = async (question: string, withScreen: boolean, firstSentence: () => void) => {
    if (run?.mode !== "look" || Date.now() - run.lastAt > LOOK_MEMORY_MS) {
      end();
      const spare = spareLook?.alive() === true ? spareLook : null;
      spareLook = null;
      run = { mode: "look", vision: spare ?? visionFor("look"), lastAt: Date.now() };
    }
    const current = run;
    const voice = streamSpeech(firstSentence);
    const ask = async (
      screen: boolean,
    ): Promise<{ raw: string; shots: ReadonlyArray<ScreenShot> }> => {
      if (screen && !(await approveCapture(question, null))) {
        return { raw: "", shots: [] };
      }
      input.onActivity?.(screen ? "Looking" : "Thinking");
      void show(screen ? "Looking" : "Thinking", question);
      const captured = screen ? await capture() : [];
      const title = screen || titlesAllowed() ? focus : null;
      const window = title === null ? "" : `\n\n(the window he is using: ${title.label})`;
      const raw = await current.vision.ask(
        content(captured, `${question}${window}\n\n${clockLine(new Date())}`),
        voice.feed,
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
    remember(`He said: ${question}`);
    remember(`You answered: ${reply.spoken}`);
    // A retry after [LOOK] streamed nothing, so the whole answer is spoken here.
    voice.finish(reply.spoken);
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
      input.onTrace?.({
        teachStep: lesson.step,
        note: note ?? null,
        reply: reply.spoken,
        at: Date.now(),
      });
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
  const watch = (
    lesson: Extract<Run, { mode: "teach" }>,
    baseline: ReadonlyArray<Uint8Array>,
    step: string,
  ) => {
    if (lesson.idle !== null) clearTimeout(lesson.idle);
    lesson.idle = setTimeout(() => {
      if (run === lesson) {
        const message = "I'll stop the lesson here. Ask again whenever you want to carry on.";
        say(message);
        linger("Lesson", message);
        end();
      }
    }, TEACH_IDLE_MS);
    let previous: ReadonlyArray<Uint8Array> | null = null;
    let moved = false;
    let still = 0;
    let polling = false;
    // A step is never replaced under him: it has been said and could have been read first.
    let armed = false;
    void Promise.all([speech.finished(), sleep(readingMs(step))]).then(() => (armed = true));
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
    // Never ends a newer run that replaced this one while it waited.
    const finish = () => {
      if (run === current) end();
    };
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
          {
            type: "text",
            text: `that plan was refused: ${parsed.error} propose one that avoids it.`,
          },
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
      return finish();
    }
    const plan = parsed.plan;
    // Held to the list a sentence is held to, whatever routed here. Run it is not enough.
    const clipboard = await Electron.clipboard.readText();
    const tooLong = pasteTooLong(plan, clipboard);
    const subject = tooLong ? null : planHighRisk(plan, clipboard);
    const shell = shellCheck(plan, focus?.label ?? null);
    input.onAction?.({ by: "drive", plan: plan.title, steps: plan.actions.length });
    if (tooLong || shell.refused) {
      const message = tooLong
        ? "That would paste more than I can show you first, so I won't."
        : "That would paste into a command line, where nobody reads it first. I won't do that.";
      say(message);
      input.onActivity?.(null);
      linger("Baton", message);
      input.onAction?.({ by: "drive", plan: plan.title, outcome: "refused" });
      return finish();
    }
    current.lastSpoken = reply.spoken;
    const marks = planMarkers(plan, shots);
    await overlay.markers(marks);
    const askFirst =
      subject !== null || !settings.actWithoutAsking || shell.ask || planSensitive(plan, clipboard);
    input.onActivity?.(askFirst ? "Waiting for you" : "Starting", plan.title);
    say(reply.spoken);
    const response = !askFirst
      ? 0
      : await askHandsFree(
          {
            title: plan.title,
            detail: `${reply.spoken}\n\n${describeDrivePlan(plan, clipboard)}\n\nThe numbered dots on screen are where it will click. Esc, saying stop, or the Stop button stops it. The mouse stays yours: if a window moves under a click, it asks first.`,
            buttons: ["Run it", "Not now"],
            cancel: 1,
            scoped: true,
          },
          subject === null
            ? "Shall I run that? Yes or no."
            : `This plan involves ${subject}. Do you want me to run it? Say yes or no.`,
          0,
          subject !== null,
        );
    const shellYes =
      response !== 0 || run !== current || !shell.ask
        ? 0
        : await askHandsFree(
            {
              title: shell.shell
                ? "This plan reaches a command line"
                : "I can't tell where these keys will go",
              detail: `A command line runs what it is given. ${
                shell.typed.length === 0
                  ? "This plan types nothing itself."
                  : `Baton would type:\n\n${shell.typed.join("\n")}`
              }`,
              buttons: ["Type it", "Not now"],
              cancel: 1,
              scoped: true,
            },
            "This goes to a command line. Shall I type it? Yes or no.",
          );
    input.onAction?.({
      by: "drive",
      plan: plan.title,
      outcome: !askFirst ? "ran by setting" : response === 0 ? "he said yes" : "he said no",
    });
    if (response !== 0 || shellYes !== 0 || run !== current) {
      input.onActivity?.(null);
      await wipe();
      return finish();
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
      return finish();
    }
    // Stopped while it was on its way here: end() has been and gone, so nothing would let go.
    if (run !== current) return;
    // A pause box waiting for an answer goes too.
    const stopDrive = () => {
      current.cancelled = true;
      windows.closePrompt();
    };
    current.release = input.holdEscape(stopDrive, "drive");
    const hideStop = windows.showStop(stopDrive);
    driver ??= createInputDriver({
      platform: input.platform,
      toPhysical: (p) => (input.platform === "win32" ? Electron.screen.dipToScreenPoint(p) : p),
      clipboard: Electron.clipboard,
    });
    const d = driver;
    const result = await runDrivePlan(plan, shots, {
      clickAt: d.clickAt,
      pressAt: d.pressAt,
      releaseAt: d.releaseAt,
      scrollAt: d.scrollAt,
      type: d.type,
      press: d.press,
      ...(input.platform === "win32" && actions?.focus !== undefined
        ? { foreground: keyboardWindow }
        : {}),
      ...(input.platform === "win32" && actions?.windowAt !== undefined
        ? { windowAt: actions.windowAt }
        : {}),
      pause: async (reason) =>
        (await askHandsFree(
          {
            title: "Carry on?",
            detail: `${reason} I haven't clicked. Make sure the right window is up, then carry on.`,
            buttons: ["Carry on", "Stop"],
            cancel: 1,
            scoped: true,
            armMs: PAUSE_ARM_MS,
          },
          `${reason} Carry on? Yes or no.`,
        )) === 0,
      shellAllowed: shell.ask,
      pasteText: clipboard,
      clipboard: () => Electron.clipboard.readText(),
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
          "Esc or Stop ends it.",
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
    hideStop();
    current.release?.();
    current.release = null;
    if (run !== current) return;
    const message = result.kind === "finished" ? "Done. Have a look." : result.reason;
    input.onTrace?.({ driveResult: result });
    input.onAction?.({ by: "drive", plan: plan.title, result: result.kind });
    await overlay.markers([]);
    input.onActivity?.(null);
    say(message);
    linger("Drive", message);
    finish();
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
      {
        running: runningMode(),
        answering: answering > 0 || speech.busy(),
        direct,
        recent,
        focused: titlesAllowed() ? (focus?.label ?? null) : null,
      },
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
        case "operate":
          return operate(decision.text, () => (firstAt ??= Date.now()));
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
          hush();
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

  /** Null stops a drive, so it waits longer than a sentence does. */
  const keyboardWindow = async () => {
    const seen = await Promise.race([
      actions?.focus?.().catch(() => null) ?? Promise.resolve(null),
      sleep(KEYBOARD_WAIT_MS).then(() => null),
    ]);
    return seen?.window === undefined ? null : { window: seen.window, label: seen.label };
  };

  const focusSoon = (): Promise<AssistantFocus | null> =>
    Promise.race([
      actions?.focus?.().catch(() => null) ?? Promise.resolve(null),
      sleep(FOCUS_WAIT_MS).then(() => null),
    ]);

  const said: ScreenCompanion["said"] = async (text, { direct, typed = false }) => {
    const started = Date.now();
    voiceTurn = !typed;
    // A stop never waits on the sidecar, and needs no window.
    const busy = runningMode() !== null || answering > 0 || speech.busy();
    if (instantDecision(text, busy)?.route !== "control") {
      focus = askFocus ?? (await focusSoon());
    }
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
      return {
        kind: "act",
        text: decision.text,
        ...(decision.restated === true ? { restated: true } : {}),
      };
    }
    if (decision.route === "refused") {
      input.onTimings?.({
        route: "refused",
        source: decision.source,
        decideMs: decidedAt - started,
        firstSentenceMs: null,
        totalMs: decidedAt - started,
      });
      return { kind: "refused", reply: decision.text };
    }
    perform(decision, started, decidedAt);
    return { kind: "handled" };
  };

  /** Typed asks: the same decision, with the card and the voice standing in for the voice side. */
  const typed = async (text: string) => {
    const result = await said(text, { direct: false, typed: true });
    if (result.kind === "handled") return;
    const reply =
      result.kind === "refused"
        ? result.reply
        : actions === null
          ? "Baton's sessions aren't reachable from here yet."
          : await actions.act(result.text, result.restated === true);
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
    void focusSoon().then((window) => {
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
    hush,
    dismiss,
    warm: () => {
      warmRouter();
      if (run?.mode !== "look" && spareLook?.alive() !== true) {
        spareLook?.dispose();
        spareLook = visionFor("look");
      }
    },
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
    ],
    controls: () => [
      {
        id: "s.output",
        section: "Answers",
        label: "How Baton answers",
        kind: "choice",
        value: settings.output,
        options: [
          { value: "spoken", label: "Spoken and written" },
          { value: "written", label: "Written only" },
        ],
      },
      {
        id: "s.voice",
        section: "Answers",
        label: "Voice",
        hint: "Quick is smaller and less accurate. System uses your computer's voice.",
        kind: "choice",
        value: settings.voice,
        options: [
          ...POCKET_VOICES.map((v) => ({ value: v, label: `${v[0]!.toUpperCase()}${v.slice(1)}` })),
          { value: "quick", label: "Quick" },
          { value: "system", label: "System voice" },
        ],
      },
      {
        id: "s.brain",
        section: settings.brainChosen ? "Working for you" : "Choose what Baton works through",
        label: "Works through",
        ...(settings.brainChosen ? {} : { hint: "Listening and speaking stay on this computer." }),
        kind: "brain",
        value: settings.operator,
        options: brainRows(brains ?? UNKNOWN_BRAINS),
        lead: !settings.brainChosen,
      },
      {
        id: "s.brainCheck",
        section: settings.brainChosen ? "Working for you" : "Choose what Baton works through",
        label: "Installed and signed in?",
        kind: "action",
        button: "Check again",
        more: settings.brainChosen,
      },
      {
        id: "s.act",
        section: "Working for you",
        label: "Act without asking",
        hint: "Routine steps run on their own. Anything that deletes, sends, pays or publishes still asks.",
        kind: "toggle",
        on: settings.actWithoutAsking,
      },
      {
        id: "s.account",
        section: "Working for you",
        label: "Claude login for Baton",
        hint: "Which login Baton's assistant runs as. By default it follows the claude login.",
        kind: "choice",
        value: settings.assistantAccount ?? "",
        options: [
          { value: "", label: "Follow the claude login" },
          ...(accounts.cached() ?? []).map((a) => ({
            value: a.key,
            label: `${accountLabel(a)}${a.loggedIn ? "" : " (signed out)"}`,
          })),
        ],
        more: true,
      },
      ...(accounts.cached()?.find((a) => a.key === settings.assistantAccount)?.email == null
        ? []
        : [
            {
              id: "s.accountEmail",
              section: "Working for you",
              label: "Address",
              kind: "secret" as const,
              masked: maskEmail(
                accounts.cached()!.find((a) => a.key === settings.assistantAccount)!.email!,
              ),
              revealed: accounts.cached()!.find((a) => a.key === settings.assistantAccount)!.email!,
              more: true,
            },
          ]),
      {
        id: "s.capture",
        section: "Working for you",
        label: "Always allow screen capture",
        hint: "Off, Baton asks before it looks at your screen.",
        kind: "toggle",
        on: settings.captureApproval === "always",
        more: true,
      },
    ],
    needsBrainChoice: () => !settings.brainChosen,
    signIn: async () => {
      await checkBrains();
      return brains ?? UNKNOWN_BRAINS;
    },
    applySetting: (id, value) => {
      if (id === "s.output" && (value === "spoken" || value === "written")) {
        if (value === "written") hush();
        save({ output: value });
      } else if (id === "s.voice" && typeof value === "string") {
        save({ voice: value as PocketVoice });
      } else if (id === "s.brain" && typeof value === "string") {
        if (brains !== null && canChoose(brains, value)) {
          dropOperator();
          save({ operator: value, brainChosen: true });
        }
      } else if (id === "s.brainCheck") {
        void checkBrains();
      } else if (id === "s.account" && typeof value === "string") {
        dropOperator();
        dropRouter();
        toldAbout = null;
        save({ assistantAccount: value === "" ? null : value });
        void accounts.refresh();
      } else if (id === "s.act") save({ actWithoutAsking: value === true });
      else if (id === "s.capture") save({ captureApproval: value === true ? "always" : "ask" });
    },
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
