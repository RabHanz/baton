import {
  AuthBatonCloudApproveScope,
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  AuthStandardClientScopes,
  BATON_CLOUD_WS_METHODS,
} from "@t3tools/baton-contracts";
import { describe, expect, it } from "vite-plus/test";

import { BATON_RPC_REQUIRED_SCOPES } from "./BatonRpcAuthorization.ts";

describe("who may use cloud tasks on a hub", () => {
  it("lets any reader look, any operator ask, and only a holder of the approval scope approve or deny", () => {
    expect(BATON_RPC_REQUIRED_SCOPES[BATON_CLOUD_WS_METHODS.read]).toBe(AuthOrchestrationReadScope);
    expect(BATON_RPC_REQUIRED_SCOPES[BATON_CLOUD_WS_METHODS.act]).toBe(AuthOrchestrationOperateScope);
    expect(BATON_RPC_REQUIRED_SCOPES[BATON_CLOUD_WS_METHODS.approve]).toBe(AuthBatonCloudApproveScope);
  });

  it("does not give the approval scope to the scopes a paired client gets by default", () => {
    expect(AuthStandardClientScopes).not.toContain(AuthBatonCloudApproveScope);
    // Every default scope can reach the other cloud doors, none can reach approve.
    const reach = (door: string) => AuthStandardClientScopes.includes(BATON_RPC_REQUIRED_SCOPES[door as keyof typeof BATON_RPC_REQUIRED_SCOPES] as never);
    expect(reach(BATON_CLOUD_WS_METHODS.read)).toBe(true);
    expect(reach(BATON_CLOUD_WS_METHODS.act)).toBe(true);
    expect(reach(BATON_CLOUD_WS_METHODS.approve)).toBe(false);
  });
});
