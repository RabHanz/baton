// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";

import { attachMarkdown, resolveMedia, withMentionedMedia } from "./mentionedMedia.ts";

const make = () => {
  const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "mentioned-"));
  const cwd = NodePath.join(dir, "ws");
  NodeFS.mkdirSync(cwd);
  return { dir, cwd, attachmentsDir: NodePath.join(dir, "attachments") };
};
const png = Buffer.from("89504e470d0a1a0a", "hex");
const run = (text: string, w: ReturnType<typeof make>, extra: { touched?: string[] } = {}) =>
  withMentionedMedia({
    attachmentsDir: w.attachmentsDir,
    threadId: "t",
    messageId: "m",
    text,
    cwd: w.cwd,
    ...extra,
  });

describe("withMentionedMedia", () => {
  it("attaches what a reply names inside the cwd once, and keeps a bare or foreign name as text", () => {
    const w = make();
    NodeFS.mkdirSync(NodePath.join(w.cwd, ".baton", "outbox"), { recursive: true });
    NodeFS.writeFileSync(NodePath.join(w.cwd, ".baton", "outbox", "logo.png"), png);
    NodeFS.writeFileSync(NodePath.join(w.cwd, "clip.mp4"), "mp4");
    const text = "Saved .baton/outbox/logo.png, clip.mp4, ghost.png and C:\\Users\\a\\logo.png";
    const out = run(text, w);
    const [, image, video, none] = out.split("\n\n");
    expect(image).toMatch(/^!\[logo\.png\]\(<.+\.png>\)$/);
    expect(video).toMatch(/^!\[clip\.mp4\]\(<.+\.mp4>\)$/);
    expect(none).toBeUndefined();
    expect(NodeFS.readdirSync(w.attachmentsDir)).toHaveLength(2);
    expect(run(text, w)).toBe(out);
    // A bare name with no file behind it, or a Windows path, is only text.
    expect(run("it is ghost.png", w)).toBe("it is ghost.png");
    expect(run("saved C:\\Users\\a\\logo.png", w)).toBe("saved C:\\Users\\a\\logo.png");
  });

  it("shows a file the session touched anywhere, but never one outside what it touched or a secret", () => {
    const w = make();
    // Outside the cwd and outside every temp folder, so only a touch can show it.
    const elsewhere = NodeFS.mkdtempSync("/dev/shm/frames-");
    const shot = NodePath.join(elsewhere, "shot.png");
    NodeFS.writeFileSync(shot, png);
    const sshDir = NodePath.join(w.dir, ".ssh");
    NodeFS.mkdirSync(sshDir);
    const key = NodePath.join(sshDir, "diagram.png");
    NodeFS.writeFileSync(key, png);
    // Named in prose only: outside the cwd, so it stays text.
    expect(run(`see ${shot}`, w)).toBe(`see ${shot}`);
    // Touched by a tool call this turn: shown.
    expect(run("done", w, { touched: [shot] })).toMatch(/!\[shot\.png\]/);
    // A secret is never shown, touched or not.
    expect(run(`see ${key}`, w, { touched: [key] })).toBe(`see ${key}`);
    // A symlink out of the cwd cannot smuggle a secret in.
    NodeFS.symlinkSync(key, NodePath.join(w.cwd, "innocent.png"));
    expect(run("see innocent.png", w)).toBe("see innocent.png");
    NodeFS.rmSync(elsewhere, { recursive: true, force: true });
  });

  it("a file named like a picture that is not one says it is unavailable, once, and never attaches", () => {
    const w = make();
    NodeFS.writeFileSync(NodePath.join(w.cwd, "s1s.png"), "<html>error</html>");
    const shown = new Set<string>();
    const go = () =>
      attachMarkdown({
        attachmentsDir: w.attachmentsDir,
        threadId: "t",
        messageId: "m",
        media: resolveMedia({ text: "see s1s.png", cwd: w.cwd }),
        shown,
      });
    expect(go()).toEqual(["_s1s.png: image unavailable (not a picture)_"]);
    expect(go()).toEqual([]);
    expect(NodeFS.existsSync(w.attachmentsDir)).toBe(false);
  });
});
