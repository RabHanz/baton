import { describe, expect, it } from "vite-plus/test";

import { createTurnLedger } from "./turnLedger.ts";

describe("each turn's own record", () => {
  it("gives a turn only what ran while it was the one running", () => {
    const ledger = createTurnLedger();
    const first = ledger.ask();
    const second = ledger.ask();
    ledger.begin();
    ledger.current().tools.push("mcp__baton__type_text");
    ledger.current().decisions.push({ tool: "mcp__baton__type_text", outcome: "asked" });
    first.done();
    // The second sentence was heard while the first waited, and stopped before it began.
    second.done();
    expect(first.record().tools).toEqual(["mcp__baton__type_text"]);
    expect(second.record()).toEqual({ tools: [], results: [], decisions: [], routes: [] });
    // A late answer after both ended lands in no turn.
    ledger.current().decisions.push({ tool: "mcp__baton__type_text", outcome: "he said no" });
    const third = ledger.ask();
    ledger.begin();
    expect(third.record().decisions).toEqual([]);
  });
});
