// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { PROVIDER_SEND_TURN_MAX_IMAGE_BYTES, type ChatAttachment } from "@t3tools/contracts";
import { mentionedMediaPaths } from "@t3tools/shared/mediaMentions";
import { mediaKindFromPath } from "@t3tools/shared/mediaPreview";

import {
  chatAttachmentStableKey,
  createDeterministicAttachmentId,
  resolveAttachmentPath,
} from "./attachmentStore.ts";

/** A named file bigger than this is left where it is. */
export const MAX_MENTIONED_FILE_BYTES = 20 * 1024 * 1024;

const IMAGE_TYPES: Record<string, string> = {
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

/**
 * Real paths of the image and video files a reply names that sit inside `cwd` (a symlink out of
 * it, or any path elsewhere, is not read).
 */
export const mentionedMediaFiles = (text: string, cwd: string): ReadonlyArray<string> => {
  let root: string;
  try {
    root = NodeFS.realpathSync(cwd);
  } catch {
    return [];
  }
  const files: Array<string> = [];
  for (const mention of mentionedMediaPaths(text)) {
    try {
      const real = NodeFS.realpathSync(NodePath.resolve(root, mention));
      if (real.startsWith(`${root}${NodePath.sep}`) && !files.includes(real)) files.push(real);
    } catch {}
  }
  return files;
};

/**
 * A finished reply plus the image and video files it names inside `cwd`, copied into T3's
 * attachment store (ids from the bytes, so doing it twice writes nothing new) and appended as
 * markdown media, which every client renders. Text that names nothing comes back unchanged.
 */
export const withMentionedMedia = (input: {
  readonly attachmentsDir: string;
  readonly threadId: string;
  readonly messageId: string;
  readonly text: string;
  readonly cwd: string;
}): string => {
  const links: Array<string> = [];
  mentionedMediaFiles(input.text, input.cwd).forEach((file, index) => {
    const name = NodePath.basename(file);
    try {
      const stat = NodeFS.statSync(file);
      if (!stat.isFile() || stat.size === 0 || stat.size > MAX_MENTIONED_FILE_BYTES) return;
      const bytes = NodeFS.readFileSync(file);
      const id = createDeterministicAttachmentId(
        input.threadId,
        chatAttachmentStableKey(input.messageId, index, bytes),
      );
      const extension = NodePath.extname(name).toLowerCase();
      const imageType = IMAGE_TYPES[extension];
      if (id === null || mediaKindFromPath(name) === null) return;
      const attachment: ChatAttachment =
        imageType !== undefined && bytes.length <= PROVIDER_SEND_TURN_MAX_IMAGE_BYTES
          ? { type: "image", id, name, mimeType: imageType, sizeBytes: bytes.length }
          : {
              type: "file",
              id,
              name,
              mimeType: "application/octet-stream",
              sizeBytes: bytes.length,
            };
      const copy = resolveAttachmentPath({ attachmentsDir: input.attachmentsDir, attachment });
      if (copy === null) return;
      if (!NodeFS.existsSync(copy)) {
        NodeFS.mkdirSync(input.attachmentsDir, { recursive: true });
        NodeFS.writeFileSync(copy, bytes);
      }
      links.push(`![${name}](<${copy}>)`);
    } catch {}
  });
  return links.length === 0 ? input.text : `${input.text}\n\n${links.join("\n\n")}`;
};
