/* oxlint-disable t3code/no-low-value-comments -- Baton file predating upstream's rule (D82) */
/**
 * Scopes for Baton's `fabric.*` methods, enforced by Baton's own middleware tag. Upstream's
 * `RpcScopeAuthorization` throws for a method its table does not list, so Baton's group cannot
 * share it; mounted next to upstream's layer in `ws.ts` (0002-server-hooks).
 *
 * Baton reuses upstream's orchestration scopes rather than adding a permission axis: work
 * sessions sit above threads and are read and operated by the people who read and operate them.
 */
import {
  AuthBatonCloudApproveScope,
  AuthFilesystemReadScope,
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  BATON_ACCOUNT_WS_METHODS,
  BATON_ADOPTED_WS_METHODS,
  BATON_HANDOFF_WS_METHODS,
  BATON_INTENT_WS_METHODS,
  BATON_JOB_WS_METHODS,
  BATON_LIVE_WS_METHODS,
  BATON_COMMITMENT_WS_METHODS,
  BATON_PHONE_WS_METHODS,
  BATON_CLOUD_WS_METHODS,
  BATON_SESSIONS_WS_METHODS,
  BATON_WEAVE_WS_METHODS,
  BATON_MEMORY_WS_METHODS,
  BATON_ORCHESTRATION_WS_METHODS,
  BATON_RECORD_WS_METHODS,
  BATON_WATCH_WS_METHODS,
  BATON_WS_METHODS,
  BatonRpcScopeAuthorization,
  type AuthEnvironmentScope,
  type BatonRpcGroup,
} from "@t3tools/baton-contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as RpcGroup from "effect/rpc/RpcGroup";

import { rpcAuthorizationError } from "../auth/RpcAuthorization.ts";

type BatonRpcMethod = RpcGroup.Rpcs<typeof BatonRpcGroup>["_tag"];

