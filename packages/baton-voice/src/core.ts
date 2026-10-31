/* oxlint-disable t3code/no-low-value-comments -- Baton file predating upstream's rule (D82) */
// @effect-diagnostics globalDate:off - audio time is anchored to the wall clock once, at creation.
/**
 * §12.2's pipeline: frames → wake → VAD segmentation → STT → mode machine →
 * router → acknowledgement. Implements the desktop's `VoiceCore` seam and adds
 * what the local API needs (snapshot, event stream, direct-session toggle).
 *
 * Time is audio time (samples pushed ÷ 16) from a wall-clock origin: frames
 * arrive in real time on a live microphone, and a test that feeds a WAV gets
 * the same timeline every run.
 *
 * @module baton-voice/core
 */
import type { ContextBusState } from "@t3tools/baton-shared/contextBus";
import { emptyContextBus } from "@t3tools/baton-shared/contextBus";

import {
  DEFAULT_TIMINGS,
  initialVoiceState,
  reduceVoice,
  type VoiceEffect,
  type VoiceEvent,
  type VoiceMachineState,
  type VoiceTimings,
} from "./modeMachine.ts";
import type { RouteOutcome, VoiceRouter } from "./router.ts";
import {
  VOICE_SAMPLE_RATE,
  type SttProvider,
  type TtsProvider,
  type VadProvider,
  type VoiceActivation,
  type VoiceCore,
  type VoiceState,
  type VoiceUtterance,
  type WakeProvider,
} from "./types.ts";

export interface SegmenterConfig {
  /** Silence that ends an utterance. */
  readonly endSilenceMs: number;
  /** Shorter speech is a cough, not a sentence. */
  readonly minSpeechMs: number;
  readonly maxUtteranceMs: number;
  /** Audio kept from before speech onset so the first syllable survives. */
  readonly preRollMs: number;
}

export const DEFAULT_SEGMENTER: SegmenterConfig = {
  endSilenceMs: 800,
  minSpeechMs: 250,
  maxUtteranceMs: 15_000,
  preRollMs: 300,
};

export type VoiceCoreEvent =
  | { readonly type: "state"; readonly state: VoiceState; readonly target: string | null }
  | {
      readonly type: "wake";
      readonly score: number;
      readonly at: number;
      /** Null for a hotkey, or a provider with one word. */
      readonly word: string | null;
    }
  /** A segment went to speech recognition. */
  /** A wake word over Baton's own voice: he is cutting in. */
  | { readonly type: "barge_in" }
  | { readonly type: "thinking" }
  /** Speech recognition came back with nothing usable. */
  | { readonly type: "nothing" }
  | { readonly type: "transcript"; readonly text: string; readonly at: number }
  | { readonly type: "effect"; readonly effect: VoiceEffect }
  | { readonly type: "outcome"; readonly outcome: RouteOutcome }
  | { readonly type: "error"; readonly message: string };

export interface VoiceCoreSnapshot {
  readonly state: VoiceState;
  readonly machine: VoiceMachineState;
  readonly lastTranscript: string | null;
  readonly currentTarget: string | null;
}

export interface BatonVoiceCore extends VoiceCore {
  readonly snapshot: () => VoiceCoreSnapshot;
  readonly subscribe: (listener: (event: VoiceCoreEvent) => void) => () => void;
  readonly setDirectSession: (enabled: boolean) => void;
  /**
   * Baton's voice started or stopped, wherever it came from. While it plays, and for a moment
   * after, the mic hears Baton: only a wake word gets through.
   */
  readonly setSpeaking: (active: boolean) => void;
  readonly setContext: (bus: ContextBusState) => void;
  /** Feed a typed/known utterance as if transcribed (tests, push-to-talk text). */
  readonly hear: (text: string) => Promise<void>;
  /** Resolves when every queued transcription and route has finished. */
  readonly idle: () => Promise<void>;
}

/** Speech ends a little after the player says so, and a room rings on. */
const ECHO_TAIL_MS = 500;

const NOISE = /^(?:\[[^\]]*\]|\([^)]*\)|\s|[.,!?…-])*$/;

