#!/usr/bin/env node
// Fails when something private ships by default (D148, D135, the public-release checklist):
// a maintainer host or account, a key or token, a tailnet address, or a hashed phrase of a private pack.
// Plain Node, no install, so CI runs it before anything else:  node scripts/baton/guard-private.mjs
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

const ROOT = NodePath.resolve(import.meta.dirname, "../..");

// Shipped code Tessaya owns. Tests, fixtures and maintainers' operator scripts are not shipped.
const SHIPPED = [
  "apps/desktop/src/baton/",
  "apps/server/src/baton/",
  "packages/baton-contracts/src/",
  "packages/baton-shared/src/",
  "apps/web/src/components/sidebar/Baton",
  "apps/web/src/components/chat/Baton",
  "apps/web/src/components/panes/baton",
  "scripts/build-desktop-artifact.ts",
];
// The voice lane owns packages/baton-voice and adds itself here when its branch lands.
const SKIPPED = [/\.test\.tsx?$/, /\/smoke\//, /Lab\.ts$/];

const PRIVATE = [
  ["a host or account of the maintainer", /signzart|onnyx|ventureos|venture-os|xiaomi|rabee/i],
  ["a cloud provider's name used as a machine", /\bhetzner\b/i],
  [
    "a key or token",
    /sk-ant-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{20,}|xox[bp]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  ],
  ["a tailnet address", /\b100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d+\.\d+\b/],
];

// Where a private name stays for now, and why. Each is an operator step for the maintainer's own
// machines, not a default for anyone else; the list only shrinks.
const ALLOWED = {
  "apps/server/src/baton/ClaudeAccountInstances.ts":
    "compat table for the maintainer's two boxes until BATON_CLAUDE_ACCOUNT_INSTANCES is set on them (D135)",
};

const WINDOW = 4;
const sha = (words) => NodeCrypto.createHash("sha256").update(words.join(" ")).digest("hex");

export const phraseHits = (text, hashes) => {
  const words = text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  for (let i = 0; i + WINDOW <= words.length; i++) {
    if (hashes.has(sha(words.slice(i, i + WINDOW)))) return true;
  }
  return false;
};

const tracked = () =>
  NodeChildProcess.execFileSync("git", ["ls-files"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\n")
    .filter(Boolean);

const read = (file) => {
  try {
    const full = NodePath.join(ROOT, file);
    return NodeFS.statSync(full).size > 2_000_000 ? null : NodeFS.readFileSync(full, "utf8");
  } catch {
    return null;
  }
};

export const run = () => {
  const problems = [];
  const files = tracked();
  for (const file of files.filter(
    (f) => SHIPPED.some((p) => f.startsWith(p)) && !SKIPPED.some((r) => r.test(f)),
  )) {
    const text = read(file);
    if (text === null || ALLOWED[file] !== undefined) continue;
    for (const [what, pattern] of PRIVATE)
      if (pattern.test(text)) problems.push(`${file}: ${what}`);
  }
  for (const file of Object.keys(ALLOWED)) {
    const text = read(file);
    if (text === null || !PRIVATE.some(([, p]) => p.test(text)))
      problems.push(`${file}: no longer needs its allow-list entry`);
  }
  const markers = new Set(
    (read("scripts/baton/private-markers.txt") ?? "")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => /^[0-9a-f]{64}$/.test(l)),
  );
  if (markers.size > 0) {
    const own = [
      "docs/baton/",
      "packages/baton-",
      "apps/desktop/src/baton/",
      "apps/server/src/baton/",
      "scripts/baton/",
      "vendor-patches/",
    ];
    for (const file of files.filter(
      (f) => own.some((p) => f.startsWith(p)) && !f.endsWith("private-markers.txt"),
    )) {
      const text = read(file);
      if (text !== null && phraseHits(text, markers))
        problems.push(`${file}: a private pack phrase`);
    }
  }
  return problems;
};

if (process.argv[1] === import.meta.filename) {
  const problems = run();
  if (problems.length > 0) {
    console.error(
      `guard-private: ${problems.length} problem(s)\n${problems.map((p) => `  ${p}`).join("\n")}`,
    );
    process.exit(1);
  }
  console.log("guard-private: ok");
}
