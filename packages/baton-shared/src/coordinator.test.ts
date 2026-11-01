import type { BatonJob } from "@t3tools/baton-contracts";
import { describe, expect, it } from "vite-plus/test";

import { partsSettled, partsSummary, SUMMARY_MARK } from "./coordinator.ts";

const part = (id: string, group: string) =>
  ({ workSessionId: id, title: `Part ${id}`, group }) as unknown as BatonJob;

describe("the coordinator's summary", () => {
  it("is ready only when every part is done or failed, never for no parts", () => {
    expect(partsSettled([])).toBe(false);
    expect(partsSettled([part("a", "done"), part("b", "running")])).toBe(false);
    expect(partsSettled([part("a", "done"), part("b", "needs_you")])).toBe(false);
    expect(partsSettled([part("a", "done"), part("b", "failed")])).toBe(true);
  });
  it("writes one summary with what each part did, and asks for the report", () => {
    const text = partsSummary({
      parentTitle: "Site",
      parts: [part("a", "done"), part("b", "failed")],
      findings: [{ workSessionId: "b", lastDid: "ran the tests" } as never],
    });
    expect(text).toBe(
      `${SUMMARY_MARK} Site\n- Part a: done\n- Part b: failed. Last: ran the tests\n1 of 2 failed. Say what is missing, what it blocks, and what to do next.`,
    );
  });
});