export const createVoiceCore = (input: {
  readonly wake: WakeProvider;
  readonly vad: VadProvider;
  readonly stt: SttProvider;
  readonly tts?: TtsProvider | null;
  /** Absent: the core only emits utterances and the host routes them. */
  readonly router?: VoiceRouter | null;
  readonly timings?: VoiceTimings;
  readonly segmenter?: SegmenterConfig;
  readonly directSession?: boolean;
  readonly origin?: number;
}): BatonVoiceCore => {
  const timings = input.timings ?? DEFAULT_TIMINGS;
  const seg = input.segmenter ?? DEFAULT_SEGMENTER;
  const origin = input.origin ?? Date.now();
  let samples = 0;
  const now = () => origin + (samples * 1000) / VOICE_SAMPLE_RATE;

  let machine = initialVoiceState(input.directSession ?? false);
  let bus: ContextBusState = emptyContextBus;
  let lastTranscript: string | null = null;
  let lastTarget: string | null = null;
  let disposed = false;

  const stateListeners = new Set<(state: VoiceState) => void>();
  const utteranceListeners = new Set<(u: VoiceUtterance) => void>();
  const listeners = new Set<(event: VoiceCoreEvent) => void>();
  const emit = (event: VoiceCoreEvent) => listeners.forEach((l) => l(event));

  // Segmentation state.
  const msToSamples = (ms: number) => Math.round((ms * VOICE_SAMPLE_RATE) / 1000);
  const preRoll: Int16Array[] = [];
  let preRollSamples = 0;
  let segment: Int16Array[] | null = null;
  let speechSamples = 0;
  let silenceSamples = 0;
  let segmentSamples = 0;
  let work: Promise<void> = Promise.resolve();

  const publicState = (): VoiceState => {
    if (machine.mode !== "sleeping") return machine.mode;
    return segment !== null ? "listening" : "sleeping";
  };
  let shown: VoiceState | null = null;
  let shownTarget: string | null = null;
  const show = () => {
    const state = publicState();
    const target = machine.conversationTarget;
    if (state === shown && target === shownTarget) return;
    shown = state;
    shownTarget = target;
    stateListeners.forEach((l) => l(state));
    emit({ type: "state", state, target });
  };

  const modeOf = (
    effect: VoiceEffect,
    before: VoiceMachineState,
  ): VoiceUtterance["mode"] | null => {
    if (effect.kind === "dictate") return "dictation";
    if (effect.kind === "session_message") return "direct_session";
    if (effect.kind === "command")
      return before.mode === "conversation" ? "conversation" : "command_window";
    return null;
  };

  const handle = async (effects: ReadonlyArray<VoiceEffect>, before: VoiceMachineState) => {
    for (const effect of effects) {
      emit({ type: "effect", effect });
      const mode = modeOf(effect, before);
      if (mode !== null && "text" in effect)
        utteranceListeners.forEach((l) => l({ text: effect.text, mode }));
      if (effect.kind === "speak") await say(effect.text);
      if (input.router == null) continue;
      const outcome = await input.router.route(effect, {
        bus,
        now: now(),
        mostRecentWorkSessionId: lastTarget,
      });
      if (outcome.kind === "none") continue;
      emit({ type: "outcome", outcome });
      if (outcome.kind === "needs_confirmation") {
        await dispatch({
          type: "request_confirmation",
          token: outcome.token,
          prompt: outcome.prompt,
          at: now(),
        });
        continue;
      }
      const target =
        outcome.kind === "ran"
          ? outcome.workSessionId
          : outcome.kind === "sent_to_session"
            ? outcome.workSessionId
            : null;
      if (target !== null) {
        lastTarget = target;
        // Follow-ups inherit what this command touched (§12.3 conversation mode).
        await dispatch({ type: "set_target", workSessionId: target, at: now() });
      }
      if ("reply" in outcome && outcome.reply) await say(outcome.reply);
    }
  };

  const say = async (text: string) => {
    if (input.tts == null) return;
    setSpeaking(true);
    try {
      await input.tts.speak(text);
    } catch (error) {
      emit({ type: "error", message: `TTS: ${(error as Error).message}` });
    } finally {
      setSpeaking(false);
    }
  };

  const dispatch = async (event: VoiceEvent) => {
    const before = machine;
    const result = reduceVoice(machine, event, timings);
    machine = result.state;
    show();
    if (result.effects.length > 0) await handle(result.effects, before);
  };

  const enqueue = (job: () => Promise<void>) => {
    work = work
      .then(job)
      .catch((error: unknown) => emit({ type: "error", message: (error as Error).message }));
  };

  const hear = (text: string) => {
    enqueue(async () => {
      const cleaned = text.trim();
      if (NOISE.test(cleaned)) return;
      lastTranscript = cleaned;
      emit({ type: "transcript", text: cleaned, at: now() });
      await dispatch({ type: "utterance", text: cleaned, at: now() });
    });
    return work;
  };

  const finishSegment = () => {
    const parts = segment;
    const spoken = speechSamples;
    const overItself = barged;
    barged = false;
    segment = null;
    speechSamples = 0;
    silenceSamples = 0;
    segmentSamples = 0;
    input.vad.reset();
    if (parts === null || spoken < msToSamples(seg.minSpeechMs)) return show();
    const pcm = new Int16Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) {
      pcm.set(p, o);
      o += p.length;
    }
    emit({ type: "thinking" });
    enqueue(async () => {
      const text = await input.stt.transcribe(pcm);
      const cleaned = text.trim();
      if (NOISE.test(cleaned)) return emit({ type: "nothing" });
      // Baton's own reply can say a wake word and "confirm": a yes must not start over its voice.
      if (overItself && machine.pending !== null) return emit({ type: "nothing" });
      lastTranscript = cleaned;
      emit({ type: "transcript", text: cleaned, at: now() });
      await dispatch({ type: "utterance", text: cleaned, at: now() });
    });
    show();
  };

  let speaking = false;
  let echoUntil = 0;
  /** A wake word cut in, and what he says next is being heard. Nothing may drop it. */
  let barged = false;
  const setSpeaking = (active: boolean) => {
    if (barged) return;
    speaking = active;
    if (active) {
      // What was being heard is now mixed with Baton's own voice.
      segment = null;
      speechSamples = 0;
      silenceSamples = 0;
      segmentSamples = 0;
    } else echoUntil = samples + msToSamples(ECHO_TAIL_MS);
  };
  const hearingItself = () => speaking || samples < echoUntil;

  /** Should speech be segmented right now? Only when something will listen. */
  const listening = () => machine.mode !== "sleeping" || segment !== null;

  const pushAudio = (frame: Int16Array) => {
    if (disposed) return;
    samples += frame.length;

    const score = input.wake.process(frame);
    if (score !== null) {
      if (hearingItself()) {
        speaking = false;
        echoUntil = 0;
        barged = true;
        emit({ type: "barge_in" });
      }
      emit({ type: "wake", score, at: now(), word: input.wake.lastWord?.() ?? null });
      // Start the utterance at the wake: "hey jarvis, what's…" is one breath.
      if (segment === null) {
        segment = [...preRoll];
        segmentSamples = preRollSamples;
        speechSamples = msToSamples(seg.minSpeechMs);
      }
      silenceSamples = 0;
      enqueue(() => dispatch({ type: "wake", at: now() }));
    } else if (machine.deadline !== null || machine.pending !== null) {
      const at = now();
      enqueue(() => dispatch({ type: "tick", at }));
    }

    if (listening() && !hearingItself()) {
      const speech = input.vad.isSpeech(frame);
      if (segment === null && speech) {
        segment = [...preRoll];
        segmentSamples = preRollSamples;
      }
      if (segment !== null) {
        segment.push(frame);
        segmentSamples += frame.length;
        if (speech) {
          speechSamples += frame.length;
          silenceSamples = 0;
        } else {
          silenceSamples += frame.length;
        }
        if (
          silenceSamples >= msToSamples(seg.endSilenceMs) ||
          segmentSamples >= msToSamples(seg.maxUtteranceMs)
        ) {
          finishSegment();
        }
      }
    }

    preRoll.push(frame);
    preRollSamples += frame.length;
    while (preRollSamples - (preRoll[0]?.length ?? 0) >= msToSamples(seg.preRollMs)) {
      preRollSamples -= preRoll.shift()!.length;
    }
    show();
  };

  const activate = (activation: VoiceActivation) => {
    if (activation === "wake") {
      emit({ type: "wake", score: 1, at: now(), word: null });
      enqueue(() => dispatch({ type: "wake", at: now() }));
    } else if (activation === "dismiss") enqueue(() => dispatch({ type: "dismiss", at: now() }));
    else if (activation === "toggle_direct_session") {
      enqueue(() =>
        dispatch({ type: "set_direct_session", enabled: !machine.directSession, at: now() }),
      );
    }
    // toggle_mute is the desktop's: it stops frames before they reach here.
  };

  show();
  return {
    pushAudio,
    activate,
    onState: (l) => {
      stateListeners.add(l);
      return () => stateListeners.delete(l);
    },
    onUtterance: (l) => {
      utteranceListeners.add(l);
      return () => utteranceListeners.delete(l);
    },
    dispose: () => {
      disposed = true;
      stateListeners.clear();
      utteranceListeners.clear();
      listeners.clear();
    },
    snapshot: () => ({
      state: publicState(),
      machine,
      lastTranscript,
      currentTarget: machine.conversationTarget ?? lastTarget,
    }),
    setSpeaking,
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    setDirectSession: (enabled) =>
      enqueue(() => dispatch({ type: "set_direct_session", enabled, at: now() })),
    setContext: (next) => {
      bus = next;
    },
    hear,
    idle: () => work,
  };
};
