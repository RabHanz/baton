// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { DEFAULT_OS_PACK } from "@t3tools/baton-shared/osPack";
import { describe, expect, it } from "vite-plus/test";

import { fileToEdit, packAction, packControls, useDefault } from "./packRows.ts";

describe("the pack in the window", () => {
  it("lists the framing, each role and the routing, writes the default to edit, and returns to it", () => {
    const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "baton-packwin-"));
    const first = packControls(dir);
    expect(first.map((c) => c.id)).toEqual([
      "p:executive",
      "p:role:engineering",
      "p:role:marketing",
      "p:role:research",
      "p:role:operations",
      "p:routing",
      "p.folder",
    ]);
    expect(first[0]).not.toHaveProperty("secondary");

    const file = fileToEdit(dir, "executive")!;
    expect(NodeFS.readFileSync(file, "utf8").trim()).toBe(DEFAULT_OS_PACK.executive);
    NodeFS.writeFileSync(file, "Mine.\n");
    expect(fileToEdit(dir, "executive")).toBe(file);
    expect(NodeFS.readFileSync(file, "utf8")).toBe("Mine.\n");
    expect(packControls(dir)[0]).toMatchObject({ secondary: "Use default" });

    NodeFS.mkdirSync(NodePath.join(dir, "roles"), { recursive: true });
    NodeFS.writeFileSync(NodePath.join(dir, "roles", "legal.md"), "A lawyer.");
    expect(packControls(dir).some((c) => c.id === "p:role:legal")).toBe(true);

    expect(useDefault(dir, "executive")).toBe(true);
    expect(NodeFS.existsSync(file)).toBe(false);
    expect(NodeFS.existsSync(`${file}.bak`)).toBe(true);
    expect(useDefault(dir, "executive")).toBe(false);
    expect(fileToEdit(dir, "role:../x")).toBeNull();
    expect(packAction("p:role:legal:later")).toEqual({ id: "role:legal", reset: true });
    expect(packAction("p:executive")).toEqual({ id: "executive", reset: false });
    expect(packAction("p.folder")).toBeNull();
    NodeFS.rmSync(dir, { recursive: true, force: true });
  });
});
