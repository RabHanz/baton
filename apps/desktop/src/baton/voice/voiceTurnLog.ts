// @effect-diagnostics globalDate:off
/**
 * The durable record of what Baton heard and did, one ndjson line each (D120). It stays on his own
 * machine. Dictated words are not written here: they are often someone else's business, so a
 * dictation records its length only.
 */
import type { VoiceCoreEvent } from "@t3tools/baton-voice";

export interface VoiceTurnTimings {
  readonly route: string;
  readonly source: string;
  readonly decideMs: number;
  readonly firstSentenceMs: number | null;
  readonly totalMs: number;
  /** What Baton said for this turn, for the record and the History. */
  readonly reply?: string;
}

export interface VoiceTurnLog {
  readonly event: (event: VoiceCoreEvent) => void;
  readonly timings: (timings: VoiceTurnTimings) => void;
  /** Anything else worth the record: an action taken, a window opened. */
  readonly note: (kind: string, fields: Readonly<Record<string, unknown>>) => void;
}

export const makeVoiceTurnLog = (
  write: (line: string) => void,
  clock: () => Date = () => new Date(),
): VoiceTurnLog => {
  let wake: { readonly word: string | null; readonly score: number } | null = null;
  let transcript: string | null = null;
  const note: VoiceTurnLog["note"] = (kind, fields) =>
    write(`${JSON.stringify({ at: clock().toISOString(), kind, ...fields })}\n`);
  const clear = () => {
    wake = null;
    transcript = null;
  };
  return {
    note,
    event: (event) => {
      switch (event.type) {
        case "wake":
          if (wake !== null && transcript === null) note("wake_only", { wake });
          wake = { word: event.word, score: event.score };
          return;
        case "transcript":
          transcript = event.text;
          return;
        case "dropped":
          return note("dropped", { wake, text: event.text, reason: event.reason });
        case "stop_heard":
          return note("stop", { text: event.text });
        case "dismissed":
          clear();
          return note("dismissed", { text: event.text });
        case "barge_in":
          return note("barge_in", {});
        case "nothing":
          note("nothing_heard", { wake });
          return clear();
        case "error":
          return note("error", { message: event.message });
        case "effect":
          if (event.effect.kind !== "dictate") return;
          note("dictated", { chars: event.effect.text.length });
          return clear();
        case "outcome":
          if ("source" in event.outcome && event.outcome.source === "screen") return;
          if (event.outcome.kind === "dictated") return;
          note("outcome", {
            wake,
            transcript,
            outcome: event.outcome.kind,
            reply: "reply" in event.outcome ? event.outcome.reply : "",
            ...("reason" in event.outcome ? { reason: event.outcome.reason } : {}),
          });
          return clear();
        case "state":
          if (event.state !== "sleeping") return;
          if (wake !== null && transcript === null) note("wake_only", { wake });
          return clear();
        case "speech_end":
          return note("speech_end", {});
        case "thinking":
          return note("processing_start", {});
      }
    },
    timings: (timings) => {
      note("turn", { wake, transcript, ...timings });
      clear();
    },
  };
};
