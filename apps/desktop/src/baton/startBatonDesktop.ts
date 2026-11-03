// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalTimers:off globalTimersInEffect:off preferSchemaOverJson:off
/**
 * Everything Baton adds to the desktop main process, started by one call in `DesktopApp.ts`
 * (`vendor-patches/t3code/0007-desktop.patch`): the injection-report IPC handler and the voice
 * core (D66), and the screen companion (D84). Neither may stop the app starting: a missing tray
 * host or a refused microphone is reported in its own tray, not as a startup failure.
 */
import * as Electron from "electron";

import { isCompanionWindow } from "./lastAppWindow.ts";
import { rescueMainWindow } from "./mainWindowRescue.ts";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { createOsTts } from "@t3tools/baton-voice";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import { resolveDictationBinary } from "./voice/dictationSidecar.ts";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as DesktopIpc from "../ipc/DesktopIpc.ts";
import { getBatonInjectionReport } from "../ipc/methods/baton.ts";
import * as DesktopUpdates from "../updates/DesktopUpdates.ts";
import { createConversationLog } from "./conversation/conversationLog.ts";
import {
  beginStart,
  failedStartMessage,
  isBad,
  markHealthy,
} from "@t3tools/baton-shared/startGuard";
import { releasesUrl } from "@t3tools/baton-shared/repo";
import { adoptTessayaEnv } from "@t3tools/baton-shared/tessayaEnv";
import { readGuard, writeGuard } from "./health/startGuardFile.ts";
import { createLifecycleLog } from "./lifecycle/lifecycleLog.ts";
import { createBatonUpdater } from "./update/BatonUpdater.ts";
import * as DesktopWindow from "../window/DesktopWindow.ts";
import { startScreenCompanion, type ScreenCompanion } from "./screen/ScreenCompanion.ts";
import { startDesktopBatonVoice, type DesktopBatonVoice } from "./voice/DesktopBatonVoice.ts";
import { createBridgeCatalogService } from "./sessions/catalogBridge.ts";
import { createCatalog, mockCatalogService } from "./sessions/catalogRows.ts";
import { createSessionsBridge } from "./sessions/sessionsBridge.ts";
import { createEscapeKey } from "./screen/escapeKey.ts";
import { createVoicePlayer } from "./voice/voicePlayer.ts";
import { createPocketEngine, type PocketVoice } from "./voice/pocketVoice.ts";
import { createSpeaker, type VoiceChoice } from "./voice/voiceSpeaker.ts";
import { createDesktopVoiceCore, resolveVoiceAssets } from "./voice/desktopVoiceCore.ts";
import { makeVoiceTurnLog } from "./voice/voiceTurnLog.ts";
import { makeRotatingLogFileWriter } from "../app/DesktopObservability.ts";

/** The one line a voice speaks when he plays or picks it. */
const AUDITION_LINE = "Hello, this is how I sound.";
/** Long enough for T3's own window reveal to finish first. */
const SECOND_LAUNCH_RAISE_MS = 900;
const VOICE_LOG_MAX_BYTES = 5 * 1024 * 1024;
const VOICE_LOG_MAX_FILES = 5;

