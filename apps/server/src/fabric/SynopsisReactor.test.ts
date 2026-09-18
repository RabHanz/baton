import {
  CheckpointRef,
  EventId,
  MessageId,
  ThreadId,
  TurnId,
  type OrchestrationEvent,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { synopsisSignalsForEvent } from "./SynopsisReactor.ts";

const threadId = ThreadId.make("thread-1");
const AT = "2026-09-18T04:00:00.000Z";

describe("synopsisSignalsForEvent", () => {
  it("reads a turn start from the user's own message, which is where the words are", () => {
    const event = {
      type: "thread.message-sent",
      payload: {
        threadId,
        messageId: MessageId.make("m1"),
        role: "user",
        text: "Find the reconnect race",
        turnId: null,
        streaming: false,
        createdAt: AT,
        updatedAt: AT,
      },
    } as unknown as OrchestrationEvent;
    expect(synopsisSignalsForEvent(event)).toEqual({
      threadId,
      signals: [{ kind: "turn-started", at: AT, prompt: "Find the reconnect race" }],
    });
  });

  it("ignores an assistant message: the synopsis is not a transcript", () => {
    const event = {
      type: "thread.message-sent",
      payload: {
        threadId,
        messageId: MessageId.make("m2"),
        role: "assistant",
        text: "I found it",
        turnId: null,
        streaming: false,
        createdAt: AT,
        updatedAt: AT,
      },
    } as unknown as OrchestrationEvent;
    expect(synopsisSignalsForEvent(event)).toBeNull();
  });

  it("takes both the changed files and the completion from one diff event", () => {
    const event = {
      type: "thread.turn-diff-completed",
      payload: {
        threadId,
        turnId: TurnId.make("turn-1"),
        checkpointTurnCount: 1,
        checkpointRef: CheckpointRef.make("refs/t3/checkpoints/1"),
        status: "ready",
        files: [
          { path: "src/scheduler.ts", kind: "modified", additions: 4, deletions: 1 },
          { path: "tests/scheduler.test.ts", kind: "modified", additions: 20, deletions: 0 },
        ],
        assistantMessageId: null,
        completedAt: AT,
      },
    } as unknown as OrchestrationEvent;
    expect(synopsisSignalsForEvent(event)).toEqual({
      threadId,
      signals: [
        {
          kind: "files-changed",
          at: AT,
          paths: ["src/scheduler.ts", "tests/scheduler.test.ts"],
        },
        { kind: "turn-completed", at: AT },
      ],
    });
  });

  it("emits only the completion when a turn changed nothing", () => {
    const event = {
      type: "thread.turn-diff-completed",
      payload: {
        threadId,
        turnId: TurnId.make("turn-2"),
        checkpointTurnCount: 1,
        checkpointRef: CheckpointRef.make("refs/t3/checkpoints/2"),
        status: "ready",
        files: [],
        assistantMessageId: null,
        completedAt: AT,
      },
    } as unknown as OrchestrationEvent;
    expect(synopsisSignalsForEvent(event)?.signals).toEqual([{ kind: "turn-completed", at: AT }]);
  });

  it("maps an activity through the shared activity rules", () => {
    const event = {
      type: "thread.activity-appended",
      payload: {
        threadId,
        activity: {
          id: EventId.make("e1"),
          tone: "neutral",
          kind: "approval.requested",
          summary: "write src/scheduler.ts",
          payload: {},
          turnId: null,
          createdAt: AT,
        },
      },
    } as unknown as OrchestrationEvent;
    expect(synopsisSignalsForEvent(event)?.signals).toEqual([
      { kind: "approval-requested", at: AT, label: "write src/scheduler.ts" },
    ]);
  });

  it("takes a failure reason from a session that errored, and nothing from one that did not", () => {
    const errored = {
      type: "thread.session-set",
      payload: {
        threadId,
        session: {
          threadId,
          status: "error",
          providerName: "Claude",
          runtimeMode: "approval-required",
          activeTurnId: null,
          lastError: "provider exited with code 1",
          updatedAt: AT,
        },
      },
    } as unknown as OrchestrationEvent;
    expect(synopsisSignalsForEvent(errored)?.signals).toEqual([
      { kind: "turn-failed", at: AT, reason: "provider exited with code 1" },
    ]);

    const running = {
      type: "thread.session-set",
      payload: {
        threadId,
        session: {
          threadId,
          status: "running",
          providerName: "Claude",
          runtimeMode: "approval-required",
          activeTurnId: null,
          lastError: null,
          updatedAt: AT,
        },
      },
    } as unknown as OrchestrationEvent;
    // Session status is the state machine's business; the synopsis only wants
    // the thing the state cannot say, which is why it failed.
    expect(synopsisSignalsForEvent(running)).toBeNull();
  });

  it("puts a linked pull request on the timeline with its repository", () => {
    const event = {
      type: "thread.pull-request-linked",
      payload: {
        threadId,
        link: {
          host: "github.com",
          repository: "RabHanz/t3code",
          number: 42,
          url: "https://github.com/RabHanz/t3code/pull/42",
          source: "manual",
          linkedAt: AT,
        },
        updatedAt: AT,
      },
    } as unknown as OrchestrationEvent;
    expect(synopsisSignalsForEvent(event)?.signals).toEqual([
      { kind: "pull-request-opened", at: AT, label: "RabHanz/t3code#42" },
    ]);
  });

  it("returns null for events the synopsis has no opinion about", () => {
    const event = {
      type: "thread.pinned",
      payload: { threadId, pinnedAt: AT },
    } as unknown as OrchestrationEvent;
    expect(synopsisSignalsForEvent(event)).toBeNull();
  });
});
