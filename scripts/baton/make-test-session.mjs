#!/usr/bin/env node
// Makes a throwaway STOPPED Claude session to try resuming: a new folder, one tiny haiku turn, then it exits.
//   node scripts/baton/make-test-session.mjs [--claude claude] [--dir <parent folder>]
// Prints {"sessionId","cwd"}. It then shows in the Sessions browser as stopped; resume it and send to it from there.
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

const flag = (name, fallback) => {
  const at = process.argv.indexOf(name);
  return at < 0 ? fallback : (process.argv[at + 1] ?? fallback);
};

export const claudeArgs = (sessionId) => [
  "-p",
  "Reply with the single word: ready.",
  "--session-id",
  sessionId,
  "--model",
  "haiku",
  "--output-format",
  "text",
];

if (import.meta.url === `file://${process.argv[1]}`) {
  const parent = flag("--dir", NodeOS.homedir());
  const cwd = NodeFS.mkdtempSync(NodePath.join(parent, "tessaya-resume-test-"));
  const sessionId = NodeCrypto.randomUUID();
  const run = NodeChildProcess.spawnSync(flag("--claude", "claude"), claudeArgs(sessionId), {
    cwd,
    encoding: "utf8",
    timeout: 120_000,
    windowsHide: true,
    shell: NodePath.sep === "\\",
  });
  if (run.status !== 0) {
    console.error(`claude did not finish: ${(run.stderr || run.error?.message || "no answer").slice(0, 300)}`);
    process.exit(1);
  }
  console.log(JSON.stringify({ sessionId, cwd, said: run.stdout.trim().slice(0, 40) }));
}
