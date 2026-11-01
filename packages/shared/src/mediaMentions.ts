import { mediaKindFromPath } from "./mediaPreview.ts";

const MAX_MENTIONED_MEDIA = 6;
// A path-like token ending in an extension; mediaKindFromPath decides whether it is media.
const PATH_TOKEN = /(?<![\w/.:@-])((?:\/|~\/|\.{1,2}\/)?[\w.@-]+(?:\/[\w.@ -]+)*\.[A-Za-z0-9]{2,5})(?![\w/-])/g;

/** Image and video paths the text names outside code fences, URLs and markdown it already shows. */
export function mentionedMediaPaths(text: string): string[] {
  const withoutFences = text.replace(/```[\s\S]*?(?:```|$)/g, " ");
  const shown = new Set<string>();
  for (const match of withoutFences.matchAll(/!?\[([^\]]*)\]\(<?([^)>\s]+)/g)) {
    shown.add(match[1]!);
    shown.add(match[2]!.split("/").at(-1)!);
  }
  const withoutLinks = withoutFences
    .replace(/!?\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, " ");
  const found: string[] = [];
  for (const match of withoutLinks.matchAll(PATH_TOKEN)) {
    const path = match[1]!;
    const kind = mediaKindFromPath(path);
    if ((kind !== "image" && kind !== "video") || shown.has(path.split("/").at(-1)!) || found.includes(path)) continue;
    found.push(path);
    if (found.length === MAX_MENTIONED_MEDIA) break;
  }
  return found;
}

/**
 * Client fallback for providers the server cannot attach media for: the named files are appended
 * as markdown media under the text.
 */
export function appendMentionedMedia(text: string): string {
  const found = mentionedMediaPaths(text);
  if (found.length === 0) return text;
  const name = (path: string) => path.split("/").at(-1)!;
  return `${text}\n\n${found.map((path) => `![${name(path)}](<${path}>)`).join("\n\n")}`;
}
