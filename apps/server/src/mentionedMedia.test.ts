// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { describe, expect, it } from "vitest";

import { withMentionedMedia } from "./mentionedMedia.ts";

describe("withMentionedMedia", () => {
  it("attaches named media inside the cwd once, and nothing that escapes it", () => {
    const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "mentioned-"));
    const cwd = NodePath.join(dir, "ws");
    const attachmentsDir = NodePath.join(dir, "attachments");
    NodeFS.mkdirSync(cwd);
    NodeFS.writeFileSync(NodePath.join(cwd, "shot.png"), Buffer.from("89504e470d0a1a0a", "hex"));
    NodeFS.writeFileSync(NodePath.join(cwd, "clip.mp4"), "mp4");
    NodeFS.writeFileSync(NodePath.join(dir, "secret.png"), "x");
    NodeFS.symlinkSync(NodePath.join(dir, "secret.png"), NodePath.join(cwd, "leak.png"));
    const input = {
      attachmentsDir,
      threadId: "t",
      messageId: "m",
      cwd,
      text: "Saved shot.png, clip.mp4, leak.png and ../secret.png",
    };
    const out = withMentionedMedia(input);
    const [, image, video, none] = out.split("\n\n");
    expect(image).toMatch(/^!\[shot\.png\]\(<.+\.png>\)$/);
    expect(video).toMatch(/^!\[clip\.mp4\]\(<.+\.mp4>\)$/);
    expect(none).toBeUndefined();
    expect(NodeFS.readdirSync(attachmentsDir)).toHaveLength(2);
    expect(withMentionedMedia(input)).toBe(out);
  });
});
