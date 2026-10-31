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

import type { BatonFocusTarget } from "@t3tools/baton-contracts";
import {
  chooseMode,
  modeMenu,
  type CleanupLevel,
  type DictationMode,
  type DictionaryEntry,
} from "@t3tools/baton-shared/dictationCleanup";
import {
  createVoiceRouter,
  type BatonVoiceCore,
  type SttProvider,
  type VoiceCoreEvent,
  type VoiceIntentClient,
} from "@t3tools/baton-voice";
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
  type BrainVoiceHook,
  type VoiceIntentRequest,
  type WakeWordSetting,
} from "./desktopVoiceCore.ts";
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
import { importWisprDictionary, makeRewriter, readDictionary } from "./dictationRewriter.ts";
import { DICTATION_TOGGLE_HOTKEY, VOICE_HOTKEYS } from "./voiceActivation.ts";
import { ensureModel, modelPresent, PARAKEET_FAST_MODEL, PARAKEET_MODEL } from "./voiceModels.ts";
import { hudView, utteranceCaption } from "./voiceHud.ts";
import type { AssistantActions } from "../screen/ScreenCompanion.ts";
import { createVoicePill, type VoicePill } from "./voicePill.ts";
import { frameLevel, type TurnEvent } from "@t3tools/baton-shared/voiceTurn";
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
  /** The soft sounds on wake and at the end of a turn. */
  readonly sounds: boolean;
  /** A small mark while idle; nothing on screen otherwise. */
  readonly pillAtRest: boolean;
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
  /** A family alias, on his subscription. */
  readonly cleanupModel: string;
  readonly claudeBinary: string;
  /** His writing mode for an app, by exe name; anything else is chosen from the app. */
  readonly appModes: Readonly<Record<string, DictationMode>>;
  /** All enabled words listen at once. A new word needs `<word>.onnx` in `<state dir>/voice/models`. */
  readonly wakeWords: ReadonlyArray<WakeWordSetting>;
}

const DEFAULT_SETTINGS: VoiceSettings = {
  enabled: false,
  openAtLogin: false,
  pinnedLabel: null,
  modelsDir: null,
  micOrder: [
    // Applies only to devices that are present. A Scarlett Solo's mic input is its input 1;
    // mixing in the empty input 2 halves the level.
    { name: "Scarlett Solo", channel: 0 },
    { name: "Focusrite", channel: 0 },
    // How Windows names a DJI receiver.
    { name: "Wireless Mic Rx", channel: null },
    { name: "DJI", channel: null },
  ],
  sounds: true,
  pillAtRest: false,
  pillEdge: "bottom",
  dictation: "baton",
  speechModel: "v3",
  // Clear of Wispr Flow's defaults: Ctrl+Win, Ctrl+Win+Space, Ctrl+Alt+Win.
  holdKey: "Ctrl+Alt+Space",
  toggleKey: "Ctrl+Alt+Shift+Space",
  paste: "ctrl_v",
  language: "en",
  dictationCleanup: "claude",
  cleanupModel: "haiku",
  claudeBinary: "claude",
  appModes: {},
  wakeWords: [
    // Thresholds measured on 6.6 hours of real speech and held-out en-GB voices (D98).
    { word: "Sebastian", enabled: true, threshold: 0.97 },
    { word: "Alfred", enabled: true, threshold: 0.9 },
    { word: "Freya", enabled: true, threshold: 0.95 },
    // Off: as an ordinary word in speech it wakes too easily (D98).
    { word: "Onyx", enabled: false, threshold: 0.9 },
  ],
};

/** The renderer has this long to answer an intent call before the core is told it failed. */
const REQUEST_TIMEOUT_MS = 20_000;
/** Under the context bus's 30 s TTL, so what Baton has open never expires while it is open. */
const CONTEXT_REFRESH_MS = 10_000;
/** How soon a plugged or unplugged mic is noticed; listing devices costs a few milliseconds. */
const MIC_POLL_MS = 5_000;
/** The pointer does not wait on a slow accessibility tree. */
const LOCATE_TIMEOUT_MS = 1_500;
const LOCATE_MAX_DIP = 160;

const readSettings = (path: string): VoiceSettings => {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(NodeFS.readFileSync(path, "utf8")) };
  } catch {
    return DEFAULT_SETTINGS;
  }
};

