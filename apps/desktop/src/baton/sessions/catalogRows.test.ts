// @effect-diagnostics globalDate:off
import { describe, expect, it, vi } from "vite-plus/test";

import {
  agoWords,
  catalogControls,
  createCatalog,
  INITIAL_VIEW,
  matches,
  sampleCatalogRows,
  visibleRows,
  type CatalogService,
} from "./catalogRows.ts";

const NOW = Date.UTC(2026, 10, 2, 12);
const rows = sampleCatalogRows(NOW);

describe("the sessions browser's rows", () => {
  it("finds every word in the title, folder, machine or account, newest first", () => {
    expect(matches(rows[1]!, "launch post laptop")).toBe(true);
    expect(matches(rows[1]!, "launch server")).toBe(false);
    expect(visibleRows(rows, INITIAL_VIEW)[0]!.title).toBe("Wire the sessions browser");
    expect(
      visibleRows(rows, { ...INITIAL_VIEW, machine: "server", state: "stopped" }).map(
        (r) => r.title,
      ),
    ).toEqual(["Fix the weekly digest", "Old landing page"]);
  });

  it("says how long ago in words", () => {
    expect(agoWords(new Date(NOW - 5 * 60_000).toISOString(), NOW)).toBe("5 min ago");
    expect(agoWords(new Date(NOW - 26 * 3_600_000).toISOString(), NOW)).toBe("yesterday");
    expect(agoWords(null, NOW)).toBe("");
  });

  it("offers Resume only on a stopped session, and caps what it draws", () => {
    const controls = catalogControls({
      rows,
      view: INITIAL_VIEW,
      now: NOW,
      folders: [],
      status: "",
      loaded: true,
    });
    const labels = controls
      .filter((c) => c.kind === "catalogRow")
      .map((c) => [c.label, c.kind === "catalogRow" ? c.resumeLabel : ""]);
    expect(labels.find(([l]) => l === "Wire the sessions browser")![1]).toBeNull();
    expect(labels.find(([l]) => l === "Write the launch post")![1]).toBe("Resume");
    const many = Array.from({ length: 200 }, (_, i) => ({ ...rows[0]!, id: `m${i}` }));
    const big = catalogControls({
      rows: many,
      view: INITIAL_VIEW,
      now: NOW,
      folders: [],
      status: "",
      loaded: true,
    });
    expect(big.filter((c) => c.kind === "catalogRow")).toHaveLength(25);
  });
});

describe("a resume shows Resuming... until the thread is live", () => {
  it("goes stopped, resuming, running, and opens the thread; a failure says so", async () => {
    let finish: () => void = () => undefined;
    const opened: string[] = [];
    const service: CatalogService = {
      list: async () => rows,
      resume: () => new Promise<void>((r) => (finish = r)),
      create: async () => undefined,
      folders: async () => [],
      open: (row) => void opened.push(row.id),
    };
    const changed = vi.fn();
    const catalog = createCatalog({ service, onChange: changed, now: () => NOW });
    await catalog.refresh();
    const state = (id: string) => {
      const row = catalog.controls().find((c) => c.id === `c:${id}`);
      return row?.kind === "catalogRow" ? row.stateLabel : "";
    };
    expect(state("s1")).toBe("Stopped");
    catalog.apply("c:s1", "resume");
    expect(state("s1")).toBe("Resuming...");
    finish();
    await Promise.resolve();
    await Promise.resolve();
    expect(state("s1")).toBe("Running");
    expect(opened).toEqual(["s1"]);
    // A resume that fails leaves a row he can try again.
    const failing = createCatalog({
      service: { ...service, resume: async () => Promise.reject(new Error("x")) },
      onChange: changed,
      now: () => NOW,
    });
    await failing.refresh();
    failing.apply("c:s1", "resume");
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
    const row = failing.controls().find((c) => c.id === "c:s1");
    expect(row?.kind === "catalogRow" && row.resumeLabel).toBe("Resume");
  });
});
