import {
  FabricIntentId,
  WorkSessionId,
  type FabricIntentRecord,
  type FabricIntentResolution,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { buildIntentRows, previewResolution } from "./fabricIntentView";

const workSessionId = WorkSessionId.make("ws-scheduler");

const record = (overrides?: Partial<FabricIntentRecord>): FabricIntentRecord => ({
  id: FabricIntentId.make("intent-1"),
  text: "What needs me?",
  outcome: "resolved",
  commandKind: "status_fleet",
  workSessionId: null,
  description: "Say what needs you.",
  reply: "Nothing needs you. 2 sessions are still working.",
  risk: "low",
  refusalReason: null,
  at: "2026-09-18T06:00:00.000Z",
  // Who read it. Every row in this file is the grammar's, which is what these
  // views were written against and still the common case (D50).
  source: "grammar",
  model: null,
  ...overrides,
});

describe("previewResolution", () => {
  it("says what pressing enter will do", () => {
    const resolution: FabricIntentResolution = {
      outcome: "resolved",
      command: {
        kind: "message_work_session",
        workSessionId,
        text: "run the migration tests",
      },
      description: "Tell VentureOS / Scheduler reconnect race: run the migration tests",
      risk: "low",
      workSessionId,
    };
    const preview = previewResolution(resolution);
    expect(preview.tone).toBe("will");
    expect(preview.line).toBe("Tell VentureOS / Scheduler reconnect race: run the migration tests");
    expect(preview.weighty).toBe(false);
  });

  it("marks what spends a subscription", () => {
    const preview = previewResolution({
      outcome: "resolved",
      command: {
        kind: "start_work_session",
        projectId: "project-ventureos" as never,
        title: "New work",
        providerInstanceId: "claude-a" as never,
        model: "claude-sonnet",
      },
      description: "Start work on VentureOS with Claude A.",
      risk: "medium",
      workSessionId: null,
    });
    // Marked, not blocked: the user is allowed to start a session by voice, and
    // is told that is what this is.
    expect(preview.weighty).toBe(true);
  });

  it("shows the words it could not place, separately from the explanation", () => {
    const preview = previewResolution({
      outcome: "refused",
      refusal: {
        reason: "unknown_target",
        unplaced: "the deploy pipeline",
        message: 'I could not place "the deploy pipeline". Say the work by name.',
      },
    });
    expect(preview.tone).toBe("refused");
    // Separate, so the user can see which words to change rather than
    // re-reading their own sentence looking for the problem.
    expect(preview.unplaced).toBe("the deploy pipeline");
    expect(preview.weighty).toBe(false);
  });

  it("has nothing to point at when the refusal is about the whole request", () => {
    const preview = previewResolution({
      outcome: "refused",
      refusal: {
        reason: "nothing_to_confirm",
        unplaced: "",
        message: "Nothing is waiting for an answer.",
      },
    });
    expect(preview.unplaced).toBeNull();
  });
});

describe("buildIntentRows", () => {
  it("shows what was said and what came of it", () => {
    const rows = buildIntentRows([record()]);
    expect(rows[0]?.text).toBe("What needs me?");
    expect(rows[0]?.outcome).toBe("Nothing needs you. 2 sessions are still working.");
    expect(rows[0]?.refused).toBe(false);
  });

  it("keeps refusals in the list", () => {
    // A log that keeps only what worked cannot show the grammar its blind
    // spots — and "it did nothing and I don't know why" is what this answers.
    const rows = buildIntentRows([
      record({
        outcome: "refused",
        commandKind: null,
        refusalReason: "unrecognised",
        reply: 'I could not place "sort out the thing".',
        description: "",
      }),
    ]);
    expect(rows[0]?.refused).toBe(true);
    expect(rows[0]?.outcome).toBe('I could not place "sort out the thing".');
  });

  it("distinguishes could not from would not", () => {
    const rows = buildIntentRows([
      record({ outcome: "failed", reply: "", description: "Tell it to stop." }),
    ]);
    expect(rows[0]?.failed).toBe(true);
    expect(rows[0]?.refused).toBe(false);
    expect(rows[0]?.outcome).toBe("Could not be done.");
  });
});
