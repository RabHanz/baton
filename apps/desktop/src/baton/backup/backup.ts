// @effect-diagnostics nodeBuiltinImport:off
/**
 * Back up and restore Tessaya's own data for moving machines. What goes in: settings, vocabulary,
 * snippets, notes, transforms, style, commitments, the pack and the memory notes. What never does:
 * the vault (it has its own encrypted export), sign-ins, recordings, logs, and any file in which a
 * secret is found. A restore is previewed first and replaces a file only after keeping it as .bak.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { detectSecret } from "@t3tools/baton-shared/memory";

import { makeZip, readZip, type ZipEntry } from "./zip.ts";

const FILES = [
  "fabric-voice.json",
  "voice/dictionary.json",
  "snippets.json",
  "scratchpad.json",
  "transforms.json",
  "writing-style.json",
  "commitments.json",
  "initiative.json",
  "playbooks.json",
];
const DIRS: ReadonlyArray<{ readonly dir: string; readonly ext: RegExp }> = [
  { dir: "memory", ext: /\.md$/ },
  { dir: "operating-system", ext: /\.(md|json)$/ },
  { dir: "operating-system/roles", ext: /\.md$/ },
];
/** Written into the zip alongside the files; restore puts it back as a plain file to import from Memory. */
export const SERVER_MEMORY_NAME = "memory-server.md";
const NEVER = /^(vault|\.|.*token|.*secret|.*auth)/i;

export interface BackupPlan {
  readonly entries: ReadonlyArray<ZipEntry>;
  readonly skipped: ReadonlyArray<{ readonly name: string; readonly why: string }>;
}

const read = (file: string): Buffer | null => {
  try {
    return NodeFS.readFileSync(file);
  } catch {
    return null;
  }
};

export const planBackup = (stateDir: string, serverMemoryMarkdown: string | null): BackupPlan => {
  const names = [
    ...FILES,
    ...DIRS.flatMap(({ dir, ext }) => {
      try {
        return NodeFS.readdirSync(NodePath.join(stateDir, dir))
          .filter((n) => ext.test(n) && !NEVER.test(n))
          .map((n) => `${dir}/${n}`);
      } catch {
        return [];
      }
    }),
  ];
  const entries: ZipEntry[] = [];
  const skipped: Array<{ name: string; why: string }> = [];
  for (const name of names) {
    const data = read(NodePath.join(stateDir, ...name.split("/")));
    if (data === null) continue;
    const secret = detectSecret(data.toString("utf8"));
    if (secret !== null) skipped.push({ name, why: `it looks like it holds ${secret}` });
    else entries.push({ name, data });
  }
  if (serverMemoryMarkdown !== null && serverMemoryMarkdown.trim() !== "") {
    const secret = detectSecret(serverMemoryMarkdown);
    if (secret === null) {
      entries.push({ name: SERVER_MEMORY_NAME, data: Buffer.from(serverMemoryMarkdown, "utf8") });
    } else skipped.push({ name: SERVER_MEMORY_NAME, why: `it looks like it holds ${secret}` });
  }
  return { entries, skipped };
};

export const writeBackup = (file: string, plan: BackupPlan): number => {
  const zip = makeZip(plan.entries);
  NodeFS.mkdirSync(NodePath.dirname(file), { recursive: true });
  NodeFS.writeFileSync(file, zip);
  return plan.entries.length;
};

/** Only a name this module could have written: relative, no climbing, on the allow list. */
export const allowedName = (name: string): boolean =>
  name === SERVER_MEMORY_NAME ||
  FILES.includes(name) ||
  DIRS.some(
    ({ dir, ext }) =>
      name.startsWith(`${dir}/`) &&
      !name.slice(dir.length + 1).includes("/") &&
      ext.test(name) &&
      !NEVER.test(NodePath.basename(name)),
  );

export interface RestoreRow {
  readonly name: string;
  readonly action: "new" | "replaces" | "same" | "refused";
}

export interface RestorePreview {
  readonly entries: ReadonlyArray<ZipEntry>;
  readonly rows: ReadonlyArray<RestoreRow>;
}

/** What a restore would do, touching nothing. An Error when the zip cannot be read. */
export const previewRestore = (zipBytes: Buffer, stateDir: string): RestorePreview | Error => {
  const entries = readZip(zipBytes);
  if (entries instanceof Error) return entries;
  const rows = entries.map((e): RestoreRow => {
    if (!allowedName(e.name)) return { name: e.name, action: "refused" };
    const have = read(NodePath.join(stateDir, ...e.name.split("/")));
    return {
      name: e.name,
      action: have === null ? "new" : have.equals(e.data) ? "same" : "replaces",
    };
  });
  return { entries, rows };
};

/** Writes what the preview listed. A replaced file is kept as `<name>.bak` first. */
export const applyRestore = (preview: RestorePreview, stateDir: string): number => {
  let written = 0;
  for (const row of preview.rows) {
    if (row.action === "refused" || row.action === "same") continue;
    const data = preview.entries.find((e) => e.name === row.name)!.data;
    const target = NodePath.join(stateDir, ...row.name.split("/"));
    NodeFS.mkdirSync(NodePath.dirname(target), { recursive: true });
    if (row.action === "replaces") NodeFS.copyFileSync(target, `${target}.bak`);
    NodeFS.writeFileSync(target, data);
    written += 1;
  }
  return written;
};
