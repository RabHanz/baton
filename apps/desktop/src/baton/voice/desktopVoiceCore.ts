/* oxlint-disable t3code/no-low-value-comments -- Baton file predating upstream's rule (D82) */
// @effect-diagnostics nodeBuiltinImport:off
/**
 * The real voice core (`@t3tools/baton-voice`) behind the desktop's
 * `makeCore` seam: openWakeWord → Silero VAD → whisper.cpp → the §12.3 mode
 * machine → the core's router, whose four intent calls are answered here.
 *
 * The router keeps its safety rules (high risk refused by voice, medium risk
 * needs a later spoken "confirm", dictation stays local); this module only
 * says where each call goes on a desktop.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import type { BatonFocusTarget, BatonIntentResolution } from "@t3tools/baton-contracts";
import {
  createOpenWakeWordProvider,
  createOsTts,
  createSileroVad,
  createVoiceCore,
  createVoiceRouter,
  DEFAULT_TIMINGS,
  type BatonVoiceCore,
  type SttProvider,
  type VoiceIntentClient,
  type VoiceRouter,
  type WakeWordModel,
} from "@t3tools/baton-voice";
import {
  applyContextSnapshot,
  emptyContextBus,
  type ContextBusState,
} from "@t3tools/baton-shared/contextBus";
import type { TextInjectionAdapter } from "@t3tools/baton-shared/injection";
import { parseScreenIntent, type ScreenIntent } from "@t3tools/baton-shared/screenCompanion";

const VOICE_FEATURE_FILES = ["melspectrogram.onnx", "embedding_model.onnx", "silero_vad.onnx"];

/** One wake word as the tray and `fabric-voice.json` hold it. */
export interface WakeWordSetting {
  readonly word: string;
  readonly enabled: boolean;
  readonly threshold: number;
}

export interface VoiceAssets {
  /** The bundled models; a user's own `<word>.onnx` in `userModelsDir` wins. */
  readonly modelsDir: string;
  readonly userModelsDir: string;
}

/** Settings win, then the env var the core's own tests read, then what shipped with the app. */
export const resolveVoiceAssets = (input: {
  readonly stateDir: string;
  readonly resourcesPath: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly modelsDir?: string | null;
}): VoiceAssets => {
  const userModelsDir = NodePath.join(input.stateDir, "voice", "models");
  return {
    modelsDir:
      input.modelsDir ??
      input.env["BATON_VOICE_MODELS"] ??
      NodePath.join(input.resourcesPath, "baton-voice", "models"),
    userModelsDir,
  };
};

/** Wake words the app can actually load: a word with no model is dropped, not a startup failure. */
export const resolveWakeModels = (
  assets: VoiceAssets,
  words: ReadonlyArray<WakeWordSetting>,
  exists: (path: string) => boolean = NodeFS.existsSync,
): { readonly models: ReadonlyArray<WakeWordModel>; readonly missing: ReadonlyArray<string> } => {
  const models: WakeWordModel[] = [];
  const missing: string[] = [];
  for (const { word, enabled, threshold } of words) {
    if (!enabled) continue;
    const file = `${word.toLowerCase().replace(/[^a-z0-9]+/g, "_")}.onnx`;
    const path = [assets.userModelsDir, assets.modelsDir]
      .map((dir) => NodePath.join(dir, file))
      .find(exists);
    if (path === undefined) missing.push(word);
    else models.push({ word, path, threshold });
  }
  return { models, missing };
};

export const missingVoiceAssets = (
  assets: VoiceAssets,
  exists: (path: string) => boolean = NodeFS.existsSync,
): ReadonlyArray<string> =>
  VOICE_FEATURE_FILES.map((file) => NodePath.join(assets.modelsDir, file)).filter(
    (path) => !exists(path),
  );

/** What the desktop's renderer answers: the intent bar's own two RPCs. */
export type VoiceIntentRequest =
  | {
      readonly kind: "resolve";
      readonly text: string;
      readonly focusedWorkSessionId: string | null;
      readonly allowModel: boolean;
    }
  | { readonly kind: "run"; readonly text: string; readonly focusedWorkSessionId: string | null };

/**
 * Direct-session speech as the grammar's colon form, with the session pinned
 * as the focus: the message reaches it word for word, through the same gates
 * as typing it would.
 */
export const sessionMessageSentence = (text: string): string => `Tell it: ${text.trim()}`;

export const makeVoiceIntentClient = (input: {
  readonly request: (request: VoiceIntentRequest) => Promise<unknown>;
  readonly injection: TextInjectionAdapter;
  readonly field: BatonFocusTarget;
}): VoiceIntentClient => {
  const run = (text: string, focusedWorkSessionId: string | null) =>
    input.request({ kind: "run", text, focusedWorkSessionId }) as Promise<{
      readonly resolution: BatonIntentResolution;
      readonly reply: string;
    }>;
  return {
    resolve: (request) =>
      input.request({ kind: "resolve", ...request }) as Promise<BatonIntentResolution>,
    run: ({ text, focusedWorkSessionId }) => run(text, focusedWorkSessionId),
    sendToSession: async ({ workSessionId, text }) => ({
      reply: (await run(sessionMessageSentence(text), workSessionId)).reply,
    }),
    insertText: async ({ text }) => {
      try {
        await input.injection.insertText({ target: input.field, text });
        return { inserted: true };
      } catch {
        return { inserted: false };
      }
    },
  };
};

