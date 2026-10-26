/* oxlint-disable t3code/no-low-value-comments -- Baton file predating upstream's rule (D82) */
// @effect-diagnostics globalDate:off globalTimers:off nodeBuiltinImport:off
/**
 * Baton voice on the desktop: the microphone, the tray, the HUD, the hotkeys
 * and where finished words go (§12.1, §12.3, Phase 5). D65.
 *
 * Capture runs in a hidden window because the OS audio stack Electron exposes
 * is Chromium's (`getUserMedia`), which is also what makes a DJI receiver
 * "just an audio device": no native module, no driver, the same on every OS.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import type { BatonFocusTarget } from "@t3tools/baton-contracts";
import type { BatonVoiceCore, VoiceIntentClient } from "@t3tools/baton-voice";
import * as Electron from "electron";

import {
  BATON_VOICE_FOCUS_CHANNEL,
  BATON_VOICE_REQUEST_CHANNEL,
  BATON_VOICE_RESPONSE_CHANNEL,
} from "../channels.ts";
import {
  choiceDeviceId,
  realDevices,
  reconcileDeviceChange,
  selectInputDevice,
  type DeviceChoice,
} from "./audioDeviceSelection.ts";
import { makeClipboardInjection } from "./clipboardInjection.ts";
import {
  desktopVoiceContext,
  makeVoiceIntentClient,
  type VoiceIntentRequest,
} from "./desktopVoiceCore.ts";
import { makeFramer, toVoicePcm } from "./pcm.ts";
import { VOICE_HOTKEYS } from "./voiceActivation.ts";
import { HUD_DOCUMENT, hudView, renderHudHtml, utteranceCaption } from "./voiceHud.ts";
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

interface VoiceSettings {
  /** Always-listening is opt-in: a microphone that opens itself is not a default. */
  readonly enabled: boolean;
  readonly openAtLogin: boolean;
  readonly pinnedLabel: string | null;
  /** Where the wake/VAD/STT models and whisper-cli are; null = `<state dir>/voice`. */
  readonly modelsDir: string | null;
  readonly whisperCli: string | null;
}

const DEFAULT_SETTINGS: VoiceSettings = {
  enabled: false,
  openAtLogin: false,
  pinnedLabel: null,
  modelsDir: null,
  whisperCli: null,
};

/** The renderer has this long to answer an intent call before the core is told it failed. */
const REQUEST_TIMEOUT_MS = 20_000;
/** Under the context bus's 30 s TTL, so what Baton has open never expires while it is open. */
const CONTEXT_REFRESH_MS = 10_000;

const readSettings = (path: string): VoiceSettings => {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(NodeFS.readFileSync(path, "utf8")) };
  } catch {
    return DEFAULT_SETTINGS;
  }
};

// Legacy name (D71): the Electron partition holds the mic grant, so it keeps "fabric".
const CAPTURE_PARTITION = "fabric-voice";

// The capture page is ours, inline, and never navigates; node integration is
// what lets it hand PCM back without a second preload bundle.
const CAPTURE_SCRIPT = `
const { ipcRenderer } = require("electron");
let stream = null, ctx = null, node = null;
window.batonVoice = {
  async list() {
    try { (await navigator.mediaDevices.getUserMedia({ audio: true })).getTracks().forEach(t => t.stop()); } catch {}
    return (await navigator.mediaDevices.enumerateDevices())
      .filter(d => d.kind === "audioinput").map(d => ({ deviceId: d.deviceId, label: d.label }));
  },
  async start(deviceId) {
    await this.stop();
    stream = await navigator.mediaDevices.getUserMedia({ audio: {
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      channelCount: 1, echoCancellation: false, noiseSuppression: true, autoGainControl: true } });
    ctx = new AudioContext();
    const source = ctx.createMediaStreamSource(stream);
    // shortcut: ScriptProcessor is deprecated; move to an AudioWorklet if Chromium drops it.
    node = ctx.createScriptProcessor(2048, 1, 1);
    node.onaudioprocess = e => ipcRenderer.send("baton-voice:pcm", ctx.sampleRate, e.inputBuffer.getChannelData(0).slice().buffer);
    source.connect(node); node.connect(ctx.destination);
  },
  async stop() {
    node?.disconnect(); stream?.getTracks().forEach(t => t.stop()); await ctx?.close();
    stream = ctx = node = null;
  },
};
navigator.mediaDevices.addEventListener("devicechange", () => ipcRenderer.send("baton-voice:devicechange"));
`;

