/**
 * The real voice core (`@t3tools/fabric-voice`) behind the desktop's
 * `makeCore` seam: openWakeWord → Silero VAD → whisper.cpp → the §12.3 mode
 * machine → the core's router, whose four intent calls are answered here.
 *
 * The router keeps its safety rules (high risk refused by voice, medium risk
 * needs a later spoken "confirm", dictation stays local); this module only
 * says where each call goes on a desktop.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import type { FabricFocusTarget, FabricIntentResolution } from "@t3tools/contracts";
import {
  createOpenWakeWordProvider,
  createOsTts,
  createSileroVad,
  createVoiceCore,
  createVoiceRouter,
  createWhisperCppStt,
  type FabricVoiceCore,
  type VoiceIntentClient,
} from "@t3tools/fabric-voice";
import {
  applyContextSnapshot,
  emptyContextBus,
  type ContextBusState,
} from "@t3tools/shared/fabricContextBus";
import type { TextInjectionAdapter } from "@t3tools/shared/fabricInjection";

export const VOICE_MODEL_FILES = [
  "melspectrogram.onnx",
  "embedding_model.onnx",
  "hey_jarvis_v0.1.onnx",
  "silero_vad.onnx",
  "ggml-base.en.bin",
] as const;

export interface VoiceAssets {
  readonly modelsDir: string;
  readonly whisperCli: string;
}

/** Settings win, then the same env vars the core's own tests read, then the state dir. */
export const resolveVoiceAssets = (input: {
  readonly stateDir: string;
  readonly platform: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly modelsDir?: string | null;
  readonly whisperCli?: string | null;
}): VoiceAssets => {
  const voiceDir = NodePath.join(input.stateDir, "voice");
  return {
    modelsDir:
      input.modelsDir ?? input.env["FABRIC_VOICE_MODELS"] ?? NodePath.join(voiceDir, "models"),
    whisperCli:
      input.whisperCli ??
      input.env["FABRIC_WHISPER_CLI"] ??
      NodePath.join(voiceDir, input.platform === "win32" ? "whisper-cli.exe" : "whisper-cli"),
  };
};

export const missingVoiceAssets = (
  assets: VoiceAssets,
  exists: (path: string) => boolean = NodeFS.existsSync,
): ReadonlyArray<string> => [
  ...VOICE_MODEL_FILES.map((file) => NodePath.join(assets.modelsDir, file)).filter(
    (p) => !exists(p),
  ),
  ...(exists(assets.whisperCli) ? [] : [assets.whisperCli]),
];

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
  readonly field: FabricFocusTarget;
}): VoiceIntentClient => {
  const run = (text: string, focusedWorkSessionId: string | null) =>
    input.request({ kind: "run", text, focusedWorkSessionId }) as Promise<{
      readonly resolution: FabricIntentResolution;
      readonly reply: string;
    }>;
  return {
    resolve: (request) =>
      input.request({ kind: "resolve", ...request }) as Promise<FabricIntentResolution>,
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
 * The context bus the router reads: what Fabric has open (§14 rung 3) and,
 * where this desktop can paste, the focused field as a dictation target.
 */
export const desktopVoiceContext = (input: {
  readonly focusedWorkSessionId: string | null;
  readonly field: FabricFocusTarget | null;
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

export const createDesktopVoiceCore = async (input: {
  readonly assets: VoiceAssets;
  readonly platform: NodeJS.Platform;
  readonly intent: VoiceIntentClient;
  /** Replies and confirmation prompts, for the HUD's line. */
  readonly onReply?: (text: string) => void;
  /** Off in tests; on the desktop the OS voice reads replies back. */
  readonly speak?: boolean;
  readonly origin?: number;
}): Promise<{ readonly core: FabricVoiceCore; readonly drain: () => Promise<void> }> => {
  const missing = missingVoiceAssets(input.assets);
  if (missing.length > 0) {
    throw new Error(
      `Voice models missing: ${missing.map((p) => NodePath.basename(p)).join(", ")} (in ${input.assets.modelsDir}).`,
    );
  }
  const at = (file: string) => NodePath.join(input.assets.modelsDir, file);
  const wake = await createOpenWakeWordProvider({
    melspectrogram: at("melspectrogram.onnx"),
    embedding: at("embedding_model.onnx"),
    wake: at("hey_jarvis_v0.1.onnx"),
  });
  const vad = await createSileroVad(at("silero_vad.onnx"));
  const core = createVoiceCore({
    wake,
    vad,
    stt: createWhisperCppStt({
      binary: input.assets.whisperCli,
      model: at("ggml-base.en.bin"),
      vocabulary: () => ["Fabric", "Claude", "Codex", "VentureOS"],
    }),
    tts: input.speak === false ? null : createOsTts(input.platform),
    router: createVoiceRouter(input.intent),
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
