// @effect-diagnostics nodeBuiltinImport:off
/** One small JSON file in Tessaya's state folder, written whole and renamed into place; a damaged file is kept aside. */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

export const createJsonStore = <T>(
  file: string,
  fallback: T,
  valid: (value: unknown) => value is T,
) => ({
  read: (): T => {
    let text: string;
    try {
      text = NodeFS.readFileSync(file, "utf8");
    } catch {
      return fallback;
    }
    try {
      const parsed: unknown = JSON.parse(text);
      return valid(parsed) ? parsed : fallback;
    } catch {
      NodeFS.renameSync(file, `${file}.bad`);
      return fallback;
    }
  },
  write: (value: T): void => {
    NodeFS.mkdirSync(NodePath.dirname(file), { recursive: true });
    NodeFS.writeFileSync(`${file}.tmp`, JSON.stringify(value, null, 2));
    NodeFS.renameSync(`${file}.tmp`, file);
  },
});
