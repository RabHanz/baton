import { resolveFabricIntent } from "@t3tools/shared/fabricIntentParser";
import { describe, expect, it } from "vite-plus/test";

import { voiceUtteranceSentence } from "./fabricVoiceView";

const vocabulary = {
  workSessions: [
    {
      id: "ws-focused",
      title: "Scheduler reconnect race",
      projectId: "p",
      projectLabel: "VentureOS",
      needsApproval: false,
      updatedAt: "2026-10-26T05:00:00.000Z",
    },
    {
      id: "ws-newer",
      title: "Search ranking",
      projectId: "p",
      projectLabel: "VentureOS",
      needsApproval: false,
      updatedAt: "2026-10-26T06:00:00.000Z",
    },
  ],
  projects: [{ id: "p", title: "VentureOS" }],
  providers: [],
  openGates: [],
  hostAliases: [],
  focusedWorkSessionId: "ws-focused",
} as never;

describe("voiceUtteranceSentence", () => {
  it("sends direct-session speech to the focused session, word for word", () => {
    const sentence = voiceUtteranceSentence({
      route: "focused_session",
      text: "run the migration tests too",
    });
    const result = resolveFabricIntent(sentence!, vocabulary);
    expect(result.outcome).toBe("resolved");
    if (result.outcome !== "resolved" || result.command.kind !== "message_work_session") {
      throw new Error("expected a message to the focused session");
    }
    // The focused one, not the one that moved last.
    expect(result.workSessionId).toBe("ws-focused");
    expect(result.command.text).toBe("run the migration tests too");
  });

  it("passes a command through unchanged and drops silence", () => {
    expect(voiceUtteranceSentence({ route: "fabric_intent", text: " What needs me? " })).toBe(
      "What needs me?",
    );
    expect(voiceUtteranceSentence({ route: "focused_session", text: "  " })).toBeNull();
  });
});
