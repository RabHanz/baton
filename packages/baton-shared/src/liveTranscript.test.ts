import { describe, expect, it } from "vite-plus/test";

import {
  claudeProjectSlug,
  isComposerEcho,
  parseLiveTranscriptLine,
  splitTranscriptChunk,
} from "./liveTranscript.ts";

const line = (record: Record<string, unknown>) => JSON.stringify(record);

describe("a live transcript read as messages", () => {
  it("keeps user and assistant text with Claude Code's uuid", () => {
    expect(
      parseLiveTranscriptLine(
        line({
          type: "assistant",
          uuid: "u1",
          timestamp: "2026-10-27T01:00:00.000Z",
          message: { content: [{ type: "text", text: " hello " }, { type: "tool_use" }] },
        }),
      ),
    ).toEqual({
      uuid: "u1",
      role: "assistant",
      text: "hello",
      createdAt: "2026-10-27T01:00:00.000Z",
    });
    expect(
      parseLiveTranscriptLine(line({ type: "user", uuid: "u2", message: { content: "do it" } })),
    ).toMatchObject({ role: "user", text: "do it" });
  });

  it("keeps pasted images and the files a session sent, not images inside tool results", () => {
    const png = { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" };
    expect(
      parseLiveTranscriptLine(
        line({
          type: "user",
          uuid: "p",
          message: {
            content: [
              { type: "image", source: png },
              { type: "text", text: "look" },
            ],
          },
        }),
      ),
    ).toMatchObject({ text: "look", images: [{ mimeType: "image/png", data: "iVBORw0KGgo=" }] });
    expect(
      parseLiveTranscriptLine(
        line({
          type: "user",
          uuid: "t",
          message: {
            content: [{ type: "tool_result", content: [{ type: "image", source: png }] }],
          },
        }),
      ),
    ).toBeNull();
    expect(
      parseLiveTranscriptLine(
        line({
          type: "assistant",
          uuid: "s",
          message: {
            content: [
              {
                type: "tool_use",
                name: "SendUserFile",
                input: { files: ["/tmp/a.png", "/tmp/b.pdf"], caption: "Two files" },
              },
            ],
          },
        }),
      ),
    ).toMatchObject({ role: "assistant", text: "Two files", files: ["/tmp/a.png", "/tmp/b.pdf"] });
  });

  it("drops tool results, side chains, meta, summaries and other record types", () => {
    const toolResult = { type: "user", uuid: "a", message: { content: [{ type: "tool_result" }] } };
    expect(parseLiveTranscriptLine(line(toolResult))).toBeNull();
    for (const flag of ["isSidechain", "isMeta", "isCompactSummary"]) {
      expect(
        parseLiveTranscriptLine(
          line({ type: "user", uuid: "b", [flag]: true, message: { content: "x" } }),
        ),
      ).toBeNull();
    }
    expect(parseLiveTranscriptLine(line({ type: "system", uuid: "c" }))).toBeNull();
    expect(
      parseLiveTranscriptLine(line({ type: "user", message: { content: "no uuid" } })),
    ).toBeNull();
    expect(parseLiveTranscriptLine("{not json")).toBeNull();
    for (const internal of [
      "<task-notification> <task-id>b1</task-id> </task-notification>",
      "<local-command-stdout>ok</local-command-stdout>",
      "<command-name>/clear</command-name>",
    ]) {
      expect(
        parseLiveTranscriptLine(line({ type: "user", uuid: "i", message: { content: internal } })),
      ).toBeNull();
    }
  });

  it("holds back a record cut mid-line until the rest arrives", () => {
    expect(splitTranscriptChunk('{"a":1}\n{"b":')).toEqual({ lines: ['{"a":1}'], rest: '{"b":' });
    expect(splitTranscriptChunk("partial")).toEqual({ lines: [], rest: "partial" });
  });

  it("names Claude Code's project folder the way Claude Code does", () => {
    expect(claudeProjectSlug("/mnt/HC_Volume_106652742/dev/baton-autosync")).toBe(
      "-mnt-HC-Volume-106652742-dev-baton-autosync",
    );
    expect(claudeProjectSlug("/home/onnyx/VentureOS/.worktrees/x")).toBe(
      "-home-onnyx-VentureOS--worktrees-x",
    );
  });

  it("recognises the composer's message when attachments were appended to it", () => {
    expect(isComposerEcho("say  ALPHA\n@/w/.baton/inbox/a.png", "say ALPHA")).toBe(true);
    expect(isComposerEcho("something else", "say ALPHA")).toBe(false);
    expect(isComposerEcho("anything", "  ")).toBe(false);
  });
});
