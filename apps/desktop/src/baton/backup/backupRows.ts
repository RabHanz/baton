/** The Backup area of the window: export, and a restore that shows what it would do before it does it. */
import type { HomeControl } from "../home/batonHome.ts";
import type { RestoreRow } from "./backup.ts";

const SEC = "Back up and move to another computer";
const PREVIEW = "Restore preview";

const WORDS: Readonly<Record<RestoreRow["action"], string>> = {
  new: "will be added",
  replaces: "will replace yours (yours is kept as .bak)",
  same: "is already the same",
  refused: "is not something Tessaya restores",
};

export const backupControls = (
  preview: { readonly file: string; readonly rows: ReadonlyArray<RestoreRow> } | null,
  note: string | null,
): ReadonlyArray<HomeControl> => [
  {
    id: "bk.export",
    section: SEC,
    label: "Export all my Tessaya data",
    hint: "One zip of your settings, vocabulary, snippets, notes, transforms, style, commitments, pack and memory notes. Never the vault, sign-ins or recordings; the Vault tab has its own encrypted export.",
    kind: "action",
    button: "Export",
  },
  {
    id: "bk.restore",
    section: SEC,
    label: "Restore from a zip",
    hint: "Choose a zip made by Export. Nothing changes until you have seen what it would do.",
    kind: "action",
    button: "Choose a zip",
  },
  ...(note === null
    ? []
    : [{ id: "bk.note", section: SEC, label: note, kind: "check" as const, status: "ok" as const, detail: "" }]),
  ...(preview === null
    ? []
    : [
        ...preview.rows.map(
          (r, i): HomeControl => ({
            id: `bk.row:${i}`,
            section: PREVIEW,
            label: r.name,
            kind: "check",
            status: r.action === "refused" ? "warn" : "ok",
            detail: WORDS[r.action],
          }),
        ),
        {
          id: "bk.apply",
          section: PREVIEW,
          label: `Restore ${preview.rows.filter((r) => r.action === "new" || r.action === "replaces").length} file(s) from ${preview.file}`,
          kind: "action" as const,
          button: "Restore now",
          secondary: "Cancel",
        },
      ]),
];
