import * as NodeAssert from "node:assert/strict";
import * as NodeTest from "node:test";

import { groupOf, render } from "./changelog.mjs";

NodeTest.test("groups by the conventional word and lists newest day first", () => {
  NodeAssert.equal(groupOf("feat(vault): x"), "feat");
  NodeAssert.equal(groupOf("Merge branch"), "other");
  const text = render(
    [
      { number: 2, title: "fix(a): second", mergedAt: "2026-11-02T10:00:00Z", baseRefName: "main" },
      { number: 1, title: "feat: first", mergedAt: "2026-11-01T10:00:00Z", baseRefName: "main" },
      {
        number: 3,
        title: "feat: not on main",
        mergedAt: "2026-11-02T10:00:00Z",
        baseRefName: "other",
      },
    ],
    "o/r",
  );
  NodeAssert.ok(text.indexOf("## 2026-11-02") < text.indexOf("## 2026-11-01"));
  NodeAssert.match(text, /### Fixed\n\n- second \(\[#2\]/);
  NodeAssert.doesNotMatch(text, /not on main/);
});