export const startBatonDesktop = Effect.gen(function* () {
  adoptTessayaEnv(process.env);
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
  const updates = yield* DesktopUpdates.DesktopUpdates;
  const { latest: initialUpdateState, changes: updateChanges } = yield* updates.subscribe;
  yield* Effect.sync(() => {
    let voice: DesktopBatonVoice | null = null;
    let screen: ScreenCompanion | null = null;
    let catalogStore: ReturnType<typeof createCatalog> | null = null;
    const conversation = createConversationLog({
      file: NodePath.join(environment.stateDir, "baton-conversation.ndjson"),
    });
    const run = <A>(effect: Effect.Effect<A>) => Effect.runPromiseWith(context)(effect);
    // The release feed is this repository's (D137); the install waits for a quiet moment.
    const lifecycle = createLifecycleLog({
      file: NodePath.join(environment.logDir, "baton-lifecycle.ndjson"),
      runningFile: NodePath.join(environment.stateDir, "baton-running.json"),
      version: environment.appVersion,
    });
    // A version that fails to start twice is remembered, never installed again by itself, and he is told what worked.
    const guardPath = NodePath.join(environment.stateDir, "baton-start-guard.json");
    // Only a launch that owns the running marker counts: a second launch beside a live Tessaya must not reset the guard.
    const started = lifecycle.anotherInstance
      ? { file: readGuard(guardPath), failing: false, goBackTo: null }
      : beginStart(readGuard(guardPath), environment.appVersion, lifecycle.previousRunEndedBadly());
    let guard = started.file;
    if (!lifecycle.anotherInstance) {
      writeGuard(guardPath, guard);
      setTimeout(() => {
        guard = markHealthy(guard);
        writeGuard(guardPath, guard);
      }, 45_000).unref();
    }
    if (started.failing) {
      lifecycle.note("version-failed-twice", {
        version: environment.appVersion,
        goBackTo: started.goBackTo,
      });
      void Electron.app.whenReady().then(async () => {
        const answer = await Electron.dialog.showMessageBox({
          type: "warning",
          title: "Tessaya",
          message: failedStartMessage(environment.appVersion, started.goBackTo),
          buttons: ["Open the releases page", "Not now"],
          defaultId: 0,
          cancelId: 1,
        });
        if (answer.response === 0) void Electron.shell.openExternal(releasesUrl(process.env));
      });
    }
    Electron.app.on("render-process-gone", (_event, contents, details) =>
      lifecycle.note("render-process-gone", {
        reason: details.reason,
        exitCode: details.exitCode,
        window: contents.getTitle(),
      }),
    );
    Electron.app.on("child-process-gone", (_event, details) =>
      lifecycle.note("child-process-gone", {
        type: details.type,
        reason: details.reason,
        exitCode: details.exitCode,
        name: details.name ?? null,
      }),
    );
    Electron.app.on("before-quit", () => lifecycle.note("before-quit"));
    Electron.app.on("will-quit", () => lifecycle.note("will-quit"));
    Electron.app.on("window-all-closed", () => lifecycle.note("window-all-closed"));
    Electron.app.on("quit", (_event, exitCode) => lifecycle.note("quit", { exitCode }));
    // Minidumps of a native crash go to a known folder (no upload); a dump left since the last run is named at start.
    try {
      Electron.crashReporter.start({ uploadToServer: false, compress: true });
      const dumps = Electron.app.getPath("crashDumps");
      const seenFile = NodePath.join(environment.stateDir, "baton-dumps-seen.json");
      const seen = new Set<string>(
        (() => {
          try {
            return JSON.parse(NodeFS.readFileSync(seenFile, "utf8")) as string[];
          } catch {
            return [];
          }
        })(),
      );
      const found = (() => {
        try {
          return NodeFS.readdirSync(dumps, { recursive: true })
            .map(String)
            .filter((name) => name.endsWith(".dmp") && !seen.has(name));
        } catch {
          return [];
        }
      })();
      lifecycle.note("crash-dumps", { folder: dumps, newDumps: found });
      NodeFS.writeFileSync(seenFile, JSON.stringify([...seen, ...found]));
    } catch {
      // diagnostics only
    }
    Electron.powerMonitor.on("shutdown", () => lifecycle.note("os-shutdown"));
    Electron.powerMonitor.on("suspend", () => lifecycle.note("suspend"));
    Electron.powerMonitor.on("resume", () => lifecycle.note("resume"));
    // After an update install, tell him it worked; the marker says what ran.
    const pendingPath = NodePath.join(environment.stateDir, "baton-update-pending.json");
    const afterUpdate = (() => {
      try {
        const marker = JSON.parse(NodeFS.readFileSync(pendingPath, "utf8")) as {
          to?: string;
          at?: string;
        };
        NodeFS.rmSync(pendingPath, { force: true });
        if (marker.to === undefined) return null;
        lifecycle.note("restarted-after-update", { to: marker.to, startedAt: marker.at ?? null });
        return marker.to === environment.appVersion
          ? `Updated to ${marker.to}.`
          : `The update to ${marker.to} did not take: still on ${environment.appVersion}.`;
      } catch {
        return null;
      }
    })();
    const notify = (title: string, body: string, onClick?: () => void) => {
      if (!Electron.Notification.isSupported()) return;
      const toast = new Electron.Notification({ title, body, silent: true });
      if (onClick !== undefined) toast.on("click", onClick);
      toast.show();
    };
    // The release feed is this repository's (D137); the restart is announced, then waits for quiet.
    const batonUpdates = createBatonUpdater({
      skip: (version) => isBad(guard, version),
      initial: initialUpdateState,
      check: () => run(updates.check("baton-window")),
      download: () => run(updates.download),
      backAfter: afterUpdate,
      install: (version) => {
        lifecycle.willExitFor("update", `to ${version}`);
        try {
          NodeFS.writeFileSync(
            pendingPath,
            JSON.stringify({
              from: environment.appVersion,
              to: version,
              at: new Date().toISOString(),
            }),
          );
        } catch {
          // Without the marker the window just does not say it is back.
        }
        return run(updates.install);
      },
      busy: () => ({
        voiceBusy: voice?.busy() ?? false,
        assistantBusy: screen?.active() ?? false,
      }),
      headsUp: (version, restartAt) => {
        voice?.openHome();
        lifecycle.note("update-heads-up", {
          to: version,
          restartAt: new Date(restartAt).toISOString(),
        });
        notify(
          "Tessaya is updating",
          `Restarting in 30 seconds to install ${version}. Click to restart now, or choose Later in Tessaya.`,
          () => batonUpdates.install(),
        );
      },
      onChange: () => voice?.refresh(),
    });
    if (afterUpdate !== null) {
      setTimeout(() => {
        voice?.openHome();
        notify("Tessaya is back", afterUpdate);
      }, 3_000).unref();
    }
    Effect.runForkWith(context)(
      Stream.runForEach(updateChanges, (state) => Effect.sync(() => batonUpdates.onState(state))),
    );
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
                // "baton" here means the reveal landed on Baton's own window and T3 did not open.
                target: isCompanionWindow(window) ? "baton" : "t3",
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
    const spokenThisTurn: string[] = [];
    /** Tessaya's own voice, waited for while it loads. The OS voice only when he chose it. */
    const chooseVoice = (name: PocketVoice | "system"): VoiceChoice => {
      if (name === "system") return { kind: "system" };
      const synth = pocket.synthesise(name);
      return synth === null
        ? { kind: "wait", ready: pocket.ensure(name) }
        : { kind: "synth", synth };
    };
    const speaker = createSpeaker({
      os: createOsTts(environment.platform),
      voice: () => chooseVoice(screen?.voice() ?? "anna"),
      player: createVoicePlayer(
        (level) => voice?.onSpeechLevel(level),
        () => screen?.volume() ?? 1,
      ),
      silent: () => screen?.writtenOnly() ?? false,
      onActive: (active) => voice?.onSpeaking(active),
      onText: (text) => voice?.onSpoken(text),
      onWaiting: (waiting) => voice?.onNote(waiting ? "Loading the voice…" : null),
      onUnavailable: () =>
        voice?.onNote("The voice is not ready, so replies show as text. Voice tab: Voice."),
    });
    try {
      screen = startScreenCompanion({
        catalog: () => catalogStore?.tools,
        stateDir: environment.stateDir,
        conversation,
        onNote: turnLog.note,
        platform: environment.platform,
        env: hostEnvironment,
        speak: (text) => {
          spokenThisTurn.push(text);
          return speaker.speak(text);
        },
        onChange: () => voice?.refresh(),
        onTurnEnd: () => voice?.onTurnEnd(),
        onTimings: (timings) => {
          turnLog.timings({ ...timings, reply: spokenThisTurn.join(" ") });
          spokenThisTurn.length = 0;
        },
        onAction: (entry) => turnLog.note("action", entry),
        stopSpeech: speaker.cancel,
        holdEscape,
        onActivity: (label, caption) => voice?.onActivity(label, caption),
        onCue: (name) => voice?.cue(name),
        onDismissed: () => voice?.onDismissed(),
        onOpenTab: () => voice?.openHome(),
      });
    } catch (cause) {
      Effect.runForkWith(context)(Effect.logWarning("baton screen companion did not start", cause));
    }
    const sessions = createSessionsBridge({
      ensureMainWindow: () => Effect.runPromiseWith(context)(desktopWindow.ensureMain),
      openMainWindow,
      onChange: () => voice?.refresh(),
    });
    // A second launch means "show me Tessaya". T3's own handler raises its main window first and slowly, so
    // Tessaya's window is raised after it, or the T3 window ends up on top.
    Electron.app.on("second-instance", () => {
      setTimeout(() => voice?.openHome(), SECOND_LAUNCH_RAISE_MS).unref();
    });
    // Every session on every connected environment, through the T3 sidebar; BATON_MOCK_CATALOG shows sample rows instead.
    const catalog = (catalogStore = createCatalog({
      service:
        (hostEnvironment["BATON_MOCK_CATALOG"] ?? "") === ""
          ? createBridgeCatalogService({
              bridge: sessions,
              openMainWindow,
              saveCleanupList: (json) =>
                NodeFS.writeFileSync(
                  NodePath.join(environment.stateDir, `baton-cleanup-${Date.now()}.json`),
                  json,
                ),
            })
          : mockCatalogService(),
      onChange: () => voice?.refresh(),
    }));
    setTimeout(() => void catalog.refresh(), 8_000).unref();
    setInterval(() => void catalog.refresh(), 45_000).unref();
    voice = startDesktopBatonVoice({
      loginEntry: environment.appUserModelId,
      stateDir: environment.stateDir,
      conversation,
      onNote: turnLog.note,
      logDir: environment.logDir,
      appVersion: environment.appVersion,
      platform: environment.platform,
      env: hostEnvironment,
      ensureMainWindow: () => Effect.runPromiseWith(context)(desktopWindow.ensureMain),
      ...(screen === null ? {} : { extras: screen }),
      sessions,
      catalog,
      updates: batonUpdates,
      holdEscape,
      onPillState: (phase) =>
        turnLog.note(phase === "idle" ? "pill_hidden" : "pill_state", { phase }),
      onPillDrag: (outcome) => turnLog.note("pill_drag", outcome),
      onTestAudio: (event) => turnLog.note("test-audio", event),
      onBargeIn: () => {
        speaker.cancel();
        screen?.hush();
      },
      onDismiss: () => {
        speaker.cancel();
        screen?.dismissQuietly();
      },
      audition: (name) => {
        const picked = (name ?? screen?.voice() ?? "anna") as PocketVoice | "system";
        if (picked === "system") {
          voice?.onNote("System voice has no sample. Pick one of Tessaya's voices to hear it.");
          return;
        }
        void speaker.sample(chooseVoice(picked), AUDITION_LINE);
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
      voiceAssets: (modelsDir) =>
        resolveVoiceAssets({
          stateDir: environment.stateDir,
          resourcesPath,
          env: { BATON_VOICE_MODELS: hostEnvironment["BATON_VOICE_MODELS"] },
          modelsDir,
        }),
      makeCore: async ({
        intent,
        onReply,
        settings,
        stt,
        onEvent,
        vocabulary,
        waitMs,
        listening,
        verifyWake,
      }) =>
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
            vocabulary,
            waitMs,
            listening,
            verifyWake,
            ...(screen === null ? {} : { brain: screen }),
          })
        ).core,
    });
  }).pipe(Effect.catchDefect((cause) => Effect.logWarning("baton voice did not start", cause)));
});
