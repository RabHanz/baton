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
  BatonCommitmentBridgeRequest,
  BatonWeaveBridgeRequest,
  BatonMemoryBridgeRequest,
  WatchFinding,
} from "@t3tools/baton-contracts";
import {
  chooseMode,
  cleanupFromSaved,
  cleanupLevelFor,
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
import { answerNeeds, answerNeedsSpoken } from "../presence/needsAnswer.ts";
import { describeWeaves, type WeaveRecord } from "@t3tools/baton-shared/weave";
import { expandSnippets, exportSnippets } from "@t3tools/baton-shared/snippets";
import {
  checkTransformOutput,
  refuseTransformInput,
  transformMessage,
  transformSystemPrompt,
  type Transform,
} from "@t3tools/baton-shared/transforms";
import { createModelAsk } from "../writing/modelAsk.ts";
import {
  applyStyle,
  categoryForApp,
  cleanupSettingOf,
  STYLE_CATEGORIES,
} from "@t3tools/baton-shared/writingStyle";
import { computeDeepInsights } from "@t3tools/baton-shared/insightsDeep";
import { insightControls } from "../writing/insightRows.ts";
import { previewOf, searchNotes } from "@t3tools/baton-shared/scratchpad";
import { createScratchStore } from "../writing/scratchStore.ts";
import { SCRATCH_HOTKEY, scratchAction, scratchControls } from "../writing/scratchRows.ts";
import {
  exportDictionaryCsv,
  IMPORT_MAX_BYTES,
  importDictionary,
} from "@t3tools/baton-shared/dictionaryIO";
import {
  LANGUAGE_HINT,
  languageOptions,
  languageToSave,
  shownLanguage,
} from "@t3tools/baton-shared/dictationLanguages";
import { ACCEPTED_EXTENSIONS, baseName, transcriptTitle } from "@t3tools/baton-shared/audioFile";
import { ffmpegToWav, transcribeFile } from "../writing/fileTranscribe.ts";
import { makeDiagnosticsFile } from "../health/diagnosticsFile.ts";
import { capabilities } from "@t3tools/baton-shared/degraded";
import { createProbes } from "../health/probes.ts";
import {
  normalizeSkillUrl,
  parseSkill,
  reviewCard,
  reviewSkill,
} from "@t3tools/baton-shared/skillReview";
import { fetchSkillText, installSkill, nameFromUrl, skillExists } from "../harness/skillInstall.ts";
import { createStyleStore } from "../writing/styleStore.ts";
import {
  GUIDE_BUTTONS,
  guideAnswer,
  guideQuestion,
  styleAction,
  styleControls,
} from "../writing/styleRows.ts";
import { createTransformStore } from "../writing/transformStore.ts";
import { transformAction, transformControls } from "../writing/transformRows.ts";
import { createSnippetStore } from "../writing/snippetStore.ts";
import { snippetAction, snippetControls } from "../writing/snippetRows.ts";
import { createExternalNeeds } from "../presence/needsSources.ts";
import { briefCommitments, needsFromCommitments } from "@t3tools/baton-shared/commitments";
import { createCommitmentSync } from "../presence/commitmentSync.ts";
import { createCommitmentStore } from "../presence/commitmentStore.ts";
import { runCommitOp } from "../presence/commitTools.ts";
import { presenceControls, presencePatch } from "../presence/presenceRows.ts";
import { EMPTY_NOW, nowAction, nowControls, type NowData } from "../presence/nowRows.ts";
import { collectNeeds } from "../presence/needsAnswer.ts";
import { createAnomalySource } from "../presence/anomalySource.ts";
import { createInitiative } from "../presence/initiativeEngine.ts";
import { readCiRuns } from "../presence/ciSource.ts";
import {
  DEFAULT_POLICY,
  triggersFromCi,
  triggersFromCommitments,
  triggersFromFindings,
  type CiRun,
} from "@t3tools/baton-shared/initiative";
import { createAwareness } from "../presence/awarenessState.ts";
import { harnessControls, pluginOfControl } from "../harness/harnessRows.ts";
import { readInventory, setPluginEnabled } from "../harness/harnessInventory.ts";
import {
  fileToEdit,
  PACK_FOLDER,
  packAction,
  packControls,
  packEdit,
  savePackText,
  useDefault,
} from "../pack/packRows.ts";
import { createNotesStore } from "../memory/memoryNotes.ts";
import { redactForHistory } from "../vault/redact.ts";
import { pendingSecret } from "../vault/pendingSecret.ts";
import { createMemorySync } from "../memory/memorySync.ts";
import { createMemoryTab } from "../memory/memoryTab.ts";
import { windowsHello } from "../vault/hello.ts";
import { createVaultTab } from "../vault/vaultTab.ts";
import { vaultFor } from "../vault/vaultInstance.ts";
import { noteAction } from "../memory/noteRows.ts";
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
  /** What the assistant may know of his state: each off until he turns it on (D149). */
  readonly awarenessWindow: boolean;
  readonly awarenessIdle: boolean;
  readonly awarenessFocus: boolean;
  readonly awarenessJobs: boolean;
  /** Offers when something needs a look: Off, a card with Yes, Later, Never, or the card and one spoken line. */
  readonly initiativeMode: "off" | "written" | "spoken";
  readonly initiativePerHour: number;
  /** Repositories whose failed builds become offers (gh, read-only). */
  readonly ciRepos: ReadonlyArray<string>;
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
  awarenessWindow: false,
  awarenessIdle: false,
  awarenessFocus: false,
  awarenessJobs: false,
  initiativeMode: "written",
  initiativePerHour: 3,
  ciRepos: [],
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
const AWARENESS_SAMPLE_MS = 30_000;
const INITIATIVE_MS = 2 * 60_000;
const COMMIT_SYNC_MS = 60_000;
const COMMIT_SYNC_SOON_MS = 3_000;
const NOW_REFRESH_MS = 5 * 60_000;
const CI_REFRESH_MS = 10 * 60_000;
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
  /** Registers or drops the Transforms shortcuts. */
  readonly setTransformHotkeys?: (on: boolean) => void;
  readonly writtenOnly: () => boolean;
  readonly ask: (input: {
    readonly title: string;
    readonly detail: string;
    readonly buttons: ReadonlyArray<string>;
    readonly cancel: number;
    readonly expiresMs?: number;
    /** Unasked: its Yes stays disabled this long, so a keystroke meant for something else cannot answer. */
    readonly armMs?: number;
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
  /** A lesson or drive sound, through the pill's own cue path. */
  readonly cue: (name: "start" | "stepDone" | "waiting" | "error" | "finished") => void;
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
  const snippets = createSnippetStore(input.stateDir);
  const transforms = createTransformStore(input.stateDir);
  const styles = createStyleStore(input.stateDir);
  const scratch = createScratchStore(input.stateDir);
  let scratchQuery = "";
  /** The next dictation becomes a note (the keyboard shortcut); cleared when it lands. */
  let noteNext = false;
  const setNoteHotkey = (on: boolean) => {
    Electron.globalShortcut.unregister(SCRATCH_HOTKEY);
    if (!on) return;
    Electron.globalShortcut.register(SCRATCH_HOTKEY, () => {
      noteNext = true;
      input.extras?.notice("The next thing you dictate goes to your Scratchpad.");
    });
  };
  setNoteHotkey(scratch.hotkeyOn());
  /** Worked out from History at most every half minute; Home redraws far more often. */
  let deepAt = 0;
  let deepValue: ReturnType<typeof computeDeepInsights> | null = null;
  const deepInsights = () => {
    if (history === null) return null;
    if (Date.now() - deepAt > 30_000) {
      const turns = history.list({ query: "", limit: 20_000 });
      deepValue = turns.some((t) => t.kind === "dictation")
        ? computeDeepInsights(turns, Date.now())
        : null;
      deepAt = Date.now();
    }
    return deepValue;
  };
  const askModel = createModelAsk({
    claudeBinary: () => settings.claudeBinary,
    model: () => settings.cleanupModel,
    workDir: NodePath.join(input.stateDir, "voice", "transform"),
    env: () => input.env,
    platform: input.platform,
    timeoutMs: 25_000,
  });
  const autoRewrite = async (t: Transform, text: string): Promise<string | null> => {
    if (refuseTransformInput(text) !== null) return null;
    const checked = checkTransformOutput(
      text,
      await askModel(transformSystemPrompt(t), transformMessage(text)),
    );
    return checked.ok ? checked.text : null;
  };
  let transformNote = "";
  /** Four questions, one per kind of writing, as the card with buttons; Skip leaves that one as it was. */
  const runStyleGuide = async (): Promise<void> => {
    for (const c of STYLE_CATEGORIES) {
      const q = guideQuestion(c);
      const index = await (input.extras?.ask({
        ...q,
        buttons: GUIDE_BUTTONS,
        cancel: GUIDE_BUTTONS.length - 1,
        expiresMs: 120_000,
      }) ?? Promise.resolve(GUIDE_BUTTONS.length - 1));
      const style = guideAnswer(index);
      if (style !== null) styles.set(c, style);
      render();
    }
  };
  input.extras?.setTransformHotkeys?.(transforms.read().enabled);
  /** Clean-up, then the spoken cues he saved expand (Snippets). */
  const writeClean = async (raw: string, app: { readonly exe: string; readonly title: string }) => {
    const out = await rewriter.clean({
      raw: biasTranscript(raw, dictionary),
      mode: chooseMode(app, settings.appModes),
      level: await levelNow(app),
    });
    const styled =
      chooseMode(app, settings.appModes) === "code" || chooseMode(app, settings.appModes) === "raw"
        ? out.text
        : applyStyle(out.text, styles.read()[categoryForApp(app)]);
    let text = expandSnippets(styled, snippets.list(), app.exe);
    // Transforms: one chosen rewrite after every dictation, if he asked. A failure inserts the cleaned text.
    const tcfg = transforms.read();
    const auto = tcfg.enabled ? transforms.all().find((t) => t.id === tcfg.autoApply) : undefined;
    if (auto !== undefined && cleanupLevelFor("claude", app) === "claude") {
      const rewritten = await autoRewrite(auto, text).catch(() => null);
      if (rewritten !== null) text = rewritten;
    }
    return { ...out, text };
  };
  let snippetNote = "";
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
    // A dictated password is not kept in plain text (VAULT.md section 6): History gets a mark, the vault gets an offer.
    const safe = redactForHistory(turn.raw, turn.cleaned);
    if (safe.secret !== null) {
      pendingSecret.set(turn.raw, Date.now());
      input.extras?.notice(
        `That looked like ${safe.secret}, so I kept it out of History. Say "put that in the vault" to keep it safely.`,
      );
      turn = { ...turn, raw: safe.raw, cleaned: safe.cleaned };
    }
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
    else if (action === "undo_ai") {
      // The heard words become the row's words (the written ones stay as a version) and go on the clipboard.
      history.update(id, {
        versions: withRetry(turn, {
          at: new Date().toISOString(),
          raw: turn.raw,
          cleaned: turn.raw,
          model: null,
        }),
        cleaned: turn.raw,
        status: "raw",
      });
      void Electron.clipboard.writeText(turn.raw);
    } else if (action === "copy") {
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
      clean: (raw) => writeClean(raw, flushApp),
      fit: (text) => fitToCaret(text, flushApp),
      paste: (text) =>
        noteNext
          ? Promise.resolve(
              (() => {
                noteNext = false;
                try {
                  scratch.add(text);
                  input.extras?.notice("Saved to your Scratchpad.");
                  return true;
                } catch {
                  return false;
                }
              })(),
            )
          : sidecar === null
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
      const { text } = await writeClean(request.text, app);
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
  const request = async (
    body:
      | VoiceIntentRequest
      | BatonJobBridgeRequest
      | BatonMemoryBridgeRequest
      | BatonCommitmentBridgeRequest
      | BatonWeaveBridgeRequest,
  ): Promise<unknown> => {
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
    body:
      | VoiceIntentRequest
      | BatonJobBridgeRequest
      | BatonMemoryBridgeRequest
      | BatonCommitmentBridgeRequest
      | BatonWeaveBridgeRequest,
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
  const commitments = createCommitmentStore(input.stateDir, Date.now, undefined, () =>
    setTimeout(() => void syncCommitments(), COMMIT_SYNC_SOON_MS).unref(),
  );
  // The server copy is shared by his devices; it only follows while the window exists, since asking opens it.
  const commitmentSync = createCommitmentSync({
    store: commitments,
    call: (op, args) => requestKept({ kind: "commitments", op, args }),
  });
  const syncCommitments = async (): Promise<void> => {
    if (mainContents === null || mainContents.isDestroyed()) return;
    await commitmentSync.sync();
  };
  setInterval(() => void syncCommitments(), COMMIT_SYNC_MS).unref();
  const externalNeeds = createExternalNeeds();
  const weaveOp = async (
    op: "weave_send" | "weave_list",
    args: Readonly<Record<string, unknown>>,
  ) => {
    if (op === "weave_list") {
      await requestKept({ kind: "weave", op: "tick", args: {} }).catch(() => undefined);
      const out = (await requestKept({ kind: "weave", op: "list", args: {} })) as {
        items?: ReadonlyArray<WeaveRecord>;
      } | null;
      return describeWeaves(out?.items ?? [], Date.now());
    }
    const out = (await requestKept({
      kind: "weave",
      op: "send",
      args: {
        to: String(args["session"] ?? ""),
        text: String(args["text"] ?? ""),
        from: "Tessaya",
        ...(typeof args["job"] === "string" ? { job: args["job"] } : {}),
      },
    })) as { weave?: WeaveRecord } | null;
    const w = out?.weave;
    if (w === undefined) return "The message was not sent.";
    return w.status === "delivered"
      ? `Delivered to ${w.toLabel}. Ask for weave_list later to read its reply [id: ${w.id}].`
      : w.status === "queued"
        ? `Not delivered yet, queued in order: ${w.reason ?? "it cannot take it now"} [id: ${w.id}].`
        : `Not delivered: ${w.reason ?? "unknown"} [id: ${w.id}].`;
  };
  const briefExtra = (): ReadonlyArray<string> => {
    const line = briefCommitments(commitments.list(), Date.now());
    return line === null ? [] : [line];
  };
  const awareness = createAwareness({
    switches: () => ({
      window: settings.awarenessWindow,
      idle: settings.awarenessIdle,
      focus: settings.awarenessFocus,
      jobs: settings.awarenessJobs,
    }),
    foreground: async () => {
      const app = await sidecar?.foreground();
      return app === undefined || app.exe.length === 0 ? null : `${app.exe}: ${app.title}`;
    },
    idleSeconds: () => Electron.powerMonitor.getSystemIdleTime(),
    focusSession: () =>
      input.sessions?.rows().find((r) => r.key === focusedWorkSessionId)?.session ?? null,
    runningJobs: () => (jobsCache ?? []).filter((j) => j.group === "running").map((j) => j.title),
    doing: () =>
      buildApprovals({ jobs: jobsCache ?? [], sessions: input.sessions?.rows() ?? [] })
        .slice(0, 3)
        .map((a) => `waiting for his answer: ${a.title}`),
    now: () => Date.now(),
  });
  setInterval(() => {
    if (awareness.active()) void awareness.sample().catch(() => undefined);
  }, AWARENESS_SAMPLE_MS).unref();
  // A typed ask has no spoken "confirm", so the read-back becomes a box he answers himself.
  input.extras?.setActions({
    presence: () => awareness.describe(),
    needsMe: async () =>
      answerNeedsSpoken({
        jobs: jobsCache ?? [],
        sessions: input.sessions?.rows() ?? [],
        findings: await watchFindings(),
        extra: needsFromCommitments(commitments.list(), Date.now()),
        config: { repos: settings.needsRepos, deadlinesFile: settings.needsDeadlinesFile },
        external: externalNeeds,
        now: Date.now(),
      }),
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
    memory: (op, args) =>
      requestKept({ kind: "memory", op: op as BatonMemoryBridgeRequest["op"], args }),
    jobs: async (op, args) => {
      if (op === "approvals") {
        const jobs = (await requestKept({ kind: "job", op: "list", args: {} })) as {
          jobs?: ReadonlyArray<BatonJob>;
        } | null;
        return describeApprovals(
          buildApprovals({ jobs: jobs?.jobs ?? [], sessions: input.sessions?.rows() ?? [] }),
        );
      }
      if (op === "commit_add" || op === "commit_done" || op === "commit_list") {
        return runCommitOp(commitments, op, args, Date.now());
      }
      if (op === "weave_send" || op === "weave_list") return weaveOp(op, args);
      if (op === "note_add") {
        try {
          return `Saved to the Scratchpad [id: ${scratch.add(String(args["text"] ?? "")).id}].`;
        } catch (error) {
          return error instanceof Error ? error.message : "That was not saved.";
        }
      }
      if (op === "note_search") {
        const found = searchNotes(scratch.notes(), String(args["query"] ?? "")).slice(0, 10);
        return found.length === 0
          ? "No note has all of those words."
          : found.map((n) => `${previewOf(n.text, 300)} [id: ${n.id}]`).join("\n");
      }
      if (op === "notices_stop") return initiative.stop(String(args["about"] ?? ""));
      if (op === "notices_resume") return initiative.resume(String(args["about"] ?? ""));
      if (op === "needs") {
        const jobs = (await requestKept({ kind: "job", op: "list", args: {} })) as {
          jobs?: ReadonlyArray<BatonJob>;
        } | null;
        return answerNeeds({
          jobs: jobs?.jobs ?? [],
          sessions: input.sessions?.rows() ?? [],
          findings: await watchFindings(),
          extra: needsFromCommitments(commitments.list(), Date.now()),
          config: { repos: settings.needsRepos, deadlinesFile: settings.needsDeadlinesFile },
          external: externalNeeds,
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
          extra: briefExtra(),
        });
      }
      // Rewrites of the selection are answered by the companion, which holds the keyboard.
      if (op === "text_transform" || op === "text_undo" || op === "text_command")
        return "That is not available here.";
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
      // The size comes in physical pixels; the overlay draws in desktop points.
      const scale = Electron.screen.getDisplayNearestPoint(real).scaleFactor || 1;
      return {
        ...real,
        name: found.name ?? label,
        ...(found.width === undefined || found.height === undefined
          ? {}
          : { width: found.width / scale, height: found.height / scale }),
      };
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
    const cleaned = await writeClean(raw, focusedApp).catch(() => null);
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
  /** A skill from a web address: fetched, reviewed, and filed only after he says yes on the card. */
  const addSkillFrom = async (address: string): Promise<void> => {
    const tell = (text: string) => input.extras?.notice(text);
    const target = normalizeSkillUrl(address);
    if (target === null) return tell("Use an https address, or a GitHub page of a SKILL.md.");
    try {
      const text = await fetchSkillText(target.url);
      const parsed = parseSkill(text, nameFromUrl(target.url));
      if (!parsed.ok) return tell(`Not added: ${parsed.why}`);
      const card = reviewCard({
        host: target.host,
        skill: parsed.skill,
        findings: reviewSkill(parsed.skill, text),
        exists: skillExists(claudeDir(), parsed.skill.name),
      });
      const answer = await (input.extras?.ask({
        ...card,
        buttons: ["Add it", "Cancel"],
        cancel: 1,
        expiresMs: 5 * 60_000,
      }) ?? Promise.resolve(1));
      if (answer !== 0) return tell("Not added.");
      installSkill(claudeDir(), parsed.skill.name, text);
      forgetFiles();
      home.refresh();
      tell(`Added the skill ${parsed.skill.name}. Claude Code reads it in new sessions.`);
    } catch (error) {
      tell(
        `Not added: ${error instanceof Error ? error.message : "the address could not be read"}`,
      );
    }
  };
  const notes = createNotesStore(NodePath.join(input.stateDir, "memory"));
  const vaultState = vaultFor(input.stateDir);
  const vaultTab = createVaultTab({
    vault: vaultState.vault,
    hello: (message) => windowsHello(message, input.platform),
    clipboard: {
      read: () => Electron.clipboard.readText(),
      write: (t) => Electron.clipboard.writeText(t),
      clear: () => Electron.clipboard.clear(),
    },
    audit: vaultState.audit,
    readAudit: () => {
      try {
        return NodeFS.readFileSync(vaultState.auditFile, "utf8")
          .split("\n")
          .filter((l) => l !== "");
      } catch {
        return [];
      }
    },
    stateDir: input.stateDir,
    refresh: () => home.refresh(),
    reveal: (file) => Electron.shell.showItemInFolder(file),
  });
  const memoryTab = createMemoryTab({
    call: (op, args) =>
      requestKept({ kind: "memory", op: op as BatonMemoryBridgeRequest["op"], args }),
    sync: createMemorySync({
      file: NodePath.join(input.stateDir, "baton-memory.json"),
      call: (op, args) =>
        requestKept({ kind: "memory", op: op as BatonMemoryBridgeRequest["op"], args }),
    }),
    notes,
    stateDir: input.stateDir,
    refresh: () => home.refresh(),
    reveal: (file) => Electron.shell.showItemInFolder(file),
  });
  const cachedPack = cachedFor(3_000, () =>
    packControls(NodePath.join(input.stateDir, PACK_FOLDER)),
  );
  /** Files he edits by hand or through a row here: forget what was read, so the next draw is true. */
  const forgetFiles = () => {
    harnessItems.reset();
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
        morningBrief({
          jobs: jobs?.jobs ?? [],
          findings: found,
          now: Date.now(),
          extra: briefExtra(),
        }),
        settings.briefMode === "spoken",
      );
    }
  };
  setInterval(() => void checkAttention().catch(() => undefined), ATTENTION_MS).unref();

  // Initiative (D149): offers as cards. A Yes starts a read-only plan-first job or notes a commitment.
  let ciCache: { at: number; runs: ReadonlyArray<CiRun> } = { at: 0, runs: [] };
  const ciRuns = async (): Promise<ReadonlyArray<CiRun>> => {
    if (settings.ciRepos.length === 0) return [];
    if (Date.now() - ciCache.at > CI_REFRESH_MS) {
      ciCache = { at: Date.now(), runs: await readCiRuns(settings.ciRepos) };
    }
    return ciCache.runs;
  };
  const anomalies = createAnomalySource({ dir: input.stateDir, now: () => Date.now() });
  const initiative = createInitiative({
    dir: input.stateDir,
    now: () => Date.now(),
    hour: () => new Date().getHours(),
    policy: () =>
      settings.initiativeMode === "off" || mainContents === null || mainContents.isDestroyed()
        ? null
        : {
            ...DEFAULT_POLICY,
            quietHours: settings.quietHours,
            maxPerHour: Math.max(1, Math.min(10, Math.floor(settings.initiativePerHour))),
            // Someone typing right now is the costly moment to interrupt.
            interruptionCost: Electron.powerMonitor.getSystemIdleTime() < 3 ? 15 : 0,
          },
    gather: async () => [
      ...triggersFromFindings(await watchFindings()),
      ...triggersFromCommitments(commitments.list(), Date.now()),
      ...triggersFromCi(await ciRuns(), Date.now()),
      ...anomalies.triggers(
        (jobsCache ?? []).map((j) => ({ id: j.workSessionId, title: j.title, group: j.group })),
        await ciRuns(),
      ),
    ],
    present: async (offer) => {
      if (settings.initiativeMode === "spoken") input.extras?.announce(offer.offer, true);
      const index = await (input.extras?.ask({
        title: "Tessaya",
        detail: offer.offer,
        buttons: ["Yes", "Later", "Never"],
        cancel: 1,
        armMs: 1_500,
        expiresMs: 5 * 60_000,
      }) ?? Promise.resolve(1));
      return index === 0 ? "yes" : index === 2 ? "never" : "later";
    },
    act: async (offer) => {
      const yes = offer.yes;
      if (yes.kind === "done") {
        commitments.close(yes.commitmentId, "done");
        return "Marked done.";
      }
      if (yes.kind === "commitment") {
        commitments.add({ text: yes.text, source: "offer" });
        return "I will keep track of it.";
      }
      const project =
        yes.repo !== undefined
          ? yes.repo.split("/")[1]
          : input.sessions?.rows().find((r) => r.key === yes.sessionId)?.project;
      if (project === undefined || project === "") {
        commitments.add({
          text: `Look into: ${offer.title}`.slice(0, 300),
          source: "offer",
          ...(yes.sessionId === undefined ? {} : { ref: yes.sessionId }),
        });
        return "I could not tell which project that is, so I noted it to look into.";
      }
      await requestKept({
        kind: "job",
        op: "start",
        args: {
          title: `Look into: ${offer.title}`.slice(0, 120),
          goal: yes.goal,
          project,
          folders: [],
          tools: ["read"],
        },
      });
      return "Started a read-only look in its own thread. Nothing changes until you agree to a plan.";
    },
    tell: (text) => input.extras?.announce(text, false),
  });
  setInterval(() => void initiative.tick().catch(() => undefined), INITIATIVE_MS).unref();

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

  // The Now page (D149): read every few minutes, not on every redraw, because it can call gh.
  let nowData: NowData = EMPTY_NOW;
  const probe = createProbes({});
  const refreshNow = async (): Promise<void> => {
    const at = Date.now();
    // Asking the server goes through the T3 window and would open it: only while it is already open.
    const windowUp = mainContents !== null && !mainContents.isDestroyed();
    const jobs = jobsCache ?? [];
    const { ranked, unreadable } = await collectNeeds({
      jobs,
      sessions: input.sessions?.rows() ?? [],
      findings: windowUp ? await watchFindings() : [],
      extra: needsFromCommitments(commitments.list(), at),
      config: { repos: settings.needsRepos, deadlinesFile: settings.needsDeadlinesFile },
      external: externalNeeds,
      now: at,
    });
    const day = new Date(at).toDateString();
    const learned = (
      (windowUp
        ? await requestKept({ kind: "memory", op: "list", args: { limit: 200 } }).catch(() => null)
        : null) as {
        items?: ReadonlyArray<{ text: string; createdAt: string; proposed: boolean }>;
      } | null
    )?.items
      ?.filter((m) => !m.proposed && new Date(m.createdAt).toDateString() === day)
      .slice(0, 5)
      .map((m) => m.text);
    const probed = await probe(settings.claudeBinary);
    const state = initiative.state();
    nowData = {
      loaded: true,
      needs: ranked,
      unreadable,
      commitments: commitments.list().filter((c) => c.status === "open"),
      doing: [
        ...jobs.filter((j) => j.group === "running").map((j) => `Running: ${j.title}`),
        ...buildApprovals({ jobs, sessions: input.sessions?.rows() ?? [] })
          .slice(0, 3)
          .map((a) => `Waiting for your answer: ${a.title}`),
      ],
      learned: learned ?? [],
      declined: state.declined.slice(-8).toReversed(),
      muted: state.never.map((topic) => ({ topic, title: state.titles[topic] ?? topic })),
      capabilities: capabilities({
        network: probed.network,
        claude: probed.claude,
        speechModel: sidecar !== null && parakeetPath !== null,
        server: jobsCache !== null,
      }),
      weaves:
        (
          (windowUp
            ? await requestKept({ kind: "weave", op: "list", args: { limit: 10 } }).catch(
                () => null,
              )
            : null) as { items?: ReadonlyArray<WeaveRecord> } | null
        )?.items ?? [],
    };
    home.refresh();
  };
  setInterval(() => void refreshNow().catch(() => undefined), NOW_REFRESH_MS).unref();
  setTimeout(() => void refreshNow().catch(() => undefined), 15_000).unref();

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
      ...nowControls(nowData, Date.now()),
      ...snippetControls(snippets.list(), snippetNote),
      ...transformControls(transforms.read(), transforms.all(), transformNote),
      ...styleControls(styles.read(), settings.dictationCleanup),
      ...insightControls(deepInsights()),
      {
        id: "d.import",
        section: "Vocabulary files",
        label: "Import or export your vocabulary",
        hint: "A file of words, one per line or heard,written, or JSON: up to 3 MB and 1,000 words. A word already there is replaced. Export saves a CSV you can import again.",
        kind: "action",
        button: "Import a file",
        secondary: "Export",
      },
      ...scratchControls(scratch.notes(), scratchQuery, scratch.hotkeyOn()),
      ...presenceControls(settings),
      ...memoryTab.controls(),
      ...vaultTab.controls(),
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
          { value: "v3", label: "25 European languages, slower" },
          { value: "fast", label: "English, 3x quicker" },
        ],
        more: true,
      },
      {
        id: "v.language",
        section: "Dictation",
        label: "Language you speak",
        hint: LANGUAGE_HINT,
        kind: "choice",
        value: shownLanguage(settings.speechModel, settings.language),
        options: languageOptions(settings.speechModel),
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
        id: "v.pillPlace",
        section: "On screen",
        label: "Pill position",
        hint: "Or drag it: it lines up on a grid and snaps to centre, top and bottom. Hold Alt or Shift to place it freely. Right-click it for the same places.",
        kind: "choice",
        value: pill.place(),
        options: [
          { value: "centre", label: "Centre" },
          { value: "top", label: "Top" },
          { value: "bottom", label: "Bottom" },
        ],
      },
      {
        id: "v.pillMove",
        section: "On screen",
        label: "Move the pill",
        hint: "Shows the pill for ten seconds so you can drag it where you want it.",
        kind: "action",
        button: "Move",
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
        id: "v.diag",
        section: "Check",
        label: "Something is wrong and you want to report it",
        hint: "Makes one text file of versions, why Tessaya last stopped, and timings, with no dictated or spoken words, tokens, email addresses or user names. It is not sent anywhere: read it, then attach it yourself.",
        kind: "action",
        button: "Make a diagnostics file",
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
    if (memoryTab.act(id, value)) return;
    if (vaultTab.act(id, value)) return;
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
    } else if (id === "d.import") {
      void Electron.dialog
        .showOpenDialog({
          properties: ["openFile"],
          filters: [{ name: "Words", extensions: ["csv", "txt", "json"] }],
        })
        .then((picked) => {
          const file = picked.filePaths[0];
          if (picked.canceled || file === undefined) return;
          if (NodeFS.statSync(file).size > IMPORT_MAX_BYTES) {
            input.extras?.notice("That file is over 3 MB.");
            return;
          }
          const done = importDictionary(NodeFS.readFileSync(file, "utf8"));
          if (done.refused !== undefined) return void input.extras?.notice(done.refused);
          for (const r of done.rows) dictionary = addEntry(dictionary, r);
          saveDictionary(input.stateDir, dictionary);
          input.extras?.notice(
            `Imported ${done.rows.length} words${done.skipped > 0 ? `; ${done.skipped} lines were skipped` : ""}.`,
          );
          render();
        })
        .catch(() => undefined);
    } else if (id === "d.import:later") {
      void Electron.dialog
        .showSaveDialog({
          defaultPath: "vocabulary.csv",
          filters: [{ name: "CSV", extensions: ["csv"] }],
        })
        .then((picked) => {
          if (picked.canceled || picked.filePath === undefined) return;
          NodeFS.writeFileSync(
            picked.filePath,
            exportDictionaryCsv(
              (dictionary as ReadonlyArray<VocabEntry>).map((d) => ({
                phrase: d.phrase,
                replacement: d.replacement ?? null,
              })),
            ),
          );
          input.extras?.notice("Vocabulary exported.");
        })
        .catch(() => undefined);
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
    } else if (packEdit(id) !== null) {
      const act = packEdit(id)!;
      const dir = NodePath.join(input.stateDir, PACK_FOLDER);
      if (act.save) {
        const why = savePackText(dir, act.id, typeof value === "string" ? value : "");
        input.extras?.notice(why ?? "Saved. It applies to the next job.");
      } else useDefault(dir, act.id);
      cachedPack.reset();
      home.refresh();
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
    } else if (id.startsWith("pr.")) {
      const patch = presencePatch(id, value, settings);
      if (patch !== null) save(patch);
    } else if (id.startsWith("sn.")) {
      const act = snippetAction(id, value);
      if (act?.kind === "put") {
        snippetNote = snippets.put(act.snippet) ? "" : "The list is full (500).";
      } else if (act?.kind === "bad") {
        snippetNote = "That is not a snippet. Write it as cue = the text it expands to.";
      } else if (act?.kind === "remove") snippets.remove(act.cue);
      else if (act?.kind === "import") {
        void Electron.dialog
          .showOpenDialog({
            properties: ["openFile"],
            filters: [{ name: "Snippets", extensions: ["json", "csv", "txt"] }],
          })
          .then((picked) => {
            const file = picked.filePaths[0];
            if (picked.canceled || file === undefined) return;
            const done = snippets.importText(NodeFS.readFileSync(file, "utf8"));
            snippetNote = `Imported ${done.added}${done.skipped > 0 ? `; ${done.skipped} lines were not snippets` : ""}.`;
            render();
          })
          .catch(() => undefined);
      } else if (act?.kind === "export") {
        void Electron.dialog
          .showSaveDialog({
            defaultPath: "snippets.json",
            filters: [{ name: "Snippets", extensions: ["json"] }],
          })
          .then((picked) => {
            if (picked.canceled || picked.filePath === undefined) return;
            NodeFS.writeFileSync(picked.filePath, exportSnippets(snippets.list()));
            snippetNote = "Exported.";
            render();
          })
          .catch(() => undefined);
      }
    } else if (/^sc[.:]/.test(id)) {
      const act = scratchAction(id, value);
      if (act?.kind === "add") {
        try {
          scratch.add(act.text);
        } catch {
          // Empty or too long: nothing is added.
        }
      } else if (act?.kind === "search") scratchQuery = act.query.trim();
      else if (act?.kind === "hotkey") {
        scratch.setHotkey(act.on);
        setNoteHotkey(act.on);
      } else if (act?.kind === "copy") {
        const note = scratch.notes().find((n) => n.id === act.id);
        if (note !== undefined) void Electron.clipboard.writeText(note.text);
      } else if (act?.kind === "delete") scratch.remove(act.id);
    } else if (id === "tf.pick" || id === "tf.file") {
      const run = (file: string) => {
        if (sidecar === null || parakeetPath === null) {
          input.extras?.notice("The speech model is not ready on this computer yet.");
          return;
        }
        input.extras?.notice(`Transcribing ${baseName(file)}...`);
        void transcribeFile(file, {
          readFile: (p) => NodeFS.promises.readFile(p),
          toWav: ffmpegToWav,
          transcribe: (pcm) => makeSidecarStt(sidecar!).transcribe(pcm),
          progress: (done, total) => {
            if (total > 1)
              input.extras?.notice(
                `Transcribing ${baseName(file)}: ${done} of ${total} minutes...`,
              );
          },
        }).then((out) => {
          if (!out.ok) return void input.extras?.notice(out.why);
          try {
            scratch.add(`${transcriptTitle(file)}\n\n${out.text}`);
          } catch {
            // Too long for a note: the clipboard still has it.
          }
          void Electron.clipboard.writeText(out.text);
          input.extras?.notice(
            `${transcriptTitle(file)} is in your Scratchpad and on the clipboard.`,
          );
          render();
        });
      };
      if (id === "tf.file" && typeof value === "string") run(value);
      else {
        void Electron.dialog
          .showOpenDialog({
            properties: ["openFile"],
            filters: [{ name: "Audio", extensions: ACCEPTED_EXTENSIONS.map((e) => e.slice(1)) }],
          })
          .then((picked) => {
            const file = picked.filePaths[0];
            if (!picked.canceled && file !== undefined) run(file);
          })
          .catch(() => undefined);
      }
    } else if (id.startsWith("st.")) {
      const act = styleAction(id, value);
      if (act?.kind === "style") styles.set(act.category, act.style);
      else if (act?.kind === "level") {
        save({ dictationCleanupChosen: true, dictationCleanup: cleanupSettingOf(act.level) });
      } else if (act?.kind === "guide") void runStyleGuide();
    } else if (id.startsWith("tr.")) {
      const act = transformAction(id, value);
      transformNote = "";
      if (act?.kind === "command") transforms.setCommand(act.on);
      else if (act?.kind === "enabled") {
        transforms.setEnabled(act.on);
        input.extras?.setTransformHotkeys?.(act.on);
      } else if (act?.kind === "auto") transforms.setAutoApply(act.id);
      else if (act?.kind === "put") {
        transformNote = transforms.put(act.transform) ? "" : "You can have 20 of your own.";
      } else if (act?.kind === "bad") {
        transformNote = "That is not a transform. Write it as Name = what to do with the text.";
      } else if (act?.kind === "remove") {
        transformNote = transforms.remove(act.id)
          ? ""
          : "A built-in cannot be removed; replace it with your own of the same name.";
      } else if (act?.kind === "reset") transforms.reset();
    } else if (id === "now.refresh") void refreshNow().catch(() => undefined);
    else if (id.startsWith("now.")) {
      const act = nowAction(id);
      if (act?.kind === "commitment") {
        try {
          commitments.close(act.id, act.drop ? "dropped" : "done");
        } catch {
          // Already closed elsewhere; the refresh shows the truth.
        }
      } else if (act?.kind === "allow") initiative.allow(act.topic);
      void refreshNow().catch(() => undefined);
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
    } else if (id === "v.language" && typeof value === "string") {
      const chosen = languageToSave(settings.speechModel, value);
      if (chosen !== undefined) {
        save({ language: chosen });
        configureDictation();
      }
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
    } else if (
      id === "v.pillPlace" &&
      (value === "centre" || value === "top" || value === "bottom")
    ) {
      pill.moveTo(value);
    } else if (id === "v.pillMove") pill.showMove();
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
    } else if (id === "k.addskill:add" && typeof value === "string") {
      void addSkillFrom(value);
    } else if (id === "v.diag") {
      try {
        const file = makeDiagnosticsFile({
          stateDir: input.stateDir,
          logDir: input.logDir,
          version: Electron.app.getVersion(),
          settingsFile: settingsPath,
        });
        Electron.shell.showItemInFolder(file);
        input.extras?.notice(
          "The diagnostics file is made and shown in its folder. Nothing was sent.",
        );
      } catch {
        input.extras?.notice("The diagnostics file could not be made.");
      }
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
      if (tab === "memory") void memoryTab.load();
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
    save({ speechModel, ...(speechModel === "fast" ? { language: "en" } : {}) });
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
    cue: (name) => pill.cue(name),
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