/**
 * The context bus the router reads: what Baton has open (§14 rung 3) and,
 * where this desktop can paste, the focused field as a dictation target.
 */
export const desktopVoiceContext = (input: {
  readonly focusedWorkSessionId: string | null;
  readonly field: BatonFocusTarget | null;
  readonly observedAt: Date;
}): ContextBusState => {
  const base = {
    observedAt: input.observedAt.toISOString(),
    foregroundApplication: null,
    activeWindowTitle: null,
    activeThreadId: null,
    vscode: null,
    browser: null,
    recentVoiceTarget: null,
  };
  let bus = applyContextSnapshot(emptyContextBus, {
    ...base,
    producer: "fabric",
    activeWorkSessionId: input.focusedWorkSessionId as never,
    editableTarget: null,
  });
  if (input.field !== null) {
    bus = applyContextSnapshot(bus, {
      ...base,
      producer: "desktop",
      activeWorkSessionId: null,
      editableTarget: input.field,
    });
  }
  return bus;
};

/** The screen companion as the voice router sees it (D84). */
export interface ScreenVoiceHook {
  readonly active: () => boolean;
  readonly handle: (intent: ScreenIntent) => void;
}

/**
 * Spoken commands that ask about, or to be taught or driven on, the screen go to the screen
 * companion; everything else goes to Baton's intent path untouched. The companion answers
 * aloud itself, so the router's reply is empty.
 */
export const withScreenRoutes = (inner: VoiceRouter, screen: ScreenVoiceHook): VoiceRouter => ({
  route: async (effect, context) => {
    if (effect.kind === "command") {
      const intent = parseScreenIntent(effect.text, screen.active());
      if (intent !== null) {
        screen.handle(intent);
        return { kind: "ran", reply: "", workSessionId: null, source: "screen" };
      }
    }
    return inner.route(effect, context);
  },
});

export const createDesktopVoiceCore = async (input: {
  readonly assets: VoiceAssets;
  readonly wakeWords: ReadonlyArray<WakeWordSetting>;
  /** Parakeet in the desktop's dictation sidecar; a test can pass anything. */
  readonly stt: SttProvider;
  readonly platform: NodeJS.Platform;
  readonly intent: VoiceIntentClient;
  /** Replies and confirmation prompts, for the HUD's line. */
  readonly onReply?: (text: string) => void;
  /** Off in tests; on the desktop the OS voice reads replies back. */
  readonly speak?: boolean;
  readonly origin?: number;
  readonly screen?: ScreenVoiceHook;
}): Promise<{ readonly core: BatonVoiceCore; readonly drain: () => Promise<void> }> => {
  const missing = missingVoiceAssets(input.assets);
  if (missing.length > 0) {
    throw new Error(
      `Voice models missing: ${missing.map((p) => NodePath.basename(p)).join(", ")} (in ${input.assets.modelsDir}).`,
    );
  }
  const { models, missing: noModel } = resolveWakeModels(input.assets, input.wakeWords);
  if (models.length === 0) {
    throw new Error(
      noModel.length > 0
        ? `No wake model for ${noModel.join(", ")}.`
        : "Every wake word is switched off.",
    );
  }
  const at = (file: string) => NodePath.join(input.assets.modelsDir, file);
  const wake = await createOpenWakeWordProvider({
    melspectrogram: at("melspectrogram.onnx"),
    embedding: at("embedding_model.onnx"),
    wakes: models,
  });
  const vad = await createSileroVad(at("silero_vad.onnx"));
  const core = createVoiceCore({
    wake,
    vad,
    stt: input.stt,
    timings: { ...DEFAULT_TIMINGS, wakeWords: models.map((model) => model.word) },
    tts: input.speak === false ? null : createOsTts(input.platform),
    router:
      input.screen === undefined
        ? createVoiceRouter(input.intent)
        : withScreenRoutes(createVoiceRouter(input.intent), input.screen),
    ...(input.origin === undefined ? {} : { origin: input.origin }),
  });
  if (input.onReply !== undefined) {
    const onReply = input.onReply;
    core.subscribe((event) => {
      if (event.type !== "outcome") return;
      const outcome = event.outcome;
      if (outcome.kind === "needs_confirmation") onReply(outcome.prompt);
      else if ("reply" in outcome && outcome.reply) onReply(outcome.reply);
    });
  }
  return {
    core,
    drain: async () => {
      await wake.drain();
      await vad.drain();
    },
  };
};
