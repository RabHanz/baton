// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { MessageId, ProjectId, ThreadId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import {
  endedMirrorThreads,
  liveMedia,
  mediaPathsOf,
  nextReply,
  takeTouched,
  withoutRepeatedMedia,
  liveThreadId,
  liveThreadTitle,
  mirrorTitle,
  projectForDirectory,
  sentFromT3,
  sweepVictims,
  unreadPrompt,
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

describe("a title someone set", () => {
  const base = {
    regenerating: false,
    sessionName: "ventureos-6c",
    nameFromUser: false,
    followName: null,
    account: "rabeehanzla",
    box: "onnyx",
  };

  it("is never rewritten by the mirror, whatever the session is called", () => {
    for (const current of ["My plan", "Fix the login bug", "Plan · phase two"]) {
      expect(mirrorTitle({ ...base, current })).toBeNull();
    }
  });

  it("is left alone while a regeneration is running", () => {
    expect(mirrorTitle({ ...base, current: "old · onnyx", regenerating: true })).toBeNull();
  });

  it("still lets the mirror update a title it wrote, keeping the name", () => {
    expect(mirrorTitle({ ...base, current: "ventureos-6c · onnyx" })).toBe(
      "ventureos-6c · rabeehanzla · onnyx",
    );
    expect(mirrorTitle({ ...base, current: "ventureos-6c · rabeehanzla · onnyx" })).toBeNull();
  });
});

