// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { ProjectId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  liveMedia,
  liveThreadId,
  liveThreadTitle,
  projectForDirectory,
} from "./LiveSessionMirror.ts";

const project = (id: string, workspaceRoot: string, canonicalKey?: string) => ({
  id: ProjectId.make(id),
  workspaceRoot,
  repositoryIdentity:
    canonicalKey === undefined
      ? null
      : ({ canonicalKey } as unknown as NonNullable<
          Parameters<typeof projectForDirectory>[1][number]["repositoryIdentity"]
        >),
});

describe("which T3 project a live session belongs to", () => {
  const projects = [
    project("ventureos", "/home/onnyx/VentureOS", "github.com/rabhanz/ventureos"),
    project("nested", "/home/onnyx/VentureOS/apps/web"),
  ];

  it("is the deepest project whose root holds the session's directory", () => {
    expect(projectForDirectory("/home/onnyx/VentureOS", projects, null)).toBe("ventureos");
    expect(projectForDirectory("/home/onnyx/VentureOS/.worktrees/lane", projects, null)).toBe(
      "ventureos",
    );
    expect(projectForDirectory("/home/onnyx/VentureOS/apps/web/src", projects, null)).toBe(
      "nested",
    );
    // A sibling folder whose name only starts the same is not inside.
    expect(projectForDirectory("/home/onnyx/VentureOS-old", projects, null)).toBeNull();
  });

  it("falls back to the same repository checked out elsewhere", () => {
    expect(
      projectForDirectory("/mnt/vol/dev/ventureos-copy", projects, "github.com/rabhanz/ventureos"),
    ).toBe("ventureos");
    expect(projectForDirectory("/mnt/vol/dev/other", projects, "github.com/x/other")).toBeNull();
  });

  it("names a thread by the conversation, so rotation and adoption keep it", () => {
    expect(liveThreadId("abc")).toBe("baton-live4:abc");
  });

  it("titles a thread with the session's own name, its account and its box", () => {
    expect(liveThreadTitle({ name: "ventureos-6c", account: "rabeehanzla", box: "onnyx" })).toBe(
      "ventureos-6c · rabeehanzla · onnyx",
    );
    expect(liveThreadTitle({ name: " ", account: null, box: "signzart-prod" })).toBe(
      "Live session · signzart-prod",
    );
  });
});

describe("a live message's media", () => {
  const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "baton-media-"));
  const attachmentsDir = NodePath.join(dir, "attachments");
  const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

  it("stores a pasted image as the user message's own T3 image attachment", () => {
    const message = {
      uuid: "u",
      role: "user" as const,
      text: "look",
      createdAt: "2026-10-29T10:00:00.000Z",
      images: [{ mimeType: "image/png", data: png.toString("base64") }],
    };
    const first = liveMedia({ attachmentsDir, threadId: "t", messageId: "m", message });
    expect(first.text).toBe("look");
    expect(first.attachments).toMatchObject([{ type: "image", mimeType: "image/png" }]);
    const stored = NodeFS.readdirSync(attachmentsDir);
    expect(stored).toHaveLength(1);
    // The same message again writes nothing new.
    expect(liveMedia({ attachmentsDir, threadId: "t", messageId: "m", message })).toEqual(first);
    expect(NodeFS.readdirSync(attachmentsDir)).toEqual(stored);
  });

  it("puts sent files in the reply as markdown and names the ones that are gone", () => {
    const sent = NodePath.join(dir, "sheet.png");
    const doc = NodePath.join(dir, "notes.pdf");
    NodeFS.writeFileSync(sent, png);
    NodeFS.writeFileSync(doc, "%PDF-1.4");
    const media = liveMedia({
      attachmentsDir,
      threadId: "t",
      messageId: "a",
      message: {
        uuid: "a",
        role: "assistant",
        text: "The sheet",
        createdAt: "2026-10-29T10:00:00.000Z",
        files: [sent, doc, NodePath.join(dir, "gone.png")],
      },
    });
    expect(media.attachments).toEqual([]);
    const [words, image, file, note] = media.text.split("\n\n");
    expect(words).toBe("The sheet");
    expect(image).toMatch(new RegExp(`^!\\[sheet\\.png\\]\\(<${attachmentsDir}/.+\\.png>\\)$`));
    expect(file).toMatch(new RegExp(`^\\[notes\\.pdf\\]\\(<${attachmentsDir}/.+\\.pdf>\\)$`));
    expect(note).toBe("_gone.png is no longer on disk._");
    // The copy is in T3's store, so the thread keeps it after the original is deleted.
    NodeFS.rmSync(sent);
    expect(NodeFS.existsSync(image!.slice(image!.indexOf("<") + 1, -2))).toBe(true);
  });
});
