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
  echoesSpeech,
  isAffirmative,
  isFiller,
  isStopPhrase,
  stripWake,
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
  /** His speech ended (silence long enough): from here the pill must not say Listening. */
  | { readonly type: "speech_end"; readonly at: number }
  /** The audio of a segment that is going to recognition, for the history's kept clips. */
  | { readonly type: "audio"; readonly pcm: Int16Array; readonly at: number }
  /** A segment went to speech recognition. */
  /** A wake word over Baton's own voice: he is cutting in. */
  | { readonly type: "barge_in" }
  | { readonly type: "thinking" }
  /** Speech recognition came back with nothing usable. */
  | { readonly type: "nothing" }
  /** Heard and set aside: silence after a wake, a lone filler, its own voice over the speakers. */
  | { readonly type: "dropped"; readonly text: string; readonly reason: string }
  /** He said a stop phrase over Baton's voice. No wake word needed. */
  | { readonly type: "stop_heard"; readonly text: string; readonly at: number }
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

export interface SpokenQuestion {
  readonly answer: Promise<"yes" | "no" | "expired">;
  /** Answered some other way. */
  readonly cancel: () => void;
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
  /** A sentence Baton is saying, so a stop phrase in it is not taken for his. */
  readonly noteSpoken: (text: string) => void;
  readonly setContext: (bus: ContextBusState) => void;
  /**
   * A yes or no asked aloud, on the same rules as any confirmation: a later utterance, never the
   * wake word, and never Baton's own voice. Runs out to "expired".
   */
  readonly confirm: (prompt: string) => SpokenQuestion;
  /** Feed a typed/known utterance as if transcribed (tests, push-to-talk text). */
  readonly hear: (text: string) => Promise<void>;
  /** Resolves when every queued transcription and route has finished. */
  readonly idle: () => Promise<void>;
}

