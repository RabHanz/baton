/**
 * Everything Baton adds to the desktop main process, started by one call in `DesktopApp.ts`
 * (`vendor-patches/t3code/0007-desktop.patch`): the injection-report IPC handler and the voice
 * core (D66), and the screen companion (D84). Neither may stop the app starting: a missing tray
 * host or a refused microphone is reported in its own tray, not as a startup failure.
 */
import { createOsTts } from "@t3tools/baton-voice";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as DesktopIpc from "../ipc/DesktopIpc.ts";
import { getBatonInjectionReport } from "../ipc/methods/baton.ts";
import * as DesktopWindow from "../window/DesktopWindow.ts";
import { startScreenCompanion, type ScreenCompanion } from "./screen/ScreenCompanion.ts";
import { startDesktopBatonVoice } from "./voice/DesktopBatonVoice.ts";
import { createDesktopVoiceCore, resolveVoiceAssets } from "./voice/desktopVoiceCore.ts";

export const startBatonDesktop = Effect.gen(function* () {
  const ipc = yield* DesktopIpc.DesktopIpc;
  yield* ipc.handle(getBatonInjectionReport);
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const desktopWindow = yield* DesktopWindow.DesktopWindow;
  const hostEnvironment = yield* HostProcess.Environment;
  const context = yield* Effect.context<never>();
  yield* Effect.sync(() => {
    let voice: { readonly refresh: () => void } | null = null;
    let screen: ScreenCompanion | null = null;
    try {
      screen = startScreenCompanion({
        stateDir: environment.stateDir,
        platform: environment.platform,
        env: hostEnvironment,
        speak: createOsTts(environment.platform).speak,
        onChange: () => voice?.refresh(),
      });
    } catch (cause) {
      Effect.runForkWith(context)(Effect.logWarning("baton screen companion did not start", cause));
    }
    voice = startDesktopBatonVoice({
      stateDir: environment.stateDir,
      platform: environment.platform,
      ensureMainWindow: () => Effect.runPromiseWith(context)(desktopWindow.ensureMain),
      ...(screen === null ? {} : { extras: screen }),
      makeCore: async ({ intent, onReply, settings }) =>
        (
          await createDesktopVoiceCore({
            assets: resolveVoiceAssets({
              stateDir: environment.stateDir,
              platform: environment.platform,
              env: {
                BATON_VOICE_MODELS: hostEnvironment["BATON_VOICE_MODELS"],
                BATON_WHISPER_CLI: hostEnvironment["BATON_WHISPER_CLI"],
              },
              modelsDir: settings.modelsDir,
              whisperCli: settings.whisperCli,
            }),
            platform: environment.platform,
            intent,
            onReply,
            ...(screen === null ? {} : { screen }),
          })
        ).core,
    });
  }).pipe(Effect.catchDefect((cause) => Effect.logWarning("baton voice did not start", cause)));
});
