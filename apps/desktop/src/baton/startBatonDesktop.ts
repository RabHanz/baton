// @effect-diagnostics nodeBuiltinImport:off
/**
 * Everything Baton adds to the desktop main process, started by one call in `DesktopApp.ts`
 * (`vendor-patches/t3code/0007-desktop.patch`): the injection-report IPC handler and the voice
 * core (D66), and the screen companion (D84). Neither may stop the app starting: a missing tray
 * host or a refused microphone is reported in its own tray, not as a startup failure.
 */
import * as Electron from "electron";
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
import { createSpeaker, piperFilesIn, piperSynthesiser } from "./voice/voiceSpeaker.ts";
import { createDesktopVoiceCore, resolveVoiceAssets } from "./voice/desktopVoiceCore.ts";

export const startBatonDesktop = Effect.gen(function* () {
  const ipc = yield* DesktopIpc.DesktopIpc;
  yield* ipc.handle(getBatonInjectionReport);
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const desktopWindow = yield* DesktopWindow.DesktopWindow;
  const hostEnvironment = yield* HostProcess.Environment;
  const context = yield* Effect.context<never>();
  const { resourcesPath } = environment;
  yield* Effect.sync(() => {
    let voice: DesktopBatonVoice | null = null;
    const holdEscape = createEscapeKey(Electron.globalShortcut);
    const speaker = createSpeaker({
      os: createOsTts(environment.platform),
      voice: () => {
        const files = piperFilesIn(
          NodePath.join(environment.stateDir, "voice", "piper"),
          "en_GB-cori-high",
          environment.platform,
        );
        return files === null ? null : piperSynthesiser(files);
      },
      player: createVoicePlayer((level) => voice?.onSpeechLevel(level)),
      silent: () => screen?.writtenOnly() ?? false,
      onActive: (active) => voice?.onSpeaking(active),
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
      ensureMainWindow: () => Effect.runPromiseWith(context)(desktopWindow.ensureMain),
      ...(screen === null ? {} : { extras: screen }),
      holdEscape,
      onDismiss: () => {
        speaker.cancel();
        screen?.stop();
      },
      dictationBinary: resolveDictationBinary({ resourcesPath, env: hostEnvironment }),
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
            onEvent,
            ...(screen === null ? {} : { brain: screen }),
          })
        ).core,
    });
  }).pipe(Effect.catchDefect((cause) => Effect.logWarning("baton voice did not start", cause)));
});