describe("the thread list stays clean", () => {
  const at = (iso: string) => ({ updatedAt: DateTime.makeUnsafe(iso) });
  const t = (id: string, projectId: string, iso: string) => ({
    id: ThreadId.make(id),
    projectId: ProjectId.make(projectId),
    archivedAt: null,
    ...at(iso),
  });

  it("archives an ended session's thread only after the grace, and not while live", () => {
    const shells = [
      t(String(liveThreadId("ended")), "p", "2026-11-01T10:00:00Z"),
      t(String(liveThreadId("live")), "p", "2026-11-01T10:00:00Z"),
      t("import:x:old", "p", "2026-11-01T10:00:00Z"),
    ];
    const now = Date.parse("2026-11-01T10:10:00Z");
    expect(endedMirrorThreads(shells, new Set(["live"]), now)).toEqual([liveThreadId("ended")]);
    expect(endedMirrorThreads(shells, new Set(), Date.parse("2026-11-01T10:01:00Z"))).toEqual([]);
  });

  it("keeps a thread he sent a message in", () => {
    const m = (id: string, role: "user" | "assistant") => ({ id: MessageId.make(id), role });
    expect(sentFromT3([m("baton-live4:u1", "user"), m("a", "assistant")])).toBe(false);
    expect(sentFromT3([m("baton-live4:u1", "user"), m("t3-msg", "user")])).toBe(true);
  });

  it("sweeps to one thread per project and none in the test projects", () => {
    const projects = [
      project("rabee", "/home/onnyx/rabee.dev"),
      project("quiet", "/home/onnyx/htpc"),
      project("test", "/home/onnyx/baton-prompt-test"),
    ].map((p, i) => ({ ...p, title: ["rabee.dev", "htpc", "baton-prompt-test"][i]! }));
    const shells = [
      t("import:a:1", "rabee", "2026-08-01T00:00:00Z"),
      t("import:a:2", "rabee", "2026-09-01T00:00:00Z"),
      t(String(liveThreadId("s1")), "rabee", "2026-10-01T00:00:00Z"),
      t("old", "quiet", "2026-08-01T00:00:00Z"),
      t("newest", "quiet", "2026-09-01T00:00:00Z"),
      t("tp", "test", "2026-10-30T00:00:00Z"),
    ];
    const victims = sweepVictims({
      shells,
      projects,
      liveSessions: [{ sessionId: "s1", cwd: "/home/onnyx/rabee.dev" }],
    }).map(String);
    expect(victims.toSorted()).toEqual(["import:a:1", "import:a:2", "old", "tp"]);
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

  it("stores a screenshot a tool returned as the reply's own image attachment", () => {
    const message = {
      uuid: "a",
      role: "assistant" as const,
      text: "Here is the page.",
      createdAt: "2026-10-29T10:00:00.000Z",
      images: [{ mimeType: "image/png", data: png.toString("base64") }],
    };
    const shown = liveMedia({ attachmentsDir, threadId: "t", messageId: "m2", message });
    expect(shown.text).toMatch(/^Here is the page\.\n\n!\[image-1\.png\]\(<.+>\)$/);
    expect(shown.attachments).toEqual([]);
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

  it("shows image and video files a reply names inside the session cwd, and nothing outside it", () => {
    const cwd = NodePath.join(dir, "ws");
    NodeFS.mkdirSync(cwd, { recursive: true });
    NodeFS.writeFileSync(NodePath.join(cwd, "shot.png"), png);
    NodeFS.writeFileSync(NodePath.join(cwd, "clip.mp4"), "mp4bytes");
    const secret = NodePath.join(dir, "secret.png");
    NodeFS.writeFileSync(secret, png);
    NodeFS.symlinkSync(secret, NodePath.join(cwd, "leak.png"));
    const media = liveMedia({
      attachmentsDir,
      threadId: "t",
      messageId: "n",
      cwd,
      message: {
        uuid: "n",
        role: "assistant",
        text: "Saved shot.png, clip.mp4, leak.png, ../secret.png and missing.png",
        createdAt: "2026-10-29T10:00:00.000Z",
      },
    });
    const [, image, video, extra] = media.text.split("\n\n");
    expect(image).toMatch(/^!\[shot\.png\]\(<.+\.png>\)$/);
    expect(video).toMatch(/^!\[clip\.mp4\]\(<.+\.mp4>\)$/);
    expect(extra).toBeUndefined();
  });

  it("shows a file the session's own tool calls wrote outside the cwd, though the reply never names it", () => {
    const cwd = NodePath.join(dir, "ws2");
    NodeFS.mkdirSync(cwd, { recursive: true });
    const elsewhere = NodeFS.mkdtempSync("/dev/shm/live-");
    const shot = NodePath.join(elsewhere, "screen.png");
    NodeFS.writeFileSync(shot, png);
    const base = {
      attachmentsDir,
      threadId: "t",
      messageId: "x",
      cwd,
      message: {
        uuid: "x",
        role: "assistant" as const,
        text: "Here you go.",
        createdAt: "2026-10-29T10:00:00.000Z",
      },
    };
    expect(liveMedia(base).text).toBe("Here you go.");
    expect(liveMedia({ ...base, touched: [shot] }).text).toMatch(/!\[screen\.png\]/);
    NodeFS.rmSync(elsewhere, { recursive: true, force: true });
  });
});

describe("media shows once", () => {
  it("hands a turn's touched files to the next reply only, never to the ones after", () => {
    const follow = { touched: new Set(["/w/shot.png"]) };
    expect(takeTouched(follow)).toEqual(["/w/shot.png"]);
    expect(takeTouched(follow)).toEqual([]);
    follow.touched.add("/w/other.png");
    expect(takeTouched(follow)).toEqual(["/w/other.png"]);
  });
});

describe("media across a turn's replies", () => {
  it("shows a touched image on exactly one of three replies", () => {
    const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "reply-"));
    const shot = NodePath.join(dir, "screen.png");
    NodeFS.writeFileSync(shot, Buffer.from("png-bytes"));
    const follow = { touched: new Set([shot]), shots: [] };
    const shown = ["one", "two", "three"].map((text, i) => {
      const reply = nextReply(follow, {
        uuid: `u${i}`,
        role: "assistant",
        text,
        createdAt: "2026-01-01T00:00:00Z",
      });
      return liveMedia({
        attachmentsDir: NodePath.join(dir, "att"),
        threadId: "t",
        messageId: `m${i}`,
        message: reply.message,
        cwd: dir,
        touched: reply.touched,
      }).text;
    });
    expect(shown.filter((text) => /!\[screen\.png\]/.test(text))).toHaveLength(1);
  });

  it("cleans a thread that repeated one file, keeping the first and different ones", () => {
    const bytes: Record<string, string> = { "/a/1.png": "x", "/a/2.png": "x", "/a/3.png": "y" };
    const fix = withoutRepeatedMedia(
      [
        { id: "m1", text: "one\n\n![s](</a/1.png>)" },
        { id: "m2", text: "two\n\n![s](</a/2.png>)\n\n![t](</a/3.png>)" },
      ],
      (path) => bytes[path] ?? null,
    );
    expect(fix).toEqual([{ id: "m2", text: "two\n\n![t](</a/3.png>)" }]);
  });
});

describe("a picture a reply shows is shown once, however it got there", () => {
  // Seen on a real thread: Read of a screenshot returns the image block (a tool shot) AND the file is in `touched`;
  // the reply showed it twice, once as image-1.png and once under its own name.
  it("a tool shot and the same file touched this turn give exactly one picture", () => {
    const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "twice-"));
    const bytes = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
    const file = NodePath.join(dir, "s5.png");
    NodeFS.writeFileSync(file, bytes);
    const follow = {
      touched: new Set([file]),
      shots: [{ mimeType: "image/png", data: bytes.toString("base64") }],
    };
    const reply = nextReply(follow, {
      uuid: "a",
      role: "assistant",
      text: "Here it is.",
      createdAt: "2026-01-01T00:00:00Z",
    });
    const shown = liveMedia({
      attachmentsDir: NodePath.join(dir, "att"),
      threadId: "t",
      messageId: "m",
      message: reply.message,
      cwd: dir,
      touched: reply.touched,
      shown: new Set(),
    });
    expect(shown.text.match(/!\[/g) ?? []).toHaveLength(1);
  });
  it("the same picture on a later reply of the thread is not shown again", () => {
    const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "later-"));
    const bytes = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
    const shownSet = new Set<string>();
    const once = (id: string) =>
      liveMedia({
        attachmentsDir: NodePath.join(dir, "att"),
        threadId: "t",
        messageId: id,
        message: {
          uuid: id,
          role: "assistant",
          text: "x",
          createdAt: "2026-01-01T00:00:00Z",
          images: [{ mimeType: "image/png", data: bytes.toString("base64") }],
        },
        shown: shownSet,
      }).text;
    expect(once("m1")).toMatch(/!\[/);
    expect(once("m2")).toBe("x");
  });
});

