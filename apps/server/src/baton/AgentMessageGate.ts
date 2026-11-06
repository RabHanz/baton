/**
 * The gate on one agent messaging another agent's thread (`t3_thread_send`): `decideMessage` decides, and every send
 * and every refusal, its own or the link fence's further in, is written to the Record. The per-minute limit is counted
 * from those rows, so a restart does not reset it. Reading the Record fails open: a broken Record never blocks a send.
 */
import { decideMessage } from "@t3tools/baton-shared/trust";
import { linkOriginIsFenced, OrchestratorMcpFailure, type ThreadId } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { callerLinkOrigin } from "../mcp/linkOrigin.ts";
import { loadCaller } from "../mcp/threadAccess.ts";
import { BatonRecordService } from "./BatonRecordService.ts";

const KIND = "agent_message";
const isMcpFailure = Schema.is(OrchestratorMcpFailure);

export const gateThreadSend = Effect.fn("AgentMessageGate.gateThreadSend")(function* <A, E, R>(
  input: { readonly threadId: ThreadId },
  send: Effect.Effect<A, E, R>,
) {
  const record = yield* Effect.serviceOption(BatonRecordService);
  const caller = yield* loadCaller().pipe(Effect.option);
  // Without a caller the send fails the same way further in; it is still recorded.
  const origin = Option.match(caller, { onNone: () => undefined, onSome: callerLinkOrigin });
  const callerThread = Option.getOrUndefined(caller)?.caller;
  const sender =
    callerThread !== undefined
      ? `thread:${callerThread.id}`
      : origin !== undefined
        ? `link:${origin.label}`
        : "client";
  const target = yield* Option.match(caller, {
    onNone: () => Effect.succeed(null),
    onSome: (c) => c.threads.getThreadShell(input.threadId).pipe(Effect.orElseSucceed(() => null)),
  });
  const write = (outcome: "sent" | "refused", detail: string) =>
    Option.match(record, {
      onNone: () => Effect.void,
      onSome: (r) =>
        r.append({
          kind: KIND,
          actor: sender,
          project: target?.projectId ?? null,
          ref: input.threadId,
          subject: `To thread "${target?.title ?? input.threadId}"`,
          outcome,
          detail,
        }),
    });

  const now = yield* Clock.currentTimeMillis;
  const since = DateTime.formatIso(DateTime.makeUnsafe(now - 60_000));
  const recent = yield* Option.match(record, {
    onNone: () => Effect.succeed([]),
    onSome: (r) => r.query({ kind: KIND, since, limit: 500 }),
  });
  const verdict = decideMessage({
    link:
      origin === undefined
        ? null
        : { label: origin.label, fullAccess: !linkOriginIsFenced(origin) },
    sameLink: origin !== undefined && target?.linkOrigin?.sessionId === origin.sessionId,
    sentLastMinute: recent.filter((row) => row.actor === sender && row.outcome === "sent").length,
  });
  if (verdict.verdict === "deny") {
    yield* write("refused", verdict.why);
    return yield* new OrchestratorMcpFailure({ code: "capability_denied", message: verdict.why });
  }
  return yield* send.pipe(
    Effect.tapError((error) =>
      write("refused", isMcpFailure(error) ? error.message : String(error)),
    ),
    Effect.tap(() => write("sent", "")),
  );
});
