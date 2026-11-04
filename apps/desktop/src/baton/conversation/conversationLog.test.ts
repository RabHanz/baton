// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { describe, expect, it } from "vite-plus/test";

import { createConversationLog } from "./conversationLog.ts";

describe("the conversation file", () => {
  it("survives a restart, in full, and finds older turns by their words", () => {
    const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "baton-conv-"));
    const file = NodePath.join(dir, "c.ndjson");
    const first = createConversationLog({ file });
    const long = `${"A long careful answer. ".repeat(60)}And that is the end.`;
    first.add({ route: "answer", said: "explain the Focusrite gain", reply: long });
    for (let i = 0; i < 7; i += 1)
      first.add({ route: "answer", said: `chatter ${i}`, reply: `reply ${i}` });
    first.add({ route: "dictation", said: "(dictated 40 characters)", reply: "" });

    // The latest answer is in full, however long.
    first.add({ route: "answer", said: "read me the whole plan", reply: long });
    const second = createConversationLog({ file });
    expect(second.recent(2).map((t) => t.said)).toEqual(["chatter 6", "read me the whole plan"]);
    expect(second.recent(1)[0]?.reply).toContain("And that is the end.");
    expect(second.recent(20).map((t) => t.route)).not.toContain("dictation");
    expect(second.search("the Focusrite gain")[0]?.said).toBe("explain the Focusrite gain");
    NodeFS.rmSync(dir, { recursive: true, force: true });
  });
});
