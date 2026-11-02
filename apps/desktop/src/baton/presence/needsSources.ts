// @effect-diagnostics nodeBuiltinImport:off
/**
 * The read-only sources behind "what needs me": issue labels on repositories he lists, and a
 * deadlines file. Both are settings and empty by default; nothing is written, sent or spent. A
 * source that fails is named in `unreadable` so a short list is never taken for a clear one.
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";

import {
  needsFromDeadlines,
  needsFromLedger,
  type DeadlineRow,
  type LedgerIssue,
  type NeedItem,
} from "@t3tools/baton-shared/needsMe";

export type Run = (file: string, args: ReadonlyArray<string>) => Promise<string>;

const gh: Run = (file, args) =>
  new Promise((resolve, reject) =>
    NodeChildProcess.execFile(
      file,
      [...args],
      { timeout: 20_000, maxBuffer: 4_000_000, windowsHide: true },
      (error, stdout) => (error === null ? resolve(stdout) : reject(error)),
    ),
  );

const LABELS = ["ledger:money-blocker", "ledger:blocked-on-director"] as const;
const REPO = /^[\w.-]+\/[\w.-]+$/;

export const readLedger = async (
  repos: ReadonlyArray<string>,
  run: Run = gh,
): Promise<{ issues: ReadonlyArray<LedgerIssue>; unreadable: ReadonlyArray<string> }> => {
  const issues: LedgerIssue[] = [];
  const unreadable: string[] = [];
  for (const repo of repos) {
    if (!REPO.test(repo)) {
      unreadable.push(repo);
      continue;
    }
    try {
      for (const label of LABELS) {
        const out = await run("gh", [
          "issue",
          "list",
          "-R",
          repo,
          "--label",
          label,
          "--state",
          "open",
          "--limit",
          "50",
          "--json",
          "number,title,labels,updatedAt",
        ]);
        const rows = JSON.parse(out) as ReadonlyArray<{
          number: number;
          title: string;
          labels: ReadonlyArray<{ name: string }>;
          updatedAt: string;
        }>;
        for (const r of rows) {
          issues.push({
            repo,
            number: r.number,
            title: r.title,
            labels: r.labels.map((l) => l.name),
            updatedAt: r.updatedAt,
          });
        }
      }
    } catch {
      unreadable.push(`the ledger ${repo}`);
    }
  }
  return { issues, unreadable };
};

export const readDeadlines = (file: string): ReadonlyArray<DeadlineRow> => {
  const parsed = JSON.parse(NodeFS.readFileSync(file, "utf8")) as {
    rows?: ReadonlyArray<DeadlineRow>;
  };
  return Array.isArray(parsed.rows) ? parsed.rows : [];
};

export const readExternalNeeds = async (
  config: { readonly repos: ReadonlyArray<string>; readonly deadlinesFile: string | null },
  now: number,
  run?: Run,
): Promise<{ items: ReadonlyArray<NeedItem>; unreadable: ReadonlyArray<string> }> => {
  const ledger = await readLedger(config.repos, run);
  const unreadable = [...ledger.unreadable];
  let deadlines: ReadonlyArray<NeedItem> = [];
  if (config.deadlinesFile !== null) {
    try {
      deadlines = needsFromDeadlines(readDeadlines(config.deadlinesFile), now);
    } catch {
      unreadable.push("the deadlines file");
    }
  }
  return { items: [...needsFromLedger(ledger.issues), ...deadlines], unreadable };
};
