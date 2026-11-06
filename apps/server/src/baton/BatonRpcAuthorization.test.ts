import {
  AuthBatonCloudApproveScope,
  AuthBatonHandsHostScope,
  AuthFilesystemReadScope,
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  AuthStandardClientScopes,
  BATON_CLOUD_WS_METHODS,
  BATON_JOB_WS_METHODS,
  BATON_MEMORY_WS_METHODS,
  BATON_RECORD_WS_METHODS,
  BatonRecordAppendInput,
} from "@t3tools/baton-contracts";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  BATON_RPC_REQUIRED_SCOPES,
  DESK_METHODS,
  askSourceOf,
  missingBatonScope,
} from "./BatonRpcAuthorization.ts";

describe("who may use cloud tasks on a hub", () => {
  it("lets any reader look, any operator ask, and only a holder of the approval scope approve or deny", () => {
    expect(BATON_RPC_REQUIRED_SCOPES[BATON_CLOUD_WS_METHODS.read]).toBe(AuthOrchestrationReadScope);
    expect(BATON_RPC_REQUIRED_SCOPES[BATON_CLOUD_WS_METHODS.act]).toBe(
      AuthOrchestrationOperateScope,
    );
    expect(BATON_RPC_REQUIRED_SCOPES[BATON_CLOUD_WS_METHODS.approve]).toBe(
      AuthBatonCloudApproveScope,
    );
  });

  it("does not give the approval scope to the scopes a paired client gets by default", () => {
    expect(AuthStandardClientScopes).not.toContain(AuthBatonCloudApproveScope);
    // Every default scope can reach the other cloud doors, none can reach approve.
    const reach = (door: string) =>
      AuthStandardClientScopes.includes(
        BATON_RPC_REQUIRED_SCOPES[door as keyof typeof BATON_RPC_REQUIRED_SCOPES] as never,
      );
    expect(reach(BATON_CLOUD_WS_METHODS.read)).toBe(true);
    expect(reach(BATON_CLOUD_WS_METHODS.act)).toBe(true);
    expect(reach(BATON_CLOUD_WS_METHODS.approve)).toBe(false);
  });
});

describe("who may import memory from a folder", () => {
  it("needs the filesystem read permission as well as operate, since it reads any folder on the machine", () => {
    const narrowed = [AuthOrchestrationReadScope, AuthOrchestrationOperateScope] as const;
    expect(missingBatonScope(BATON_MEMORY_WS_METHODS.import, narrowed)).toBe(
      AuthFilesystemReadScope,
    );
    expect(missingBatonScope(BATON_MEMORY_WS_METHODS.import, [AuthFilesystemReadScope])).toBe(
      AuthOrchestrationOperateScope,
    );
    expect(missingBatonScope(BATON_MEMORY_WS_METHODS.import, AuthStandardClientScopes)).toBeNull();
    expect(missingBatonScope(BATON_MEMORY_WS_METHODS.list, narrowed)).toBeNull();
  });

  it("lets only the desktop app's own session search through walls", () => {
    const search = BATON_MEMORY_WS_METHODS.search;
    const admin = { text: "deploy key", admin: true };
    expect(missingBatonScope(search, AuthStandardClientScopes, admin)).toBe(
      AuthBatonHandsHostScope,
    );
    expect(missingBatonScope(search, [AuthOrchestrationReadScope], { text: "deploy key" })).toBe(
      null,
    );
    expect(
      missingBatonScope(search, [...AuthStandardClientScopes, AuthBatonHandsHostScope], admin),
    ).toBeNull();
  });
});

describe("the desktop's direct door while T3's window is closed", () => {
  it("serves only methods with a declared scope, and never starts a job or reads a folder", () => {
    for (const method of DESK_METHODS)
      expect(Object.hasOwn(BATON_RPC_REQUIRED_SCOPES, method)).toBe(true);
    expect(DESK_METHODS.has(BATON_JOB_WS_METHODS.jobStart)).toBe(false);
    expect(DESK_METHODS.has(BATON_MEMORY_WS_METHODS.import)).toBe(false);
    expect(missingBatonScope(BATON_JOB_WS_METHODS.jobAgree, [AuthOrchestrationReadScope])).toBe(
      AuthOrchestrationOperateScope,
    );
  });
});

const decodeAppend = Schema.decodeUnknownOption(BatonRecordAppendInput);

describe("who may write the Record", () => {
  it("is only the desktop app's own session, and each kind carries only its own outcomes", () => {
    const append = BATON_RECORD_WS_METHODS.append;
    expect(missingBatonScope(append, AuthStandardClientScopes)).toBe(AuthBatonHandsHostScope);
    expect(missingBatonScope(append, [...AuthStandardClientScopes, AuthBatonHandsHostScope])).toBe(
      null,
    );
    const decodes = (row: Record<string, unknown>) =>
      decodeAppend({
        actor: "Tessaya",
        subject: "s",
        detail: "",
        ...row,
      })._tag === "Some";
    expect(decodes({ kind: "assistant_turn", outcome: "answered" })).toBe(true);
    expect(decodes({ kind: "approval", outcome: "declined" })).toBe(true);
    expect(decodes({ kind: "standing_job", outcome: "held" })).toBe(true);
    expect(decodes({ kind: "assistant_turn", outcome: "approved" })).toBe(false);
    expect(decodes({ kind: "approval", outcome: "ran" })).toBe(false);
describe("whose words an ask carries", () => {
  it("is his from a paired browser or the desktop app's own session, and a device's from any other token", () => {
    const standard = AuthStandardClientScopes;
    expect(askSourceOf({ method: "browser-session-cookie", scopes: standard })).toBe("phone");
    expect(
      askSourceOf({
        method: "bearer-access-token",
        scopes: [...standard, AuthBatonHandsHostScope],
      }),
    ).toBe("phone");
    expect(askSourceOf({ method: "bearer-access-token", scopes: standard })).toBe("device");
    expect(askSourceOf({ method: "dpop-access-token", scopes: standard })).toBe("device");
  });
});
