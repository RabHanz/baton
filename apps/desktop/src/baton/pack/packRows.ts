// @effect-diagnostics nodeBuiltinImport:off
/**
 * The pack in Baton's window (D148): the executive framing, each role and the routing table as rows to
 * open and correct. They are the same files the server reads; a row that has no file yet writes the
 * neutral default into the folder first, so there is something real to edit. "Use default" deletes his
 * file, never the default.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { DEFAULT_ROUTING } from "@t3tools/baton-shared/costRouting";
import { DEFAULT_OS_PACK } from "@t3tools/baton-shared/osPack";

import type { HomeControl } from "../home/batonHome.ts";

export const PACK_FOLDER = "operating-system";
const NAME = /^[a-z0-9][a-z0-9-]{0,40}$/;

const fileFor = (dir: string, id: string): string | null => {
  if (id === "executive") return NodePath.join(dir, "executive.md");
  if (id === "routing") return NodePath.join(dir, "routing.json");
  const role = /^role:(.+)$/.exec(id)?.[1];
  return role !== undefined && NAME.test(role) ? NodePath.join(dir, "roles", `${role}.md`) : null;
};

const defaultText = (id: string): string =>
  id === "executive"
    ? DEFAULT_OS_PACK.executive
    : id === "routing"
      ? JSON.stringify(DEFAULT_ROUTING, null, 2)
      : (DEFAULT_OS_PACK.roles[id.replace(/^role:/, "")] ?? "");

const roleNames = (dir: string): ReadonlyArray<string> => {
  let mine: string[] = [];
  try {
    mine = NodeFS.readdirSync(NodePath.join(dir, "roles"))
      .filter((n) => n.endsWith(".md"))
      .map((n) => n.slice(0, -3));
  } catch {
    // no roles folder yet
  }
  return [...new Set([...Object.keys(DEFAULT_OS_PACK.roles), ...mine.filter((n) => NAME.test(n))])];
};

export const packControls = (dir: string): ReadonlyArray<HomeControl> => {
  const row = (id: string, label: string, hint: string): HomeControl => {
    const file = fileFor(dir, id)!;
    const mine = NodeFS.existsSync(file);
    let text = defaultText(id);
    if (mine) {
      try {
        text = NodeFS.readFileSync(file, "utf8");
      } catch {
        // Unreadable: the default shows, and saving writes a new file.
      }
    }
    return {
      id: `p.ed:${id}`,
      section: "Operating-system pack",
      label,
      hint: mine ? `${hint} Your file.` : `${hint} The neutral default; saving makes it your file.`,
      kind: "editor",
      text,
      mine,
      more: id !== "executive",
    };
  };
  return [
    row("executive", "How Tessaya frames a job", "Every plan follows it."),
    ...roleNames(dir).map((name) =>
      row(`role:${name}`, `Specialist: ${name}`, "Briefed when a part is given to it."),
    ),
    row(
      "routing",
      "Which model for which step",
      "Planning on the strong one, routine work on the cheap one.",
    ),
    {
      id: "p.folder",
      section: "Operating-system pack",
      label: "Pack folder",
      hint: "To import your own document, run scripts/tessaya/import-operating-system.mjs on it; it writes here.",
      kind: "action",
      button: "Open folder",
      more: true,
    },
  ];
};

/** `p:<id>` Edit, `p:<id>:later` Use default. */
export const packAction = (id: string) => {
  const m = /^p:(executive|routing|role:[a-z0-9-]+?)(:later)?$/.exec(id);
  return m === null ? null : ({ id: m[1]!, reset: m[2] !== undefined } as const);
};

/** The file to open: made from the default when he has none, so there is something to edit. */
export const fileToEdit = (dir: string, id: string): string | null => {
  const file = fileFor(dir, id);
  if (file === null) return null;
  if (!NodeFS.existsSync(file)) {
    NodeFS.mkdirSync(NodePath.dirname(file), { recursive: true });
    NodeFS.writeFileSync(file, `${defaultText(id)}\n`, { flag: "wx" });
  }
  return file;
};

/** Back to the default: his file goes (a .bak stays), the default is untouched. */
export const useDefault = (dir: string, id: string): boolean => {
  const file = fileFor(dir, id);
  if (file === null || !NodeFS.existsSync(file)) return false;
  NodeFS.renameSync(file, `${file}.bak`);
  return true;
};

/** `p.ed:<id>:save` with the text, `p.ed:<id>:reset`. */
export const packEdit = (id: string) => {
  const m = /^p\.ed:(executive|routing|role:[a-z0-9-]+?):(save|reset)$/.exec(id);
  return m === null ? null : ({ id: m[1]!, save: m[2] === "save" } as const);
};

export const PACK_TEXT_MAX = 40_000;

/** Null when it was saved; otherwise why not, in words for him. The routing table must stay valid JSON. */
export const savePackText = (dir: string, id: string, text: string): string | null => {
  const file = fileFor(dir, id);
  if (file === null) return "That is not a part of the pack.";
  if (text.trim() === "") return "A part of the pack cannot be empty; use the default instead.";
  if (text.length > PACK_TEXT_MAX) return "That is too long.";
  if (id === "routing") {
    try {
      const parsed = JSON.parse(text) as unknown;
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return "The routing table must be a JSON object.";
      }
    } catch {
      return "The routing table is not valid JSON, so it was not saved.";
    }
  }
  NodeFS.mkdirSync(NodePath.dirname(file), { recursive: true });
  // The file he had stays as a .bak until the next save.
  if (NodeFS.existsSync(file)) NodeFS.copyFileSync(file, `${file}.bak`);
  NodeFS.writeFileSync(file, text.endsWith("\n") ? text : `${text}\n`);
  return null;
};
