import { describe, expect, it } from "vite-plus/test";

import type { HistoryTurn } from "./history.ts";
import {
  NO_HOLD_KEY_RECORDING,
  NO_RECORDING,
  retryPlan,
  rowMenu,
  useVersion,
  withRetry,
} from "./historyRetry.ts";

const turn = (over: Partial<HistoryTurn> = {}) => ({
  kind: "dictation" as const,
  status: "ok" as const,
  audio: "C:/a.webm",
  delivery: "oneshot" as string | null,
  at: "2026-11-01T10:00:00.000Z",
  raw: "there's still many",
  cleaned: "There's still many." as string | null,
  model: "haiku" as string | null,
  versions: [] as HistoryTurn["versions"],
  ...over,
});

describe("retry transcript", () => {
  it("re-runs recognition whenever a recording exists, even on an old failed entry", () => {
    expect(retryPlan(turn())).toEqual({ kind: "transcript" });
    expect(retryPlan(turn({ status: "failed", raw: "" }))).toEqual({ kind: "transcript" });
  });

  it("says plainly that no recording was kept, and offers only the clean-up retry where it applies", () => {
    expect(retryPlan(turn({ audio: null, status: "ok" }))).toEqual({
      kind: "none",
      why: NO_RECORDING,
    });
    expect(retryPlan(turn({ audio: null, status: "raw" }))).toEqual({
      kind: "cleanup",
      why: NO_RECORDING,
    });
    expect(retryPlan(turn({ audio: null, delivery: "hold key", status: "failed" }))).toEqual({
      kind: "cleanup",
      why: NO_HOLD_KEY_RECORDING,
    });
    expect(retryPlan(turn({ audio: null, kind: "spoken", status: "none" }))).toMatchObject({
      kind: "none",
    });
  });
});

describe("the row menu", () => {
  it("offers Copy, Copy as heard, Undo AI edit, Retry transcript and Delete", () => {
    expect(rowMenu(turn(), false).map((i) => [i.id, i.enabled])).toEqual([
      ["copy", true],
      ["copy_raw", true],
      ["undo_ai", true],
      ["retry_transcript", true],
      ["delete", true],
    ]);
  });

  it("greys Retry transcript with the reason when there is no recording, and while one is running", () => {
    const none = rowMenu(turn({ audio: null }), false).find((i) => i.id === "retry_transcript");
    expect(none).toMatchObject({ enabled: false, note: NO_RECORDING });
    const busy = rowMenu(turn(), true).find((i) => i.id === "retry_transcript");
    expect(busy?.enabled).toBe(false);
  });

  it("adds the clean-up retry only for a raw or failed dictation with no recording", () => {
    const ids = (t: ReturnType<typeof turn>) => rowMenu(t, false).map((i) => i.id);
    expect(ids(turn({ audio: null, status: "raw" }))).toContain("retry");
    expect(ids(turn({ audio: null, status: "ok" }))).not.toContain("retry");
  });
});

describe("versions", () => {
  const first = {
    at: "t2",
    raw: "there's still many experience problems",
    cleaned: null,
    model: null,
  };

  it("keeps the original as v1 and the retry beside it, never over it", () => {
    const t = turn();
    const versions = withRetry(t, first);
    expect(versions).toHaveLength(2);
    expect(versions[0]).toMatchObject({
      raw: "there's still many",
      cleaned: "There's still many.",
    });
    expect(versions[1]).toEqual(first);
  });

  it("adds a third on a second retry and nothing for an identical result", () => {
    const t = turn({ versions: withRetry(turn(), first) });
    expect(withRetry(t, first)).toHaveLength(2);
    expect(withRetry(t, { ...first, raw: "another" })).toHaveLength(3);
  });

  it("picks a version by index", () => {
    const t = turn({ versions: withRetry(turn(), first) });
    expect(useVersion(t, 1)?.raw).toBe(first.raw);
    expect(useVersion(t, 5)).toBeNull();
  });
});

describe("Undo AI edit", () => {
  it("is offered only when the written words differ from the heard ones", () => {
    const ids = (raw: string, cleaned: string | null) =>
      rowMenu({ ...turn(), raw, cleaned }, false).map((i) => i.id);
    expect(ids("ths is it", "This is it.")).toContain("undo_ai");
    expect(ids("same", "same")).not.toContain("undo_ai");
    expect(ids("same", null)).not.toContain("undo_ai");
  });
});
