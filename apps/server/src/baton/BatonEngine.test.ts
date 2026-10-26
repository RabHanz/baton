import { deriveBatonSessionState, RuntimeRequestId } from "@t3tools/baton-contracts";
import { describe, expect, it } from "vite-plus/test";

import { at, finishedShell, v2Shell, workingShell } from "./__fixtures__/v2ThreadShell.ts";
import { batonStateInputFromShell } from "./BatonEngine.ts";

const state = (shell: Parameters<typeof batonStateInputFromShell>[0]) =>
  deriveBatonSessionState(batonStateInputFromShell(shell));

const request = (kind: "command" | "user_input", blocking = true) => ({
  id: RuntimeRequestId.make("r1"),
  kind,
  createdAt: at("2026-09-18T05:00:10.000Z"),
  blocking,
});

describe("batonStateInputFromShell: a v2 thread shell on the §10 ladder", () => {
  it("reads an unvisited finished run as done_unseen, and a visited one as idle", () => {
    expect(state(finishedShell())).toBe("done_unseen");
    expect(state({ ...finishedShell(), lastVisitedAt: at("2026-09-18T05:01:00.000Z") })).toBe(
      "idle",
    );
  });

  it("reads a running run as working", () => {
    expect(state(workingShell())).toBe("working");
  });

  it("tells an approval from a question, and ignores a request the run works past", () => {
    expect(state(v2Shell({ status: "waiting", pendingRuntimeRequest: request("command") }))).toBe(
      "needs_approval",
    );
    expect(
      state(v2Shell({ status: "waiting", pendingRuntimeRequest: request("user_input") })),
    ).toBe("needs_input");
    expect(
      state(v2Shell({ status: "running", pendingRuntimeRequest: request("user_input", false) })),
    ).toBe("working");
  });

  it("reads a spent account as limited, and any other failure as failed", () => {
    expect(state(v2Shell({ status: "failed", lastErrorClass: "usage_limit" }))).toBe("limited");
    expect(
      state(v2Shell({ status: "failed", lastErrorClass: "provider_error", lastError: "boom" })),
    ).toBe("failed");
  });
});