/** Speech ends a little after the player says so, and a room rings on. */
const ECHO_TAIL_MS = 500;
/** The wake word's own tail reads as speech: it opens no turn by itself. */
const WAKE_TAIL_MS = 200;
const STOP_MIN_SPEECH_MS = 120;
const STOP_END_SILENCE_MS = 350;
/** Over the speakers his voice never falls silent to the VAD, so a window this long is cut. */
const STOP_MAX_MS = 2_000;
/** Generation reads ahead of playback, so this covers what is playing now. */
const SPOKEN_KEPT = 12;

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

  const asked = new Map<string, (answer: "yes" | "no" | "expired") => void>();
  let questions = 0;
  const confirm = (prompt: string): SpokenQuestion => {
    questions += 1;
    const token = `spoken-${questions}`;
    const answer = new Promise<"yes" | "no" | "expired">((resolve) => asked.set(token, resolve));
    enqueue(() => dispatch({ type: "request_confirmation", token, prompt, at: now() }));
    return {
      answer,
      cancel: () => {
        asked.delete(token);
        enqueue(() => dispatch({ type: "clear_pending", token, at: now() }));
      },
    };
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
      if (effect.kind === "confirmed" || effect.kind === "cancelled") {
        const answer = asked.get(effect.token);
        if (answer !== undefined) {
          asked.delete(effect.token);
          answer(
            effect.kind === "confirmed" ? "yes" : effect.reason === "declined" ? "no" : "expired",
          );
          continue;
        }
      }
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
    if (speakingLater !== null) {
      const latest = speakingLater;
      speakingLater = null;
      setSpeaking(latest);
    }
    segment = null;
    speechSamples = 0;
    silenceSamples = 0;
    segmentSamples = 0;
    input.vad.reset();
    if (parts === null || spoken < msToSamples(seg.minSpeechMs)) {
      if (parts !== null) emit({ type: "dropped", text: "", reason: "no speech" });
      return show();
    }
    const pcm = joined(parts);
    emit({ type: "speech_end", at: now() });
    emit({ type: "audio", pcm, at: now() });
    emit({ type: "thinking" });
    enqueue(async () => {
      const text = await input.stt.transcribe(pcm);
      const cleaned = text.trim();
      const dictating = machine.mode === "dictation";
      if (NOISE.test(cleaned)) return dictating ? undefined : emit({ type: "nothing" });
      if (
        !dictating &&
        machine.pending === null &&
        isFiller(stripWake(cleaned, timings.wakeWords))
      ) {
        return emit({ type: "dropped", text: cleaned, reason: "filler" });
      }
      // Baton's own reply can say a wake word and "confirm": a yes must not start over its voice.
      // Stop and cancel still count, and the question just runs out.
      if (
        overItself &&
        machine.pending !== null &&
        isAffirmative(stripWake(cleaned, timings.wakeWords))
      ) {
        return emit({ type: "nothing" });
      }
      lastTranscript = cleaned;
      emit({ type: "transcript", text: cleaned, at: now() });
      await dispatch({ type: "utterance", text: cleaned, at: now() });
    });
    show();
  };

  const joined = (parts: ReadonlyArray<Int16Array>) => {
    const pcm = new Int16Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) {
      pcm.set(p, o);
      o += p.length;
    }
    return pcm;
  };

  // A separate path from `work`: that queue waits on routing and on speech, which is what he
  // is trying to stop. One transcription at a time; a window that arrives during one is skipped.
  const spokenLately: string[] = [];
  const noteSpoken = (text: string) => {
    spokenLately.push(text);
    spokenLately.splice(0, Math.max(0, spokenLately.length - SPOKEN_KEPT));
  };
  let stopFrames: Int16Array[] = [];
  let stopSamples = 0;
  let stopSpeech = 0;
  let stopQuiet = 0;
  let stopBusy = false;
  const clearStop = () => {
    stopFrames = [];
    stopSamples = 0;
    stopSpeech = 0;
    stopQuiet = 0;
  };
  const finishStop = () => {
    const parts = stopFrames;
    const spoken = stopSpeech;
    clearStop();
    if (stopBusy || spoken < msToSamples(STOP_MIN_SPEECH_MS)) return;
    stopBusy = true;
    void input.stt
      .transcribe(joined(parts))
      .then((text) => {
        const said = stripWake(text.trim(), timings.wakeWords);
        if (!isStopPhrase(said)) return;
        if (echoesSpeech(said, spokenLately)) {
          return emit({ type: "dropped", text: said, reason: "own voice" });
        }
        emit({ type: "stop_heard", text: said, at: now() });
      })
      .catch(() => undefined)
      .finally(() => {
        stopBusy = false;
      });
  };
  const watchForStop = (frame: Int16Array) => {
    const speech = input.vad.isSpeech(frame);
    if (stopFrames.length === 0) {
      if (!speech) return;
      stopFrames = [...preRoll];
      stopSamples = preRollSamples;
    }
    stopFrames.push(frame);
    stopSamples += frame.length;
    if (speech) {
      stopSpeech += frame.length;
      stopQuiet = 0;
    } else stopQuiet += frame.length;
    if (stopQuiet >= msToSamples(STOP_END_SILENCE_MS) || stopSamples >= msToSamples(STOP_MAX_MS)) {
      finishStop();
    }
  };

  let speaking = false;
  let echoUntil = 0;
  /** Speech before this sample is the wake word's tail. */
  let creditFrom = 0;
  /** A wake word cut in, and what he says next is being heard. Nothing may drop it. */
  let barged = false;
  /** What the speaker did while his words were being heard, applied when they end. */
  let speakingLater: boolean | null = null;
  const setSpeaking = (active: boolean) => {
    if (barged) {
      speakingLater = active;
      return;
    }
    speaking = active;
    if (active) {
      // What was being heard is now mixed with Baton's own voice.
      segment = null;
      speechSamples = 0;
      silenceSamples = 0;
      segmentSamples = 0;
    } else echoUntil = samples + msToSamples(ECHO_TAIL_MS);
    enqueue(() => dispatch({ type: "keep_open", at: now() }));
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
        clearStop();
        emit({ type: "barge_in" });
      }
      emit({ type: "wake", score, at: now(), word: input.wake.lastWord?.() ?? null });
      // Start the utterance at the wake: "hey jarvis, what's…" is one breath.
      if (segment === null) {
        // Kept over its own voice too: the detector fires late, and dropping this cost his first
        // words ("what needs me" came out "hate me"). The audio only: speech must still be heard
        // after the wake, or silence goes to recognition, which invents words from it.
        segment = [...preRoll];
        segmentSamples = preRollSamples;
        speechSamples = 0;
      }
      creditFrom = samples + msToSamples(WAKE_TAIL_MS);
      silenceSamples = 0;
      enqueue(() => dispatch({ type: "wake", at: now() }));
    } else if (machine.deadline !== null || machine.pending !== null) {
      const at = now();
      enqueue(() => dispatch({ type: speaking ? "keep_open" : "tick", at }));
    }

    if (hearingItself()) watchForStop(frame);
    else if (stopFrames.length > 0) clearStop();

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
          if (samples >= creditFrom) speechSamples += frame.length;
          silenceSamples = 0;
        } else {
          silenceSamples += frame.length;
        }
        if (
          silenceSamples >=
            msToSamples(machine.mode === "dictation" ? seg.endSilenceMs : seg.endSilenceMs * 0.7) ||
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
    noteSpoken,
    confirm,
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
