/**
 * Records every agent-to-agent send and refusal, and limits each sender per minute, counted from those rows here, on
 * the machine that receives it. The Record never decides a send: unreadable, the send goes ahead; unwritable, the
 * send's own answer stands, so a retry never delivers twice.
 */
import { recordText } from "@t3tools/baton-shared/audit";
import { decideMessage } from "@t3tools/baton-shared/trust";
import { OrchestratorMcpFailure, type ThreadId } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { callerLinkOrigin } from "../mcp/linkOrigin.ts";
import * as McpInvocationContext from "../mcp/McpInvocationContext.ts";
import { loadCaller } from "../mcp/threadAccess.ts";
import { BatonRecordService } from "./BatonRecordService.ts";

const KIND = "agent_message";
const MINUTE_MS = 60_000;
const isMcpFailure = Schema.is(OrchestratorMcpFailure);

/** Sends started in the last minute, per sender: two at once cannot both pass before either is recorded. */
const started = new Map<string, Array<number>>();

export const gateThreadSend = Effect.fn("AgentMessageGate.gateThreadSend")(function* <A, E, R>(
  input: { readonly threadId: ThreadId },
  send: Effect.Effect<A, E, R>,
) {
  const record = yield* Effect.serviceOption(BatonRecordService);
  const scope = yield* McpInvocationContext.McpInvocationContext;
  const caller = Option.getOrUndefined(yield* loadCaller().pipe(Effect.option));
  const origin = caller === undefined ? undefined : callerLinkOrigin(caller);
  // A whole delegation tree is one sender, and a link or client is one by its session, never by its name.
  const sender = recordText(
    caller?.caller !== undefined
      ? `thread:${caller.caller.lineage.rootThreadId}`
      : origin !== undefined
        ? `link:${origin.sessionId}`
        : `client:${scope.client?.sessionId ?? "unknown"}`,
    60,
  );
  const target =
    caller === undefined
      ? null
      : yield* caller.threads.getThreadShell(input.threadId).pipe(Effect.orElseSucceed(() => null));
  const write = (outcome: "sent" | "refused", detail: string) =>
    Option.match(record, {
      onNone: () => Effect.void,
      onSome: (r) =>
        r
          .append({
            kind: KIND,
            actor: sender,
            project: target?.projectId ?? null,
            ref: input.threadId,
            subject: `To thread ${JSON.stringify(target?.title ?? input.threadId)}`,
            outcome,
            detail,
          })
          .pipe(Effect.ignoreCause),
    });

  const now = yield* Clock.currentTimeMillis;
  const recorded = yield* Option.match(record, {
    onNone: () => Effect.succeed(0),
    onSome: (r) =>
      r
        .query({
          kind: KIND,
          actor: sender,
          outcome: "sent",
          since: DateTime.formatIso(DateTime.makeUnsafe(now - MINUTE_MS)),
          limit: 500,
        })
        .pipe(
          Effect.map((rows) => rows.length),
          Effect.catchCause(() => Effect.succeed(0)),
        ),
  });
  const recent = (started.get(sender) ?? []).filter((at) => at > now - MINUTE_MS);
  const verdict = decideMessage({ sentLastMinute: Math.max(recorded, recent.length) });
  if (verdict.verdict === "deny") {
    started.set(sender, recent);
    yield* write("refused", verdict.why);
    return yield* new OrchestratorMcpFailure({ code: "capability_denied", message: verdict.why });
  }
  started.set(sender, [...recent, now]);
  return yield* send.pipe(
    Effect.tapError((error) =>
      Effect.sync(() => {
        // Nothing was sent, so it does not count.
        const mine = started.get(sender) ?? [];
        const at = mine.lastIndexOf(now);
        if (at >= 0) started.set(sender, mine.toSpliced(at, 1));
      }).pipe(
        Effect.andThen(write("refused", isMcpFailure(error) ? error.message : String(error))),
      ),
    ),
    Effect.tap(() => write("sent", "")),
  );
});