/** Every Baton method, or this does not compile. */
export const BATON_RPC_REQUIRED_SCOPES = {
  // Baton work sessions sit above provider threads and are read and mutated
  // by the same people who read and operate threads, so they reuse the
  // orchestration scopes rather than introducing a parallel permission axis.
  // Starting a thread inside a work session dispatches an ordinary
  // orchestration command underneath, which is why it needs the operate scope.
  [BATON_ACCOUNT_WS_METHODS.accountPool]: AuthOrchestrationReadScope,
  [BATON_ACCOUNT_WS_METHODS.accountUse]: AuthOrchestrationOperateScope,
  [BATON_ACCOUNT_WS_METHODS.threadAccountUse]: AuthOrchestrationOperateScope,
  [BATON_WS_METHODS.workSessionList]: AuthOrchestrationReadScope,
  [BATON_WS_METHODS.workSessionCreate]: AuthOrchestrationOperateScope,
  [BATON_WS_METHODS.workSessionUpdate]: AuthOrchestrationOperateScope,
  [BATON_WS_METHODS.workSessionAttachThread]: AuthOrchestrationOperateScope,
  [BATON_WS_METHODS.workSessionDetachThread]: AuthOrchestrationOperateScope,
  [BATON_WS_METHODS.workSessionStartThread]: AuthOrchestrationOperateScope,
  [BATON_HANDOFF_WS_METHODS.workSessionHandoff]: AuthOrchestrationOperateScope,
  [BATON_LIVE_WS_METHODS.herdrSend]: AuthOrchestrationOperateScope,
  [BATON_LIVE_WS_METHODS.liveAttach]: AuthOrchestrationOperateScope,
  [BATON_LIVE_WS_METHODS.liveAdopt]: AuthOrchestrationOperateScope,
  [BATON_LIVE_WS_METHODS.liveSetModel]: AuthOrchestrationOperateScope,
  [BATON_WS_METHODS.workSessionSettle]: AuthOrchestrationOperateScope,
  [BATON_WS_METHODS.workSessionUnsettle]: AuthOrchestrationOperateScope,
  [BATON_WS_METHODS.workSessionArchive]: AuthOrchestrationOperateScope,
  [BATON_WS_METHODS.workSessionUnarchive]: AuthOrchestrationOperateScope,
  [BATON_WS_METHODS.fleetGet]: AuthOrchestrationReadScope,
  [BATON_WATCH_WS_METHODS.watchGet]: AuthOrchestrationReadScope,
  [BATON_RECORD_WS_METHODS.list]: AuthOrchestrationReadScope,
  [BATON_RECORD_WS_METHODS.append]: AuthOrchestrationOperateScope,
  [BATON_JOB_WS_METHODS.jobList]: AuthOrchestrationReadScope,
  [BATON_JOB_WS_METHODS.jobStart]: AuthOrchestrationOperateScope,
  [BATON_JOB_WS_METHODS.jobAgree]: AuthOrchestrationOperateScope,
  [BATON_JOB_WS_METHODS.jobRefine]: AuthOrchestrationOperateScope,
  [BATON_JOB_WS_METHODS.jobGrant]: AuthOrchestrationOperateScope,
  [BATON_JOB_WS_METHODS.jobRevoke]: AuthOrchestrationOperateScope,
  [BATON_JOB_WS_METHODS.jobStop]: AuthOrchestrationOperateScope,
  [BATON_JOB_WS_METHODS.jobSchedule]: AuthOrchestrationOperateScope,
  [BATON_JOB_WS_METHODS.jobSplit]: AuthOrchestrationOperateScope,
  [BATON_WS_METHODS.subscribeWorkSessions]: AuthOrchestrationReadScope,
  // A weave types into another session's terminal: operate. Listing only reads the records.
  [BATON_WEAVE_WS_METHODS.send]: AuthOrchestrationOperateScope,
  [BATON_WEAVE_WS_METHODS.tick]: AuthOrchestrationOperateScope,
  [BATON_WEAVE_WS_METHODS.list]: AuthOrchestrationReadScope,
  // The session catalog: looking is a read; resuming, starting and sending change a machine: operate.
  [BATON_SESSIONS_WS_METHODS.list]: AuthOrchestrationReadScope,
  [BATON_SESSIONS_WS_METHODS.folders]: AuthOrchestrationReadScope,
  [BATON_SESSIONS_WS_METHODS.resume]: AuthOrchestrationOperateScope,
  [BATON_SESSIONS_WS_METHODS.create]: AuthOrchestrationOperateScope,
  [BATON_SESSIONS_WS_METHODS.send]: AuthOrchestrationOperateScope,
  [BATON_SESSIONS_WS_METHODS.cleanup]: AuthOrchestrationOperateScope,
  [BATON_SESSIONS_WS_METHODS.autoResume]: AuthOrchestrationOperateScope,
  [BATON_SESSIONS_WS_METHODS.retireHandoff]: AuthOrchestrationOperateScope,
  [BATON_SESSIONS_WS_METHODS.reattach]: AuthOrchestrationOperateScope,
  [BATON_SESSIONS_WS_METHODS.kept]: AuthOrchestrationOperateScope,
  // Cloud tasks: looking is a read; creating, approving or applying is operate.
  [BATON_CLOUD_WS_METHODS.read]: AuthOrchestrationReadScope,
  [BATON_CLOUD_WS_METHODS.act]: AuthOrchestrationOperateScope,
  // Approving is its own scope: only the desktop app's session and a client paired for it have it.
  [BATON_CLOUD_WS_METHODS.approve]: AuthBatonCloudApproveScope,
  [BATON_COMMITMENT_WS_METHODS.list]: AuthOrchestrationReadScope,
  [BATON_COMMITMENT_WS_METHODS.upsert]: AuthOrchestrationOperateScope,
  // The desktop relay takes and answers the phone's asks: operate.
  [BATON_PHONE_WS_METHODS.call]: AuthOrchestrationOperateScope,
  // Memory (D150): reading and searching are reads. Every write is operate-level, and so is
  // recall, which records that the items were used.
  [BATON_MEMORY_WS_METHODS.list]: AuthOrchestrationReadScope,
  [BATON_MEMORY_WS_METHODS.search]: AuthOrchestrationReadScope,
  [BATON_MEMORY_WS_METHODS.used]: AuthOrchestrationReadScope,
  [BATON_MEMORY_WS_METHODS.export]: AuthOrchestrationReadScope,
  // Reads files from any folder on this machine and writes memory: both permissions, or a narrowed
  // pairing reads what upstream's filesystem:read keeps from it.
  [BATON_MEMORY_WS_METHODS.import]: [AuthOrchestrationOperateScope, AuthFilesystemReadScope],
  // Runs the history script on this machine and writes held proposals.
  [BATON_MEMORY_WS_METHODS.pull]: AuthOrchestrationOperateScope,
  [BATON_MEMORY_WS_METHODS.syncHello]: AuthOrchestrationReadScope,
  [BATON_MEMORY_WS_METHODS.syncPull]: AuthOrchestrationReadScope,
  [BATON_MEMORY_WS_METHODS.syncPush]: AuthOrchestrationOperateScope,
  [BATON_MEMORY_WS_METHODS.add]: AuthOrchestrationOperateScope,
  [BATON_MEMORY_WS_METHODS.edit]: AuthOrchestrationOperateScope,
  [BATON_MEMORY_WS_METHODS.pin]: AuthOrchestrationOperateScope,
  [BATON_MEMORY_WS_METHODS.forget]: AuthOrchestrationOperateScope,
  [BATON_MEMORY_WS_METHODS.accept]: AuthOrchestrationOperateScope,
  [BATON_MEMORY_WS_METHODS.recall]: AuthOrchestrationOperateScope,
  // Each call spends a cheap-model turn on his subscription.
  [BATON_MEMORY_WS_METHODS.learn]: AuthOrchestrationOperateScope,
  // A rule starts provider sessions and messages threads when it fires, so
  // creating or re-enabling one is an operate-level act even though the RPC
  // itself only writes a row. Reading the rules is a read.
  [BATON_ORCHESTRATION_WS_METHODS.ruleCreate]: AuthOrchestrationOperateScope,
  [BATON_ORCHESTRATION_WS_METHODS.ruleList]: AuthOrchestrationReadScope,
  [BATON_ORCHESTRATION_WS_METHODS.ruleDisable]: AuthOrchestrationOperateScope,
  [BATON_ORCHESTRATION_WS_METHODS.ruleEnable]: AuthOrchestrationOperateScope,
  [BATON_ORCHESTRATION_WS_METHODS.ruleConfirm]: AuthOrchestrationOperateScope,
  // Resolving a sentence reads the fleet and decides what it would mean; it
  // starts nothing. Running it can message a session, start one, or create a
  // rule, so it is an operate act whatever the sentence turns out to say — the
  // scope cannot depend on the words, or a read-only client would be one
  // phrasing away from an operate-level effect.
  [BATON_INTENT_WS_METHODS.intentResolve]: AuthOrchestrationReadScope,
  // It acts on nothing, but each call spends his subscription on a model turn.
  [BATON_INTENT_WS_METHODS.brainDecide]: AuthOrchestrationOperateScope,
  [BATON_INTENT_WS_METHODS.intentRun]: AuthOrchestrationOperateScope,
  [BATON_INTENT_WS_METHODS.intentList]: AuthOrchestrationReadScope,
  // Adopting a terminal is an operate act even though discovery is a read:
  // registering one puts it in the fleet, and typing into it types into
  // somebody's live session.
  [BATON_ADOPTED_WS_METHODS.adoptedDiscover]: AuthOrchestrationReadScope,
  [BATON_ADOPTED_WS_METHODS.adoptedList]: AuthOrchestrationReadScope,
  [BATON_ADOPTED_WS_METHODS.adoptedRegister]: AuthOrchestrationOperateScope,
  [BATON_ADOPTED_WS_METHODS.adoptedRefresh]: AuthOrchestrationOperateScope,
  [BATON_ADOPTED_WS_METHODS.adoptedDetach]: AuthOrchestrationOperateScope,
  [BATON_ADOPTED_WS_METHODS.adoptedSendInput]: AuthOrchestrationOperateScope,
  // Reading is a read scope even though what it reads is somebody's live
  // terminal, because it changes nothing. Whether there is anything to read is
  // decided by the capability check on the session itself.
  [BATON_ADOPTED_WS_METHODS.adoptedReadOutput]: AuthOrchestrationReadScope,
} as const satisfies Readonly<
  Record<BatonRpcMethod, AuthEnvironmentScope | ReadonlyArray<AuthEnvironmentScope>>