/** Long enough to read a sentence that did not land where it was meant to. */
const KEPT_TEXT_MS = 20_000;
const PILL_TEXT_CHARS = 90;

/** A 16×16 filled dot in the state's colour, drawn rather than shipped. */
const trayIcon = (color: string): Electron.NativeImage => {
  const size = 16;
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(color.slice(i, i + 2), 16));
  const bitmap = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const inside = (x - 7.5) ** 2 + (y - 7.5) ** 2 <= 36;
      const at = (y * size + x) * 4;
      bitmap.set(inside ? [b!, g!, r!, 255] : [0, 0, 0, 0], at); // BGRA
    }
  }
  return Electron.nativeImage.createFromBitmap(bitmap, { width: size, height: size });
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
}

/** The assistant, as the voice side sees it: its tray entries (D84) and the one brain (D100). */
export interface TrayExtras extends BrainVoiceHook {
  readonly menuItems: () => ReadonlyArray<Electron.MenuItemConstructorOptions>;
  readonly setActions: (actions: AssistantActions) => void;
  readonly notice: (text: string) => void;
  readonly writtenOnly: () => boolean;
  readonly ask: (input: {
    readonly title: string;
    readonly detail: string;
    readonly buttons: ReadonlyArray<string>;
    readonly cancel: number;
  }) => Promise<number>;
}

export interface DesktopBatonVoiceInput {
  readonly stateDir: string;
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
  readonly holdEscape: (onPress: () => void) => () => void;
  /** What to do when he dismisses a turn: stop Baton's voice, and the same for the assistant. */
  readonly onDismiss?: () => void;
  /** Wake-to-pill, for the record. */
  readonly onWakeShown?: (ms: number) => void;
}

export interface DesktopBatonVoice {
  /** Rebuild the tray menu, after the companion's state changed. */
  readonly refresh: () => void;
  /** Baton's voice started or stopped. */
  readonly onSpeaking: (active: boolean) => void;
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

