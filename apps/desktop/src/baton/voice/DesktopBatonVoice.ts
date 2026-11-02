// @effect-diagnostics globalDate:off globalTimers:off nodeBuiltinImport:off
/**
 * Baton voice on the desktop: the microphone, the tray, the HUD, the hotkeys
 * and where finished words go (§12.1, §12.3, Phase 5). D65.
 *
 * Windows first (D97, D106): capture, speech and paste are `baton-dictation`, which is packaged
 * for Windows only so far, so elsewhere the tray says so and no microphone opens.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import type {
  BatonFocusTarget,
  BatonJob,
  BatonJobBridgeRequest,
  WatchFinding,
} from "@t3tools/baton-contracts";
import {
  chooseMode,
  cleanupFromSaved,
  DICTATION_MODES,
  MODE_LABELS,
  strictestCleanup,
  type CleanupLevel,
  type DictationMode,
} from "@t3tools/baton-shared/dictationCleanup";
import {
  createVoiceRouter,
  type BatonVoiceCore,
  type SttProvider,
  type VoiceCoreEvent,
  type VoiceIntentClient,
} from "@t3tools/baton-voice";
import type { EscapeRank } from "../screen/escapeKey.ts";
import type { ConversationLog } from "../conversation/conversationLog.ts";
import { parseActivity, todayStats } from "../home/activityLog.ts";
import type { HomeExtra } from "../home/batonHome.ts";
import {
  addEntry,
  editEntry,
  forgetLearned,
  removeEntry,
  saveDictionary,
  type VocabEntry,
} from "./dictionaryEdit.ts";
import {
  addInput,
  effective,
  parseBindings,
  removeInput,
  sameInput,
  toElectronAccelerator,
  withBinding,
  type Binding,
  type BindingInput,
} from "../bindings/bindings.ts";
import { DAILY_MINUTES, jobAction, jobControls } from "../sessions/jobRows.ts";
import { approvalAction, approvalControls } from "../sessions/approvalRows.ts";
import { buildApprovals, describeApprovals } from "@t3tools/baton-shared/approvals";
import { answerNeeds } from "../presence/needsAnswer.ts";
import { harnessControls, pluginOfControl } from "../harness/harnessRows.ts";
import { readInventory, setPluginEnabled } from "../harness/harnessInventory.ts";
import { fileToEdit, PACK_FOLDER, packAction, packControls, useDefault } from "../pack/packRows.ts";
import { createNotesStore } from "../memory/memoryNotes.ts";
import { noteAction, noteControls } from "../memory/noteRows.ts";
import { sessionControls } from "../sessions/sessionRows.ts";
import type { SessionsBridge } from "../sessions/sessionsBridge.ts";
import type { BatonUpdates } from "../update/BatonUpdater.ts";
import { FRESH_WAKE_WORDS, wakeWordsFor } from "./wakeDefaults.ts";
import { TRAY_PNG, TRAY_SIZES } from "./trayArt.ts";
import { brandMarkSvg, markSvg, withTrayState, type MarkOptions } from "./trayMark.ts";
import { parseAppearance, type Appearance } from "../home/theme.ts";
import { createBatonHome, type HomeControl, type HomeState } from "../home/batonHome.ts";
import { keepRunningForTray } from "../lastAppWindow.ts";
import * as Electron from "electron";

import {
  BATON_VOICE_FOCUS_CHANNEL,
  BATON_VOICE_REQUEST_CHANNEL,
  BATON_VOICE_RESPONSE_CHANNEL,
} from "../channels.ts";
import {
  choiceDeviceId,
  micChannel,
  realDevices,
  reconcileDeviceChange,
  selectInputDevice,
  type DeviceChoice,
} from "./audioDeviceSelection.ts";
import { makeClipboardInjection } from "./clipboardInjection.ts";
import {
  desktopVoiceContext,
  makeVoiceIntentClient,
  missingVoiceAssets,
  resolveWakeModels,
  type BrainVoiceHook,
  type VoiceAssets,
  type VoiceIntentRequest,
  type WakeWordSetting,
} from "./desktopVoiceCore.ts";
import { runChecks, type CheckInput, type CheckResult } from "./selfChecks.ts";
import type { BrainStatus } from "../screen/brainChoice.ts";
import {
  HEALTHY_RUN_MS,
  makeSidecarAudioInput,
  makeSidecarStt,
  restartDelayMs,
  startDictationSidecar,
  type DictationEvent,
  type DictationSidecar,
  type FocusedApp,
  type PasteMethod,
  type SidecarDevice,
} from "./dictationSidecar.ts";
import {
  importWisprDictionary,
  makeRewriter,
  readDictionary,
  writeDictionary,
} from "./dictationRewriter.ts";
import { mouseHookConfig } from "../bindings/inputConfig.ts";
import { VOICE_HOTKEYS } from "./voiceActivation.ts";
import { ensureModel, modelPresent, PARAKEET_FAST_MODEL, PARAKEET_MODEL } from "./voiceModels.ts";
import { hudView, utteranceCaption } from "./voiceHud.ts";
import type { AssistantActions } from "../screen/ScreenCompanion.ts";
import { focusedFolder } from "../screen/focusedFolder.ts";
import { createVoicePill, type VoicePill } from "./voicePill.ts";
import { frameLevel, isCancelPhrase, type TurnEvent } from "@t3tools/baton-shared/voiceTurn";
import {
  biasTranscript,
  correctionsBetween,
  learnCorrection,
  observeWording,
  addNever,
  parseNever,
  type NeverList,
  parseAddToDictionary,
  upsertEntry,
  type SeenWords,
  type VocabularyEntry,
} from "@t3tools/baton-shared/vocabulary";
import { CLEANUP_FAILED_LINE, settleOneShot } from "@t3tools/baton-shared/dictationOneShot";
import { createOneShot } from "./oneShotDictation.ts";
import {
  clipPaths,
  freeBytesOf,
  runRetention,
  saveClip,
  saveGate,
  spaceUsed,
  type KeepSettings,
} from "./audioKeep.ts";
import { createVocabToast } from "./vocabToast.ts";
import { WAIT_DEFAULT_MS, clampWait } from "@t3tools/baton-shared/endOfTurn";
import { wakeWordHeard } from "@t3tools/baton-shared/wakeVerify";
import { CUE_GAIN, CUE_WAIT_MS, parseCueLevel, type CueLevel } from "./pillSounds.ts";
import { openHistory, type HistoryTurn, type TidyStatus } from "./history.ts";
import { NO_RECORDING, retryPlan, rowMenu, useVersion, withRetry } from "./historyRetry.ts";
import { makeOpusEncoder } from "./opusEncoder.ts";
import { computeInsights } from "./insights.ts";
import { readCaretContext } from "./caretContext.ts";
import { describeJobs } from "../agent/jobText.ts";
import { describeWatch } from "@t3tools/baton-shared/watch";
import {
  freshFindings,
  inQuietHours,
  morningBrief,
  noticeLine,
} from "@t3tools/baton-shared/attention";
import { contextFromLastInsert, fitInsertion } from "@t3tools/baton-shared/dictationFit";
import { loginItemOn, setLoginItem } from "./loginItem.ts";
import { warmUpVoice } from "./warmUp.ts";
import { makeTestAudioInput, type TestAudioEvent } from "./testAudio.ts";
import { startVoiceLoop, type VoiceLoop } from "./voiceLoop.ts";
import type { AudioInputDevice, AudioInputProvider, VoiceState } from "./voiceTypes.ts";

// Windows types into whatever has focus; there is no narrower target to name.
const FOCUSED_FIELD: BatonFocusTarget = {
  producer: "desktop",
  kind: "editable",
  label: "the focused field",
  injectable: true,
  origin: null,
};

interface MicSetting {
  /** Part of the device name, as Windows shows it. */
  readonly name: string;
  /** One input of a multi-input interface, zero-based; null mixes them. */
  readonly channel: number | null;
}

interface VoiceSettings {
  /** Always-listening is opt-in: a microphone that opens itself is not a default. */
  readonly enabled: boolean;
  readonly openAtLogin: boolean;
  readonly pinnedLabel: string | null;
  /** Where the wake and VAD models are; null = the ones that shipped with the app. */
  readonly modelsDir: string | null;
  /** Tried in order when nothing is pinned, and when the pin is unplugged. */
  readonly micOrder: ReadonlyArray<MicSetting>;
  /** "wispr": Baton holds no dictation key and leaves Wispr Flow to do it. */
  /** Baton's window: System follows Windows. */
  readonly appearance: Appearance;
  /** The soft cues when listening starts, when a turn ends, after a long wait and on an error. */
  readonly cues: CueLevel;
  /** Hold-key dictation plays no cue unless he asks. */
  readonly holdKeyCues: boolean;
  /** How long a pause must last before a spoken turn is over, in ms; unfinished words get longer. */
  readonly waitMs: number;
  /** How long it listens after the wake word with nothing said, in ms. */
  readonly wakeListenMs: number;
  /** How long the conversation stays open after a reply, in ms. */
  readonly conversationOpenMs: number;
  /** Recognise the audio before a wake and wake only when the wake word is in it. */
  readonly verifyWake: boolean;
  /** Words he fixes after Tessaya writes them, and names he keeps using, join his vocabulary. */
  readonly learnWords: boolean;
  /** Keep the audio of dictations and spoken turns (Opus), never anything else. Off until he says so. */
  readonly keepVoice: boolean;
  readonly keepDays: number;
  /** Gigabytes of corrected clips kept past the days. */
  readonly keepCapGb: number;
  /** A small mark while idle; nothing on screen otherwise. */
  readonly pillAtRest: boolean;
  /** A line when something first needs him: Off, a card only, or said aloud as well. */
  readonly noticeMode: "off" | "written" | "spoken";
  /** "22-8" is silent from 22:00 to 08:00; "none" is never silent. */
  readonly quietHours: string;
  readonly briefMode: "off" | "written" | "spoken";
  /** Repositories whose ledger labels count in "what needs me" (read-only, gh), and a deadlines file. */
  readonly needsRepos: ReadonlyArray<string>;
  readonly needsDeadlinesFile: string | null;
  /** The day (local) the morning brief was last given, so it comes once. */
  readonly briefDay: string | null;
  readonly pillEdge: "bottom" | "top";
  readonly dictation: "baton" | "wispr";
  /** "v3" is many languages at 740 MB; "fast" is English only, 229 MB, 3.4x quicker. */
  readonly speechModel: "v3" | "fast";
  readonly holdKey: string;
  readonly toggleKey: string;
  readonly paste: PasteMethod;
  /** null lets Parakeet detect the language. */
  readonly language: string | null;
  /** "claude" adds his own Claude for what code cannot settle; see dictationRewriter.ts. */
  readonly dictationCleanup: CleanupLevel;
  /** He picked it himself; a value this branch saved for him does not count (D114). */
  readonly dictationCleanupChosen?: boolean;
  /** A family alias, on his subscription. */
  readonly cleanupModel: string;
  readonly claudeBinary: string;
  /** His writing mode for an app, by exe name; anything else is chosen from the app. */
  readonly appModes: Readonly<Record<string, DictationMode>>;
  /** All enabled words listen at once. A new word needs `<word>.onnx` in `<state dir>/voice/models`. */
  readonly wakeWords: ReadonlyArray<WakeWordSetting>;
  /** How dictated words arrive: all at once, or as they are said. The engine reads this key. */
  readonly "dictation.delivery"?: "oneshot" | "stream";
  /** Keys and mouse buttons he set for actions; an action not listed has its default (D141). */
  readonly bindings: ReadonlyArray<Binding>;
}

const DEFAULT_SETTINGS: VoiceSettings = {
  enabled: false,
  openAtLogin: false,
  pinnedLabel: null,
  modelsDir: null,
  // Empty on purpose: a machine lists the interfaces it prefers in its own settings file.
  micOrder: [],
  appearance: "system",
  cues: "normal",
  holdKeyCues: false,
  waitMs: WAIT_DEFAULT_MS,
  wakeListenMs: 8_000,
  conversationOpenMs: 30_000,
  verifyWake: true,
  learnWords: true,
  keepVoice: false,
  keepDays: 30,
  keepCapGb: 2,
  pillAtRest: false,
  noticeMode: "written",
  quietHours: "22-8",
  briefMode: "written",
  needsRepos: [],
  needsDeadlinesFile: null,
  briefDay: null,
  pillEdge: "bottom",
  dictation: "baton",
  speechModel: "v3",
  // Clear of Wispr Flow's defaults: Ctrl+Win, Ctrl+Win+Space, Ctrl+Alt+Win.
  holdKey: "Ctrl+Alt+Space",
  toggleKey: "Ctrl+Alt+Shift+Space",
  paste: "ctrl_v",
  language: "en",
  // Local until D31 is ruled on: "claude" sends flagged dictation to Anthropic (D105).
  dictationCleanup: "local",
  cleanupModel: "haiku",
  claudeBinary: "claude",
  appModes: {},
  wakeWords: FRESH_WAKE_WORDS,
  bindings: [],
};

/** The renderer has this long to answer an intent call before the core is told it failed. */
const REQUEST_TIMEOUT_MS = 20_000;
/** Under the context bus's 30 s TTL, so what Baton has open never expires while it is open. */
const CONTEXT_REFRESH_MS = 10_000;
/** Long enough for him to fix a word in the field before it is read back. */
const LEARN_READBACK_MS = 8_000;
/** How soon a plugged or unplugged mic is noticed; listing devices costs a few milliseconds. */
const MIC_POLL_MS = 5_000;
/** The pointer does not wait on a slow accessibility tree. */
const LOCATE_TIMEOUT_MS = 1_500;
const LOCATE_MAX_DIP = 160;

