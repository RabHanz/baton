/**
 * Everything Baton adds to the desktop main process, started by one call in `DesktopApp.ts`
 * (`vendor-patches/t3code/0007-desktop.patch`): the injection-report IPC handler and the voice
 * core (D66). Voice must never stop the app starting: a missing tray host or a refused
 * microphone is reported in its own tray, not as a startup failure.
 */
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as DesktopIpc from "../ipc/DesktopIpc.ts";
import { getBatonInjectionReport } from "../ipc/methods/baton.ts";
import * as DesktopWindow from "../window/DesktopWindow.ts";
import { startDesktopBatonVoice } from "./voice/DesktopBatonVoice.ts";
import { createDesktopVoiceCore, resolveVoiceAssets } from "./voice/desktopVoiceCore.ts";

export const startBatonDesktop = Effect.gen(function* () {
  const ipc = yield* DesktopIpc.DesktopIpc;
  yield* ipc.handle(getBatonInjectionReport);
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const desktopWindow = yield* DesktopWindow.DesktopWindow;
  const hostEnvironment = yield* HostProcess.Environment;
  const context = yield* Effect.context<never>();
  yield* Effect.sync(() =>
    startDesktopBatonVoice({
      stateDir: environment.stateDir,
      platform: environment.platform,
      ensureMainWindow: () => Effect.runPromiseWith(context)(desktopWindow.ensureMain),
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
          })
        ).core,
    }),
  ).pipe(Effect.catchDefect((cause) => Effect.logWarning("baton voice did not start", cause)));
});
