// @effect-diagnostics nodeBuiltinImport:off
/**
 * Everything Baton adds to the desktop main process, started by one call in `DesktopApp.ts`
 * (`vendor-patches/t3code/0007-desktop.patch`): the injection-report IPC handler and the voice
 * core (D66), and the screen companion (D84). Neither may stop the app starting: a missing tray
 * host or a refused microphone is reported in its own tray, not as a startup failure.
 */
import * as Electron from "electron";

import { rescueMainWindow } from "./mainWindowRescue.ts";
import * as NodePath from "node:path";

import { createOsTts } from "@t3tools/baton-voice";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";

import { resolveDictationBinary } from "./voice/dictationSidecar.ts";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as DesktopIpc from "../ipc/DesktopIpc.ts";
import { getBatonInjectionReport } from "../ipc/methods/baton.ts";
import * as DesktopWindow from "../window/DesktopWindow.ts";
import { startScreenCompanion, type ScreenCompanion } from "./screen/ScreenCompanion.ts";
import { startDesktopBatonVoice, type DesktopBatonVoice } from "./voice/DesktopBatonVoice.ts";
import { createEscapeKey } from "./screen/escapeKey.ts";
import { createVoicePlayer } from "./voice/voicePlayer.ts";
import { createPocketEngine } from "./voice/pocketVoice.ts";
import { createSpeaker } from "./voice/voiceSpeaker.ts";
import { createDesktopVoiceCore, resolveVoiceAssets } from "./voice/desktopVoiceCore.ts";
import { makeVoiceTurnLog } from "./voice/voiceTurnLog.ts";
import { makeRotatingLogFileWriter } from "../app/DesktopObservability.ts";

const VOICE_LOG_MAX_BYTES = 5 * 1024 * 1024;
const VOICE_LOG_MAX_FILES = 5;

export const startBatonDesktop = Effect.gen(function* () {
  const ipc = yield* DesktopIpc.DesktopIpc;
  yield* ipc.handle(getBatonInjectionReport);
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const desktopWindow = yield* DesktopWindow.DesktopWindow;
  const hostEnvironment = yield* HostProcess.Environment;
  const hostArchitecture = yield* HostProcess.Architecture;
  const context = yield* Effect.context<never>();
  const { resourcesPath } = environment;
  // Same rotation as the desktop's own traces, smaller: a line a turn is a lot of turns.
  const voiceLogFile = yield* makeRotatingLogFileWriter({
    filePath: NodePath.join(environment.logDir, "voice-turns.ndjson"),
    maxBytes: VOICE_LOG_MAX_BYTES,
    maxFiles: VOICE_LOG_MAX_FILES,
  }).pipe(Effect.option);
  yield* Effect.sync(() => {
    let voice: DesktopBatonVoice | null = null;
    const turnLog = makeVoiceTurnLog((line) => {
      if (voiceLogFile._tag === "Some") {
        Effect.runForkWith(context)(voiceLogFile.value.writeText(line));
      }
    });
    // Windows limits who may take the foreground, so this takes upstream's strong reveal.
    const openMainWindow = () =>
      void Effect.runPromiseWith(context)(
        desktopWindow.prepareCaptureReveal.pipe(
          Effect.andThen(desktopWindow.revealOrCreateMain),
          Effect.tap((window) =>
            Effect.sync(() => {
              rescueMainWindow(window, Electron.screen);
              turnLog.note("open_main", {
                visible: window.isVisible(),
                minimised: window.isMinimized(),
                bounds: window.getBounds(),
              });
            }),
          ),
        ),
      ).catch((cause: unknown) => turnLog.note("open_main_failed", { cause: String(cause) }));
    Electron.app.on("second-instance", openMainWindow);
    const holdEscape = createEscapeKey(Electron.globalShortcut);
    const pocket = createPocketEngine({
      root: NodePath.join(environment.stateDir, "voice", "pocket"),
      platform: environment.platform,
      arch: hostArchitecture,
      onProgress: (message) => voice?.onNote(message),
    });
    Electron.app.on("will-quit", pocket.dispose);
    const speaker = createSpeaker({
      os: createOsTts(environment.platform),
      voice: () => {
        const voice = screen?.voice() ?? "anna";
        return voice === "system" ? null : pocket.synthesise(voice);
      },
      player: createVoicePlayer((level) => voice?.onSpeechLevel(level)),
      silent: () => screen?.writtenOnly() ?? false,
      onActive: (active) => voice?.onSpeaking(active),
      onText: (text) => voice?.onSpoken(text),
    });
    let screen: ScreenCompanion | null = null;
    try {
      screen = startScreenCompanion({
        stateDir: environment.stateDir,
        platform: environment.platform,
        env: hostEnvironment,
        speak: speaker.speak,
        onChange: () => voice?.refresh(),
        onTurnEnd: () => voice?.onTurnEnd(),
        onTimings: turnLog.timings,
        stopSpeech: speaker.cancel,
        holdEscape,
        onActivity: (label, caption) => voice?.onActivity(label, caption),
        onDismissed: () => voice?.onDismissed(),
      });
    } catch (cause) {
      Effect.runForkWith(context)(Effect.logWarning("baton screen companion did not start", cause));
    }
    voice = startDesktopBatonVoice({
      stateDir: environment.stateDir,
      platform: environment.platform,
      env: hostEnvironment,
      ensureMainWindow: () => Effect.runPromiseWith(context)(desktopWindow.ensureMain),
      ...(screen === null ? {} : { extras: screen }),
      holdEscape,
      onBargeIn: () => {
        speaker.cancel();
        screen?.hush();
      },
      onDismiss: () => {
        speaker.cancel();
        screen?.stop();
      },
      onSpokenStop: () => {
        speaker.cancel();
        screen?.dismiss();
      },
      openMainWindow,
      dictationBinary: resolveDictationBinary({
        resourcesPath,
        platform: environment.platform,
        env: hostEnvironment,
      }),
      makeCore: async ({ intent, onReply, settings, stt, onEvent }) =>
        (
          await createDesktopVoiceCore({
            assets: resolveVoiceAssets({
              stateDir: environment.stateDir,
              resourcesPath,
              env: { BATON_VOICE_MODELS: hostEnvironment["BATON_VOICE_MODELS"] },
              modelsDir: settings.modelsDir,
            }),
            wakeWords: settings.wakeWords,
            stt,
            platform: environment.platform,
            intent,
            onReply,
            tts: speaker,
            onEvent: (event) => {
              turnLog.event(event);
              // He is about to say something: have the sessions up before he finishes.
              if (event.type === "wake") screen?.warm();
              onEvent(event);
            },
            ...(screen === null ? {} : { brain: screen }),
          })
        ).core,
    });
  }).pipe(Effect.catchDefect((cause) => Effect.logWarning("baton voice did not start", cause)));
});