// Created only while listening is on and destroyed when it goes off: a hidden
// window left open would stop Windows' "last window closed" quit.
const makeChromiumAudioInput = (
  onDeviceChange: () => void,
): AudioInputProvider & { readonly dispose: () => void } => {
  const voiceSession = Electron.session.fromPartition(CAPTURE_PARTITION);
  voiceSession.setPermissionRequestHandler((_wc, permission, done) => done(permission === "media"));
  voiceSession.setPermissionCheckHandler((_wc, permission) => permission === "media");
  const window = new Electron.BrowserWindow({
    show: false,
    webPreferences: {
      partition: CAPTURE_PARTITION,
      nodeIntegration: true,
      contextIsolation: false,
      backgroundThrottling: false,
    },
  });
  const ready = window.loadURL(
    `data:text/html,${encodeURIComponent(`<!doctype html><script>${CAPTURE_SCRIPT}</script>`)}`,
  );
  let onFrame: ((frame: Int16Array) => void) | null = null;
  const framer = makeFramer((frame) => onFrame?.(frame));
  const onPcm = (event: Electron.IpcMainEvent, sampleRate: number, buffer: ArrayBuffer) => {
    if (event.sender !== window.webContents) return;
    framer(toVoicePcm(new Float32Array(buffer), 1, sampleRate));
  };
  const onChange = (event: Electron.IpcMainEvent) => {
    if (event.sender === window.webContents) onDeviceChange();
  };
  Electron.ipcMain.on("baton-voice:pcm", onPcm);
  Electron.ipcMain.on("baton-voice:devicechange", onChange);
  const call = async <T>(expression: string): Promise<T> => {
    await ready;
    return window.webContents.executeJavaScript(expression) as Promise<T>;
  };
  return {
    listDevices: () => call<ReadonlyArray<AudioInputDevice>>("window.batonVoice.list()"),
    start: async (input) => {
      onFrame = input.onFrame;
      await call(`window.batonVoice.start(${JSON.stringify(input.deviceId)})`);
    },
    stop: async () => {
      onFrame = null;
      await call("window.batonVoice.stop()");
    },
    dispose: () => {
      Electron.ipcMain.removeListener("baton-voice:pcm", onPcm);
      Electron.ipcMain.removeListener("baton-voice:devicechange", onChange);
      window.destroy();
    },
  };
};

const makeHud = () => {
  const area = Electron.screen.getPrimaryDisplay().workArea;
  const width = 320;
  const height = 72;
  const window = new Electron.BrowserWindow({
    width,
    height,
    x: area.x + area.width - width - 12,
    y: area.y + area.height - height - 12,
    frame: false,
    transparent: true,
    resizable: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    webPreferences: { partition: CAPTURE_PARTITION },
  });
  window.setAlwaysOnTop(true, "screen-saver");
  window.setIgnoreMouseEvents(true);
  const ready = window.loadURL(`data:text/html,${encodeURIComponent(HUD_DOCUMENT)}`);
  return {
    show: (html: string) =>
      void ready.then(() => {
        if (window.isDestroyed()) return;
        void window.webContents.executeJavaScript(
          `document.getElementById("root").innerHTML = ${JSON.stringify(html)}`,
        );
        if (!window.isVisible()) window.showInactive();
      }),
    dispose: () => window.destroy(),
  };
};

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
  readonly settings: { readonly modelsDir: string | null; readonly whisperCli: string | null };
}

export interface DesktopBatonVoiceInput {
  readonly stateDir: string;
  /** `HostProcessPlatform`, injected rather than read here. */
  readonly platform: string;
  /** The main window, created if needed — where session and intent words go. */
  readonly ensureMainWindow: () => Promise<Electron.BrowserWindow>;
  /** The voice core (`@t3tools/baton-voice`); null leaves the tray saying so. */
  readonly makeCore: ((hooks: VoiceCoreHooks) => Promise<BatonVoiceCore>) | null;
}