>;

/** What the desktop may call while T3's window is closed: jobs it does not have to place, the watch, the Record, rules (standing jobs) and memory. */
export const DESK_METHODS: ReadonlySet<string> = new Set([
  BATON_ORCHESTRATION_WS_METHODS.ruleList,
  BATON_ORCHESTRATION_WS_METHODS.ruleEnable,
  BATON_ORCHESTRATION_WS_METHODS.ruleDisable,
  BATON_JOB_WS_METHODS.jobList,
  BATON_JOB_WS_METHODS.jobAgree,
  BATON_JOB_WS_METHODS.jobRefine,
  BATON_JOB_WS_METHODS.jobStop,
  BATON_JOB_WS_METHODS.jobSchedule,
  BATON_JOB_WS_METHODS.jobGrant,
  BATON_JOB_WS_METHODS.jobRevoke,
  BATON_JOB_WS_METHODS.jobSplit,
  BATON_WATCH_WS_METHODS.watchGet,
  BATON_RECORD_WS_METHODS.list,
  BATON_RECORD_WS_METHODS.append,
  ...(
    [
      "list",
      "search",
      "add",
      "edit",
      "pin",
      "forget",
      "accept",
      "recall",
      "used",
      "export",
      "learn",
    ] as const
  ).map((op) => BATON_MEMORY_WS_METHODS[op]),
]);

/** The scope a caller lacks for this method, or null when it may call it. */
export const missingBatonScope = (
  tag: string,
  scopes: ReadonlyArray<AuthEnvironmentScope>,
): AuthEnvironmentScope | null => {
  const required = (
    BATON_RPC_REQUIRED_SCOPES as Record<
      string,
      AuthEnvironmentScope | ReadonlyArray<AuthEnvironmentScope> | undefined
    >
  )[tag];
  if (required === undefined) return AuthOrchestrationOperateScope;
  const all: ReadonlyArray<AuthEnvironmentScope> =
    typeof required === "string" ? [required] : required;
  return all.find((scope) => !scopes.includes(scope)) ?? null;
};

export const layer = (scopes: ReadonlyArray<AuthEnvironmentScope>) =>
  Layer.succeed(BatonRpcScopeAuthorization)((effect, { rpc }) => {
    const missing = missingBatonScope(rpc._tag, scopes);
    return missing === null ? effect : Effect.fail(rpcAuthorizationError(missing));
  });
