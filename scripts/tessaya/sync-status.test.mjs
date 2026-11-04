import * as NodeAssert from "node:assert/strict";
import * as NodeTest from "node:test";

import { syncStatus } from "./sync-status.mjs";

NodeTest.test("a conflict names the patches and files; an opened PR is ok", () => {
  const stopped = syncStatus({
    result: "conflict",
    patches: ["0008-web-panes.patch"],
    files: ["apps/web/src/components/ChatView.tsx"],
    behind: 692,
  });
  NodeAssert.equal(stopped.ok, false);
  NodeAssert.deepEqual(stopped.conflictingFiles, ["apps/web/src/components/ChatView.tsx"]);
  NodeAssert.match(stopped.hint, /no longer applies/);
  NodeAssert.equal(syncStatus({ result: "opened" }).ok, true);
  NodeAssert.match(syncStatus({ result: "opened" }).hint, /by hand/);
  NodeAssert.equal(syncStatus({ result: "nothing" }).ok, true);
});
