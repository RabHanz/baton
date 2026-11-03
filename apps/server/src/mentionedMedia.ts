// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { PROVIDER_SEND_TURN_MAX_IMAGE_BYTES, type ChatAttachment } from "@t3tools/contracts";
import { mentionedMediaPaths } from "@t3tools/shared/mediaMentions";
import { judgeMedia, type MediaVerdict } from "@t3tools/shared/mediaPolicy";
import { mediaKindFromPath } from "@t3tools/shared/mediaPreview";

import {
  chatAttachmentStableKey,
  createDeterministicAttachmentId,
  resolveAttachmentPath,
} from "./attachmentStore.ts";

const IMAGE_TYPES: Record<string, string> = {
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};
const MAX_PER_MESSAGE = 4;

const SIGNATURES: Record<string, ReadonlyArray<string>> = {
  ".png": ["89504e47"],
  ".jpg": ["ffd8ff"],
  ".jpeg": ["ffd8ff"],
  ".gif": ["47494638"],
  ".webp": ["52494646"],
};

/** A file named like a picture but holding something else (an error page, a half-written file) loads as "Loading image..." forever, so it is never attached. */
export const looksLikePicture = (name: string, bytes: Uint8Array): boolean => {
  const wanted = SIGNATURES[NodePath.extname(name).toLowerCase()];
  return wanted === undefined || wanted.some((sig) => Buffer.from(bytes.subarray(0, sig.length / 2)).toString("hex") === sig);
};

const real = (path: string): string | null => {
  try {
    return NodeFS.realpathSync(path);
  } catch {
    return null;
  }
};

export interface ResolvedMedia {
  readonly file: string;
  readonly size: number;
  readonly verdict: MediaVerdict;
}

/**
 * The image and video files a reply may show: those it names under the thread's own folders, and
 * those the session itself touched this turn (wrote, read, ran, screenshotted) wherever they are,
 * minus anything the policy denies. A name that is not a file, or whose real path is elsewhere, is
 * simply not media: it stays text.
 */
export const resolveMedia = (input: {
  readonly text: string;
  readonly cwd: string;
  /** Paths from the session's own tool calls this turn. */
  readonly touched?: ReadonlyArray<string>;
  /** Other folders the thread owns: its worktree, scratch space, the attachment store. */
  readonly roots?: ReadonlyArray<string>;
  /** Folders whose files are never shown again: the attachment store already holds them. */
  readonly exclude?: ReadonlyArray<string>;
}): ReadonlyArray<ResolvedMedia> => {
  const cwd = real(input.cwd);
  if (cwd === null) return [];
  const excluded = (input.exclude ?? []).flatMap((r) => real(r) ?? []);
  const home = NodeOS.homedir();
  const roots = [cwd, ...(input.roots ?? []), NodeOS.tmpdir(), "/tmp"].flatMap(
    (r) => real(r) ?? [],
  );
  const resolve = (path: string) =>
    path.startsWith("~/") ? NodePath.join(home, path.slice(2)) : NodePath.resolve(cwd, path);
  const touched = new Set((input.touched ?? []).flatMap((p) => real(resolve(p)) ?? []));
  const seen = new Set<string>();
  const out: ResolvedMedia[] = [];
  const candidates = [...mentionedMediaPaths(input.text), ...(input.touched ?? [])];
  for (const candidate of candidates) {
    const file = real(resolve(candidate));
    if (file === null || seen.has(file)) continue;
    seen.add(file);
    if (excluded.some((dir) => file.startsWith(`${dir}${NodePath.sep}`))) continue;
    try {
      const stat = NodeFS.statSync(file);
      if (!stat.isFile()) continue;
      const verdict = judgeMedia({
        real: file,
        size: stat.size,
        touched: touched.has(file),
        roots,
      });
      if (verdict.verdict !== "skip") out.push({ file, size: stat.size, verdict });
    } catch {}
    if (out.length >= MAX_PER_MESSAGE) break;
  }
  return out;
};

const megabytes = (size: number) => `${Math.round(size / 1_048_576)} MB`;

/**
 * Copies a resolved file into T3's attachment store (ids from the bytes, so doing it twice writes
 * nothing new) and returns the markdown that shows it: media markdown for what fits, a plain line
 * for what is too big. Every client renders the markdown.
 */
export const attachMarkdown = (input: {
  readonly attachmentsDir: string;
  readonly threadId: string;
  readonly messageId: string;
  readonly media: ReadonlyArray<ResolvedMedia>;
  /** Content hashes already shown in this thread, and `bad:` marks for files that could not be shown: neither is attempted twice. */
  readonly shown?: Set<string>;
}): ReadonlyArray<string> => {
  const lines: string[] = [];
  input.media.forEach(({ file, size, verdict }, index) => {
    const name = NodePath.basename(file);
    if (verdict.verdict === "link") {
      lines.push(`_${name} (${megabytes(size)}) is too big to show here._`);
      return;
    }
    if (verdict.verdict !== "attach") return;
    const unavailable = (why: string) => {
      const mark = `bad:${file}:${size}`;
      if (input.shown?.has(mark)) return;
      input.shown?.add(mark);
      lines.push(`_${name}: image unavailable (${why})_`);
    };
    if (input.shown?.has(`bad:${file}:${size}`)) return;
    try {
      const bytes = NodeFS.readFileSync(file);
      if (!looksLikePicture(name, bytes)) return unavailable("not a picture");
      const hash = NodeCrypto.createHash("sha256").update(bytes).digest("hex");
      if (input.shown?.has(hash)) return;
      input.shown?.add(hash);
      const id = createDeterministicAttachmentId(
        input.threadId,
        chatAttachmentStableKey(input.messageId, index, bytes),
      );
      const imageType = IMAGE_TYPES[NodePath.extname(name).toLowerCase()];
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
      lines.push(`![${name}](<${copy}>)`);
    } catch {
      unavailable("cannot be read");
    }
  });
  return lines;
};

/** A finished reply plus the media it may show; text that names or touches nothing comes back unchanged. */
export const withMentionedMedia = (input: {
  readonly attachmentsDir: string;
  readonly threadId: string;
  readonly messageId: string;
  readonly text: string;
  readonly cwd: string;
  readonly touched?: ReadonlyArray<string>;
  readonly roots?: ReadonlyArray<string>;
}): string => {
  const lines = attachMarkdown({
    ...input,
    media: resolveMedia({ ...input, exclude: [input.attachmentsDir] }),
  });
  return lines.length === 0 ? input.text : `${input.text}\n\n${lines.join("\n\n")}`;
};