  const tray = new Electron.Tray(trayIcon(hudView("sleeping").color));
  const modelsDir = NodePath.join(input.stateDir, "voice", "models");
  const binary = input.dictationBinary;
  let sidecar: DictationSidecar | null = null;
  let parakeetPath: string | null = null;
  let modelJob: Promise<string> | null = null;
  let sidecarDevices: ReadonlyArray<SidecarDevice> = [];
  let releaseRecordingEscape: (() => void) | null = null;
  let lastDictation: string | null = null;
  let focusedApp: FocusedApp = { exe: "", title: "" };
  let dictionary: ReadonlyArray<DictionaryEntry> = [];
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
  const injection: typeof clipboardInjection = {
    ...clipboardInjection,
    // The sidecar pastes on every platform, where Electron alone cannot.
    canInject: (target) => binary !== null || clipboardInjection.canInject(target),
    // Handy's paste keeps his clipboard; PowerShell's stays for when the sidecar is not there.
    insertText: async (request) => {
      if (sidecar === null) return clipboardInjection.insertText(request);
      // Wake-word dictation takes the same path as the hold key, so the same text comes out.
      const app = await sidecar.foreground().catch(() => focusedApp);
      const { text } = await rewriter.clean({
        raw: request.text,
        mode: chooseMode(app, settings.appModes),
        level: settings.dictationCleanup,
      });
      return sidecar.paste(text);
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
  const render = () => {
    tray.setImage(trayIcon(hudView(state).color));
    tray.setToolTip(`Baton: ${hudView(state).label} · ${deviceName()}${note ? ` · ${note}` : ""}`);
    rebuildMenu();
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
  const request = async (body: VoiceIntentRequest): Promise<unknown> => {
    const window = await input.ensureMainWindow();
    mainContents = window.webContents;
    const id = ++nextRequest;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error("Baton did not answer."));
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
  const voiceIntent = makeVoiceIntentClient({ request, injection, field: FOCUSED_FIELD });
  const typedRouter = createVoiceRouter(voiceIntent);
  const routeContext = () => ({
    bus: desktopVoiceContext({ focusedWorkSessionId, field, observedAt: new Date() }),
    now: Date.now(),
  });
  // A typed ask has no spoken "confirm", so the read-back becomes a box he answers himself.
  input.extras?.setActions({
    focus: async () => {
      const app = await sidecar?.foreground();
      if (app === undefined || app.exe.length === 0) return null;
      const rect = app.rect == null ? null : Electron.screen.screenToDipRect(null, app.rect);
      return {
        label: `${app.exe}: ${app.title}`,
        centre: rect === null ? null : { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 },
      };
    },
    locate: async (label, near) => {
      if (sidecar === null) return null;
      const physical = Electron.screen.dipToScreenPoint(near);
      const found = await Promise.race([
        sidecar.locate({ label, x: physical.x, y: physical.y }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), LOCATE_TIMEOUT_MS)),
      ]).catch(() => null);
      if (found?.found !== true || found.x === undefined || found.y === undefined) return null;
      const real = Electron.screen.screenToDipPoint({ x: found.x, y: found.y });
      // Same name far from where the model saw it is a different thing.
      if (Math.hypot(real.x - near.x, real.y - near.y) > LOCATE_MAX_DIP) return null;
      return { ...real, name: found.name ?? label };
    },
    grammarPlaces: async (said) => {
      if (mainContents === null) return false;
      const resolution = await voiceIntent.resolve({
        text: said,
        focusedWorkSessionId,
        allowModel: false,
      });
      return resolution.outcome === "resolved";
    },
    act: async (command) => {
      const outcome = await typedRouter.route(
        { kind: "command", text: command, inheritedTarget: null },
        routeContext(),
      );
      if (outcome.kind !== "needs_confirmation") return "reply" in outcome ? outcome.reply : "";
      const response = await (input.extras?.ask({
        title: outcome.prompt.replace(/ Say "confirm" to go ahead\.$/, ""),
        detail: "",
        buttons: ["Go ahead", "Not now"],
        cancel: 1,
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

  const configureDictation = () => {
    if (sidecar === null) return;
    const device = choice.kind === "pinned" ? choice.device.label : null;
    const baton = settings.dictation === "baton" && parakeetPath !== null;
    sidecar.configure({
      model: parakeetPath,
      hold: baton ? settings.holdKey : null,
      toggle: baton ? settings.toggleKey : null,
      device,
      channel: device === null ? null : channelFor(device),
      paste: settings.paste,
      language: settings.language,
      cleanup: true,
    });
  };

  const showDictation = (caption: string | null) => {
    pill.on({ type: "dictating", caption });
    render();
  };
  // Esc is taken only while the microphone is open, so it stays his the rest of the time.
  const setRecording = (next: boolean) => {
    if (next === (releaseRecordingEscape !== null)) return;
    if (next) releaseRecordingEscape = input.holdEscape(() => sidecar?.cancel());
    else {
      releaseRecordingEscape?.();
      releaseRecordingEscape = null;
    }
  };
  /** Words that have no home yet: on the pill for a while, and in the tray until the next ones. */
  const keepText = (why: string, text: string) => {
    lastDictation = text;
    showDictation(`${why}. Tray: Copy last dictation.`);
    if (keptTimer !== null) clearTimeout(keptTimer);
    keptTimer = setTimeout(() => showDictation(null), KEPT_TEXT_MS);
  };
  /** The sidecar held this back for clean-up; it goes only into the window it was spoken for. */
  const deliver = async (raw: string, target: number | null | undefined) => {
    const { text } = await rewriter.clean({
      raw,
      mode: chooseMode(focusedApp, settings.appModes),
      level: settings.dictationCleanup,
    });
    lastDictation = text;
    const pasted =
      target === null || target === undefined || text.length === 0
        ? false
        : await sidecar?.pasteInto(text, target).catch((error: Error) => {
            note = error.message;
            return false;
          });
    if (pasted === true || text.length === 0) showDictation(null);
    else keepText("Not pasted", text);
  };
  const onDictation = (event: DictationEvent) => {
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
        if (text.length > 0) pill.on({ type: "done", label: "Pasted" });
      }
    }
  };

  // Both the wake capture and the dictation recorder follow the same choice.
  const onDeviceChange = () => {
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
    sounds: () => settings.sounds,
    rest: () => settings.pillAtRest,
    edge: () => settings.pillEdge,
    holdEscape: input.holdEscape,
    onDismiss: () => {
      pill.on({ type: "dismissed" });
      loop?.activate("dismiss");
      input.onDismiss?.();
    },
    ...(input.onWakeShown === undefined ? {} : { onShown: input.onWakeShown }),
  });
  if (settings.pillAtRest) pill.setRest(true);
  const onCoreEvent = (event: VoiceCoreEvent) => {
    const turn = ((): TurnEvent | null => {
      switch (event.type) {
        case "wake":
          return { type: "wake", word: wordName(event.word) };
        case "thinking":
          return { type: "thinking" };
        case "nothing":
          return { type: "failed", message: "Didn't catch that" };
        case "transcript":
          return { type: "heard", text: event.text };
        case "error":
          return { type: "failed", message: event.message };
        case "state":
          if (event.state === "sleeping") return { type: "window_closed" };
          return event.target === null ? null : { type: "target", name: `to ${event.target}` };
        case "outcome":
          // The assistant reports its own end; everything else ends here, or with its speech.
          return "source" in event.outcome && event.outcome.source === "screen"
            ? null
            : { type: "finished" };
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

  const start = async () => {
    if (binary === null) {
      note = "Voice is Windows only for now.";
      return render();
    }
    if (loop !== null || input.makeCore === null || !settings.enabled) return render();
    // The models first: if they are missing, no microphone is opened.
    await loadSpeechModel();
    if (sidecar === null) throw new Error("Speech recognition is not installed.");
    core = await input.makeCore({
      intent: voiceIntent,
      onReply: flash,
      settings,
      stt: makeSidecarStt(sidecar),
      onEvent: onCoreEvent,
    });
    pushContext();
    contextTimer = setInterval(pushContext, CONTEXT_REFRESH_MS);
    audio = makeSidecarAudioInput({
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
    pill.warm();
    devices = await audio.listDevices();
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
      onLevel: (frame) => pill.micLevel(frameLevel(frame)),
      // The core's router has already sent the words on; this is the HUD's line.
      onUtterance: (utterance) => flash(utteranceCaption(utterance)),
    });
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

  const rebuildMenu = () => {
    const pinned = choice.kind === "pinned" ? choice.device.label : null;
    tray.setContextMenu(
      Electron.Menu.buildFromTemplate([
        { label: `Baton: ${hudView(state).label}`, enabled: false },
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
          label: "Wake words",
          submenu: settings.wakeWords.map((wake) => ({
            label: wake.word,
            type: "checkbox" as const,
            checked: wake.enabled,
            click: (item: Electron.MenuItem) => {
              save({
                wakeWords: settings.wakeWords.map((other) =>
                  other.word === wake.word ? { ...other, enabled: item.checked } : other,
                ),
              });
              void relisten();
            },
          })),
        },
        {
          label: "Dictation",
          enabled: binary !== null,
          submenu: [
            {
              label: `Baton (${settings.holdKey})`,
              type: "radio",
              checked: settings.dictation === "baton",
              click: () => setDictation("baton"),
            },
            {
              label: "Wispr Flow",
              type: "radio",
              checked: settings.dictation === "wispr",
              click: () => setDictation("wispr"),
            },
            ...(settings.dictation === "baton" && parakeetPath === null
              ? [
                  {
                    label: `Download speech model (${Math.round(speechModel().size / 1e6)} MB)`,
                    enabled: modelJob === null,
                    click: requestDictation,
                  },
                ]
              : []),
            {
              label: "Cancel recording",
              enabled: releaseRecordingEscape !== null,
              click: () => sidecar?.cancel(),
            },
            {
              label: "Copy last dictation",
              enabled: lastDictation !== null,
              click: () => {
                if (lastDictation !== null) void Electron.clipboard.writeText(lastDictation);
              },
            },
            { type: "separator" },
            {
              label: "Clean-up",
              submenu: (
                [
                  ["claude", "Local, then Claude when needed"],
                  ["local", "Local only"],
                  ["off", "Off, exactly as heard"],
                ] as const
              ).map(([level, label]) => ({
                label,
                type: "radio" as const,
                checked: settings.dictationCleanup === level,
                click: () => save({ dictationCleanup: level }),
              })),
            },
            {
              label: `Writing mode for ${focusedApp.exe || "this app"}`,
              enabled: focusedApp.exe.length > 0,
              submenu: modeMenu({
                exe: focusedApp.exe,
                chosen: settings.appModes,
                choose: (exe, mode) => {
                  const { [exe]: _old, ...others } = settings.appModes;
                  save({ appModes: mode === null ? others : { ...others, [exe]: mode } });
                },
              }),
            },
            { type: "separator" },
            {
              label: "Parakeet v3 (most languages, slower)",
              type: "radio",
              checked: settings.speechModel === "v3",
              click: () => setSpeechModel("v3"),
            },
            {
              label: "Parakeet Fast (English, 3x quicker)",
              type: "radio",
              checked: settings.speechModel === "fast",
              click: () => setSpeechModel("fast"),
            },
          ],
        },
        {
          label: "Sounds",
          type: "checkbox",
          checked: settings.sounds,
          click: (item) => save({ sounds: item.checked }),
        },
        {
          label: "Pill",
          submenu: [
            {
              label: "Show a small mark at rest",
              type: "checkbox",
              checked: settings.pillAtRest,
              click: (item) => {
                save({ pillAtRest: item.checked });
                pill.setRest(item.checked);
              },
            },
            { type: "separator" },
            ...(["bottom", "top"] as const).map((edge) => ({
              label: edge === "bottom" ? "Above the taskbar" : "At the top",
              type: "radio" as const,
              checked: settings.pillEdge === edge,
              click: () => {
                save({ pillEdge: edge });
                pill.setEdge(edge);
              },
            })),
          ],
        },
        {
          label: "Edit voice settings…",
          click: () => {
            save({});
            void Electron.shell.openPath(settingsPath);
          },
        },
        {
          label: "Direct to focused session",
          type: "checkbox",
          checked: state === "direct_session",
          enabled: loop !== null,
          click: () => loop?.activate("toggle_direct_session"),
        },
        {
          label: "Microphone",
          submenu: [
            {
              label: "Automatic",
              type: "radio",
              checked: settings.pinnedLabel === null,
              click: () => {
                save({ pinnedLabel: null });
                void restart();
              },
            },
            ...realDevices(devices).map((device) => ({
              label: device.label || "Unnamed microphone",
              type: "radio" as const,
              checked: pinned === device.label,
              click: () => {
                save({ pinnedLabel: device.label });
                void restart();
              },
            })),
          ],
        },
        {
          label: "Start Baton when I sign in",
          type: "checkbox",
          checked: settings.openAtLogin,
          click: (item) => {
            save({ openAtLogin: item.checked });
            Electron.app.setLoginItemSettings({ openAtLogin: item.checked });
          },
        },
        { type: "separator" },
        ...(input.extras?.menuItems() ?? []),
        ...(input.extras ? [{ type: "separator" as const }] : []),
        { label: "Open Baton", click: () => void input.ensureMainWindow().then((w) => w.show()) },
        { label: "Quit", click: () => Electron.app.quit() },
      ]),
    );
  };

  const failed = (error: unknown) => {
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
  for (const hotkey of VOICE_HOTKEYS) {
    // A chord another app already owns is skipped, not fatal; the tray still works.
    Electron.globalShortcut.register(hotkey.accelerator, () =>
      hotkey.activation === "toggle_mute" ? toggleMute() : loop?.activate(hotkey.activation),
    );
  }
  Electron.globalShortcut.register(DICTATION_TOGGLE_HOTKEY.accelerator, () => {
    if (settings.dictation !== "baton" || binary === null) return;
    // The first press is the opt-in: it fetches the model, and the next one records.
    if (parakeetPath === null) requestDictation();
    else sidecar?.toggle();
  });
  Electron.app.on("will-quit", () => {
    for (const hotkey of VOICE_HOTKEYS) Electron.globalShortcut.unregister(hotkey.accelerator);
    Electron.globalShortcut.unregister(DICTATION_TOGGLE_HOTKEY.accelerator);
    void audio?.stop();
    rewriter.dispose();
    sidecar?.dispose();
  });

  // Hand edits to the settings file take effect without a restart.
  NodeFS.watchFile(settingsPath, { interval: 2_000 }, () => {
    const before = JSON.stringify(settings);
    settings = readSettings(settingsPath);
    const after = JSON.stringify(settings);
    if (before === after) return;
    configureDictation();
    void relisten();
  });
  setInterval(onDeviceChange, MIC_POLL_MS).unref();

  render();
  // Keys and the sidecar only once the model is here: nothing global before he asks for it.
  if (binary !== null && settings.dictation === "baton" && modelPresent(modelsDir, speechModel())) {
    requestDictation();
  }
  void start().catch(failed);
  return {
    refresh: rebuildMenu,
    onSpeaking: (active) => {
      core?.setSpeaking(active);
      pill.on({ type: "speaking", active });
    },
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