describe("media that only appears in text is not shown", () => {
  const reply = (dir: string, extra: object) => ({
    attachmentsDir: NodePath.join(dir, "att"),
    threadId: "t",
    messageId: "m",
    cwd: dir,
    message: {
      uuid: "u",
      role: "assistant" as const,
      text: "Done.",
      createdAt: "2026-01-01T00:00:00Z",
    },
    ...extra,
  });

  it("takes media only from Read, Write and Edit, never from a command that prints paths", () => {
    const listing = "grep -r x /home/dev/.t3/userdata/attachments/a.mp4 b.jpg c.png";
    expect(mediaPathsOf("Bash", { command: listing })).toEqual([]);
    expect(mediaPathsOf("Read", { file_path: "/w/shot.png" })).toEqual(["/w/shot.png"]);
    expect(mediaPathsOf("Edit", { file_path: "/w/notes.md" })).toEqual([]);
  });

  it("never re-attaches a file already in the attachment store, nor the same bytes twice", () => {
    const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "again-"));
    const att = NodePath.join(dir, "att");
    NodeFS.mkdirSync(att);
    const stored = NodePath.join(att, "old.png");
    const shot = NodePath.join(dir, "shot.png");
    NodeFS.writeFileSync(stored, Buffer.from("a"));
    NodeFS.writeFileSync(shot, Buffer.from("b"));
    expect(liveMedia(reply(dir, { touched: [stored] })).text).toBe("Done.");
    const shown = new Set<string>();
    const first = liveMedia(reply(dir, { touched: [shot], shown })).text;
    const second = liveMedia(reply(dir, { touched: [shot], shown })).text;
    expect(first).toMatch(/!\[shot\.png\]/);
    expect(second).toBe("Done.");
  });

  it("a waiting session with nothing readable still gets a question in its thread", () => {
    const plain = unreadPrompt({ sessionId: "s1", herdrPane: null }, "");
    expect(plain.options.map((o) => o.label)).toEqual(["Bring it into Herdr"]);
    const pane = unreadPrompt({ sessionId: "s1", herdrPane: "p1" }, "Proceed? (y/n)");
    expect(pane.question).toContain("Proceed? (y/n)");
    expect(pane.options.map((o) => o.label)).toEqual(["I'll answer it in the terminal"]);
  });
});
