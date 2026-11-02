/* oxlint-disable t3code/namespace-node-imports -- Baton file predating the rule (D82) */
import * as NodeAssert from "node:assert/strict";
import * as NodeChild from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeTest from "node:test";
import * as NodeURL from "node:url";

import { buildStatus, parseItem } from "./status-file.mjs";

const SCRIPT = NodeURL.fileURLToPath(new URL("./status-file.mjs", import.meta.url));

NodeTest.test("an item is id|title|why|weight|due, and only the title is needed", () => {
  NodeAssert.deepEqual(parseItem("Check the deploy"), {
    id: "Check the deploy",
    title: "Check the deploy",
  });
  NodeAssert.deepEqual(parseItem("a1|Approve|since Monday|150|2026-11-05T09:00:00Z"), {
    id: "a1",
    title: "Approve",
    why: "since Monday",
    weight: 100,
    due: "2026-11-05T09:00:00.000Z",
  });
  NodeAssert.equal(parseItem("a1||why"), null);
});

NodeTest.test("the document says who wrote it and when, and drops untitled items", () => {
  const doc = buildStatus(
    "Cockpit approvals",
    ["a|One", "b|", { id: "c", title: "Three" }],
    new Date("2026-11-03T10:00:00Z"),
  );
  NodeAssert.equal(doc.source, "Cockpit approvals");
  NodeAssert.equal(doc.asOf, "2026-11-03T10:00:00.000Z");
  NodeAssert.deepEqual(
    doc.items.map((i) => i.id),
    ["a", "c"],
  );
  NodeAssert.throws(() => buildStatus("", []), /--source is required/);
});

NodeTest.test("the command writes a file the reader accepts", () => {
  const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "status-file-"));
  const out = NodePath.join(dir, "nested", "s.json");
  NodeChild.execFileSync("node", [
    SCRIPT,
    "--out",
    out,
    "--source",
    "Peers",
    "--item",
    "x|Look at X|why|70",
  ]);
  const doc = JSON.parse(NodeFS.readFileSync(out, "utf8"));
  NodeAssert.equal(doc.source, "Peers");
  NodeAssert.equal(doc.items[0].weight, 70);
  NodeAssert.ok(Number.isFinite(Date.parse(doc.asOf)));
  NodeAssert.equal(NodeFS.readdirSync(NodePath.dirname(out)).length, 1, "no temp file is left");
});
