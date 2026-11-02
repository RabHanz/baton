// @effect-diagnostics nodeBuiltinImport:off
/**
 * Learnings from a folder of markdown (D150, MEMORY.md section 7): ventures keep their learnings as
 * files, and this feeds them to the brain. The folder is only ever read. A file already imported and
 * unchanged is skipped, so running it again adds nothing and does not inflate confidence.
 */
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { BatonMemoryRefusedError } from "@t3tools/baton-contracts";
import { parseLearningFile } from "@t3tools/baton-shared/memory";
import * as Effect from "effect/Effect";

import { BatonMemoryService } from "./BatonMemoryService.ts";

const MAX_FILES = 500;
const MAX_BYTES = 64 * 1024;
const MAX_DEPTH = 3;

const markdownFiles = (root: string): ReadonlyArray<string> => {
  const found: string[] = [];
  const walk = (dir: string, depth: number) => {
    for (const entry of NodeFS.readdirSync(dir, { withFileTypes: true })) {
      if (found.length >= MAX_FILES) return;
      const path = NodePath.join(dir, entry.name);
      // A link could lead out of the folder he chose, so none is followed.
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (depth < MAX_DEPTH && !entry.name.startsWith(".")) walk(path, depth + 1);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
        found.push(path);
      }
    }
  };
  walk(root, 0);
  return found.toSorted();
};

export const importFolder = Effect.fn("BatonMemoryImport.importFolder")(function* (folder: string) {
  const memory = yield* BatonMemoryService;
  if (!NodePath.isAbsolute(folder)) {
    return yield* new BatonMemoryRefusedError({ reason: "give the full path of the folder" });
  }
  const files = yield* Effect.try({
    try: () => markdownFiles(folder),
    catch: () => new BatonMemoryRefusedError({ reason: "that folder cannot be read" }),
  });
  let added = 0;
  let refused = 0;
  let unchanged = 0;
  for (const file of files) {
    const text = yield* Effect.try({
      try: () =>
        NodeFS.statSync(file).size > MAX_BYTES ? null : NodeFS.readFileSync(file, "utf8"),
      catch: () => null,
    }).pipe(Effect.orElseSucceed(() => null));
    if (text === null) {
      refused++;
      continue;
    }
    const rel = NodePath.relative(folder, file).split(NodePath.sep).join("/");
    const digest = NodeCrypto.createHash("sha1").update(text).digest("hex");
    if (!(yield* memory.noteOnce(`import:${folder}:${rel}`, digest))) {
      unchanged++;
      continue;
    }
    for (const draft of parseLearningFile(text)) {
      const item = yield* memory
        .add({ ...draft, source: "import", sourceRef: rel })
        .pipe(Effect.catch(() => Effect.succeed(null)));
      if (item === null) refused++;
      else added++;
    }
  }
  return { files: files.length, added, refused, unchanged };
});