export const startDesktopBatonVoice = (input: DesktopBatonVoiceInput): void => {
  // Legacy name (D71): existing settings live in this file, so it keeps "fabric".
  const settingsPath = NodePath.join(input.stateDir, "fabric-voice.json");
  let settings = readSettings(settingsPath);
  const save = (next: Partial<VoiceSettings>) => {
    settings = { ...settings, ...next };
    NodeFS.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  };

  const tray = new Electron.Tray(trayIcon(hudView("sleeping").color));
  let hud: ReturnType<typeof makeHud> | null = null;
  let audio: ReturnType<typeof makeChromiumAudioInput> | null = null;
  let core: BatonVoiceCore | null = null;
  const injection = makeClipboardInjection({
    platform: input.platform,
    clipboard: Electron.clipboard,
  });
  // Only where this desktop can paste is the focused field a dictation target.
  const field = injection.canInject(FOCUSED_FIELD) ? FOCUSED_FIELD : null;

  let state: VoiceState = "sleeping";
  let devices: ReadonlyArray<AudioInputDevice> = [];
  let choice: DeviceChoice = { kind: "default", deviceId: null, reason: "Not started." };
  let loop: VoiceLoop | null = null;
  let note: string | null = input.makeCore === null ? "Voice core not installed." : null;
  let captionTimer: ReturnType<typeof setTimeout> | null = null;
  let focusedWorkSessionId: string | null = null;
  let contextTimer: ReturnType<typeof setInterval> | null = null;

  const deviceName = () => (choice.kind === "pinned" ? choice.device.label : "System microphone");
  const render = (caption: string | null) => {
    tray.setImage(trayIcon(hudView(state).color));
    tray.setToolTip(`Baton: ${hudView(state).label} · ${deviceName()}${note ? ` · ${note}` : ""}`);
    hud?.show(renderHudHtml({ state, caption: caption ?? note, device: deviceName() }));
    rebuildMenu();
  };
  const flash = (caption: string) => {
    if (captionTimer !== null) clearTimeout(captionTimer);
    render(caption);
    captionTimer = setTimeout(() => render(null), 4000);
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
  const pushContext = () =>
    core?.setContext(desktopVoiceContext({ focusedWorkSessionId, field, observedAt: new Date() }));
  Electron.ipcMain.on(BATON_VOICE_FOCUS_CHANNEL, (event, id: unknown) => {
    // Our own windows only; preview panes load other people's pages.
    if (Electron.BrowserWindow.fromWebContents(event.sender) === null) return;
    focusedWorkSessionId = typeof id === "string" && id.length > 0 ? id : null;
    pushContext();
  });

  const onDeviceChange = () => {
    void (async () => {
      if (audio === null) return;
      devices = await audio.listDevices();
      const next = reconcileDeviceChange({ current: choice, devices, preference: settings });
      if (next !== null) {
        choice = next;
        note = next.kind === "default" ? next.reason : null;
        await loop?.switchDevice(choiceDeviceId(next));
      }
      render(null);
    })();
  };

  const start = async () => {
    if (loop !== null || input.makeCore === null || !settings.enabled) return render(null);
    // The models first: if they are missing, no microphone is opened.
    core = await input.makeCore({
      intent: makeVoiceIntentClient({ request, injection, field: FOCUSED_FIELD }),
      onReply: flash,
      settings,
    });
    pushContext();
    contextTimer = setInterval(pushContext, CONTEXT_REFRESH_MS);
    audio = makeChromiumAudioInput(onDeviceChange);
    hud = makeHud();
    devices = await audio.listDevices();
    choice = selectInputDevice(devices, settings);
    note = choice.kind === "default" && settings.pinnedLabel !== null ? choice.reason : null;
    loop = await startVoiceLoop({
      audio,
      core,
      deviceId: choiceDeviceId(choice),
      onState: (next) => {
        state = next;
        render(null);
      },
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
    audio?.dispose();
    hud?.dispose();
    audio = null;
    hud = null;
    state = "sleeping";
    render(null);
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
          click: () => loop?.activate("toggle_mute"),
        },
        { label: "Wake now", enabled: loop !== null, click: () => loop?.activate("wake") },
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
              label: "System default",
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
        { label: "Open Baton", click: () => void input.ensureMainWindow().then((w) => w.show()) },
        { label: "Quit", click: () => Electron.app.quit() },
      ]),
    );
  };

  const failed = (error: unknown) => {
    note = error instanceof Error ? error.message : "The microphone could not be opened.";
    void stop();
  };

  const restart = async () => {
    if (loop === null || audio === null) return render(null);
    devices = await audio.listDevices();
    choice = selectInputDevice(devices, settings);
    note = choice.kind === "default" && settings.pinnedLabel !== null ? choice.reason : null;
    await loop.switchDevice(choiceDeviceId(choice));
    render(null);
  };

  for (const hotkey of VOICE_HOTKEYS) {
    // A chord another app already owns is skipped, not fatal; the tray still works.
    Electron.globalShortcut.register(hotkey.accelerator, () => loop?.activate(hotkey.activation));
  }
  Electron.app.on("will-quit", () => {
    for (const hotkey of VOICE_HOTKEYS) Electron.globalShortcut.unregister(hotkey.accelerator);
  });

  render(null);
  void start().catch(failed);
};
