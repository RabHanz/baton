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
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  BATON_ACCOUNT_WS_METHODS,
  BATON_ADOPTED_WS_METHODS,
  BATON_HANDOFF_WS_METHODS,
  BATON_INTENT_WS_METHODS,
  BATON_LIVE_WS_METHODS,
  BATON_ORCHESTRATION_WS_METHODS,
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
  [BATON_WS_METHODS.workSessionSettle]: AuthOrchestrationOperateScope,
  [BATON_WS_METHODS.workSessionUnsettle]: AuthOrchestrationOperateScope,
  [BATON_WS_METHODS.workSessionArchive]: AuthOrchestrationOperateScope,
  [BATON_WS_METHODS.workSessionUnarchive]: AuthOrchestrationOperateScope,
  [BATON_WS_METHODS.fleetGet]: AuthOrchestrationReadScope,
  [BATON_WS_METHODS.subscribeWorkSessions]: AuthOrchestrationReadScope,
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
  // It decides and does nothing; acting is `intentRun`, behind its own scope.
  [BATON_INTENT_WS_METHODS.brainDecide]: AuthOrchestrationReadScope,
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
} as const satisfies Readonly<Record<BatonRpcMethod, AuthEnvironmentScope>>;

export const layer = (scopes: ReadonlyArray<AuthEnvironmentScope>) =>
  Layer.succeed(BatonRpcScopeAuthorization)((effect, { rpc }) => {
    const required = (BATON_RPC_REQUIRED_SCOPES as Record<string, AuthEnvironmentScope>)[rpc._tag];
    if (required === undefined || !scopes.includes(required)) {
      return Effect.fail(rpcAuthorizationError(required ?? AuthOrchestrationOperateScope));
    }
    return effect;
  });
