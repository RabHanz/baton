import { describe, expect, it } from "vite-plus/test";

import {
  DEFAULT_TIMINGS,
  initialVoiceState,
  reduceVoice,
  type VoiceEvent,
  type VoiceMachineState,
} from "./modeMachine.ts";

const play = (
  events: ReadonlyArray<VoiceEvent>,
  start: VoiceMachineState = initialVoiceState(),
) => {
  let state = start;
  const effects = [];
  for (const event of events) {
    const step = reduceVoice(state, event);
    state = step.state;
    effects.push(...step.effects);
  }
  return { state, effects };
};

describe("voice mode machine (§12.3)", () => {
  it("sleeping ignores speech without a wake", () => {
    const { state, effects } = play([
      { type: "utterance", text: "what is VentureOS doing", at: 0 },
    ]);
    expect(state.mode).toBe("sleeping");
    expect(effects).toEqual([
      { kind: "ignored", text: "what is VentureOS doing", reason: "asleep" },
    ]);
  });

  it("wake opens the command window; a command moves to conversation", () => {
    const { state, effects } = play([
      { type: "wake", at: 0 },
      { type: "utterance", text: "Hey Jarvis, what's VentureOS doing?", at: 1000 },
    ]);
    expect(state.mode).toBe("conversation");
    expect(effects).toEqual([
      { kind: "command", text: "what's VentureOS doing?", inheritedTarget: null },
    ]);
  });

  it("follow-ups inherit the target without a repeated wake, until the timeout", () => {
    const { state, effects } = play([
      { type: "wake", at: 0 },
      { type: "utterance", text: "what's VentureOS doing", at: 1000 },
      { type: "set_target", workSessionId: "ws-1", at: 1100 },
      { type: "utterance", text: "tell it to run the other test too", at: 5000 },
      { type: "tick", at: 5000 + DEFAULT_TIMINGS.conversationMs + 1 },
      {
        type: "utterance",
        text: "then have codex review it",
        at: 5000 + DEFAULT_TIMINGS.conversationMs + 2,
      },
    ]);
    expect(effects[1]).toEqual({
      kind: "command",
      text: "tell it to run the other test too",
      inheritedTarget: "ws-1",
    });
    expect(state.mode).toBe("sleeping");
    expect(state.conversationTarget).toBeNull();
    expect(effects[2]).toMatchObject({ kind: "ignored", reason: "asleep" });
  });

  it("the command window closes on its own if nothing is said", () => {
    const { state } = play([
      { type: "wake", at: 0 },
      { type: "tick", at: DEFAULT_TIMINGS.commandWindowMs + 1 },
    ]);
    expect(state.mode).toBe("sleeping");
  });

  it("'that's all' ends the conversation", () => {
    const { state } = play([
      { type: "wake", at: 0 },
      { type: "utterance", text: "what needs me", at: 10 },
      { type: "utterance", text: "that's all", at: 20 },
    ]);
    expect(state.mode).toBe("sleeping");
  });

  it("direct-session sends plain speech to the session, and a wake still opens a command", () => {
    const start = initialVoiceState(true);
    const { state, effects } = play(
      [
        { type: "utterance", text: "also run the migration tests", at: 0 },
        { type: "wake", at: 100 },
        { type: "utterance", text: "what needs me", at: 200 },
        { type: "tick", at: 200 + DEFAULT_TIMINGS.conversationMs + 1 },
      ],
      start,
    );
    expect(effects[0]).toEqual({ kind: "session_message", text: "also run the migration tests" });
    expect(effects[1]).toMatchObject({ kind: "command", text: "what needs me" });
    expect(state.mode).toBe("direct_session");
  });

  it("toggling direct-session moves the resting mode only", () => {
    let { state } = play([{ type: "set_direct_session", enabled: true, at: 0 }]);
    expect(state.mode).toBe("direct_session");
    ({ state } = play([{ type: "set_direct_session", enabled: false, at: 1 }], state));
    expect(state.mode).toBe("sleeping");
  });

  it("dictation is its own effect and only 'stop dictating' leaves it", () => {
    const { state, effects } = play([
      { type: "wake", at: 0 },
      { type: "utterance", text: "Jarvis, dictate: Thanks, I'll send it tomorrow.", at: 10 },
      { type: "utterance", text: "Tell Claude to deploy.", at: 20 },
      { type: "tick", at: 10 * DEFAULT_TIMINGS.conversationMs },
      { type: "utterance", text: "Best, Rab", at: 10 * DEFAULT_TIMINGS.conversationMs + 1 },
      { type: "utterance", text: "stop dictating", at: 10 * DEFAULT_TIMINGS.conversationMs + 2 },
    ]);
    expect(
      effects.filter((e) => e.kind === "dictate").map((e) => ("text" in e ? e.text : "")),
    ).toEqual(["Thanks, I'll send it tomorrow.", "Tell Claude to deploy.", "Best, Rab"]);
    expect(effects.some((e) => e.kind === "command" || e.kind === "session_message")).toBe(false);
    expect(state.mode).toBe("sleeping");
  });

  it("a confirmation is answered by a later 'confirm', never by the wake word", () => {
    const { effects } = play([
      { type: "wake", at: 0 },
      { type: "utterance", text: "start work on scheduler with codex", at: 10 },
      { type: "request_confirmation", token: "t1", prompt: "Start work? Say confirm.", at: 20 },
      { type: "utterance", text: "hey jarvis", at: 30 },
      { type: "utterance", text: "confirm", at: 40 },
    ]);
    const kinds = effects.map((e) => e.kind);
    expect(kinds).toEqual(["command", "speak", "ignored", "confirmed"]);
  });

  it("a confirmation expires and can be declined or superseded", () => {
    const expired = play([
      { type: "wake", at: 0 },
      { type: "request_confirmation", token: "t1", prompt: "?", at: 0 },
      { type: "utterance", text: "confirm", at: DEFAULT_TIMINGS.confirmationMs + 1 },
    ]);
    expect(expired.effects.map((e) => e.kind)).toEqual(["speak", "cancelled", "command"]);

    const declined = play([
      { type: "wake", at: 0 },
      { type: "request_confirmation", token: "t1", prompt: "?", at: 0 },
      { type: "utterance", text: "no", at: 10 },
    ]);
    expect(declined.effects).toContainEqual({ kind: "cancelled", token: "t1", reason: "declined" });

    const superseded = play([
      { type: "wake", at: 0 },
      { type: "request_confirmation", token: "t1", prompt: "?", at: 0 },
      { type: "utterance", text: "what needs me", at: 10 },
    ]);
    expect(superseded.effects.map((e) => e.kind)).toEqual(["speak", "cancelled", "command"]);
  });
});
