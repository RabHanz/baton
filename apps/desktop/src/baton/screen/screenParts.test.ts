// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import type { VoiceRouter } from "@t3tools/baton-voice";
import type { ScreenIntent } from "@t3tools/baton-shared/screenCompanion";
import { describe, expect, it } from "vite-plus/test";

import { withScreenRoutes } from "../voice/desktopVoiceCore.ts";
import {
  resolveBinary,
  resultOf,
  startVisionSession,
  subscriptionEnv,
  userMessage,
  visionArgs,
} from "./claudeVision.ts";
import { virtualKeys, xdotoolChord } from "./inputDriver.ts";

describe("claudeVision", () => {
  it("never passes an API key to the child", () => {
    const env = subscriptionEnv({
      PATH: "/bin",
      ANTHROPIC_API_KEY: "sk",
      ANTHROPIC_AUTH_TOKEN: "t",
    });
    expect(env).toEqual({ PATH: "/bin" });
  });

  it("runs safe, tool-less and unsaved", () => {
    const args = visionArgs("/tmp/p.txt", "sonnet");
    expect(args).toContain("--safe-mode");
    expect(args.slice(args.indexOf("--tools"), args.indexOf("--tools") + 2)).toEqual([
      "--tools",
      "",
    ]);
    expect(args).toContain("--no-session-persistence");
    expect(args).not.toContain("--bare"); // --bare would require an API key
  });

  it("sends images as base64 blocks", () => {
    const line = JSON.parse(
      userMessage([
        { type: "text", text: "hi" },
        { type: "image", mediaType: "image/jpeg", data: Buffer.from([1, 2, 3]) },
      ]),
    );
    expect(line.message.content[1]).toEqual({
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: "AQID" },
    });
  });

  it("reads the answer out of the result event only", () => {
    expect(resultOf('{"type":"assistant"}')).toBeNull();
    expect(resultOf("not json")).toBeNull();
    expect(resultOf('{"type":"result","result":"ok [POINT:1,2]"}')).toEqual({
      ok: true,
      text: "ok [POINT:1,2]",
    });
    expect(resultOf('{"type":"result","is_error":true,"result":"Not logged in"}')).toEqual({
      ok: false,
      error: "Not logged in",
    });
  });

  it("finds claude.exe or npm's claude.cmd on a Windows PATH", () => {
    const env = { Path: "C:\\a;C:\\b" };
    expect(resolveBinary("claude", "win32", env, (p) => p === "C:\\b\\claude.cmd")).toBe(
      "C:\\b\\claude.cmd",
    );
    expect(
      resolveBinary("claude", "win32", env, (p) => p.endsWith("claude.exe") || p.endsWith(".cmd")),
    ).toBe("C:\\a\\claude.exe");
    expect(resolveBinary("claude", "linux", env, () => true)).toBe("claude");
    expect(resolveBinary("D:\\tools\\claude.exe", "win32", env, () => false)).toBe(
      "D:\\tools\\claude.exe",
    );
  });

  it("names a missing claude in words", async () => {
    const session = startVisionSession({
      claudeBinary: "/nonexistent/claude",
      model: "sonnet",
      systemPrompt: "x",
      workDir: NodePath.join(process.env["TMPDIR"] ?? "/tmp", "baton-screen-test"),
      env: {},
      platform: "linux",
    });
    await expect(session.ask([{ type: "text", text: "hi" }])).rejects.toThrow(
      "Claude Code was not found",
    );
    session.dispose();
  });

  // The real thing, on the subscription: BATON_REAL_CLAUDE=1 with `claude` signed in (Linux/macOS).
  it.runIf(process.env["BATON_REAL_CLAUDE"] === "1")(
    "answers a screenshot question with a point on the right element",
    async () => {
      const png = NodeFS.readFileSync(
        NodePath.join(
          __dirname,
          "../../../../../docs/baton/research/clicky-2026-10-27/frames/03-clicky-windows-demo-pointing-youtube.png",
        ),
      );
      const { LOOK_PROMPT, parseReply } = await import("@t3tools/baton-shared/screenCompanion");
      const session = startVisionSession({
        claudeBinary: "claude",
        model: "sonnet",
        systemPrompt: LOOK_PROMPT,
        workDir: NodePath.join(process.env["TMPDIR"] ?? "/tmp", "baton-screen-real"),
        env: process.env,
        platform: "linux",
      });
      try {
        const reply = parseReply(
          await session.ask([
            {
              type: "text",
              text: "user's screen (cursor is here) (image dimensions: 900x506 pixels)",
            },
            { type: "image", mediaType: "image/png", data: png },
            { type: "text", text: "where do i type to search for videos?" },
          ]),
        );
        // The search box spans roughly x 240–580, y 52–82 in this frame.
        expect(reply.point).not.toBeNull();
        expect(reply.point!.x).toBeGreaterThan(240);
        expect(reply.point!.x).toBeLessThan(580);
        expect(reply.point!.y).toBeGreaterThan(45);
        expect(reply.point!.y).toBeLessThan(90);
        expect(reply.spoken.length).toBeGreaterThan(10);
      } finally {
        session.dispose();
      }
    },
  );
});

describe("inputDriver key maps", () => {
  it("maps chords to Windows virtual keys", () => {
    expect(virtualKeys(["ctrl", "s"])).toEqual([0x11, 0x53]);
    expect(virtualKeys(["alt", "F4"])).toEqual([0x12, 0x73]);
    expect(virtualKeys(["enter"])).toEqual([0x0d]);
    expect(() => virtualKeys(["win"])).toThrow('does not press "win"');
  });

  it("maps chords to xdotool names", () => {
    expect(xdotoolChord(["ctrl", "l"])).toBe("ctrl+l");
    expect(xdotoolChord(["enter"])).toBe("Return");
    expect(xdotoolChord(["shift", "f5"])).toBe("shift+F5");
  });
});

describe("withScreenRoutes", () => {
  const inner: VoiceRouter = {
    route: async () => ({
      kind: "ran",
      reply: "from baton",
      workSessionId: null,
      source: "intent",
    }),
  };
  const bus = {} as never;

  it("sends screen sentences to the companion and the rest to Baton", async () => {
    const handled: ScreenIntent[] = [];
    let active = false;
    const router = withScreenRoutes(inner, {
      active: () => active,
      handle: (i) => handled.push(i),
    });
    const command = (text: string) =>
      router.route({ kind: "command", text, inheritedTarget: null } as never, { bus, now: 0 });

    expect(await command("what's this error?")).toMatchObject({
      kind: "ran",
      reply: "",
      source: "screen",
    });
    expect(await command("what needs me?")).toMatchObject({ reply: "from baton" });
    expect(await command("next")).toMatchObject({ reply: "from baton" });
    active = true;
    expect(await command("next")).toMatchObject({ source: "screen" });
    expect(handled).toEqual([{ kind: "look", text: "what's this error?" }, { kind: "next" }]);
  });
});