const readSettings = (path: string): VoiceSettings => {
  try {
    const saved: Record<string, unknown> = JSON.parse(NodeFS.readFileSync(path, "utf8"));
    return {
      ...DEFAULT_SETTINGS,
      wakeWords: wakeWordsFor(saved),
      bindings: parseBindings(saved["bindings"]),
      learnWords: saved["learnWords"] !== false,
      appearance: parseAppearance(saved["appearance"]),
      ...cleanupFromSaved(saved),
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
};

/** Longer than the spoken 15 s, for reading; a typed yes must still run out. */
const TYPED_CONFIRM_MS = 30_000;
const APP_CHECK_MS = 500;
/** Long enough to read a sentence that did not land where it was meant to. */
const KEPT_TEXT_MS = 20_000;
const SESSIONS_NOTE_MS = 8_000;
/** Jobs change slowly; a local read every so often once he has loaded them. */
const JOBS_REFRESH_MS = 15_000;
const ATTENTION_MS = 5 * 60_000;
/** Changes this close together make one tray and window update. */
const RENDER_COALESCE_MS = 40;

/**
 * A value that costs file reads, kept for a few seconds: the window asks for its rows on every update, and
 * the folders do not change that fast. `reset` after anything that does change them.
 */
const cachedFor = <T>(ms: number, make: () => T) => {
  let at = -Infinity;
  let value: T;
  const get = (): T => {
    const now = Date.now();
    if (now - at > ms) {
      value = make();
      at = now;
    }
    return value;
  };
  return Object.assign(get, { reset: () => void (at = -Infinity) });
};
/** The choices for how long it listens. Eight seconds and 30 s are the defaults; the wait covers only the start of speech. */
export const LISTEN_AFTER_WAKE_MS: ReadonlyArray<number> = [4_000, 6_000, 8_000, 12_000];
export const CONVERSATION_MS: ReadonlyArray<number> = [15_000, 30_000, 60_000, 120_000];
const BRIEF_HOUR = 8;
const MIC_TEST_MS = 4_000;
const PILL_TEXT_CHARS = 90;
const STOP_DICTATING_HINT = "Say “stop dictating” when you're done";

/**
 * The tray mark: the logo's hinted cut for the taskbar's own theme (white on dark, black on light), at
 * every size Windows may ask for (100, 125, 150, 200, 250 and 300 %), with the state as a dot.
 */
const trayIconCache = new Map<string, Electron.NativeImage>();
const trayIcon = (options: MarkOptions): Electron.NativeImage => {
  const dark = Electron.nativeTheme.shouldUseDarkColorsForSystemIntegratedUI;
  // Six PNGs decoded and drawn on per call: the same few states come round again and again.
  const key = `${dark}|${JSON.stringify(options)}`;
  const known = trayIconCache.get(key);
  if (known !== undefined) return known;
  const image = Electron.nativeImage.createEmpty();
  for (const size of TRAY_SIZES) {
    const source = Electron.nativeImage.createFromBuffer(
      Buffer.from(TRAY_PNG[`${dark ? "white" : "black"}-${size}`]!, "base64"),
    );
    image.addRepresentation({
      scaleFactor: size / 16,
      width: size,
      height: size,
      buffer: withTrayState(source.toBitmap(), size, options, dark),
    });
  }
  if (trayIconCache.size > 32) trayIconCache.clear();
  trayIconCache.set(key, image);
  return image;
};

export interface VoiceCoreHooks {
  /** The core router's intent calls, answered by the Baton window and the paste adapter. */
  readonly intent: VoiceIntentClient;
  /** Replies and confirmation prompts, shown on the HUD's line. */
  readonly onReply: (text: string) => void;
  readonly settings: {
    readonly modelsDir: string | null;
    readonly wakeWords: ReadonlyArray<WakeWordSetting>;
  };
  /** Parakeet, in the dictation sidecar. */
  readonly stt: SttProvider;
  /** Everything the core reports, for the cue after a wake word. */
  readonly onEvent: (event: VoiceCoreEvent) => void;
  /** "Add X to my dictionary": the reply to speak, or null when the words were something else. */
  readonly vocabulary: (text: string) => Promise<string | null>;
  /** How long he must be quiet for a turn to be over, read each turn. */
  readonly waitMs: () => number;
  /** How long the command window and the conversation stay open. */
  readonly listening: () => { readonly commandWindowMs: number; readonly conversationMs: number };
  /** The second check before a wake from sleep: was the wake word really said. */
  readonly verifyWake: (pcm: Int16Array, word: string | null) => Promise<boolean>;
}

/** The assistant, as the voice side sees it: its tray entries (D84) and the one brain (D100). */
export interface TrayExtras extends BrainVoiceHook {
  readonly menuItems: () => ReadonlyArray<Electron.MenuItemConstructorOptions>;
  readonly controls: () => ReadonlyArray<HomeControl>;
  readonly needsBrainChoice: () => boolean;
  readonly setAskHotkey: (accelerator: string | null) => void;
  readonly signIn: () => Promise<BrainStatus>;
  readonly applySetting: (id: string, value: string | boolean | null) => void;
  readonly setActions: (actions: AssistantActions) => void;
  readonly notice: (text: string) => void;
  /** An unprompted line: a card, and aloud when `speak` and spoken answers are on. */
  readonly announce: (text: string, speak: boolean) => void;
  readonly writtenOnly: () => boolean;
  readonly ask: (input: {
    readonly title: string;
    readonly detail: string;
    readonly buttons: ReadonlyArray<string>;
    readonly cancel: number;
    readonly expiresMs?: number;
  }) => Promise<number>;
}

export interface DesktopBatonVoiceInput {
  readonly stateDir: string;
  /** The one conversation (D142), shared with the screen side. */
  readonly conversation?: ConversationLog;
  /** Every reply and refusal worth the turn log. */
  readonly onNote?: (kind: string, fields: Readonly<Record<string, unknown>>) => void;
  /** Where the turn log and the lifecycle log are, for Home and Checks. */
  readonly logDir: string;
  readonly appVersion: string;
  readonly env: NodeJS.ProcessEnv;
  /** `HostProcessPlatform`, injected rather than read here. */
  readonly platform: string;
  /** The main window, created if needed — where session and intent words go. */
  readonly ensureMainWindow: () => Promise<Electron.BrowserWindow>;
  /** The voice core (`@t3tools/baton-voice`); null leaves the tray saying so. */
  readonly makeCore: ((hooks: VoiceCoreHooks) => Promise<BatonVoiceCore>) | null;
  /** His environment, for the `claude` that cleans text up. */
  /** `baton-dictation`; null only in a build that left it out. */
  readonly dictationBinary: string | null;
  /** A wake word cut across Baton's voice. */
  readonly onBargeIn?: () => void;
  readonly extras?: TrayExtras;
  /** The Sessions area's rows and actions (D138). */
  readonly sessions?: SessionsBridge;
  /** Baton's self-update (D137): its rows, its action, and whether one is waiting. */
  readonly updates?: BatonUpdates;
  /** Where the wake and listening models are, for the Check area. */
  readonly voiceAssets?: (modelsDir: string | null) => VoiceAssets;
  readonly holdEscape: (onPress: () => void, rank?: EscapeRank) => () => void;
  /** What to do when he dismisses a turn: stop Baton's voice, and the same for the assistant. */
  readonly onDismiss?: () => void;
  /** He said stop over Baton's voice. The tray's dismiss; the window stays open. */
  readonly onSpokenStop?: () => void;
  /** Plays one fixed line in a voice (null: the chosen one), for the Voice page's Play. */
  readonly audition?: (voice: string | null) => void;
  /** Bring the main window up, however it was left. */
  readonly openMainWindow: () => void;
  /** Wake-to-pill, for the record. */
  readonly onWakeShown?: (ms: number) => void;
  /** Each change of what the pill says, and "idle" when it goes: for the turn log. */
  readonly onPillState?: (phase: string) => void;
  /** How a pill drag ended, for the turn log. */
  /** BATON_TEST_WAV is set: the start of the recording, each file as it begins, and its end, for the turn log. */
  /** The Run entry name the installer writes: the app's AppUserModelId. */
  readonly loginEntry: string;
  readonly onTestAudio?: (event: TestAudioEvent) => void;
  readonly onPillDrag?: (outcome: {
    readonly reason: string;
    readonly dx: number;
    readonly dy: number;
    readonly ms: number;
  }) => void;
}

export interface DesktopBatonVoice {
  /** Rebuild the tray menu, after the companion's state changed. */
  readonly refresh: () => void;
  /** In the middle of a turn: speaking, or listening past the wake word. */
  readonly busy: () => boolean;
  /** Bring Baton's own window up. */
  readonly openHome: () => void;
  /** Baton's voice started or stopped. */
  readonly onSpeaking: (active: boolean) => void;
  /** A sentence going to the speakers. */
  readonly onSpoken: (text: string) => void;
  /** The assistant finished a turn. */
  readonly onTurnEnd: () => void;
  /** The assistant is looking, planning or driving; null when it stops. */
  readonly onActivity: (label: string | null, caption?: string) => void;
  /** How loud Baton's voice is right now, for the pill. */
  readonly onSpeechLevel: (level: number) => void;
  /** He dismissed the assistant's output. */
  readonly onDismissed: () => void;
  /** A line for the tray: a voice downloading, or why it could not. */
  readonly onNote: (message: string | null) => void;
}

const wordName = (word: string | null): string | null =>
  word === null ? null : `${word[0]!.toUpperCase()}${word.slice(1)}`;

export const startDesktopBatonVoice = (input: DesktopBatonVoiceInput): DesktopBatonVoice => {
  // Legacy name (D71): existing settings live in this file, so it keeps "fabric".
  const settingsPath = NodePath.join(input.stateDir, "fabric-voice.json");
  let settings = readSettings(settingsPath);
  const save = (next: Partial<VoiceSettings>) => {
    settings = { ...settings, ...next };
    NodeFS.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  };

  const tray = new Electron.Tray(
    trayIcon({
      color: hudView("sleeping").color,
      caps: [settings.enabled, false, false],
      muted: false,
    }),
  );
  // Renamed from Baton: drop the old login entry, and write the one he asked for for the new exe.
  if (input.platform === "win32") {
    Electron.app.setLoginItemSettings({ openAtLogin: false, name: "Baton" });
    // The switch follows the real entry (the installer writes it too); an entry from an older exe is rewritten.
    if (loginItemOn(Electron.app, input.loginEntry))
      setLoginItem(Electron.app, input.loginEntry, true);
  }
  // Only now is there something to quit from, and a way back to a window.
  keepRunningForTray();
  // A left click is what an icon invites, and without this it did nothing on Windows.
  tray.on("click", () => home.open());
  const modelsDir = NodePath.join(input.stateDir, "voice", "models");
  const binary = input.dictationBinary;
  let sidecar: DictationSidecar | null = null;
  let parakeetPath: string | null = null;
  let modelJob: Promise<string> | null = null;
  let sidecarDevices: ReadonlyArray<SidecarDevice> = [];
  let releaseRecordingEscape: (() => void) | null = null;
  let lastDictation: string | null = null;
  /** What Baton last answered, so Copy last transcript can take it; cleared by his next words. */
  let lastReply: string | null = null;
  let spokenTurnId: string | null = null;
  let focusedApp: FocusedApp = { exe: "", title: "" };
  let dictionary: ReadonlyArray<VocabularyEntry> = [];
  let seenWords: SeenWords = {};
  const seenPath = NodePath.join(input.stateDir, "voice", "vocabulary-seen.json");
  try {
    seenWords = JSON.parse(NodeFS.readFileSync(seenPath, "utf8")) as SeenWords;
  } catch {}
  const changeVocabulary = async (
    change: (
      entries: ReadonlyArray<VocabularyEntry>,
      now: string,
    ) => ReadonlyArray<VocabularyEntry>,
  ) => {
    dictionary = await writeDictionary(input.stateDir, (entries) =>
      change(entries, new Date().toISOString()),
    );
  };
  const saveSeen = () => {
    try {
      NodeFS.mkdirSync(NodePath.dirname(seenPath), { recursive: true });
      NodeFS.writeFileSync(seenPath, JSON.stringify(seenWords));
    } catch {}
  };
  // Words he deleted or discarded never come back by themselves.
  const neverPath = NodePath.join(input.stateDir, "voice", "vocabulary-never.json");
  let never: NeverList = [];
  try {
    never = parseNever(JSON.parse(NodeFS.readFileSync(neverPath, "utf8")));
  } catch {}
  const rememberNever = (words: ReadonlyArray<string>) => {
    never = words.reduce(addNever, never);
    try {
      NodeFS.mkdirSync(NodePath.dirname(neverPath), { recursive: true });
      NodeFS.writeFileSync(neverPath, JSON.stringify(never));
    } catch {}
  };
  const toast = createVocabToast({
    anchor: () => pill.anchor(),
    onDiscard: (words) => {
      rememberNever(words);
      void changeVocabulary((entries) =>
        words.reduce(
          (all, word) =>
            all.filter(
              (e) =>
                e.phrase.toLowerCase() !== word.toLowerCase() &&
                (e.replacement ?? "").toLowerCase() !== word.toLowerCase(),
            ),
          entries,
        ),
      );
    },
  });
  const announce = (added: ReadonlyArray<VocabularyEntry>) => {
    for (const entry of added) toast.add(entry.replacement ?? entry.phrase);
  };
  /** Names and terms he keeps using join the vocabulary once they repeat. */
  const learnWording = (text: string) => {
    if (!settings.learnWords) return;
    void changeVocabulary((entries, now) => {
      const next = observeWording(
        seenWords,
        entries,
        text,
        now,
        settings.wakeWords.map((w) => w.word),
        never,
      );
      seenWords = next.seen;
      saveSeen();
      announce(next.added);
      return next.entries;
    }).catch(() => undefined);
  };
  /** A few seconds later, what he changed in the field teaches the words he meant. */
  const learnFromEdits = (written: string, turnId: string | null = null) => {
    if (!settings.learnWords) return;
    setTimeout(() => {
      void readCaretContext(input.platform).then((around) => {
        if (around === null || written.trim().length === 0) return;
        const tail = around.before.slice(-(written.length + 2)).trim();
        const fixes = correctionsBetween(written.trim(), tail);
        if (fixes.length === 0) return;
        if (turnId !== null) history?.update(turnId, { corrected: true, fixed: tail });
        return changeVocabulary((entries, now) =>
          fixes.reduce((all, fix) => {
            const next = learnCorrection(seenWords, all, fix, now, never);
            seenWords = next.seen;
            announce(next.added);
            return next.entries;
          }, entries),
        ).then(saveSeen);
      });
    }, LEARN_READBACK_MS).unref();
  };
  let keptTimer: ReturnType<typeof setTimeout> | null = null;
  let recordFailures = 0;
  let audio: AudioInputProvider | null = null;
  let core: BatonVoiceCore | null = null;
  const clipboardInjection = makeClipboardInjection({
    platform: input.platform,
    clipboard: Electron.clipboard,
  });
  const rewriter = makeRewriter({
    claudeBinary: settings.claudeBinary,
    model: settings.cleanupModel,
    workDir: NodePath.join(input.stateDir, "voice", "cleanup"),
    env: input.env,
    platform: input.platform,
    dictionary: () => dictionary,
  });
  /** Held to where the words came from and where he is now. Unknown counts as secret. */
  const levelNow = async (spokenIn: { readonly exe: string; readonly title: string }) => {
    const now = await Promise.race([
      sidecar?.foreground().catch(() => null) ?? Promise.resolve(null),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), APP_CHECK_MS)),
    ]);
    return strictestCleanup(settings.dictationCleanup, [spokenIn, now ?? { exe: "", title: "" }]);
  };
  /** What Baton last put in a field, where an app will not say what is around the caret. */
  let lastInsert: { text: string; at: number; key: string } | null = null;
  const windowKey = (app: { readonly exe: string; readonly title: string }) =>
    `${app.exe}\n${app.title}`;
  /** The text made to fit the words already there: spacing, capitals, punctuation. */
  const fitToCaret = async (
    text: string,
    app: { readonly exe: string; readonly title: string },
  ): Promise<string> => {
    const key = windowKey(app);
    const around =
      (await readCaretContext(input.platform)) ??
      contextFromLastInsert(
        lastInsert === null ? null : { ...lastInsert, sameWindow: lastInsert.key === key },
        Date.now(),
      );
    const fitted = around === null ? text : fitInsertion(around, text);
    lastInsert = { text: fitted, at: Date.now(), key };
    return fitted;
  };
  // Everything he says and what it became, kept forever on this machine (the History tab).
  const history = (() => {
    try {
      return openHistory(NodePath.join(input.stateDir, "voice", "history.sqlite"));
    } catch {
      return null;
    }
  })();
  const audioDir = NodePath.join(input.stateDir, "voice", "recordings");
  const keepSettings = (): KeepSettings => ({
    enabled: settings.keepVoice,
    days: settings.keepDays,
    capBytes: settings.keepCapGb * 1024 ** 3,
    minFreeBytes: 5 * 1024 ** 3,
  });
  const encoder = makeOpusEncoder();
  let keepNote: string | null = null;
  /** Saves a clip for a turn, in the background, if he asked for it and the drive has room. */
  const keepAudio = (turnId: string | null, pcm: Int16Array | null) => {
    if (history === null || turnId === null || pcm === null || pcm.length === 0) return;
    const gate = saveGate(keepSettings(), freeBytesOf(input.stateDir));
    keepNote = gate.ok ? null : settings.keepVoice ? gate.reason : null;
    if (!gate.ok) return;
    void encoder
      .encode(pcm)
      .then((bytes) => {
        const saved = saveClip({
          dir: audioDir,
          id: `${turnId}-${Date.now().toString(36)}`,
          bytes,
          at: new Date(),
          keep: keepSettings(),
          freeBytes: freeBytesOf(input.stateDir),
        });
        if (saved.path === null) return;
        const turn = history.get(turnId);
        history.update(turnId, {
          audio: [
            ...(turn?.audio === null || turn === null ? [] : clipPaths(turn.audio)),
            saved.path,
          ].join("\n"),
        });
      })
      .catch(() => undefined);
  };
  let lastPcm: Int16Array | null = null;
  const _tidyStatus = (stage: string | undefined, failed: boolean): TidyStatus =>
    failed ? "raw" : stage === "model" || stage === "local" ? "ok" : "raw";
  const record = (turn: {
    readonly kind: "dictation" | "spoken";
    readonly app: string;
    readonly raw: string;
    readonly cleaned: string | null;
    readonly status: TidyStatus;
    readonly model?: string | null;
    readonly delivery: string | null;
    readonly error?: string | null;
    readonly seconds?: number | null;
  }): string | null => {
    if (history === null || turn.raw.trim().length === 0) return null;
    try {
      return history.add({
        at: new Date().toISOString(),
        kind: turn.kind,
        app: turn.app,
        raw: turn.raw,
        cleaned: turn.cleaned,
        status: turn.status,
        model: turn.model ?? null,
        delivery: turn.delivery,
        error: turn.error ?? null,
        seconds: turn.seconds ?? null,
      });
    } catch {
      return null;
    }
  };
  const retention = () => {
    if (history !== null) runRetention({ history, now: Date.now(), keep: keepSettings() });
  };
  setTimeout(retention, 30_000).unref();
  setInterval(retention, 24 * 3_600_000).unref();
  let retrying: string | null = null;
  const withMenu = (turn: HistoryTurn) => ({ ...turn, menu: rowMenu(turn, retrying !== null) });
  const listHistory = (query: string) => (history?.list({ query, limit: 300 }) ?? []).map(withMenu);
  Electron.ipcMain.handle("baton-history:list", (event, query: unknown) =>
    Electron.BrowserWindow.fromWebContents(event.sender) === null
      ? []
      : listHistory(typeof query === "string" ? query : ""),
  );
  Electron.ipcMain.handle("baton-history:act", async (event, id: unknown, action: unknown) => {
    if (Electron.BrowserWindow.fromWebContents(event.sender) === null || history === null)
      return null;
    if (typeof id !== "string" || typeof action !== "string") return null;
    const turn = history.get(id);
    if (turn === null) return null;
    if (action === "copy_raw") void Electron.clipboard.writeText(turn.raw);
    else if (action === "copy") {
      void Electron.clipboard.writeText(turn.cleaned ?? turn.raw);
    } else if (action === "copy_cleaned")
      void Electron.clipboard.writeText(turn.cleaned ?? turn.raw);
    else if (action.startsWith("copy_version:")) {
      const v = useVersion(turn, Number(action.slice("copy_version:".length)));
      if (v !== null) void Electron.clipboard.writeText(v.cleaned ?? v.raw);
    } else if (action.startsWith("use_version:")) {
      const v = useVersion(turn, Number(action.slice("use_version:".length)));
      if (v !== null) history.update(id, { raw: v.raw, cleaned: v.cleaned, model: v.model });
    } else if (action === "delete") {
      history.remove(id);
      for (const path of clipPaths(turn.audio ?? "")) NodeFS.rmSync(path, { force: true });
      return { deleted: true };
    } else if (action === "retry_transcript") {
      // Not while he is dictating, and one at a time. The original stays as it was if this fails.
      if (retrying !== null || dictatingByVoice || releaseRecordingEscape !== null) {
        return { failed: "Not now: finish dictating first" };
      }
      if (retryPlan(turn).kind !== "transcript" || sidecar === null) {
        return { failed: retryPlan(turn).kind === "transcript" ? "Retry failed" : NO_RECORDING };
      }
      retrying = id;
      try {
        const parts: Int16Array[] = [];
        for (const path of clipPaths(turn.audio ?? "")) {
          parts.push(await encoder.decode(NodeFS.readFileSync(path)));
        }
        const pcm = new Int16Array(parts.reduce((n, p) => n + p.length, 0));
        let at = 0;
        for (const p of parts) {
          pcm.set(p, at);
          at += p.length;
        }
        const heard = (await makeSidecarStt(sidecar).transcribe(pcm)).trim();
        if (heard === "") throw new Error("nothing recognised");
        let cleaned: string | null = null;
        let model: string | null = null;
        if (turn.kind === "dictation") {
          const tidy = await rewriter
            .clean({
              raw: biasTranscript(heard, dictionary),
              mode: chooseMode({ exe: turn.app, title: "" }, settings.appModes),
              level: settings.dictationCleanup === "off" ? "local" : "claude",
            })
            .catch(() => null);
          const settled = settleOneShot(heard, tidy);
          cleaned = settled.text;
          model = settled.failed ? null : settings.cleanupModel;
        }
        history.update(id, {
          versions: withRetry(turn, { at: new Date().toISOString(), raw: heard, cleaned, model }),
        });
      } catch {
        return { failed: "Retry failed" };
      } finally {
        retrying = null;
      }
    } else if (action === "retry") {
      // Re-runs the tidy-up on the stored words; nothing is inserted unless he copies it.
      const cleaned = await rewriter
        .clean({
          raw: biasTranscript(turn.raw, dictionary),
          mode: chooseMode({ exe: turn.app, title: "" }, settings.appModes),
          level: settings.dictationCleanup === "off" ? "local" : "claude",
        })
        .catch(() => null);
      const { text, failed } = settleOneShot(turn.raw, cleaned);
      history.update(id, {
        cleaned: text,
        status: failed ? "failed" : "ok",
        model: failed ? null : settings.cleanupModel,
        error: failed ? "Clean-up failed again" : null,
      });
    }
    const after = history.get(id);
    return after === null ? null : withMenu(after);
  });

  // Spoken dictation, all at once: the chunks wait here, on disk too, until one clean paste.
  const pendingFile = NodePath.join(input.stateDir, "voice", "dictation-pending.json");
  let collecting = false;
  let flushApp: { readonly exe: string; readonly title: string } = { exe: "", title: "" };
  const restored = ((): Array<string> => {
    try {
      return JSON.parse(NodeFS.readFileSync(pendingFile, "utf8")) as Array<string>;
    } catch {
      return [];
    }
  })();
  if (restored.length > 0) {
    lastDictation = restored.join(" ");
    setTimeout(() => {
      note = "A dictation was not inserted. Tray: Copy last transcript.";
      render();
    }, 0);
  }
  const oneShot = createOneShot(
    {
      save: (chunks) => {
        try {
          NodeFS.mkdirSync(NodePath.dirname(pendingFile), { recursive: true });
          if (chunks.length === 0) NodeFS.rmSync(pendingFile, { force: true });
          else NodeFS.writeFileSync(pendingFile, JSON.stringify(chunks));
        } catch {}
      },
      clean: async (raw) =>
        rewriter.clean({
          raw: biasTranscript(raw, dictionary),
          mode: chooseMode(flushApp, settings.appModes),
          level: await levelNow(flushApp),
        }),
      fit: (text) => fitToCaret(text, flushApp),
      paste: (text) =>
        sidecar === null
          ? Promise.resolve(false)
          : sidecar.paste(text).then(
              () => true,
              () => false,
            ),
    },
    restored,
  );
  let openTurn: string | null = null;
  const flushDictation = async () => {
    collecting = false;
    if (oneShot.pending().length === 0 || sidecar === null) return;
    pill.on({ type: "thinking" });
    flushApp = await sidecar.foreground().catch(() => focusedApp);
    const raw = oneShot.pending().join(" ");
    const turnId = openTurn;
    openTurn = null;
    const result = await oneShot.flush();
    if (result.status === "empty") return;
    lastDictation = result.text;
    history?.update(turnId ?? "", {
      raw,
      cleaned: result.text,
      status: result.failed ? "raw" : "ok",
      model: result.failed ? null : settings.cleanupModel,
      error: result.failed
        ? "Clean-up failed, inserted what was heard"
        : result.status === "kept"
          ? "Not pasted"
          : null,
    });
    if (result.status === "pasted") {
      learnWording(result.text);
      learnFromEdits(result.text, turnId);
      pill.on(
        result.failed
          ? { type: "trouble", message: CLEANUP_FAILED_LINE }
          : { type: "done", label: "Pasted" },
      );
    } else {
      keepText("Not pasted", result.text);
    }
  };
  const injection: typeof clipboardInjection = {
    ...clipboardInjection,
    // The sidecar pastes on every platform, where Electron alone cannot.
    canInject: (target) => binary !== null || clipboardInjection.canInject(target),
    // Handy's paste keeps his clipboard; PowerShell's stays for when the sidecar is not there.
    insertText: async (request) => {
      if (sidecar === null) return clipboardInjection.insertText(request);
      if (collecting) {
        oneShot.push(request.text);
        const joined = oneShot.pending().join(" ");
        if (openTurn === null) {
          openTurn = record({
            kind: "dictation",
            app: "",
            raw: joined,
            cleaned: null,
            status: "none",
            delivery: "oneshot",
            seconds: (lastPcm?.length ?? 0) / 16_000,
          });
        } else {
          history?.update(openTurn, {
            raw: joined,
            seconds: (history.get(openTurn)?.seconds ?? 0) + (lastPcm?.length ?? 0) / 16_000,
          });
        }
        keepAudio(openTurn, lastPcm);
        return;
      }
      // Wake-word dictation takes the same path as the hold key, so the same text comes out.
      const app = await sidecar.foreground().catch(() => focusedApp);
      const { text } = await rewriter.clean({
        raw: biasTranscript(request.text, dictionary),
        mode: chooseMode(app, settings.appModes),
        level: await levelNow(app),
      });
      return sidecar.paste(await fitToCaret(text, app));
    },
  };
  // Only where this desktop can paste is the focused field a dictation target.
  const field = injection.canInject(FOCUSED_FIELD) ? FOCUSED_FIELD : null;

  let state: VoiceState = "sleeping";
  let devices: ReadonlyArray<AudioInputDevice> = [];
  let choice: DeviceChoice = { kind: "default", deviceId: null, reason: "Not started." };
  let loop: VoiceLoop | null = null;
  let note: string | null = input.makeCore === null ? "Voice core not installed." : null;
  let focusedWorkSessionId: string | null = null;
  let contextTimer: ReturnType<typeof setInterval> | null = null;

  const deviceName = () => (choice.kind === "pinned" ? choice.device.label : "System microphone");
  const markOptions = (): MarkOptions => {
    const on = (id: string) =>
      input.extras?.controls().some((c) => c.id === id && c.kind === "toggle" && c.on) ?? false;
    return {
      color: hudView(state).color,
      caps: [settings.enabled, on("s.capture"), on("s.act")],
      muted: state === "muted",
      badge: input.updates?.ready() ?? false,
    };
  };
  // The taskbar's theme changes the tray mark's colour (white on dark, black on light).
  Electron.nativeTheme.on("updated", () => render());
  const renderNow = () => {
    pill.setReason(loop === null ? "off" : state === "muted" ? "muted" : "sleeping");
    tray.setImage(trayIcon(markOptions()));
    tray.setToolTip(
      `Tessaya: ${hudView(state).label} · ${deviceName()}${note ? ` · ${note}` : ""}`,
    );
    rebuildMenu();
  };
  // Several changes in a burst (a state, a note, a reply) repaint the tray, rebuild its menu and push the whole
  // window state once, not once each.
  let renderTimer: ReturnType<typeof setTimeout> | null = null;
  const render = () => {
    if (renderTimer !== null) return;
    renderTimer = setTimeout(() => {
      renderTimer = null;
      renderNow();
    }, RENDER_COALESCE_MS);
  };
  /** A reply to something said: on the pill, and in full when nothing will read it out. */
  const flash = (caption: string) => {
    if (input.extras?.writtenOnly() === true) input.extras.notice(caption);
    else pill.on({ type: "done", label: caption.slice(0, PILL_TEXT_CHARS) });
    render();
  };

  // The intent RPCs live in the Baton window's renderer: main asks, it answers.
  let nextRequest = 0;
  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
  >();
  let mainContents: Electron.WebContents | null = null;
  const request = async (body: VoiceIntentRequest | BatonJobBridgeRequest): Promise<unknown> => {
    const window = await input.ensureMainWindow();
    mainContents = window.webContents;
    const id = ++nextRequest;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error("Tessaya did not answer."));
      }, REQUEST_TIMEOUT_MS);
      pending.set(id, { resolve, reject, timer });
      window.webContents.send(BATON_VOICE_REQUEST_CHANNEL, { id, request: body });
    });
  };
  Electron.ipcMain.on(BATON_VOICE_RESPONSE_CHANNEL, (event, message: unknown) => {
    if (event.sender !== mainContents || typeof message !== "object" || message === null) return;
    const { id, ok, value, error } = message as {
      id?: unknown;
      ok?: unknown;
      value?: unknown;
      error?: unknown;
    };
    const entry = typeof id === "number" ? pending.get(id) : undefined;
    if (entry === undefined) return;
    pending.delete(id as number);
    clearTimeout(entry.timer);
    if (ok === true) entry.resolve(value);
    else entry.reject(new Error(typeof error === "string" ? error : "That could not be done."));
  });
  /** What the sessions side answered joins the one conversation, with what it was about. */
  const requestKept = async (
    body: VoiceIntentRequest | BatonJobBridgeRequest,
  ): Promise<unknown> => {
    const value = await request(body);
    if (body.kind === "run" && input.conversation !== undefined) {
      const run = value as {
        reply?: string;
        resolution?: { outcome?: string; description?: string; workSessionId?: string | null };
      };
      const target =
        run.resolution?.outcome === "resolved" && run.resolution.description !== undefined
          ? {
              label: run.resolution.description,
              ...(typeof run.resolution.workSessionId === "string"
                ? { workSessionId: run.resolution.workSessionId }
                : {}),
            }
          : undefined;
      if (typeof run.reply === "string" && run.reply.length > 0) {
        input.conversation.add({
          route: "act",
          said: body.text,
          reply: run.reply,
          ...(target === undefined ? {} : { target }),
        });
        input.onNote?.("reply", { route: "act", said: body.text, reply: run.reply });
      }
    }
    return value;
  };
  const voiceIntent = makeVoiceIntentClient({
    request: requestKept,
    injection,
    field: FOCUSED_FIELD,
  });
  const typedRouter = createVoiceRouter(voiceIntent);
  const routeContext = () => ({
    bus: desktopVoiceContext({ focusedWorkSessionId, field, observedAt: new Date() }),
    now: Date.now(),
  });
  // A typed ask has no spoken "confirm", so the read-back becomes a box he answers himself.
  input.extras?.setActions({
    sessionsList: () => {
      const rows = input.sessions?.rows() ?? [];
      return rows.length === 0
        ? "No sessions are loaded yet."
        : rows
            .map(
              (r) =>
                `${r.session} (${r.project}, ${r.box}, ${r.state}${r.urgent ? ", needs him" : ""}) [id: ${r.key}]`,
            )
            .join("\n");
    },
    jobs: async (op, args) => {
      if (op === "approvals") {
        const jobs = (await requestKept({ kind: "job", op: "list", args: {} })) as {
          jobs?: ReadonlyArray<BatonJob>;
        } | null;
        return describeApprovals(
          buildApprovals({ jobs: jobs?.jobs ?? [], sessions: input.sessions?.rows() ?? [] }),
        );
      }
      if (op === "needs") {
        const jobs = (await requestKept({ kind: "job", op: "list", args: {} })) as {
          jobs?: ReadonlyArray<BatonJob>;
        } | null;
        return answerNeeds({
          jobs: jobs?.jobs ?? [],
          sessions: input.sessions?.rows() ?? [],
          findings: await watchFindings(),
          config: { repos: settings.needsRepos, deadlinesFile: settings.needsDeadlinesFile },
          now: Date.now(),
        });
      }
      if (op === "brief") {
        const jobs = (await requestKept({ kind: "job", op: "list", args: {} })) as {
          jobs?: ReadonlyArray<BatonJob>;
        } | null;
        return morningBrief({
          jobs: jobs?.jobs ?? [],
          findings: await watchFindings(),
          now: Date.now(),
        });
      }
      const value = (await requestKept({ kind: "job", op, args })) as {
        jobs?: ReadonlyArray<BatonJob>;
        findings?: ReadonlyArray<WatchFinding>;
        terms?: { phase?: string; workSessionId?: string; scheduleTaskId?: string | null } | null;
        stopped?: boolean;
        threadId?: string;
      } | null;
      if (op === "list") return describeJobs(value?.jobs ?? []);
      if (op === "watch") return describeWatch(value?.findings ?? []);
      if (op === "start") {
        return `Started. The worker is writing its plan in its own thread; nothing happens until he agrees. The job id is ${value?.terms?.workSessionId ?? "unknown"}.`;
      }
      if (op === "split") {
        const started = (value as { started?: ReadonlyArray<unknown> } | null)?.started ?? [];
        return started.length === 0
          ? "Nothing was split: the job is not agreed yet, or it has no thread."
          : `Started ${started.length} workers, one per part. One summary will go to the job's thread when they are all in.`;
      }
      if (op === "stop")
        return value?.stopped === true ? "Stopped." : "Nothing was running to stop.";
      if (value?.terms === null || value?.terms === undefined) return "There is no job by that id.";
      if (op === "agree") {
        return value.terms.phase === "approved"
          ? "Agreed. The worker has been told to go ahead."
          : "The plan is not written yet, so nothing started. Ask again when it is ready.";
      }
      if (op === "schedule") {
        return value.terms.scheduleTaskId === null
          ? "It is not scheduled now (only a job he has agreed to can be scheduled)."
          : "Scheduled. Each run reports in the job's own thread.";
      }
      return op === "refine" ? "Passed on. The worker will make the plan again." : "Done.";
    },
    sessionName: (idOrName) => {
      const rows = input.sessions?.rows() ?? [];
      const wanted = idOrName.trim().toLowerCase();
      return (
        rows.find((r) => r.key === idOrName || r.session.toLowerCase() === wanted)?.session ?? null
      );
    },
    dictation: async (on) => {
      if (binary === null || sidecar === null)
        return "Dictation is not available on this computer.";
      if (parakeetPath === null) {
        requestDictation();
        return "The speech model is not downloaded yet; I started fetching it.";
      }
      const recording = releaseRecordingEscape !== null;
      if (on !== recording) sidecar.toggle();
      return on ? "Dictating. He says stop dictating to end it." : "Stopped dictating.";
    },
    focus: async () => {
      const app = await sidecar?.foreground();
      if (app === undefined || app.exe.length === 0) return null;
      const rect = app.rect == null ? null : Electron.screen.screenToDipRect(null, app.rect);
      return {
        label: `${app.exe}: ${app.title}`,
        ...(app.window === undefined ? {} : { window: app.window }),
        centre: rect === null ? null : { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 },
      };
    },
    windowAt: async (point) => {
      if (sidecar === null) return null;
      const physical = Electron.screen.dipToScreenPoint(point);
      return Promise.race([
        sidecar.windowAt(physical).catch(() => null),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), APP_CHECK_MS)),
      ]);
    },
    uiTree: async () => {
      if (sidecar === null) return null;
      const tree = await Promise.race([
        sidecar.uiTree(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), LOCATE_TIMEOUT_MS * 2)),
      ]).catch(() => null);
      if (tree === null || tree.controls === undefined) return null;
      return { window: tree.window ?? "", controls: tree.controls };
    },
    locate: async (label, near, anywhere) => {
      if (sidecar === null) return null;
      const physical = Electron.screen.dipToScreenPoint(near);
      const found = await Promise.race([
        sidecar.locate({
          label,
          x: physical.x,
          y: physical.y,
          ...(anywhere === true ? { foreground: true } : {}),
        }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), LOCATE_TIMEOUT_MS)),
      ]).catch(() => null);
      if (found?.found !== true || found.x === undefined || found.y === undefined) return null;
      const real = Electron.screen.screenToDipPoint({ x: found.x, y: found.y });
      // Same name far from where the model saw it is a different thing.
      if (anywhere !== true && Math.hypot(real.x - near.x, real.y - near.y) > LOCATE_MAX_DIP) {
        return null;
      }
      return { ...real, name: found.name ?? label };
    },
    confirm: (prompt) => core?.confirm(prompt) ?? null,
    folder: (window) => focusedFolder(window, input.platform),
    grammarPlaces: async (said) => {
      if (mainContents === null) return false;
      const resolution = await voiceIntent.resolve({
        text: said,
        focusedWorkSessionId,
        allowModel: false,
      });
      return resolution.outcome === "resolved";
    },
    act: async (command, restated) => {
      const outcome = await typedRouter.route(
        {
          kind: "command",
          text: command,
          inheritedTarget: null,
          ...(restated === true ? { restated } : {}),
        },
        routeContext(),
      );
      if (outcome.kind !== "needs_confirmation") return "reply" in outcome ? outcome.reply : "";
      const response = await (input.extras?.ask({
        title: outcome.prompt.replace(/ Say "confirm" to go ahead\.$/, ""),
        detail: "",
        buttons: ["Go ahead", "Not now"],
        cancel: 1,
        expiresMs: TYPED_CONFIRM_MS,
      }) ?? Promise.resolve(1));
      const next = await typedRouter.route(
        response === 0
          ? { kind: "confirmed", token: outcome.token }
          : { kind: "cancelled", token: outcome.token, reason: "declined" },
        routeContext(),
      );
      return "reply" in next ? next.reply : "";
    },
  });

  const pushContext = () =>
    core?.setContext(desktopVoiceContext({ focusedWorkSessionId, field, observedAt: new Date() }));
  Electron.ipcMain.on(BATON_VOICE_FOCUS_CHANNEL, (event, id: unknown) => {
    // Our own windows only; preview panes load other people's pages.
    if (Electron.BrowserWindow.fromWebContents(event.sender) === null) return;
    focusedWorkSessionId = typeof id === "string" && id.length > 0 ? id : null;
    pushContext();
  });

  const preference = () => ({
    pinnedLabel: settings.pinnedLabel,
    micOrder: settings.micOrder.map((mic) => mic.name),
  });
  const channelFor = (device: string): number | null =>
    micChannel(
      device,
      sidecarDevices.find((known) => known.name === device)?.channels ?? null,
      settings.micOrder,
    );

  /** Every key set for an action, for the sidecar's hotkeys. */
  const keysOf = (action: string): ReadonlyArray<string> =>
    currentBindings()
      .find((row) => row.def.id === action)
      ?.inputs.flatMap((i) => (i.type === "key" ? [i.accelerator] : [])) ?? [];
  let bindingsNote: string | null = null;
  const configureDictation = () => {
    if (sidecar === null) return;
    const device = choice.kind === "pinned" ? choice.device.label : null;
    const baton = settings.dictation === "baton" && parakeetPath !== null;
    sidecar.configure({
      model: parakeetPath,
      hold: baton ? keysOf("hold") : null,
      toggle: baton ? keysOf("toggle") : null,
      device,
      channel: device === null ? null : channelFor(device),
      paste: settings.paste,
      language: settings.language,
      cleanup: true,
      mouse: NodePath.join(input.stateDir, "voice", "input-bindings.json"),
    });
  };

  const showDictation = (caption: string | null) => {
    pill.on({ type: "dictating", caption }, { silent: !settings.holdKeyCues });
    render();
  };
  // Esc is taken only while the microphone is open, so it stays his the rest of the time.
  const setRecording = (next: boolean) => {
    if (next === (releaseRecordingEscape !== null)) return;
    if (next) releaseRecordingEscape = input.holdEscape(() => sidecar?.cancel(), "recording");
    else {
      releaseRecordingEscape?.();
      releaseRecordingEscape = null;
    }
  };
  /** Words that have no home yet: on the pill for a while, and in the tray until the next ones. */
  const keepText = (why: string, text: string) => {
    lastDictation = text;
    showDictation(`${why}. Tray: Copy last transcript.`);
    if (keptTimer !== null) clearTimeout(keptTimer);
    keptTimer = setTimeout(() => showDictation(null), KEPT_TEXT_MS);
  };
  /** The sidecar held this back for clean-up; it goes only into the window it was spoken for. */
  const deliver = async (raw: string, target: number | null | undefined) => {
    const cleaned = await rewriter
      .clean({
        raw: biasTranscript(raw, dictionary),
        mode: chooseMode(focusedApp, settings.appModes),
        level: await levelNow(focusedApp),
      })
      .catch(() => null);
    const { text, failed } = settleOneShot(raw, cleaned);
    const fitted = text.length === 0 ? text : await fitToCaret(text, focusedApp);
    lastDictation = fitted;
    const turnId = record({
      kind: "dictation",
      app: focusedApp.exe,
      raw,
      cleaned: fitted,
      status: failed ? "raw" : "ok",
      model: failed ? null : settings.cleanupModel,
      delivery: "hold key",
      error: failed ? "Clean-up failed, inserted what was heard" : null,
    });
    if (fitted.length > 0) {
      learnWording(fitted);
      learnFromEdits(fitted, turnId);
    }
    const pasted =
      target === null || target === undefined || text.length === 0
        ? false
        : await sidecar?.pasteInto(fitted, target).catch((error: Error) => {
            note = error.message;
            return false;
          });
    if (pasted === true || text.length === 0) {
      showDictation(null);
      if (failed && pasted === true) pill.on({ type: "trouble", message: CLEANUP_FAILED_LINE });
    } else keepText("Not pasted", fitted);
  };
  let mouseHookReady = false;
  /** A mouse binding fired in the sidecar: the same things the keys do. */
  const onBinding = (id: string) => {
    const tray = (label: string) =>
      (
        input.extras?.menuItems().find((item) => item.label === label)?.click as
          | (() => void)
          | undefined
      )?.();
    if (id === "wake") loop?.activate("wake");
    else if (id === "mute") toggleMute();
    else if (id === "stop") {
      pill.on({ type: "dismissed" });
      input.onDismiss?.();
    } else if (id === "dictation") sidecar?.toggle();
    else if (id === "ask") tray("Ask Tessaya…");
    else if (id === "clear") tray("Clear the screen");
  };
  const onDictation = (event: DictationEvent) => {
    if (event.ev === "binding") return onBinding(event.id);
    if (event.ev === "configured") mouseHookReady = event.mouse === true;
    setRecording(event.ev === "recording");
    if (event.ev === "recording") {
      focusedApp = { exe: event.app ?? "", title: event.title ?? "" };
      if (settings.dictationCleanup === "claude") rewriter.warm();
      if (keptTimer !== null) clearTimeout(keptTimer);
      note = null;
      showDictation("Esc cancels");
    } else if (event.ev === "transcribing") showDictation("Writing it out");
    else if (event.ev === "idle") showDictation(null);
    else if (event.ev === "error") {
      note = event.message;
      showDictation(null);
      pill.on({ type: "trouble", message: event.message });
    } else if (event.ev === "unread") {
      keepText("Nothing took the paste. On your clipboard", event.text);
    } else if (event.ev === "text") {
      note = event.error ?? event.pasteError ?? note;
      const text = event.text ?? "";
      if (event.dictated === true && event.error === undefined)
        return void deliver(text, event.target);
      if (text.length > 0) lastDictation = text;
      if (event.pasted === false && text.length > 0) keepText("Not pasted", text);
      else {
        showDictation(null);
        if (text.length > 0) {
          pill.on({ type: "done", label: "Pasted" });
          // Only the length is kept: dictated words are his, not the conversation's (D31).
          input.conversation?.add({
            route: "dictation",
            said: `(dictated ${text.length} characters)`,
            reply: "",
          });
        }
      }
    }
  };

  // Both the wake capture and the dictation recorder follow the same choice.
  const onDeviceChange = () => {
    // Recorded files are not a device to follow, and switching would play them from the start.
    if ((process.env["BATON_TEST_WAV"] ?? "") !== "") return;
    void (async () => {
      const source = audio ?? (sidecar === null ? null : { listDevices: listSidecarDevices });
      if (source === null) return;
      const listed = await source.listDevices();
      if (listed.length === 0) return;
      devices = listed;
      const next = reconcileDeviceChange({ current: choice, devices, preference: preference() });
      if (next !== null) {
        choice = next;
        note = next.kind === "default" ? next.reason : null;
        configureDictation();
        await loop?.switchDevice(choiceDeviceId(next));
        render();
      }
    })();
  };
  const listSidecarDevices = async (): Promise<ReadonlyArray<AudioInputDevice>> => {
    sidecarDevices = (await sidecar?.devices()) ?? [];
    return sidecarDevices.map((d) => ({ deviceId: d.name, label: d.name }));
  };

  /** The sidecar holds no key and no microphone until `configureDictation` gives it a model. */
  const startSidecar = async () => {
    if (binary === null || sidecar !== null) return;
    sidecar = startDictationSidecar({ binary, onEvent: onDictation });
    dictionary =
      (await readDictionary(input.stateDir)) ??
      (await importWisprDictionary({ stateDir: input.stateDir, appData: input.env["APPDATA"] }));
    devices = await listSidecarDevices();
    choice = selectInputDevice(devices, preference());
    note =
      choice.kind === "default" && choice.reason.includes("not connected") ? choice.reason : null;
    configureDictation();
    render();
  };

  const pill: VoicePill = createVoicePill({
    ...((process.env["BATON_TEST_DIR"] ?? "") === ""
      ? {}
      : { captureDir: process.env["BATON_TEST_DIR"] as string }),
    cueGain: () => CUE_GAIN[settings.cues],
    cueGate: {
      // Never over his speech: wait up to 300 ms for him to stop, then drop the cue.
      quiet: async () => {
        for (let waited = 0; core?.hearingSpeech() === true; waited += 25) {
          if (waited >= CUE_WAIT_MS) return false;
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        return true;
      },
      playing: (ms) => core?.playingCue(ms),
    },
    rest: () => settings.pillAtRest,
    edge: () => settings.pillEdge,
    stateDir: input.stateDir,
    holdEscape: input.holdEscape,
    onDismiss: () => {
      pill.on({ type: "dismissed" });
      loop?.activate("dismiss");
      input.onDismiss?.();
    },
    ...(input.onWakeShown === undefined ? {} : { onShown: input.onWakeShown }),
    onChange: (turn) => input.onPillState?.(turn.phase),
    ...(input.onPillDrag === undefined ? {} : { onDrag: input.onPillDrag }),
  });
  if (settings.pillAtRest) pill.setRest(true);
  let dictatingByVoice = false;
  const stateTurn = (next: VoiceState, target: string | null): TurnEvent | null => {
    const wasDictating = dictatingByVoice;
    dictatingByVoice = next === "dictation";
    if (dictatingByVoice) {
      if (!wasDictating && (settings["dictation.delivery"] ?? "oneshot") === "oneshot")
        collecting = true;
      pill.on({ type: "window_open" });
      return { type: "dictating", caption: STOP_DICTATING_HINT };
    }
    if (wasDictating) {
      pill.on({ type: "dictating", caption: null });
      // The last chunk is still on its way through the core: flush once everything has landed.
      if (collecting) void core?.idle().then(flushDictation);
    }
    if (next === "sleeping" || next === "direct_session") return { type: "window_closed" };
    if (next !== "command_window" && next !== "conversation") return null;
    pill.on({ type: "window_open" });
    return target === null ? null : { type: "target", name: `to ${target}` };
  };
  const onCoreEvent = (event: VoiceCoreEvent) => {
    const turn = ((): TurnEvent | null => {
      switch (event.type) {
        case "wake":
          return { type: "wake", word: wordName(event.word) };
        case "speech_end":
          return null;
        case "audio":
          lastPcm = event.pcm;
          return null;
        case "thinking":
          return { type: "thinking" };
        case "nothing":
          return { type: "failed", message: "Didn't catch that" };
        case "dropped":
          return { type: "resume" };
        case "stop_heard":
          input.onSpokenStop?.();
          return null;
        case "dismissed":
          // Said on its own, so no model was asked: the window is already closed.
          input.onDismiss?.();
          return { type: "dismissed" };
        case "transcript":
          // A spoken cancel takes the pill down at once, the way Esc does.
          if (!dictatingByVoice && isCancelPhrase(event.text)) {
            pill.on({ type: "dismissed" });
            input.onDismiss?.();
            return null;
          }
          if (!dictatingByVoice) {
            lastDictation = event.text;
            lastReply = null;
            keepAudio(
              (spokenTurnId = record({
                kind: "spoken",
                app: "",
                raw: event.text,
                cleaned: null,
                status: "none",
                delivery: null,
                seconds: lastPcm === null ? null : lastPcm.length / 16_000,
              })),
              lastPcm,
            );
          }
          return { type: "heard", text: event.text };
        case "error":
          return { type: "failed", message: event.message };
        case "state":
          return stateTurn(event.state, event.target);
        case "outcome": {
          const said = "reply" in event.outcome ? event.outcome.reply : "";
          if (said.length > 0 && !dictatingByVoice) {
            lastReply = said;
            if (spokenTurnId !== null) history?.update(spokenTurnId, { cleaned: said });
          }
          // The assistant reports its own end; everything else ends here, or with its speech.
          return "source" in event.outcome && event.outcome.source === "screen"
            ? null
            : { type: "finished" };
        }
        case "barge_in":
          input.onBargeIn?.();
          return null;
        case "effect":
          return null;
      }
    })();
    if (turn !== null) pill.on(turn);
  };

  const speechModel = () =>
    settings.speechModel === "fast" ? PARAKEET_FAST_MODEL : PARAKEET_MODEL;

  /** One at a time; if the choice changed while it ran, the one now chosen is fetched next. */
  const loadSpeechModel = (): Promise<string> => {
    modelJob ??= (async () => {
      try {
        await startSidecar();
        for (;;) {
          const model = speechModel();
          const path = await ensureModel({
            dir: modelsDir,
            model,
            onProgress: (fraction) => {
              note =
                fraction < 1
                  ? `Downloading the speech model: ${Math.round(fraction * 100)}%`
                  : null;
              render();
            },
          });
          if (model === speechModel()) {
            parakeetPath = path;
            note = null;
            configureDictation();
            render();
            return path;
          }
        }
      } catch (error) {
        note = `${error instanceof Error ? error.message : "The download failed."} Tray: Download speech model.`;
        render();
        throw error;
      } finally {
        modelJob = null;
      }
    })();
    return modelJob;
  };
  const requestDictation = () => void loadSpeechModel().catch(() => {});

  /** Each step of the voice start, in the turn log, so a start that stops says where. */
  const step = (name: string, fields: Readonly<Record<string, unknown>> = {}) =>
    input.onNote?.("voice_start", { step: name, ...fields });
  const start = async () => {
    step("begin", {
      binary: binary !== null,
      enabled: settings.enabled,
      core: input.makeCore !== null,
      running: loop !== null,
    });
    if (binary === null) {
      note = "Voice is Windows only for now.";
      return render();
    }
    if (loop !== null || input.makeCore === null || !settings.enabled) return render();
    // The models first: if they are missing, no microphone is opened.
    await loadSpeechModel();
    step("speech-model-loaded", { sidecar: sidecar !== null });
    if (sidecar === null) throw new Error("Speech recognition is not installed.");
    core = await input.makeCore({
      intent: voiceIntent,
      onReply: flash,
      settings,
      stt: makeSidecarStt(sidecar),
      onEvent: onCoreEvent,
      waitMs: () => clampWait(settings.waitMs),
      listening: () => ({
        commandWindowMs: LISTEN_AFTER_WAKE_MS.includes(settings.wakeListenMs)
          ? settings.wakeListenMs
          : 8_000,
        conversationMs: CONVERSATION_MS.includes(settings.conversationOpenMs)
          ? settings.conversationOpenMs
          : 30_000,
      }),
      verifyWake: async (pcm, word) => {
        // Unsure is a wake: the check only ever removes wakes it is sure were not the name.
        if (!settings.verifyWake || word === null || sidecar === null) return true;
        try {
          return wakeWordHeard(await makeSidecarStt(sidecar).transcribe(pcm), word);
        } catch {
          return true;
        }
      },
      vocabulary: async (text) => {
        const word = parseAddToDictionary(text);
        if (word === null) return null;
        await changeVocabulary((entries, now) =>
          upsertEntry(entries, { phrase: word, replacement: null, source: "added" }, now),
        );
        return `Added ${word} to your dictionary.`;
      },
    });
    pushContext();
    contextTimer = setInterval(pushContext, CONTEXT_REFRESH_MS);
    step("core-made");
    // Models load on first use: do it now, before the microphone opens, so the first phrase is not lost.
    note = "Starting: loading the speech models.";
    render();
    const warming = core;
    const warmSidecar = sidecar;
    const warmed = await warmUpVoice({
      pushFrame: (frame) => warming.pushAudio(frame),
      transcribe: (pcm) => makeSidecarStt(warmSidecar).transcribe(pcm),
      settled: () => warming.idle(),
    });
    note = null;
    step(warmed ? "warm-done" : "warm-timeout");
    // With BATON_TEST_WAV set, recorded files stand in for the microphone; unset, nothing changes.
    const testSource = process.env["BATON_TEST_WAV"];
    audio =
      testSource !== undefined && testSource !== ""
        ? makeTestAudioInput({ source: testSource, onEvent: (event) => input.onTestAudio?.(event) })
        : makeSidecarAudioInput({
            binary,
            listDevices: listSidecarDevices,
            channelFor,
            // Back on the same mic if it was a hiccup, on the next one if it left.
            onLost: (reason, ranMs) => {
              recordFailures = ranMs >= HEALTHY_RUN_MS ? 1 : recordFailures + 1;
              const delay = restartDelayMs(recordFailures);
              note = `The microphone stopped${reason === null ? "" : ` (${reason})`}. Trying again in ${Math.round(delay / 1000)} s.`;
              pill.on({ type: "trouble", message: "Reconnecting your mic" });
              render();
              setTimeout(() => void restart(), delay);
            },
          });
    step("audio-created", { test: testSource !== undefined && testSource !== "" });
    pill.warm();
    devices = await audio.listDevices();
    step("devices-listed", { devices: devices.length });
    choice = selectInputDevice(devices, preference());
    note = choice.kind === "default" && settings.pinnedLabel !== null ? choice.reason : null;
    loop = await startVoiceLoop({
      audio,
      core,
      deviceId: choiceDeviceId(choice),
      onState: (next) => {
        state = next;
        render();
      },
      onLevel: (frame) => {
        const level = frameLevel(frame);
        pill.micLevel(level);
        if (levelTest !== null) levelTest.peak = Math.max(levelTest.peak, level);
      },
      // The core's router has already sent the words on; this is the HUD's line.
      onUtterance: (utterance) => flash(utteranceCaption(utterance)),
    });
    step("loop-started");
  };

  const stop = async () => {
    await loop?.stop();
    if (loop === null) core?.dispose();
    loop = null;
    core = null;
    if (contextTimer !== null) clearInterval(contextTimer);
    contextTimer = null;
    await audio?.stop();
    audio = null;
    state = "sleeping";
    render();
  };

  /** The Check area (D134). Results are kept until he runs them again; none run on their own. */
  let checks: ReadonlyArray<CheckResult> | null = null;
  let micPeak: number | null = null;
  let levelTest: { peak: number } | null = null;

  const gather = async (): Promise<CheckInput> => {
    const assets = input.voiceAssets?.(settings.modelsDir);
    const wakeModels = assets === undefined ? null : resolveWakeModels(assets, settings.wakeWords);
    const model = speechModel();
    const present = modelPresent(modelsDir, model);
    let freeMb: number | null = null;
    try {
      const fsStat = NodeFS.statfsSync(NodeFS.existsSync(modelsDir) ? modelsDir : input.stateDir);
      freeMb = (fsStat.bavail * fsStat.bsize) / 1e6;
    } catch {
      freeMb = null;
    }
    return {
      mic: {
        devices: realDevices(devices).length,
        using: choice.kind === "pinned" ? choice.device.label : null,
        listening: loop !== null,
        trouble: note,
      },
      micPeak,
      wake: {
        enabled: settings.wakeWords.filter((w) => w.enabled).map((w) => w.word),
        missing: wakeModels?.missing ?? [],
        coreLoaded: loop !== null,
        baseModelsMissing: assets === undefined ? 0 : missingVoiceAssets(assets).length,
      },
      speech: {
        present,
        label: settings.speechModel === "fast" ? "Parakeet Fast" : "Parakeet v3",
        sizeMb: Math.round(model.size / 1e6),
      },
      signIn: (await input.extras?.signIn().catch(() => null)) ?? null,
      screenAccess:
        input.platform === "darwin"
          ? Electron.systemPreferences.getMediaAccessStatus("screen")
          : null,
      disk: { freeMb, neededMb: present ? 0 : model.size / 1e6 },
    };
  };
  const runAllChecks = async () => {
    checks = runChecks(await gather());
    home.refresh();
  };
  /** Four seconds of the stream that is already open, started by his press and never before. */
  const testMic = () => {
    if (loop === null || levelTest !== null) return;
    levelTest = { peak: 0 };
    home.refresh();
    setTimeout(() => {
      micPeak = levelTest?.peak ?? 0;
      levelTest = null;
      void runAllChecks();
    }, MIC_TEST_MS).unref();
  };

  const claudeDir = () =>
    process.env["CLAUDE_CONFIG_DIR"] ?? NodePath.join(Electron.app.getPath("home"), ".claude");
  const harnessItems = cachedFor(3_000, () =>
    readInventory({
      claudeDir: claudeDir(),
      claudeJson: NodePath.join(Electron.app.getPath("home"), ".claude.json"),
      codexDir: NodePath.join(Electron.app.getPath("home"), ".codex"),
    }),
  );
  const notes = createNotesStore(NodePath.join(input.stateDir, "memory"));
  const cachedNotes = cachedFor(3_000, () => notes.list());
  const cachedPack = cachedFor(3_000, () =>
    packControls(NodePath.join(input.stateDir, PACK_FOLDER)),
  );
  /** Files he edits by hand or through a row here: forget what was read, so the next draw is true. */
  const forgetFiles = () => {
    harnessItems.reset();
    cachedNotes.reset();
    cachedPack.reset();
  };
  let sessionsNote: string | null = null;
  /** The job cards as the window last read them; null until the Jobs or Approvals tab has been opened once. */
  let jobsCache: ReadonlyArray<BatonJob> | null = null;
  let jobsError: string | null = null;
  let jobsLoading = false;
  /** Opening the Jobs or Approvals tab asks for them, and they are kept fresh from then on. */
  let jobsWanted = false;
  const refreshJobs = async () => {
    if (jobsLoading) return;
    jobsLoading = true;
    try {
      const value = (await requestKept({ kind: "job", op: "list", args: {} })) as {
        jobs?: ReadonlyArray<BatonJob>;
      } | null;
      const next = value?.jobs ?? [];
      jobsError = null;
      if (JSON.stringify(next) !== JSON.stringify(jobsCache)) jobsCache = next;
    } catch (error) {
      jobsError = error instanceof Error ? error.message : String(error);
    } finally {
      jobsLoading = false;
      home.refresh();
    }
  };
  const wantJobs = () => {
    jobsWanted = true;
    void refreshJobs();
  };
  setInterval(() => {
    if (jobsWanted) void refreshJobs();
  }, JOBS_REFRESH_MS).unref();

  // Unprompted lines (D146): only once T3's window exists (nothing is opened for this), never in quiet hours.
  let announced: ReadonlySet<string> = new Set();
  const watchFindings = async () =>
    (
      (await requestKept({ kind: "job", op: "watch", args: {} })) as {
        findings?: ReadonlyArray<WatchFinding>;
      } | null
    )?.findings ?? [];
  const checkAttention = async () => {
    if (mainContents === null || mainContents.isDestroyed()) return;
    const at = new Date();
    if (inQuietHours(settings.quietHours, at.getHours())) return;
    const found = await watchFindings();
    if (settings.noticeMode !== "off") {
      const { fresh, next } = freshFindings(found, announced);
      announced = next;
      const line = noticeLine(fresh);
      if (line !== null) input.extras?.announce(line, settings.noticeMode === "spoken");
    }
    const today = `${at.getFullYear()}-${at.getMonth() + 1}-${at.getDate()}`;
    if (
      settings.briefMode !== "off" &&
      at.getHours() >= BRIEF_HOUR &&
      settings.briefDay !== today
    ) {
      const jobs = (await requestKept({ kind: "job", op: "list", args: {} })) as {
        jobs?: ReadonlyArray<BatonJob>;
      } | null;
      save({ briefDay: today });
      input.extras?.announce(
        morningBrief({ jobs: jobs?.jobs ?? [], findings: found, now: Date.now() }),
        settings.briefMode === "spoken",
      );
    }
  };
  setInterval(() => void checkAttention().catch(() => undefined), ATTENTION_MS).unref();

  /** The tail of a log, cached until the file changes: Home redraws often, the log does not. */
  const tails = new Map<string, { stamp: string; text: string }>();
  const tailOf = (file: string): string => {
    try {
      const stat = NodeFS.statSync(file);
      const stamp = `${stat.mtimeMs}:${stat.size}`;
      const hit = tails.get(file);
      if (hit?.stamp === stamp) return hit.text;
      const fd = NodeFS.openSync(file, "r");
      const length = Math.min(stat.size, 96 * 1024);
      const buffer = Buffer.alloc(length);
      NodeFS.readSync(fd, buffer, 0, length, stat.size - length);
      NodeFS.closeSync(fd);
      const text = buffer.toString("utf8");
      tails.set(file, { stamp, text });
      return text;
    } catch {
      return "";
    }
  };
  const key = (accelerator: string): BindingInput => ({ type: "key", accelerator });
  const currentBindings = () =>
    effective(settings.bindings, {
      hold: key(settings.holdKey),
      toggle: key(settings.toggleKey),
    });

  const homeExtra = (): HomeExtra => {
    const activity = parseActivity(tailOf(NodePath.join(input.logDir, "voice-turns.ndjson")));
    const today = todayStats(activity, new Date());
    const sessionRows = input.sessions?.rows() ?? [];
    const lifecycle = tailOf(NodePath.join(input.logDir, "baton-lifecycle.ndjson"))
      .split("\n")
      .flatMap((l) => {
        try {
          const e = JSON.parse(l) as {
            at?: string;
            event?: string;
            reason?: string;
            detail?: string;
          };
          const words: Record<string, string> = {
            "replaced-by-update": "Tessaya was replaced by an update",
            "previous-run-ended-badly":
              "The last run ended without a clean exit (a crash, a kill or a power loss)",
            "restarted-after-update": "Restarted after an update",
            exiting: `Going down: ${e.reason ?? "quit"}${e.detail ? ` ${e.detail}` : ""}`,
            "uncaught-exception": "An unexpected error stopped Tessaya",
            "render-process-gone": "A window closed unexpectedly",
            "child-process-gone": "A helper program stopped unexpectedly",
          };
          const text = e.event === undefined ? undefined : words[e.event];
          return e.at === undefined || text === undefined ? [] : [{ at: e.at, text }];
        } catch {
          return [];
        }
      })
      .toReversed()
      .slice(0, 5);
    return {
      wakeWords: settings.wakeWords.filter((w) => w.enabled).map((w) => w.word),
      activity,
      stats: {
        turns: today.turns,
        dictations: today.dictations,
        sessions: sessionRows.length,
        needYou: sessionRows.filter((r) => r.urgent).length,
      },
      insights: computeInsights(history?.list({ limit: 20_000 }) ?? [], new Date()),
      vocabulary: (dictionary as ReadonlyArray<VocabEntry>).map((d) => ({
        phrase: d.phrase,
        replacement: d.replacement,
        source: d.source ?? "added",
        count: d.count ?? null,
        lastSeen: d.lastSeen ?? null,
      })),
      hotkeys: [
        ...currentBindings().flatMap((row) =>
          row.inputs.flatMap((one) =>
            one.type === "key"
              ? [
                  {
                    label: row.def.label,
                    keys: one.accelerator,
                    tab:
                      (
                        {
                          hold: "dictation",
                          toggle: "dictation",
                          dictation: "dictation",
                          ask: "screen",
                          clear: "screen",
                          stop: "screen",
                        } as Record<string, string>
                      )[row.def.id] ?? "voice",
                  },
                ]
              : [],
          ),
        ),
        { label: "Cancel a recording, a card or a drive", keys: "Escape", tab: "screen" },
      ],
      bindings: currentBindings().map((row) => ({
        action: row.def.id,
        label: row.def.label,
        hint: row.def.hint,
        inputs: row.inputs,
        isDefault: row.isDefault,
        conflictsWith: row.conflictsWith,
        conflicts: row.conflicts.map((c) => ({
          index: row.inputs.findIndex((i) => sameInput(i, c.input)),
          with: c.with,
        })),
      })),
      bindingsNote,
      mouseReady: mouseHookReady,
      usage: input.sessions?.usage() ?? [],
      lifecycle,
      paths: [
        { id: "state", label: "State folder", path: input.stateDir },
        { id: "logs", label: "Log folder", path: input.logDir },
        { id: "models", label: "Voice models", path: modelsDir },
        { id: "settings", label: "Voice settings file", path: settingsPath },
      ],
      about: {
        version: input.appVersion,
        source: "github.com/RabHanz/baton/releases",
        licence: "MIT, with third-party notices",
        notices: "docs/baton/THIRD_PARTY_NOTICES.md",
      },
    };
  };

  const homeState = (): HomeState => ({
    status: {
      label: hudView(state).label,
      tone: state === "muted" ? "off" : state === "sleeping" ? "idle" : "good",
      device: deviceName(),
      mark: markSvg(markOptions()),
      brandMark: brandMarkSvg(),
    },
    extra: homeExtra(),
    controls: [
      ...approvalControls(
        buildApprovals({ jobs: jobsCache ?? [], sessions: input.sessions?.rows() ?? [] }),
        jobsCache !== null ? "ready" : jobsError !== null ? { error: jobsError } : "loading",
      ),
      ...noteControls(cachedNotes()),
      ...cachedPack(),
      ...harnessControls(harnessItems()),
      ...(jobsCache === null
        ? jobsError !== null
          ? [
              {
                id: "j.load",
                section: "Jobs",
                label: "Could not read your jobs",
                hint: jobsError,
                kind: "action" as const,
                button: "Try again",
              },
            ]
          : [
              {
                id: "j.loading",
                section: "Jobs",
                label: "Reading your jobs",
                kind: "check" as const,
                status: "ok" as const,
                detail: "Asking the sessions window; it opens if it is not already.",
              },
            ]
        : jobsCache.length === 0
          ? [
              {
                id: "j.empty",
                section: "Jobs",
                label: "No jobs yet",
                hint: "Ask Tessaya to take on some long work. It plans first and waits for your OK.",
                kind: "check" as const,
                status: "ok" as const,
                detail: "Nothing is running for you.",
              },
            ]
          : jobControls(jobsCache)),
      ...(input.sessions === undefined
        ? []
        : input.sessions.rows().length > 0
          ? [
              ...sessionControls(input.sessions.rows()),
              ...(sessionsNote === null
                ? []
                : [
                    {
                      id: "n.note",
                      section: "Sessions",
                      label: "Last action",
                      kind: "check" as const,
                      status: "ok" as const,
                      detail: sessionsNote,
                    },
                  ]),
            ]
          : [
              {
                id: "n.empty",
                section: "Sessions",
                label: "No sessions loaded yet",
                hint: "They appear here once T3's sessions view has opened.",
                kind: "action" as const,
                button: "Open sessions",
              },
            ]),
      {
        id: "v.enabled",
        section: "Wake and listening",
        label: "Listen for my wake word",
        hint:
          binary === null
            ? "Not available in this build."
            : "Say the wake word and Tessaya starts listening.",
        kind: "toggle",
        on: settings.enabled,
        disabled: binary === null,
      },
      {
        id: "v.muted",
        section: "Wake and listening",
        label: "Mute",
        hint: `Shortcut ${VOICE_HOTKEYS[2]!.accelerator}`,
        kind: "toggle",
        on: loop?.isMuted() ?? false,
        disabled: loop === null,
      },
      ...(input.extras?.controls() ?? []),
      ...(input.updates?.controls() ?? []),
      {
        id: "v.mic",
        section: "Wake and listening",
        label: "Microphone",
        kind: "choice",
        value: settings.pinnedLabel ?? "",
        options: [
          { value: "", label: "Automatic" },
          ...realDevices(devices).map((d) => ({
            value: d.label,
            label: d.label || "Unnamed microphone",
          })),
        ],
        more: true,
      },
      ...settings.wakeWords.map((wake) => ({
        id: `v.wake:${wake.word}`,
        section: "Wake and listening",
        label: `Wake word: ${wake.word}`,
        kind: "toggle" as const,
        on: wake.enabled,
      })),
      {
        id: "v.direct",
        section: "Wake and listening",
        label: "Send words to the focused session",
        hint: "What you say goes straight to the session you are working in.",
        kind: "toggle",
        on: state === "direct_session",
        disabled: loop === null,
      },
      {
        id: "v.dictation",
        section: "Dictation",
        label: "Dictate with",
        hint: `Hold ${settings.holdKey} to dictate into any app.`,
        kind: "choice",
        value: settings.dictation,
        options: [
          { value: "baton", label: "Tessaya" },
          { value: "wispr", label: "Wispr Flow" },
        ],
        disabled: binary === null,
      },
      ...(settings.dictation === "baton" && parakeetPath === null && binary !== null
        ? [
            {
              id: "v.download",
              section: "Dictation",
              label: "Speech model",
              hint: `Needed once, ${Math.round(speechModel().size / 1e6)} MB.`,
              kind: "action" as const,
              button: modelJob === null ? "Download" : "Downloading…",
              disabled: modelJob !== null,
            },
          ]
        : []),
      {
        id: "v.delivery",
        section: "Dictation",
        label: "How your words arrive",
        kind: "choice",
        value: settings["dictation.delivery"] ?? "oneshot",
        options: [
          {
            value: "oneshot",
            label: "All at once",
            note: "Your words are tidied, then pasted in one go when you stop.",
          },
          {
            value: "stream",
            label: "Stream as it goes",
            note: "Your words appear while you speak. Tidying happens as they arrive.",
          },
        ],
        disabled: binary === null,
      },
      {
        id: "v.cleanup",
        section: "Dictation",
        label: "Tidy what I said",
        hint: "Fixes punctuation and filler words.",
        kind: "choice",
        value: settings.dictationCleanup,
        options: [
          { value: "claude", label: "Local, then Claude" },
          { value: "local", label: "Local only" },
          { value: "off", label: "Off" },
        ],
        more: true,
      },
      {
        id: "v.appMode",
        section: "Dictation",
        label: `Writing style in ${focusedApp.exe || "the last app you dictated into"}`,
        hint: "Chat, email or code: how your words are laid out.",
        kind: "choice",
        value: settings.appModes[focusedApp.exe.toLowerCase()] ?? "",
        options: [
          { value: "", label: "Automatic" },
          ...DICTATION_MODES.map((m) => ({ value: m, label: MODE_LABELS[m] })),
        ],
        disabled: focusedApp.exe.length === 0,
        more: true,
      },
      {
        id: "v.speechModel",
        section: "Dictation",
        label: "Speech model",
        kind: "choice",
        value: settings.speechModel,
        options: [
          { value: "v3", label: "Most languages, slower" },
          { value: "fast", label: "English, 3x quicker" },
        ],
        more: true,
      },
      {
        id: "v.learnWords",
        section: "Dictation",
        label: "Learn words from my edits",
        hint: "When you fix a word Tessaya wrote, or keep using a name, it joins your vocabulary and says so. Discard takes it out for good.",
        kind: "toggle",
        on: settings.learnWords,
      },
      {
        id: "v.copyLast",
        section: "Dictation",
        label: "Last transcript",
        kind: "action",
        button: "Copy",
        disabled: (lastReply ?? lastDictation) === null,
        more: true,
      },
      {
        id: "v.keepVoice",
        section: "Voice recordings",
        label: "Keep my voice recordings",
        hint: "Saves the audio of your dictations and of what you say to Tessaya, on this computer only. It keeps your voice. Never records anything else, and never listens in the background.",
        kind: "toggle",
        on: settings.keepVoice,
      },
      {
        id: "v.keepDays",
        section: "Voice recordings",
        label: "Delete recordings after",
        hint: "Clips you corrected are kept longer, up to the size limit below.",
        kind: "choice",
        value: String(settings.keepDays),
        options: [
          { value: "7", label: "7 days" },
          { value: "30", label: "30 days" },
          { value: "90", label: "90 days" },
          { value: "365", label: "A year" },
        ],
        disabled: !settings.keepVoice,
      },
      {
        id: "v.keepCap",
        section: "Voice recordings",
        label: "Keep corrected clips up to",
        hint: "They teach Tessaya the most. The oldest go first when over.",
        kind: "choice",
        value: String(settings.keepCapGb),
        options: [
          { value: "1", label: "1 GB" },
          { value: "2", label: "2 GB" },
          { value: "5", label: "5 GB" },
          { value: "10", label: "10 GB" },
        ],
        disabled: !settings.keepVoice,
      },
      {
        id: "v.keepSpace",
        section: "Voice recordings",
        label: "Space used",
        hint: `${(spaceUsed(audioDir) / 1024 ** 2).toFixed(1)} MB of recordings. ${
          keepNote ?? "Saving pauses if the drive drops under 5 GB free."
        }`,
        kind: "action",
        button: "Delete all recordings",
        disabled: spaceUsed(audioDir) === 0,
      },
      {
        id: "v.appearance",
        section: "Appearance",
        label: "Appearance",
        hint: "Follows Windows by default. Light or Dark applies at once.",
        kind: "choice",
        value: settings.appearance,
        options: [
          { value: "system", label: "System" },
          { value: "light", label: "Light" },
          { value: "dark", label: "Dark" },
        ],
      },

      {
        id: "v.audition",
        section: "Answers and voice",
        label: "Hear the voice",
        hint: "Plays one line in the voice chosen above. Play beside a voice plays that one. Tessaya's own voices only.",
        kind: "action",
        button: "Play",
      },
      {
        id: "v.cues",
        section: "On screen",
        label: "Sounds",
        hint: "Short cues when listening starts and ends, after a long wait, and on an error. Never over your voice.",
        kind: "choice",
        value: settings.cues,
        options: [
          { value: "off", label: "Off" },
          { value: "quiet", label: "Quiet" },
          { value: "normal", label: "Normal" },
        ],
      },
      {
        id: "v.listenAfterWake",
        section: "Wake and listening",
        label: "Listen after waking",
        hint: "How long Tessaya waits for you to START speaking after the wake word. Once you have started, it listens until you stop, however long that is.",
        kind: "choice",
        value: String(settings.wakeListenMs),
        options: LISTEN_AFTER_WAKE_MS.map((ms) => ({ value: String(ms), label: `${ms / 1000} s` })),
      },
      {
        id: "v.conversation",
        section: "Wake and listening",
        label: "Keep the conversation open",
        hint: "After a reply you can answer without the wake word for this long.",
        kind: "choice",
        value: String(settings.conversationOpenMs),
        options: CONVERSATION_MS.map((ms) => ({
          value: String(ms),
          label: ms < 60_000 ? `${ms / 1000} s` : `${ms / 60_000} min`,
        })),
      },
      {
        id: "v.waitMs",
        section: "Wake and listening",
        label: "How long I wait for you to finish",
        hint: "A pause this long ends your turn. Unfinished sentences get longer, and speech that resumes soon after joins the same turn.",
        kind: "choice",
        value: String(clampWait(settings.waitMs)),
        options: [800, 1200, 1500, 2000, 3000].map((ms) => ({
          value: String(ms),
          label: `${ms / 1000} s`,
        })),
      },
      {
        id: "v.verifyWake",
        section: "Wake and listening",
        label: "Check the wake word before waking",
        hint: "Tessaya listens to what it just heard and wakes only if the name is in it. Fewer false wakes from TV and music; the pill appears a moment later.",
        kind: "toggle",
        on: settings.verifyWake,
      },
      {
        id: "v.holdKeyCues",
        section: "On screen",
        label: "Sounds for the dictation key",
        hint: "Play the start and end cue when you dictate with the hold key. Off by default.",
        kind: "toggle",
        on: settings.holdKeyCues,
        more: true,
      },
      {
        id: "v.pillCentre",
        section: "On screen",
        label: "Put the pill in the centre",
        hint: "Or drag it: it lines up on a grid and snaps to centre, top and bottom. Hold Alt or Shift to place it freely. Right-click it for the same places.",
        kind: "action",
        button: "Centre",
      },
      {
        id: "v.pillRest",
        section: "On screen",
        label: "Show a small bar when Tessaya isn't listening",
        hint: "Off, nothing shows until Tessaya is doing something. Drag the pill to move it, double-click to put it back.",
        kind: "toggle",
        on: settings.pillAtRest,
      },
      {
        id: "v.notice",
        section: "Notices",
        label: "Tell me when something needs me",
        hint: "A failed, stalled or waiting session, once. It says it aloud only if you choose that, and never in quiet hours. Starts once T3's window has opened.",
        kind: "choice",
        value: settings.noticeMode,
        options: [
          { value: "off", label: "Off" },
          { value: "written", label: "A card" },
          { value: "spoken", label: "A card and one spoken line" },
        ],
      },
      {
        id: "v.quiet",
        section: "Notices",
        label: "Quiet hours",
        kind: "choice",
        value: settings.quietHours,
        options: [
          { value: "none", label: "None" },
          { value: "22-8", label: "10 pm to 8 am" },
          { value: "23-7", label: "11 pm to 7 am" },
          { value: "0-9", label: "Midnight to 9 am" },
        ],
      },
      {
        id: "v.brief",
        section: "Notices",
        label: "Morning brief",
        hint: "What finished, failed or waits, once a day from 8 am. Ask for it any time with 'what happened overnight'.",
        kind: "choice",
        value: settings.briefMode,
        options: [
          { value: "off", label: "Off" },
          { value: "written", label: "A card" },
          { value: "spoken", label: "Spoken" },
        ],
      },
      {
        id: "v.pillEdge",
        section: "On screen",
        label: "Where the pill sits",
        kind: "choice",
        value: settings.pillEdge,
        options: [
          { value: "bottom", label: "Above the taskbar" },
          { value: "top", label: "At the top" },
        ],
      },
      {
        id: "v.login",
        section: "On screen",
        label: "Start Tessaya when I sign in",
        kind: "toggle",
        on: loginItemOn(Electron.app, input.loginEntry),
        more: true,
      },
      {
        id: "v.check",
        section: "Check",
        label: "Is everything working?",
        hint: "Looks at the microphone, models, sign-ins, permission and disk.",
        kind: "action",
        button: "Run checks",
        more: true,
      },
      {
        id: "v.micTest",
        section: "Check",
        label: "Microphone level",
        hint: "Listens for four seconds while you speak. Only when you press it.",
        kind: "action",
        button: levelTest === null ? "Test microphone" : "Listening…",
        disabled: loop === null || levelTest !== null,
        more: true,
      },
      ...(checks ?? []).map((c) => ({
        id: `v.result:${c.id}`,
        section: "Check",
        label: c.title,
        kind: "check" as const,
        status: c.status,
        detail: c.detail,
        ...(c.fix === undefined ? {} : { fix: c.fix }),
        more: true,
      })),
      {
        id: "v.file",
        section: "On screen",
        label: "Voice settings file",
        hint: "For anything not listed here.",
        kind: "action",
        button: "Open",
        more: true,
      },
    ],
  });

  const applyHome = (id: string, value: string | boolean | null) => {
    const on = value === true;
    if (id === "q.wake") loop?.activate("wake");
    else if (id === "q.ask" || id === "q.clear") {
      const entry = input.extras
        ?.menuItems()
        .find((i) => i.label === (id === "q.ask" ? "Ask Tessaya…" : "Clear the screen"));
      (entry?.click as (() => void) | undefined)?.();
    } else if (id === "q.stop") {
      input.onDismiss?.();
      const entry = input.extras
        ?.menuItems()
        .find((i) => i.label === "Stop driving" || i.label === "Stop the lesson");
      (entry?.click as (() => void) | undefined)?.();
    } else if (id === "q.quit") Electron.app.quit();
    else if (id.startsWith("q.open:")) {
      const target = homeExtra().paths.find((p) => `q.open:${p.id}` === id);
      if (target !== undefined) void Electron.shell.openPath(target.path);
    } else if (id === "d.add" && typeof value === "string") {
      try {
        const entry = JSON.parse(value) as { phrase?: unknown; replacement?: unknown };
        if (typeof entry.phrase === "string") {
          dictionary = addEntry(dictionary, {
            phrase: entry.phrase,
            replacement: typeof entry.replacement === "string" ? entry.replacement : null,
          });
          saveDictionary(input.stateDir, dictionary);
        }
      } catch {
        // A malformed add from the page is ignored; the list stays as it was.
      }
    } else if (id === "d.edit" && typeof value === "string") {
      try {
        const e = JSON.parse(value) as { from?: unknown; phrase?: unknown; replacement?: unknown };
        if (typeof e.from === "string" && typeof e.phrase === "string") {
          dictionary = editEntry(dictionary, e.from, {
            phrase: e.phrase,
            replacement: typeof e.replacement === "string" ? e.replacement : null,
          });
          saveDictionary(input.stateDir, dictionary);
        }
      } catch {
        // A malformed edit is ignored; the list stays as it was.
      }
    } else if (id.startsWith("b.")) {
      const [verb, action] = [id.slice(2, id.indexOf(":")), id.slice(id.indexOf(":") + 1)];
      let next: ReadonlyArray<Binding> | null = null;
      const row = currentBindings().find((r) => r.def.id === action);
      bindingsNote = null;
      if (verb === "add" && typeof value === "string" && row !== undefined) {
        try {
          const parsed = parseBindings([{ action, inputs: [JSON.parse(value)] }])[0]?.inputs[0];
          if (parsed === undefined) bindingsNote = "That input could not be read.";
          else {
            const change = addInput(settings.bindings, action, row.inputs, parsed);
            if ("error" in change) bindingsNote = change.error;
            else next = change.saved;
          }
        } catch {
          next = null;
        }
      } else if (verb === "remove" && typeof value === "number" && row !== undefined) {
        next = removeInput(settings.bindings, action, row.inputs, value);
      } else if (verb === "clear") next = withBinding(settings.bindings, action, []);
      else if (verb === "reset") next = withBinding(settings.bindings, action, "reset");
      else if (verb === "resetAll") next = [];
      if (next === null) home.refresh();
      if (next !== null) {
        save({ bindings: next });
        applyBindings();
      }
    } else if (id === "d.forget") {
      rememberNever(dictionary.filter((e) => e.source === "learned").map((e) => e.phrase));
      dictionary = forgetLearned(dictionary);
      saveDictionary(input.stateDir, dictionary);
    } else if (id === "d.remove" && typeof value === "string") {
      // Deleting a word he did not add himself means he does not want it: it never comes back.
      if (dictionary.some((e) => e.phrase === value && e.source === "learned"))
        rememberNever([value]);
      dictionary = removeEntry(dictionary, value);
      saveDictionary(input.stateDir, dictionary);
    } else if (pluginOfControl(id) !== null) {
      const result = setPluginEnabled(claudeDir(), pluginOfControl(id)!, on);
      forgetFiles();
      if (result === "refused")
        note = "Could not change that plugin; its settings file was left alone.";
      home.refresh();
    } else if (id === "p.folder") {
      NodeFS.mkdirSync(NodePath.join(input.stateDir, PACK_FOLDER), { recursive: true });
      void Electron.shell.openPath(NodePath.join(input.stateDir, PACK_FOLDER));
    } else if (packAction(id) !== null) {
      const act = packAction(id)!;
      const dir = NodePath.join(input.stateDir, PACK_FOLDER);
      if (act.reset) {
        useDefault(dir, act.id);
        forgetFiles();
        home.refresh();
      } else {
        const file = fileToEdit(dir, act.id);
        forgetFiles();
        if (file !== null) void Electron.shell.openPath(file);
        home.refresh();
      }
    } else if (id === "m.folder") {
      NodeFS.mkdirSync(notes.dir, { recursive: true });
      void Electron.shell.openPath(notes.dir);
    } else if (noteAction(id) !== null) {
      const act = noteAction(id)!;
      if (act.remove) {
        notes.remove(act.id);
        forgetFiles();
        home.refresh();
      } else {
        const file = notes.list().find((n) => n.id === act.id)?.file;
        if (file !== undefined) void Electron.shell.openPath(file);
      }
    } else if (id === "a.load") wantJobs();
    else if (id.startsWith("a:")) {
      const act = approvalAction(id);
      if (act === null) return;
      if (act.kind === "plan") {
        // Approve is the same agree the voice path makes; Deny stops the worker, which has done nothing yet.
        void requestKept({ kind: "job", op: act.deny ? "stop" : "agree", args: { id: act.ref } })
          .then(refreshJobs)
          .catch(() => undefined);
      } else void input.sessions?.act(`n:${act.ref}`, null);
    } else if (id === "j.load") wantJobs();
    else if (/^j[as]?:/.test(id)) {
      const act = jobAction(jobsCache ?? [], id);
      const job = (op: BatonJobBridgeRequest["op"], args: Record<string, unknown>) =>
        void requestKept({ kind: "job", op, args })
          .then(refreshJobs)
          .catch(() => undefined);
      if (act === null) return;
      if (act.kind === "stop") job("stop", { id: act.id });
      else if (act.kind === "schedule") {
        job("schedule", { id: act.id, everyMinutes: act.scheduled ? null : DAILY_MINUTES });
      } else if (act.kind === "answer") {
        if (typeof value === "string" && value.trim() !== "") {
          job("refine", { id: act.id, text: value, via: "text" });
        }
      } else if (act.approve) job("agree", { id: act.id });
      else input.openMainWindow();
    } else if (id === "n.empty") input.openMainWindow();
    else if (id.startsWith("n:")) {
      void input.sessions?.act(id, typeof value === "string" ? value : null).then((line) => {
        sessionsNote = line;
        setTimeout(() => {
          sessionsNote = null;
          home.refresh();
        }, SESSIONS_NOTE_MS).unref();
        home.refresh();
      });
    } else if (id.startsWith("u.")) input.updates?.apply(id);
    else if (id.startsWith("s.")) {
      input.extras?.applySetting(id, value);
      // Picking a voice plays a short sample of it, so choosing is not guessing.
      if (id === "s.voice" && typeof value === "string" && value !== "system")
        input.audition?.(value);
    } else if (id === "v.enabled") {
      save({ enabled: on });
      void (on ? start().catch(failed) : stop());
    } else if (id === "v.muted") {
      if ((loop?.isMuted() ?? false) !== on) toggleMute();
    } else if (id === "v.direct") {
      if ((state === "direct_session") !== on) loop?.activate("toggle_direct_session");
    } else if (id === "v.mic") {
      save({ pinnedLabel: typeof value === "string" && value !== "" ? value : null });
      void restart();
    } else if (id.startsWith("v.wake:")) {
      const word = id.slice("v.wake:".length);
      save({
        wakeWords: settings.wakeWords.map((w) => (w.word === word ? { ...w, enabled: on } : w)),
      });
      void relisten();
    } else if (id === "v.dictation" && (value === "baton" || value === "wispr"))
      setDictation(value);
    else if (id === "v.download") requestDictation();
    else if (id === "v.delivery" && (value === "oneshot" || value === "stream")) {
      save({ "dictation.delivery": value });
      configureDictation();
    } else if (id === "v.cleanup" && (value === "claude" || value === "local" || value === "off")) {
      save({ dictationCleanupChosen: true, dictationCleanup: value });
    } else if (id === "v.speechModel" && (value === "v3" || value === "fast"))
      setSpeechModel(value);
    else if (id === "v.appMode" && typeof value === "string" && focusedApp.exe.length > 0) {
      const exe = focusedApp.exe.toLowerCase();
      const { [exe]: _old, ...others } = settings.appModes;
      save({
        appModes: value === "" ? others : { ...others, [exe]: value as DictationMode },
      });
    } else if (id === "v.copyLast") {
      const last = lastReply ?? lastDictation;
      if (last !== null) void Electron.clipboard.writeText(last);
    } else if (id === "v.keepVoice") save({ keepVoice: on });
    else if (id === "v.keepDays" && typeof value === "string") {
      save({ keepDays: Math.max(1, Number(value) || 30) });
      retention();
    } else if (id === "v.keepCap" && typeof value === "string") {
      save({ keepCapGb: Math.max(1, Number(value) || 2) });
      retention();
    } else if (id === "v.keepSpace") {
      for (const turn of history?.list({ limit: 1_000_000 }) ?? []) {
        if (turn.audio === null) continue;
        for (const path of clipPaths(turn.audio)) NodeFS.rmSync(path, { force: true });
        history?.update(turn.id, { audio: null });
      }
      render();
    } else if (id === "v.pillCentre") pill.moveTo("centre");
    else if (id === "v.appearance") save({ appearance: parseAppearance(value) });
    else if (id === "v.learnWords") save({ learnWords: on });
    else if (id === "v.audition") input.audition?.(typeof value === "string" ? value : null);
    else if (id === "v.cues") save({ cues: parseCueLevel(value) });
    else if (id === "v.holdKeyCues") save({ holdKeyCues: on });
    else if (id === "v.verifyWake") save({ verifyWake: on });
    else if (id === "v.waitMs") save({ waitMs: clampWait(Number(value)) });
    else if (id === "v.listenAfterWake" && LISTEN_AFTER_WAKE_MS.includes(Number(value))) {
      save({ wakeListenMs: Number(value) });
    } else if (id === "v.conversation" && CONVERSATION_MS.includes(Number(value))) {
      save({ conversationOpenMs: Number(value) });
    } else if (
      id === "v.notice" &&
      (value === "off" || value === "written" || value === "spoken")
    ) {
      save({ noticeMode: value });
    } else if (id === "v.brief" && (value === "off" || value === "written" || value === "spoken")) {
      save({ briefMode: value });
    } else if (
      id === "v.quiet" &&
      typeof value === "string" &&
      /^(none|\d{1,2}-\d{1,2})$/.test(value)
    ) {
      save({ quietHours: value });
    } else if (id === "v.pillRest") {
      save({ pillAtRest: on });
      pill.setRest(on);
    } else if (id === "v.pillEdge" && (value === "top" || value === "bottom")) {
      save({ pillEdge: value });
      pill.setEdge(value);
    } else if (id === "v.login") {
      save({ openAtLogin: on });
      setLoginItem(Electron.app, input.loginEntry, on);
    } else if (id === "v.check") void runAllChecks();
    else if (id === "v.micTest") testMic();
    else if (id === "v.file") {
      save({});
      void Electron.shell.openPath(settingsPath);
    }
    render();
  };

  const home = createBatonHome({
    stateDir: input.stateDir,
    state: homeState,
    apply: applyHome,
    openSessions: input.openMainWindow,
    onTab: (tab) => {
      if (tab === "jobs" || tab === "approvals") wantJobs();
    },
    appearance: () => settings.appearance,
  });

  let speakingNow = false;

  const rebuildMenu = () => {
    home.refresh();
    tray.setContextMenu(
      Electron.Menu.buildFromTemplate([
        { label: `Tessaya: ${hudView(state).label}`, enabled: false },
        ...(note ? [{ label: note, enabled: false }] : []),
        { type: "separator" },
        {
          label: "Always listening",
          type: "checkbox",
          enabled: binary !== null,
          checked: settings.enabled,
          click: (item) => {
            save({ enabled: item.checked });
            void (item.checked ? start().catch(failed) : stop());
          },
        },
        {
          label: "Mute",
          type: "checkbox",
          accelerator: VOICE_HOTKEYS[2]!.accelerator,
          checked: loop?.isMuted() ?? false,
          enabled: loop !== null,
          click: () => toggleMute(),
        },
        { label: "Wake now", enabled: loop !== null, click: () => loop?.activate("wake") },
        {
          label: "Copy last transcript or reply",
          enabled: (lastReply ?? lastDictation) !== null,
          click: () => {
            const last = lastReply ?? lastDictation;
            if (last !== null) Electron.clipboard.writeText(last);
          },
        },
        { type: "separator" },
        ...(input.extras?.menuItems() ?? []),
        ...(input.extras ? [{ type: "separator" as const }] : []),
        ...(input.updates?.ready() === true
          ? [{ label: "● Update ready: Install and restart", click: input.updates.install }]
          : []),
        { label: "Open Tessaya", click: () => home.open() },
        { label: "Quit", click: () => Electron.app.quit() },
      ]),
    );
  };

  const failed = (error: unknown) => {
    step("error", { message: error instanceof Error ? error.message : String(error) });
    note = error instanceof Error ? error.message : "The microphone could not be opened.";
    void stop();
  };

  const setDictation = (dictation: VoiceSettings["dictation"]) => {
    save({ dictation });
    configureDictation();
    render();
    if (dictation === "baton") requestDictation();
  };

  const setSpeechModel = (speechModel: VoiceSettings["speechModel"]) => {
    save({ speechModel });
    if (parakeetPath !== null || settings.enabled) requestDictation();
    else render();
  };

  const restart = async () => {
    const source = audio ?? (sidecar === null ? null : { listDevices: listSidecarDevices });
    if (source === null) return render();
    devices = await source.listDevices();
    choice = selectInputDevice(devices, preference());
    note = choice.kind === "default" && settings.pinnedLabel !== null ? choice.reason : null;
    configureDictation();
    await loop?.switchDevice(choiceDeviceId(choice));
    render();
  };

  /** Wake words are fixed when the core is built, so a change rebuilds it. */
  const relisten = async () => {
    if (loop !== null) await stop();
    await start().catch(failed);
  };

  const toggleMute = () => {
    loop?.activate("toggle_mute");
    pill.on({ type: "muted", on: loop?.isMuted() ?? false });
  };
  let registered: string[] = [];
  const handlers: Readonly<Record<string, () => void>> = {
    wake: () => loop?.activate("wake"),
    direct: () => loop?.activate("toggle_direct_session"),
    mute: () => toggleMute(),
    dictation: () => {
      if (settings.dictation !== "baton" || binary === null) return;
      // The first press is the opt-in: it fetches the model, and the next one records.
      if (parakeetPath === null) requestDictation();
      else sidecar?.toggle();
    },
    stop: () => {
      input.onDismiss?.();
      const stop = input.extras
        ?.menuItems()
        .find((i) => i.label === "Stop driving" || i.label === "Stop the lesson");
      (stop?.click as (() => void) | undefined)?.();
    },
    clear: () => {
      const clear = input.extras?.menuItems().find((i) => i.label === "Clear the screen");
      (clear?.click as (() => void) | undefined)?.();
    },
    ask: () => {
      const ask = input.extras?.menuItems().find((i) => i.label === "Ask Tessaya…");
      (ask?.click as (() => void) | undefined)?.();
    },
  };
  /** Puts every key he has set in place, and takes the old ones away. Mouse buttons go to the hook. */
  const applyBindings = () => {
    for (const accelerator of registered) Electron.globalShortcut.unregister(accelerator);
    registered = [];
    // The mouse side: the hook in the dictation sidecar reads this file; an empty list is no hook.
    try {
      NodeFS.mkdirSync(NodePath.join(input.stateDir, "voice"), { recursive: true });
      NodeFS.writeFileSync(
        NodePath.join(input.stateDir, "voice", "input-bindings.json"),
        JSON.stringify(mouseHookConfig(currentBindings())),
      );
    } catch {}
    for (const row of currentBindings()) {
      const keys = row.inputs.flatMap((i) =>
        i.type === "key" ? [toElectronAccelerator(i.accelerator)] : [],
      );
      if (row.def.id === "ask") input.extras?.setAskHotkey(keys[0] ?? null);
      if (row.def.id === "hold" || row.def.id === "toggle") continue;
      const handler = row.def.id === "ask" ? handlers["ask"] : handlers[row.def.id];
      for (const accelerator of row.def.id === "ask" ? keys.slice(1) : keys) {
        // A chord another app already owns is skipped, not fatal; the tray still works.
        if (handler !== undefined && Electron.globalShortcut.register(accelerator, handler)) {
          registered.push(accelerator);
        }
      }
    }
    const first = (action: string) => keysOf(action)[0];
    const holdKey = first("hold") ?? settings.holdKey;
    const toggleKey = first("toggle") ?? settings.toggleKey;
    if (holdKey !== settings.holdKey || toggleKey !== settings.toggleKey)
      save({ holdKey, toggleKey });
    configureDictation();
  };
  applyBindings();
  Electron.app.on("will-quit", () => {
    for (const accelerator of registered) Electron.globalShortcut.unregister(accelerator);
    void audio?.stop();
    rewriter.dispose();
    encoder.dispose();
    toast.dispose();
    history?.close();
    sidecar?.dispose();
  });

  // Hand edits to the settings file take effect without a restart.
  NodeFS.watchFile(settingsPath, { interval: 2_000 }, () => {
    const before = JSON.stringify(settings);
    settings = readSettings(settingsPath);
    const after = JSON.stringify(settings);
    if (before === after) return;
    configureDictation();
    applyBindings();
    void relisten();
  });
  setInterval(onDeviceChange, MIC_POLL_MS).unref();

  render();
  // First run after install, and until he has chosen what Baton works through: the window opens on its own.
  const shownPath = NodePath.join(input.stateDir, "baton-home.shown");
  const firstRun = !NodeFS.existsSync(shownPath);
  if (firstRun) NodeFS.writeFileSync(shownPath, new Date().toISOString());
  if (firstRun || input.extras?.needsBrainChoice() === true) {
    setTimeout(() => home.open(), 2_000).unref();
  }
  // Keys and the sidecar only once the model is here: nothing global before he asks for it.
  if (binary !== null && settings.dictation === "baton" && modelPresent(modelsDir, speechModel())) {
    requestDictation();
  }
  void start().catch(failed);
  return {
    refresh: render,
    openHome: () => home.open(),
    busy: () => speakingNow || !["sleeping", "listening", "muted"].includes(state),
    onSpeaking: (active) => {
      speakingNow = active;
      core?.setSpeaking(active);
      pill.on({ type: "speaking", active });
    },
    onSpoken: (text) => core?.noteSpoken(text),
    onTurnEnd: () => pill.on({ type: "finished" }),
    onActivity: (label, caption) =>
      pill.on({ type: "activity", label, ...(caption === undefined ? {} : { caption }) }),
    onSpeechLevel: pill.speechLevel,
    onDismissed: () => pill.on({ type: "dismissed" }),
    onNote: (message) => {
      note = message;
      render();
    },
  };
};
