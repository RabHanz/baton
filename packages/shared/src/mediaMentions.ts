import { mediaKindFromPath } from "./mediaPreview.ts";

const MAX_MENTIONED_MEDIA = 6;
// A path-like token ending in an extension; mediaKindFromPath decides whether it is media.
const PATH_TOKEN = /(?<![\w/.:@-])((?:\/|~\/|\.{1,2}\/)?[\w.@-]+(?:\/[\w.@ -]+)*\.[A-Za-z0-9]{2,5})(?![\w/-])/g;

/**
 * Assistant text that names a finished image or video file (`shot.png`, `/tmp/clip.mp4`) gets the
 * file appended as markdown media, so clients show it under the text instead of only naming it.
 * Files already shown as markdown, fenced code and URLs are left alone.
 */
export function appendMentionedMedia(text: string): string {
  const withoutFences = text.replace(/```[\s\S]*?(?:```|$)/g, " ");
  const shown = new Set<string>();
  for (const match of withoutFences.matchAll(/!?\[[^\]]*\]\(<?([^)>\s]+)/g)) shown.add(match[1]!);
  const withoutLinks = withoutFences
    .replace(/!?\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, " ");
  const found: string[] = [];
  for (const match of withoutLinks.matchAll(PATH_TOKEN)) {
    const path = match[1]!;
    const kind = mediaKindFromPath(path);
    if ((kind !== "image" && kind !== "video") || shown.has(path) || found.includes(path)) continue;
    found.push(path);
    if (found.length === MAX_MENTIONED_MEDIA) break;
  }
  if (found.length === 0) return text;
  const name = (path: string) => path.split("/").at(-1)!;
  return `${text}\n\n${found.map((path) => `![${name(path)}](<${path}>)`).join("\n\n")}`;
}
