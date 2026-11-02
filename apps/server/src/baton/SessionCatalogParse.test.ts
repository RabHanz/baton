import { describe, expect, it } from "vite-plus/test";

import { parseHistoryHits, readTranscriptHead } from "./SessionCatalogParse.ts";

const line = (o: unknown) => JSON.stringify(o);

describe("reading a transcript's first lines", () => {
  it("takes the folder and the first thing he asked, skipping wrappers and meta lines", () => {
    const head = [
      line({ type: "user", isMeta: true, cwd: "/work/shop", message: { content: "Caveat: ignore" } }),
      line({ type: "user", cwd: "/work/shop", message: { content: "<system-reminder>x</system-reminder>" } }),
      line({ type: "user", cwd: "/work/shop", message: { content: [{ type: "text", text: "Fix the checkout\n\nit breaks on tax" }] } }),
      '{"type":"assistant","message":{"con',
    ].join("\n");
    expect(readTranscriptHead(head)).toEqual({ cwd: "/work/shop", title: "Fix the checkout it breaks on tax" });
  });

  it("prefers the conversation's own summary and cuts a long title", () => {
    expect(readTranscriptHead(`${line({ type: "summary", summary: "Checkout fix" })}\n${line({ type: "user", cwd: "/a", message: { content: "x" } })}`).title).toBe("Checkout fix");
    expect(readTranscriptHead(line({ type: "user", cwd: "/a", message: { content: "w".repeat(200) } })).title).toHaveLength(90);
  });

  it("still gives something readable for an empty or unreadable head", () => {
    expect(readTranscriptHead("")).toEqual({ cwd: null, title: "Untitled conversation" });
    expect(readTranscriptHead("not json\n{broken")).toEqual({ cwd: null, title: "Untitled conversation" });
  });
});

describe("reading the history index", () => {
  it("makes one row per session from the header lines, ignoring tool output", () => {
    const text = [
      "2026-10-04T13:55  user  -home-ann-books  aaaaaaaa-1111-2222-3333-444444444444",
      "    the invoice for March",
      "2026-10-04T13:56  tool_result  -home-ann-books  bbbbbbbb-1111-2222-3333-444444444444",
      "    dump",
      "2026-10-05T08:00  assistant  -home-ann-books  aaaaaaaa-1111-2222-3333-444444444444",
    ].join("\n");
    expect(parseHistoryHits(text)).toEqual([{ sessionId: "aaaaaaaa-1111-2222-3333-444444444444", project: "-home-ann-books", at: "2026-10-04T13:55:00.000Z" }]);
  });
});
