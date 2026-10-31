/* oxlint-disable t3code/no-low-value-comments -- Baton file predating upstream's rule (D82) */
/**
 * Baton's RPC group, merged onto upstream's `WsRpcGroup` at the two places that build a
 * protocol (the server's `ws.ts`, the client's `rpc/protocol.ts`), so `@t3tools/contracts` never
 * imports Baton. The method names stay `fabric.*` on the wire (D71).
 *
 * Its own middleware tag, because upstream's `RpcScopeAuthorization` throws for any method its
 * scope table does not list; Baton's table is `BATON_RPC_REQUIRED_SCOPES` below.
 */
import {
  EnvironmentAuthorizationError,
  OrchestrationDispatchCommandError,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import * as RpcMiddleware from "effect/rpc/RpcMiddleware";
import { BatonFleetInput, BatonFleetResult } from "./fleet.ts";
import {
  BATON_ADOPTED_WS_METHODS,
  AdoptedDiscoverInput,
  AdoptedDiscoverResult,
  AdoptedListInput,
  AdoptedReadOutputInput,
  AdoptedReadOutputResult,
  AdoptedRefInput,
  AdoptedRefreshInput,
  AdoptedRegisterInput,
  AdoptedSendInputInput,
  AdoptedSendInputResult,
  AdoptedSessionError,
  AdoptedSessionListResult,
  AdoptedSessionResult,
} from "./adoptedSession.ts";
import {
  BATON_INTENT_WS_METHODS,
  BatonIntentError,
  BatonIntentInput,
  BatonIntentListInput,
  BatonIntentListResult,
  BatonBrainInput,
  BatonBrainResult,
  BatonIntentResolveResult,
  BatonIntentRunResult,
} from "./intent.ts";
import {
  BATON_ORCHESTRATION_WS_METHODS,
  OrchestrationConfirmInput,
  OrchestrationRuleCreateInput,
  OrchestrationRuleError,
  OrchestrationRuleListInput,
  OrchestrationRuleListResult,
  OrchestrationRuleRefInput,
  OrchestrationRuleResult,
} from "./orchestrationRule.ts";
import {
  BATON_ACCOUNT_WS_METHODS,
  BatonAccountPoolInput,
  BatonAccountPool,
  BatonAccountPoolUnavailableError,
  BatonAccountRotationFailedError,
  BatonAccountRotationRefusedError,
  BatonAccountUseInput,
  BatonAccountUseResult,
  BatonThreadAccountUseInput,
  BatonThreadAccountUseResult,
} from "./accountPool.ts";
import {
  BATON_WS_METHODS,
  WorkSessionAttachThreadInput,
  WorkSessionCreateInput,
  WorkSessionDetachThreadInput,
  WorkSessionError,
  WorkSessionListInput,
  WorkSessionListResult,
  WorkSessionRefInput,
  WorkSessionResult,
  WorkSessionStartThreadInput,
  WorkSessionStreamItem,
  WorkSessionUpdateInput,
} from "./workSession.ts";
import {
  BATON_LIVE_WS_METHODS,
  BatonLiveAdoptInput,
  BatonLiveAdoptResult,
  BatonLiveAttachInput,
  BatonLiveAttachResult,
  BatonHerdrSendInput,
  BatonHerdrSendResult,
} from "./liveSessions.ts";
import {
  BATON_HANDOFF_WS_METHODS,
  WorkSessionHandoffInput,
  WorkSessionHandoffRefusedError,
  WorkSessionHandoffResult,
} from "./handoff.ts";

// Baton work sessions. `fabric.*` is the layer above provider threads: the
// user's work, which outlives the thread and the account running it. See
// `packages/contracts/src/baton/workSession.ts`.

const WsBatonAccountPoolRpc = Rpc.make(BATON_ACCOUNT_WS_METHODS.accountPool, {
  payload: BatonAccountPoolInput,
  success: BatonAccountPool,
  error: Schema.Union([BatonAccountPoolUnavailableError, EnvironmentAuthorizationError]),
});

const WsBatonAccountUseRpc = Rpc.make(BATON_ACCOUNT_WS_METHODS.accountUse, {
  payload: BatonAccountUseInput,
  success: BatonAccountUseResult,
  error: Schema.Union([
    BatonAccountPoolUnavailableError,
    BatonAccountRotationRefusedError,
    BatonAccountRotationFailedError,
    EnvironmentAuthorizationError,
  ]),
});

const WsBatonThreadAccountUseRpc = Rpc.make(BATON_ACCOUNT_WS_METHODS.threadAccountUse, {
  payload: BatonThreadAccountUseInput,
  success: BatonThreadAccountUseResult,
  error: Schema.Union([
    BatonAccountPoolUnavailableError,
    BatonAccountRotationRefusedError,
    BatonAccountRotationFailedError,
    EnvironmentAuthorizationError,
  ]),
});

const WsBatonWorkSessionListRpc = Rpc.make(BATON_WS_METHODS.workSessionList, {
  payload: WorkSessionListInput,
  success: WorkSessionListResult,
  error: Schema.Union([WorkSessionError, EnvironmentAuthorizationError]),
});

const WsBatonWorkSessionCreateRpc = Rpc.make(BATON_WS_METHODS.workSessionCreate, {
  payload: WorkSessionCreateInput,
  success: WorkSessionResult,
  error: Schema.Union([WorkSessionError, EnvironmentAuthorizationError]),
});

const WsBatonWorkSessionUpdateRpc = Rpc.make(BATON_WS_METHODS.workSessionUpdate, {
  payload: WorkSessionUpdateInput,
  success: WorkSessionResult,
  error: Schema.Union([WorkSessionError, EnvironmentAuthorizationError]),
});

const WsBatonWorkSessionAttachThreadRpc = Rpc.make(BATON_WS_METHODS.workSessionAttachThread, {
  payload: WorkSessionAttachThreadInput,
  success: WorkSessionResult,
  error: Schema.Union([WorkSessionError, EnvironmentAuthorizationError]),
});

const WsBatonWorkSessionDetachThreadRpc = Rpc.make(BATON_WS_METHODS.workSessionDetachThread, {
  payload: WorkSessionDetachThreadInput,
  success: WorkSessionResult,
  error: Schema.Union([WorkSessionError, EnvironmentAuthorizationError]),
});

const WsBatonWorkSessionStartThreadRpc = Rpc.make(BATON_WS_METHODS.workSessionStartThread, {
  payload: WorkSessionStartThreadInput,
  success: WorkSessionResult,
  error: Schema.Union([
    WorkSessionError,
    OrchestrationDispatchCommandError,
    EnvironmentAuthorizationError,
  ]),
});

const WsBatonWorkSessionHandoffRpc = Rpc.make(BATON_HANDOFF_WS_METHODS.workSessionHandoff, {
  payload: WorkSessionHandoffInput,
  success: WorkSessionHandoffResult,
  error: Schema.Union([
    WorkSessionError,
    WorkSessionHandoffRefusedError,
    OrchestrationDispatchCommandError,
    EnvironmentAuthorizationError,
  ]),
});

const WsBatonLiveAttachRpc = Rpc.make(BATON_LIVE_WS_METHODS.liveAttach, {
  payload: BatonLiveAttachInput,
  success: BatonLiveAttachResult,
  error: EnvironmentAuthorizationError,
});

const WsBatonLiveAdoptRpc = Rpc.make(BATON_LIVE_WS_METHODS.liveAdopt, {
  payload: BatonLiveAdoptInput,
  success: BatonLiveAdoptResult,
  error: EnvironmentAuthorizationError,
});

const WsBatonHerdrSendRpc = Rpc.make(BATON_LIVE_WS_METHODS.herdrSend, {
  payload: BatonHerdrSendInput,
  success: BatonHerdrSendResult,
  error: EnvironmentAuthorizationError,
});

const WsBatonWorkSessionSettleRpc = Rpc.make(BATON_WS_METHODS.workSessionSettle, {
  payload: WorkSessionRefInput,
  success: WorkSessionResult,
  error: Schema.Union([WorkSessionError, EnvironmentAuthorizationError]),
});

const WsBatonWorkSessionUnsettleRpc = Rpc.make(BATON_WS_METHODS.workSessionUnsettle, {
  payload: WorkSessionRefInput,
  success: WorkSessionResult,
  error: Schema.Union([WorkSessionError, EnvironmentAuthorizationError]),
});

const WsBatonWorkSessionArchiveRpc = Rpc.make(BATON_WS_METHODS.workSessionArchive, {
  payload: WorkSessionRefInput,
  success: WorkSessionResult,
  error: Schema.Union([WorkSessionError, EnvironmentAuthorizationError]),
});

const WsBatonWorkSessionUnarchiveRpc = Rpc.make(BATON_WS_METHODS.workSessionUnarchive, {
  payload: WorkSessionRefInput,
  success: WorkSessionResult,
  error: Schema.Union([WorkSessionError, EnvironmentAuthorizationError]),
});

const WsBatonFleetGetRpc = Rpc.make(BATON_WS_METHODS.fleetGet, {
  payload: BatonFleetInput,
  success: BatonFleetResult,
  error: Schema.Union([WorkSessionError, EnvironmentAuthorizationError]),
});

const WsBatonOrchestrationRuleCreateRpc = Rpc.make(BATON_ORCHESTRATION_WS_METHODS.ruleCreate, {
  payload: OrchestrationRuleCreateInput,
  success: OrchestrationRuleResult,
  error: Schema.Union([OrchestrationRuleError, EnvironmentAuthorizationError]),
});

const WsBatonOrchestrationRuleListRpc = Rpc.make(BATON_ORCHESTRATION_WS_METHODS.ruleList, {
  payload: OrchestrationRuleListInput,
  success: OrchestrationRuleListResult,
  error: Schema.Union([OrchestrationRuleError, EnvironmentAuthorizationError]),
});

const WsBatonOrchestrationRuleDisableRpc = Rpc.make(BATON_ORCHESTRATION_WS_METHODS.ruleDisable, {
  payload: OrchestrationRuleRefInput,
  success: OrchestrationRuleResult,
  error: Schema.Union([OrchestrationRuleError, EnvironmentAuthorizationError]),
});

const WsBatonOrchestrationRuleEnableRpc = Rpc.make(BATON_ORCHESTRATION_WS_METHODS.ruleEnable, {
  payload: OrchestrationRuleRefInput,
  success: OrchestrationRuleResult,
  error: Schema.Union([OrchestrationRuleError, EnvironmentAuthorizationError]),
});

const WsBatonOrchestrationRuleConfirmRpc = Rpc.make(BATON_ORCHESTRATION_WS_METHODS.ruleConfirm, {
  payload: OrchestrationConfirmInput,
  success: OrchestrationRuleListResult,
  error: Schema.Union([OrchestrationRuleError, EnvironmentAuthorizationError]),
});

// The intent surface. `resolve` reads and `run` writes, and they are separate
// methods so the scope map can say so: previewing what a sentence would do must
// not need permission to do it.

const WsBatonIntentResolveRpc = Rpc.make(BATON_INTENT_WS_METHODS.intentResolve, {
  payload: BatonIntentInput,
  success: BatonIntentResolveResult,
  error: Schema.Union([BatonIntentError, EnvironmentAuthorizationError]),
});

const WsBatonBrainDecideRpc = Rpc.make(BATON_INTENT_WS_METHODS.brainDecide, {
  payload: BatonBrainInput,
  success: BatonBrainResult,
  error: Schema.Union([BatonIntentError, EnvironmentAuthorizationError]),
});

const WsBatonIntentRunRpc = Rpc.make(BATON_INTENT_WS_METHODS.intentRun, {
  payload: BatonIntentInput,
  success: BatonIntentRunResult,
  error: Schema.Union([BatonIntentError, EnvironmentAuthorizationError]),
});

const WsBatonIntentListRpc = Rpc.make(BATON_INTENT_WS_METHODS.intentList, {
  payload: BatonIntentListInput,
  success: BatonIntentListResult,
  error: Schema.Union([BatonIntentError, EnvironmentAuthorizationError]),
});

// Sessions Baton adopted rather than started (§9). Discovery reads; the rest
// change what an external runtime is doing, or what Baton believes about it.

const WsBatonAdoptedDiscoverRpc = Rpc.make(BATON_ADOPTED_WS_METHODS.adoptedDiscover, {
  payload: AdoptedDiscoverInput,
  success: AdoptedDiscoverResult,
  error: Schema.Union([AdoptedSessionError, EnvironmentAuthorizationError]),
});

const WsBatonAdoptedRegisterRpc = Rpc.make(BATON_ADOPTED_WS_METHODS.adoptedRegister, {
  payload: AdoptedRegisterInput,
  success: AdoptedSessionResult,
  error: Schema.Union([AdoptedSessionError, EnvironmentAuthorizationError]),
});

const WsBatonAdoptedListRpc = Rpc.make(BATON_ADOPTED_WS_METHODS.adoptedList, {
  payload: AdoptedListInput,
  success: AdoptedSessionListResult,
  error: Schema.Union([AdoptedSessionError, EnvironmentAuthorizationError]),
});

const WsBatonAdoptedRefreshRpc = Rpc.make(BATON_ADOPTED_WS_METHODS.adoptedRefresh, {
  payload: AdoptedRefreshInput,
  success: AdoptedSessionResult,
  error: Schema.Union([AdoptedSessionError, EnvironmentAuthorizationError]),
});

const WsBatonAdoptedDetachRpc = Rpc.make(BATON_ADOPTED_WS_METHODS.adoptedDetach, {
  payload: AdoptedRefInput,
  success: AdoptedSessionResult,
  error: Schema.Union([AdoptedSessionError, EnvironmentAuthorizationError]),
});

const WsBatonAdoptedSendInputRpc = Rpc.make(BATON_ADOPTED_WS_METHODS.adoptedSendInput, {
  payload: AdoptedSendInputInput,
  success: AdoptedSendInputResult,
  error: Schema.Union([AdoptedSessionError, EnvironmentAuthorizationError]),
});

const WsBatonAdoptedReadOutputRpc = Rpc.make(BATON_ADOPTED_WS_METHODS.adoptedReadOutput, {
  payload: AdoptedReadOutputInput,
  success: AdoptedReadOutputResult,
  error: Schema.Union([AdoptedSessionError, EnvironmentAuthorizationError]),
});

const WsBatonSubscribeWorkSessionsRpc = Rpc.make(BATON_WS_METHODS.subscribeWorkSessions, {
  payload: Schema.Struct({}),
  success: WorkSessionStreamItem,
  error: Schema.Union([WorkSessionError, EnvironmentAuthorizationError]),
  stream: true,
});

export class BatonRpcScopeAuthorization extends RpcMiddleware.Service<BatonRpcScopeAuthorization>()(
  "baton/contracts/BatonRpcScopeAuthorization",
  { error: EnvironmentAuthorizationError },
) {}

export const BatonRpcGroup = RpcGroup.make(
  WsBatonAccountPoolRpc,
  WsBatonAccountUseRpc,
  WsBatonThreadAccountUseRpc,
  WsBatonWorkSessionListRpc,
  WsBatonWorkSessionCreateRpc,
  WsBatonWorkSessionUpdateRpc,
  WsBatonWorkSessionAttachThreadRpc,
  WsBatonWorkSessionDetachThreadRpc,
  WsBatonWorkSessionStartThreadRpc,
  WsBatonWorkSessionHandoffRpc,
  WsBatonHerdrSendRpc,
  WsBatonLiveAttachRpc,
  WsBatonLiveAdoptRpc,
  WsBatonWorkSessionSettleRpc,
  WsBatonWorkSessionUnsettleRpc,
  WsBatonWorkSessionArchiveRpc,
  WsBatonWorkSessionUnarchiveRpc,
  WsBatonFleetGetRpc,
  WsBatonOrchestrationRuleCreateRpc,
  WsBatonOrchestrationRuleListRpc,
  WsBatonOrchestrationRuleDisableRpc,
  WsBatonOrchestrationRuleEnableRpc,
  WsBatonOrchestrationRuleConfirmRpc,
  WsBatonIntentResolveRpc,
  WsBatonBrainDecideRpc,
  WsBatonIntentRunRpc,
  WsBatonIntentListRpc,
  WsBatonAdoptedDiscoverRpc,
  WsBatonAdoptedRegisterRpc,
  WsBatonAdoptedListRpc,
  WsBatonAdoptedRefreshRpc,
  WsBatonAdoptedDetachRpc,
  WsBatonAdoptedSendInputRpc,
  WsBatonAdoptedReadOutputRpc,
  WsBatonSubscribeWorkSessionsRpc,
).middleware(BatonRpcScopeAuthorization);
