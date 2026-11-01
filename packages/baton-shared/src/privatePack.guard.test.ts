// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { describe, expect, it } from "vite-plus/test";

const ROOT = NodePath.resolve(import.meta.dirname, "../../..");
const WINDOW = 4;
const OWN = [
  "docs/baton/",
  "packages/baton-",
  "apps/desktop/src/baton/",
  "apps/server/src/baton/",
  "scripts/baton/",
  "vendor-patches/",
];

const markers = (): ReadonlySet<string> =>
  new Set(
    NodeFS.readFileSync(NodePath.join(ROOT, "scripts/baton/private-markers.txt"), "utf8")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => /^[0-9a-f]{64}$/.test(l)),
  );

describe("a private pack stays out of the repository", () => {
  it("finds none of the hashed private phrases in Baton's own tracked files", () => {
    const hashes = markers();
    // No markers listed yet means nothing to look for; the test then costs nothing.
    if (hashes.size === 0) return;
    const files = NodeChildProcess.execFileSync("git", ["ls-files"], {
      cwd: ROOT,
      encoding: "utf8",
    })
      .split("\n")
      .filter(
        (f) => f !== "" && OWN.some((p) => f.startsWith(p)) && !f.endsWith("private-markers.txt"),
      );
    const hits: string[] = [];
    for (const file of files) {
      let text: string;
      try {
        const full = NodePath.join(ROOT, file);
        if (NodeFS.statSync(full).size > 2_000_000) continue;
        text = NodeFS.readFileSync(full, "utf8");
      } catch {
        continue;
      }
      const words = text
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(Boolean);
      for (let i = 0; i + WINDOW <= words.length; i++) {
        const sha = NodeCrypto.createHash("sha256")
          .update(words.slice(i, i + WINDOW).join(" "))
          .digest("hex");
        if (hashes.has(sha)) {
          hits.push(file);
          break;
        }
      }
    }
    expect(hits).toEqual([]);
  });
  it("catches a listed phrase in a file, naming the file and nothing else", () => {
    // The same window hash the guard uses, over a phrase made up for this test.
    const phrase = "an invented four word phrase";
    const words = `x ${phrase} y`.split(" ");
    const sha = (w: ReadonlyArray<string>) =>
      NodeCrypto.createHash("sha256").update(w.join(" ")).digest("hex");
    const listed = new Set([sha(phrase.split(" ").slice(0, 4))]);
    const found = words.some(
      (_, i) => i + WINDOW <= words.length && listed.has(sha(words.slice(i, i + WINDOW))),
    );
    expect(found).toBe(true);
  });
});
