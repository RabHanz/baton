// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalDateInEffect:off preferSchemaOverJson:off globalTimers:off
/** The real machine behind the session catalog: Claude's transcripts, the history index, `baton`, Herdr. */
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { askHistory } from "@t3tools/baton-shared/historyIndex";
import * as Effect from "effect/Effect";

import {
  accountOfConfigDir,
  claudeConfigDirs,
  readAllProfileLiveSessions,
} from "./ClaudeLiveSessions.ts";
import type { CatalogPorts, TranscriptInfo } from "./SessionCatalog.ts";
import { isBackgroundRun, parseHistoryHits, readTranscriptHead } from "./SessionCatalogParse.ts";

const HEAD_BYTES = 48 * 1024;

const scanTranscripts = (limit: number): ReadonlyArray<TranscriptInfo> => {
  const found: Array<{ file: string; id: string; mtime: number; account: string | null }> = [];
  for (const dir of claudeConfigDirs()) {
    const root = NodePath.join(dir, "projects");
    let slugs: string[] = [];
    try {
      slugs = NodeFS.readdirSync(root);
    } catch {
      continue;
    }
    const account = accountOfConfigDir(dir);
    for (const slug of slugs) {
      let names: string[] = [];
      try {
        names = NodeFS.readdirSync(NodePath.join(root, slug)).filter((n) =>
          /^[0-9a-f-]{36}\.jsonl$/i.test(n),
        );
      } catch {
        continue;
      }
      for (const n of names) {
        const file = NodePath.join(root, slug, n);
        try {
          found.push({ file, id: n.slice(0, -6), mtime: NodeFS.statSync(file).mtimeMs, account });
        } catch {
          // gone between listing and reading
        }
      }
    }
  }
  const out: TranscriptInfo[] = [];
  const seen = new Set<string>();
  for (const f of found.toSorted((a, b) => b.mtime - a.mtime)) {
    if (seen.has(f.id)) continue;
    seen.add(f.id);
    if (out.length >= limit) break;
    let head = "";
    try {
      const fd = NodeFS.openSync(f.file, "r");
      const buf = Buffer.alloc(HEAD_BYTES);
      head = buf.subarray(0, NodeFS.readSync(fd, buf, 0, HEAD_BYTES, 0)).toString("utf8");
      NodeFS.closeSync(fd);
    } catch {
      continue;
    }
    const { cwd, title, entrypoint } = readTranscriptHead(head);
    out.push({
      sessionId: f.id,
      cwd,
      title,
      lastActivityAt: new Date(f.mtime).toISOString(),
      account: f.account,
      file: f.file,
      background: isBackgroundRun({ cwd, entrypoint, title }),
    });
  }
  return out;
};

let cached: { at: number; limit: number; rows: ReadonlyArray<TranscriptInfo> } | null = null;

const BATON = process.env["BATON_BIN"] ?? NodePath.join(NodeOS.homedir(), ".local", "bin", "baton");

export const realCatalogPorts = (type: CatalogPorts["type"]): CatalogPorts => ({
  machine: NodeOS.hostname(),
  live: () => Effect.runPromise(readAllProfileLiveSessions()),
  // A box can hold tens of thousands of transcripts: one scan serves every call for a few seconds.
  transcripts: async (limit) => {
    const now = Date.now();
    if (cached !== null && now - cached.at < 15_000 && cached.limit >= limit)
      return cached.rows.slice(0, limit);
    const rows = scanTranscripts(Math.max(limit, 600));
    cached = { at: now, limit: Math.max(limit, 600), rows };
    return rows.slice(0, limit);
  },
  history: async (query) => {
    const answer = await askHistory(process.env, { query });
    return answer.ok ? parseHistoryHits(answer.text) : [];
  },
  readTail: async (file) => {
    const fd = NodeFS.openSync(file, "r");
    try {
      const size = NodeFS.fstatSync(fd).size;
      const length = Math.min(size, 96 * 1024);
      const buf = Buffer.alloc(length);
      NodeFS.readSync(fd, buf, 0, length, size - length);
      return buf.toString("utf8");
    } finally {
      NodeFS.closeSync(fd);
    }
  },
  dirExists: (dir) => {
    try {
      return NodeFS.statSync(dir).isDirectory();
    } catch {
      return false;
    }
  },
  baton: (args) =>
    new Promise((resolve) =>
      NodeChildProcess.execFile(
        BATON,
        [...args],
        {
          timeout: 45_000,
          env: { ...process.env, PATH: `${NodePath.dirname(BATON)}:${process.env["PATH"] ?? ""}` },
          windowsHide: true,
        },
        (error, stdout, stderr) =>
          resolve({ ok: error === null, out: `${stdout}${stderr}`.trim() }),
      ),
    ),
  type,
  screen: (session, pane) =>
    new Promise((resolve) =>
      NodeChildProcess.execFile(
        "herdr",
        ["--session", session, "agent", "read", pane, "--source", "visible", "--lines", "25"],
        { timeout: 8_000, windowsHide: true },
        (_e, stdout) => resolve(stdout),
      ),
    ),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
});
